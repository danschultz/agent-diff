// Starting, resuming, and inspecting background Claude Code agent sessions.

import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.ts';
import { githubOverHttps } from './git.ts';

export interface AgentSessionInfo {
  /** The short id that `claude stop` takes. */
  id: string;
  sessionId: string;
  cwd: string;
  /**
   * "working" while working; "blocked", "done", and others while waiting.
   * Sessions without a live process have only this, not `status`.
   */
  state: string;
  name?: string;
}

export function isWorking(session: AgentSessionInfo): boolean {
  return session.state === 'working';
}

export interface StartOptions {
  cwd: string;
  name: string;
  settingsFile: string;
  prompt: string;
}

export interface Claude {
  start(options: StartOptions): void;
  resume(cwd: string, sessionId: string, prompt: string): void;
  /** Agent sessions that are running now. */
  running(): AgentSessionInfo[];
  /** Stops an agent session by its short id. Its conversation is kept, so it can be resumed. */
  stop(id: string): void;
  /** The end of an agent session's output, for failure reports. */
  logTail(name: string, sessionId: string | undefined): string;
}

/** Environment variables passed through to `claude`. Everything else is dropped. */
const KEEP_ENV = [
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'SSH_AUTH_SOCK',
  'DBUS_SESSION_BUS_ADDRESS',
  // So agent sessions, and their hooks, use the same Aven database as implement.
  'AVEN_DB',
];

/**
 * A clean environment for `claude`, so variables from whatever ran `implement`
 * (another Claude Code session, cmux, a shell profile) don't leak into the
 * agent session. Node, Claude Code, and gh stay on the PATH.
 */
export function cleanEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of KEEP_ENV)
    if (source[key] !== undefined) env[key] = source[key];
  const home = source.HOME ?? os.homedir();
  env.HOME = home;
  env.TERM = 'xterm-256color';
  env.PATH = [
    path.dirname(process.execPath),
    path.join(home, '.local', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ].join(':');
  return { ...env, ...githubOverHttps() };
}

/**
 * Wraps a `claude --bg` command in its own systemd scope.
 *
 * `claude --bg` hands the agent session to a shared daemon, and starts that
 * daemon if it isn't running. The daemon would otherwise land in
 * implement.service's cgroup, and systemd kills everything left in it when a
 * tick exits. In its own scope, the daemon outlives the tick, and the scope
 * goes away when the daemon exits.
 */
export function inOwnScope(
  claudeBin: string,
  args: string[],
): [string, string[]] {
  const unit = `implement-claude-${randomUUID().slice(0, 8)}`;
  return [
    'systemd-run',
    [
      '--user',
      '--scope',
      '--quiet',
      '--collect',
      `--unit=${unit}`,
      '--',
      claudeBin,
      ...args,
    ],
  ];
}

export function cliClaude(claudeBin: string): Claude {
  const claude = (args: string[], cwd?: string) =>
    run(claudeBin, args, { cwd, env: cleanEnv() });
  const claudeBg = (args: string[], cwd: string) =>
    run(...inOwnScope(claudeBin, ['--bg', ...args]), { cwd, env: cleanEnv() });
  return {
    start({ cwd, name, settingsFile, prompt }) {
      // --remote-control takes an optional name, so it's always given one;
      // otherwise the prompt would be read as the name.
      claudeBg(
        [
          '--remote-control',
          name,
          '--name',
          name,
          '--permission-mode',
          'auto',
          '--settings',
          settingsFile,
          prompt,
        ],
        cwd,
      );
    },
    resume(cwd, sessionId, prompt) {
      // No other options: the agent session keeps the ones it was started
      // with, and passing any would start a copy with a new id.
      claudeBg(['--resume', sessionId, prompt], cwd);
    },
    running() {
      const sessions = JSON.parse(
        claude(['agents', '--json']),
      ) as AgentSessionInfo[];
      return sessions.map((s) => ({ ...s, cwd: s.cwd && path.resolve(s.cwd) }));
    },
    stop(id) {
      claude(['stop', id]);
    },
    logTail(name, sessionId) {
      try {
        const logs = claude(['logs', name]).trimEnd();
        if (logs) return lastLines(logs, 40);
      } catch {
        // Fall back to the transcript below.
      }
      return (sessionId && lastAssistantText(sessionId)) || '(no output found)';
    },
  };
}

function lastLines(text: string, count: number): string {
  return text.split('\n').slice(-count).join('\n');
}

/** Finds an agent session's transcript under ~/.claude/projects. */
export function transcriptPath(sessionId: string): string | undefined {
  const projects = path.join(os.homedir(), '.claude', 'projects');
  if (!existsSync(projects)) return undefined;
  for (const dir of readdirSync(projects)) {
    const file = path.join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** The text of the last assistant message in a transcript. */
export function lastAssistantText(sessionIdOrPath: string): string | undefined {
  const file = sessionIdOrPath.endsWith('.jsonl')
    ? sessionIdOrPath
    : transcriptPath(sessionIdOrPath);
  if (!file || !existsSync(file)) return undefined;
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: { type?: string; message?: { content?: unknown } };
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const content = entry.message?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((c) => c?.type === 'text')
              .map((c) => c.text as string)
              .join('\n')
          : '';
    if (text.trim()) return text.trim();
  }
  return undefined;
}

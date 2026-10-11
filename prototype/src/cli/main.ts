// agent-diff CLI: how agents, harnesses, and hooks talk to the review server.
// Run `agent-diff help` for usage.

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cliCommand, dataDir, prototypeDir, serverInfoFile, serverLogFile, type ServerInfo } from '../shared/paths.ts';
import type { FeedbackComment, FeedbackResponse, PendingFeedback, ReviewSessionInfo } from '../shared/types.ts';

const USAGE = `agent-diff (prototype)

Review sessions
  agent-diff start [path...] [--base <ref>] [--title <text>] [--open]
      Start a review session over one or more workspaces (default: the current
      directory) and print the review UI URL. Starts the review server if needed.
  agent-diff add <review-session> <path> [--base <ref>]
  agent-diff end [<review-session>]
  agent-diff status

Agents
  agent-diff register [--agent-id <id>] [--label <text>] [--parent <id>]
                      [--notify <method>] [--workspace <path>]
      Notify methods: tmux:<target>, cmux:<surface>, command:<shell>, hook, none.
      Defaults to cmux:$CMUX_SURFACE_ID or tmux:$TMUX_PANE when set, else hook.
  agent-diff feedback [--workspace <path>] [--review-session <id>] [--all] [--json]
      Fetch submitted feedback for a workspace and mark it as fetched.
  agent-diff pending [--workspace <path>]
      Print the notification message if feedback is waiting, otherwise nothing.
  agent-diff snapshot [--workspace <path>] [--reason <text>]
      Record a turn snapshot for the "Last turn" diff mode.

Hooks (read the hook's JSON from stdin, never fail the agent)
  agent-diff hook claude <SessionStart|UserPromptSubmit|Stop> [--no-wake]
  agent-diff hook cursor <sessionStart|beforeSubmitPrompt|stop> [--no-wake]

Server
  agent-diff serve [--port <n>] [--static]
`;

const [command = 'help', ...rest] = process.argv.slice(2);

try {
  await run(command, rest);
} catch (error) {
  if (command === 'hook') {
    // Hooks must never break the agent. Log and emit a no-op response.
    console.error(`agent-diff hook: ${(error as Error).message}`);
    if (rest[0] === 'cursor') process.stdout.write('{}');
    process.exit(0);
  }
  console.error(`agent-diff: ${(error as Error).message}`);
  process.exit(1);
}

async function run(cmd: string, args: string[]): Promise<void> {
  switch (cmd) {
    case 'start':
      return start(args);
    case 'add':
      return add(args);
    case 'end':
      return end(args);
    case 'status':
      return status();
    case 'register':
      return register(args);
    case 'feedback':
      return feedback(args);
    case 'pending':
      return pending(args);
    case 'snapshot':
      return snapshot(args);
    case 'hook':
      await hook(args);
      return;
    case 'serve':
      return serve(args);
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(USAGE);
      return;
    default:
      throw new Error(`Unknown command "${cmd}". Run \`agent-diff help\`.`);
  }
}

// Commands

async function start(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      title: { type: 'string' },
      open: { type: 'boolean', default: false },
      'agent-id': { type: 'string' },
    },
  });
  const server = await ensureServer(true);
  const paths = positionals.length ? positionals : [process.cwd()];
  const agentId = values['agent-id'] ?? process.env.AGENT_DIFF_AGENT_ID ?? null;
  const rs = await api<ReviewSessionInfo>(server, 'POST', '/api/review-sessions', {
    workspaces: paths.map((p) => ({ path: path.resolve(p), baseRef: values.base ?? null })),
    title: values.title ?? null,
    startedBy: agentId,
  });
  if (agentId) {
    for (const p of paths) await api(server, 'POST', '/api/agents', { id: agentId, notify: detectNotify(), workspace: path.resolve(p) });
  }
  const url = `${server.url}/?rs=${rs.id}`;
  console.log(`Started review session ${rs.id}`);
  for (const w of rs.workspaces) console.log(`  ${w.root} (${w.branch ?? 'detached'} vs ${w.baseRef})`);
  console.log(`Review UI: ${url}`);
  console.log(`This command doesn't wait for the review. You'll be notified when feedback is submitted.`);
  if (values.open) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}

async function add(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { base: { type: 'string' } } });
  const [rsId, dir] = positionals;
  if (!rsId || !dir) throw new Error('Usage: agent-diff add <review-session> <path> [--base <ref>]');
  const server = await ensureServer(false);
  const rs = await api<ReviewSessionInfo>(server, 'POST', `/api/review-sessions/${rsId}/workspaces`, {
    path: path.resolve(dir),
    baseRef: values.base ?? null,
  });
  console.log(`Review session ${rs.id} now covers ${rs.workspaces.length} workspace(s).`);
}

async function end(args: string[]) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const server = await ensureServer(false);
  let rsId = positionals[0];
  if (!rsId) {
    const state = await api<{ reviewSessions: ReviewSessionInfo[] }>(server, 'GET', '/api/state');
    const root = path.resolve(process.cwd());
    rsId = state.reviewSessions.find((rs) => rs.status === 'open' && rs.workspaces.some((w) => isInside(root, w.root)))?.id ?? '';
    if (!rsId) throw new Error('No open review session covers this directory. Pass a review session id.');
  }
  await api(server, 'POST', `/api/review-sessions/${rsId}/end`, {});
  console.log(`Ended review session ${rsId}.`);
}

async function status() {
  const server = await findServer();
  if (!server) {
    console.log('No review server is running.');
    return;
  }
  const state = await api<{ reviewSessions: ReviewSessionInfo[]; agents: { id: string; label: string | null; notify: string; busy: boolean }[] }>(
    server,
    'GET',
    '/api/state',
  );
  console.log(`Review server ${server.url} (pid ${server.pid})`);
  console.log(`\nReview sessions:`);
  for (const rs of state.reviewSessions.filter((r) => r.status === 'open')) {
    console.log(`  ${rs.id}  ${server.url}/?rs=${rs.id}`);
    for (const w of rs.workspaces) console.log(`    ${w.root} (${w.branch ?? 'detached'} vs ${w.baseRef})`);
  }
  console.log(`\nAgents:`);
  for (const a of state.agents) console.log(`  ${a.id}  ${a.label ?? ''}  notify=${a.notify}  ${a.busy ? 'mid-turn' : 'idle'}`);
}

async function register(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      'agent-id': { type: 'string' },
      label: { type: 'string' },
      parent: { type: 'string' },
      notify: { type: 'string' },
      workspace: { type: 'string' },
    },
  });
  const server = await ensureServer(true);
  const id = values['agent-id'] ?? process.env.AGENT_DIFF_AGENT_ID ?? terminalAgentId();
  if (!id) throw new Error('Pass --agent-id or set AGENT_DIFF_AGENT_ID.');
  await api(server, 'POST', '/api/agents', {
    id,
    label: values.label ?? null,
    parentId: values.parent ?? process.env.AGENT_DIFF_PARENT_ID ?? null,
    notify: values.notify ?? detectNotify(),
    workspace: path.resolve(values.workspace ?? process.cwd()),
  });
  console.log(`Registered agent ${id} (notify ${values.notify ?? detectNotify()}).`);
}

async function feedback(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      workspace: { type: 'string' },
      'review-session': { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      'agent-id': { type: 'string' },
    },
  });
  const server = await ensureServer(false);
  const result = await api<FeedbackResponse>(server, 'POST', '/api/feedback', {
    workspace: path.resolve(values.workspace ?? process.cwd()),
    reviewSessionId: values['review-session'] ?? null,
    all: values.all,
    agentId: values['agent-id'] ?? process.env.AGENT_DIFF_AGENT_ID ?? null,
  });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  process.stdout.write(formatFeedback(result, values.all));
}

async function pending(args: string[]) {
  const { values } = parseArgs({ args, options: { workspace: { type: 'string' } } });
  const server = await findServer();
  if (!server) return;
  const result = await pendingFor(server, path.resolve(values.workspace ?? process.cwd()));
  if (result.pending) console.log(result.message);
}

async function snapshot(args: string[]) {
  const { values } = parseArgs({ args, options: { workspace: { type: 'string' }, reason: { type: 'string', default: 'manual' } } });
  const server = await ensureServer(false);
  const snap = await api<{ seq: number; commit: string }>(server, 'POST', '/api/workspaces/snapshot', {
    workspace: path.resolve(values.workspace ?? process.cwd()),
    reason: values.reason,
    agentId: process.env.AGENT_DIFF_AGENT_ID ?? null,
  });
  console.log(`Recorded turn snapshot ${snap.seq} (${snap.commit.slice(0, 8)}).`);
}

async function serve(args: string[]) {
  const child = spawn(process.execPath, [path.join(prototypeDir, 'src', 'server', 'main.ts'), ...args], { cwd: prototypeDir, stdio: 'inherit' });
  await new Promise((resolve) => child.on('close', resolve));
}

// Hooks

function AGENT_INSTRUCTIONS(cli: string): string {
  return `This workspace may be under review in agent-diff. If you're told "agent-diff: review feedback is ready", run the command in that message (\`${cli} feedback --workspace <path>\`), address each comment, then summarize what you changed for each one. To ask a human to review your work, run \`${cli} start\`; it returns immediately with a URL to share.`;
}

async function hook(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { 'no-wake': { type: 'boolean', default: false } } });
  const [harness, event] = positionals;
  const input = await readStdinJson();
  const server = await findServer();
  const wake = !values['no-wake'];

  if (harness === 'claude') {
    if (!server) return;
    const id = String(input.session_id ?? terminalAgentId() ?? 'claude');
    const agent = { label: `claude ${id.slice(0, 8)}`, notify: detectNotify() };
    const cwd = String(input.cwd ?? process.cwd());
    switch (event) {
      case 'SessionStart':
        await api(server, 'POST', '/api/agents', { id, ...agent, workspace: cwd }).catch(() => undefined);
        process.stdout.write(AGENT_INSTRUCTIONS(cliCommand));
        return;
      case 'UserPromptSubmit': {
        const { pending } = await turn(server, id, 'start', cwd, wake, agent);
        if (pending.pending && wake) {
          process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: pending.message } }));
        }
        return;
      }
      case 'Stop': {
        const canBlock = wake && !input.stop_hook_active;
        const { pending } = await turn(server, id, 'end', cwd, canBlock, agent);
        if (pending.pending && canBlock) process.stdout.write(JSON.stringify({ decision: 'block', reason: pending.message }));
        return;
      }
      default:
        throw new Error(`Unsupported Claude Code hook event ${event}`);
    }
  }

  if (harness === 'cursor') {
    const out = (value: object): void => void process.stdout.write(JSON.stringify(value));
    if (!server) return out(event === 'beforeSubmitPrompt' ? { continue: true } : {});
    const id = String(input.conversation_id ?? input.session_id ?? 'cursor');
    const agent = { label: `cursor ${id.slice(0, 8)}`, notify: detectNotify() };
    const roots = Array.isArray(input.workspace_roots) ? (input.workspace_roots as string[]) : [];
    const cwd = roots[0] ?? process.cwd();
    switch (event) {
      case 'sessionStart':
        await api(server, 'POST', '/api/agents', { id, ...agent, workspace: cwd }).catch(() => undefined);
        return out({ additional_context: AGENT_INSTRUCTIONS(cliCommand) });
      case 'beforeSubmitPrompt':
        await turn(server, id, 'start', cwd, false, agent);
        return out({ continue: true });
      case 'stop': {
        const canFollowUp = wake && input.status === 'completed' && Number(input.loop_count ?? 0) < 3;
        const { pending } = await turn(server, id, 'end', cwd, canFollowUp, agent);
        return out(pending.pending && canFollowUp ? { followup_message: pending.message } : {});
      }
      default:
        throw new Error(`Unsupported Cursor hook event ${event}`);
    }
  }

  throw new Error(`Unknown harness "${harness}". Use claude or cursor.`);
}

async function turn(
  server: ServerInfo,
  agentId: string,
  event: 'start' | 'end',
  cwd: string,
  canWake: boolean,
  agent: { label: string; notify: string },
): Promise<{ pending: PendingFeedback }> {
  return api(server, 'POST', `/api/agents/${encodeURIComponent(agentId)}/turn`, {
    event,
    cwd,
    canWake,
    label: agent.label,
    notify: agent.notify,
    parentId: process.env.AGENT_DIFF_PARENT_ID ?? null,
  });
}

async function pendingFor(server: ServerInfo, workspace: string): Promise<PendingFeedback> {
  return api(server, 'GET', `/api/feedback/pending?workspace=${encodeURIComponent(workspace)}`);
}

// Formatting

export function formatFeedback(result: FeedbackResponse, all: boolean): string {
  const lines: string[] = [];
  const ws = result.workspace;
  lines.push('Review feedback from agent-diff');
  lines.push(`Review session ${result.reviewSessionId}${ws ? `, workspace ${ws.root} (compared with ${ws.baseRef})` : ''}`);
  if (result.comments.length === 0) {
    lines.push(all ? '\nNo comments have been submitted yet.' : '\nNo new feedback. Run with --all to see every submitted comment.');
    return lines.join('\n') + '\n';
  }
  lines.push(
    `${result.reviews.length} review(s), ${result.comments.length} comment(s). Address each comment, then reply with a short summary of what you changed for each one, by number.`,
  );
  result.comments.forEach((c, i) => lines.push('', ...formatComment(c, i + 1)));
  lines.push('', `Line numbers are for the current working tree. Run \`${cliCommand} feedback --all\` to see every comment again.`);
  return lines.join('\n') + '\n';
}

function formatComment(c: FeedbackComment, n: number): string[] {
  if (c.kind === 'overall' || !c.original) return [`[${n}] Overall comment`, ...indent(c.body, '    ')];
  const range = (start: number | null, end: number | null) => (start === end ? `line ${start}` : `lines ${start}-${end}`);
  const out: string[] = [];
  const where = `${c.path}, ${range(c.original.startLine, c.original.endLine)}${c.side === 'old' ? ' on removed lines (base version)' : ''}`;
  const state = c.current?.state;
  if (state === 'current') {
    const moved = c.current!.startLine !== c.original.startLine;
    out.push(`[${n}] ${where}${moved ? `, now ${range(c.current!.startLine, c.current!.endLine)}` : ''}`);
    out.push(...code(c.current!.code, c.current!.startLine!));
  } else if (state === 'moved') {
    out.push(`[${n}] ${where}, the code moved or changed slightly and is now at ${range(c.current!.startLine, c.current!.endLine)}`);
    out.push(...code(c.current!.code, c.current!.startLine!));
  } else {
    out.push(`[${n}] ${where} (outdated: this code has changed since the comment was written)`);
    out.push('    Written on:', ...code(c.original.code, c.original.startLine));
    if (c.current?.startLine) out.push('    Now:', ...code(c.current.code, c.current.startLine));
    else out.push('    Now: those lines were removed.');
  }
  out.push('    Comment:', ...indent(c.body, '      '));
  return out;
}

function code(lines: string[], start: number): string[] {
  const width = String(start + lines.length).length;
  return lines.map((l, i) => `    ${String(start + i).padStart(width)} | ${l}`);
}

function indent(text: string, prefix: string): string[] {
  return text.split('\n').map((l) => prefix + l);
}

// Server discovery

async function findServer(): Promise<ServerInfo | null> {
  let info: ServerInfo;
  try {
    info = JSON.parse(readFileSync(serverInfoFile, 'utf8'));
  } catch {
    return null;
  }
  try {
    const res = await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? info : null;
  } catch {
    return null;
  }
}

async function ensureServer(autostart: boolean): Promise<ServerInfo> {
  const found = await findServer();
  if (found) return found;
  if (!autostart) throw new Error('No review server is running. Start one with `agent-diff start` or `agent-diff serve`.');
  mkdirSync(dataDir, { recursive: true });
  const log = openSync(serverLogFile, 'a');
  // Not the caller's directory: it's often a worktree that gets deleted, and Vite crashes without a cwd.
  const child = spawn(process.execPath, [path.join(prototypeDir, 'src', 'server', 'main.ts')], {
    cwd: prototypeDir,
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  closeSync(log);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const info = await findServer();
    if (info) return info;
  }
  throw new Error(`The review server didn't start. See ${serverLogFile}.`);
}

async function api<T = unknown>(server: ServerInfo, method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(server.url + route, {
    method,
    headers: { 'content-type': 'application/json', 'x-agent-diff': '1' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${method} ${route} failed with ${res.status}`);
  return data;
}

// Environment

function detectNotify(): string {
  if (process.env.AGENT_DIFF_NOTIFY) return process.env.AGENT_DIFF_NOTIFY;
  if (process.env.CMUX_SURFACE_ID) return `cmux:${process.env.CMUX_SURFACE_ID}`;
  if (process.env.TMUX_PANE) return `tmux:${process.env.TMUX_PANE}`;
  return 'hook';
}

function terminalAgentId(): string | null {
  if (process.env.CMUX_SURFACE_ID) return `cmux-${process.env.CMUX_SURFACE_ID}`;
  if (process.env.TMUX_PANE) return `tmux-${process.env.TMUX_PANE}`;
  return null;
}

async function readStdinJson(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function isInside(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Starts the review server, and the review UI's dev server, as a user would,
// with a temporary XDG_STATE_HOME, so the tests never use the real state
// directory, and creates a session with `agent-diff session new`.
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test as base } from '@playwright/test';
import { readConfig, statePaths } from '@agent-diff/shared/state';
import { gitTestEnv } from '../scripts/test/git-env.ts';

const root = path.join(import.meta.dirname, '..');
const bin = path.join(root, 'node_modules', '.bin', 'agent-diff');

export interface Running {
  // The origin, such as `http://127.0.0.1:4321/`, without the token.
  origin: string;
}

export interface DevServer extends Running {
  // What it has printed so far.
  output(): string;
}

export interface ReviewServer extends Running {
  token: string;
}

export interface CreatedSession {
  id: string;
  // The review UI's URL with the token, as `session new` printed it.
  url: string;
  // A git repo with a commit on main and the branch feature checked out.
  repo: string;
  // A directory that doesn't use git.
  plain: string;
}

// Spawns a command with only the environment given, and waits for its output
// to match pattern. stop() ends the command and everything it started.
async function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  pattern: RegExp,
): Promise<{
  match: RegExpExecArray;
  output(): string;
  stop(): Promise<void>;
}> {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, NO_COLOR: '1' },
    // Its own process group, so stop() also ends what npm starts.
    detached: true,
  });
  const exited = once(child, 'exit');
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    process.kill(-child.pid!, 'SIGINT');
    await exited;
  };
  let output = '';
  child.stderr.setEncoding('utf8').on('data', (text) => (output += text));
  try {
    const match = await new Promise<RegExpExecArray>((resolve, reject) => {
      child.stdout.setEncoding('utf8').on('data', (text) => {
        output += text;
        const match = pattern.exec(output);
        if (match) resolve(match);
      });
      exited.then(() => reject(new Error(`${command} exited:\n${output}`)));
      // Within Playwright's 30 seconds for a test, so the command is stopped
      // below rather than left running.
      setTimeout(
        () => reject(new Error(`${command} didn't start:\n${output}`)),
        20_000,
      ).unref();
    });
    return { match, output: () => output, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// Runs the CLI, and returns what it printed.
export function agentDiff(env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync(bin, args, { cwd: root, env, encoding: 'utf8' });
}

export const test = base.extend<{
  // The environment for the review server and the CLI: the one for running
  // git, as AGENTS.md says, with a temporary XDG_STATE_HOME.
  env: NodeJS.ProcessEnv;
  reviewServer: ReviewServer;
  session: CreatedSession;
  devServer: DevServer;
}>({
  env: async ({}, use) => {
    const cleanups: (() => void)[] = [];
    const stateHome = tempDir('agent-diff-e2e-');
    cleanups.push(() => rmSync(stateHome, { recursive: true, force: true }));
    const env = gitTestEnv({ after: (cleanup) => cleanups.push(cleanup) });
    await use({ ...env, XDG_STATE_HOME: stateHome });
    for (const cleanup of cleanups) cleanup();
  },
  // `agent-diff server start --foreground`, serving the built review UI. The
  // port and token are read from the config file once it says it's running.
  reviewServer: async ({ env }, use) => {
    const { match, stop } = await run(
      bin,
      ['server', 'start', '--foreground'],
      env,
      /The review server is running on port (\d+)\.\n/,
    );
    const config = readConfig(statePaths(env));
    if (config?.port !== Number(match[1])) {
      throw new Error(`The config file doesn't have port ${match[1]}.`);
    }
    await use({
      origin: `http://127.0.0.1:${config.port}/`,
      token: config.token,
    });
    await stop();
  },
  // A session over a git repo and a directory that doesn't use git, created
  // with `agent-diff session new --title Check`.
  session: async ({ env, reviewServer }, use) => {
    void reviewServer;
    const repo = tempDir('agent-diff-e2e-repo-');
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, env });
    git('init', '--quiet', '--initial-branch', 'main');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--quiet',
      '--allow-empty',
      '--message',
      'Commit',
    );
    git('switch', '--quiet', '--create', 'feature');
    const plain = tempDir('agent-diff-e2e-plain-');
    mkdirSync(path.join(plain, 'notes'));

    const output = agentDiff(
      env,
      'session',
      'new',
      '--title',
      'Check',
      repo,
      plain,
    );
    const id = /^Created session (s_[0-9a-z]{6})\.$/m.exec(output)?.[1];
    const url = /^Review UI: (\S+)$/m.exec(output)?.[1];
    if (!id || !url) throw new Error(`Unexpected output:\n${output}`);
    await use({ id, url, repo, plain });
    rmSync(repo, { recursive: true, force: true });
    rmSync(plain, { recursive: true, force: true });
  },
  // `npm run dev:ui`, proxying API calls to the review server, which has to
  // be started first, so the dev server can read its port and token. npm
  // needs the user's environment, and the dev server doesn't run git.
  devServer: async ({ env, reviewServer }, use) => {
    void reviewServer;
    const port = await freePort();
    const { match, output, stop } = await run(
      'npm',
      ['run', 'dev:ui', '--', '--port', String(port), '--strictPort'],
      { ...process.env, XDG_STATE_HOME: env.XDG_STATE_HOME },
      /Local:\s+(http:\/\/localhost:\d+\/)\s/,
    );
    await use({ origin: match[1]!, output });
    await stop();
  },
});

// The URL with its origin changed, such as a session's link opened on the
// dev server.
export function withOrigin(url: string, origin: string): string {
  const moved = new URL(url);
  const { protocol, host } = new URL(origin);
  moved.protocol = protocol;
  moved.host = host;
  return moved.href;
}

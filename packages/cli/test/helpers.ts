import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { readConfig, statePaths } from '@agent-diff/shared/state';
import { gitTestEnv } from '../../../scripts/test/git-env.ts';

export const bin = path.join(import.meta.dirname, '..', 'bin', 'agent-diff.ts');

// A temporary directory, by its real path, removed when the test ends.
export function tempDir(t: TestContext, prefix = 'agent-diff-cli-'): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A temporary XDG_STATE_HOME, so tests never use the real state directory,
// on top of the environment for running git, which the review server runs
// with. Child processes get only this environment, never `process.env`.
export function tempStateHome(t: TestContext): NodeJS.ProcessEnv {
  return { ...gitTestEnv(t), XDG_STATE_HOME: tempDir(t) };
}

export function git(
  env: NodeJS.ProcessEnv,
  dir: string,
  ...args: string[]
): string {
  return execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
}

// A new repo with a commit on main, and the branch feature checked out.
export function makeRepo(t: TestContext, env: NodeJS.ProcessEnv): string {
  const dir = tempDir(t, 'agent-diff-repo-');
  git(env, dir, 'init', '--quiet', '--initial-branch', 'main');
  git(
    env,
    dir,
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
  git(env, dir, 'switch', '--quiet', '--create', 'feature');
  return dir;
}

export function saveConfig(
  env: NodeJS.ProcessEnv,
  config: { port: number; token?: string },
): void {
  const paths = statePaths(env);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  writeFileSync(paths.config, JSON.stringify(config), { mode: 0o600 });
}

// A token in the format the review server creates, which no review server
// has.
export function otherToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface Result {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunOptions {
  cwd?: string;
  // What stdin reads. It's never a terminal.
  input?: string;
}

// Runs the CLI in a child process, as `npx agent-diff` does, with stdin from
// a pipe.
export async function runCli(
  env: NodeJS.ProcessEnv,
  args: string[],
  { cwd, input = '' }: RunOptions = {},
): Promise<Result> {
  const child = spawn(process.execPath, [bin, ...args], { env, cwd });
  child.stdin.end(input);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (text) => (stdout += text));
  child.stderr.setEncoding('utf8').on('data', (text) => (stderr += text));
  const [exitCode] = await once(child, 'exit');
  return { stdout, stderr, exitCode };
}

export interface ForegroundServer {
  child: ChildProcess;
  port: number;
  token: string;
  output(): string;
  // Sends the signal and resolves with the exit code.
  stop(signal: NodeJS.Signals): Promise<number | null>;
}

// Runs `agent-diff server start --foreground` in a child process, waits for
// it to say it's running, and reads the token from the config file.
export async function startForeground(
  t: TestContext,
  env: NodeJS.ProcessEnv,
): Promise<ForegroundServer> {
  const child = spawn(
    process.execPath,
    [bin, 'server', 'start', '--foreground'],
    { env },
  );
  const exited = once(child, 'exit').then(([code]) => code as number | null);
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  let output = '';
  child.stderr.setEncoding('utf8').on('data', (text) => (output += text));
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout.setEncoding('utf8').on('data', (text) => {
      output += text;
      const match = /^The review server is running on port (\d+)\.\n/m.exec(
        output,
      );
      if (match) resolve(Number(match[1]));
    });
    exited.then(() => reject(new Error(`Exited early:\n${output}`)));
  });
  const config = readConfig(statePaths(env));
  if (config?.port !== port) throw new Error(`No config for port ${port}.`);
  return {
    child,
    port,
    token: config.token,
    output: () => output,
    stop: (signal) => {
      child.kill(signal);
      return exited;
    },
  };
}

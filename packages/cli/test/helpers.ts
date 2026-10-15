import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { statePaths } from '@agent-diff/shared/state';

export const bin = path.join(import.meta.dirname, '..', 'bin', 'agent-diff.ts');

// A temporary XDG_STATE_HOME, so tests never use the real state directory.
export function tempStateHome(t: TestContext): NodeJS.ProcessEnv {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-diff-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { XDG_STATE_HOME: dir };
}

export function saveConfig(env: NodeJS.ProcessEnv, port: number): void {
  const paths = statePaths(env);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  writeFileSync(paths.config, JSON.stringify({ port }), { mode: 0o600 });
}

export interface Result {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// Runs the CLI in a child process, as `npx agent-diff` does.
export async function runCli(
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Promise<Result> {
  const child = spawn(process.execPath, [bin, ...args], {
    env: { ...process.env, ...env },
  });
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
  output(): string;
  // Sends the signal and resolves with the exit code.
  stop(signal: NodeJS.Signals): Promise<number | null>;
}

// Runs `agent-diff server start --foreground` in a child process, and waits
// for it to print its URL.
export async function startForeground(
  t: TestContext,
  env: NodeJS.ProcessEnv,
): Promise<ForegroundServer> {
  const child = spawn(
    process.execPath,
    [bin, 'server', 'start', '--foreground'],
    { env: { ...process.env, ...env } },
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
      const match = /running at http:\/\/127\.0\.0\.1:(\d+)\//.exec(output);
      if (match) resolve(Number(match[1]));
    });
    exited.then(() => reject(new Error(`Exited early:\n${output}`)));
  });
  return {
    child,
    port,
    output: () => output,
    stop: (signal) => {
      child.kill(signal);
      return exited;
    },
  };
}

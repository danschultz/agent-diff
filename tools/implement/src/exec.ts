import { spawnSync } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

/** Runs a command and returns its stdout. Throws with stderr when it exits non-zero. */
export function run(cmd: string, args: string[], options: RunOptions = {}): string {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${cmd} ${args[0] ?? ''} exited with ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

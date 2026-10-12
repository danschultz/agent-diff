import { spawnSync } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  /** Kills the command after this long. A stuck command shouldn't hold up every later tick. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** Runs a command and returns its stdout. Throws with stderr when it exits non-zero or times out. */
export function run(cmd: string, args: string[], options: RunOptions = {}): string {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
    throw new Error(`${cmd} ${args[0] ?? ''} timed out after ${timeoutMs / 1000}s`);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${cmd} ${args[0] ?? ''} exited with ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Socket } from 'node:net';

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface RunOptions {
  env?: Record<string, string>;
  input?: string;
  /** Exit codes that aren't errors. Defaults to [0]. */
  okCodes?: number[];
}

export interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export class GitError extends Error {
  readonly code: number;
  readonly stderr: string;
  constructor(args: string[], code: number, stderr: string) {
    super(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`);
    this.code = code;
    this.stderr = stderr;
  }
}

// Variables a parent git process (for example a git hook that runs an agent)
// may have set. Inheriting them would point every command at the wrong repo.
const INHERITED_GIT_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
];

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
  for (const name of INHERITED_GIT_VARS) delete env[name];
  return env;
}

export function runGit(
  cwd: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      env: { ...baseEnv(), ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        code: code ?? -1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
      };
      if (!(options.okCodes ?? [0]).includes(result.code))
        reject(new GitError(args, result.code, result.stderr));
      else resolve(result);
    });
    // git may exit without reading stdin. The write then fails with EPIPE,
    // and the exit code and stderr decide the result instead.
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(options.input ?? '');
  });
}

export async function git(
  cwd: string,
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  return (await runGit(cwd, args, options)).stdout.toString('utf8');
}

export interface ObjectInfo {
  oid: string;
  type: string;
  size: number;
}

interface Pending {
  kind: 'info' | 'contents';
  resolve: (value: { info: ObjectInfo; content: Buffer | null } | null) => void;
  reject: (error: Error) => void;
}

/**
 * Reads objects through one long-running `git cat-file --batch-command`
 * (git 2.36+). Spawning git costs tens of milliseconds on some machines, and
 * showing one file side would otherwise take three spawns.
 */
export class ObjectReader {
  private readonly cwd: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private pending: Pending[] = [];

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /** `name` is anything cat-file accepts, such as `<tree>:<path>`. Returns null if it doesn't exist. */
  async info(name: string): Promise<ObjectInfo | null> {
    return (await this.request('info', name))?.info ?? null;
  }

  async contents(name: string): Promise<Buffer | null> {
    return (await this.request('contents', name))?.content ?? null;
  }

  close(): void {
    this.child?.kill();
    this.child = null;
  }

  private request(
    kind: Pending['kind'],
    name: string,
  ): Promise<{ info: ObjectInfo; content: Buffer | null } | null> {
    if (name.includes('\n'))
      return Promise.reject(
        new Error('Object names with newlines are not supported'),
      );
    const child = this.start();
    // An idle reader mustn't keep the process alive, but a pending read must.
    if (this.pending.length === 0) pipe(child.stdout).ref();
    return new Promise((resolve, reject) => {
      this.pending.push({ kind, resolve, reject });
      child.stdin.write(`${kind} ${name}\n`);
    });
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn('git', ['cat-file', '--batch-command'], {
      cwd: this.cwd,
      env: baseEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.stdout.on('data', (d: Buffer) => {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, d]) : d;
      this.drain();
    });
    const fail = (error: Error) => {
      if (this.child === child) this.child = null;
      this.buffer = Buffer.alloc(0);
      for (const p of this.pending.splice(0)) p.reject(error);
    };
    child.on('error', fail);
    child.on('close', (code) =>
      fail(new Error(`git cat-file exited ${code}: ${stderr.trim()}`)),
    );
    child.stdin.on('error', () => undefined);
    child.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr])
      pipe(stream).unref();
    this.child = child;
    return child;
  }

  private drain(): void {
    this.drainPending();
    if (this.pending.length === 0 && this.child)
      pipe(this.child.stdout).unref();
  }

  private drainPending(): void {
    while (this.pending.length) {
      const eol = this.buffer.indexOf(10);
      if (eol < 0) return;
      const header = this.buffer.subarray(0, eol).toString('utf8');
      const next = this.pending[0];
      if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
        this.buffer = this.buffer.subarray(eol + 1);
        this.pending.shift();
        next.resolve(null);
        continue;
      }
      const [oid, type, size] = header.split(' ');
      const info = { oid, type, size: Number(size) };
      if (next.kind === 'info') {
        this.buffer = this.buffer.subarray(eol + 1);
        this.pending.shift();
        next.resolve({ info, content: null });
        continue;
      }
      const end = eol + 1 + info.size;
      if (this.buffer.length < end + 1) return;
      const content = Buffer.from(this.buffer.subarray(eol + 1, end));
      this.buffer = this.buffer.subarray(end + 1);
      this.pending.shift();
      next.resolve({ info, content });
    }
  }
}

/** Child process pipes are sockets at runtime, which is what exposes ref and unref. */
function pipe(stream: unknown): Socket {
  return stream as Socket;
}

/** Like `git`, but returns null instead of throwing when the command fails. */
export async function gitMaybe(
  cwd: string,
  args: string[],
  options: RunOptions = {},
): Promise<string | null> {
  try {
    return (await git(cwd, args, options)).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

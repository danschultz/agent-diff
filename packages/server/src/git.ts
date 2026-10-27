// The git commands the review server runs in a working directory, from
// decisions 0040 and 0044. They run with the environment the review server was
// started with, so tests can give them their own, and always with
// GIT_OPTIONAL_LOCKS=0, so commands that only read, such as `git diff`, never
// refresh and write the index.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, GIT_OPTIONAL_LOCKS: '0' };
}

export interface GitOutput {
  // Git's exit code.
  code: number;
  stdout: string;
  stderr: string;
}

// Runs git in dir, with input on its standard input when it's given, and
// returns its exit code and its output, untrimmed. Fails when git can't run.
export async function runGit(
  dir: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<GitOutput> {
  try {
    const running = promisify(execFile)('git', args, {
      cwd: dir,
      env: gitEnv(env),
      // A file list for ~10,000 files is more than the default 1 MB.
      maxBuffer: 256 * 1024 * 1024,
    });
    running.child.stdin?.end(input);
    const { stdout, stderr } = await running;
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as {
      code?: unknown;
      stdout?: string;
      stderr?: string;
    };
    if (typeof code !== 'number') throw error;
    return { code, stdout: stdout ?? '', stderr: stderr ?? '' };
  }
}

// Runs git in dir, and returns its output, trimmed, or null when it exits
// with an error, such as when dir isn't in a repo. Fails when git can't run.
async function git(
  dir: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const { code, stdout } = await runGit(dir, args, env);
  return code === 0 ? stdout.trim() : null;
}

// A blob's size, and its contents unless it's over limit bytes, or null when
// there's no such object. It's read with `git cat-file --batch`, which stops
// being read once its size is known to be over the limit.
export function readBlob(
  dir: string,
  object: string,
  limit: number,
  env: NodeJS.ProcessEnv,
): Promise<{ size: number; data: Buffer | null } | null> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], {
      cwd: dir,
      env: gitEnv(env),
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let stderr = '';
    let done = false;
    const finish = (result: { size: number; data: Buffer | null } | null) => {
      done = true;
      child.kill();
      resolve(result);
    };
    child.stderr.setEncoding('utf8').on('data', (text) => (stderr += text));
    child.stdout.on('data', (chunk: Buffer) => {
      if (done) return;
      chunks.push(chunk);
      length += chunk.length;
      const output = Buffer.concat(chunks, length);
      const newline = output.indexOf(0x0a);
      if (newline === -1) return;
      // `<object> <type> <size>`, or `<name> missing`.
      const header = output.subarray(0, newline).toString('utf8');
      if (/ (missing|ambiguous)$/.test(header)) return finish(null);
      const size = Number(header.slice(header.lastIndexOf(' ') + 1));
      if (size > limit) return finish({ size, data: null });
      if (output.length >= newline + 1 + size) {
        finish({
          size,
          data: output.subarray(newline + 1, newline + 1 + size),
        });
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (!done)
        reject(new Error(`git cat-file exited with ${code}: ${stderr}`));
    });
    // Ignored once the blob has been read and git killed.
    child.stdin.on('error', () => undefined);
    child.stdin.end(`${object}\n`);
  });
}

// Whether `git rev-parse` succeeds in dir, which is true in a repo, a
// worktree, or any directory inside one.
export async function usesGit(
  dir: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  return (await git(dir, ['rev-parse'], env)) !== null;
}

// The base ref for a working directory that uses git when none is given:
// origin/HEAD's short name, such as `origin/main`, when it's set, otherwise
// `main` or then `master` when the branch exists and isn't checked out, and
// otherwise `HEAD`. It isn't checked, so a repo with no commits gets `HEAD`.
export async function defaultBaseRef(
  dir: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const [remoteHead, current] = await Promise.all([
    git(
      dir,
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      env,
    ),
    // Null when HEAD is detached.
    git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'], env),
  ]);
  if (remoteHead) return remoteHead;
  for (const branch of ['main', 'master']) {
    if (branch === current) continue;
    const exists = await git(
      dir,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      env,
    );
    if (exists !== null) return branch;
  }
  return 'HEAD';
}

// Whether ref names a commit in dir. `--end-of-options` keeps a ref that
// starts with `-` from being read as an option.
export async function resolvesToCommit(
  dir: string,
  ref: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const commit = await git(
    dir,
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
    env,
  );
  return commit !== null;
}

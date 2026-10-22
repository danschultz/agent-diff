// The git commands the review server runs in a working directory, from
// decision 0039. They run with the environment the review server was started
// with, so tests can give them their own.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Runs git in dir, and returns its output, trimmed, or null when it exits
// with an error, such as when dir isn't in a repo. Fails when git can't run.
async function git(
  dir: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('git', args, {
      cwd: dir,
      env,
    });
    return stdout.trim();
  } catch (error) {
    if (typeof (error as { code?: unknown }).code === 'number') return null;
    throw error;
  }
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

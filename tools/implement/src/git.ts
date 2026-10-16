import { existsSync } from 'node:fs';
import { run } from './exec.ts';

export interface Git {
  /** Fetches `branch` from origin and creates a worktree on a new branch from it. */
  addWorktree(dir: string, branch: string, baseBranch: string): void;
  /** Removes the worktree, if git still knows it, and deletes its local branch. */
  removeWorktree(dir: string, branch: string): void;
  prune(): void;
}

const GITHUB_OVER_HTTPS: [string, string][] = [
  ['url.https://github.com/.insteadOf', 'git@github.com:'],
  ['url.https://github.com/.insteadOf', 'ssh://git@github.com/'],
  ['credential.https://github.com.helper', '!gh auth git-credential'],
];

/**
 * Git config, as environment variables, that reaches GitHub over HTTPS with
 * gh's credentials. SSH needs an agent that's only there while Dan is logged
 * in, and stalls inside an agent session's sandbox. The repo's own config,
 * and so Dan's own sessions, keep using SSH.
 */
export function githubOverHttps(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_CONFIG_COUNT: String(GITHUB_OVER_HTTPS.length),
  };
  GITHUB_OVER_HTTPS.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

/**
 * Git never waits for input: SSH fails instead of asking for a passphrase or
 * host key, and HTTPS fails instead of asking for a password.
 */
function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    ...githubOverHttps(),
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=30',
    GIT_TERMINAL_PROMPT: '0',
  };
}

/**
 * Runs git in `repoDir`, with `env` as the base environment. Tests pass one
 * built from an allowlist, so they don't depend on where they're run from.
 */
export function cliGit(
  repoDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Git {
  const git = (...args: string[]) =>
    run('git', args, { cwd: repoDir, env: gitEnv(env) });
  return {
    addWorktree(dir, branch, baseBranch) {
      git('fetch', '--quiet', 'origin', baseBranch);
      git(
        'worktree',
        'add',
        '--quiet',
        '-b',
        branch,
        dir,
        `origin/${baseBranch}`,
      );
    },
    removeWorktree(dir, branch) {
      const listed = git('worktree', 'list', '--porcelain')
        .split('\n')
        .some((line) => line === `worktree ${dir}`);
      // The pull request is merged or closed, or Dan closed the failed brief,
      // so anything left in the worktree is no longer wanted.
      if (listed) git('worktree', 'remove', '--force', dir);
      else if (existsSync(dir))
        throw new Error(
          `${dir} exists but isn't a worktree of this repo; leaving it alone`,
        );
      const branches = git('branch', '--list', branch).trim();
      if (branches) git('branch', '-D', branch);
    },
    prune() {
      git('worktree', 'prune');
    },
  };
}

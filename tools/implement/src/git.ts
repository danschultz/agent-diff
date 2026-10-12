import { existsSync } from 'node:fs';
import { run } from './exec.ts';

export interface Git {
  /** Fetches `branch` from origin and creates a worktree on a new branch from it. */
  addWorktree(dir: string, branch: string, baseBranch: string): void;
  /** Removes the worktree, if git still knows it, and deletes its local branch. */
  removeWorktree(dir: string, branch: string): void;
  prune(): void;
}

export function cliGit(repoDir: string): Git {
  const git = (...args: string[]) => run('git', args, { cwd: repoDir });
  return {
    addWorktree(dir, branch, baseBranch) {
      git('fetch', '--quiet', 'origin', baseBranch);
      git('worktree', 'add', '--quiet', '-b', branch, dir, `origin/${baseBranch}`);
    },
    removeWorktree(dir, branch) {
      const listed = git('worktree', 'list', '--porcelain')
        .split('\n')
        .some((line) => line === `worktree ${dir}`);
      // The pull request is merged or closed, or Dan closed the failed brief,
      // so anything left in the worktree is no longer wanted.
      if (listed) git('worktree', 'remove', '--force', dir);
      else if (existsSync(dir)) throw new Error(`${dir} exists but isn't a worktree of this repo; leaving it alone`);
      const branches = git('branch', '--list', branch).trim();
      if (branches) git('branch', '-D', branch);
    },
    prune() {
      git('worktree', 'prune');
    },
  };
}

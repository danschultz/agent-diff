import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './exec.ts';

/** tools/implement in the checkout this code runs from. */
export const toolDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const mainScript = path.join(toolDir, 'src', 'main.ts');

export const LABELS = {
  queued: 'agent:queued',
  working: 'agent:working',
  needsInput: 'agent:needs-input',
  review: 'agent:review',
  failed: 'agent:failed',
} as const;

export interface Config {
  /** The main checkout that worktrees are created from. */
  repoDir: string;
  /** owner/name on GitHub. */
  repo: string;
  /** GitHub login whose briefs and pull request reviews are accepted. */
  author: string;
  /** Where brief worktrees are created. Must be a folder Claude Code trusts. */
  worktreesDir: string;
  /** Where state.json, the generated settings file, and the tick lock live. */
  stateDir: string;
  baseBranch: string;
  concurrency: number;
  claudeBin: string;
}

/**
 * Reads the configuration from IMPLEMENT_* environment variables, filling in
 * defaults from git and `gh`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const repoDir = env.IMPLEMENT_REPO_DIR ?? defaultRepoDir();
  const repo =
    env.IMPLEMENT_REPO ??
    run(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
      { cwd: repoDir },
    ).trim();
  const author =
    env.IMPLEMENT_AUTHOR ?? run('gh', ['api', 'user', '-q', '.login']).trim();
  const home = os.homedir();
  const stateHome = env.XDG_STATE_HOME ?? path.join(home, '.local', 'state');
  const localClaude = path.join(home, '.local', 'bin', 'claude');
  const concurrency = Number(env.IMPLEMENT_CONCURRENCY ?? 2);
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error('IMPLEMENT_CONCURRENCY must be a positive integer');
  return {
    repoDir,
    repo,
    author,
    worktreesDir:
      env.IMPLEMENT_WORKTREES_DIR ?? path.join(repoDir, '.claude', 'worktrees'),
    stateDir: env.IMPLEMENT_STATE_DIR ?? path.join(stateHome, 'implement'),
    baseBranch: env.IMPLEMENT_BASE_BRANCH ?? 'main',
    concurrency,
    claudeBin:
      env.IMPLEMENT_CLAUDE ??
      (existsSync(localClaude) ? localClaude : 'claude'),
  };
}

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.IMPLEMENT_STATE_DIR ??
    path.join(
      env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'),
      'implement',
    )
  );
}

/** The main checkout of the repo this tool lives in, even when run from a worktree. */
function defaultRepoDir(): string {
  // Relative to toolDir when it's in the main checkout. (--path-format needs git 2.31.)
  const commonDir = run('git', ['rev-parse', '--git-common-dir'], {
    cwd: toolDir,
  }).trim();
  return path.dirname(path.resolve(toolDir, commonDir));
}

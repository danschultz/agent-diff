import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { cliGit } from '../src/git.ts';
import { gitTestEnv } from './git-env.ts';

// A new temporary folder, and a `git` that runs with the test's environment.
function setup(t: TestContext) {
  const base = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'implement-git-')),
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const env = gitTestEnv(t);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' });
  // A repo with one commit on `main`.
  const repo = (dir: string) => {
    git(base, 'init', '-q', '-b', 'main', dir);
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 'test@example.com');
    writeFileSync(path.join(dir, 'README.md'), 'hi\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'init');
  };
  return { base, env, git, repo };
}

test('creates a brief worktree from origin, then removes it and its branch', (t) => {
  const { base, env, git, repo: init } = setup(t);
  const origin = path.join(base, 'origin.git');
  const repo = path.join(base, 'repo');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  init(repo);
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');

  const worktree = path.join(repo, '.claude', 'worktrees', 'brief-1-x');
  const g = cliGit(repo, env);
  g.addWorktree(worktree, 'brief/1-x', 'main');
  assert.equal(git(worktree, 'branch', '--show-current').trim(), 'brief/1-x');
  writeFileSync(path.join(worktree, 'scratch.txt'), 'left behind\n');

  g.removeWorktree(worktree, 'brief/1-x');
  assert.ok(!existsSync(worktree));
  assert.equal(git(repo, 'branch', '--list', 'brief/1-x').trim(), '');

  // Removing again is a no-op, and prune runs cleanly.
  g.removeWorktree(worktree, 'brief/1-x');
  g.prune();
});

test('runs git with the environment it was given', (t) => {
  const { base, env, git, repo: init } = setup(t);
  const repo = path.join(base, 'repo');
  const other = path.join(base, 'other');
  for (const dir of [repo, other]) {
    init(dir);
    git(dir, 'branch', 'brief/1-x');
  }

  // GIT_DIR points every git command at `other`, whatever its working folder.
  cliGit(repo, { ...env, GIT_DIR: path.join(other, '.git') }).removeWorktree(
    path.join(base, 'missing'),
    'brief/1-x',
  );
  assert.equal(git(other, 'branch', '--list', 'brief/1-x').trim(), '');
  assert.equal(git(repo, 'branch', '--list', 'brief/1-x').trim(), 'brief/1-x');
});

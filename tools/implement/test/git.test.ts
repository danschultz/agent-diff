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
import { test } from 'node:test';
import { cliGit } from '../src/git.ts';

test('creates a brief worktree from origin, then removes it and its branch', (t) => {
  const base = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'implement-git-')),
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' });
  const origin = path.join(base, 'origin.git');
  const repo = path.join(base, 'repo');
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(base, 'init', '-q', '-b', 'main', repo);
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  writeFileSync(path.join(repo, 'README.md'), 'hi\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', 'origin', 'main');

  const worktree = path.join(repo, '.claude', 'worktrees', 'brief-1-x');
  const g = cliGit(repo);
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

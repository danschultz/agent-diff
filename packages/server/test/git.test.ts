import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { gitTestEnv } from '../../../scripts/test/git-env.ts';
import { defaultBaseRef, resolvesToCommit, usesGit } from '../src/git.ts';
import { commit, git, makeRepo, tempDir } from './helpers.ts';

test('a repo, and a directory inside one, use git', async (t) => {
  const env = gitTestEnv(t);
  const repo = makeRepo(t, env);
  const inside = path.join(repo, 'packages', 'one');
  mkdirSync(inside, { recursive: true });
  assert.equal(await usesGit(repo, env), true);
  assert.equal(await usesGit(inside, env), true);
  assert.equal(await usesGit(makeRepo(t, env, { commits: 0 }), env), true);
});

test('a directory outside any repo does not use git', async (t) => {
  const env = gitTestEnv(t);
  assert.equal(await usesGit(tempDir(t), env), false);
});

test("the default base ref is origin/HEAD's short name when it's set", async (t) => {
  const env = gitTestEnv(t);
  const repo = makeRepo(t, env);
  git(env, repo, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD');
  git(
    env,
    repo,
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/trunk',
  );
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  assert.equal(await defaultBaseRef(repo, env), 'origin/trunk');
});

test('the default base ref is main when it exists and another branch is checked out', async (t) => {
  const env = gitTestEnv(t);
  const repo = makeRepo(t, env);
  git(env, repo, 'branch', 'master');
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  assert.equal(await defaultBaseRef(repo, env), 'main');
});

test('the default base ref is master when main does not exist', async (t) => {
  const env = gitTestEnv(t);
  const repo = makeRepo(t, env, { branch: 'master' });
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  assert.equal(await defaultBaseRef(repo, env), 'master');
});

test('the default base ref is master when main is checked out', async (t) => {
  const env = gitTestEnv(t);
  const repo = makeRepo(t, env);
  git(env, repo, 'branch', 'master');
  assert.equal(await defaultBaseRef(repo, env), 'master');
});

test('the default base ref is HEAD on main with no remote', async (t) => {
  const env = gitTestEnv(t);
  assert.equal(await defaultBaseRef(makeRepo(t, env), env), 'HEAD');
});

test('the default base ref is HEAD with a detached HEAD and no main or master', async (t) => {
  const env = gitTestEnv(t);
  const repo = makeRepo(t, env, { branch: 'trunk' });
  git(env, repo, 'switch', '--quiet', '--detach');
  assert.equal(await defaultBaseRef(repo, env), 'HEAD');
});

test('the default base ref is HEAD in a repo with no commits', async (t) => {
  const env = gitTestEnv(t);
  const repo = makeRepo(t, env, { commits: 0 });
  assert.equal(await defaultBaseRef(repo, env), 'HEAD');
});

test('the default base ref is found from a directory inside the repo', async (t) => {
  const env = gitTestEnv(t);
  const repo = makeRepo(t, env);
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  const inside = path.join(repo, 'src');
  mkdirSync(inside);
  assert.equal(await defaultBaseRef(inside, env), 'main');
});

test('a ref resolves to a commit only when it names one', async (t) => {
  const env = gitTestEnv(t);
  const repo = makeRepo(t, env);
  commit(env, repo);
  const tree = git(env, repo, 'rev-parse', 'HEAD^{tree}');
  for (const ref of [
    'HEAD',
    'main',
    'HEAD~1',
    git(env, repo, 'rev-parse', 'HEAD'),
  ]) {
    assert.equal(await resolvesToCommit(repo, ref, env), true, ref);
  }
  for (const ref of ['nope', 'HEAD~5', tree, '--all', '-q']) {
    assert.equal(await resolvesToCommit(repo, ref, env), false, ref);
  }
  const empty = makeRepo(t, env, { commits: 0 });
  assert.equal(await resolvesToCommit(empty, 'HEAD', env), false);
});

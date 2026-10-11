// Checks that diff modes report the right files, and that building trees and
// recording turn snapshots never disturbs the state an agent works with.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { GitWorkspace } from '../src/server/workspace.ts';
import type { DiffMode } from '../src/shared/types.ts';
import { makeRepo, type TestRepo } from './helpers.ts';

let repo: TestRepo;

/**
 * main:    a.txt, b.txt, c.txt, .gitignore
 * feature: one commit that changes c.txt
 * then:    a.txt staged, b.txt unstaged, new.txt untracked, debug.log ignored
 */
function setUpReviewState() {
  repo.write('a.txt', 'a1\n');
  repo.write('b.txt', 'b1\n');
  repo.write('c.txt', 'c1\n');
  repo.write('.gitignore', '*.log\n');
  repo.git('add', '.');
  repo.git('commit', '-qm', 'base');
  repo.git('checkout', '-qb', 'feature');
  repo.write('c.txt', 'c2\n');
  repo.git('commit', '-qam', 'feature work');
  repo.write('a.txt', 'a2\n');
  repo.git('add', 'a.txt');
  repo.write('b.txt', 'b2\n');
  repo.write('new.txt', 'new\n');
  repo.write('debug.log', 'noise\n');
}

function observableState() {
  const indexFile = path.join(repo.dir, '.git', 'index');
  return {
    index: createHash('sha1').update(readFileSync(indexFile)).digest('hex'),
    status: repo.git('status', '--porcelain=v2', '--branch', '--untracked-files=all'),
    stash: repo.git('stash', 'list'),
    headReflog: repo.git('reflog', 'show', '--format=%H %gs', 'HEAD'),
    branchReflog: repo.git('reflog', 'show', '--format=%H %gs', 'feature'),
    userRefs: repo
      .git('for-each-ref', '--format=%(refname) %(objectname)')
      .split('\n')
      .filter((line) => line && !line.startsWith('refs/agent-diff/'))
      .join('\n'),
  };
}

async function filesFor(ws: GitWorkspace, mode: DiffMode, snapshot: string | null = null) {
  const { from, to } = await ws.sides(mode, 'main', snapshot);
  return (await ws.changedFiles(from, to)).map((f) => `${f.status} ${f.path}`);
}

beforeEach(() => {
  repo = makeRepo();
  setUpReviewState();
});

afterEach(() => repo.cleanup());

describe('diff modes', () => {
  it('report the files each mode compares', async () => {
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    assert.deepEqual(await filesFor(ws, 'all'), ['modified a.txt', 'modified b.txt', 'modified c.txt', 'untracked new.txt']);
    assert.deepEqual(await filesFor(ws, 'committed'), ['modified c.txt']);
    assert.deepEqual(await filesFor(ws, 'staged'), ['modified a.txt']);
    assert.deepEqual(await filesFor(ws, 'unstaged'), ['modified b.txt', 'untracked new.txt']);
  });

  it('last turn shows only changes since the snapshot', async () => {
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    const { commit } = await ws.createSnapshot('refs/agent-diff/test/snapshots/1', 'turn snapshot');
    repo.write('b.txt', 'b3\n');
    repo.write('later.txt', 'later\n');
    ws.invalidate();
    assert.deepEqual(await filesFor(ws, 'last-turn', commit), ['modified b.txt', 'untracked later.txt']);
  });

  it('detect renames', async () => {
    repo.git('mv', 'c.txt', 'renamed.txt');
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    const { from, to } = await ws.sides('staged', 'main', null);
    const files = await ws.changedFiles(from, to);
    assert.deepEqual(files.map((f) => [f.status, f.oldPath, f.path]), [
      ['modified', null, 'a.txt'],
      ['renamed', 'c.txt', 'renamed.txt'],
    ]);
  });

  it('see same-size edits made in the same second across refreshes', async () => {
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    const read = async () => {
      ws.invalidate();
      return (await ws.readFile(await ws.worktreeTree(), 'b.txt'))?.content;
    };
    for (const content of ['b3\n', 'b4\n', 'b5\n']) {
      repo.write('b.txt', content);
      assert.equal(await read(), content);
    }
  });

  it('read file contents from either side', async () => {
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    const { from, to } = await ws.sides('all', 'main', null);
    assert.equal((await ws.readFile(from.tree, 'b.txt'))?.content, 'b1\n');
    assert.equal((await ws.readFile(to.tree, 'b.txt'))?.content, 'b2\n');
    assert.equal(await ws.readFile(from.tree, 'new.txt'), null);
  });

  it('read many files at once through one object reader', async () => {
    repo.write('bin.dat', Buffer.from([1, 0, 2, 0, 3]).toString('latin1'));
    repo.write('big.txt', 'x'.repeat(3 * 1024 * 1024));
    repo.write('dir/with space.txt', 'spaced\n');
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    const tree = await ws.worktreeTree();
    const [a, b, missing, bin, big, spaced, dir] = await Promise.all(
      ['a.txt', 'b.txt', 'nope.txt', 'bin.dat', 'big.txt', 'dir/with space.txt', 'dir'].map((p) => ws.readFile(tree, p)),
    );
    assert.equal(a?.content, 'a2\n');
    assert.equal(b?.content, 'b2\n');
    assert.equal(missing, null);
    assert.equal(bin?.binary, true);
    assert.equal(big?.tooLarge, true);
    assert.equal(spaced?.content, 'spaced\n');
    assert.equal(dir?.binary, true);
    ws.close();
  });

  it('cache state only while watched, and drop it on invalidate', async () => {
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    const content = async () => (await ws.readFile(await ws.worktreeTree(), 'b.txt'))?.content;
    repo.write('b.txt', 'b3\n');
    assert.equal(await content(), 'b3\n');
    ws.cacheable = true;
    assert.equal(await content(), 'b3\n');
    repo.write('b.txt', 'b4\n');
    assert.equal(await content(), 'b3\n', 'served from cache until the watcher invalidates');
    ws.invalidate();
    assert.equal(await content(), 'b4\n');
    ws.close();
  });
});

describe('turn snapshots and private trees', () => {
  it("don't change the index, status, stash, reflogs, or user refs", async () => {
    const before = observableState();
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    await ws.indexTree();
    await ws.worktreeTree();
    await ws.createSnapshot(`refs/agent-diff/${ws.id}/snapshots/1`, 'turn snapshot');
    assert.deepEqual(observableState(), before);
  });

  it("don't write a reflog for snapshot refs", async () => {
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    await ws.createSnapshot(`refs/agent-diff/${ws.id}/snapshots/1`, 'turn snapshot');
    assert.equal(existsSync(path.join(repo.dir, '.git', 'logs', 'refs', 'agent-diff')), false);
  });

  it('capture staged, unstaged, and untracked content but not ignored files', async () => {
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    const { commit } = await ws.createSnapshot(`refs/agent-diff/${ws.id}/snapshots/1`, 'turn snapshot');
    const files = repo.git('ls-tree', '-r', '--name-only', commit).trim().split('\n');
    assert.deepEqual(files, ['.gitignore', 'a.txt', 'b.txt', 'c.txt', 'new.txt']);
    assert.equal(repo.git('show', `${commit}:a.txt`), 'a2\n');
    assert.equal(repo.git('show', `${commit}:b.txt`), 'b2\n');
    assert.equal(repo.git('rev-parse', `${commit}^`).trim(), repo.git('rev-parse', 'HEAD').trim());
  });

  it('work while the agent holds the index lock', async () => {
    const lock = path.join(repo.dir, '.git', 'index.lock');
    writeFileSync(lock, '');
    const ws = await GitWorkspace.open(repo.dir, repo.dataDir);
    await ws.createSnapshot(`refs/agent-diff/${ws.id}/snapshots/1`, 'turn snapshot');
    await ws.indexTree();
    assert.equal(readFileSync(lock, 'utf8'), '', 'the lock file is left alone');
  });

  it('work in a linked worktree', async () => {
    const linked = path.join(path.dirname(repo.dir), 'linked');
    repo.git('worktree', 'add', '-q', linked, '-b', 'sub-agent', 'main');
    writeFileSync(path.join(linked, 'a.txt'), 'from sub-agent\n');
    const ws = await GitWorkspace.open(linked, repo.dataDir);
    assert.deepEqual(await filesFor(ws, 'all'), ['modified a.txt']);
    const { commit } = await ws.createSnapshot(`refs/agent-diff/${ws.id}/snapshots/1`, 'turn snapshot');
    assert.equal(repo.git('show', `${commit}:a.txt`), 'from sub-agent\n');
    assert.match(repo.git('for-each-ref', `refs/agent-diff/${ws.id}/`), new RegExp(commit));
  });
});

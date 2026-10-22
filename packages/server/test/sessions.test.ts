// The `session` procedures, called through the API as the CLI calls them.
import assert from 'node:assert/strict';
import {
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { ORPCError } from '@orpc/client';
import { statePaths } from '@agent-diff/shared/state';
import {
  client,
  git,
  makeRepo,
  start,
  tempDir,
  tempStateHome,
} from './helpers.ts';

const isoTimestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

async function rejects(
  call: Promise<unknown>,
  code: string,
  message: string,
): Promise<void> {
  await assert.rejects(call, (error) => {
    assert.ok(error instanceof ORPCError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
}

// A review server, its API, and a repo with a commit on main and the branch
// feature checked out.
async function setUp(t: TestContext) {
  const env = tempStateHome(t);
  const server = await start(t, { env });
  const repo = makeRepo(t, env);
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  return { env, server, api: client(server), repo };
}

function workingDirectoryRows(env: NodeJS.ProcessEnv, t: TestContext) {
  const db = new DatabaseSync(statePaths(env).database, { readOnly: true });
  t.after(() => db.close());
  return db
    .prepare('SELECT path FROM working_directories ORDER BY path')
    .all()
    .map((row) => row.path);
}

test('session new creates a session with its working directories and title', async (t) => {
  const { api, repo } = await setUp(t);
  const plain = tempDir(t);
  const session = await api.session.new({
    title: '  Check ',
    workingDirectories: [repo, plain],
  });
  assert.match(session.id, /^s_[0-9abcdefghjkmnpqrstvwxyz]{6}$/);
  assert.equal(session.title, 'Check');
  assert.match(session.createdAt, isoTimestamp);
  assert.equal(session.archivedAt, null);
  assert.deepEqual(session.workingDirectories, [
    { path: repo, baseRef: 'main' },
    { path: plain, baseRef: null },
  ]);
  assert.deepEqual(await api.session.show({ id: session.id }), {
    ...session,
    workingDirectories: [
      { path: repo, baseRef: 'main', missing: false },
      { path: plain, baseRef: null, missing: false },
    ],
  });
});

test('session new works without a title', async (t) => {
  const { api, repo } = await setUp(t);
  const session = await api.session.new({ workingDirectories: [repo] });
  assert.equal(session.title, null);
});

test('session new uses --base for every working directory that uses git, and ignores it for others', async (t) => {
  const { env, api, repo } = await setUp(t);
  const other = makeRepo(t, env);
  const inside = path.join(other, 'packages', 'one');
  mkdirSync(inside, { recursive: true });
  const plain = tempDir(t);
  const session = await api.session.new({
    base: 'HEAD',
    workingDirectories: [repo, inside, plain],
  });
  assert.deepEqual(session.workingDirectories, [
    { path: repo, baseRef: 'HEAD' },
    { path: inside, baseRef: 'HEAD' },
    { path: plain, baseRef: null },
  ]);
});

test('session new stores the base ref as the ref name, not a commit', async (t) => {
  const { api, repo } = await setUp(t);
  const session = await api.session.new({
    base: 'main',
    workingDirectories: [repo],
  });
  assert.equal(session.workingDirectories[0]!.baseRef, 'main');
});

test('session new fails, adding nothing, when --base does not resolve to a commit in a git working directory', async (t) => {
  const { env, api, repo } = await setUp(t);
  const other = makeRepo(t, env);
  git(env, repo, 'branch', 'only-here');
  await rejects(
    api.session.new({
      base: 'only-here',
      workingDirectories: [repo, other],
    }),
    'BAD_REQUEST',
    `The base ref only-here doesn't resolve to a commit in ${other}.`,
  );
  assert.deepEqual(await api.session.list({ all: true }), []);
  assert.deepEqual(workingDirectoryRows(env, t), []);
});

test('session new fails, adding nothing, when a path does not exist or is not a directory', async (t) => {
  const { env, api, repo } = await setUp(t);
  const missing = path.join(tempDir(t), 'missing');
  const file = path.join(tempDir(t), 'file.txt');
  writeFileSync(file, 'text');
  const underFile = path.join(file, 'child');
  for (const [given, message] of [
    [missing, `The working directory ${missing} doesn't exist.`],
    [underFile, `The working directory ${underFile} doesn't exist.`],
    [file, `The working directory ${file} isn't a directory.`],
  ]) {
    await rejects(
      api.session.new({ workingDirectories: [repo, given!] }),
      'BAD_REQUEST',
      message!,
    );
  }
  await rejects(
    api.session.new({ workingDirectories: [missing, file] }),
    'BAD_REQUEST',
    `The working directory ${missing} doesn't exist. The working directory ${file} isn't a directory.`,
  );
  assert.deepEqual(await api.session.list({ all: true }), []);
  assert.deepEqual(workingDirectoryRows(env, t), []);
});

test('session new rejects relative paths, no working directories, and bad titles', async (t) => {
  const { api } = await setUp(t);
  await rejects(
    api.session.new({ workingDirectories: ['relative'] }),
    'BAD_REQUEST',
    "The working directory relative isn't an absolute path.",
  );
  await rejects(
    api.session.new({ workingDirectories: [] }),
    'BAD_REQUEST',
    'Give at least one working directory.',
  );
  await rejects(
    api.session.new({ title: ' ', workingDirectories: ['/'] }),
    'BAD_REQUEST',
    'The title must not be empty.',
  );
  await rejects(
    api.session.new({ title: 'T'.repeat(201), workingDirectories: ['/'] }),
    'BAD_REQUEST',
    'The title must be at most 200 characters.',
  );
  assert.deepEqual(await api.session.list({ all: true }), []);
});

test('a working directory is stored by its real path, so a symlink to it is the same working directory', async (t) => {
  const { env, api, repo } = await setUp(t);
  const link = path.join(tempDir(t), 'link');
  symlinkSync(repo, link);
  const session = await api.session.new({ workingDirectories: [link, repo] });
  assert.deepEqual(session.workingDirectories, [
    { path: repo, baseRef: 'main' },
  ]);
  const other = await api.session.new({ workingDirectories: [link] });
  assert.deepEqual(other.workingDirectories, [{ path: repo, baseRef: 'main' }]);
  assert.deepEqual(workingDirectoryRows(env, t), [repo]);
});

test('a path given twice in one command is added once', async (t) => {
  const { api, repo } = await setUp(t);
  const session = await api.session.new({
    workingDirectories: [repo, `${repo}/`, repo],
  });
  assert.deepEqual(session.workingDirectories, [
    { path: repo, baseRef: 'main' },
  ]);
  const added = await api.session.add({
    id: session.id,
    workingDirectories: [repo, repo],
  });
  assert.deepEqual(added.workingDirectories, [
    { path: repo, baseRef: 'main', alreadyInSession: true },
  ]);
});

test('the same working directory can have different base refs in two sessions', async (t) => {
  const { api, repo } = await setUp(t);
  const first = await api.session.new({ workingDirectories: [repo] });
  const second = await api.session.new({
    base: 'HEAD',
    workingDirectories: [repo],
  });
  assert.equal(
    (await api.session.show({ id: first.id })).workingDirectories[0]!.baseRef,
    'main',
  );
  assert.equal(
    (await api.session.show({ id: second.id })).workingDirectories[0]!.baseRef,
    'HEAD',
  );
});

test('session add adds working directories, and keeps the ones already in the session as they are', async (t) => {
  const { api, repo } = await setUp(t);
  const plain = tempDir(t);
  const third = tempDir(t);
  const session = await api.session.new({ workingDirectories: [repo, plain] });
  const added = await api.session.add({
    id: session.id,
    base: 'HEAD',
    workingDirectories: [repo, third],
  });
  assert.deepEqual(added.workingDirectories, [
    { path: repo, baseRef: 'main', alreadyInSession: true },
    { path: third, baseRef: null, alreadyInSession: false },
  ]);
  assert.deepEqual(
    (await api.session.show({ id: session.id })).workingDirectories,
    [
      { path: repo, baseRef: 'main', missing: false },
      { path: plain, baseRef: null, missing: false },
      { path: third, baseRef: null, missing: false },
    ],
  );
});

test('session add only checks --base in the working directories it adds', async (t) => {
  const { env, api, repo } = await setUp(t);
  const other = makeRepo(t, env);
  git(env, other, 'branch', 'only-here');
  const session = await api.session.new({ workingDirectories: [repo] });
  const added = await api.session.add({
    id: session.id,
    base: 'only-here',
    workingDirectories: [repo, other],
  });
  assert.deepEqual(added.workingDirectories, [
    { path: repo, baseRef: 'main', alreadyInSession: true },
    { path: other, baseRef: 'only-here', alreadyInSession: false },
  ]);
});

test('session add fails, adding nothing, when a path or --base is bad', async (t) => {
  const { env, api, repo } = await setUp(t);
  const plain = tempDir(t);
  const other = makeRepo(t, env);
  const session = await api.session.new({ workingDirectories: [plain] });
  const missing = path.join(plain, 'missing');
  await rejects(
    api.session.add({ id: session.id, workingDirectories: [repo, missing] }),
    'BAD_REQUEST',
    `The working directory ${missing} doesn't exist.`,
  );
  await rejects(
    api.session.add({
      id: session.id,
      base: 'nope',
      workingDirectories: [repo, other],
    }),
    'BAD_REQUEST',
    `The base ref nope doesn't resolve to a commit in ${repo}. The base ref nope doesn't resolve to a commit in ${other}.`,
  );
  assert.deepEqual(
    (await api.session.show({ id: session.id })).workingDirectories,
    [{ path: plain, baseRef: null, missing: false }],
  );
});

test('session add fails on an archived session', async (t) => {
  const { api, repo } = await setUp(t);
  const plain = tempDir(t);
  const session = await api.session.new({ workingDirectories: [plain] });
  await api.session.archive({ id: session.id });
  await rejects(
    api.session.add({ id: session.id, workingDirectories: [repo] }),
    'CONFLICT',
    `Session ${session.id} is archived, so working directories can't be added to it.`,
  );
  assert.equal(
    (await api.session.show({ id: session.id })).workingDirectories.length,
    1,
  );
});

test('every procedure that takes an ID fails for an unknown or malformed ID', async (t) => {
  const { api, repo } = await setUp(t);
  for (const id of ['s_7kq9a1', 'nope', '']) {
    const message = `There's no session ${id}.`;
    await rejects(api.session.show({ id }), 'NOT_FOUND', message);
    await rejects(
      api.session.add({ id, workingDirectories: [repo] }),
      'NOT_FOUND',
      message,
    );
    await rejects(api.session.archive({ id }), 'NOT_FOUND', message);
    await rejects(api.session.delete({ id }), 'NOT_FOUND', message);
  }
});

test('session show says when a working directory no longer exists on disk', async (t) => {
  const { api, repo } = await setUp(t);
  const gone = tempDir(t);
  const moved = tempDir(t);
  const session = await api.session.new({
    workingDirectories: [repo, gone, moved],
  });
  rmSync(gone, { recursive: true });
  renameSync(moved, `${moved}-elsewhere`);
  writeFileSync(moved, 'now a file');
  t.after(() => rmSync(`${moved}-elsewhere`, { recursive: true, force: true }));
  assert.deepEqual(
    (await api.session.show({ id: session.id })).workingDirectories,
    [
      { path: repo, baseRef: 'main', missing: false },
      { path: gone, baseRef: null, missing: true },
      { path: moved, baseRef: null, missing: true },
    ],
  );
});

test('session list lists active sessions newest first, and all sessions with all', async (t) => {
  const { api, repo } = await setUp(t);
  const plain = tempDir(t);
  const first = await api.session.new({
    title: 'First',
    workingDirectories: [repo],
  });
  const second = await api.session.new({ workingDirectories: [plain, repo] });
  const third = await api.session.new({ workingDirectories: [plain] });
  await api.session.archive({ id: second.id });
  const archived = await api.session.show({ id: second.id });

  assert.deepEqual(await api.session.list({}), [third, first]);
  assert.deepEqual(await api.session.list({ all: true }), [
    third,
    {
      ...second,
      archivedAt: archived.archivedAt,
    },
    first,
  ]);
});

test('session archive makes a session read-only, and succeeds when it is already archived', async (t) => {
  const { api, repo } = await setUp(t);
  const session = await api.session.new({ workingDirectories: [repo] });
  const archived = await api.session.archive({ id: session.id });
  assert.equal(archived.alreadyArchived, false);
  assert.match(archived.archivedAt, isoTimestamp);
  assert.equal(
    (await api.session.show({ id: session.id })).archivedAt,
    archived.archivedAt,
  );
  assert.deepEqual(await api.session.archive({ id: session.id }), {
    archivedAt: archived.archivedAt,
    alreadyArchived: true,
  });
});

test('session delete deletes the session and the working directories left in no session', async (t) => {
  const { env, api, repo } = await setUp(t);
  const plain = tempDir(t);
  const first = await api.session.new({ workingDirectories: [repo, plain] });
  const second = await api.session.new({ workingDirectories: [repo] });
  await api.session.delete({ id: first.id });
  await rejects(
    api.session.show({ id: first.id }),
    'NOT_FOUND',
    `There's no session ${first.id}.`,
  );
  assert.deepEqual(await api.session.list({ all: true }), [second]);
  assert.deepEqual(workingDirectoryRows(env, t), [repo]);
});

test('an archived session can be deleted', async (t) => {
  const { api, repo } = await setUp(t);
  const session = await api.session.new({ workingDirectories: [repo] });
  await api.session.archive({ id: session.id });
  await api.session.delete({ id: session.id });
  assert.deepEqual(await api.session.list({ all: true }), []);
});

test('sessions survive a restart', async (t) => {
  const { env, server, api, repo } = await setUp(t);
  const session = await api.session.new({ workingDirectories: [repo] });
  await server.close();
  const restarted = await start(t, { env });
  assert.deepEqual(await client(restarted).session.list({}), [session]);
});

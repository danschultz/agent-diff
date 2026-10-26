// The `diff` procedures, called through the API as the review UI calls them,
// on repos the tests set up with git.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  lutimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { ORPCError } from '@orpc/client';
import type { ChangedFile } from '@agent-diff/shared/schemas';
import {
  client,
  commit,
  git,
  makeRepo,
  start,
  tempDir,
  tempStateHome,
} from './helpers.ts';

async function rejects(
  call: Promise<unknown>,
  code: string,
  message: string | RegExp,
): Promise<void> {
  await assert.rejects(call, (error) => {
    assert.ok(error instanceof ORPCError, String(error));
    assert.equal(error.code, code);
    if (typeof message === 'string') assert.equal(error.message, message);
    else assert.match(error.message, message);
    return true;
  });
}

async function setUp(t: TestContext, env = tempStateHome(t)) {
  const server = await start(t, { env });
  return { env, api: client(server) };
}

function write(dir: string, file: string, contents: string | Buffer): void {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), contents);
}

function commitAll(env: NodeJS.ProcessEnv, dir: string): void {
  git(env, dir, 'add', '--all');
  commit(env, dir);
}

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i}\n`).join('');
}

// Every file under dir, with a hash of its contents and its modification
// time, so a test can tell nothing in it was written.
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    const file = path.join(entry.parentPath, entry.name);
    const stat = statSync(file);
    const contents = entry.isFile()
      ? createHash('sha256').update(readFileSync(file)).digest('hex')
      : '';
    files.set(path.relative(dir, file), `${contents} ${stat.mtimeMs}`);
  }
  return files;
}

// A repo with a commit on main, and the branch feature checked out, with one
// change committed, one staged, one unstaged, one untracked, one renamed,
// one deleted, and one binary file changed.
function makeFeatureRepo(t: TestContext, env: NodeJS.ProcessEnv): string {
  const repo = makeRepo(t, env, { commits: 0 });
  write(repo, 'committed.txt', 'one\ntwo\nthree\n');
  write(repo, 'staged.txt', 'a\n');
  write(repo, 'unstaged.txt', 'x\ny\n');
  write(repo, 'renamed-old.txt', lines(10));
  write(repo, 'deleted.txt', 'gone\n');
  write(repo, 'image.bin', Buffer.from([1, 0, 2, 3]));
  write(repo, 'unchanged.txt', 'same\n');
  commitAll(env, repo);
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  write(repo, 'committed.txt', 'one\nTWO\nthree\n');
  commitAll(env, repo);
  write(repo, 'staged.txt', 'a\nb\n');
  git(env, repo, 'add', 'staged.txt');
  write(repo, 'unstaged.txt', 'x\n');
  write(repo, 'new.txt', '1\n2\n3\n');
  git(env, repo, 'mv', 'renamed-old.txt', 'renamed-new.txt');
  git(env, repo, 'rm', '--quiet', 'deleted.txt');
  write(repo, 'image.bin', Buffer.from([1, 0, 2, 4]));
  return repo;
}

const featureFiles: ChangedFile[] = [
  {
    path: 'committed.txt',
    oldPath: null,
    status: 'modified',
    added: 1,
    removed: 1,
  },
  {
    path: 'deleted.txt',
    oldPath: null,
    status: 'deleted',
    added: 0,
    removed: 1,
  },
  {
    path: 'image.bin',
    oldPath: null,
    status: 'modified',
    added: null,
    removed: null,
  },
  { path: 'new.txt', oldPath: null, status: 'untracked', added: 3, removed: 0 },
  {
    path: 'renamed-new.txt',
    oldPath: 'renamed-old.txt',
    status: 'renamed',
    added: 0,
    removed: 0,
  },
  {
    path: 'staged.txt',
    oldPath: null,
    status: 'modified',
    added: 1,
    removed: 0,
  },
  {
    path: 'unstaged.txt',
    oldPath: null,
    status: 'modified',
    added: 0,
    removed: 1,
  },
];

test('the file list has every change since the merge-base, as git reports it', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeFeatureRepo(t, env);
  const { id } = await api.session.new({ workingDirectories: [repo] });
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.deepEqual(workingDirectories, [
    {
      kind: 'git',
      path: repo,
      baseRef: 'main',
      mergeBase: git(env, repo, 'rev-parse', 'main'),
      files: featureFiles,
    },
  ]);
});

test('file contents are the merge-base side and the working tree side', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeFeatureRepo(t, env);
  const { id } = await api.session.new({ workingDirectories: [repo] });
  const contents = (file: string) =>
    api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: repo,
      path: file,
    });
  const text = (value: string) => ({ type: 'text', text: value });
  assert.deepEqual(await contents('committed.txt'), {
    old: text('one\ntwo\nthree\n'),
    new: text('one\nTWO\nthree\n'),
  });
  assert.deepEqual(await contents('staged.txt'), {
    old: text('a\n'),
    new: text('a\nb\n'),
  });
  assert.deepEqual(await contents('unstaged.txt'), {
    old: text('x\ny\n'),
    new: text('x\n'),
  });
  assert.deepEqual(await contents('new.txt'), {
    old: null,
    new: text('1\n2\n3\n'),
  });
  assert.deepEqual(await contents('renamed-new.txt'), {
    old: text(lines(10)),
    new: text(lines(10)),
  });
  assert.deepEqual(await contents('deleted.txt'), {
    old: text('gone\n'),
    new: null,
  });
  assert.deepEqual(await contents('image.bin'), {
    old: { type: 'binary' },
    new: { type: 'binary' },
  });
});

test('neither procedure writes anything under .git', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeFeatureRepo(t, env);
  const { id } = await api.session.new({ workingDirectories: [repo] });
  // Files whose modification times no longer match the index, which a
  // `git diff` that took optional locks would refresh and write.
  const later = new Date(Date.now() + 60_000);
  for (const file of ['committed.txt', 'staged.txt', 'unchanged.txt']) {
    utimesSync(path.join(repo, file), later, later);
  }
  const before = snapshot(path.join(repo, '.git'));
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.equal(workingDirectories[0]?.kind, 'git');
  for (const file of featureFiles) {
    await api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: repo,
      path: file.path,
    });
  }
  assert.deepEqual(snapshot(path.join(repo, '.git')), before);
});

test('files whose modification time changed but not their contents are not listed', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeRepo(t, env, { commits: 0 });
  write(repo, 'text.txt', 'text\n');
  write(repo, 'binary.bin', Buffer.from([1, 0, 2]));
  write(repo, 'changed.bin', Buffer.from([1, 0, 2]));
  symlinkSync('text.txt', path.join(repo, 'link'));
  commitAll(env, repo);
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  write(repo, 'changed.bin', Buffer.from([1, 0, 3]));
  const later = new Date(Date.now() + 60_000);
  for (const file of ['text.txt', 'binary.bin', 'changed.bin', 'link']) {
    lutimesSync(path.join(repo, file), later, later);
  }
  const { id } = await api.session.new({ workingDirectories: [repo] });
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.deepEqual(
    workingDirectories[0]?.kind === 'git' && workingDirectories[0].files,
    [
      {
        path: 'changed.bin',
        oldPath: null,
        status: 'modified',
        added: null,
        removed: null,
      },
    ],
  );
  const contents = (file: string) =>
    api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: repo,
      path: file,
    });
  for (const file of ['text.txt', 'binary.bin', 'link']) {
    await rejects(
      contents(file),
      'NOT_FOUND',
      `${file} isn't in the file list for ${repo}.`,
    );
  }
  assert.deepEqual(await contents('changed.bin'), {
    old: { type: 'binary' },
    new: { type: 'binary' },
  });
});

// Counting lines reads every changed file, which would make scrolling
// through a diff of n files read n² files.
test("a file's contents are found without counting every changed file's lines", async (t) => {
  const logging = loggingGit(t, tempStateHome(t));
  const { api } = await setUp(t, logging.env);
  const repo = makeFeatureRepo(t, logging.env);
  const { id } = await api.session.new({ workingDirectories: [repo] });
  const before = logging.commands().length;
  for (const file of ['committed.txt', 'new.txt']) {
    await api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: repo,
      path: file,
    });
  }
  const commands = logging.commands().slice(before);
  assert.ok(commands.some((line) => line.includes(' diff-index ')));
  for (const line of commands) {
    assert.doesNotMatch(line, /--numstat/);
    // Untracked files are only listed for the path asked for.
    if (line.includes(' ls-files ')) assert.match(line, / -- new\.txt$/);
  }
});

test('changes that landed on the base ref after the branch started are not shown', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeRepo(t, env, { commits: 0 });
  write(repo, 'a.txt', 'a\n');
  commitAll(env, repo);
  const branchPoint = git(env, repo, 'rev-parse', 'HEAD');
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  write(repo, 'b.txt', 'b\n');
  commitAll(env, repo);
  git(env, repo, 'switch', '--quiet', 'main');
  write(repo, 'a.txt', 'a changed on main\n');
  write(repo, 'c.txt', 'c\n');
  commitAll(env, repo);
  git(env, repo, 'switch', '--quiet', 'feature');

  const { id } = await api.session.new({ workingDirectories: [repo] });
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.deepEqual(workingDirectories, [
    {
      kind: 'git',
      path: repo,
      baseRef: 'main',
      mergeBase: branchPoint,
      files: [
        { path: 'b.txt', oldPath: null, status: 'added', added: 1, removed: 0 },
      ],
    },
  ]);
});

test("with no merge-base, the diff compares from the base ref's commit", async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeRepo(t, env, { commits: 0 });
  write(repo, 'a.txt', 'a\n');
  commitAll(env, repo);
  git(env, repo, 'switch', '--quiet', '--orphan', 'other');
  write(repo, 'a.txt', 'other a\n');
  write(repo, 'b.txt', 'b\n');
  commitAll(env, repo);
  const other = git(env, repo, 'rev-parse', 'HEAD');
  git(env, repo, 'switch', '--quiet', 'main');

  const { id } = await api.session.new({
    base: 'other',
    workingDirectories: [repo],
  });
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.deepEqual(workingDirectories, [
    {
      kind: 'git',
      path: repo,
      baseRef: 'other',
      mergeBase: other,
      files: [
        {
          path: 'a.txt',
          oldPath: null,
          status: 'modified',
          added: 1,
          removed: 1,
        },
        {
          path: 'b.txt',
          oldPath: null,
          status: 'deleted',
          added: 0,
          removed: 1,
        },
      ],
    },
  ]);
});

test('with an unborn HEAD, the diff compares from the empty tree', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeRepo(t, env, { commits: 0 });
  write(repo, 'staged.txt', 'staged\n');
  git(env, repo, 'add', 'staged.txt');
  write(repo, 'untracked.txt', 'one\ntwo\n');

  const { id } = await api.session.new({ workingDirectories: [repo] });
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.deepEqual(workingDirectories, [
    {
      kind: 'git',
      path: repo,
      baseRef: 'HEAD',
      mergeBase: null,
      files: [
        {
          path: 'staged.txt',
          oldPath: null,
          status: 'added',
          added: 1,
          removed: 0,
        },
        {
          path: 'untracked.txt',
          oldPath: null,
          status: 'untracked',
          added: 2,
          removed: 0,
        },
      ],
    },
  ]);
  assert.deepEqual(
    await api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: repo,
      path: 'staged.txt',
    }),
    { old: null, new: { type: 'text', text: 'staged\n' } },
  );
});

test("a base ref that doesn't resolve is that working directory's error only", async (t) => {
  const { env, api } = await setUp(t);
  const broken = makeRepo(t, env);
  git(env, broken, 'switch', '--quiet', '--create', 'feature');
  const working = makeFeatureRepo(t, env);
  const plain = tempDir(t);
  const { id } = await api.session.new({
    workingDirectories: [broken, working, plain],
  });
  git(env, broken, 'branch', '--quiet', '--delete', '--force', 'main');

  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.deepEqual(workingDirectories, [
    {
      kind: 'error',
      path: broken,
      baseRef: 'main',
      message: `The base ref main doesn't resolve to a commit in ${broken}.`,
    },
    {
      kind: 'git',
      path: working,
      baseRef: 'main',
      mergeBase: git(env, working, 'rev-parse', 'main'),
      files: featureFiles,
    },
    { kind: 'no_git', path: plain },
  ]);
  await rejects(
    api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: broken,
      path: 'a.txt',
    }),
    'NOT_FOUND',
    `The base ref main doesn't resolve to a commit in ${broken}.`,
  );
});

test('a working directory that no longer exists is missing', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeRepo(t, env);
  const plain = tempDir(t);
  const { id } = await api.session.new({ workingDirectories: [repo, plain] });
  rmSync(repo, { recursive: true });
  rmSync(plain, { recursive: true });
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.deepEqual(workingDirectories, [
    { kind: 'missing', path: repo, baseRef: 'HEAD' },
    { kind: 'missing', path: plain, baseRef: null },
  ]);
});

test('a working directory inside a repo lists only its own files, relative to it', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeRepo(t, env, { commits: 0 });
  write(repo, 'outside.txt', 'outside\n');
  write(repo, 'packages/one/src/a.ts', 'a\n');
  write(repo, 'packages/one/moved.txt', lines(5));
  write(repo, 'packages/two/b.ts', 'b\n');
  commitAll(env, repo);
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  write(repo, 'outside.txt', 'changed\n');
  write(repo, 'packages/one/src/a.ts', 'a changed\n');
  write(repo, 'packages/one/new.ts', 'new\n');
  git(env, repo, 'mv', 'packages/one/moved.txt', 'packages/one/src/moved.txt');
  write(repo, 'packages/two/b.ts', 'b changed\n');
  write(repo, 'packages/two/new.ts', 'new\n');

  const one = path.join(repo, 'packages', 'one');
  const { id } = await api.session.new({ workingDirectories: [one] });
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.deepEqual(workingDirectories, [
    {
      kind: 'git',
      path: one,
      baseRef: 'main',
      mergeBase: git(env, repo, 'rev-parse', 'main'),
      files: [
        {
          path: 'new.ts',
          oldPath: null,
          status: 'untracked',
          added: 1,
          removed: 0,
        },
        {
          path: 'src/a.ts',
          oldPath: null,
          status: 'modified',
          added: 1,
          removed: 1,
        },
        {
          path: 'src/moved.txt',
          oldPath: 'moved.txt',
          status: 'renamed',
          added: 0,
          removed: 0,
        },
      ],
    },
  ]);
  const contents = (file: string) =>
    api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: one,
      path: file,
    });
  assert.deepEqual(await contents('src/a.ts'), {
    old: { type: 'text', text: 'a\n' },
    new: { type: 'text', text: 'a changed\n' },
  });
  assert.deepEqual(await contents('src/moved.txt'), {
    old: { type: 'text', text: lines(5) },
    new: { type: 'text', text: lines(5) },
  });
  // Changed, but outside the working directory.
  await rejects(
    contents('../two/b.ts'),
    'BAD_REQUEST',
    'The file path ../two/b.ts must not contain "..".',
  );
  await rejects(
    contents('packages/two/b.ts'),
    'NOT_FOUND',
    `packages/two/b.ts isn't in the file list for ${one}.`,
  );
});

test('contents are only returned for paths in the file list', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeFeatureRepo(t, env);
  const plain = tempDir(t);
  write(plain, 'a.txt', 'a\n');
  const { id } = await api.session.new({ workingDirectories: [repo, plain] });
  const contents = (workingDirectory: string, file: string) =>
    api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory,
      path: file,
    });

  for (const file of ['unchanged.txt', 'nothing.txt', '.git/config', '.git']) {
    await rejects(
      contents(repo, file),
      'NOT_FOUND',
      `${file} isn't in the file list for ${repo}.`,
    );
  }
  await rejects(
    contents(repo, path.join(repo, 'committed.txt')),
    'BAD_REQUEST',
    `The file path ${path.join(repo, 'committed.txt')} must be relative to its working directory.`,
  );
  await rejects(
    contents(repo, 'x/../committed.txt'),
    'BAD_REQUEST',
    'The file path x/../committed.txt must not contain "..".',
  );
  await rejects(
    contents(plain, 'a.txt'),
    'NOT_FOUND',
    `${plain} doesn't use git, so it has no file list.`,
  );
  const other = tempDir(t);
  await rejects(
    contents(other, 'a.txt'),
    'NOT_FOUND',
    `There's no working directory ${other} in session ${id}.`,
  );
  await rejects(
    api.diff.contents({
      sessionId: 's_zzzzzz',
      mode: 'all',
      workingDirectory: repo,
      path: 'committed.txt',
    }),
    'NOT_FOUND',
    "There's no session s_zzzzzz.",
  );
  await rejects(
    api.diff.files({ sessionId: 's_zzzzzz', mode: 'all' }),
    'NOT_FOUND',
    "There's no session s_zzzzzz.",
  );
});

test('a symlink is never followed, and its contents are its target', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeRepo(t, env, { commits: 0 });
  const outside = tempDir(t);
  write(outside, 'secret.txt', 'secret\n');
  symlinkSync('a.txt', path.join(repo, 'tracked-link'));
  write(repo, 'a.txt', 'a\n');
  commitAll(env, repo);
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  const target = path.join(outside, 'secret.txt');
  symlinkSync(target, path.join(repo, 'untracked-link'));
  unlinkSync(path.join(repo, 'tracked-link'));
  symlinkSync(target, path.join(repo, 'tracked-link'));

  const { id } = await api.session.new({ workingDirectories: [repo] });
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  assert.deepEqual(
    workingDirectories[0]?.kind === 'git' && workingDirectories[0].files,
    [
      {
        path: 'tracked-link',
        oldPath: null,
        status: 'modified',
        added: 1,
        removed: 1,
      },
      {
        path: 'untracked-link',
        oldPath: null,
        status: 'untracked',
        added: 1,
        removed: 0,
      },
    ],
  );
  const contents = (file: string) =>
    api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: repo,
      path: file,
    });
  assert.deepEqual(await contents('tracked-link'), {
    old: { type: 'text', text: 'a.txt' },
    new: { type: 'text', text: target },
  });
  assert.deepEqual(await contents('untracked-link'), {
    old: null,
    new: { type: 'text', text: target },
  });
});

test('binary sides, sides over 2 MB, and submodules have no contents', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeRepo(t, env, { commits: 0 });
  // Text up to its 8,000th byte, then a NUL byte.
  const lateNul = Buffer.concat([Buffer.alloc(7_999, 'a'), Buffer.from([0])]);
  const pastNul = Buffer.concat([Buffer.alloc(8_000, 'a'), Buffer.from([0])]);
  const large = lines(200_000); // About 2.2 MB.
  write(repo, 'late-nul.bin', 'text\n');
  write(repo, 'large.txt', large);
  write(repo, 'becomes-text.txt', Buffer.from([0, 1, 2]));
  commitAll(env, repo);
  const submodule = git(env, repo, 'rev-parse', 'HEAD');
  git(
    env,
    repo,
    'update-index',
    '--add',
    '--cacheinfo',
    `160000,${submodule},sub`,
  );
  commit(env, repo);
  git(env, repo, 'switch', '--quiet', '--create', 'feature');
  write(repo, 'late-nul.bin', lateNul);
  write(repo, 'large.txt', `${large}one more\n`);
  write(repo, 'becomes-text.txt', 'text\n');
  write(repo, 'untracked-nul.bin', pastNul);
  write(repo, 'untracked-large.txt', large);
  // A commit the submodule now points to, which needn't exist in it.
  git(env, repo, 'update-index', '--cacheinfo', `160000,${'1'.repeat(40)},sub`);
  // An uninitialized submodule is an empty directory.
  mkdirSync(path.join(repo, 'sub'));
  // An untracked repo inside the working directory.
  makeNestedRepo(env, repo, 'nested');

  const { id } = await api.session.new({ workingDirectories: [repo] });
  const { workingDirectories } = await api.diff.files({
    sessionId: id,
    mode: 'all',
  });
  const files =
    workingDirectories[0]?.kind === 'git' ? workingDirectories[0].files : [];
  const counts = Object.fromEntries(
    files.map((f) => [f.path, [f.status, f.added, f.removed]]),
  );
  assert.deepEqual(counts, {
    'becomes-text.txt': ['modified', null, null],
    'large.txt': ['modified', 1, 0],
    'late-nul.bin': ['modified', null, null],
    nested: ['untracked', null, null],
    sub: ['modified', 1, 1],
    'untracked-large.txt': ['untracked', 200_000, 0],
    // The NUL byte is past the first 8,000 bytes.
    'untracked-nul.bin': ['untracked', 1, 0],
  });
  const contents = (file: string) =>
    api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: repo,
      path: file,
    });
  assert.deepEqual(await contents('late-nul.bin'), {
    old: { type: 'text', text: 'text\n' },
    new: { type: 'binary' },
  });
  assert.deepEqual(await contents('becomes-text.txt'), {
    old: { type: 'binary' },
    new: { type: 'text', text: 'text\n' },
  });
  assert.deepEqual(await contents('large.txt'), {
    old: { type: 'too_large', size: Buffer.byteLength(large) },
    new: { type: 'too_large', size: Buffer.byteLength(large) + 9 },
  });
  assert.deepEqual(await contents('untracked-large.txt'), {
    old: null,
    new: { type: 'too_large', size: Buffer.byteLength(large) },
  });
  assert.deepEqual((await contents('untracked-nul.bin')).new?.type, 'text');
  assert.deepEqual(await contents('sub'), {
    old: { type: 'submodule' },
    new: { type: 'submodule' },
  });
  assert.deepEqual(await contents('nested'), {
    old: null,
    new: { type: 'submodule' },
  });
});

function makeNestedRepo(env: NodeJS.ProcessEnv, repo: string, name: string) {
  const nested = path.join(repo, name);
  mkdirSync(nested);
  git(env, nested, 'init', '--quiet');
  write(nested, 'inside.txt', 'inside\n');
  commitAll(env, nested);
}

test('both procedures reject diff modes other than All changes', async (t) => {
  const { env, api } = await setUp(t);
  const repo = makeFeatureRepo(t, env);
  const { id } = await api.session.new({ workingDirectories: [repo] });
  for (const mode of ['staged', 'committed', 'unstaged', 'last-turn']) {
    const message = `The diff mode "${mode}" isn't supported. Only all, for All changes, is.`;
    await rejects(
      api.diff.files({ sessionId: id, mode: mode as 'all' }),
      'BAD_REQUEST',
      message,
    );
    await rejects(
      api.diff.contents({
        sessionId: id,
        mode: mode as 'all',
        workingDirectory: repo,
        path: 'committed.txt',
      }),
      'BAD_REQUEST',
      message,
    );
  }
});

// A `git` ahead of the real one in PATH, which logs GIT_OPTIONAL_LOCKS and
// its arguments for every command, then runs the real git.
function loggingGit(t: TestContext, env: NodeJS.ProcessEnv) {
  const bin = tempDir(t);
  const log = path.join(bin, 'log');
  writeFileSync(log, '');
  writeFileSync(
    path.join(bin, 'git'),
    `#!/bin/sh\nprintf '%s %s\\n' "\${GIT_OPTIONAL_LOCKS-unset}" "$*" >> '${log}'\nPATH='${env.PATH}' exec git "$@"\n`,
  );
  chmodSync(path.join(bin, 'git'), 0o755);
  return {
    env: { ...env, PATH: `${bin}:${env.PATH}` },
    commands: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

test('every git command the review server runs sets GIT_OPTIONAL_LOCKS=0', async (t) => {
  const logging = loggingGit(t, tempStateHome(t));
  const { api } = await setUp(t, logging.env);
  const repo = makeFeatureRepo(t, logging.env);
  const nested = path.join(repo, 'nested');
  mkdirSync(nested);
  const { id } = await api.session.new({ workingDirectories: [repo, nested] });
  await api.session.add({ id, workingDirectories: [tempDir(t)] });
  await api.diff.files({ sessionId: id, mode: 'all' });
  for (const file of featureFiles) {
    await api.diff.contents({
      sessionId: id,
      mode: 'all',
      workingDirectory: repo,
      path: file.path,
    });
  }
  // The commands the test ran itself are logged too, before the review
  // server's, so look only at the review server's.
  const commands = logging.commands();
  const served = commands.slice(
    commands.findIndex((line) => line.endsWith(' rev-parse')),
  );
  assert.ok(served.length > 10, served.join('\n'));
  assert.ok(served.some((line) => line.includes(' diff-index ')));
  assert.ok(served.some((line) => line.includes(' cat-file ')));
  for (const line of served) assert.match(line, /^0 /);
});

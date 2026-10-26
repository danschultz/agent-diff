// Works out a working directory's All changes diff, from decision 0044: the
// merge-base of its base ref and HEAD, to the working tree. It only runs git
// commands that read, and git runs once per command for the whole working
// directory, never once per file.
//
// Tracked changes come from `git diff-index`, the plumbing that
// `git diff <merge-base>` runs. `git diff` itself refreshes the index and
// writes it whenever a file's modification time no longer matches it, even
// with GIT_OPTIONAL_LOCKS=0, and diff-index never does.
import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  ChangedFile,
  FileContents,
  FileSide,
  FileStatus,
  WorkingDirectory,
  WorkingDirectoryDiff,
} from '@agent-diff/shared/schemas';
import { readBlob, runGit } from './git.ts';
import { isDirectory } from './working-directories.ts';

// A side over this isn't sent, and keeps its line counts.
const maxSideBytes = 2 * 1024 * 1024;
// A side is binary when these first bytes have a NUL byte, as git decides.
const binaryCheckBytes = 8000;
// Untracked files read from disk at once, to count their lines.
const untrackedReads = 16;

const submoduleMode = '160000';
const symlinkMode = '120000';

// Why a file's contents can't be returned, such as a path that isn't in its
// working directory's file list.
export class FileContentsError extends Error {}

const statuses: Record<string, FileStatus> = {
  A: 'added',
  C: 'copied',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'type_changed',
  U: 'conflicted',
};

// A tracked file in `git diff --raw` output, with its line counts from
// `--numstat`.
interface TrackedChange {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  oldMode: string;
  newMode: string;
  // The old side's blob, or zeros when git didn't give one.
  oldObject: string;
  // The new side's blob, or zeros when the working tree's file doesn't
  // match the index's modification time, so git didn't hash it.
  newObject: string;
  // Whether `--numstat` listed the file. It leaves out text files whose
  // contents are the same on both sides.
  counted: boolean;
  added: number | null;
  removed: number | null;
}

// What a working directory's diff compares from, or why it has none.
type Base =
  | { kind: 'git'; mergeBase: string | null; from: string }
  | { kind: 'error'; message: string }
  | { kind: 'no_git' }
  | { kind: 'missing' };

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function gitError(dir: string, stderr: string): string {
  return stderr.trim() || `Git failed in ${dir}.`;
}

// The commit the diff compares from, from 0044: the merge-base of the base
// ref and HEAD, or the base ref's own commit when they have none. With an
// unborn HEAD it's the empty tree, and the merge-base is null.
async function base(
  dir: string,
  baseRef: string,
  env: NodeJS.ProcessEnv,
): Promise<{ mergeBase: string | null; from: string } | { error: string }> {
  const [head, baseCommit] = await Promise.all([
    runGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], env),
    runGit(
      dir,
      [
        'rev-parse',
        '--verify',
        '--quiet',
        '--end-of-options',
        `${baseRef}^{commit}`,
      ],
      env,
    ),
  ]);
  // `--quiet` exits with 1, and prints nothing, when HEAD is unborn.
  if (head.code === 1 && head.stderr === '') {
    // Without `-w`, hash-object writes nothing.
    const emptyTree = await runGit(
      dir,
      ['hash-object', '-t', 'tree', '/dev/null'],
      env,
    );
    if (emptyTree.code !== 0) return { error: gitError(dir, emptyTree.stderr) };
    return { mergeBase: null, from: emptyTree.stdout.trim() };
  }
  if (head.code !== 0) return { error: gitError(dir, head.stderr) };
  if (baseCommit.code !== 0) {
    return {
      error: `The base ref ${baseRef} doesn't resolve to a commit in ${dir}.`,
    };
  }
  const mergeBase = await runGit(
    dir,
    ['merge-base', baseCommit.stdout.trim(), head.stdout.trim()],
    env,
  );
  // merge-base exits with 1 when the commits have none.
  if (mergeBase.code === 1 && mergeBase.stderr === '') {
    const commit = baseCommit.stdout.trim();
    return { mergeBase: commit, from: commit };
  }
  if (mergeBase.code !== 0) return { error: gitError(dir, mergeBase.stderr) };
  const commit = mergeBase.stdout.trim();
  return { mergeBase: commit, from: commit };
}

// Parses `git diff --raw --numstat -z`: every file's raw entry, then every
// file's line counts.
function parseDiff(output: string): TrackedChange[] {
  const fields = output.split('\0');
  const changes = new Map<string, TrackedChange>();
  const counts = new Map<string, [number | null, number | null]>();
  let i = 0;
  while (i < fields.length) {
    const field = fields[i++]!;
    if (field === '') continue;
    if (field.startsWith(':')) {
      // `:<old mode> <new mode> <old object> <new object> <status>`
      const [oldMode, newMode, oldObject, newObject, code] = field
        .slice(1)
        .split(' ');
      const letter = code![0]!;
      const oldPath = letter === 'R' || letter === 'C' ? fields[i++]! : null;
      const path = fields[i++]!;
      // An unmerged path can be listed more than once.
      if (changes.has(path)) continue;
      changes.set(path, {
        path,
        oldPath,
        status: statuses[letter] ?? 'modified',
        oldMode: oldMode!,
        newMode: newMode!,
        oldObject: oldObject!,
        newObject: newObject!,
        counted: false,
        added: null,
        removed: null,
      });
    } else {
      // `<added>\t<removed>\t<path>`, or with an empty path followed by the
      // old and new paths of a rename. Binary files have `-` for both.
      const first = field.indexOf('\t');
      const second = field.indexOf('\t', first + 1);
      const added = field.slice(0, first);
      const removed = field.slice(first + 1, second);
      let path = field.slice(second + 1);
      if (path === '') {
        i++;
        path = fields[i++]!;
      }
      counts.set(
        path,
        added === '-' ? [null, null] : [Number(added), Number(removed)],
      );
    }
  }
  for (const [path, [added, removed]] of counts) {
    const change = changes.get(path);
    if (change) Object.assign(change, { counted: true, added, removed });
  }
  return [...changes.values()];
}

async function diffBase(
  workingDirectory: WorkingDirectory,
  env: NodeJS.ProcessEnv,
): Promise<Base> {
  const { path: dir, baseRef } = workingDirectory;
  if (!(await isDirectory(dir))) return { kind: 'missing' };
  if (baseRef === null) return { kind: 'no_git' };
  const sides = await base(dir, baseRef, env);
  if ('error' in sides) return { kind: 'error', message: sides.error };
  return { kind: 'git', ...sides };
}

// The tracked files that differ between from and the working tree, with
// their line counts when numstat is set. Git runs in the working directory,
// and `--relative` limits a working directory inside a repo to its own
// files, with paths relative to it. Without `--numstat`, git compares files
// by their modification times, and reads no contents except to find renames.
async function trackedChanges(
  dir: string,
  from: string,
  numstat: boolean,
  env: NodeJS.ProcessEnv,
): Promise<TrackedChange[] | { error: string }> {
  const diff = await runGit(
    dir,
    [
      'diff-index',
      '--raw',
      ...(numstat ? ['--numstat'] : []),
      '-z',
      '-M',
      '--no-abbrev',
      '--relative',
      from,
      '--',
    ],
    env,
  );
  if (diff.code !== 0) return { error: gitError(dir, diff.stderr) };
  return parseDiff(diff.stdout);
}

const noObject = /^0+$/;

// diff-index lists every file whose modification time no longer matches the
// index as modified, as `git diff` would before refreshing the index, with
// no new object. These are the ones that may have the same contents as the
// old side.
function maybeUnchanged(change: TrackedChange): boolean {
  return (
    change.status === 'modified' &&
    change.oldMode === change.newMode &&
    change.oldMode !== submoduleMode &&
    noObject.test(change.newObject)
  );
}

// Whether a file in the working tree has the same contents as its old side,
// hashed as git would store it, through its filters. A symlink is hashed as
// its target. `git hash-object` without `-w` writes nothing.
async function sameAsOldSide(
  dir: string,
  change: TrackedChange,
  env: NodeJS.ProcessEnv,
): Promise<boolean | { error: string }> {
  const hashed =
    change.oldMode === symlinkMode
      ? await runGit(
          dir,
          ['hash-object', '--stdin'],
          env,
          await readlink(path.join(dir, change.path)),
        )
      : await runGit(dir, ['hash-object', '--', change.path], env);
  if (hashed.code !== 0) return { error: gitError(dir, hashed.stderr) };
  return hashed.stdout.trim() === change.oldObject;
}

// Leaves out the files whose modification time changed but not their
// contents, as `git diff` does: text files `--numstat` didn't list, and
// binary files whose contents hash to the old side's object.
async function withoutUnchanged(
  dir: string,
  changes: TrackedChange[],
  env: NodeJS.ProcessEnv,
): Promise<TrackedChange[] | { error: string }> {
  const binary = changes.filter(
    (change) =>
      maybeUnchanged(change) && change.counted && change.added === null,
  );
  const unchangedBinary = new Set<TrackedChange>();
  if (binary.length > 0) {
    const hashed = await runGit(
      dir,
      ['hash-object', '--stdin-paths'],
      env,
      binary.map((change) => `${change.path}\n`).join(''),
    );
    if (hashed.code !== 0) return { error: gitError(dir, hashed.stderr) };
    const objects = hashed.stdout.split('\n');
    binary.forEach((change, i) => {
      if (objects[i] === change.oldObject) unchangedBinary.add(change);
    });
  }
  return changes.filter(
    (change) =>
      !(maybeUnchanged(change) && !change.counted) &&
      !unchangedBinary.has(change),
  );
}

function isBinary(data: Buffer): boolean {
  return data.subarray(0, binaryCheckBytes).includes(0);
}

function countLines(data: Buffer): number {
  let lines = 0;
  for (let i = data.indexOf(0x0a); i !== -1; i = data.indexOf(0x0a, i + 1)) {
    lines++;
  }
  return data.length > 0 && data[data.length - 1] !== 0x0a ? lines + 1 : lines;
}

// An untracked file in the file list, with its lines counted from disk, or
// null when it's gone since git listed it.
async function untrackedFile(
  dir: string,
  listed: string,
): Promise<ChangedFile | null> {
  const file = { oldPath: null, status: 'untracked' as const };
  // A repo inside the working directory, which has no lines.
  if (listed.endsWith('/')) {
    return { ...file, path: listed.slice(0, -1), added: null, removed: null };
  }
  try {
    const full = path.join(dir, listed);
    // A symlink's contents are its target, which is one line.
    if ((await lstat(full)).isSymbolicLink()) {
      return { ...file, path: listed, added: 1, removed: 0 };
    }
    const data = await readFile(full);
    const added = isBinary(data) ? null : countLines(data);
    return { ...file, path: listed, added, removed: added === null ? null : 0 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// A working directory's file list for All changes, or why it has none.
export async function workingDirectoryDiff(
  workingDirectory: WorkingDirectory,
  env: NodeJS.ProcessEnv,
): Promise<WorkingDirectoryDiff> {
  const { path: dir, baseRef } = workingDirectory;
  const sides = await diffBase(workingDirectory, env);
  if (sides.kind === 'missing') return { kind: 'missing', path: dir, baseRef };
  if (sides.kind === 'no_git' || baseRef === null) {
    return { kind: 'no_git', path: dir };
  }
  const error = (message: string) =>
    ({ kind: 'error', path: dir, baseRef, message }) as const;
  if (sides.kind === 'error') return error(sides.message);
  const [changes, others] = await Promise.all([
    trackedChanges(dir, sides.from, true, env),
    runGit(dir, ['ls-files', '-z', '--others', '--exclude-standard'], env),
  ]);
  if ('error' in changes) return error(changes.error);
  if (others.code !== 0) return error(gitError(dir, others.stderr));
  const tracked = await withoutUnchanged(dir, changes, env);
  if ('error' in tracked) return error(tracked.error);
  // A repo inside the working directory ends with `/`.
  const untracked = await mapLimit(
    others.stdout.split('\0').filter(Boolean),
    untrackedReads,
    (file) => untrackedFile(dir, file),
  );
  const files: ChangedFile[] = [
    ...tracked.map(({ path, oldPath, status, added, removed }) => ({
      path,
      oldPath,
      status,
      added,
      removed,
    })),
    ...untracked.filter((file) => file !== null),
  ];
  return {
    kind: 'git',
    path: dir,
    baseRef,
    mergeBase: sides.mergeBase,
    files: files.sort(byPath),
  };
}

function sideFromData(data: Buffer): FileSide {
  return isBinary(data)
    ? { type: 'binary' }
    : { type: 'text', text: data.toString('utf8') };
}

// The working tree side of a file, from disk, never following a symlink.
async function diskSide(file: string): Promise<FileSide | null> {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink())
      return { type: 'text', text: await readlink(file) };
    if (stat.isDirectory()) return { type: 'submodule' };
    if (stat.size > maxSideBytes) return { type: 'too_large', size: stat.size };
    return sideFromData(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

// The merge-base side of a file, from git's objects. A symlink's blob is its
// target.
async function objectSide(
  dir: string,
  object: string,
  env: NodeJS.ProcessEnv,
): Promise<FileSide | null> {
  const blob = await readBlob(dir, object, maxSideBytes, env);
  if (blob === null) return null;
  if (blob.data === null) return { type: 'too_large', size: blob.size };
  return sideFromData(blob.data);
}

// Whether git lists file as untracked, without listing every untracked file.
async function isUntracked(
  dir: string,
  file: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean | { error: string }> {
  const others = await runGit(
    dir,
    [
      '--literal-pathspecs',
      'ls-files',
      '-z',
      '--others',
      '--exclude-standard',
      '--',
      file,
    ],
    env,
  );
  if (others.code !== 0) return { error: gitError(dir, others.stderr) };
  // A repo inside the working directory ends with `/`.
  return others.stdout
    .split('\0')
    .some((listed) => listed === file || listed === `${file}/`);
}

// The old and new sides of a file in a working directory's All changes file
// list. Throws a FileContentsError when the path isn't in the list. It finds
// the file as the file list does, but without counting lines, which reads
// every changed file, so a request for one file doesn't grow with the
// number of changed files.
export async function fileContents(
  workingDirectory: WorkingDirectory,
  file: string,
  env: NodeJS.ProcessEnv,
): Promise<FileContents> {
  const { path: dir } = workingDirectory;
  const sides = await diffBase(workingDirectory, env);
  if (sides.kind === 'missing') {
    throw new FileContentsError(`The working directory ${dir} doesn't exist.`);
  }
  if (sides.kind === 'no_git') {
    throw new FileContentsError(
      `${dir} doesn't use git, so it has no file list.`,
    );
  }
  if (sides.kind === 'error') throw new FileContentsError(sides.message);
  const changes = await trackedChanges(dir, sides.from, false, env);
  if ('error' in changes) throw new FileContentsError(changes.error);
  const notListed = new FileContentsError(
    `${file} isn't in the file list for ${dir}.`,
  );

  const full = path.join(dir, file);
  const tracked = changes.find((change) => change.path === file);
  if (tracked && maybeUnchanged(tracked)) {
    const same = await sameAsOldSide(dir, tracked, env);
    if (typeof same !== 'boolean') throw new FileContentsError(same.error);
    if (same) throw notListed;
  }
  if (tracked) {
    const oldSide = async (): Promise<FileSide | null> => {
      if (tracked.status === 'added' || /^0+$/.test(tracked.oldMode)) {
        return null;
      }
      if (tracked.oldMode === submoduleMode) return { type: 'submodule' };
      // An unmerged path has no object in the raw output, so it's looked up
      // by its path, relative to the working directory.
      const object = noObject.test(tracked.oldObject)
        ? `${sides.mergeBase}:./${tracked.oldPath ?? tracked.path}`
        : tracked.oldObject;
      return objectSide(dir, object, env);
    };
    const newSide = async (): Promise<FileSide | null> => {
      if (tracked.status === 'deleted') return null;
      if (tracked.newMode === submoduleMode) return { type: 'submodule' };
      return diskSide(full);
    };
    const [oldContents, newContents] = await Promise.all([
      oldSide(),
      newSide(),
    ]);
    return { old: oldContents, new: newContents };
  }
  const untracked = await isUntracked(dir, file, env);
  if (typeof untracked !== 'boolean') {
    throw new FileContentsError(untracked.error);
  }
  if (!untracked) throw notListed;
  return { old: null, new: await diskSide(full) };
}

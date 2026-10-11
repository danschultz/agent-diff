// Reads a workspace's git state without touching anything the agent or the
// human uses. Every diff mode compares two trees:
//
// - The working tree and the index are written as trees using private index
//   files under the data directory, never the workspace's own index.
// - Turn snapshots are commits of the working-tree tree, kept alive by refs
//   under refs/agent-diff/, which git doesn't write reflogs for.
//
// Writing those trees adds loose objects to the repo's object database. They
// are unreferenced (except snapshots) and git's normal gc removes them.

import { createHash } from 'node:crypto';
import { copyFile, mkdir, rm, stat, utimes } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { ChangedFile, DiffMode, FileSideContent, FileStatus, TreeSideInfo } from '../shared/types.ts';
import { EMPTY_TREE, git, gitMaybe, ObjectReader, runGit, type ObjectInfo } from './git.ts';

const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_IDENTITY = {
  GIT_AUTHOR_NAME: 'agent-diff',
  GIT_AUTHOR_EMAIL: 'agent-diff@localhost',
  GIT_COMMITTER_NAME: 'agent-diff',
  GIT_COMMITTER_EMAIL: 'agent-diff@localhost',
};

export function workspaceId(root: string): string {
  return 'ws_' + createHash('sha1').update(root).digest('hex').slice(0, 10);
}

/** Resolves any path inside a repo to its worktree root. */
export async function resolveWorkspaceRoot(dir: string): Promise<string> {
  const top = await gitMaybe(dir, ['rev-parse', '--show-toplevel']);
  if (!top) throw new Error(`${dir} is not inside a git worktree`);
  return realpathSync(top);
}

export class GitWorkspace {
  readonly id: string;
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly indexFile: string;
  private readonly scratchDir: string;
  /**
   * Set while a watcher is running. Results that depend on the repo's current
   * state are only cached then, because only the watcher knows when to drop them.
   */
  cacheable = false;
  private readonly stateCache = new Map<string, Promise<unknown>>();
  private readonly treeDiffCache = new Map<string, Promise<[string, string]>>();
  private readonly entryCache = new Map<string, Promise<string>>();
  private readonly objects: ObjectReader;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly blobCache = new Map<string, FileSideContent>();

  private constructor(root: string, gitDir: string, commonDir: string, indexFile: string, dataDir: string) {
    this.root = root;
    this.id = workspaceId(root);
    this.gitDir = gitDir;
    this.commonDir = commonDir;
    this.indexFile = indexFile;
    this.scratchDir = path.join(dataDir, 'indexes', this.id);
    this.objects = new ObjectReader(root);
  }

  close(): void {
    this.objects.close();
  }

  static async open(dir: string, dataDir: string): Promise<GitWorkspace> {
    const root = await resolveWorkspaceRoot(dir);
    const [gitDir, commonDir, indexFile] = (
      await git(root, ['rev-parse', '--absolute-git-dir', '--git-common-dir', '--git-path', 'index'])
    )
      .trim()
      .split('\n');
    const ws = new GitWorkspace(
      root,
      realpathSync(gitDir),
      realpathSync(path.resolve(root, commonDir)),
      path.resolve(root, indexFile),
      dataDir,
    );
    await mkdir(ws.scratchDir, { recursive: true });
    return ws;
  }

  /**
   * Drops results that depend on the working tree, index, or refs. When only
   * working-tree files changed, results derived from HEAD, refs, and the index stay valid.
   */
  invalidate(scope: 'all' | 'worktree' = 'all'): void {
    if (scope === 'all') this.stateCache.clear();
    else this.stateCache.delete('worktree-tree');
  }

  private memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.cacheable) return fn();
    const cached = this.stateCache.get(key) as Promise<T> | undefined;
    if (cached) return cached;
    const promise = fn();
    this.stateCache.set(key, promise);
    promise.catch(() => {
      if (this.stateCache.get(key) === promise) this.stateCache.delete(key);
    });
    return promise;
  }

  branch(): Promise<string | null> {
    return this.memo('branch', () => gitMaybe(this.root, ['symbolic-ref', '-q', '--short', 'HEAD']));
  }

  headCommit(): Promise<string | null> {
    return this.memo('head', () => gitMaybe(this.root, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']));
  }

  async defaultBaseRef(): Promise<string> {
    const remoteHead = await gitMaybe(this.root, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
    if (remoteHead) return remoteHead;
    const current = await this.branch();
    for (const name of ['main', 'master']) {
      if (name !== current && (await gitMaybe(this.root, ['rev-parse', '--verify', '-q', `refs/heads/${name}`]))) return name;
    }
    return 'HEAD';
  }

  /** The tree of the merge base of the base ref and HEAD, like a pull request's base. */
  baseSide(baseRef: string): Promise<TreeSideInfo> {
    return this.memo(`base:${baseRef}`, async () => {
      const [head, base] = await Promise.all([
        this.headCommit(),
        gitMaybe(this.root, ['rev-parse', '--verify', '-q', `${baseRef}^{commit}`]),
      ]);
      if (!base) throw new Error(`Base ref "${baseRef}" doesn't resolve to a commit in ${this.root}`);
      const mergeBase = head ? await gitMaybe(this.root, ['merge-base', base, head]) : null;
      const commit = mergeBase ?? base;
      return { kind: 'base', label: `${baseRef} (${commit.slice(0, 8)})`, tree: await this.commitTree(commit) };
    });
  }

  headSide(): Promise<TreeSideInfo> {
    return this.memo('head-side', async () => {
      const head = await this.headCommit();
      if (!head) return { kind: 'head', label: 'HEAD (no commits)', tree: EMPTY_TREE };
      return { kind: 'head', label: `HEAD (${head.slice(0, 8)})`, tree: await this.commitTree(head) };
    });
  }

  /** A commit's tree never changes, so this is cached for good. */
  commitTree(commit: string): Promise<string> {
    return this.bounded(this.entryCache, `commit:${commit}`, async () => (await git(this.root, ['rev-parse', `${commit}^{tree}`])).trim());
  }

  indexTree(): Promise<string> {
    return this.memo('index-tree', () =>
      this.serialize(async () => {
        if (!(await exists(this.indexFile))) return EMPTY_TREE;
        const scratch = path.join(this.scratchDir, 'staged.index');
        await copyIndex(this.indexFile, scratch);
        try {
          return (await git(this.root, ['write-tree'], { env: { GIT_INDEX_FILE: scratch } })).trim();
        } catch (error) {
          throw new Error(`The index can't be written as a tree (it may have merge conflicts): ${(error as Error).message}`);
        }
      }),
    );
  }

  /**
   * The working tree as a tree object: tracked and untracked files, minus
   * ignored ones. Uses a private index seeded from the real one so unchanged
   * files are recognized by their stat data instead of being rehashed.
   */
  worktreeTree(): Promise<string> {
    return this.memo('worktree-tree', () => this.writeWorktreeTree());
  }

  private writeWorktreeTree(): Promise<string> {
    return this.serialize(async () => {
      const scratch = path.join(this.scratchDir, 'worktree.index');
      if (!(await exists(scratch)) && (await exists(this.indexFile))) await copyIndex(this.indexFile, scratch);
      const env = { GIT_INDEX_FILE: scratch };
      await runGit(this.root, ['add', '-A', '--ignore-errors'], { env, okCodes: [0, 1] });
      return (await git(this.root, ['write-tree'], { env })).trim();
    });
  }

  async sides(mode: DiffMode, baseRef: string, snapshotCommit: string | null): Promise<{ from: TreeSideInfo; to: TreeSideInfo }> {
    const worktree = async (): Promise<TreeSideInfo> => ({ kind: 'worktree', label: 'Working tree', tree: await this.worktreeTree() });
    const index = async (): Promise<TreeSideInfo> => ({ kind: 'index', label: 'Index', tree: await this.indexTree() });
    switch (mode) {
      case 'all':
        return { from: await this.baseSide(baseRef), to: await worktree() };
      case 'committed':
        return { from: await this.baseSide(baseRef), to: await this.headSide() };
      case 'staged':
        return { from: await this.headSide(), to: await index() };
      case 'unstaged':
        return { from: await index(), to: await worktree() };
      case 'last-turn': {
        if (!snapshotCommit) throw new Error('No turn snapshot has been recorded for this workspace yet.');
        const tree = await this.commitTree(snapshotCommit);
        return { from: { kind: 'snapshot', label: `Turn snapshot (${snapshotCommit.slice(0, 8)})`, tree }, to: await worktree() };
      }
    }
  }

  async changedFiles(from: TreeSideInfo, to: TreeSideInfo): Promise<Omit<ChangedFile, 'commentCount'>[]> {
    const [nameStatus, numstat] = await this.bounded(this.treeDiffCache, `${from.tree}:${to.tree}`, () =>
      Promise.all([
        git(this.root, ['diff-tree', '-r', '-z', '-M', '--name-status', from.tree, to.tree]),
        git(this.root, ['diff-tree', '-r', '-z', '-M', '--numstat', from.tree, to.tree]),
      ]),
    );

    const counts = new Map<string, { added: number | null; removed: number | null; binary: boolean }>();
    const nf = numstat.split('\0');
    for (let i = 0; i < nf.length; ) {
      const head = nf[i++];
      if (!head) continue;
      const [a, r, inlinePath] = head.split('\t');
      let file = inlinePath;
      if (inlinePath === '') {
        i++;
        file = nf[i++];
      }
      const binary = a === '-';
      counts.set(file, { added: binary ? null : Number(a), removed: binary ? null : Number(r), binary });
    }

    const untrackedCheck = to.kind === 'worktree' ? await this.indexPaths() : null;
    const files: Omit<ChangedFile, 'commentCount'>[] = [];
    const fields = nameStatus.split('\0');
    for (let i = 0; i < fields.length; ) {
      const code = fields[i++];
      if (!code) continue;
      let oldPath: string | null = null;
      let file: string;
      if (code[0] === 'R' || code[0] === 'C') {
        oldPath = fields[i++];
        file = fields[i++];
      } else {
        file = fields[i++];
      }
      let status = statusFromCode(code[0]);
      if (status === 'added' && untrackedCheck && !untrackedCheck.has(file)) status = 'untracked';
      const c = counts.get(file) ?? { added: null, removed: null, binary: false };
      files.push({ path: file, oldPath, status, ...c });
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  private indexPaths(): Promise<Set<string>> {
    return this.memo('index-paths', async () => new Set((await git(this.root, ['ls-files', '-z'])).split('\0').filter(Boolean)));
  }

  /** Reads a file from a tree. Returns null if the path isn't in the tree. */
  async readFile(tree: string, file: string): Promise<FileSideContent | null> {
    const info = await this.bounded(this.entryCache, `${tree}:${file}`, async () => JSON.stringify(await this.objects.info(`${tree}:${file}`)));
    const entry = JSON.parse(info) as ObjectInfo | null;
    if (!entry) return null;
    if (entry.type !== 'blob') return { hash: entry.oid, content: null, binary: true, tooLarge: false };
    return this.readBlob(entry.oid, entry.size);
  }

  async readBlob(hash: string, knownSize?: number): Promise<FileSideContent> {
    const cached = this.blobCache.get(hash);
    if (cached) return cached;
    const size = knownSize ?? (await this.objects.info(hash))?.size;
    if (size === undefined) throw new Error(`Object ${hash} not found`);
    let result: FileSideContent;
    if (size > MAX_BLOB_BYTES) {
      result = { hash, content: null, binary: false, tooLarge: true };
    } else {
      const stdout = await this.objects.contents(hash);
      if (!stdout) throw new Error(`Object ${hash} not found`);
      const binary = stdout.subarray(0, 8000).includes(0);
      result = { hash, content: binary ? null : stdout.toString('utf8'), binary, tooLarge: false };
    }
    if (this.blobCache.size > 500) this.blobCache.delete(this.blobCache.keys().next().value!);
    this.blobCache.set(hash, result);
    return result;
  }

  /** Records the current working tree as a turn snapshot commit under a hidden ref. */
  async createSnapshot(ref: string, message: string): Promise<{ commit: string; tree: string }> {
    // Not from the cache: a write the watcher hasn't flushed yet still belongs before the turn.
    const tree = await this.writeWorktreeTree();
    const head = await gitMaybe(this.root, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
    const args = ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message];
    const commit = (await git(this.root, args, { env: SNAPSHOT_IDENTITY })).trim();
    await git(this.root, ['update-ref', ref, commit]);
    return { commit, tree };
  }

  async deleteScratch(): Promise<void> {
    await rm(this.scratchDir, { recursive: true, force: true });
  }

  /** For results keyed by object hashes, which never go stale. */
  private bounded<T>(cache: Map<string, Promise<T>>, key: string, fn: () => Promise<T>): Promise<T> {
    const cached = cache.get(key);
    if (cached) return cached;
    const promise = fn();
    promise.catch(() => cache.delete(key));
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, promise);
    return promise;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function statusFromCode(code: string): FileStatus {
  switch (code) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    default:
      return 'modified';
  }
}

/**
 * Copies an index file and keeps its timestamps. Git trusts an entry's stat
 * data only if the file was modified before the index was written, so a copy
 * with a newer mtime would hide same-size edits made in the same second.
 */
async function copyIndex(from: string, to: string): Promise<void> {
  await copyFile(from, to);
  const { atime, mtime } = await stat(from);
  await utimes(to, atime, mtime);
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

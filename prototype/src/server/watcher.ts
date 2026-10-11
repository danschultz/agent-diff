// Watches a workspace's working tree and the parts of its git directory that
// diff modes depend on (0007). Events are debounced, gitignored paths are
// dropped, and each flush reports what it saw so live-reload cost and latency
// can be measured.

import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { Settings, WorkspaceChangedEvent } from '../shared/types.ts';
import { git } from './git.ts';
import type { GitWorkspace } from './workspace.ts';

export class WorkspaceWatcher {
  private readonly ws: GitWorkspace;
  private readonly settings: () => Settings;
  private readonly onChange: (event: WorkspaceChangedEvent) => void;
  private watchers: FSWatcher[] = [];
  private pending = new Set<string>();
  private gitMetadata = false;
  private rawEventCount = 0;
  private firstEventAt = 0;
  private debounceTimer: NodeJS.Timeout | null = null;
  private maxWaitTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(ws: GitWorkspace, settings: () => Settings, onChange: (event: WorkspaceChangedEvent) => void) {
    this.ws = ws;
    this.settings = settings;
    this.onChange = onChange;
  }

  start(): void {
    const { root, gitDir, commonDir } = this.ws;
    this.watch(root, true);
    if (!isInside(gitDir, root)) this.watch(gitDir, false);
    if (!isInside(commonDir, root) && commonDir !== gitDir) this.watch(commonDir, true);
    this.ws.invalidate();
    this.ws.cacheable = this.watchers.length > 0;
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    this.ws.cacheable = false;
    this.ws.invalidate();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer);
  }

  private watch(dir: string, recursive: boolean): void {
    try {
      const watcher = watch(dir, { recursive }, (_event, filename) => {
        this.record(filename === null ? null : path.join(dir, filename.toString()));
      });
      watcher.on('error', (error) => console.warn(`[watch] ${dir}: ${error.message}`));
      this.watchers.push(watcher);
    } catch (error) {
      console.warn(`[watch] can't watch ${dir}: ${(error as Error).message}`);
    }
  }

  private record(file: string | null): void {
    this.rawEventCount++;
    if (file === null) {
      this.gitMetadata = true;
    } else {
      const kind = this.classify(file);
      if (kind === 'ignore') return;
      if (kind === 'git') this.gitMetadata = true;
      else this.pending.add(kind);
    }
    this.schedule();
  }

  /** Returns 'git' for relevant git metadata, 'ignore', or the worktree-relative path. */
  private classify(file: string): string {
    const { root, gitDir, commonDir } = this.ws;
    for (const dir of [gitDir, commonDir]) {
      if (!isInside(file, dir)) continue;
      const rel = path.relative(dir, file).split(path.sep).join('/');
      if (rel.endsWith('.lock')) return 'ignore';
      if (rel === 'index' || rel === 'HEAD' || rel === 'packed-refs') return dir === gitDir || rel === 'packed-refs' ? 'git' : 'ignore';
      if (rel.startsWith('refs/') && !rel.startsWith('refs/agent-diff/')) return 'git';
      return 'ignore';
    }
    if (!isInside(file, root)) return 'ignore';
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (rel === '' || rel === '.git' || rel.startsWith('.git/')) return 'ignore';
    return rel;
  }

  private schedule(): void {
    const { debounceMs, maxWaitMs } = this.settings();
    if (this.firstEventAt === 0) {
      this.firstEventAt = Date.now();
      this.maxWaitTimer = setTimeout(() => this.flush(), maxWaitMs);
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.flush(), debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.flushing) {
      this.debounceTimer = setTimeout(() => this.flush(), 20);
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer);
    this.debounceTimer = this.maxWaitTimer = null;

    const paths = [...this.pending];
    const gitMetadata = this.gitMetadata;
    const rawEventCount = this.rawEventCount;
    const firstEventAt = this.firstEventAt;
    this.pending = new Set();
    this.gitMetadata = false;
    this.rawEventCount = 0;
    this.firstEventAt = 0;
    if (paths.length === 0 && !gitMetadata) return;

    this.flushing = true;
    try {
      const ignored = await this.ignoredPaths(paths);
      const relevant = paths.filter((p) => !ignored.has(p));
      if (relevant.length === 0 && !gitMetadata) return;
      this.ws.invalidate(gitMetadata ? 'all' : 'worktree');
      this.onChange({
        type: 'workspace-changed',
        workspaceId: this.ws.id,
        paths: relevant.slice(0, 50),
        pathCount: relevant.length,
        rawEventCount,
        ignoredCount: ignored.size,
        gitMetadata,
        firstEventAt,
        flushedAt: Date.now(),
      });
    } catch (error) {
      console.warn(`[watch] flush failed: ${(error as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }

  private async ignoredPaths(paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) return new Set();
    const out = await git(this.ws.root, ['check-ignore', '-z', '--stdin'], { input: paths.join('\0') + '\0', okCodes: [0, 1] });
    return new Set(out.split('\0').filter(Boolean));
  }
}

function isInside(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

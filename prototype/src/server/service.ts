import path from 'node:path';
import {
  defaultReanchorOptions,
  reanchor,
  splitLines,
} from '../shared/reanchor.ts';
import { cliCommand } from '../shared/paths.ts';
import type {
  AgentInfo,
  ChangedFile,
  CommentRecord,
  DiffMode,
  FeedbackComment,
  FeedbackResponse,
  FileDiffResponse,
  FileListResponse,
  NotificationInfo,
  NotificationStatus,
  PendingFeedback,
  PlacedComment,
  Placement,
  ReviewInfo,
  ReviewSessionInfo,
  ServerEvent,
  Settings,
  Side,
  SnapshotInfo,
  TreeSideInfo,
  WorkspaceInfo,
} from '../shared/types.ts';
import { Db, newId, now, type Row } from './db.ts';
import { deliveryKind, push, validateNotifyMethod } from './notify.ts';
import { WorkspaceWatcher } from './watcher.ts';
import {
  GitWorkspace,
  resolveWorkspaceRoot,
  workspaceId,
} from './workspace.ts';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface CreateCommentInput {
  workspaceId?: string | null;
  path?: string | null;
  side?: Side | null;
  startLine?: number | null;
  endLine?: number | null;
  versionHash?: string | null;
  mode?: DiffMode | null;
  body: string;
}

export interface TurnInput {
  event: 'start' | 'end';
  cwd: string;
  /** True when the caller's hook can hand the notification to the agent itself (Claude Stop, Cursor stop). */
  canWake?: boolean;
  label?: string | null;
  parentId?: string | null;
  notify?: string | null;
}

export class ReviewService {
  readonly db: Db;
  readonly dataDir: string;
  private readonly emit: (event: ServerEvent) => void;
  private readonly workspaces = new Map<string, GitWorkspace>();
  private readonly watchers = new Map<string, WorkspaceWatcher>();
  settings: Settings = {
    debounceMs: Number(process.env.AGENT_DIFF_DEBOUNCE_MS ?? 150),
    maxWaitMs: Number(process.env.AGENT_DIFF_MAX_WAIT_MS ?? 1000),
    holdWhileBusy: true,
    enterDelayMs: 300,
    reanchor: { ...defaultReanchorOptions },
  };

  constructor(db: Db, dataDir: string, emit: (event: ServerEvent) => void) {
    this.db = db;
    this.dataDir = dataDir;
    this.emit = emit;
  }

  async init(): Promise<void> {
    const rows = this.db.all<{ workspace_id: string }>(
      `select distinct rsw.workspace_id from review_session_workspaces rsw
       join review_sessions rs on rs.id = rsw.review_session_id where rs.status = 'open'`,
    );
    for (const row of rows) {
      try {
        this.watchWorkspace(await this.workspaceById(row.workspace_id));
      } catch (error) {
        console.warn(
          `[init] can't reopen workspace ${row.workspace_id}: ${(error as Error).message}`,
        );
      }
    }
  }

  shutdown(): void {
    for (const w of this.watchers.values()) w.stop();
    this.watchers.clear();
    for (const ws of this.workspaces.values()) ws.close();
  }

  // Workspaces

  async openWorkspace(dir: string): Promise<GitWorkspace> {
    const root = await resolveWorkspaceRoot(dir);
    const id = workspaceId(root);
    const cached = this.workspaces.get(id);
    if (cached) return cached;
    const ws = await GitWorkspace.open(root, this.dataDir);
    this.db.run(
      'insert or ignore into workspaces (id, root, created_at) values (?, ?, ?)',
      ws.id,
      ws.root,
      now(),
    );
    this.workspaces.set(ws.id, ws);
    return ws;
  }

  async workspaceById(id: string): Promise<GitWorkspace> {
    const cached = this.workspaces.get(id);
    if (cached) return cached;
    const row = this.db.get<{ root: string }>(
      'select root from workspaces where id = ?',
      id,
    );
    if (!row) throw new HttpError(404, `Unknown workspace ${id}`);
    return this.openWorkspace(row.root);
  }

  private watchWorkspace(ws: GitWorkspace): void {
    if (this.watchers.has(ws.id)) return;
    const watcher = new WorkspaceWatcher(
      ws,
      () => this.settings,
      (event) => this.emit(event),
    );
    watcher.start();
    this.watchers.set(ws.id, watcher);
  }

  private unwatchIfUnused(wsId: string): void {
    const inUse = this.db.get(
      `select 1 from review_session_workspaces rsw join review_sessions rs on rs.id = rsw.review_session_id
       where rsw.workspace_id = ? and rs.status = 'open'`,
      wsId,
    );
    if (inUse) return;
    this.watchers.get(wsId)?.stop();
    this.watchers.delete(wsId);
  }

  private membership(rsId: string, wsId: string): { base_ref: string } {
    const row = this.db.get<{ base_ref: string }>(
      'select base_ref from review_session_workspaces where review_session_id = ? and workspace_id = ?',
      rsId,
      wsId,
    );
    if (!row)
      throw new HttpError(
        404,
        `Workspace ${wsId} isn't in review session ${rsId}`,
      );
    return row;
  }

  private openReviewSessionsFor(wsId: string): string[] {
    return this.db
      .all<{ id: string }>(
        `select rs.id from review_sessions rs join review_session_workspaces rsw on rsw.review_session_id = rs.id
         where rsw.workspace_id = ? and rs.status = 'open' order by rs.created_at desc`,
        wsId,
      )
      .map((r) => r.id);
  }

  // Review sessions

  async startReviewSession(input: {
    workspaces: { path: string; baseRef?: string | null }[];
    title?: string | null;
    startedBy?: string | null;
  }): Promise<ReviewSessionInfo> {
    if (!input.workspaces?.length)
      throw new HttpError(400, 'A review session needs at least one workspace');
    const id = newId('rs');
    this.db.run(
      'insert into review_sessions (id, title, status, started_by, created_at) values (?, ?, ?, ?, ?)',
      id,
      input.title ?? null,
      'open',
      input.startedBy ?? null,
      now(),
    );
    for (const w of input.workspaces) await this.addWorkspace(id, w, false);
    this.emit({ type: 'state-changed' });
    return this.reviewSessionInfo(id);
  }

  async addWorkspace(
    rsId: string,
    input: { path: string; baseRef?: string | null },
    announce = true,
  ): Promise<ReviewSessionInfo> {
    this.requireOpen(rsId);
    const ws = await this.openWorkspace(input.path);
    const baseRef = input.baseRef || (await ws.defaultBaseRef());
    await ws.baseSide(baseRef).catch((error) => {
      throw new HttpError(400, (error as Error).message);
    });
    this.db.run(
      'insert or ignore into review_session_workspaces (review_session_id, workspace_id, base_ref, added_at) values (?, ?, ?, ?)',
      rsId,
      ws.id,
      baseRef,
      now(),
    );
    this.watchWorkspace(ws);
    if (!this.latestSnapshot(ws.id))
      await this.createSnapshot(ws, 'review-session-start', null);
    if (announce) this.emit({ type: 'state-changed' });
    return this.reviewSessionInfo(rsId);
  }

  async endReviewSession(rsId: string): Promise<ReviewSessionInfo> {
    this.requireOpen(rsId);
    this.db.run(
      `update review_sessions set status = 'ended', ended_at = ? where id = ?`,
      now(),
      rsId,
    );
    for (const row of this.db.all<{ workspace_id: string }>(
      'select workspace_id from review_session_workspaces where review_session_id = ?',
      rsId,
    )) {
      this.unwatchIfUnused(row.workspace_id);
    }
    this.emit({ type: 'state-changed' });
    return this.reviewSessionInfo(rsId);
  }

  private requireOpen(rsId: string): void {
    const row = this.db.get<{ status: string }>(
      'select status from review_sessions where id = ?',
      rsId,
    );
    if (!row) throw new HttpError(404, `Unknown review session ${rsId}`);
    if (row.status !== 'open')
      throw new HttpError(409, `Review session ${rsId} has ended`);
  }

  async reviewSessionInfo(rsId: string): Promise<ReviewSessionInfo> {
    const row = this.db.get<Row>(
      'select * from review_sessions where id = ?',
      rsId,
    );
    if (!row) throw new HttpError(404, `Unknown review session ${rsId}`);
    const members = this.db.all<{
      workspace_id: string;
      base_ref: string;
      root: string;
    }>(
      `select rsw.workspace_id, rsw.base_ref, w.root from review_session_workspaces rsw
       join workspaces w on w.id = rsw.workspace_id where rsw.review_session_id = ? order by rsw.added_at`,
      rsId,
    );
    const workspaces: WorkspaceInfo[] = [];
    for (const m of members) {
      let branch: string | null = null;
      try {
        branch = await (await this.workspaceById(m.workspace_id)).branch();
      } catch {
        branch = null;
      }
      workspaces.push({
        id: m.workspace_id,
        root: m.root,
        baseRef: m.base_ref,
        branch,
      });
    }
    return {
      id: rsId,
      title: row.title as string | null,
      status: row.status as 'open' | 'ended',
      startedBy: row.started_by as string | null,
      createdAt: row.created_at as string,
      endedAt: row.ended_at as string | null,
      workspaces,
    };
  }

  async listReviewSessions(): Promise<ReviewSessionInfo[]> {
    const ids = this.db.all<{ id: string }>(
      'select id from review_sessions order by created_at desc limit 50',
    );
    return Promise.all(ids.map((r) => this.reviewSessionInfo(r.id)));
  }

  // Diffs

  private async sidesFor(
    rsId: string,
    ws: GitWorkspace,
    mode: DiffMode,
    snapshotId: number | null,
  ) {
    const { base_ref } = this.membership(rsId, ws.id);
    const snapshot =
      mode === 'last-turn'
        ? snapshotId
          ? this.snapshotById(ws.id, snapshotId)
          : this.latestSnapshot(ws.id)
        : null;
    try {
      return await ws.sides(mode, base_ref, snapshot?.commit ?? null);
    } catch (error) {
      throw new HttpError(409, (error as Error).message);
    }
  }

  async files(
    rsId: string,
    wsId: string,
    mode: DiffMode,
    snapshotId: number | null,
  ): Promise<FileListResponse> {
    const started = performance.now();
    const ws = await this.workspaceById(wsId);
    const sides = await this.sidesFor(rsId, ws, mode, snapshotId);
    const treesDone = performance.now();
    const raw = await ws.changedFiles(sides.from, sides.to);
    const counts = new Map<string, number>();
    for (const row of this.db.all<{ path: string }>(
      'select path from comments where review_session_id = ? and workspace_id = ? and path is not null',
      rsId,
      wsId,
    )) {
      counts.set(row.path, (counts.get(row.path) ?? 0) + 1);
    }
    const files: ChangedFile[] = raw.map((f) => ({
      ...f,
      commentCount:
        (counts.get(f.path) ?? 0) +
        (f.oldPath ? (counts.get(f.oldPath) ?? 0) : 0),
    }));
    const done = performance.now();
    return {
      from: sides.from,
      to: sides.to,
      files,
      timingMs: {
        trees: round(treesDone - started),
        diff: round(done - treesDone),
        total: round(done - started),
      },
      warning: null,
    };
  }

  async file(
    rsId: string,
    wsId: string,
    mode: DiffMode,
    filePath: string,
    oldPath: string | null,
    snapshotId: number | null,
  ): Promise<FileDiffResponse> {
    const started = performance.now();
    const ws = await this.workspaceById(wsId);
    const sides = await this.sidesFor(rsId, ws, mode, snapshotId);
    const changed = (await ws.changedFiles(sides.from, sides.to)).find(
      (f) => f.path === filePath,
    );
    const fromPath = oldPath ?? changed?.oldPath ?? filePath;
    const empty = { hash: null, content: null, binary: false, tooLarge: false };
    const [oldSide, newSide] = await Promise.all([
      ws.readFile(sides.from.tree, fromPath),
      ws.readFile(sides.to.tree, filePath),
    ]);
    const gitDone = performance.now();
    const paths = new Set([filePath, fromPath]);
    const records = this.commentRecords(rsId).filter(
      (c) => c.workspaceId === wsId && c.path && paths.has(c.path),
    );
    const comments = await this.place(ws, sides, records);
    const done = performance.now();
    return {
      path: filePath,
      oldPath: changed?.oldPath ?? null,
      status: changed?.status ?? 'unchanged',
      old: oldSide ?? empty,
      new: newSide ?? empty,
      comments,
      timingMs: {
        git: round(gitDone - started),
        reanchor: round(done - gitDone),
        total: round(done - started),
      },
    };
  }

  // Comments

  private commentRecords(rsId: string): CommentRecord[] {
    return this.db
      .all<Row>(
        'select * from comments where review_session_id = ? order by created_at',
        rsId,
      )
      .map(toComment);
  }

  /** Every comment in the review session, placed for the given diff mode. */
  async placedComments(
    rsId: string,
    mode: DiffMode,
    snapshotId: number | null,
  ): Promise<PlacedComment[]> {
    const records = this.commentRecords(rsId);
    const byWorkspace = new Map<string, CommentRecord[]>();
    const result: PlacedComment[] = [];
    for (const c of records) {
      if (!c.workspaceId || !c.path) {
        result.push({ ...c, placement: null, originalCode: [] });
        continue;
      }
      byWorkspace.set(c.workspaceId, [
        ...(byWorkspace.get(c.workspaceId) ?? []),
        c,
      ]);
    }
    for (const [wsId, list] of byWorkspace) {
      const ws = await this.workspaceById(wsId);
      let sides: { from: TreeSideInfo; to: TreeSideInfo } | null = null;
      let error: string | null = null;
      try {
        sides = await this.sidesFor(rsId, ws, mode, snapshotId);
      } catch (e) {
        error = (e as Error).message;
      }
      if (sides) result.push(...(await this.place(ws, sides, list)));
      else
        result.push(
          ...list.map((c) => ({
            ...c,
            placement: unplaceable(error!),
            originalCode: this.originalCode(c),
          })),
        );
    }
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private originalCode(c: CommentRecord): string[] {
    if (!c.fileVersion || !c.startLine || !c.endLine) return [];
    const row = this.db.get<{ content: string }>(
      'select content from file_versions where hash = ?',
      c.fileVersion,
    );
    return row ? splitLines(row.content).slice(c.startLine - 1, c.endLine) : [];
  }

  private async place(
    ws: GitWorkspace,
    sides: { from: TreeSideInfo; to: TreeSideInfo },
    comments: CommentRecord[],
  ): Promise<PlacedComment[]> {
    let renames: Map<string, string> | null = null;
    const out: PlacedComment[] = [];
    for (const c of comments) {
      const version = this.db.get<{ content: string }>(
        'select content from file_versions where hash = ?',
        c.fileVersion,
      );
      if (!version || !c.path || !c.startLine || !c.endLine) {
        out.push({ ...c, placement: null, originalCode: [] });
        continue;
      }
      const tree = c.side === 'old' ? sides.from.tree : sides.to.tree;
      let targetPath = c.path;
      let target = await ws.readFile(tree, targetPath);
      if (!target && c.side !== 'old') {
        renames ??= new Map(
          (await ws.changedFiles(sides.from, sides.to))
            .filter((f) => f.oldPath)
            .map((f) => [f.oldPath!, f.path]),
        );
        const renamed = renames.get(c.path);
        if (renamed) {
          targetPath = renamed;
          target = await ws.readFile(tree, renamed);
        }
      }
      const result = reanchor(
        version.content,
        { start: c.startLine, end: c.endLine },
        target?.content ?? null,
        this.settings.reanchor,
      );
      out.push({
        ...c,
        placement: { ...result, path: target ? targetPath : null },
        originalCode: splitLines(version.content).slice(
          c.startLine - 1,
          c.endLine,
        ),
      });
    }
    return out;
  }

  async createComment(
    rsId: string,
    input: CreateCommentInput,
  ): Promise<CommentRecord> {
    this.requireOpen(rsId);
    const body = input.body?.trim();
    if (!body) throw new HttpError(400, 'A comment needs a body');
    const id = newId('c');
    const at = now();
    if (!input.workspaceId) {
      this.db.run(
        `insert into comments (id, review_session_id, body, created_at, updated_at) values (?, ?, ?, ?, ?)`,
        id,
        rsId,
        body,
        at,
        at,
      );
    } else {
      const {
        workspaceId: wsId,
        path: file,
        side,
        startLine,
        endLine,
        versionHash,
        mode,
      } = input;
      if (!file || !side || !startLine || !endLine || !versionHash) {
        throw new HttpError(
          400,
          'Line comments need path, side, startLine, endLine, and versionHash',
        );
      }
      this.membership(rsId, wsId);
      const ws = await this.workspaceById(wsId);
      const blob = await ws.readBlob(versionHash).catch(() => null);
      if (!blob || blob.content === null)
        throw new HttpError(
          400,
          `File version ${versionHash} isn't readable text`,
        );
      const lineCount = splitLines(blob.content).length;
      if (startLine < 1 || endLine < startLine || endLine > lineCount) {
        throw new HttpError(
          400,
          `Lines ${startLine}-${endLine} are outside the file (${lineCount} lines)`,
        );
      }
      this.db.transaction(() => {
        this.db.run(
          'insert or ignore into file_versions (hash, content, created_at) values (?, ?, ?)',
          versionHash,
          blob.content,
          at,
        );
        this.db.run(
          `insert into comments (id, review_session_id, workspace_id, path, side, start_line, end_line, file_version, diff_mode, body, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          rsId,
          wsId,
          file,
          side,
          startLine,
          endLine,
          versionHash,
          mode ?? null,
          body,
          at,
          at,
        );
      });
    }
    this.emit({ type: 'comments-changed', reviewSessionId: rsId });
    return toComment(
      this.db.get<Row>('select * from comments where id = ?', id)!,
    );
  }

  updateComment(id: string, body: string): CommentRecord {
    const row = this.db.get<Row>('select * from comments where id = ?', id);
    if (!row) throw new HttpError(404, `Unknown comment ${id}`);
    if (row.review_id)
      throw new HttpError(409, 'Submitted comments can no longer be edited');
    if (!body?.trim()) throw new HttpError(400, 'A comment needs a body');
    this.db.run(
      'update comments set body = ?, updated_at = ? where id = ?',
      body.trim(),
      now(),
      id,
    );
    this.emit({
      type: 'comments-changed',
      reviewSessionId: row.review_session_id as string,
    });
    return toComment(
      this.db.get<Row>('select * from comments where id = ?', id)!,
    );
  }

  deleteComment(id: string): void {
    const row = this.db.get<Row>('select * from comments where id = ?', id);
    if (!row) throw new HttpError(404, `Unknown comment ${id}`);
    if (row.review_id)
      throw new HttpError(409, 'Submitted comments can no longer be deleted');
    this.db.run('delete from comments where id = ?', id);
    this.emit({
      type: 'comments-changed',
      reviewSessionId: row.review_session_id as string,
    });
  }

  // Reviews and notifications

  async submitReview(rsId: string): Promise<ReviewInfo> {
    this.requireOpen(rsId);
    const drafts = this.db.all<{ id: string; workspace_id: string | null }>(
      'select id, workspace_id from comments where review_session_id = ? and review_id is null',
      rsId,
    );
    if (drafts.length === 0)
      throw new HttpError(400, 'There are no draft comments to submit');
    const reviewId = newId('rv');
    const at = now();
    const allWorkspaces = this.db
      .all<{ workspace_id: string }>(
        'select workspace_id from review_session_workspaces where review_session_id = ?',
        rsId,
      )
      .map((r) => r.workspace_id);
    const hasOverall = drafts.some((d) => !d.workspace_id);
    const targets = hasOverall
      ? allWorkspaces
      : [...new Set(drafts.map((d) => d.workspace_id!))];

    const toPush: string[] = [];
    this.db.transaction(() => {
      this.db.run(
        'insert into reviews (id, review_session_id, submitted_at) values (?, ?, ?)',
        reviewId,
        rsId,
        at,
      );
      this.db.run(
        'update comments set review_id = ? where review_session_id = ? and review_id is null',
        reviewId,
        rsId,
      );
      for (const wsId of targets) {
        const root = this.db.get<{ root: string }>(
          'select root from workspaces where id = ?',
          wsId,
        )!.root;
        const message = notificationMessage(rsId, root);
        const agents = this.db.all<{
          id: string;
          notify: string;
          busy: number;
        }>(
          'select a.id, a.notify, a.busy from agents a join agent_workspaces aw on aw.agent_id = a.id where aw.workspace_id = ?',
          wsId,
        );
        if (agents.length === 0) {
          this.insertNotification(
            reviewId,
            null,
            wsId,
            'none',
            message,
            'manual',
          );
          continue;
        }
        for (const agent of agents) {
          const kind = deliveryKind(agent.notify);
          let status: NotificationStatus = kind === 'pull' ? 'pull' : 'manual';
          if (kind === 'push')
            status =
              agent.busy && this.settings.holdWhileBusy ? 'held' : 'sent';
          const id = this.insertNotification(
            reviewId,
            agent.id,
            wsId,
            agent.notify,
            message,
            status,
          );
          if (status === 'sent') toPush.push(id);
        }
      }
    });
    await Promise.all(toPush.map((id) => this.pushNotification(id)));
    this.emit({ type: 'comments-changed', reviewSessionId: rsId });
    this.emit({ type: 'reviews-changed', reviewSessionId: rsId });
    return this.reviews(rsId).find((r) => r.id === reviewId)!;
  }

  private insertNotification(
    reviewId: string,
    agentId: string | null,
    wsId: string,
    method: string,
    message: string,
    status: NotificationStatus,
  ): string {
    const id = newId('n');
    this.db.run(
      `insert into notifications (id, review_id, agent_id, workspace_id, method, message, status, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      reviewId,
      agentId,
      wsId,
      method,
      message,
      status,
      now(),
    );
    return id;
  }

  private async pushNotification(id: string): Promise<void> {
    const n = this.db.get<{
      method: string;
      message: string;
      review_id: string;
    }>(
      'select method, message, review_id from notifications where id = ?',
      id,
    )!;
    try {
      await push(n.method, n.message, this.settings.enterDelayMs);
      this.db.run(
        `update notifications set status = 'sent', sent_at = ?, error = null where id = ?`,
        now(),
        id,
      );
    } catch (error) {
      this.db.run(
        `update notifications set status = 'failed', error = ? where id = ?`,
        (error as Error).message,
        id,
      );
    }
    const rs = this.db.get<{ review_session_id: string }>(
      'select review_session_id from reviews where id = ?',
      n.review_id,
    )!;
    this.emit({
      type: 'reviews-changed',
      reviewSessionId: rs.review_session_id,
    });
  }

  async resendNotification(id: string): Promise<void> {
    const n = this.db.get<{ method: string }>(
      'select method from notifications where id = ?',
      id,
    );
    if (!n) throw new HttpError(404, `Unknown notification ${id}`);
    if (deliveryKind(n.method) !== 'push')
      throw new HttpError(400, `${n.method} notifications can't be pushed`);
    await this.pushNotification(id);
  }

  reviews(rsId: string): ReviewInfo[] {
    return this.db
      .all<Row>(
        'select * from reviews where review_session_id = ? order by submitted_at',
        rsId,
      )
      .map((r) => ({
        id: r.id as string,
        reviewSessionId: rsId,
        submittedAt: r.submitted_at as string,
        commentCount: this.db.get<{ n: number }>(
          'select count(*) as n from comments where review_id = ?',
          r.id,
        )!.n,
        notifications: this.db
          .all<Row>(
            'select * from notifications where review_id = ? order by created_at',
            r.id,
          )
          .map(toNotification),
        fetches: this.db
          .all<Row>(
            'select * from feedback_fetches where review_id = ? order by fetched_at',
            r.id,
          )
          .map((f) => ({
            workspaceId: f.workspace_id as string,
            agentId: f.agent_id as string | null,
            fetchedAt: f.fetched_at as string,
          })),
      }));
  }

  // Agents and turns

  registerAgent(input: {
    id: string;
    label?: string | null;
    parentId?: string | null;
    notify?: string | null;
  }): void {
    if (!input.id) throw new HttpError(400, 'An agent needs an id');
    const existing = this.db.get<{ notify: string }>(
      'select notify from agents where id = ?',
      input.id,
    );
    const notify = input.notify ?? existing?.notify ?? 'hook';
    const invalid = validateNotifyMethod(notify);
    if (invalid) throw new HttpError(400, invalid);
    const at = now();
    this.db.run(
      `insert into agents (id, label, parent_id, notify, busy, last_seen_at, created_at) values (?, ?, ?, ?, 0, ?, ?)
       on conflict(id) do update set label = coalesce(excluded.label, label), parent_id = coalesce(excluded.parent_id, parent_id),
       notify = excluded.notify, last_seen_at = excluded.last_seen_at`,
      input.id,
      input.label ?? null,
      input.parentId ?? null,
      notify,
      at,
      at,
    );
  }

  async registerAgentWorkspace(
    agentId: string,
    dir: string,
  ): Promise<GitWorkspace> {
    const ws = await this.openWorkspace(dir);
    this.db.run(
      'insert or ignore into agent_workspaces (agent_id, workspace_id) values (?, ?)',
      agentId,
      ws.id,
    );
    this.emit({ type: 'state-changed' });
    return ws;
  }

  agents(): AgentInfo[] {
    return this.db
      .all<Row>('select * from agents order by last_seen_at desc')
      .map((a) => ({
        id: a.id as string,
        label: a.label as string | null,
        parentId: a.parent_id as string | null,
        notify: a.notify as string,
        busy: Boolean(a.busy),
        lastSeenAt: a.last_seen_at as string,
        workspaceIds: this.db
          .all<{ workspace_id: string }>(
            'select workspace_id from agent_workspaces where agent_id = ?',
            a.id,
          )
          .map((r) => r.workspace_id),
      }));
  }

  async turn(
    agentId: string,
    input: TurnInput,
  ): Promise<{ pending: PendingFeedback; snapshot: SnapshotInfo | null }> {
    this.registerAgent({
      id: agentId,
      label: input.label,
      parentId: input.parentId,
      notify: input.notify,
    });
    const ws = await this.registerAgentWorkspace(agentId, input.cwd);
    const pending = this.pendingFeedback(ws.id);
    // A stop hook that hands over feedback keeps the agent working, so it stays busy.
    const busy =
      input.event === 'start' || (pending.pending && Boolean(input.canWake));
    this.db.run(
      'update agents set busy = ?, last_seen_at = ? where id = ?',
      busy ? 1 : 0,
      now(),
      agentId,
    );

    let snapshot: SnapshotInfo | null = null;
    if (
      input.event === 'start' &&
      this.openReviewSessionsFor(ws.id).length > 0
    ) {
      snapshot = await this.createSnapshot(ws, 'turn-start', agentId);
    }

    if (pending.pending && input.canWake) {
      // The hook shows the message to the agent itself, so nothing is typed into its terminal.
      for (const reviewId of pending.reviewIds) {
        this.db.run(
          `update notifications set status = 'sent', sent_at = ? where agent_id = ? and review_id = ? and status in ('held', 'pull')`,
          now(),
          agentId,
          reviewId,
        );
      }
    } else if (input.event === 'end') {
      const held = this.db.all<{ id: string }>(
        `select id from notifications where agent_id = ? and status = 'held'`,
        agentId,
      );
      if (held.length > 0) {
        // Give the agent's terminal a moment to return to its prompt before typing.
        setTimeout(
          () => held.forEach((n) => void this.pushNotification(n.id)),
          this.settings.enterDelayMs,
        );
      }
    }
    this.emit({ type: 'state-changed' });
    return { pending, snapshot };
  }

  pendingFeedback(wsId: string): PendingFeedback {
    const rows = this.db.all<{
      review_id: string;
      review_session_id: string;
      n: number;
    }>(
      `select r.id as review_id, r.review_session_id, count(c.id) as n
       from reviews r
       join review_sessions rs on rs.id = r.review_session_id and rs.status = 'open'
       join review_session_workspaces rsw on rsw.review_session_id = rs.id and rsw.workspace_id = ?
       join comments c on c.review_id = r.id and (c.workspace_id = ? or c.workspace_id is null)
       where not exists (select 1 from feedback_fetches f where f.review_id = r.id and f.workspace_id = ?)
       group by r.id order by r.submitted_at`,
      wsId,
      wsId,
      wsId,
    );
    if (rows.length === 0)
      return {
        pending: false,
        reviewSessionId: null,
        reviewIds: [],
        commentCount: 0,
        message: null,
      };
    const root = this.db.get<{ root: string }>(
      'select root from workspaces where id = ?',
      wsId,
    )!.root;
    const rsId = rows[rows.length - 1].review_session_id;
    return {
      pending: true,
      reviewSessionId: rsId,
      reviewIds: rows.map((r) => r.review_id),
      commentCount: rows.reduce((sum, r) => sum + r.n, 0),
      message: notificationMessage(rsId, root),
    };
  }

  async pendingFeedbackFor(dir: string): Promise<PendingFeedback> {
    return this.pendingFeedback((await this.openWorkspace(dir)).id);
  }

  async feedback(input: {
    workspace: string;
    reviewSessionId?: string | null;
    all?: boolean;
    agentId?: string | null;
  }): Promise<FeedbackResponse> {
    const ws = await this.openWorkspace(input.workspace);
    const rsId = input.reviewSessionId ?? this.openReviewSessionsFor(ws.id)[0];
    if (!rsId)
      throw new HttpError(404, `${ws.root} isn't in an open review session`);
    const { base_ref } = this.membership(rsId, ws.id);

    const reviewRows = this.db.all<{ id: string; submitted_at: string }>(
      input.all
        ? 'select id, submitted_at from reviews where review_session_id = ? order by submitted_at'
        : `select id, submitted_at from reviews r where review_session_id = ?
           and not exists (select 1 from feedback_fetches f where f.review_id = r.id and f.workspace_id = ?) order by submitted_at`,
      ...(input.all ? [rsId] : [rsId, ws.id]),
    );
    const reviewIds = new Set(reviewRows.map((r) => r.id));
    const records = this.commentRecords(rsId).filter(
      (c) =>
        c.reviewId &&
        reviewIds.has(c.reviewId) &&
        (c.workspaceId === ws.id || c.workspaceId === null),
    );

    const sides = await this.sidesFor(rsId, ws, 'all', null);
    const placed = await this.place(
      ws,
      sides,
      records.filter((c) => c.workspaceId),
    );
    const placedById = new Map(placed.map((c) => [c.id, c]));
    const currentLines = new Map<string, string[]>();
    const comments: FeedbackComment[] = [];
    for (const c of records) {
      const p = placedById.get(c.id);
      if (!p || !p.placement || !c.startLine || !c.endLine) {
        comments.push({
          id: c.id,
          reviewId: c.reviewId!,
          kind: 'overall',
          path: null,
          side: null,
          original: null,
          current: null,
          body: c.body,
        });
        continue;
      }
      const at = p.placement.range ?? p.placement.replacement;
      let code: string[] = [];
      if (at && p.placement.path) {
        const key = `${c.side}:${p.placement.path}`;
        if (!currentLines.has(key)) {
          const file = await ws.readFile(
            c.side === 'old' ? sides.from.tree : sides.to.tree,
            p.placement.path,
          );
          currentLines.set(key, splitLines(file?.content ?? ''));
        }
        code = currentLines.get(key)!.slice(at.start - 1, at.end);
      }
      comments.push({
        id: c.id,
        reviewId: c.reviewId!,
        kind: 'line',
        path: p.placement.path ?? c.path,
        side: c.side,
        original: {
          startLine: c.startLine,
          endLine: c.endLine,
          code: p.originalCode,
        },
        current: {
          state: p.placement.state,
          startLine: at?.start ?? null,
          endLine: at?.end ?? null,
          code,
          reason: p.placement.reason,
        },
        body: c.body,
      });
    }

    const at = now();
    this.db.transaction(() => {
      for (const r of reviewRows) {
        this.db.run(
          'insert into feedback_fetches (review_id, workspace_id, agent_id, fetched_at) values (?, ?, ?, ?)',
          r.id,
          ws.id,
          input.agentId ?? null,
          at,
        );
        this.db.run(
          `update notifications set status = 'fetched', fetched_at = ? where review_id = ? and workspace_id = ? and status != 'fetched'`,
          at,
          r.id,
          ws.id,
        );
      }
    });
    if (reviewRows.length > 0)
      this.emit({ type: 'reviews-changed', reviewSessionId: rsId });

    return {
      reviewSessionId: rsId,
      workspace: { id: ws.id, root: ws.root, baseRef: base_ref },
      reviews: reviewRows.map((r) => ({
        id: r.id,
        submittedAt: r.submitted_at,
      })),
      comments,
    };
  }

  // Turn snapshots

  private latestSnapshot(wsId: string): SnapshotInfo | null {
    const row = this.db.get<Row>(
      'select * from turn_snapshots where workspace_id = ? order by seq desc limit 1',
      wsId,
    );
    return row ? toSnapshot(row) : null;
  }

  private snapshotById(wsId: string, id: number): SnapshotInfo {
    const row = this.db.get<Row>(
      'select * from turn_snapshots where workspace_id = ? and id = ?',
      wsId,
      id,
    );
    if (!row) throw new HttpError(404, `Unknown snapshot ${id}`);
    return toSnapshot(row);
  }

  snapshots(wsId: string): SnapshotInfo[] {
    return this.db
      .all<Row>(
        'select * from turn_snapshots where workspace_id = ? order by seq desc limit 100',
        wsId,
      )
      .map(toSnapshot);
  }

  async createSnapshot(
    ws: GitWorkspace,
    reason: string,
    agentId: string | null,
  ): Promise<SnapshotInfo> {
    const seq =
      (this.db.get<{ m: number | null }>(
        'select max(seq) as m from turn_snapshots where workspace_id = ?',
        ws.id,
      )!.m ?? 0) + 1;
    const ref = `refs/agent-diff/${ws.id}/snapshots/${seq}`;
    const { commit } = await ws.createSnapshot(
      ref,
      `agent-diff turn snapshot ${seq} (${reason}${agentId ? `, ${agentId}` : ''})`,
    );
    this.db.run(
      'insert into turn_snapshots (workspace_id, seq, commit_sha, ref, agent_id, reason, created_at) values (?, ?, ?, ?, ?, ?, ?)',
      ws.id,
      seq,
      commit,
      ref,
      agentId,
      reason,
      now(),
    );
    const snapshot = this.latestSnapshot(ws.id)!;
    this.emit({ type: 'snapshot-created', workspaceId: ws.id, snapshot });
    return snapshot;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = {
      ...this.settings,
      ...patch,
      reanchor: { ...this.settings.reanchor, ...(patch.reanchor ?? {}) },
    };
    this.emit({ type: 'state-changed' });
    return this.settings;
  }
}

function notificationMessage(rsId: string, root: string): string {
  return `agent-diff: review feedback is ready for ${path.basename(root)} (review session ${rsId}). Run \`${cliCommand} feedback --workspace ${root}\` and address each comment.`;
}

function unplaceable(reason: string): Placement {
  return {
    state: 'outdated',
    range: null,
    replacement: null,
    insertAfter: null,
    similarity: null,
    reason,
    path: null,
  };
}

function toComment(r: Row): CommentRecord {
  return {
    id: r.id as string,
    reviewSessionId: r.review_session_id as string,
    reviewId: r.review_id as string | null,
    workspaceId: r.workspace_id as string | null,
    path: r.path as string | null,
    side: r.side as Side | null,
    startLine: r.start_line as number | null,
    endLine: r.end_line as number | null,
    fileVersion: r.file_version as string | null,
    diffMode: r.diff_mode as DiffMode | null,
    body: r.body as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toNotification(r: Row): NotificationInfo {
  return {
    id: r.id as string,
    reviewId: r.review_id as string,
    agentId: r.agent_id as string | null,
    workspaceId: r.workspace_id as string,
    method: r.method as string,
    message: r.message as string,
    status: r.status as NotificationStatus,
    error: r.error as string | null,
    createdAt: r.created_at as string,
    sentAt: r.sent_at as string | null,
    fetchedAt: r.fetched_at as string | null,
  };
}

function toSnapshot(r: Row): SnapshotInfo {
  return {
    id: r.id as number,
    workspaceId: r.workspace_id as string,
    seq: r.seq as number,
    commit: r.commit_sha as string,
    ref: r.ref as string,
    agentId: r.agent_id as string | null,
    reason: r.reason as string,
    createdAt: r.created_at as string,
  };
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

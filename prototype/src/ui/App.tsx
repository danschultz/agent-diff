import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { splitLines } from '../shared/reanchor.ts';
import {
  DIFF_MODES,
  type ChangedFile,
  type DiffMode,
  type FileDiffResponse,
  type FileListResponse,
  type PlacedComment,
  type ReviewInfo,
  type ServerEvent,
  type Settings,
  type SnapshotInfo,
  type WorkspaceChangedEvent,
} from '../shared/types.ts';
import { api, type AppState } from './api.ts';
import { CommentsPanel, lineLabel } from './CommentsPanel.tsx';
import { Composer } from './Composer.tsx';
import { FileSection } from './FileSection.tsx';
import { FileView, treeOrder } from './FileView.tsx';
import {
  MetricsPanel,
  type ReloadMetric,
  type RenderMetric,
} from './MetricsPanel.tsx';
import { VIEWERS, type ViewerId } from './viewers/index.ts';
import type { Layout, LineSelection, RevealTarget } from './viewers/types.ts';

type ChangePolicy = 'live' | 'notice';
/** `file` is the diff's path; `path` and `hash` are the side being commented on, which differ for renames. */
type Selection = LineSelection & { file: string; path: string; hash: string };

interface FileFlags {
  viewed: Record<string, boolean>;
  /** Explicit expand/collapse. Files without an entry are collapsed when viewed. */
  collapsed: Record<string, boolean>;
}

const initial = new URLSearchParams(location.search);
const PANEL_KEY = 'agent-diff:panel-open';
const flagsKey = (rsId: string) => `agent-diff:review-session:${rsId}:files`;

function loadFlags(rsId: string | null): FileFlags {
  if (!rsId) return { viewed: {}, collapsed: {} };
  try {
    const stored = JSON.parse(localStorage.getItem(flagsKey(rsId)) ?? 'null');
    if (stored)
      return { viewed: stored.viewed ?? {}, collapsed: stored.collapsed ?? {} };
  } catch {}
  return { viewed: {}, collapsed: {} };
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [rsId, setRsId] = useState<string | null>(initial.get('rs'));
  const [wsId, setWsId] = useState<string | null>(initial.get('ws'));
  const [mode, setMode] = useState<DiffMode>(
    (initial.get('mode') as DiffMode) ?? 'all',
  );
  const [snapshotId, setSnapshotId] = useState<number | null>(null);
  const [viewer, setViewer] = useState<ViewerId>(
    (initial.get('viewer') as ViewerId) ?? 'basic',
  );
  const [layout, setLayout] = useState<Layout>(
    (initial.get('layout') as Layout) ?? 'unified',
  );
  const [wrap, setWrap] = useState(initial.get('wrap') === '1');
  const [policy, setPolicy] = useState<ChangePolicy>('live');
  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem(PANEL_KEY) !== 'false',
  );
  const [files, setFiles] = useState<FileListResponse | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, FileDiffResponse>>({});
  const [flags, setFlags] = useState<FileFlags>(() =>
    loadFlags(initial.get('rs')),
  );
  const [activePath, setActivePath] = useState<string | null>(null);
  const [comments, setComments] = useState<PlacedComment[]>([]);
  const [reviews, setReviews] = useState<ReviewInfo[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [reveal, setReveal] = useState<
    (RevealTarget & { file: string }) | null
  >(null);
  const [pendingChanges, setPendingChanges] = useState<WorkspaceChangedEvent[]>(
    [],
  );
  const [reloads, setReloads] = useState<ReloadMetric[]>([]);
  const [renders, setRenders] = useState<RenderMetric[]>([]);
  const [connected, setConnected] = useState(false);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);

  const rs = state?.reviewSessions.find((r) => r.id === rsId) ?? null;
  const ws = rs?.workspaces.find((w) => w.id === wsId) ?? null;

  // Pick defaults once the state arrives.
  useEffect(() => {
    if (!state) return;
    if (!rs) {
      const first =
        state.reviewSessions.find((r) => r.status === 'open') ??
        state.reviewSessions[0];
      if (first) setRsId(first.id);
    } else if (!ws && rs.workspaces[0]) {
      setWsId(rs.workspaces[0].id);
    }
  }, [state, rs, ws]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (rsId) params.set('rs', rsId);
    if (wsId) params.set('ws', wsId);
    params.set('mode', mode);
    params.set('viewer', viewer);
    params.set('layout', layout);
    if (wrap) params.set('wrap', '1');
    history.replaceState(null, '', `?${params}`);
  }, [rsId, wsId, mode, viewer, layout, wrap]);

  useEffect(
    () => localStorage.setItem(PANEL_KEY, String(panelOpen)),
    [panelOpen],
  );

  const flagsFor = useRef(rsId);
  useEffect(() => {
    if (flagsFor.current !== rsId) {
      flagsFor.current = rsId;
      setFlags(loadFlags(rsId));
    }
  }, [rsId]);
  useEffect(() => {
    if (rsId && flagsFor.current === rsId)
      localStorage.setItem(flagsKey(rsId), JSON.stringify(flags));
  }, [rsId, flags]);

  const ordered = useMemo(() => (files ? treeOrder(files.files) : []), [files]);
  const isCollapsed = (path: string) =>
    flags.collapsed[path] ?? !!flags.viewed[path];

  // Loaders. Each ignores responses that arrive after a newer request.
  const seq = useRef({ files: 0, comments: 0 });
  const ctx = useRef({ rsId, wsId, mode, snapshotId });
  ctx.current = { rsId, wsId, mode, snapshotId };
  const filesRef = useRef(files);
  filesRef.current = files;
  const diffsRef = useRef(diffs);
  diffsRef.current = diffs;

  const loadState = useCallback(async () => setState(await api.state()), []);

  const loadFiles = useCallback(async () => {
    if (!rsId || !wsId) return null;
    const n = ++seq.current.files;
    try {
      const result = await api.files(rsId, wsId, mode, snapshotId);
      if (n !== seq.current.files) return null;
      setFiles(result);
      setFilesError(null);
      return result;
    } catch (e) {
      if (n === seq.current.files) {
        setFiles(null);
        setFilesError((e as Error).message);
      }
      return null;
    }
  }, [rsId, wsId, mode, snapshotId]);

  // File diffs are fetched per file as their sections near the viewport.
  const diffSeq = useRef(new Map<string, number>());
  const requested = useRef(new Set<string>());
  const near = useRef(new Set<string>());

  const fetchDiff = useCallback(async (path: string) => {
    const { rsId, wsId, mode, snapshotId } = ctx.current;
    if (!rsId || !wsId) return null;
    const n = (diffSeq.current.get(path) ?? 0) + 1;
    diffSeq.current.set(path, n);
    const oldPath =
      filesRef.current?.files.find((f) => f.path === path)?.oldPath ?? null;
    try {
      const result = await api.file(
        rsId,
        wsId,
        mode,
        path,
        oldPath,
        snapshotId,
      );
      if (diffSeq.current.get(path) !== n) return null;
      setDiffs((prev) => ({ ...prev, [path]: result }));
      return result;
    } catch {
      return null;
    }
  }, []);

  const needDiff = useCallback(
    (path: string) => {
      if (requested.current.has(path)) return;
      requested.current.add(path);
      void fetchDiff(path);
    },
    [fetchDiff],
  );

  const onNear = useCallback((path: string, isNear: boolean) => {
    if (isNear) near.current.add(path);
    else near.current.delete(path);
  }, []);

  /** Refetches the diffs near the viewport and forgets the rest, which reload when they're scrolled to. */
  const refreshDiffs = useCallback(async () => {
    const loaded = Object.keys(diffsRef.current);
    const far = loaded.filter((p) => !near.current.has(p));
    for (const p of far) {
      requested.current.delete(p);
      diffSeq.current.set(p, (diffSeq.current.get(p) ?? 0) + 1);
    }
    if (far.length)
      setDiffs((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([p]) => !far.includes(p)),
        ),
      );
    return Promise.all(
      loaded.filter((p) => near.current.has(p)).map(fetchDiff),
    );
  }, [fetchDiff]);

  useEffect(() => {
    requested.current.clear();
    diffSeq.current.clear();
    setDiffs({});
    setSelection(null);
  }, [rsId, wsId, mode, snapshotId]);

  const loadComments = useCallback(async () => {
    if (!rsId) return;
    const n = ++seq.current.comments;
    const result = await api.comments(rsId, mode, snapshotId).catch(() => null);
    if (result && n === seq.current.comments) setComments(result);
  }, [rsId, mode, snapshotId]);

  const loadReviews = useCallback(async () => {
    if (rsId) setReviews(await api.reviews(rsId).catch(() => []));
  }, [rsId]);

  const loadSnapshots = useCallback(async () => {
    if (rsId && wsId)
      setSnapshots(await api.snapshots(rsId, wsId).catch(() => []));
  }, [rsId, wsId]);

  useEffect(() => void loadState(), [loadState]);
  useEffect(() => {
    setPendingChanges([]);
    void loadFiles();
    void loadComments();
  }, [loadFiles, loadComments]);
  useEffect(() => void loadReviews(), [loadReviews]);
  useEffect(() => void loadSnapshots(), [loadSnapshots]);

  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;

  const refreshAfterChange = useCallback(
    async (events: WorkspaceChangedEvent[]) => {
      const [, , refreshed] = await Promise.all([
        loadFiles(),
        loadComments(),
        refreshDiffs(),
      ]);
      const fetchTimes = refreshed.flatMap((d) =>
        d ? [d.timingMs.total] : [],
      );
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const painted = Date.now();
          const metrics = events.map<ReloadMetric>((e) => ({
            at: painted,
            rawEvents: e.rawEventCount,
            paths: e.pathCount,
            ignored: e.ignoredCount,
            gitMetadata: e.gitMetadata,
            detectMs: e.flushedAt - e.firstEventAt,
            refreshMs: painted - e.flushedAt,
            totalMs: painted - e.firstEventAt,
            fetchMs: fetchTimes.length ? Math.max(...fetchTimes) : null,
            viewer: viewerRef.current,
            sample: e.paths.slice(0, 3),
          }));
          setReloads((prev) => [...metrics, ...prev].slice(0, 50));
          metrics.forEach((m) => api.metric({ kind: 'reload', ...m }));
        }),
      );
    },
    [loadFiles, loadComments, refreshDiffs],
  );

  // Server events. The handler is read through a ref so the EventSource is created once.
  const handler = useRef<(event: ServerEvent) => void>(() => undefined);
  handler.current = (event) => {
    switch (event.type) {
      case 'workspace-changed':
        if (event.workspaceId !== wsId) {
          void loadComments();
          return;
        }
        if (policy === 'notice') setPendingChanges((prev) => [...prev, event]);
        else void refreshAfterChange([event]);
        return;
      case 'comments-changed':
        if (event.reviewSessionId !== rsId) return;
        void loadComments();
        void refreshDiffs();
        void loadFiles();
        return;
      case 'reviews-changed':
        if (event.reviewSessionId === rsId) void loadReviews();
        return;
      case 'state-changed':
        void loadState();
        void loadReviews();
        return;
      case 'snapshot-created':
        if (event.workspaceId !== wsId) return;
        void loadSnapshots();
        if (mode === 'last-turn' && snapshotId === null) {
          void loadFiles();
          void refreshDiffs();
          void loadComments();
        }
        return;
    }
  };

  // Closed on pagehide: pages kept in the back/forward cache otherwise hold their
  // stream open, and a few of them use up the browser's six connections per host.
  useEffect(() => {
    let es: EventSource | null = null;
    const open = () => {
      es?.close();
      es = new EventSource('/api/events');
      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);
      es.onmessage = (msg) =>
        handler.current(JSON.parse(msg.data) as ServerEvent);
    };
    const close = () => {
      es?.close();
      es = null;
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) open();
    };
    open();
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pagehide', close);
      window.removeEventListener('pageshow', onShow);
      close();
    };
  }, []);

  const onRendered = useCallback((path: string, ms: number) => {
    const content = diffsRef.current[path]?.new.content;
    const lines = content ? splitLines(content).length : 0;
    setRenders((prev) =>
      [{ viewer: viewerRef.current, ms, lines }, ...prev].slice(0, 30),
    );
  }, []);

  const onSelectLines = useCallback((file: string, sel: LineSelection) => {
    const diff = diffsRef.current[file];
    if (!diff) return;
    const hash = sel.side === 'new' ? diff.new.hash : diff.old.hash;
    if (!hash) return;
    setSelection({
      ...sel,
      file,
      path: sel.side === 'old' ? (diff.oldPath ?? diff.path) : diff.path,
      hash,
    });
  }, []);

  const sections = useRef(new Map<string, HTMLElement>());
  const register = useCallback((path: string, el: HTMLElement | null) => {
    if (el) sections.current.set(path, el);
    else sections.current.delete(path);
  }, []);

  const toggleCollapsed = useCallback((path: string) => {
    setFlags((prev) => {
      const collapsed = prev.collapsed[path] ?? !!prev.viewed[path];
      return { ...prev, collapsed: { ...prev.collapsed, [path]: !collapsed } };
    });
  }, []);

  const toggleViewed = useCallback(
    (path: string) => {
      setFlags((prev) => {
        const viewed = { ...prev.viewed };
        if (viewed[path]) delete viewed[path];
        else viewed[path] = true;
        const collapsed = { ...prev.collapsed };
        delete collapsed[path];
        return { viewed, collapsed };
      });
      // Keep the next file in place rather than jumping when this one collapses.
      const el = sections.current.get(path);
      if (
        el &&
        scrollRoot &&
        el.getBoundingClientRect().top < scrollRoot.getBoundingClientRect().top
      ) {
        requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
      }
    },
    [scrollRoot],
  );

  const setAllCollapsed = (collapsed: boolean) =>
    setFlags((prev) => ({
      ...prev,
      collapsed: Object.fromEntries(ordered.map((f) => [f.path, collapsed])),
    }));

  const scrollToFile = (path: string) => {
    setFlags((prev) =>
      (prev.collapsed[path] ?? !!prev.viewed[path])
        ? { ...prev, collapsed: { ...prev.collapsed, [path]: false } }
        : prev,
    );
    requestAnimationFrame(() =>
      sections.current.get(path)?.scrollIntoView({ block: 'start' }),
    );
  };

  const jumpToComment = (c: PlacedComment) => {
    if (c.workspaceId && c.workspaceId !== wsId) setWsId(c.workspaceId);
    const file =
      c.side === 'old' && files
        ? (files.files.find((f) => f.oldPath === c.path)?.path ?? c.path)
        : (c.placement?.path ?? c.path);
    if (!file || !c.side) return;
    const p = c.placement;
    const line =
      p?.range?.end ?? p?.replacement?.end ?? p?.insertAfter ?? c.endLine ?? 1;
    scrollToFile(file);
    const key = Date.now();
    setReveal({
      file,
      commentId: c.id,
      side: c.side,
      line: Math.max(1, line),
      key,
    });
    setTimeout(() => setReveal((r) => (r?.key === key ? null : r)), 3000);
  };

  // The file whose header is at the top of the diff, for the file viewer.
  useEffect(() => {
    if (!scrollRoot) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scrollRoot.getBoundingClientRect().top + 8;
      let current: string | null = null;
      for (const f of ordered) {
        const el = sections.current.get(f.path);
        if (!el) continue;
        current = f.path;
        if (el.getBoundingClientRect().bottom > top) break;
      }
      setActivePath(current);
    };
    const onScroll = () => (frame ||= requestAnimationFrame(update));
    update();
    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scrollRoot, ordered]);

  const updateSettings = async (patch: Partial<Settings>) => {
    await api.updateSettings(patch);
    await loadState();
    void loadComments();
    void refreshDiffs();
  };

  const saveDraft = useCallback(async () => {
    if (!selection || !rsId || !wsId) return;
    await api.createComment(rsId, {
      workspaceId: wsId,
      path: selection.path,
      side: selection.side,
      startLine: selection.start,
      endLine: selection.end,
      versionHash: selection.hash,
      mode,
      body: draftBody,
    });
    setSelection(null);
    setDraftBody('');
  }, [selection, rsId, wsId, mode, draftBody]);

  const canComment = rs?.status === 'open';
  const composer = useMemo(
    () =>
      selection && canComment ? (
        <Composer
          label={`${selection.path}, ${selection.side === 'old' ? 'removed side' : 'new side'}, ${lineLabel(selection.start, selection.end)}`}
          body={draftBody}
          onChange={setDraftBody}
          onSave={saveDraft}
          onCancel={() => setSelection(null)}
        />
      ) : null,
    [selection, canComment, draftBody, saveDraft],
  );

  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const f of ordered) {
      added += f.added ?? 0;
      removed += f.removed ?? 0;
    }
    return {
      added,
      removed,
      viewed: ordered.filter((f) => flags.viewed[f.path]).length,
    };
  }, [ordered, flags.viewed]);

  if (!state)
    return <div className="loading">Connecting to the review server…</div>;

  if (!rs) {
    return (
      <div className="empty-app">
        <h1>agent-diff</h1>
        <p>No review sessions yet. Start one from a repo:</p>
        <code>{state.cli} start</code>
      </div>
    );
  }

  const changedHere = pendingChanges.flatMap((e) => e.paths);

  return (
    <div className={`app${panelOpen ? ' panel-open' : ''}`}>
      <header>
        <div className="brand">
          agent-diff{' '}
          <span
            className={`conn ${connected ? 'on' : 'off'}`}
            title={connected ? 'Live' : 'Disconnected'}
          />
        </div>
        {state.reviewSessions.length > 1 && (
          <select
            value={rsId ?? ''}
            onChange={(e) => (setRsId(e.target.value), setWsId(null))}
          >
            {state.reviewSessions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} {r.status === 'ended' ? '(ended)' : ''} {r.title ?? ''}
              </option>
            ))}
          </select>
        )}
        <select value={wsId ?? ''} onChange={(e) => setWsId(e.target.value)}>
          {rs.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.root.split('/').pop()} · {w.branch ?? 'detached'} vs{' '}
              {w.baseRef}
            </option>
          ))}
        </select>
        <div className="segmented">
          {DIFF_MODES.map((m) => (
            <button
              key={m.mode}
              className={mode === m.mode ? 'active' : ''}
              title={m.compares}
              onClick={() => setMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode === 'last-turn' && (
          <select
            value={snapshotId ?? ''}
            onChange={(e) =>
              setSnapshotId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">Latest snapshot</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.seq} {s.reason}{' '}
                {s.agentId ? `(${s.agentId.slice(0, 8)})` : ''}{' '}
                {new Date(s.createdAt).toLocaleTimeString()}
              </option>
            ))}
          </select>
        )}
        <div className="spacer" />
        <label className="control">
          Viewer
          <select
            value={viewer}
            onChange={(e) => setViewer(e.target.value as ViewerId)}
          >
            {VIEWERS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented small">
          <button
            className={layout === 'unified' ? 'active' : ''}
            onClick={() => setLayout('unified')}
          >
            Unified
          </button>
          <button
            className={layout === 'split' ? 'active' : ''}
            onClick={() => setLayout('split')}
          >
            Split
          </button>
        </div>
        <div className="segmented small">
          <button
            className={wrap ? 'active' : ''}
            aria-pressed={wrap}
            title="Wrap long lines"
            onClick={() => setWrap(!wrap)}
          >
            Wrap
          </button>
        </div>
        <label
          className="control"
          title="What happens when code changes while you're reading it"
        >
          On change
          <select
            value={policy}
            onChange={(e) => setPolicy(e.target.value as ChangePolicy)}
          >
            <option value="live">Update in place</option>
            <option value="notice">Show a notice</option>
          </select>
        </label>
        {rs.status === 'open' ? (
          <button
            onClick={async () => {
              if (confirm(`End review session ${rs.id}?`)) {
                await api.endReviewSession(rs.id);
                await loadState();
              }
            }}
          >
            End review session
          </button>
        ) : (
          <span className="badge">ended</span>
        )}
        <button
          className={`icon-button panel-toggle${panelOpen ? ' active' : ''}`}
          title={
            panelOpen ? 'Hide files and comments' : 'Show files and comments'
          }
          aria-pressed={panelOpen}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect
              x="1.5"
              y="2.5"
              width="13"
              height="11"
              rx="1.5"
              fill="none"
              stroke="currentColor"
            />
            <rect
              x="9.5"
              y="3"
              width="4.5"
              height="10"
              fill="currentColor"
              opacity={panelOpen ? 0.9 : 0.25}
            />
          </svg>
        </button>
      </header>

      <main>
        {pendingChanges.length > 0 && (
          <div className="change-notice">
            Code changed in {new Set(changedHere).size} file(s).
            <button
              className="primary"
              onClick={() => {
                const events = pendingChanges;
                setPendingChanges([]);
                void refreshAfterChange(events);
              }}
            >
              Refresh
            </button>
          </div>
        )}
        <div className="diff-summary">
          {files && (
            <span className="sides">
              {files.from.label} → {files.to.label}
            </span>
          )}
          <span>
            {ordered.length} file{ordered.length === 1 ? '' : 's'} ·{' '}
            <span className="added">+{totals.added}</span>{' '}
            <span className="removed">−{totals.removed}</span> · {totals.viewed}{' '}
            of {ordered.length} viewed
          </span>
          <span className="spacer" />
          <span className="viewer-notes">
            {VIEWERS.find((v) => v.id === viewer)!.notes}
          </span>
          <button onClick={() => setAllCollapsed(false)}>Expand all</button>
          <button onClick={() => setAllCollapsed(true)}>Collapse all</button>
        </div>
        <div className="diff-scroll" ref={setScrollRoot}>
          {filesError ? (
            <p className="error">{filesError}</p>
          ) : !files ? (
            <p className="empty">Loading…</p>
          ) : ordered.length === 0 ? (
            <p className="empty">No changes in this diff mode.</p>
          ) : (
            ordered.map((file) => (
              <FileSection
                key={file.path}
                file={file}
                diff={diffs[file.path]}
                viewer={viewer}
                layout={layout}
                wrap={wrap}
                collapsed={isCollapsed(file.path)}
                viewed={!!flags.viewed[file.path]}
                active={file.path === activePath}
                selection={selection?.file === file.path ? selection : null}
                composer={selection?.file === file.path ? composer : null}
                reveal={reveal?.file === file.path ? reveal : null}
                scrollRoot={scrollRoot}
                register={register}
                onNeed={needDiff}
                onNear={onNear}
                onToggleCollapsed={toggleCollapsed}
                onToggleViewed={toggleViewed}
                onSelect={onSelectLines}
                onRendered={onRendered}
              />
            ))
          )}
        </div>
      </main>

      {panelOpen && (
        <aside className="side-panel">
          <div className="side-files">
            {files ? (
              <FileView
                files={ordered}
                active={activePath}
                viewed={flags.viewed}
                onSelect={(f: ChangedFile) => scrollToFile(f.path)}
              />
            ) : null}
          </div>
          <CommentsPanel
            comments={comments}
            reviews={reviews}
            agents={state.agents.filter((a) =>
              rs.workspaces.some((w) => a.workspaceIds.includes(w.id)),
            )}
            workspaces={rs.workspaces}
            canComment={canComment}
            onCreateOverall={async (body) =>
              void (await api.createComment(rs.id, { body }))
            }
            onUpdate={async (id, body) =>
              void (await api.updateComment(id, body))
            }
            onDelete={async (id) => void (await api.deleteComment(id))}
            onSubmit={async () => {
              await api.submitReview(rs.id);
              await loadReviews();
            }}
            onResend={async (id) => {
              await api.resend(id);
              await loadReviews();
            }}
            onJump={jumpToComment}
          />
        </aside>
      )}

      <MetricsPanel
        reloads={reloads}
        renders={renders}
        settings={state.settings}
        onSettings={updateSettings}
      />
    </div>
  );
}

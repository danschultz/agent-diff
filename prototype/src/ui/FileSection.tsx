import { Component, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChangedFile, FileDiffResponse } from '../shared/types.ts';
import { STATUS_LETTER } from './FileView.tsx';
import { VIEWERS, type ViewerId } from './viewers/index.ts';
import type { Layout, LineSelection, RevealTarget } from './viewers/types.ts';

/** Viewers mount when their file is this close to the viewport... */
const MOUNT_MARGIN = '1200px 0px';
/** ...and unmount, keeping their height, once it's this far away. */
const UNMOUNT_MARGIN = '4000px 0px';
const LINE_HEIGHT = 18;

interface Props {
  file: ChangedFile;
  diff: FileDiffResponse | undefined;
  viewer: ViewerId;
  layout: Layout;
  wrap: boolean;
  collapsed: boolean;
  viewed: boolean;
  active: boolean;
  selection: LineSelection | null;
  composer: ReactNode;
  reveal: RevealTarget | null;
  scrollRoot: HTMLElement | null;
  register: (path: string, el: HTMLElement | null) => void;
  onNeed: (path: string) => void;
  onNear: (path: string, near: boolean) => void;
  onToggleCollapsed: (path: string) => void;
  onToggleViewed: (path: string) => void;
  onSelect: (path: string, selection: LineSelection) => void;
  onRendered: (path: string, ms: number) => void;
}

function FileSectionImpl(props: Props) {
  const { file, diff, viewer, layout, wrap, collapsed, viewed, active, selection, composer, reveal, scrollRoot } = props;
  const { register, onNeed, onNear, onToggleCollapsed, onToggleViewed } = props;
  const section = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [mounted, setMounted] = useState(false);
  const lastHeight = useRef<number | null>(null);

  useEffect(() => {
    register(file.path, section.current);
    return () => register(file.path, null);
  }, [file.path, register]);

  useEffect(() => {
    const el = section.current;
    if (!el || !scrollRoot) return;
    // A busy main thread can batch several entries for the element; only the last one is current.
    const mount = new IntersectionObserver((entries) => {
      const { isIntersecting } = entries[entries.length - 1];
      setNear(isIntersecting);
      onNear(file.path, isIntersecting);
      if (isIntersecting) setMounted(true);
    }, { root: scrollRoot, rootMargin: MOUNT_MARGIN });
    const unmount = new IntersectionObserver((entries) => {
      if (!entries[entries.length - 1].isIntersecting) setMounted(false);
    }, { root: scrollRoot, rootMargin: UNMOUNT_MARGIN });
    mount.observe(el);
    unmount.observe(el);
    return () => {
      mount.disconnect();
      unmount.disconnect();
      onNear(file.path, false);
    };
  }, [file.path, scrollRoot, onNear]);

  useEffect(() => {
    if (near && !collapsed && !diff) onNeed(file.path);
  }, [near, collapsed, diff, file.path, onNeed]);

  const showViewer = mounted && !collapsed && diff !== undefined;

  useEffect(() => {
    const el = body.current;
    if (!el || !showViewer) return;
    const observer = new ResizeObserver(() => {
      if (el.offsetHeight > 0) lastHeight.current = el.offsetHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [showViewer]);

  const comments = useMemo(() => {
    if (!diff) return [];
    const oldPath = diff.oldPath ?? diff.path;
    return diff.comments.filter((c) => c.placement?.path && (c.side === 'old' ? c.placement.path === oldPath : c.placement.path === diff.path));
  }, [diff]);

  const onSelect = useCallback((sel: LineSelection) => props.onSelect(file.path, sel), [props.onSelect, file.path]);
  const onRendered = useCallback((ms: number) => props.onRendered(file.path, ms), [props.onRendered, file.path]);

  const estimate = lastHeight.current ?? Math.min(2400, 40 + ((file.added ?? 0) + (file.removed ?? 0) + 6) * LINE_HEIGHT);
  const Viewer = VIEWERS.find((v) => v.id === viewer)!.component;

  let content: ReactNode;
  if (!showViewer) content = <div className="file-placeholder" style={{ height: estimate }} />;
  else if (diff.old.binary || diff.new.binary) content = <p className="empty">Binary file.</p>;
  else if (diff.old.tooLarge || diff.new.tooLarge) content = <p className="empty">File too large to show.</p>;
  else {
    content = (
      <ViewerBoundary key={`${viewer}:${layout}`}>
        <Suspense fallback={<div className="file-placeholder" style={{ height: estimate }} />}>
          <Viewer
            path={diff.path}
            oldText={diff.old.content ?? ''}
            newText={diff.new.content ?? ''}
            layout={layout}
            wrap={wrap}
            comments={comments}
            selection={selection}
            onSelect={onSelect}
            composer={composer}
            reveal={reveal}
            onRendered={onRendered}
          />
        </Suspense>
      </ViewerBoundary>
    );
  }

  return (
    <section ref={section} className={`file-section${collapsed ? ' collapsed' : ''}${active ? ' active' : ''}`} data-path={file.path}>
      <header className="file-section-head">
        <button className="icon-button" title={collapsed ? 'Expand' : 'Collapse'} aria-expanded={!collapsed} onClick={() => onToggleCollapsed(file.path)}>
          {collapsed ? '▸' : '▾'}
        </button>
        <span className={`status status-${file.status}`} title={file.status}>
          {STATUS_LETTER[file.status]}
        </span>
        <span className="file-path" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
          {file.oldPath ? `${file.oldPath} → ` : ''}
          {file.path}
        </span>
        <span className="counts">
          {file.binary ? (
            'binary'
          ) : (
            <>
              {file.added ? <span className="added">+{file.added}</span> : null}
              {file.removed ? <span className="removed">−{file.removed}</span> : null}
            </>
          )}
        </span>
        {file.commentCount > 0 && (
          <span className="comment-count" title="Comments on this file">
            {file.commentCount}
          </span>
        )}
        <span className="spacer" />
        {diff && !collapsed && (
          <span className="timing" title="Server time: git reads, then re-anchoring comments">
            {diff.timingMs.git.toFixed(0)} ms git · {diff.timingMs.reanchor.toFixed(0)} ms re-anchor
          </span>
        )}
        <label className={`viewed-toggle${viewed ? ' on' : ''}`}>
          <input type="checkbox" checked={viewed} onChange={() => onToggleViewed(file.path)} />
          Viewed
        </label>
      </header>
      {!collapsed && (
        <div className="file-section-body" ref={body}>
          {content}
        </div>
      )}
    </section>
  );
}

export const FileSection = memo(FileSectionImpl);

/** Keeps a viewer that throws from taking the rest of the review UI down with it. */
class ViewerBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <p className="error file-error">The viewer failed on this file: {this.state.error.message}</p>;
    return this.props.children;
  }
}

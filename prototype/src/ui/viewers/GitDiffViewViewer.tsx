// @git-diff-view/react: a GitHub-style diff with syntax highlighting,
// multi-line selection, and per-line extension rows for comments.

import { generateDiffFile } from '@git-diff-view/file';
import { DiffModeEnum, DiffViewWithMultiSelect, type DiffViewWithMultiSelectRef } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view-pure.css';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { languageFor } from '../language.ts';
import { CommentCards } from './CommentCards.tsx';
import { commentMarks, type CommentMark, type ViewerProps } from './types.ts';

interface Extend {
  marks: CommentMark[];
  composer: ReactNode;
}

export default function GitDiffViewViewer(props: ViewerProps) {
  const { path, oldText, newText, layout, wrap, comments, selection, onSelect, composer, reveal } = props;
  const renderStart = useRef(0);
  renderStart.current = performance.now();
  const onRendered = useRef(props.onRendered);
  onRendered.current = props.onRendered;
  const host = useRef<HTMLDivElement>(null);
  const diffView = useRef<DiffViewWithMultiSelectRef>(null);

  const diffFile = useMemo(() => {
    const lang = languageFor(path).hljs;
    const file = generateDiffFile(path, oldText, path, newText, lang, lang);
    file.initTheme('dark');
    file.init();
    file.buildSplitDiffLines();
    file.buildUnifiedDiffLines();
    return file;
  }, [path, oldText, newText]);

  const extendData = useMemo(() => {
    const oldFile: Record<string, { data: Extend }> = {};
    const newFile: Record<string, { data: Extend }> = {};
    for (const mark of commentMarks(comments)) {
      const key = String(Math.max(1, mark.afterLine));
      const target = mark.side === 'old' ? oldFile : newFile;
      (target[key] ??= { data: { marks: [], composer: null } }).data.marks.push(mark);
    }
    if (selection) {
      const target = selection.side === 'old' ? oldFile : newFile;
      (target[String(selection.end)] ??= { data: { marks: [], composer: null } }).data.composer = composer;
    }
    return { oldFile, newFile };
  }, [comments, selection, composer]);

  useEffect(() => {
    if (!selection) diffView.current?.setPreselectedLines({ old: [], new: [] });
  }, [selection]);

  // The library's multi-select starts on a native mousedown on the +, but the
  // +'s own React handler then clears it. Stopping the event before React's
  // root listener keeps the drag alive; the selection completes on mouseup.
  useEffect(() => {
    const el = host.current!;
    const stop = (e: MouseEvent) => {
      if ((e.target as Element).closest('.diff-add-widget')) e.stopPropagation();
    };
    el.addEventListener('mousedown', stop);
    return () => el.removeEventListener('mousedown', stop);
  }, []);

  useEffect(() => {
    const start = renderStart.current;
    requestAnimationFrame(() => onRendered.current(performance.now() - start));
  }, [diffFile, layout]);

  useEffect(() => {
    if (!reveal) return;
    const el =
      host.current?.querySelector(`[data-comment-id="${reveal.commentId}"]`) ??
      host.current?.querySelector(`[data-line-${reveal.side}-num="${reveal.line}"], .diff-line-${reveal.side}-num [data-line-num="${reveal.line}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [reveal]);

  return (
    <div className={`gdv-viewer ${layout}`} ref={host}>
      <DiffViewWithMultiSelect<Extend>
        ref={diffView}
        diffFile={diffFile}
        diffViewMode={layout === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
        diffViewTheme="dark"
        diffViewHighlight
        diffViewWrap={wrap}
        diffViewFontSize={12}
        diffViewAddWidget
        extendData={extendData}
        renderExtendLine={({ data }) =>
          // Split layout renders both sides of a row, and the side without data gets undefined.
          data ? (
            <>
              <CommentCards marks={data.marks} />
              {data.composer}
            </>
          ) : null
        }
        onMultiSelectComplete={({ range }) =>
          onSelect({
            side: range.side,
            start: Math.min(range.startLineNumber, range.endLineNumber),
            end: Math.max(range.startLineNumber, range.endLineNumber),
          })
        }
      />
    </div>
  );
}

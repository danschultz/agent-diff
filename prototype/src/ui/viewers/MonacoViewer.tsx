// Monaco's diff editor, bundled locally (no CDN). Comments are line
// decorations plus view zones that hold the comment cards; the composer is a
// view zone that a React portal renders into.

import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Side } from '../../shared/types.ts';
import { languageFor } from '../language.ts';
import { commentCardDom, commentMarks, startLineDrag, type LineSelection, type ViewerProps } from './types.ts';

// Only the base editor worker is bundled, which is enough for syntax
// highlighting. Language services would send requests that worker can't
// answer, so their providers are switched off before any model exists.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
for (const defaults of [
  monaco.typescript.typescriptDefaults,
  monaco.typescript.javascriptDefaults,
  monaco.css.cssDefaults,
  monaco.css.scssDefaults,
  monaco.css.lessDefaults,
  monaco.html.htmlDefaults,
]) {
  defaults.setModeConfiguration({});
}
// JSON's tokenizer lives in its language mode and runs in-process.
monaco.json.jsonDefaults.setModeConfiguration({ tokens: true });

type Editor = monaco.editor.ICodeEditor;

/** Editors taller than this scroll inside themselves. Monaco renders every line within its own height, so a full-height 6,000-line editor would render them all. */
const MAX_HEIGHT = 900;

const { MouseTargetType } = monaco.editor;
const GUTTER_TARGETS = new Set([MouseTargetType.GUTTER_LINE_NUMBERS, MouseTargetType.GUTTER_GLYPH_MARGIN, MouseTargetType.GUTTER_LINE_DECORATIONS]);
const LINE_TARGETS = new Set([...GUTTER_TARGETS, MouseTargetType.CONTENT_TEXT, MouseTargetType.CONTENT_EMPTY]);

export default function MonacoViewer(props: ViewerProps) {
  const { path, oldText, newText, layout, wrap, comments, selection, composer, reveal } = props;
  const host = useRef<HTMLDivElement>(null);
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [composerEl] = useState(() => {
    const el = document.createElement('div');
    el.className = 'monaco-composer';
    // Monaco handles mouse and key events inside its DOM; the composer needs them itself.
    for (const type of ['mousedown', 'pointerdown', 'keydown', 'wheel']) el.addEventListener(type, (e) => e.stopPropagation());
    return el;
  });
  const onSelect = useRef(props.onSelect);
  onSelect.current = props.onSelect;
  const onRendered = useRef(props.onRendered);
  onRendered.current = props.onRendered;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [ready, setReady] = useState(0);
  const [height, setHeight] = useState(200);
  const pickDecorations = useRef<monaco.editor.IEditorDecorationsCollection[]>([]);

  const editorFor = (side: Side): Editor | null => {
    const diff = diffRef.current;
    if (!diff) return null;
    return side === 'old' ? diff.getOriginalEditor() : diff.getModifiedEditor();
  };

  const showPick = (range: LineSelection | null) => {
    pickDecorations.current.forEach((d) => d.clear());
    if (!range) return;
    const editor = editorFor(range.side);
    const d = pickDecorations.current[range.side === 'old' ? 0 : 1];
    if (!editor || !d) return;
    d.set([
      {
        range: new monaco.Range(range.start, 1, range.end, 1),
        options: { isWholeLine: true, className: 'monaco-picked-line', lineNumberClassName: 'monaco-picked-number' },
      },
    ]);
  };

  useEffect(() => {
    const start = performance.now();
    const language = languageFor(path).monaco;
    const original = monaco.editor.createModel(oldText, language);
    const modified = monaco.editor.createModel(newText, language);
    const diff = monaco.editor.createDiffEditor(host.current!, {
      theme: 'vs-dark',
      readOnly: true,
      originalEditable: false,
      renderSideBySide: layout === 'split',
      // Otherwise Monaco switches to the inline view below 900 px wide.
      useInlineViewWhenSpaceIsLimited: false,
      automaticLayout: true,
      glyphMargin: false,
      renderMarginRevertIcon: false,
      renderGutterMenu: false,
      renderOverviewRuler: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      scrollbar: { alwaysConsumeMouseWheel: false },
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 4 },
      fontSize: 12,
      wordWrap: wrap ? 'on' : 'off',
    });
    diff.setModel({ original, modified });
    diffRef.current = diff;

    const disposables: monaco.IDisposable[] = [];
    const editors: [Side, Editor][] = [
      ['old', diff.getOriginalEditor()],
      ['new', diff.getModifiedEditor()],
    ];
    pickDecorations.current = editors.map(([, editor]) => editor.createDecorationsCollection());

    const updateHeight = () => {
      const visible = layout === 'split' ? editors.map(([, e]) => e) : [diff.getModifiedEditor()];
      setHeight(Math.min(MAX_HEIGHT, Math.max(...visible.map((e) => e.getContentHeight()))));
    };

    for (const [side, editor] of editors) {
      const hover = editor.createDecorationsCollection();
      const lineAt = (x: number, y: number) => {
        const target = editor.getTargetAtClientPoint(x, y);
        return target && LINE_TARGETS.has(target.type) && target.position ? target.position.lineNumber : null;
      };
      disposables.push(
        editor.onDidContentSizeChange(updateHeight),
        editor.onMouseMove((e) => {
          const line = GUTTER_TARGETS.has(e.target.type) ? e.target.position?.lineNumber : undefined;
          hover.set(line ? [{ range: new monaco.Range(line, 1, line, 1), options: { lineNumberClassName: 'monaco-add-line' } }] : []);
        }),
        editor.onMouseLeave(() => hover.clear()),
      );
      const dom = editor.getDomNode()!;
      const onPointerDown = (e: PointerEvent) => {
        const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
        if (e.button === 0 && target && GUTTER_TARGETS.has(target.type)) e.stopPropagation();
      };
      const onMouseDown = (e: MouseEvent) => {
        const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
        if (e.button !== 0 || !target || !GUTTER_TARGETS.has(target.type) || !target.position) return;
        e.preventDefault();
        e.stopPropagation();
        startLineDrag({
          side,
          line: target.position.lineNumber,
          lineAt,
          onChange: showPick,
          onEnd: (range) => {
            showPick(selectionRef.current);
            if (range) onSelect.current(range);
          },
        });
      };
      dom.addEventListener('pointerdown', onPointerDown, true);
      dom.addEventListener('mousedown', onMouseDown, true);
      disposables.push({
        dispose: () => {
          dom.removeEventListener('pointerdown', onPointerDown, true);
          dom.removeEventListener('mousedown', onMouseDown, true);
        },
      });
    }
    let first = true;
    disposables.push(
      diff.onDidUpdateDiff(() => {
        updateHeight();
        if (first) onRendered.current(performance.now() - start);
        first = false;
        setReady((n) => n + 1);
      }),
    );
    updateHeight();

    return () => {
      disposables.forEach((d) => d.dispose());
      // The editor has to let go of the models before they're disposed. A diff
      // still running in the worker rejects if its models disappear, so they
      // outlive the editor briefly.
      diff.dispose();
      setTimeout(() => {
        original.dispose();
        modified.dispose();
      }, 5000);
      diffRef.current = null;
    };
  }, [path, oldText, newText, layout, wrap]);

  useEffect(() => {
    const diff = diffRef.current;
    if (!diff) return;
    const marks = commentMarks(comments);
    const cleanup: (() => void)[] = [];
    for (const side of ['old', 'new'] as const) {
      const editor = editorFor(side)!;
      const sideMarks = marks.filter((m) => m.side === side);
      const decorations = editor.createDecorationsCollection(
        sideMarks
          .filter((m) => m.lines)
          .map((m) => ({
            range: new monaco.Range(m.lines!.start, 1, m.lines!.end, 1),
            options: {
              isWholeLine: true,
              className: `monaco-comment-line state-${m.state}`,
              linesDecorationsClassName: `monaco-comment-glyph state-${m.state}`,
              hoverMessage: { value: m.comment.body },
            },
          })),
      );
      const ids: string[] = [];
      editor.changeViewZones((acc) => {
        for (const [afterLine, group] of Map.groupBy(sideMarks, (m) => m.afterLine)) {
          const domNode = commentCardDom(group);
          ids.push(acc.addZone({ afterLineNumber: afterLine, heightInPx: 30 + group.length * 44, domNode }));
        }
      });
      cleanup.push(() => {
        if (!editor.getModel()) return;
        decorations.clear();
        editor.changeViewZones((acc) => ids.forEach((id) => acc.removeZone(id)));
      });
    }
    return () => cleanup.forEach((fn) => fn());
  }, [comments, ready > 0, oldText, newText, layout]);

  useEffect(() => {
    showPick(selection);
    const editor = selection && editorFor(selection.side);
    if (!selection || !editor) return;
    const zone: monaco.editor.IViewZone = { afterLineNumber: selection.end, heightInPx: 120, domNode: composerEl };
    let id = '';
    editor.changeViewZones((acc) => void (id = acc.addZone(zone)));
    const resize = new ResizeObserver(() => {
      const h = (composerEl.firstElementChild as HTMLElement | null)?.offsetHeight;
      if (!h || h + 8 === zone.heightInPx) return;
      zone.heightInPx = h + 8;
      editor.changeViewZones((acc) => acc.layoutZone(id));
    });
    resize.observe(composerEl);
    editor.revealLineInCenterIfOutsideViewport(selection.end);
    return () => {
      resize.disconnect();
      if (editor.getModel()) editor.changeViewZones((acc) => acc.removeZone(id));
    };
  }, [selection, ready > 0, layout, composerEl]);

  useEffect(() => {
    if (!reveal) return;
    const editor = editorFor(reveal.side);
    if (!editor) return;
    editor.revealLineInCenter(reveal.line);
    host.current?.scrollIntoView({ block: 'nearest' });
  }, [reveal, ready > 0]);

  const hasComposer = selection !== null && (layout === 'split' || selection.side === 'new');
  return (
    <div className="monaco-viewer" ref={host} style={{ height }}>
      {hasComposer && composer ? createPortal(composer, composerEl) : null}
    </div>
  );
}

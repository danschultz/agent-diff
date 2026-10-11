// CodeMirror 6 with @codemirror/merge: side-by-side MergeView, or the
// unified merge view. Comments, the line range being picked, and the
// composer are decorations from state fields, which is what CodeMirror
// requires for block widgets. The editors grow to their content and scroll
// with the page; CodeMirror still only renders the lines in view.

import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Side } from '../../shared/types.ts';
import { languageFor } from '../language.ts';
import { lineDiff } from './lineDiff.ts';
import { commentCardDom, commentMarks, startLineDrag, type CommentMark, type LineSelection, type ViewerProps } from './types.ts';

const setMarks = StateEffect.define<CommentMark[]>();
const setPick = StateEffect.define<Pick | null>();

interface Pick {
  range: LineSelection;
  /** Set once the range is committed and the composer is open. */
  composer: HTMLElement | null;
}

class CardsWidget extends WidgetType {
  readonly marks: CommentMark[];
  constructor(marks: CommentMark[]) {
    super();
    this.marks = marks;
  }
  eq(other: CardsWidget) {
    return other.marks.map((m) => m.comment.id + m.state + m.comment.body).join() === this.marks.map((m) => m.comment.id + m.state + m.comment.body).join();
  }
  toDOM() {
    return commentCardDom(this.marks);
  }
}

/** Hosts the React composer. The same element is reused when CodeMirror redraws the widget, so the portal keeps its state. */
class ComposerWidget extends WidgetType {
  readonly el: HTMLElement;
  constructor(el: HTMLElement) {
    super();
    this.el = el;
  }
  eq(other: ComposerWidget) {
    return other.el === this.el;
  }
  toDOM() {
    return this.el;
  }
  destroy() {}
}

const commentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setMarks)) return buildComments(tr.state, effect.value);
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const pickField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setPick)) return buildPick(tr.state, effect.value);
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildComments(state: EditorState, marks: CommentMark[]): DecorationSet {
  const doc = state.doc;
  const ranges: { from: number; deco: Decoration }[] = [];
  for (const m of marks) {
    if (!m.lines) continue;
    for (let n = m.lines.start; n <= Math.min(m.lines.end, doc.lines); n++) {
      ranges.push({ from: doc.line(n).from, deco: Decoration.line({ class: `cm-comment-line state-${m.state}` }) });
    }
  }
  for (const [afterLine, group] of Map.groupBy(marks, (m) => m.afterLine)) {
    const line = afterLine === 0 ? null : doc.line(Math.min(afterLine, doc.lines));
    const pos = line ? line.to : 0;
    ranges.push({ from: pos, deco: Decoration.widget({ widget: new CardsWidget(group), block: true, side: line ? 1 : -1 }) });
  }
  ranges.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) builder.add(r.from, r.from, r.deco);
  return builder.finish();
}

function buildPick(state: EditorState, pick: Pick | null): DecorationSet {
  if (!pick) return Decoration.none;
  const doc = state.doc;
  const builder = new RangeSetBuilder<Decoration>();
  const end = Math.min(pick.range.end, doc.lines);
  for (let n = pick.range.start; n <= end; n++) builder.add(doc.line(n).from, doc.line(n).from, Decoration.line({ class: 'cm-picked-line' }));
  if (pick.composer) {
    // Sorts after the comment cards at the same position.
    const pos = doc.line(end).to;
    builder.add(pos, pos, Decoration.widget({ widget: new ComposerWidget(pick.composer), block: true, side: 2 }));
  }
  return builder.finish();
}

function lineAtY(view: EditorView, y: number): number {
  const block = view.lineBlockAtHeight(y - view.documentTop);
  return view.state.doc.lineAt(Math.min(block.from, view.state.doc.length)).number;
}

export default function CodeMirrorViewer(props: ViewerProps) {
  const { path, oldText, newText, layout, wrap, comments, selection, composer, reveal } = props;
  const host = useRef<HTMLDivElement>(null);
  const views = useRef<{ side: Side; view: EditorView }[]>([]);
  const [composerEl] = useState(() => {
    const el = document.createElement('div');
    el.className = 'cm-composer';
    return el;
  });
  const onSelect = useRef(props.onSelect);
  onSelect.current = props.onSelect;
  const onRendered = useRef(props.onRendered);
  onRendered.current = props.onRendered;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const parent = host.current!;
    const language = new Compartment();
    const diffConfig = { override: lineDiff };

    const showPick = (side: Side, range: LineSelection | null, withComposer: boolean) => {
      for (const v of views.current) {
        const pick = range && v.side === side ? { range, composer: withComposer ? composerEl : null } : null;
        v.view.dispatch({ effects: setPick.of(pick) });
      }
    };

    const common = (side: Side): Extension[] => [
      basicSetup,
      oneDark,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      language.of([]),
      wrap ? EditorView.lineWrapping : [],
      commentField,
      pickField,
    ];

    // EditorView.domEventHandlers only sees events on the content element, not the gutters.
    const onGutterDown = (side: Side, view: EditorView) => (event: MouseEvent) => {
      const el = (event.target as HTMLElement).closest('.cm-lineNumbers .cm-gutterElement');
      if (!el || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      startLineDrag({
        side,
        line: lineAtY(view, event.clientY),
        lineAt: (_x, y) => lineAtY(view, y),
        onChange: (range) => showPick(side, range, false),
        onEnd: (range) => {
          const committed = selectionRef.current;
          showPick(committed?.side ?? side, committed, !!committed);
          if (range) onSelect.current(range);
        },
      });
    };

    let destroy: () => void;
    if (layout === 'split') {
      const merge = new MergeView({
        a: { doc: oldText, extensions: common('old') },
        b: { doc: newText, extensions: common('new') },
        parent,
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: { margin: 3, minSize: 4 },
        diffConfig,
      });
      views.current = [
        { side: 'old', view: merge.a },
        { side: 'new', view: merge.b },
      ];
      destroy = () => merge.destroy();
    } else {
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: newText,
          extensions: [...common('new'), unifiedMergeView({ original: oldText, mergeControls: false, collapseUnchanged: { margin: 3, minSize: 4 }, diffConfig })],
        }),
      });
      views.current = [{ side: 'new', view }];
      destroy = () => view.destroy();
    }

    (LanguageDescription.matchFilename(languages, path) ?? LanguageDescription.matchLanguageName(languages, languageFor(path).hljs, false))
      ?.load()
      .then((support) => views.current.forEach(({ view }) => view.dispatch({ effects: language.reconfigure(support) })))
      .catch(() => undefined);

    const listeners = views.current.map(({ side, view }) => {
      const listener = onGutterDown(side, view);
      view.dom.addEventListener('mousedown', listener, true);
      return () => view.dom.removeEventListener('mousedown', listener, true);
    });

    const resize = new ResizeObserver(() => views.current.forEach(({ view }) => view.requestMeasure()));
    resize.observe(composerEl);
    setReady((n) => n + 1);
    requestAnimationFrame(() => onRendered.current(performance.now() - start));
    return () => {
      listeners.forEach((remove) => remove());
      resize.disconnect();
      destroy();
      views.current = [];
    };
  }, [path, oldText, newText, layout, wrap, composerEl]);

  useEffect(() => {
    const marks = commentMarks(comments);
    for (const { side, view } of views.current) view.dispatch({ effects: setMarks.of(marks.filter((m) => m.side === side)) });
  }, [comments, ready]);

  useEffect(() => {
    for (const { side, view } of views.current) {
      const pick = selection && selection.side === side ? { range: selection, composer: composerEl } : null;
      view.dispatch({ effects: setPick.of(pick) });
    }
  }, [selection, ready, composerEl]);

  useEffect(() => {
    if (!reveal) return;
    const target = views.current.find((v) => v.side === reveal.side) ?? views.current[0];
    if (!target) return;
    const doc = target.view.state.doc;
    const line = doc.line(Math.max(1, Math.min(reveal.line, doc.lines)));
    target.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
  }, [reveal, ready]);

  const hasComposer = selection !== null && views.current.some((v) => v.side === selection.side);
  return (
    <div className="cm-viewer" ref={host}>
      {hasComposer && composer ? createPortal(composer, composerEl) : null}
    </div>
  );
}

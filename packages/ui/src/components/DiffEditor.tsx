// One file's unified diff, from decisions 0012 and 0045: a read-only
// CodeMirror editor showing the new side, with `unifiedMergeView` showing the
// removed lines above the lines that replaced them. It diffs whole lines
// first, keeps 3 lines of context around each change, numbers removed lines
// with their old line numbers, and highlights syntax once the file's
// language has loaded. The editor grows to its content and scrolls with the
// page, and CodeMirror only draws the lines in view.
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { getChunks, getOriginalDoc, unifiedMergeView } from '@codemirror/merge';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  GutterMarker,
  lineNumberWidgetMarker,
  lineNumbers,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { languageFor } from '../language.ts';
import { mergeChanges } from '../mergeChanges.ts';

// The old line numbers of a block of removed lines, one per line, in the
// line number gutter next to the removed lines.
class OldLineNumbers extends GutterMarker {
  readonly first: number;
  readonly last: number;
  constructor(first: number, last: number) {
    super();
    this.first = first;
    this.last = last;
  }
  override eq(other: OldLineNumbers): boolean {
    return other.first === this.first && other.last === this.last;
  }
  override toDOM(): Node {
    const dom = document.createElement('div');
    dom.className = 'cm-oldLineNumbers';
    for (let line = this.first; line <= this.last; line++) {
      dom.appendChild(document.createElement('div')).textContent = String(line);
    }
    return dom;
  }
}

// The unified view puts each chunk's removed lines in a widget at the
// chunk's start in the new side.
const oldLineNumbers = lineNumberWidgetMarker.of((view, _widget, block) => {
  const chunk = getChunks(view.state)?.chunks.find(
    (c) => c.fromB === block.from,
  );
  if (!chunk || chunk.fromA >= chunk.toA) return null;
  const original = getOriginalDoc(view.state);
  return new OldLineNumbers(
    original.lineAt(chunk.fromA).number,
    original.lineAt(chunk.endA).number,
  );
});

export function DiffEditor({
  path,
  oldText,
  newText,
}: {
  path: string;
  oldText: string;
  newText: string;
}) {
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const language = new Compartment();
    const view = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: newText,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lineNumbers(),
          oldLineNumbers,
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          language.of([]),
          unifiedMergeView({
            original: oldText,
            mergeControls: false,
            collapseUnchanged: { margin: 3, minSize: 4 },
            diffConfig: { override: mergeChanges },
          }),
        ],
      }),
    });
    let destroyed = false;
    languageFor(path)
      .then((support) => {
        if (support && !destroyed) {
          view.dispatch({ effects: language.reconfigure(support) });
        }
      })
      // A language that fails to load leaves the file as plain text.
      .catch(() => undefined);
    return () => {
      destroyed = true;
      view.destroy();
    };
  }, [path, oldText, newText]);
  return <div className="diff-editor" ref={parent} />;
}

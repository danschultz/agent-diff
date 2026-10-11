// A small custom viewer built on jsdiff. No syntax highlighting, but it has
// full control over comment placement and line selection, so it's the
// baseline the library viewers are compared against.

import { diffArrays } from 'diff';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { splitLines } from '../../shared/reanchor.ts';
import type { Side } from '../../shared/types.ts';
import { CommentCards } from './CommentCards.tsx';
import { commentMarks, inRange, startLineDrag, type CommentMark, type LineSelection, type ViewerProps } from './types.ts';

const CONTEXT = 3;

interface Row {
  kind: 'ctx' | 'add' | 'del';
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

type Item = { type: 'row'; row: Row } | { type: 'gap'; id: number; rows: Row[] };

export default function BasicViewer(props: ViewerProps) {
  const { oldText, newText, layout, wrap, comments, selection, onSelect, composer, reveal } = props;
  const renderStart = useRef(0);
  renderStart.current = performance.now();
  const onRendered = useRef(props.onRendered);
  onRendered.current = props.onRendered;
  const host = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [drag, setDrag] = useState<LineSelection | null>(null);

  const rows = useMemo(() => buildRows(oldText, newText), [oldText, newText]);
  const marks = useMemo(() => commentMarks(comments), [comments]);
  const keepRanges = useMemo(() => (selection ? [{ side: selection.side, lines: selection, afterLine: selection.end }] : []), [selection]);
  const items = useMemo(() => collapse(rows, expanded, [...marks, ...keepRanges]), [rows, expanded, marks, keepRanges]);

  useLayoutEffect(() => {
    const start = renderStart.current;
    requestAnimationFrame(() => onRendered.current(performance.now() - start));
  }, [rows, layout]);

  useEffect(() => {
    if (!reveal) return;
    const card = host.current?.querySelector(`[data-comment-id="${reveal.commentId}"]`);
    const row = card ?? host.current?.querySelector(`[data-${reveal.side}-line="${reveal.line}"]`);
    row?.scrollIntoView({ block: 'center' });
  }, [reveal]);

  const highlight = (side: Side, n: number | null) =>
    n === null ? null : marks.find((m) => m.side === side && m.lines && n >= m.lines.start && n <= m.lines.end)?.state ?? null;
  const cardsAfter = (side: Side, n: number | null) => (n === null ? [] : marks.filter((m) => m.side === side && m.afterLine === n));
  const composerAfter = (side: Side, n: number | null) => (n !== null && selection?.side === side && selection.end === n ? composer : null);
  const picked = (side: Side, n: number | null) => inRange(drag ?? selection, side, n);

  const lineAt = (side: Side) => (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('tr')?.querySelector(`[data-${side}-line]`);
    if (!el || !host.current?.contains(el)) return null;
    return Number(el.getAttribute(`data-${side}-line`));
  };

  const gutter = (side: Side, n: number | null) => (
    <td className={`ln${picked(side, n) ? ' selected' : ''}`} {...(n === null ? {} : { [`data-${side}-line`]: n })}>
      {n !== null && (
        <button
          className="add-line"
          title="Comment on this line, or drag to select lines"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            startLineDrag({ side, line: n, lineAt: lineAt(side), onChange: setDrag, onEnd: (range) => (setDrag(null), range && onSelect(range)) });
          }}
        >
          +
        </button>
      )}
      {n ?? ''}
    </td>
  );

  const topCards = [...cardsAfter('new', 0), ...cardsAfter('old', 0)];

  if (layout === 'unified') {
    return (
      <div className={`basic-viewer${wrap ? '' : ' nowrap'}`} ref={host}>
        <table>
          <tbody>
            {topCards.length > 0 && <CardRow marks={topCards} span={4} />}
            {items.map((item, i) =>
              item.type === 'gap' ? (
                <GapRow key={`g${item.id}`} count={item.rows.length} span={4} onExpand={() => setExpanded(new Set([...expanded, item.id]))} />
              ) : (
                <Fragment key={i}>
                  <tr className={`row ${item.row.kind} hl-${highlight(item.row.kind === 'del' ? 'old' : 'new', item.row.kind === 'del' ? item.row.oldNo : item.row.newNo) ?? 'none'}`}>
                    {gutter('old', item.row.oldNo)}
                    {gutter('new', item.row.newNo)}
                    <td className="sign">{item.row.kind === 'add' ? '+' : item.row.kind === 'del' ? '−' : ' '}</td>
                    <td className={`code${picked('old', item.row.oldNo) || picked('new', item.row.newNo) ? ' selected' : ''}`}>{item.row.text}</td>
                  </tr>
                  {item.row.kind === 'del' ? (
                    <CardRow marks={cardsAfter('old', item.row.oldNo)} composer={composerAfter('old', item.row.oldNo)} span={4} />
                  ) : (
                    <>
                      <CardRow marks={cardsAfter('new', item.row.newNo)} composer={composerAfter('new', item.row.newNo)} span={4} />
                      {item.row.kind === 'ctx' && <CardRow marks={cardsAfter('old', item.row.oldNo)} composer={composerAfter('old', item.row.oldNo)} span={4} />}
                    </>
                  )}
                </Fragment>
              ),
            )}
          </tbody>
        </table>
      </div>
    );
  }

  const pairs = splitPairs(items);
  return (
    <div className={`basic-viewer split${wrap ? '' : ' nowrap'}`} ref={host}>
      <table>
        <tbody>
          {topCards.length > 0 && <CardRow marks={topCards} span={6} />}
          {pairs.map((pair, i) =>
            'gap' in pair ? (
              <GapRow key={`g${pair.gap.id}`} count={pair.gap.rows.length} span={6} onExpand={() => setExpanded(new Set([...expanded, pair.gap.id]))} />
            ) : (
              <Fragment key={i}>
                <tr className="row">
                  {gutter('old', pair.left?.oldNo ?? null)}
                  <td className={`sign ${pair.left?.kind ?? 'empty'}`}>{pair.left?.kind === 'del' ? '−' : ''}</td>
                  <td className={`code ${pair.left?.kind ?? 'empty'} hl-${highlight('old', pair.left?.oldNo ?? null) ?? 'none'}${picked('old', pair.left?.oldNo ?? null) ? ' selected' : ''}`}>
                    {pair.left?.text ?? ''}
                  </td>
                  {gutter('new', pair.right?.newNo ?? null)}
                  <td className={`sign ${pair.right?.kind ?? 'empty'}`}>{pair.right?.kind === 'add' ? '+' : ''}</td>
                  <td className={`code ${pair.right?.kind ?? 'empty'} hl-${highlight('new', pair.right?.newNo ?? null) ?? 'none'}${picked('new', pair.right?.newNo ?? null) ? ' selected' : ''}`}>
                    {pair.right?.text ?? ''}
                  </td>
                </tr>
                <CardRow
                  marks={[...cardsAfter('old', pair.left?.oldNo ?? null), ...cardsAfter('new', pair.right?.newNo ?? null)]}
                  composer={composerAfter('old', pair.left?.oldNo ?? null) ?? composerAfter('new', pair.right?.newNo ?? null)}
                  span={6}
                />
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function CardRow({ marks, composer, span }: { marks: CommentMark[]; composer?: ReactNode; span: number }) {
  if (marks.length === 0 && !composer) return null;
  return (
    <tr className="card-row">
      <td colSpan={span}>
        <CommentCards marks={marks} />
        {composer}
      </td>
    </tr>
  );
}

function GapRow({ count, span, onExpand }: { count: number; span: number; onExpand: () => void }) {
  return (
    <tr className="gap-row" onClick={onExpand}>
      <td colSpan={span}>⋯ {count} unchanged lines (click to expand)</td>
    </tr>
  );
}

function buildRows(oldText: string, newText: string): Row[] {
  const rows: Row[] = [];
  let o = 1;
  let n = 1;
  for (const change of diffArrays(splitLines(oldText), splitLines(newText))) {
    for (const text of change.value) {
      if (change.added) rows.push({ kind: 'add', oldNo: null, newNo: n++, text });
      else if (change.removed) rows.push({ kind: 'del', oldNo: o++, newNo: null, text });
      else rows.push({ kind: 'ctx', oldNo: o++, newNo: n++, text });
    }
  }
  return rows;
}

type Kept = Pick<CommentMark, 'side' | 'lines' | 'afterLine'>;

/** Collapses long unchanged runs, but never hides lines that have comments or the open composer. */
function collapse(rows: Row[], expanded: Set<number>, marks: Kept[]): Item[] {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.kind !== 'ctx') for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) keep[k] = true;
    const commented = marks.some(
      (m) =>
        (m.side === 'new' && row.newNo !== null && (m.afterLine === row.newNo || (m.lines && row.newNo >= m.lines.start && row.newNo <= m.lines.end))) ||
        (m.side === 'old' && row.oldNo !== null && (m.afterLine === row.oldNo || (m.lines && row.oldNo >= m.lines.start && row.oldNo <= m.lines.end))),
    );
    if (commented) keep[i] = true;
  });
  const items: Item[] = [];
  let gap: Row[] = [];
  let gapId = 0;
  const flush = () => {
    if (gap.length === 0) return;
    const id = gapId++;
    if (gap.length <= 2 || expanded.has(id)) gap.forEach((row) => items.push({ type: 'row', row }));
    else items.push({ type: 'gap', id, rows: gap });
    gap = [];
  };
  rows.forEach((row, i) => {
    if (keep[i]) {
      flush();
      items.push({ type: 'row', row });
    } else {
      gap.push(row);
    }
  });
  flush();
  return items;
}

type Pair = { left: Row | null; right: Row | null } | { gap: Extract<Item, { type: 'gap' }> };

function splitPairs(items: Item[]): Pair[] {
  const pairs: Pair[] = [];
  let dels: Row[] = [];
  let adds: Row[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) pairs.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const item of items) {
    if (item.type === 'gap') {
      flush();
      pairs.push({ gap: item });
    } else if (item.row.kind === 'del') {
      if (adds.length) flush();
      dels.push(item.row);
    } else if (item.row.kind === 'add') {
      adds.push(item.row);
    } else {
      flush();
      pairs.push({ left: item.row, right: item.row });
    }
  }
  flush();
  return pairs;
}

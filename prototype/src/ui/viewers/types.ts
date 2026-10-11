// The contract every diff viewer implements, so they can be swapped in the
// review UI and compared on the same file, comments, and live updates.

import type { ReactNode } from 'react';
import type { AnchorState } from '../../shared/reanchor.ts';
import type { PlacedComment, Side } from '../../shared/types.ts';

export type Layout = 'split' | 'unified';

export interface LineSelection {
  side: Side;
  start: number;
  end: number;
}

/** A request to scroll a comment into view. `key` changes on every request. */
export interface RevealTarget {
  commentId: string;
  side: Side;
  line: number;
  key: number;
}

export interface ViewerProps {
  path: string;
  oldText: string;
  newText: string;
  layout: Layout;
  /** Wrap long lines instead of scrolling horizontally. */
  wrap: boolean;
  /** Comments placed on this file for the current diff mode. */
  comments: PlacedComment[];
  /** The committed line range the composer is open for, if it's in this file. */
  selection: LineSelection | null;
  /** Called when the reviewer picks lines to comment on, by clicking or dragging the + on a line number. */
  onSelect: (selection: LineSelection) => void;
  /** The comment composer, shown after the selection's last line. */
  composer: ReactNode;
  reveal: RevealTarget | null;
  /** Called once the viewer has rendered new content, with how long it took. */
  onRendered: (ms: number) => void;
}

export interface CommentMark {
  comment: PlacedComment;
  state: AnchorState;
  side: Side;
  /** Lines to highlight, or null when the commented lines were removed with no replacement. */
  lines: { start: number; end: number } | null;
  /** The comment card is shown after this line (0 = before the first line). */
  afterLine: number;
}

/** Where each comment shows up, from its placement. Comments with no position are left to the comments panel. */
export function commentMarks(comments: PlacedComment[]): CommentMark[] {
  const marks: CommentMark[] = [];
  for (const comment of comments) {
    const p = comment.placement;
    if (!p || !comment.side) continue;
    const lines = p.range ?? p.replacement;
    if (lines) marks.push({ comment, state: p.state, side: comment.side, lines, afterLine: lines.end });
    else if (p.insertAfter !== null) marks.push({ comment, state: p.state, side: comment.side, lines: null, afterLine: p.insertAfter });
  }
  return marks;
}

export function stateLabel(state: AnchorState): string {
  if (state === 'current') return 'Current';
  if (state === 'moved') return 'Moved';
  return 'Outdated';
}

/** Plain DOM version of a comment card, for viewers that render outside React (Monaco, CodeMirror). */
export function commentCardDom(marks: CommentMark[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'inline-comments';
  for (const mark of marks) {
    const card = document.createElement('div');
    card.className = `comment-card state-${mark.state}${mark.comment.reviewId ? '' : ' draft'}`;
    card.dataset.commentId = mark.comment.id;
    const head = document.createElement('div');
    head.className = 'comment-card-head';
    head.textContent = `${mark.comment.reviewId ? 'Submitted' : 'Draft'} · ${stateLabel(mark.state)}${mark.lines ? '' : ' · lines removed'}`;
    head.title = mark.comment.placement?.reason ?? '';
    const body = document.createElement('div');
    body.className = 'comment-card-body';
    body.textContent = mark.comment.body;
    card.append(head, body);
    root.append(card);
  }
  return root;
}

/**
 * Tracks a press-and-drag across line numbers. `lineAt` maps a pointer
 * position to a line on the drag's side, or null when it's not over one.
 * Escape cancels.
 */
export function startLineDrag(options: {
  side: Side;
  line: number;
  lineAt: (clientX: number, clientY: number) => number | null;
  onChange: (range: LineSelection) => void;
  onEnd: (range: LineSelection | null) => void;
}): void {
  const { side, line, lineAt, onChange, onEnd } = options;
  let current: LineSelection = { side, start: line, end: line };
  onChange(current);
  const move = (e: MouseEvent) => {
    const n = lineAt(e.clientX, e.clientY);
    if (n === null) return;
    const next = { side, start: Math.min(line, n), end: Math.max(line, n) };
    if (next.start !== current.start || next.end !== current.end) onChange((current = next));
  };
  const finish = (range: LineSelection | null) => {
    window.removeEventListener('mousemove', move, true);
    window.removeEventListener('mouseup', up, true);
    window.removeEventListener('keydown', key, true);
    document.body.classList.remove('line-dragging');
    onEnd(range);
  };
  const up = () => finish(current);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') finish(null);
  };
  window.addEventListener('mousemove', move, true);
  window.addEventListener('mouseup', up, true);
  window.addEventListener('keydown', key, true);
  document.body.classList.add('line-dragging');
}

export const inRange = (range: LineSelection | null, side: Side, n: number | null) =>
  n !== null && range !== null && range.side === side && n >= range.start && n <= range.end;

// A diff for @codemirror/merge's `diffConfig.override`. The package diffs
// whole documents character by character and, past its default scan limit,
// gives up and marks everything between the first and last change as changed.
// This matches lines first, like git and the other viewers, and only runs the
// character diff inside each changed block, for the intra-line highlights.

import { Change, diff } from '@codemirror/merge';
import { diffArrays } from 'diff';

/** Lines with their newline, so equal lines are equal text, including a missing final newline. */
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function lineDiff(a: string, b: string): Change[] {
  const changes: Change[] = [];
  let posA = 0;
  let posB = 0;
  let gapA = 0;
  let gapB = 0;
  const flush = () => {
    if (gapA === posA && gapB === posB) return;
    if (gapA === posA || gapB === posB) {
      changes.push(new Change(gapA, posA, gapB, posB));
    } else {
      for (const c of diff(a.slice(gapA, posA), b.slice(gapB, posB), { scanLimit: 500 })) {
        changes.push(new Change(c.fromA + gapA, c.toA + gapA, c.fromB + gapB, c.toB + gapB));
      }
    }
  };
  for (const part of diffArrays(lines(a), lines(b))) {
    const length = part.value.reduce((sum, line) => sum + line.length, 0);
    if (part.added) posB += length;
    else if (part.removed) posA += length;
    else {
      flush();
      posA += length;
      posB += length;
      gapA = posA;
      gapB = posB;
    }
  }
  flush();
  return changes;
}

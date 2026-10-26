// The diff `@codemirror/merge` shows, as its `diffConfig.override`, from
// decision 0045. On its own, the package diffs whole documents character by
// character, and past its scan limit marks everything between the first and
// last change as changed. This matches whole lines first, with the
// whole-line diff from @agent-diff/shared, and runs the character diff only
// inside each block of changed lines, for the highlights within lines.
import { Change, diff } from '@codemirror/merge';
import { lineDiff } from '@agent-diff/shared/line-diff';

export function mergeChanges(a: string, b: string): readonly Change[] {
  return lineDiff(a, b).flatMap((block) => {
    if (block.fromA === block.toA || block.fromB === block.toB) {
      return [new Change(block.fromA, block.toA, block.fromB, block.toB)];
    }
    return diff(
      a.slice(block.fromA, block.toA),
      b.slice(block.fromB, block.toB),
      { scanLimit: 500 },
    ).map(
      (c) =>
        new Change(
          c.fromA + block.fromA,
          c.toA + block.fromA,
          c.fromB + block.fromB,
          c.toB + block.fromB,
        ),
    );
  });
}

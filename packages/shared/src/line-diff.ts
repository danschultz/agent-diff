// The whole-line diff the review UI shows, from decision 0045, which
// re-anchoring will use too (0008). It matches whole lines first, as git
// does, with jsdiff's Myers diff, which grows with the number of changes
// rather than with the product of the two files' lengths.
import { diffArrays } from 'diff';

// A block of lines that differ, as character offsets into each text, with
// the end excluded, as @codemirror/merge's Change has them. Each block starts
// at the start of a line and ends after a newline, or at the end of the text.
// Lines only added have fromA === toA, and lines only removed fromB === toB.
export interface LineChange {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

// Myers' diff takes time that grows with the lines times the lines it adds
// or removes, so it would take minutes on a large file with many changes.
// Lines with no match on the other side are changed whatever else matches,
// so they're left out before diffing, as git does, and lines changed in
// place, such as in a lockfile or a file whose line endings changed, don't
// count. Past this many lines added or removed among the lines left, such
// as when many lines changed order, the diff stops, which takes about
// 300 ms on 50,000 lines, and the lines between the first and last change
// are one change. A changed line counts twice, once removed and once added.
const maxEdits = 1000;

// Lines with their newline, so a missing final newline makes the last line
// differ.
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function length(lines: readonly string[]): number {
  return lines.reduce((sum, line) => sum + line.length, 0);
}

// The blocks of lines that differ between a and b, in order. Added and
// removed lines next to each other are one block.
export function lineDiff(a: string, b: string): LineChange[] {
  const linesA = lines(a);
  const linesB = lines(b);
  // Lines the same at the start and end of both are left out before
  // diffing.
  let start = 0;
  while (
    start < linesA.length &&
    start < linesB.length &&
    linesA[start] === linesB[start]
  ) {
    start++;
  }
  let end = 0;
  while (
    end < linesA.length - start &&
    end < linesB.length - start &&
    linesA[linesA.length - 1 - end] === linesB[linesB.length - 1 - end]
  ) {
    end++;
  }
  const middleA = linesA.slice(start, linesA.length - end);
  const middleB = linesB.slice(start, linesB.length - end);
  const offset = length(linesA.slice(0, start));
  if (middleA.length === 0 && middleB.length === 0) return [];
  const whole = {
    fromA: offset,
    toA: offset + length(middleA),
    fromB: offset,
    toB: offset + length(middleB),
  };
  if (middleA.length === 0 || middleB.length === 0) return [whole];

  // The indexes of the lines that are somewhere on the other side.
  const inA = new Set(middleA);
  const inB = new Set(middleB);
  const keptA = middleA.flatMap((line, i) => (inB.has(line) ? [i] : []));
  const keptB = middleB.flatMap((line, i) => (inA.has(line) ? [i] : []));
  const parts = diffArrays(
    keptA.map((i) => middleA[i]!),
    keptB.map((i) => middleB[i]!),
    { maxEditLength: maxEdits },
  );
  if (parts === undefined) return [whole];

  // Each line's offset in the text, with the end of the middle last.
  const offsets = (middle: readonly string[]) => {
    const result = [offset];
    for (const line of middle) result.push(result.at(-1)! + line.length);
    return result;
  };
  const offsetsA = offsets(middleA);
  const offsetsB = offsets(middleB);
  // The changes are the lines between each pair of matched lines, and
  // before the first and after the last.
  const changes: LineChange[] = [];
  let nextA = 0;
  let nextB = 0;
  const matched = (lineA: number, lineB: number) => {
    if (lineA !== nextA || lineB !== nextB) {
      changes.push({
        fromA: offsetsA[nextA]!,
        toA: offsetsA[lineA]!,
        fromB: offsetsB[nextB]!,
        toB: offsetsB[lineB]!,
      });
    }
    nextA = lineA + 1;
    nextB = lineB + 1;
  };
  // Positions in keptA and keptB.
  let atA = 0;
  let atB = 0;
  for (const part of parts) {
    if (part.added) atB += part.value.length;
    else if (part.removed) atA += part.value.length;
    else {
      for (let i = 0; i < part.value.length; i++) {
        matched(keptA[atA + i]!, keptB[atB + i]!);
      }
      atA += part.value.length;
      atB += part.value.length;
    }
  }
  if (nextA !== middleA.length || nextB !== middleB.length) {
    changes.push({
      fromA: offsetsA[nextA]!,
      toA: offsetsA[middleA.length]!,
      fromB: offsetsB[nextB]!,
      toB: offsetsB[middleB.length]!,
    });
  }
  return changes;
}

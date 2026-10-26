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

// Myers' diff takes time that grows with the lines times the changed lines,
// so with most of a large file changed, such as its line endings, it would
// take minutes. Past this many changed lines, it stops, which takes about
// 300 ms on 50,000 lines, and the lines between the first and last change
// are one change.
const maxChangedLines = 1000;

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
  const parts = diffArrays(middleA, middleB, {
    maxEditLength: maxChangedLines,
  });
  if (parts === undefined) return [whole];

  const changes: LineChange[] = [];
  let posA = offset;
  let posB = offset;
  // Where the current block of added and removed lines started.
  let startA = posA;
  let startB = posB;
  const flush = () => {
    if (startA !== posA || startB !== posB) {
      changes.push({ fromA: startA, toA: posA, fromB: startB, toB: posB });
    }
  };
  for (const part of parts) {
    const partLength = length(part.value);
    if (part.added) posB += partLength;
    else if (part.removed) posA += partLength;
    else {
      flush();
      posA += partLength;
      posB += partLength;
      startA = posA;
      startB = posB;
    }
  }
  flush();
  return changes;
}

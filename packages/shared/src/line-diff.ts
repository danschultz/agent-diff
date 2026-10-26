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

// Lines with their newline, so a missing final newline makes the last line
// differ.
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

// The blocks of lines that differ between a and b, in order. Added and
// removed lines next to each other are one block.
export function lineDiff(a: string, b: string): LineChange[] {
  const changes: LineChange[] = [];
  let posA = 0;
  let posB = 0;
  // Where the current block of added and removed lines started.
  let startA = 0;
  let startB = 0;
  const flush = () => {
    if (startA !== posA || startB !== posB) {
      changes.push({ fromA: startA, toA: posA, fromB: startB, toB: posB });
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
      startA = posA;
      startB = posB;
    }
  }
  flush();
  return changes;
}

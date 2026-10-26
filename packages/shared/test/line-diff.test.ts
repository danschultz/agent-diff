import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineDiff, type LineChange } from '../src/line-diff.ts';

// Each change as the text it replaces and the text it inserts.
function texts(a: string, b: string, changes: readonly LineChange[]) {
  return changes.map((c) => [a.slice(c.fromA, c.toA), b.slice(c.fromB, c.toB)]);
}

test('equal texts have no changes', () => {
  assert.deepEqual(lineDiff('', ''), []);
  assert.deepEqual(lineDiff('one\ntwo\n', 'one\ntwo\n'), []);
});

test('changes are whole lines, with their newlines', () => {
  const a = 'one\ntwo\nthree\n';
  const b = 'one\nTWO\nthree\n';
  assert.deepEqual(lineDiff(a, b), [{ fromA: 4, toA: 8, fromB: 4, toB: 8 }]);
  assert.deepEqual(texts(a, b, lineDiff(a, b)), [['two\n', 'TWO\n']]);
});

test('added and removed lines are empty on the other side', () => {
  const a = 'one\nthree\nfour\n';
  const b = 'one\ntwo\nthree\n';
  assert.deepEqual(texts(a, b, lineDiff(a, b)), [
    ['', 'two\n'],
    ['four\n', ''],
  ]);
});

test('neighbouring added and removed lines are one change', () => {
  const a = 'one\ntwo\nthree\nfour\n';
  const b = 'one\n2\n3\nfour\n';
  assert.deepEqual(texts(a, b, lineDiff(a, b)), [['two\nthree\n', '2\n3\n']]);
});

test('a missing final newline makes the last line differ', () => {
  const a = 'one\ntwo';
  const b = 'one\ntwo\n';
  assert.deepEqual(texts(a, b, lineDiff(a, b)), [['two', 'two\n']]);
});

test('a whole file added or deleted is one change', () => {
  assert.deepEqual(lineDiff('', 'one\ntwo'), [
    { fromA: 0, toA: 0, fromB: 0, toB: 7 },
  ]);
  assert.deepEqual(lineDiff('one\ntwo\n', ''), [
    { fromA: 0, toA: 8, fromB: 0, toB: 0 },
  ]);
});

test('a line that moved is removed in one place and added in another', () => {
  const a = 'a\nb\nc\nd\n';
  const b = 'b\nc\nd\na\n';
  assert.deepEqual(texts(a, b, lineDiff(a, b)), [
    ['a\n', ''],
    ['', 'a\n'],
  ]);
});

// A textbook LCS table for these would hold 50,000 × 50,000 cells, so this
// runs out of time or memory unless the diff grows with the changes.
test(
  'a 50,000-line file with changes spread through it',
  { timeout: 20_000 },
  () => {
    const lines = Array.from({ length: 50_000 }, (_, i) => `line ${i}\n`);
    const changed = lines.map((line, i) =>
      i % 500 === 0 ? `changed ${i}\n` : line,
    );
    // Lines added and removed too, so the two sides have different lengths.
    changed.splice(25_010, 0, 'added\n', 'added\n');
    changed.splice(40_012, 3);
    const a = lines.join('');
    const b = changed.join('');
    const changes = lineDiff(a, b);
    assert.equal(changes.length, 102);
    assert.deepEqual(texts(a, b, changes.slice(0, 2)), [
      ['line 0\n', 'changed 0\n'],
      ['line 500\n', 'changed 500\n'],
    ]);
    // Every change starts and ends on a line boundary.
    for (const c of changes) {
      for (const [text, from, to] of [
        [a, c.fromA, c.toA],
        [b, c.fromB, c.toB],
      ] as const) {
        assert.ok(from === 0 || text[from - 1] === '\n');
        assert.ok(to === from || text[to - 1] === '\n');
      }
    }
  },
);

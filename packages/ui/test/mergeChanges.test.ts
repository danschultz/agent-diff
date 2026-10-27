import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeChanges } from '../src/mergeChanges.ts';

function texts(a: string, b: string, changes: ReturnType<typeof mergeChanges>) {
  return changes.map((c) => [a.slice(c.fromA, c.toA), b.slice(c.fromB, c.toB)]);
}

test('lines only added or removed are one change each', () => {
  const a = 'one\nthree\nfour\n';
  const b = 'one\ntwo\nthree\n';
  assert.deepEqual(texts(a, b, mergeChanges(a, b)), [
    ['', 'two\n'],
    ['four\n', ''],
  ]);
});

test('changed lines get a character diff inside their block only', () => {
  const a = 'same\nconst value = 1;\nsame\n';
  const b = 'same\nconst value = 2;\nsame\n';
  assert.deepEqual(texts(a, b, mergeChanges(a, b)), [['1', '2']]);
});

test('a block far into a large file keeps its offsets', () => {
  const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i}\n`);
  const changed = [...lines];
  changed[15_000] = 'line fifteen thousand\n';
  const a = lines.join('');
  const b = changed.join('');
  const changes = mergeChanges(a, b);
  assert.ok(changes.length > 0);
  const lineStart = a.indexOf('line 15000\n');
  for (const c of changes) {
    assert.ok(
      c.fromA >= lineStart && c.toA <= lineStart + 'line 15000\n'.length,
    );
  }
  // Every other line is unchanged, so applying the changes to a gives b.
  let result = '';
  let at = 0;
  for (const c of changes) {
    result += a.slice(at, c.fromA) + b.slice(c.fromB, c.toB);
    at = c.toA;
  }
  assert.equal(result + a.slice(at), b);
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import { lineDiff } from '../src/ui/viewers/lineDiff.ts';

/** Old-side line numbers CodeMirror marks as changed. */
function changedLines(a: string, b: string, config?: Parameters<typeof Chunk.build>[2]): number[] {
  const docA = Text.of(a.split('\n'));
  const docB = Text.of(b.split('\n'));
  const out: number[] = [];
  for (const chunk of Chunk.build(docA, docB, config)) {
    if (chunk.fromA === chunk.toA) continue;
    for (let n = docA.lineAt(chunk.fromA).number; n <= docA.lineAt(chunk.toA - 1).number; n++) out.push(n);
  }
  return out;
}

function catalog(variant: number): string {
  const out = ['// Generated catalog.', 'export const catalog = ['];
  for (let i = 0; i < 6000; i++) {
    const price = variant && i % 40 === 7 ? 100 + i * 3 : 100 + i * 2;
    out.push(`  { sku: 'SKU-${String(i).padStart(5, '0')}', name: 'Item ${i}', price: ${price} },`);
  }
  out.push('];');
  return out.join('\n') + '\n';
}

describe('CodeMirror line diff', () => {
  it('marks only the changed lines of a long file', () => {
    const a = catalog(0);
    const b = catalog(1);
    const expected = Array.from({ length: 150 }, (_, k) => 40 * k + 7 + 3);
    assert.ok(changedLines(a, b, { scanLimit: 500 }).length > 5000, "the package's default config coarsens this diff");
    assert.deepEqual(changedLines(a, b, { override: lineDiff }), expected);
  });

  it('keeps character-level changes inside a changed line', () => {
    const changes = lineDiff('const a = 1;\nconst b = 2;\n', 'const a = 1;\nconst b = 3;\n');
    assert.deepEqual(
      changes.map((c) => [c.fromA, c.toA, c.fromB, c.toB]),
      [[23, 24, 23, 24]],
    );
  });

  it('handles a missing final newline and insertions at either end', () => {
    for (const [a, b] of [
      ['a\nb', 'a\nb\n'],
      ['a\nb\n', 'x\na\nb\ny\n'],
      ['', 'a\n'],
      ['a\n', ''],
    ]) {
      let rebuilt = '';
      let pos = 0;
      for (const c of lineDiff(a, b)) {
        rebuilt += a.slice(pos, c.fromA) + b.slice(c.fromB, c.toB);
        pos = c.toA;
      }
      assert.equal(rebuilt + a.slice(pos), b, JSON.stringify([a, b]));
    }
  });
});

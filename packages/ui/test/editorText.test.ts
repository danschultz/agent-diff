import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editorTexts } from '../src/editorText.ts';

const text = (value: string) => ({ type: 'text' as const, text: value });

test('a final newline on both sides is left out', () => {
  assert.deepEqual(editorTexts(text('a\nb\n'), text('a\nc\n')), [
    'a\nb',
    'a\nc',
  ]);
});

test('a final newline on only one side is kept, since it changed', () => {
  assert.deepEqual(editorTexts(text('a\nb'), text('a\nb\n')), [
    'a\nb',
    'a\nb\n',
  ]);
  assert.deepEqual(editorTexts(text('a\n'), text('a')), ['a\n', 'a']);
});

test("a side that isn't there is empty, and doesn't keep the other's newline", () => {
  assert.deepEqual(editorTexts(null, text('a\n')), ['', 'a']);
  assert.deepEqual(editorTexts(text('a\n'), null), ['a', '']);
  assert.deepEqual(editorTexts(null, text('a')), ['', 'a']);
});

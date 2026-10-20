import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomSuffix, slugify } from '../src/brief.ts';

test('slugify makes short branch-safe slugs', () => {
  assert.equal(slugify('Add a --version flag!'), 'add-a-version-flag');
  assert.equal(slugify('   '), 'brief');
  const long = slugify(
    'Render the file view as a tree grouped by working directory with counts',
  );
  assert.ok(long.length <= 40, long);
  assert.ok(!long.endsWith('-'));
  assert.equal(long, 'render-the-file-view-as-a-tree-grouped');
});

test('random suffixes are short, branch-safe, and differ each time', () => {
  const a = randomSuffix();
  assert.match(a, /^[0-9a-f]{6}$/);
  assert.notEqual(randomSuffix(), a);
});

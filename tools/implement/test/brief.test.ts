import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingFields, parseBrief, slugify } from '../src/brief.ts';

const complete = `### Goal

Add a --version flag.

### Out of scope

_No response_

### Context

See prototype/src/cli.

### Acceptance criteria

- [ ] \`agent-diff --version\` prints the version.

### Verification

Run \`agent-diff --version\`.

### Escalation criteria

_No response_

### Notes

_No response_`;

test('parses issue form fields and treats "_No response_" as empty', () => {
  const fields = parseBrief(complete);
  assert.equal(fields.get('Goal'), 'Add a --version flag.');
  assert.equal(fields.get('Out of scope'), '');
  assert.equal(fields.get('Verification'), 'Run `agent-diff --version`.');
});

test('keeps unknown ### headings inside the field they appear in', () => {
  const fields = parseBrief(
    '### Goal\n\nDo it.\n\n### Details\n\nMore.\n\n### Acceptance criteria\n\nDone.',
  );
  assert.equal(fields.get('Goal'), 'Do it.\n\n### Details\n\nMore.');
});

test('a complete brief has no missing fields', () => {
  assert.deepEqual(missingFields(complete), []);
});

test('lists required fields that are missing or empty', () => {
  const body = complete
    .replace('Add a --version flag.', '_No response_')
    .replace(/### Verification[\s\S]*?### Escalation/, '### Escalation');
  assert.deepEqual(missingFields(body), ['Goal', 'Verification']);
  assert.deepEqual(missingFields(''), [
    'Goal',
    'Acceptance criteria',
    'Verification',
  ]);
});

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

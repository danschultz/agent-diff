import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as v from 'valibot';
import { HelloInput } from '../src/schemas.ts';

test('hello trims the name', () => {
  assert.deepEqual(v.parse(HelloInput, { name: '  Dan ' }), { name: 'Dan' });
});

test('hello accepts names of 1 to 100 characters', () => {
  assert.ok(v.is(HelloInput, { name: 'D' }));
  assert.ok(v.is(HelloInput, { name: 'D'.repeat(100) }));
});

test('hello rejects empty and long names with readable messages', () => {
  const messages = (name: unknown) =>
    v.safeParse(HelloInput, { name }).issues?.map((issue) => issue.message);
  assert.deepEqual(messages(''), ['The name must not be empty.']);
  assert.deepEqual(messages('   '), ['The name must not be empty.']);
  assert.deepEqual(messages('D'.repeat(101)), [
    'The name must be at most 100 characters.',
  ]);
  assert.deepEqual(messages(42), ['The name must be a string.']);
});

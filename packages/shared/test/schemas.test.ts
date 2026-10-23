import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as v from 'valibot';
import {
  AddWorkingDirectoriesInput,
  ListSessionsInput,
  NewSessionInput,
} from '../src/schemas.ts';

function messages(schema: v.GenericSchema, input: unknown): string[] {
  return v.safeParse(schema, input).issues?.map((issue) => issue.message) ?? [];
}

test('session new trims the title, and accepts no title', () => {
  assert.deepEqual(
    v.parse(NewSessionInput, {
      title: '  Check ',
      workingDirectories: ['/a'],
    }),
    { title: 'Check', workingDirectories: ['/a'] },
  );
  assert.deepEqual(v.parse(NewSessionInput, { workingDirectories: ['/a'] }), {
    workingDirectories: ['/a'],
  });
  assert.ok(
    v.is(NewSessionInput, {
      title: 'T'.repeat(200),
      workingDirectories: ['/a'],
    }),
  );
});

test('session new rejects an empty or long title with readable messages', () => {
  for (const [title, message] of [
    ['', 'The title must not be empty.'],
    ['   ', 'The title must not be empty.'],
    ['T'.repeat(201), 'The title must be at most 200 characters.'],
    [42, 'The title must be a string.'],
  ] as const) {
    assert.deepEqual(
      messages(NewSessionInput, { title, workingDirectories: ['/a'] }),
      [message],
      String(title),
    );
  }
});

test('session new needs at least one working directory', () => {
  assert.deepEqual(messages(NewSessionInput, { workingDirectories: [] }), [
    'Give at least one working directory.',
  ]);
});

test('working directories must be absolute paths', () => {
  for (const schema of [NewSessionInput, AddWorkingDirectoriesInput]) {
    assert.deepEqual(
      messages(schema, {
        id: 's_aaaaaa',
        workingDirectories: ['/a', 'relative/b', ''],
      }),
      [
        "The working directory relative/b isn't an absolute path.",
        "The working directory  isn't an absolute path.",
      ],
    );
  }
});

test('an empty base ref is rejected', () => {
  for (const schema of [NewSessionInput, AddWorkingDirectoriesInput]) {
    assert.deepEqual(
      messages(schema, {
        id: 's_aaaaaa',
        base: '',
        workingDirectories: ['/a'],
      }),
      ['The base ref must not be empty.'],
    );
  }
});

test('session add needs at least one working directory', () => {
  assert.deepEqual(
    messages(AddWorkingDirectoriesInput, {
      id: 's_aaaaaa',
      workingDirectories: [],
    }),
    ['Give at least one working directory.'],
  );
});

test('session list lists only active sessions unless told otherwise', () => {
  assert.deepEqual(v.parse(ListSessionsInput, {}), { all: false });
  assert.deepEqual(v.parse(ListSessionsInput, { all: true }), { all: true });
});

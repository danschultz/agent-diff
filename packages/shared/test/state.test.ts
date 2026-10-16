import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readConfig, serverUrl, statePaths } from '../src/state.ts';

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'agent-diff-shared-'));
}

test('the state directory is under XDG_STATE_HOME', () => {
  assert.deepEqual(statePaths({ XDG_STATE_HOME: '/state' }), {
    dir: '/state/agent-diff',
    config: '/state/agent-diff/config.json',
    database: '/state/agent-diff/agent-diff.db',
  });
});

test('the state directory is under ~/.local/state without XDG_STATE_HOME', () => {
  const expected = path.join(os.homedir(), '.local', 'state', 'agent-diff');
  assert.equal(statePaths({}).dir, expected);
  assert.equal(statePaths({ XDG_STATE_HOME: '' }).dir, expected);
});

test('a relative XDG_STATE_HOME is ignored, as the XDG spec says', () => {
  assert.equal(
    statePaths({ XDG_STATE_HOME: 'state' }).dir,
    path.join(os.homedir(), '.local', 'state', 'agent-diff'),
  );
});

test('readConfig returns undefined before the first start', () => {
  assert.equal(
    readConfig(statePaths({ XDG_STATE_HOME: tempDir() })),
    undefined,
  );
});

test('readConfig returns the saved port', () => {
  const paths = statePaths({ XDG_STATE_HOME: tempDir() });
  mkdirSync(paths.dir);
  writeFileSync(paths.config, '{ "port": 4321 }');
  assert.deepEqual(readConfig(paths), { port: 4321 });
});

test('readConfig ignores a config file that is not valid', () => {
  const paths = statePaths({ XDG_STATE_HOME: tempDir() });
  mkdirSync(paths.dir);
  for (const text of [
    'not json',
    '{}',
    '{ "port": "4321" }',
    '{ "port": 0 }',
  ]) {
    writeFileSync(paths.config, text);
    assert.equal(readConfig(paths), undefined, text);
  }
});

test('serverUrl is on 127.0.0.1', () => {
  assert.equal(serverUrl(4321), 'http://127.0.0.1:4321/');
});

// Runs the commands in-process with @crustjs/testing.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { startReviewServer } from '@agent-diff/server';
import { readConfig, statePaths } from '@agent-diff/shared/state';
import { captureExecute } from '@crustjs/testing';
import { createApp } from '../src/app.ts';
import { notRunningMessage } from '../src/client.ts';
import { saveConfig, tempStateHome } from './helpers.ts';

test('server start without --foreground fails', async (t) => {
  const env = tempStateHome(t);
  const result = await captureExecute(createApp({ env }), ['server', 'start']);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'Error: Only `agent-diff server start --foreground` is supported for now.',
  );
  assert.equal(readConfig(statePaths(env)), undefined);
});

test('server start says so when the review server is already running', async (t) => {
  const env = tempStateHome(t);
  const server = await startReviewServer({ env });
  t.after(() => server.close());

  const result = await captureExecute(createApp({ env }), [
    'server',
    'start',
    '--foreground',
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdout,
    `The review server is already running at ${server.url}`,
  );
  assert.deepEqual(readConfig(statePaths(env)), { port: server.port });
});

test('server hello prints the message and the count', async (t) => {
  const env = tempStateHome(t);
  const server = await startReviewServer({ env });
  t.after(() => server.close());
  const app = createApp({ env });

  assert.deepEqual(await captureExecute(app, ['server', 'hello', 'Dan']), {
    stdout: 'Hello, Dan! (1 greeting)',
    stderr: '',
    exitCode: 0,
  });
  assert.deepEqual(await captureExecute(app, ['server', 'hello', 'Dan']), {
    stdout: 'Hello, Dan! (2 greetings)',
    stderr: '',
    exitCode: 0,
  });
});

test('server hello prints a validation error for an invalid name', async (t) => {
  const env = tempStateHome(t);
  const server = await startReviewServer({ env });
  t.after(() => server.close());

  for (const [name, message] of [
    ['', 'The name must not be empty.'],
    ['D'.repeat(101), 'The name must be at most 100 characters.'],
  ]) {
    assert.deepEqual(
      await captureExecute(createApp({ env }), ['server', 'hello', name]),
      { stdout: '', stderr: `Error: ${message}`, exitCode: 1 },
    );
  }
});

test('server hello fails when the review server has never started', async (t) => {
  const result = await captureExecute(createApp({ env: tempStateHome(t) }), [
    'server',
    'hello',
    'Dan',
  ]);
  assert.deepEqual(result, {
    stdout: '',
    stderr: `Error: ${notRunningMessage}`,
    exitCode: 1,
  });
});

test('server hello fails when nothing listens on the saved port', async (t) => {
  const env = tempStateHome(t);
  // A port that was free a moment ago.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  saveConfig(env, port);

  const result = await captureExecute(createApp({ env }), [
    'server',
    'hello',
    'Dan',
  ]);
  assert.deepEqual(result, {
    stdout: '',
    stderr: `Error: ${notRunningMessage}`,
    exitCode: 1,
  });
});

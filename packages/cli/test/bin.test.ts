// Runs the CLI in child processes against a real review server.
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { test } from 'node:test';
import { readConfig, statePaths } from '@agent-diff/shared/state';
import { notRunningMessage, rejectedTokenMessage } from '../src/client.ts';
import {
  otherToken,
  runCli,
  saveConfig,
  startForeground,
  tempStateHome,
} from './helpers.ts';

test('server hello fails when the review server is not running', async (t) => {
  const result = await runCli(tempStateHome(t), 'server', 'hello', 'Dan');
  assert.deepEqual(result, {
    stdout: '',
    stderr: `Error: ${notRunningMessage}\n`,
    exitCode: 1,
  });
});

test('server start --foreground serves until SIGINT, and the count survives a restart', async (t) => {
  const env = tempStateHome(t);
  const first = await startForeground(t, env);
  const paths = statePaths(env);
  assert.equal(statSync(paths.dir).mode & 0o777, 0o700);
  assert.equal(statSync(paths.config).mode & 0o777, 0o600);
  assert.deepEqual(readConfig(paths), {
    port: first.port,
    token: first.token,
  });
  assert.equal(
    first.url,
    `http://127.0.0.1:${first.port}/#token=${first.token}`,
  );

  assert.deepEqual(await runCli(env, 'server', 'hello', 'Dan'), {
    stdout: 'Hello, Dan! (1 greeting)\n',
    stderr: '',
    exitCode: 0,
  });
  assert.deepEqual(await runCli(env, 'server', 'hello', 'Dan'), {
    stdout: 'Hello, Dan! (2 greetings)\n',
    stderr: '',
    exitCode: 0,
  });

  assert.equal(await first.stop('SIGINT'), 0);
  assert.match(first.output(), /The review server stopped\.\n$/);
  assert.equal(
    (await runCli(env, 'server', 'hello', 'Dan')).stderr,
    `Error: ${notRunningMessage}\n`,
  );

  const second = await startForeground(t, env);
  assert.equal(second.url, first.url);
  assert.deepEqual(await runCli(env, 'server', 'hello', 'Dan'), {
    stdout: 'Hello, Dan! (3 greetings)\n',
    stderr: '',
    exitCode: 0,
  });
  assert.equal(await second.stop('SIGTERM'), 0);
  assert.match(second.output(), /The review server stopped\.\n$/);
});

test('server start does not start a second review server', async (t) => {
  const env = tempStateHome(t);
  const server = await startForeground(t, env);

  assert.deepEqual(await runCli(env, 'server', 'start', '--foreground'), {
    stdout: `The review server is already running at ${server.url}\n`,
    stderr: '',
    exitCode: 0,
  });
  assert.deepEqual(await runCli(env, 'server', 'start'), {
    stdout: '',
    stderr:
      'Error: Only `agent-diff server start --foreground` is supported for now.\n',
    exitCode: 1,
  });
  assert.deepEqual(readConfig(statePaths(env)), {
    port: server.port,
    token: server.token,
  });
  assert.equal(await server.stop('SIGINT'), 0);
});

test('server start starts its own review server when the saved port rejects the token', async (t) => {
  // Another user's review server, on the port saved in this user's config
  // file.
  const other = await startForeground(t, tempStateHome(t));
  const env = tempStateHome(t);
  const token = otherToken();
  saveConfig(env, { port: other.port, token });

  const server = await startForeground(t, env);
  assert.notEqual(server.port, other.port);
  assert.equal(server.token, token);
  assert.deepEqual(readConfig(statePaths(env)), {
    port: server.port,
    token,
  });
  assert.deepEqual(await runCli(env, 'server', 'hello', 'Dan'), {
    stdout: 'Hello, Dan! (1 greeting)\n',
    stderr: '',
    exitCode: 0,
  });
  assert.equal(await server.stop('SIGINT'), 0);
  assert.equal(await other.stop('SIGINT'), 0);
});

test('server hello prints the rejected-token error with no stack trace', async (t) => {
  const env = tempStateHome(t);
  const server = await startForeground(t, env);
  saveConfig(env, { port: server.port, token: otherToken() });
  assert.deepEqual(await runCli(env, 'server', 'hello', 'Dan'), {
    stdout: '',
    stderr: `Error: ${rejectedTokenMessage(server.port, statePaths(env).config)}\n`,
    exitCode: 1,
  });
  await server.stop('SIGINT');
});

test('server hello prints a validation error with no stack trace', async (t) => {
  const env = tempStateHome(t);
  const server = await startForeground(t, env);
  assert.deepEqual(await runCli(env, 'server', 'hello', ''), {
    stdout: '',
    stderr: 'Error: The name must not be empty.\n',
    exitCode: 1,
  });
  await server.stop('SIGINT');
});

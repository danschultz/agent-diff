// Runs the CLI in child processes against a real review server.
import assert from 'node:assert/strict';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readConfig, statePaths } from '@agent-diff/shared/state';
import { notRunningMessage, rejectedTokenMessage } from '../src/client.ts';
import {
  makeRepo,
  otherToken,
  runCli,
  saveConfig,
  startForeground,
  tempDir,
  tempStateHome,
} from './helpers.ts';

const sessionId = /^Created session (s_[0-9a-z]{6})\.$/m;

test('session commands fail when the review server is not running', async (t) => {
  const env = tempStateHome(t);
  for (const args of [
    ['session', 'new', tempDir(t)],
    ['session', 'list'],
    ['session', 'delete', '--yes', 's_7kq9a1'],
  ]) {
    assert.deepEqual(await runCli(env, args), {
      stdout: '',
      stderr: `Error: ${notRunningMessage}\n`,
      exitCode: 1,
    });
  }
});

test('server start --foreground serves until SIGINT, and sessions survive a restart', async (t) => {
  const env = tempStateHome(t);
  const first = await startForeground(t, env);
  const paths = statePaths(env);
  assert.equal(statSync(paths.dir).mode & 0o777, 0o700);
  assert.equal(statSync(paths.config).mode & 0o777, 0o600);
  assert.deepEqual(readConfig(paths), {
    port: first.port,
    token: first.token,
  });
  assert.ok(
    first
      .output()
      .endsWith(
        `The review server is running on port ${first.port}.\nPress Ctrl-C to stop it.\n`,
      ),
    first.output(),
  );
  assert.doesNotMatch(first.output(), /http|token/);

  const dir = tempDir(t);
  const created = await runCli(env, ['session', 'new', dir]);
  assert.equal(created.exitCode, 0, created.stderr);
  const id = sessionId.exec(created.stdout)![1]!;

  assert.equal(await first.stop('SIGINT'), 0);
  assert.match(first.output(), /The review server stopped\.\n$/);
  assert.equal(
    (await runCli(env, ['session', 'list'])).stderr,
    `Error: ${notRunningMessage}\n`,
  );

  const second = await startForeground(t, env);
  assert.equal(second.port, first.port);
  assert.equal(second.token, first.token);
  const listed = await runCli(env, ['session', 'list']);
  assert.match(listed.stdout, new RegExp(`^${id} \\(created `));
  assert.equal(await second.stop('SIGTERM'), 0);
  assert.match(second.output(), /The review server stopped\.\n$/);
});

test('server start does not start a second review server', async (t) => {
  const env = tempStateHome(t);
  const server = await startForeground(t, env);

  assert.deepEqual(await runCli(env, ['server', 'start', '--foreground']), {
    stdout: `The review server is already running on port ${server.port}.\n`,
    stderr: '',
    exitCode: 0,
  });
  assert.deepEqual(await runCli(env, ['server', 'start']), {
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
  assert.deepEqual(await runCli(env, ['session', 'list']), {
    stdout: 'There are no active sessions.\n',
    stderr: '',
    exitCode: 0,
  });
  assert.equal(await server.stop('SIGINT'), 0);
  assert.equal(await other.stop('SIGINT'), 0);
});

test('session commands print the rejected-token error with no stack trace', async (t) => {
  const env = tempStateHome(t);
  const server = await startForeground(t, env);
  saveConfig(env, { port: server.port, token: otherToken() });
  assert.deepEqual(await runCli(env, ['session', 'list']), {
    stdout: '',
    stderr: `Error: ${rejectedTokenMessage(server.port, statePaths(env).config)}\n`,
    exitCode: 1,
  });
  await server.stop('SIGINT');
});

test('session new prints a validation error with no stack trace', async (t) => {
  const env = tempStateHome(t);
  const server = await startForeground(t, env);
  assert.deepEqual(
    await runCli(env, ['session', 'new', '--title', ' ', tempDir(t)]),
    {
      stdout: '',
      stderr: 'Error: The title must not be empty.\n',
      exitCode: 1,
    },
  );
  await server.stop('SIGINT');
});

test('session new resolves relative paths against the current directory, and prints the session', async (t) => {
  const env = tempStateHome(t);
  const server = await startForeground(t, env);
  const repo = makeRepo(t, env);
  const plain = path.join(tempDir(t), 'notes');
  mkdirSync(plain);

  const created = await runCli(
    env,
    ['session', 'new', '--title', 'Check', '.', path.relative(repo, plain)],
    { cwd: repo },
  );
  assert.equal(created.exitCode, 0, created.stderr);
  const id = sessionId.exec(created.stdout)![1]!;
  assert.equal(
    created.stdout,
    [
      `Created session ${id}.`,
      `Review UI: http://127.0.0.1:${server.port}/sessions/${id}#token=${server.token}`,
      'Working directories:',
      `  ${repo} (base ref main)`,
      `  ${plain} (doesn't use git)`,
      '',
    ].join('\n'),
  );
  assert.equal(created.stderr, '');
  await server.stop('SIGINT');
});

test('session delete without a terminal fails without --yes, and deletes with it', async (t) => {
  const env = tempStateHome(t);
  const server = await startForeground(t, env);
  const created = await runCli(env, ['session', 'new', tempDir(t)]);
  const id = sessionId.exec(created.stdout)![1]!;

  // stdin is a pipe that answers yes, which is never read.
  assert.deepEqual(
    await runCli(env, ['session', 'delete', id], { input: 'y\n' }),
    {
      stdout: '',
      stderr: `Error: There's no terminal to confirm in, so pass --yes to delete session ${id}.\n`,
      exitCode: 1,
    },
  );
  assert.match((await runCli(env, ['session', 'list'])).stdout, /^s_/);

  assert.deepEqual(await runCli(env, ['session', 'delete', '--yes', id]), {
    stdout: `Deleted session ${id}.\n`,
    stderr: '',
    exitCode: 0,
  });
  assert.equal(
    (await runCli(env, ['session', 'list', '--all'])).stdout,
    'There are no sessions.\n',
  );
  await server.stop('SIGINT');
});

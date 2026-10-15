import assert from 'node:assert/strict';
import {
  existsSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { get } from 'node:http';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { ORPCError } from '@orpc/client';
import { statePaths } from '@agent-diff/shared/state';
import { client, start, tempStateHome } from './helpers.ts';

function mode(file: string): number {
  return statSync(file).mode & 0o777;
}

function savedPort(env: NodeJS.ProcessEnv): number {
  return JSON.parse(readFileSync(statePaths(env).config, 'utf8')).port;
}

function uiDir(t: TestContext): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-diff-ui-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<h1>review UI</h1>');
  writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1);');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the first start creates the state directory and config file with their modes', async (t) => {
  const env = tempStateHome(t);
  const paths = statePaths(env);
  const server = await start(t, { env });

  assert.equal(mode(paths.dir), 0o700);
  assert.equal(mode(paths.config), 0o600);
  assert.deepEqual(JSON.parse(readFileSync(paths.config, 'utf8')), {
    port: server.port,
  });
  assert.ok(server.port > 0);
  assert.equal(server.url, `http://127.0.0.1:${server.port}/`);
  assert.ok(existsSync(paths.database));
});

test('the first start creates XDG_STATE_HOME when it does not exist', async (t) => {
  const home = tempStateHome(t).XDG_STATE_HOME!;
  const env = { XDG_STATE_HOME: path.join(home, 'nested', 'state') };
  await start(t, { env });
  assert.equal(mode(statePaths(env).dir), 0o700);
});

test('the config file mode is corrected when it already exists', async (t) => {
  const env = tempStateHome(t);
  const paths = statePaths(env);
  mkdirSync(paths.dir, { mode: 0o700 });
  writeFileSync(paths.config, '{}', { mode: 0o644 });
  await start(t, { env });
  assert.equal(mode(paths.config), 0o600);
});

test('later starts reuse the saved port', async (t) => {
  const env = tempStateHome(t);
  const first = await start(t, { env });
  await first.close();
  const second = await start(t, { env });
  assert.equal(second.port, first.port);
  assert.equal(savedPort(env), first.port);
});

test('a saved port in use by another program is replaced and saved', async (t) => {
  const env = tempStateHome(t);
  const other = createServer();
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  t.after(() => other.close());
  const taken = (other.address() as AddressInfo).port;

  const paths = statePaths(env);
  mkdirSync(paths.dir, { mode: 0o700 });
  writeFileSync(paths.config, JSON.stringify({ port: taken }));

  const server = await start(t, { env });
  assert.notEqual(server.port, taken);
  assert.equal(savedPort(env), server.port);
});

test('the migration is applied with dbmate before requests are served', async (t) => {
  const env = tempStateHome(t);
  const server = await start(t, { env });
  await server.close();

  const db = new DatabaseSync(statePaths(env).database, { readOnly: true });
  t.after(() => db.close());
  assert.deepEqual(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => ({ ...r })),
    [{ version: '20261015000000' }],
  );
  assert.deepEqual(
    db
      .prepare('PRAGMA table_info(greetings)')
      .all()
      .map((r) => r.name),
    ['id', 'name', 'created_at'],
  );
});

test('every migration has dbmate up and down sections', () => {
  const dir = path.join(import.meta.dirname, '..', 'db', 'migrations');
  for (const file of readdirSync(dir)) {
    const lines = readFileSync(path.join(dir, file), 'utf8').split('\n');
    assert.ok(lines.includes('-- migrate:up'), file);
    assert.ok(lines.includes('-- migrate:down'), file);
  }
});

test('health returns ok', async (t) => {
  const server = await start(t, { env: tempStateHome(t) });
  assert.deepEqual(await client(server).health(), { ok: true });
});

test('hello greets the trimmed name and counts the greetings', async (t) => {
  const env = tempStateHome(t);
  const server = await start(t, { env });
  const api = client(server);
  assert.deepEqual(await api.hello({ name: ' Dan ' }), {
    message: 'Hello, Dan!',
    count: 1,
  });
  assert.deepEqual(await api.hello({ name: 'world' }), {
    message: 'Hello, world!',
    count: 2,
  });
  await server.close();

  const db = new DatabaseSync(statePaths(env).database, { readOnly: true });
  t.after(() => db.close());
  const rows = db.prepare('SELECT name, created_at FROM greetings').all();
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Dan', 'world'],
  );
  for (const row of rows) {
    assert.match(
      String(row.created_at),
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
    );
  }
});

test('the greeting count survives a restart', async (t) => {
  const env = tempStateHome(t);
  const first = await start(t, { env });
  await client(first).hello({ name: 'Dan' });
  await client(first).hello({ name: 'Dan' });
  await first.close();

  const second = await start(t, { env });
  assert.deepEqual(await client(second).hello({ name: 'Dan' }), {
    message: 'Hello, Dan!',
    count: 3,
  });
});

test('hello rejects an invalid name with a readable validation error', async (t) => {
  const server = await start(t, { env: tempStateHome(t) });
  const api = client(server);
  for (const [name, message] of [
    ['', 'The name must not be empty.'],
    ['   ', 'The name must not be empty.'],
    ['D'.repeat(101), 'The name must be at most 100 characters.'],
  ]) {
    await assert.rejects(api.hello({ name }), (error) => {
      assert.ok(error instanceof ORPCError);
      assert.equal(error.code, 'BAD_REQUEST');
      assert.equal(error.status, 400);
      assert.equal(error.message, message);
      return true;
    });
  }
  // Nothing was written.
  assert.equal((await api.hello({ name: 'Dan' })).count, 1);
});

test('the review UI is served at / and for paths that are not files', async (t) => {
  const server = await start(t, { env: tempStateHome(t), uiDir: uiDir(t) });
  for (const pathname of ['/', '/review-sessions/1']) {
    const response = await fetch(new URL(pathname, server.url));
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('content-type'),
      'text/html; charset=utf-8',
    );
    assert.equal(await response.text(), '<h1>review UI</h1>');
  }
  const script = await fetch(new URL('/assets/app.js', server.url));
  assert.equal(
    script.headers.get('content-type'),
    'text/javascript; charset=utf-8',
  );
  assert.equal(await script.text(), 'console.log(1);');
});

test('files outside the review UI are never served', async (t) => {
  const dir = uiDir(t);
  // A sibling of the review UI's directory, which only a path that escapes it
  // could reach.
  const secret = `${dir}-secret.txt`;
  writeFileSync(secret, 'secret');
  t.after(() => rmSync(secret));
  const server = await start(t, { env: tempStateHome(t), uiDir: dir });
  const name = path.basename(secret);
  // fetch normalizes `..` away, so the paths are sent as they are with
  // node:http.
  for (const pathname of [`/../${name}`, `/%2e%2e/${name}`, `/..%2f${name}`]) {
    const body = await new Promise<string>((resolve, reject) => {
      get({ host: '127.0.0.1', port: server.port, path: pathname }, (res) => {
        res.setEncoding('utf8');
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve(text));
      }).on('error', reject);
    });
    assert.notEqual(body, 'secret', pathname);
  }
});

test('says how to build the review UI when it is not built', async (t) => {
  const missing = path.join(tempStateHome(t).XDG_STATE_HOME!, 'dist');
  const server = await start(t, { env: tempStateHome(t), uiDir: missing });
  const response = await fetch(server.url);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /npm run build -w packages\/ui/);
});

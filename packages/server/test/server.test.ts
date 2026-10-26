import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { get, request, type IncomingHttpHeaders } from 'node:http';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { ORPCError } from '@orpc/client';
import { statePaths } from '@agent-diff/shared/state';
import type { ReviewServer } from '../src/server.ts';
import { client, start, tempDir, tempStateHome } from './helpers.ts';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function mode(file: string): number {
  return statSync(file).mode & 0o777;
}

function savedConfig(env: NodeJS.ProcessEnv): { port: number; token: string } {
  return JSON.parse(readFileSync(statePaths(env).config, 'utf8'));
}

function savedPort(env: NodeJS.ProcessEnv): number {
  return savedConfig(env).port;
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

// Sends a request with node:http, which, unlike fetch, can set the Host
// header, or leave it out when host is null. Host defaults to the review
// server's own.
function send(
  server: ReviewServer,
  options: {
    method?: string;
    path: string;
    host?: string | null;
    headers?: Record<string, string>;
  },
): Promise<RawResponse> {
  const { method = 'GET', path: pathname, host, headers = {} } = options;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server.port,
        method,
        path: pathname,
        setHost: host !== null,
        headers: host ? { ...headers, host } : headers,
      },
      (res) => {
        res.setEncoding('utf8');
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// A port that was free a moment ago.
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function bearer(server: ReviewServer): Record<string, string> {
  return { authorization: `Bearer ${server.token}` };
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
  assert.deepEqual(savedConfig(env), {
    port: server.port,
    token: server.token,
  });
  assert.match(server.token, tokenPattern);
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

test('the token is never written into an existing config file that others can read', async (t) => {
  const env = tempStateHome(t);
  const paths = statePaths(env);
  mkdirSync(paths.dir, { mode: 0o700 });
  // A file others can read, which config.json is a hard link to, so writing
  // into config.json in place would write into it too.
  const other = path.join(env.XDG_STATE_HOME!, 'other.json');
  writeFileSync(other, '{}', { mode: 0o644 });
  linkSync(other, paths.config);
  const server = await start(t, { env });
  assert.equal(readFileSync(other, 'utf8'), '{}');
  assert.equal(mode(other), 0o644);
  assert.equal(savedConfig(env).token, server.token);
  assert.equal(mode(paths.config), 0o600);
  assert.deepEqual(readdirSync(paths.dir).sort(), [
    'agent-diff.db',
    'config.json',
  ]);
});

test('a temporary config file left behind by an earlier start is ignored', async (t) => {
  const env = tempStateHome(t);
  const paths = statePaths(env);
  mkdirSync(paths.dir, { mode: 0o700 });
  // Such as one left by a review server that crashed while writing the config
  // file, in a process with the same ID as this one.
  const leftover = `${paths.config}.${process.pid}.tmp`;
  writeFileSync(leftover, '{}');
  const server = await start(t, { env });
  assert.equal(savedConfig(env).token, server.token);
});

test('later starts reuse the saved port and token', async (t) => {
  const env = tempStateHome(t);
  const first = await start(t, { env });
  await first.close();
  const second = await start(t, { env });
  assert.equal(second.port, first.port);
  assert.equal(second.token, first.token);
  assert.deepEqual(savedConfig(env), {
    port: first.port,
    token: first.token,
  });
});

test('each state directory gets its own token', async (t) => {
  const first = await start(t, { env: tempStateHome(t) });
  const second = await start(t, { env: tempStateHome(t) });
  assert.notEqual(first.token, second.token);
});

test('a saved token is reused whatever its format', async (t) => {
  const env = tempStateHome(t);
  const paths = statePaths(env);
  mkdirSync(paths.dir, { mode: 0o700 });
  const port = await freePort();
  for (const token of ['typed-by-hand', 'a'.repeat(44)]) {
    writeFileSync(paths.config, JSON.stringify({ port, token }));
    const server = await start(t, { env });
    assert.equal(server.token, token);
    assert.equal(savedConfig(env).token, token);
    await server.close();
  }
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

test('the migrations are applied with dbmate before requests are served', async (t) => {
  const env = tempStateHome(t);
  const server = await start(t, { env });
  await server.close();

  const db = new DatabaseSync(statePaths(env).database, { readOnly: true });
  t.after(() => db.close());
  assert.deepEqual(
    db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((r) => r.version),
    ['20261015000000', '20261022000000', '20261022000001', '20261024000000'],
  );
  const columns = (table: string) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => r.name);
  assert.deepEqual(columns('greetings'), []);
  assert.deepEqual(columns('sessions'), [
    'id',
    'title',
    'created_at',
    'archived_at',
  ]);
  assert.deepEqual(columns('working_directories'), [
    'id',
    'path',
    'created_at',
  ]);
  assert.deepEqual(columns('session_working_directories'), [
    'session_id',
    'working_directory_id',
    'base_ref',
    'added_at',
  ]);
  assert.deepEqual(
    db
      .prepare('PRAGMA foreign_key_list(session_working_directories)')
      .all()
      .map((r) => ({ table: r.table, from: r.from, onDelete: r.on_delete }))
      .sort((a, b) => String(a.table).localeCompare(String(b.table))),
    [
      { table: 'sessions', from: 'session_id', onDelete: 'CASCADE' },
      {
        table: 'working_directories',
        from: 'working_directory_id',
        onDelete: 'NO ACTION',
      },
    ],
  );
  assert.deepEqual(columns('reviews'), [
    'id',
    'public_id',
    'session_id',
    'created_at',
    'submitted_at',
  ]);
  assert.deepEqual(columns('comments'), [
    'id',
    'review_id',
    'kind',
    'text',
    'status',
    'created_at',
  ]);
  assert.deepEqual(columns('replies'), [
    'id',
    'comment_id',
    'author',
    'review_id',
    'status',
    'text',
    'created_at',
  ]);
  const foreignKeys = (table: string) =>
    db
      .prepare(`PRAGMA foreign_key_list(${table})`)
      .all()
      .map((r) => ({ table: r.table, from: r.from, onDelete: r.on_delete }))
      .sort((a, b) => String(a.from).localeCompare(String(b.from)));
  assert.deepEqual(foreignKeys('reviews'), [
    { table: 'sessions', from: 'session_id', onDelete: 'CASCADE' },
  ]);
  assert.deepEqual(foreignKeys('comments'), [
    { table: 'reviews', from: 'review_id', onDelete: 'CASCADE' },
  ]);
  assert.deepEqual(foreignKeys('replies'), [
    { table: 'comments', from: 'comment_id', onDelete: 'CASCADE' },
    { table: 'reviews', from: 'review_id', onDelete: 'CASCADE' },
  ]);
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

// One call for every procedure in the contract, so adding a procedure
// without adding it here fails the typecheck.
type Calls<Router> = {
  [K in keyof Router]: Router[K] extends (...args: never[]) => unknown
    ? (api: ReturnType<typeof client>) => Promise<unknown>
    : Calls<Router[K]>;
};

function flatten(
  calls: object,
  prefix = '',
): [string, (api: ReturnType<typeof client>) => Promise<unknown>][] {
  return Object.entries(calls).flatMap(([name, call]) =>
    typeof call === 'function'
      ? [[`${prefix}${name}`, call]]
      : flatten(call, `${prefix}${name}.`),
  );
}

test('every procedure rejects a call without the right token with 401', async (t) => {
  const server = await start(t, { env: tempStateHome(t) });
  const dir = tempDir(t);
  const api = client(server);
  const { id } = await api.session.new({ workingDirectories: [dir] });
  const submitted = await api.comment.add({ sessionId: id, text: 'One' });
  const review = await api.review.submit({ sessionId: id });
  const draft = await api.comment.add({ sessionId: id, text: 'Two' });
  const calls: Calls<ReturnType<typeof client>> = {
    health: (api) => api.health(),
    session: {
      new: (api) => api.session.new({ workingDirectories: [dir] }),
      add: (api) => api.session.add({ id, workingDirectories: [dir] }),
      show: (api) => api.session.show({ id }),
      list: (api) => api.session.list({}),
      archive: (api) => api.session.archive({ id }),
      delete: (api) => api.session.delete({ id }),
    },
    comment: {
      add: (api) => api.comment.add({ sessionId: id, text: 'Three' }),
      edit: (api) => api.comment.edit({ id: draft.id, text: 'Changed' }),
      delete: (api) => api.comment.delete({ id: draft.id }),
      reply: (api) =>
        api.comment.reply({
          id: submitted.id,
          status: 'addressed',
          text: 'Done.',
        }),
      resolve: (api) => api.comment.resolve({ id: submitted.id }),
    },
    review: {
      submit: (api) => api.review.submit({ sessionId: id }),
      show: (api) => api.review.show({ id: review.id }),
      list: (api) => api.review.list({ sessionId: id }),
    },
    diff: {
      files: (api) => api.diff.files({ sessionId: id, mode: 'all' }),
      contents: (api) =>
        api.diff.contents({
          sessionId: id,
          mode: 'all',
          workingDirectory: dir,
          path: 'a.txt',
        }),
    },
  };
  const procedures = flatten(calls);
  assert.deepEqual(
    procedures.map(([name]) => name),
    [
      'health',
      'session.new',
      'session.add',
      'session.show',
      'session.list',
      'session.archive',
      'session.delete',
      'comment.add',
      'comment.edit',
      'comment.delete',
      'comment.reply',
      'comment.resolve',
      'review.submit',
      'review.show',
      'review.list',
      'diff.files',
      'diff.contents',
    ],
  );
  for (const [procedure, call] of procedures) {
    for (const token of [null, '', 'wrong', `${server.token}x`]) {
      await assert.rejects(call(client(server, token)), (error) => {
        assert.ok(error instanceof ORPCError, `${procedure} ${token}`);
        assert.equal(error.status, 401);
        assert.equal(error.code, 'UNAUTHORIZED');
        return true;
      });
    }
  }
  // Nothing was written by the rejected calls.
  const sessions = await api.session.list({ all: true });
  assert.deepEqual(
    sessions.map((session) => [session.id, session.archivedAt]),
    [[id, null]],
  );
  const reviews = await api.review.list({ sessionId: id });
  assert.deepEqual(reviews.draftReview.comments, [draft]);
  assert.deepEqual(
    reviews.comments.map((c) => [c.id, c.status, c.replies]),
    [[submitted.id, 'open', []]],
  );
  assert.deepEqual(reviews.reviews, [review]);
});

test('the token is only accepted as a bearer token in the Authorization header', async (t) => {
  const server = await start(t, { env: tempStateHome(t) });
  for (const authorization of [
    server.token,
    `Basic ${server.token}`,
    `Bearer  ${server.token}`,
    `Bearer ${server.token} x`,
  ]) {
    const response = await send(server, {
      method: 'POST',
      path: '/api/health',
      headers: { authorization },
    });
    assert.equal(response.status, 401, authorization);
  }
  for (const scheme of ['Bearer', 'bearer']) {
    const response = await send(server, {
      method: 'POST',
      path: '/api/health',
      headers: { authorization: `${scheme} ${server.token}` },
    });
    assert.equal(response.status, 200, scheme);
  }
});

test('paths under /api that are not procedures need the token too', async (t) => {
  const server = await start(t, { env: tempStateHome(t), uiDir: uiDir(t) });
  for (const pathname of ['/api', '/api/', '/api/nothing', '/api/a/b']) {
    const response = await send(server, { path: pathname });
    assert.equal(response.status, 401, pathname);
  }
});

test('paths under /api that are not procedures are not found, rather than served the review UI', async (t) => {
  const server = await start(t, { env: tempStateHome(t), uiDir: uiDir(t) });
  for (const method of ['GET', 'POST']) {
    for (const pathname of ['/api', '/api/', '/api/nothing', '/api/a/b']) {
      const response = await send(server, {
        method,
        path: pathname,
        headers: bearer(server),
      });
      assert.equal(response.status, 404, `${method} ${pathname}`);
      assert.doesNotMatch(response.body, /review UI/, `${method} ${pathname}`);
    }
  }
});

function foreignHosts(port: number): (string | null)[] {
  return [
    'evil.example',
    `evil.example:${port}`,
    `localhost.evil.example:${port}`,
    '127.0.0.1',
    'localhost',
    `127.0.0.1:${port + 1}`,
    `localhost:${port + 1}`,
    `[::1]:${port}`,
    `0.0.0.0:${port}`,
    null,
  ];
}

test('API calls whose Host is not the review server are rejected with 403', async (t) => {
  const server = await start(t, { env: tempStateHome(t), uiDir: uiDir(t) });
  const requests = [
    { method: 'POST', path: '/api/health', headers: bearer(server) },
    { method: 'POST', path: '/api/session/list', headers: bearer(server) },
    { method: 'POST', path: '/api/health' },
    { path: '/api/nothing', headers: bearer(server) },
  ];
  for (const host of foreignHosts(server.port)) {
    for (const options of requests) {
      const response = await send(server, { ...options, host });
      assert.equal(response.status, 403, `${host} ${options.path}`);
      assert.equal(response.body, '', `${host} ${options.path}`);
    }
  }
});

test("the review UI's files are served whatever the Host", async (t) => {
  const server = await start(t, { env: tempStateHome(t), uiDir: uiDir(t) });
  for (const host of foreignHosts(server.port)) {
    for (const pathname of ['/', '/sessions/s_7kq9a1', '/assets/app.js']) {
      const response = await send(server, { path: pathname, host });
      assert.equal(response.status, 200, `${host} ${pathname}`);
    }
  }
});

test('a Host header that is not a valid host is rejected with 400 by the adapter', async (t) => {
  const server = await start(t, { env: tempStateHome(t), uiDir: uiDir(t) });
  for (const host of ['a b', 'evil.example:99999', '[bad']) {
    for (const options of [
      { method: 'POST', path: '/api/health', headers: bearer(server) },
      { path: '/' },
    ]) {
      const response = await send(server, { ...options, host });
      assert.equal(response.status, 400, `${host} ${options.path}`);
      assert.doesNotMatch(response.body, /review UI|"ok"/, host);
    }
  }
});

test('requests to 127.0.0.1 or localhost on its port are served', async (t) => {
  const server = await start(t, { env: tempStateHome(t), uiDir: uiDir(t) });
  for (const host of [
    `127.0.0.1:${server.port}`,
    `localhost:${server.port}`,
    `LOCALHOST:${server.port}`,
  ]) {
    const health = await send(server, {
      method: 'POST',
      path: '/api/health',
      host,
      headers: bearer(server),
    });
    assert.equal(health.status, 200, host);
    const page = await send(server, { path: '/', host });
    assert.equal(page.status, 200, host);
    assert.equal(page.body, '<h1>review UI</h1>');
  }
});

test('the review server sends no CORS headers', async (t) => {
  const server = await start(t, { env: tempStateHome(t), uiDir: uiDir(t) });
  const origin = { origin: 'https://evil.example' };
  const preflight = {
    ...origin,
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization',
  };
  const responses = await Promise.all([
    send(server, { path: '/', headers: origin }),
    send(server, { path: '/assets/app.js', headers: origin }),
    send(server, {
      method: 'POST',
      path: '/api/health',
      headers: { ...origin, ...bearer(server) },
    }),
    send(server, { method: 'POST', path: '/api/health', headers: origin }),
    send(server, {
      method: 'OPTIONS',
      path: '/api/health',
      headers: preflight,
    }),
    send(server, { method: 'OPTIONS', path: '/', headers: preflight }),
    send(server, { path: '/', host: 'evil.example', headers: origin }),
  ]);
  for (const response of responses) {
    assert.deepEqual(
      Object.keys(response.headers).filter((name) =>
        name.startsWith('access-control-'),
      ),
      [],
    );
  }
});

test('the review UI is served at / and for paths that are not files', async (t) => {
  const server = await start(t, { env: tempStateHome(t), uiDir: uiDir(t) });
  for (const pathname of ['/', '/sessions/s_7kq9a1']) {
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

import assert from 'node:assert/strict';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { newSessionId } from '../src/ids.ts';
import { migrate } from '../src/migrate.ts';
import { openDatabase, Store } from '../src/store.ts';
import { tempDir } from './helpers.ts';

const sessionIdPattern = /^s_[0-9abcdefghjkmnpqrstvwxyz]{6}$/;

async function migrated(t: TestContext): Promise<string> {
  const database = path.join(tempDir(t), 'agent-diff.db');
  await migrate(database);
  return database;
}

function store(
  t: TestContext,
  database: string,
  options?: ConstructorParameters<typeof Store>[1],
): Store {
  const store = new Store(database, options);
  t.after(() => store.close());
  return store;
}

test('every connection sets foreign keys, WAL, and a busy timeout', async (t) => {
  const db = openDatabase(await migrated(t));
  t.after(() => db.close());
  assert.deepEqual(
    { ...db.prepare('PRAGMA foreign_keys').get() },
    { foreign_keys: 1 },
  );
  assert.deepEqual(
    { ...db.prepare('PRAGMA journal_mode').get() },
    { journal_mode: 'wal' },
  );
  assert.deepEqual(
    { ...db.prepare('PRAGMA busy_timeout').get() },
    { timeout: 5000 },
  );
});

test('session IDs are s_ and 6 lowercase Crockford base32 characters', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i += 1) {
    const id = newSessionId();
    assert.match(id, sessionIdPattern);
    ids.add(id);
  }
  // Every character of the alphabet turns up, and none outside it.
  const characters = new Set([...ids].flatMap((id) => [...id.slice(2)]));
  assert.equal(
    [...characters].sort().join(''),
    '0123456789abcdefghjkmnpqrstvwxyz',
  );
});

test('a session ID that is already taken is generated again', async (t) => {
  const ids = ['s_aaaaaa', 's_aaaaaa', 's_aaaaaa', 's_bbbbbb'];
  const generated: string[] = [];
  const sessions = store(t, await migrated(t), {
    newSessionId: () => {
      generated.push(ids[generated.length]!);
      return generated.at(-1)!;
    },
  });
  const first = sessions.createSession({ title: null, workingDirectories: [] });
  const second = sessions.createSession({
    title: null,
    workingDirectories: [],
  });
  assert.equal(first.id, 's_aaaaaa');
  assert.equal(second.id, 's_bbbbbb');
  assert.equal(generated.length, 4);
});

test("deleting a session's row deletes its memberships through the foreign key", async (t) => {
  const database = await migrated(t);
  const sessions = store(t, database);
  const { id } = sessions.createSession({
    title: null,
    workingDirectories: [{ path: '/a', baseRef: null }],
  });
  const db = openDatabase(database);
  t.after(() => db.close());
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  assert.deepEqual(
    db.prepare('SELECT * FROM session_working_directories').all(),
    [],
  );
});

test('deleting a session deletes the working directories left in no session', async (t) => {
  const database = await migrated(t);
  const sessions = store(t, database);
  const first = sessions.createSession({
    title: null,
    workingDirectories: [
      { path: '/shared', baseRef: 'main' },
      { path: '/only-first', baseRef: null },
    ],
  });
  const second = sessions.createSession({
    title: null,
    workingDirectories: [{ path: '/shared', baseRef: 'HEAD' }],
  });
  assert.equal(sessions.deleteSession(first.id), true);
  assert.equal(sessions.deleteSession(first.id), false);
  assert.equal(sessions.getSession(first.id), undefined);
  assert.deepEqual(sessions.getSession(second.id)?.workingDirectories, [
    { path: '/shared', baseRef: 'HEAD' },
  ]);

  const db = openDatabase(database);
  t.after(() => db.close());
  assert.deepEqual(
    db
      .prepare('SELECT path FROM working_directories')
      .all()
      .map((row) => row.path),
    ['/shared'],
  );
});

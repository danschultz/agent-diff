import assert from 'node:assert/strict';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { newCommentId, newReviewId, newSessionId } from '../src/ids.ts';
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

const commentIdPattern = /^c_[0-9abcdefghjkmnpqrstvwxyz]{6}$/;
const reviewIdPattern = /^r_[0-9abcdefghjkmnpqrstvwxyz]{6}$/;

test('comment and review IDs are c_ and r_ and 6 lowercase Crockford base32 characters', () => {
  for (const [newId, pattern] of [
    [newCommentId, commentIdPattern],
    [newReviewId, reviewIdPattern],
  ] as const) {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const id = newId();
      assert.match(id, pattern);
      ids.add(id);
    }
    const characters = new Set([...ids].flatMap((id) => [...id.slice(2)]));
    assert.equal(
      [...characters].sort().join(''),
      '0123456789abcdefghjkmnpqrstvwxyz',
    );
  }
});

// Returns the IDs in turn, recording how many were asked for.
function fixedIds(ids: string[]) {
  const generated: string[] = [];
  return {
    generated,
    next: () => {
      generated.push(ids[generated.length]!);
      return generated.at(-1)!;
    },
  };
}

test('a comment ID that is already taken is generated again', async (t) => {
  const ids = fixedIds(['c_aaaaaa', 'c_aaaaaa', 'c_aaaaaa', 'c_bbbbbb']);
  const reviews = store(t, await migrated(t), { newCommentId: ids.next });
  const { id } = reviews.createSession({ title: null, workingDirectories: [] });
  assert.equal(reviews.addComment(id, 'One').id, 'c_aaaaaa');
  assert.equal(reviews.addComment(id, 'Two').id, 'c_bbbbbb');
  assert.equal(ids.generated.length, 4);
});

test('a review ID that is already taken is generated again', async (t) => {
  const ids = fixedIds(['r_aaaaaa', 'r_aaaaaa', 'r_bbbbbb']);
  const reviews = store(t, await migrated(t), { newReviewId: ids.next });
  const { id } = reviews.createSession({ title: null, workingDirectories: [] });
  reviews.addComment(id, 'One');
  assert.equal(reviews.submitReview(id).id, 'r_aaaaaa');
  reviews.addComment(id, 'Two');
  assert.equal(reviews.submitReview(id).id, 'r_bbbbbb');
  assert.equal(ids.generated.length, 3);
});

test('a session has at most one draft review, and writing after a submit starts a new one', async (t) => {
  const database = await migrated(t);
  const reviews = store(t, database);
  const { id } = reviews.createSession({ title: null, workingDirectories: [] });
  reviews.addComment(id, 'One');
  reviews.addComment(id, 'Two');
  const db = openDatabase(database);
  t.after(() => db.close());
  const drafts = () =>
    db
      .prepare(
        'SELECT id FROM reviews WHERE session_id = ? AND submitted_at IS NULL',
      )
      .all(id);
  assert.equal(drafts().length, 1);
  assert.throws(
    () => db.prepare('INSERT INTO reviews (session_id) VALUES (?)').run(id),
    /UNIQUE constraint failed/,
  );

  const first = reviews.submitReview(id);
  assert.equal(drafts().length, 0);
  const third = reviews.addComment(id, 'Three');
  assert.equal(drafts().length, 1);
  const second = reviews.submitReview(id);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(
    reviews.getReview(second.id)!.comments.map((comment) => comment.id),
    [third.id],
  );
  assert.deepEqual(
    reviews.listReviews(id)!.reviews.map((review) => review.id),
    [second.id, first.id],
  );
});

test("deleting a session's row deletes its reviews, comments, and replies through foreign keys", async (t) => {
  const database = await migrated(t);
  const reviews = store(t, database);
  const { id } = reviews.createSession({ title: null, workingDirectories: [] });
  const other = reviews.createSession({ title: null, workingDirectories: [] });
  const comment = reviews.addComment(id, 'Submitted');
  reviews.submitReview(id);
  reviews.reply(comment.id, 'addressed', 'Done.');
  reviews.addComment(id, 'In the draft review');
  reviews.addComment(other.id, 'Kept');
  const db = openDatabase(database);
  t.after(() => db.close());
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  for (const table of ['reviews', 'comments']) {
    assert.equal(
      db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,
      1,
      table,
    );
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM replies').get()!.n, 0);
});

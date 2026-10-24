// The `comment` and `review` procedures, called through the API as the CLI
// and the review UI call them.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { ORPCError } from '@orpc/client';
import { client, start, tempDir, tempStateHome } from './helpers.ts';

const isoTimestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const commentId = /^c_[0-9abcdefghjkmnpqrstvwxyz]{6}$/;
const reviewId = /^r_[0-9abcdefghjkmnpqrstvwxyz]{6}$/;

async function rejects(
  call: Promise<unknown>,
  code: string,
  message: string,
): Promise<void> {
  await assert.rejects(call, (error) => {
    assert.ok(error instanceof ORPCError, String(error));
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
}

// A review server, its API, and a session over a directory.
async function setUp(t: TestContext) {
  const server = await start(t, { env: tempStateHome(t) });
  const api = client(server);
  const { id } = await api.session.new({ workingDirectories: [tempDir(t)] });
  return { api, sessionId: id };
}

// Writes comments in the session's draft review, submits it, and returns the
// review and the comments' IDs.
async function submit(
  api: ReturnType<typeof client>,
  sessionId: string,
  ...texts: string[]
) {
  const ids: string[] = [];
  for (const text of texts) {
    ids.push((await api.comment.add({ sessionId, text })).id);
  }
  return { review: await api.review.submit({ sessionId }), ids };
}

test('comments are added, edited, and deleted in the draft review', async (t) => {
  const { api, sessionId } = await setUp(t);
  const first = await api.comment.add({ sessionId, text: '  First \n' });
  assert.match(first.id, commentId);
  assert.equal(first.kind, 'overall');
  assert.equal(first.text, 'First');
  assert.match(first.createdAt, isoTimestamp);
  const second = await api.comment.add({ sessionId, text: 'Second' });

  const edited = await api.comment.edit({ id: first.id, text: ' Changed ' });
  assert.deepEqual(edited, { ...first, text: 'Changed' });
  await api.comment.delete({ id: second.id });
  const third = await api.comment.add({ sessionId, text: 'Third' });

  assert.deepEqual(await api.review.list({ sessionId }), {
    comments: [],
    draftReview: { comments: [edited, third] },
    reviews: [],
  });
});

test('submitting the draft review makes a review with an r_ ID and opens its comments', async (t) => {
  const { api, sessionId } = await setUp(t);
  const { review, ids } = await submit(api, sessionId, 'One', 'Two');
  assert.match(review.id, reviewId);
  assert.equal(review.sessionId, sessionId);
  assert.match(review.submittedAt, isoTimestamp);
  assert.equal(
    review.message,
    `[agent-diff review ${review.id}] The reviewer submitted review ${review.id} in session ${sessionId}. Finish what you're doing first, then run \`agent-diff review show ${review.id}\`, address each comment, and reply to each one with \`agent-diff comment reply\`.`,
  );

  const listed = await api.review.list({ sessionId });
  assert.deepEqual(listed.draftReview, { comments: [] });
  assert.deepEqual(listed.reviews, [review]);
  assert.deepEqual(
    listed.comments.map((c) => [c.id, c.text, c.status, c.reviewId]),
    [
      [ids[0], 'One', 'open', review.id],
      [ids[1], 'Two', 'open', review.id],
    ],
  );

  const shown = await api.review.show({ id: review.id });
  assert.deepEqual(shown, {
    id: review.id,
    sessionId,
    submittedAt: review.submittedAt,
    comments: listed.comments,
  });
});

test('writing after a submit starts a new draft review, and review show shows only its own comments', async (t) => {
  const { api, sessionId } = await setUp(t);
  const first = await submit(api, sessionId, 'One');
  const second = await submit(api, sessionId, 'Two', 'Three');
  assert.notEqual(first.review.id, second.review.id);
  assert.deepEqual(
    (await api.review.show({ id: second.review.id })).comments.map(
      (c) => c.text,
    ),
    ['Two', 'Three'],
  );
  const listed = await api.review.list({ sessionId });
  assert.deepEqual(
    listed.reviews.map((r) => r.id),
    [second.review.id, first.review.id],
  );
  assert.deepEqual(
    listed.comments.map((c) => c.text),
    ['One', 'Two', 'Three'],
  );
});

test('an empty draft review cannot be submitted', async (t) => {
  const { api, sessionId } = await setUp(t);
  const message = `The draft review in session ${sessionId} is empty, so it can't be submitted.`;
  await rejects(api.review.submit({ sessionId }), 'CONFLICT', message);
  const { id } = await api.comment.add({ sessionId, text: 'Gone' });
  await api.comment.delete({ id });
  await rejects(api.review.submit({ sessionId }), 'CONFLICT', message);
  await submit(api, sessionId, 'One');
  await rejects(api.review.submit({ sessionId }), 'CONFLICT', message);
  assert.equal((await api.review.list({ sessionId })).reviews.length, 1);
});

test('a submitted comment cannot be edited or deleted', async (t) => {
  const { api, sessionId } = await setUp(t);
  const {
    ids: [id],
  } = await submit(api, sessionId, 'One');
  await rejects(
    api.comment.edit({ id: id!, text: 'Changed' }),
    'CONFLICT',
    `Comment ${id} has been submitted, so it can't be edited.`,
  );
  await rejects(
    api.comment.delete({ id: id! }),
    'CONFLICT',
    `Comment ${id} has been submitted, so it can't be deleted.`,
  );
  assert.equal((await api.review.list({ sessionId })).comments[0]!.text, 'One');
});

test('comments in the draft review are hidden from every procedure agents use', async (t) => {
  const { api, sessionId } = await setUp(t);
  const { review } = await submit(api, sessionId, 'Submitted');
  const draft = await api.comment.add({ sessionId, text: 'Draft' });
  assert.deepEqual(
    (await api.review.show({ id: review.id })).comments.map((c) => c.text),
    ['Submitted'],
  );
  await rejects(
    api.comment.reply({ id: draft.id, status: 'addressed', text: 'Done.' }),
    'NOT_FOUND',
    `There's no comment ${draft.id}.`,
  );
  await rejects(
    api.comment.resolve({ id: draft.id }),
    'NOT_FOUND',
    `There's no comment ${draft.id}.`,
  );
  const shown = await api.session.show({ id: sessionId });
  assert.deepEqual(shown.commentCounts, {
    open: 1,
    addressed: 0,
    needs_input: 0,
    resolved: 0,
  });
});

test('comment reply adds the reply and sets the status, and the latest reply decides it', async (t) => {
  const { api, sessionId } = await setUp(t);
  const {
    review,
    ids: [id],
  } = await submit(api, sessionId, 'One');
  assert.deepEqual(
    await api.comment.reply({ id: id!, status: 'addressed', text: ' Done. ' }),
    { id, status: 'addressed' },
  );
  assert.deepEqual(
    await api.comment.reply({
      id: id!,
      status: 'needs_input',
      text: 'Actually, which file?',
    }),
    { id, status: 'needs_input' },
  );
  const [comment] = (await api.review.show({ id: review.id })).comments;
  assert.equal(comment!.status, 'needs_input');
  assert.deepEqual(
    comment!.replies.map(({ author, status, text }) => [author, status, text]),
    [
      ['agent', 'addressed', 'Done.'],
      ['agent', 'needs_input', 'Actually, which file?'],
    ],
  );
  assert.match(comment!.replies[0]!.createdAt, isoTimestamp);
});

test('comment reply works on a resolved comment, which moves it out of resolved', async (t) => {
  const { api, sessionId } = await setUp(t);
  const {
    ids: [id],
  } = await submit(api, sessionId, 'One');
  await api.comment.resolve({ id: id! });
  assert.deepEqual(
    await api.comment.reply({ id: id!, status: 'needs_input', text: 'Why?' }),
    { id, status: 'needs_input' },
  );
  await api.comment.resolve({ id: id! });
  assert.deepEqual(
    await api.comment.reply({ id: id!, status: 'addressed', text: 'Done.' }),
    { id, status: 'addressed' },
  );
});

test('resolving works from any status and takes effect at once', async (t) => {
  const { api, sessionId } = await setUp(t);
  const { ids } = await submit(api, sessionId, 'Open', 'Addressed', 'Needs');
  await api.comment.reply({ id: ids[1]!, status: 'addressed', text: 'Done.' });
  await api.comment.reply({ id: ids[2]!, status: 'needs_input', text: '?' });
  for (const id of ids) await api.comment.resolve({ id });
  // Resolving a resolved comment keeps it resolved.
  await api.comment.resolve({ id: ids[0]! });
  assert.deepEqual(
    (await api.review.list({ sessionId })).comments.map((c) => c.status),
    ['resolved', 'resolved', 'resolved'],
  );
});

test('session show counts submitted comments by status', async (t) => {
  const { api, sessionId } = await setUp(t);
  assert.deepEqual((await api.session.show({ id: sessionId })).commentCounts, {
    open: 0,
    addressed: 0,
    needs_input: 0,
    resolved: 0,
  });
  const { ids } = await submit(api, sessionId, 'A', 'B', 'C', 'D');
  await api.comment.reply({ id: ids[0]!, status: 'addressed', text: 'Done.' });
  await api.comment.reply({ id: ids[1]!, status: 'needs_input', text: '?' });
  await api.comment.resolve({ id: ids[2]! });
  await api.comment.add({ sessionId, text: 'In the draft review' });
  assert.deepEqual((await api.session.show({ id: sessionId })).commentCounts, {
    open: 1,
    addressed: 1,
    needs_input: 1,
    resolved: 1,
  });
});

test('on an archived session, every change fails naming the session, and reading still works', async (t) => {
  const { api, sessionId } = await setUp(t);
  const {
    review,
    ids: [submitted],
  } = await submit(api, sessionId, 'Submitted');
  const draft = await api.comment.add({ sessionId, text: 'Draft' });
  await api.session.archive({ id: sessionId });

  const changed = `Session ${sessionId} is archived, so its draft review can't be changed.`;
  await rejects(
    api.comment.add({ sessionId, text: 'New' }),
    'CONFLICT',
    changed,
  );
  await rejects(
    api.comment.edit({ id: draft.id, text: 'Changed' }),
    'CONFLICT',
    changed,
  );
  await rejects(api.comment.delete({ id: draft.id }), 'CONFLICT', changed);
  await rejects(
    api.review.submit({ sessionId }),
    'CONFLICT',
    `Session ${sessionId} is archived, so its draft review can't be submitted.`,
  );
  await rejects(
    api.comment.reply({ id: submitted!, status: 'addressed', text: 'Done.' }),
    'CONFLICT',
    `Session ${sessionId} is archived, so its comments can't be replied to.`,
  );
  await rejects(
    api.comment.resolve({ id: submitted! }),
    'CONFLICT',
    `Session ${sessionId} is archived, so its comments can't be resolved.`,
  );

  const listed = await api.review.list({ sessionId });
  assert.deepEqual(listed.draftReview.comments, [draft]);
  assert.deepEqual(
    listed.comments.map((c) => [c.id, c.status, c.replies.length]),
    [[submitted, 'open', 0]],
  );
  assert.equal((await api.review.show({ id: review.id })).id, review.id);
});

test('every comment and review procedure fails for an unknown or malformed ID', async (t) => {
  const { api } = await setUp(t);
  for (const id of ['s_7kq9a1', 'nope', '']) {
    const message = `There's no session ${id}.`;
    await rejects(
      api.comment.add({ sessionId: id, text: 'One' }),
      'NOT_FOUND',
      message,
    );
    await rejects(api.review.submit({ sessionId: id }), 'NOT_FOUND', message);
    await rejects(api.review.list({ sessionId: id }), 'NOT_FOUND', message);
  }
  for (const id of ['c_7kq9a1', 'nope', '']) {
    const message = `There's no comment ${id}.`;
    await rejects(api.comment.edit({ id, text: 'One' }), 'NOT_FOUND', message);
    await rejects(api.comment.delete({ id }), 'NOT_FOUND', message);
    await rejects(
      api.comment.reply({ id, status: 'addressed', text: 'Done.' }),
      'NOT_FOUND',
      message,
    );
    await rejects(api.comment.resolve({ id }), 'NOT_FOUND', message);
  }
  for (const id of ['r_7kq9a1', 'nope', '']) {
    await rejects(
      api.review.show({ id }),
      'NOT_FOUND',
      `There's no review ${id}.`,
    );
  }
});

test('comment and reply text that is empty or too long is rejected with a readable error', async (t) => {
  const { api, sessionId } = await setUp(t);
  await rejects(
    api.comment.add({ sessionId, text: '  ' }),
    'BAD_REQUEST',
    'The comment must not be empty.',
  );
  await rejects(
    api.comment.add({ sessionId, text: 'T'.repeat(10_001) }),
    'BAD_REQUEST',
    'The comment must be at most 10,000 characters.',
  );
  const { id } = await api.comment.add({ sessionId, text: 'T'.repeat(10_000) });
  await rejects(
    api.comment.edit({ id, text: '' }),
    'BAD_REQUEST',
    'The comment must not be empty.',
  );
  await api.review.submit({ sessionId });
  await rejects(
    api.comment.reply({ id, status: 'addressed', text: '\n' }),
    'BAD_REQUEST',
    'The reply must not be empty.',
  );
  await rejects(
    api.comment.reply({ id, status: 'addressed', text: 'T'.repeat(10_001) }),
    'BAD_REQUEST',
    'The reply must be at most 10,000 characters.',
  );
  const [comment] = (await api.review.list({ sessionId })).comments;
  assert.equal(comment!.text.length, 10_000);
  assert.deepEqual(comment!.replies, []);
});

test('deleting a session deletes its reviews, comments, and replies', async (t) => {
  const { api, sessionId } = await setUp(t);
  const {
    review,
    ids: [id],
  } = await submit(api, sessionId, 'One');
  await api.comment.reply({ id: id!, status: 'addressed', text: 'Done.' });
  await api.session.delete({ id: sessionId });
  await rejects(
    api.review.show({ id: review.id }),
    'NOT_FOUND',
    `There's no review ${review.id}.`,
  );
  await rejects(
    api.comment.reply({ id: id!, status: 'addressed', text: 'Done.' }),
    'NOT_FOUND',
    `There's no comment ${id}.`,
  );
});

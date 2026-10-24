// The comment and review loop through the review UI's comment panel: the
// reviewer writes overall comments in the draft review and submits it, the
// agent fetches the review and replies with the CLI, and the reviewer resolves
// comments.
import { expect, type Locator, type Page } from '@playwright/test';
import { agentDiff, test } from './helpers.ts';

function panel(page: Page) {
  const comments = page.getByRole('complementary', { name: 'Comments' });
  return {
    comments,
    threads: comments.getByRole('region', { name: 'Threads' }),
    draft: comments.getByRole('region', { name: 'Your draft review' }),
    reviews: comments.getByRole('region', { name: 'Reviews' }),
  };
}

// The review message from decision 0043.
function reviewMessage(reviewId: string, sessionId: string): string {
  return `[agent-diff review ${reviewId}] The reviewer submitted review ${reviewId} in session ${sessionId}. Finish what you're doing first, then run \`agent-diff review show ${reviewId}\`, address each comment, and reply to each one with \`agent-diff comment reply\`.`;
}

async function addComment(draft: Locator, text: string): Promise<void> {
  await draft.getByLabel('New comment').fill(text);
  await draft.getByRole('button', { name: 'Add comment' }).click();
  await expect(draft.getByLabel('New comment')).toHaveValue('');
}

// Writes the comments in the draft review and submits it, returning the new
// review's ID.
async function submitComments(page: Page, ...texts: string[]) {
  const { draft, reviews } = panel(page);
  for (const text of texts) await addComment(draft, text);
  const count = reviews.getByRole('listitem').count();
  await draft.getByRole('button', { name: 'Submit review' }).click();
  await expect(reviews.getByRole('listitem')).toHaveCount((await count) + 1);
  const id = await reviews
    .getByRole('listitem')
    .first()
    .getByTestId('review-id')
    .textContent();
  return id!;
}

test('the reviewer writes, edits, and deletes comments in the draft review, and submits it', async ({
  page,
  session,
}) => {
  await page.goto(session.url);
  const { threads, draft, reviews } = panel(page);
  const draftComments = draft.getByTestId('draft-comment-text');
  const submit = draft.getByRole('button', { name: 'Submit review' });
  await expect(
    draft.getByText('No comments in your draft review'),
  ).toBeVisible();
  await expect(submit).toBeDisabled();
  await expect(threads).toContainText('No comments have been submitted.');
  await expect(reviews).toContainText('No reviews have been submitted.');

  await addComment(draft, 'First comment');
  await addComment(draft, 'Second comment');
  await expect(draftComments).toHaveText(['First comment', 'Second comment']);
  await expect(
    draft.getByText('2 comments in your draft review'),
  ).toBeVisible();

  const first = draft.getByRole('listitem').nth(0);
  await first.getByRole('button', { name: 'Edit' }).click();
  await first.getByLabel('Edit comment').fill('  Edited first comment ');
  await first.getByRole('button', { name: 'Save' }).click();
  await expect(draftComments).toHaveText([
    'Edited first comment',
    'Second comment',
  ]);
  await draft
    .getByRole('listitem')
    .nth(1)
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(draftComments).toHaveText(['Edited first comment']);
  await expect(draft.getByText('1 comment in your draft review')).toBeVisible();
  await addComment(draft, 'Third comment');
  await expect(draftComments).toHaveText([
    'Edited first comment',
    'Third comment',
  ]);

  // The draft review is saved on the review server, so it survives a reload.
  await page.reload();
  await expect(draftComments).toHaveText([
    'Edited first comment',
    'Third comment',
  ]);

  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(reviews.getByRole('listitem')).toHaveCount(1);
  const review = reviews.getByRole('listitem').first();
  const reviewId = await review.getByTestId('review-id').textContent();
  expect(reviewId).toMatch(/^r_[0-9abcdefghjkmnpqrstvwxyz]{6}$/);
  await expect(review.getByTestId('review-message')).toHaveText(
    reviewMessage(reviewId!, session.id),
  );
  await expect(review.getByRole('time')).toHaveText(/\d/);
  await expect(
    draft.getByText('No comments in your draft review'),
  ).toBeVisible();
  await expect(draftComments).toHaveCount(0);
  await expect(submit).toBeDisabled();
  await expect(threads.getByTestId('comment-text')).toHaveText([
    'Edited first comment',
    'Third comment',
  ]);
  await expect(threads.getByTestId('comment-status')).toHaveText([
    'open',
    'open',
  ]);
});

test('the agent fetches the review and replies, and the reviewer resolves the comment', async ({
  page,
  env,
  session,
}) => {
  await page.goto(session.url);
  const { threads } = panel(page);
  const reviewId = await submitComments(page, 'Use the config file.');
  const thread = threads.getByTestId('thread').first();
  const commentId = (await thread.getByTestId('comment-id').textContent())!;

  const shown = agentDiff(env, 'review', 'show', reviewId);
  expect(shown).toContain(
    `\n### ${commentId} (open)\n\nReviewer: Use the config file.\n`,
  );
  expect(
    agentDiff(
      env,
      'comment',
      'reply',
      commentId,
      '--needs-input',
      'Which config file?',
    ),
  ).toBe(`Replied to ${commentId}. It now needs input.\n`);

  // No live updates, so the reply shows after a reload.
  await page.reload();
  await expect(thread.getByTestId('comment-status')).toHaveText('needs input');
  await expect(thread.getByTestId('thread-entry')).toHaveText([
    'Reviewer: Use the config file.',
    'Agent, needs input: Which config file?',
  ]);

  await thread.getByRole('button', { name: 'Resolve' }).click();
  await expect(thread.getByTestId('comment-status')).toHaveText('resolved');
  // Resolved threads collapse to one line, and expand on click.
  await expect(thread.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  await expect(thread.getByText('Which config file?')).toBeHidden();
  await thread.getByText(commentId).click();
  await expect(
    thread.getByText('Agent, needs input: Which config file?'),
  ).toBeVisible();
  expect(agentDiff(env, 'session', 'show', session.id)).toContain(
    '\n1 comment: 1 resolved.\n',
  );
});

test("an archived session's panel shows threads and reviews, without the draft review or Resolve", async ({
  page,
  env,
  session,
}) => {
  await page.goto(session.url);
  const { comments, threads, draft, reviews } = panel(page);
  await submitComments(page, 'Submitted comment');
  await addComment(draft, 'Never submitted');
  agentDiff(env, 'session', 'archive', session.id);

  await page.reload();
  await expect(comments).toContainText(
    'This session is archived, so its comments are read-only.',
  );
  await expect(threads.getByTestId('comment-text')).toHaveText([
    'Submitted comment',
  ]);
  await expect(reviews.getByRole('listitem')).toHaveCount(1);
  await expect(draft).toHaveCount(0);
  await expect(comments.getByText('Never submitted')).toHaveCount(0);
  await expect(comments.getByRole('button', { name: 'Resolve' })).toHaveCount(
    0,
  );
  await expect(comments.getByRole('textbox')).toHaveCount(0);
  await expect(
    comments.getByRole('button', { name: 'Copy review message' }),
  ).toBeVisible();
});

test('the copy button puts the review message on the clipboard', async ({
  page,
  context,
  reviewServer,
  session,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: reviewServer.origin,
  });
  await page.goto(session.url);
  const reviewId = await submitComments(page, 'One');
  const { reviews } = panel(page);
  await reviews.getByRole('button', { name: 'Copy review message' }).click();
  await expect(reviews.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate('navigator.clipboard.readText()')).toBe(
    reviewMessage(reviewId, session.id),
  );
});

test('a comment that is too long is refused with a readable error', async ({
  page,
  session,
}) => {
  await page.goto(session.url);
  const { draft } = panel(page);
  await draft.getByLabel('New comment').fill('T'.repeat(10_001));
  await draft.getByRole('button', { name: 'Add comment' }).click();
  await expect(draft.getByRole('alert')).toHaveText(
    'The comment must be at most 10,000 characters.',
  );
  await expect(draft.getByTestId('draft-comment-text')).toHaveCount(0);
});

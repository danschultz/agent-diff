// Opens a session in the review UI at the URL `agent-diff session new`
// prints, as a user would.
import { expect, type Page } from '@playwright/test';
import {
  agentDiff,
  countShowCalls,
  settle,
  test,
  withOrigin,
} from './helpers.ts';

const notFound = "There's no session at this address.";

async function expectSession(
  page: Page,
  session: { id: string; repo: string; plain: string },
): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check');
  await expect(page.getByText(session.id, { exact: true })).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('Active');
  await expect(page.getByTestId('created')).toHaveText(/\d/);
  await expect(page.getByRole('listitem')).toHaveText([
    `${session.repo} base ref main`,
    `${session.plain} doesn't use git`,
  ]);
}

test('the URL session new prints opens the session', async ({
  page,
  reviewServer,
  session,
}) => {
  expect(session.url).toBe(
    `${reviewServer.origin}sessions/${session.id}#token=${reviewServer.token}`,
  );
  await page.goto(session.url);
  await expectSession(page, session);
  await expect(page).toHaveURL(`${reviewServer.origin}sessions/${session.id}`);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an archived session says when it was archived', async ({
  page,
  env,
  session,
}) => {
  agentDiff(env, 'session', 'archive', session.id);
  await page.goto(session.url);
  await expect(page.getByTestId('status')).toHaveText(/^Archived on \d/);
});

test('an unknown or malformed session ID shows the not-found message', async ({
  page,
  reviewServer,
  session,
}) => {
  await page.goto(session.url);
  await expectSession(page, session);
  for (const id of ['s_zzzzzz', 'nope']) {
    await page.goto(`${reviewServer.origin}sessions/${id}`);
    await expect(page.getByRole('alert')).toHaveText(notFound);
    await expect(page.getByRole('heading')).toHaveCount(0);
  }
});

test('a session is asked for once, and not again when the window regains focus', async ({
  page,
  session,
}) => {
  const calls = countShowCalls(page);
  await page.goto(session.url);
  await expectSession(page, session);
  // A page shows what the API returned when it loaded, with no live updates.
  // As a string, since e2e/ is typed for Node, without the DOM.
  await page.evaluate(`
    window.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  `);
  await page.waitForTimeout(settle);
  expect(calls()).toBe(1);
});

test('an unknown session ID is asked for once, without retrying', async ({
  page,
  reviewServer,
  session,
}) => {
  await page.goto(session.url);
  await expectSession(page, session);
  const calls = countShowCalls(page);
  await page.goto(`${reviewServer.origin}sessions/s_zzzzzz`);
  await expect(page.getByRole('alert')).toHaveText(notFound);
  await page.waitForTimeout(settle);
  expect(calls()).toBe(1);
});

test('every other path shows the not-found message, including /', async ({
  page,
  reviewServer,
  session,
}) => {
  for (const path of ['', 'sessions', `sessions/${session.id}/files`, 'x']) {
    await page.goto(
      `${reviewServer.origin}${path}#token=${reviewServer.token}`,
    );
    await expect(page.getByRole('alert')).toHaveText(notFound);
    await expect(page.getByRole('heading')).toHaveCount(0);
  }
});

test("a session's link opens the session on the dev server", async ({
  page,
  session,
  devServer,
}) => {
  expect(devServer.origin).toMatch(/^http:\/\/localhost:\d+\/$/);
  // Only `session new` and `session show` print links with the token.
  expect(devServer.output()).not.toContain('token');
  await page.goto(withOrigin(session.url, devServer.origin));
  await expectSession(page, session);
  await expect(page).toHaveURL(`${devServer.origin}sessions/${session.id}`);
});

// How the review UI gets the token from the URL `agent-diff server start`
// prints, and what it shows without one (decision 0031).
import { expect, type Page } from '@playwright/test';
import { test } from './helpers.ts';

const message = 'Open the link printed by agent-diff server start.';

function savedToken(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('agent-diff.token'));
}

test('the token is saved, removed from the address bar, and used after a reload', async ({
  page,
  reviewServer,
}) => {
  let documents = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents += 1;
  });
  await page.goto(reviewServer.url);
  await expect(
    page.getByRole('heading', { name: 'Hello, world!' }),
  ).toBeVisible();
  await expect(page).toHaveURL(reviewServer.origin);
  expect(await savedToken(page)).toBe(reviewServer.token);
  // The fragment was removed without reloading.
  expect(documents).toBe(1);

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Hello, world!' }),
  ).toBeVisible();
  await expect(page).toHaveURL(reviewServer.origin);
});

test('the token is read from the fragment on any path', async ({
  page,
  reviewServer,
}) => {
  const url = new URL('/review-sessions/1?view=tree', reviewServer.origin);
  url.hash = `token=${reviewServer.token}`;
  await page.goto(url.href);
  await expect(
    page.getByRole('heading', { name: 'Hello, world!' }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    new URL('/review-sessions/1?view=tree', reviewServer.origin).href,
  );
  expect(await savedToken(page)).toBe(reviewServer.token);
});

test('without a saved token the review UI says to open the printed link', async ({
  page,
  reviewServer,
}) => {
  await page.goto(reviewServer.origin);
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(page.getByRole('heading')).toHaveCount(0);
});

test('with a wrong token the review UI says to open the printed link', async ({
  page,
  reviewServer,
}) => {
  await page.goto(`${reviewServer.origin}#token=wrong`);
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(page).toHaveURL(reviewServer.origin);
  expect(await savedToken(page)).toBe('wrong');

  // A token in the URL replaces the saved one, also when the link is opened
  // in the same tab, which only changes the fragment.
  await page.goto(reviewServer.url);
  await expect(
    page.getByRole('heading', { name: 'Hello, world!' }),
  ).toBeVisible();
  expect(await savedToken(page)).toBe(reviewServer.token);
});

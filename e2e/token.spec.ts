// How the review UI gets the token from the URL `agent-diff session new`
// prints, and what it shows without one (decisions 0031 and 0039).
import { expect, type Page } from '@playwright/test';
import { test } from './helpers.ts';

const message =
  'Open the link printed by agent-diff session new or agent-diff session show.';

function savedToken(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('agent-diff.token'));
}

test('the token is saved, removed from the address bar, and used after a reload', async ({
  page,
  reviewServer,
  session,
}) => {
  let documents = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents += 1;
  });
  const address = `${reviewServer.origin}sessions/${session.id}`;
  await page.goto(session.url);
  await expect(page.getByRole('heading', { name: 'Check' })).toBeVisible();
  await expect(page).toHaveURL(address);
  expect(await savedToken(page)).toBe(reviewServer.token);
  // The fragment was removed without reloading.
  expect(documents).toBe(1);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Check' })).toBeVisible();
  await expect(page).toHaveURL(address);
});

test('the token is read from the fragment on any path', async ({
  page,
  reviewServer,
  session,
}) => {
  for (const path of [`/sessions/${session.id}?view=tree`, '/', '/x?y=1']) {
    await page.goto(reviewServer.origin);
    await page.evaluate(() => localStorage.clear());
    const url = new URL(path, reviewServer.origin);
    url.hash = `token=${reviewServer.token}`;
    await page.goto(url.href);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page).toHaveURL(new URL(path, reviewServer.origin).href);
    expect(await savedToken(page)).toBe(reviewServer.token);
  }
  await page.goto(`${reviewServer.origin}sessions/${session.id}`);
  await expect(page.getByRole('heading', { name: 'Check' })).toBeVisible();
});

test('without a saved token the review UI says to open a printed link', async ({
  page,
  reviewServer,
  session,
}) => {
  await page.goto(`${reviewServer.origin}sessions/${session.id}`);
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(page.getByRole('heading')).toHaveCount(0);
});

test('with a wrong token the review UI says to open a printed link', async ({
  page,
  reviewServer,
  session,
}) => {
  const address = `${reviewServer.origin}sessions/${session.id}`;
  await page.goto(`${address}#token=wrong`);
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(page).toHaveURL(address);
  expect(await savedToken(page)).toBe('wrong');

  // A token in the URL replaces the saved one, also when the link is opened
  // in the same tab, which only changes the fragment.
  await page.goto(session.url);
  await expect(page.getByRole('heading', { name: 'Check' })).toBeVisible();
  expect(await savedToken(page)).toBe(reviewServer.token);
});

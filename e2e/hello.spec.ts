// Opens the review UI at the URL `agent-diff server start` prints, as a user
// would, and checks that it shows the `hello` endpoint's message.
import { expect } from '@playwright/test';
import { test } from './helpers.ts';

test('the review UI shows the hello message', async ({
  page,
  reviewServer,
}) => {
  await page.goto(reviewServer.url);
  await expect(
    page.getByRole('heading', { name: 'Hello, world!' }),
  ).toBeVisible();
});

test('the review UI shows the hello message through the dev server', async ({
  page,
  devServer,
}) => {
  expect(devServer.origin).toMatch(/^http:\/\/localhost:\d+\/$/);
  await page.goto(devServer.url);
  await expect(
    page.getByRole('heading', { name: 'Hello, world!' }),
  ).toBeVisible();
  await expect(page).toHaveURL(devServer.origin);
});

import { expect, test } from '@playwright/test';

// The whole stack in the browser: service worker, Hono, PGlite with the demo haulier.
test('opens on the resources, with the fleet of the mockups and its expiries', async ({ page }) => {
  // Answered by the service worker: if the in-browser API fails, say so rather than time out
  // looking for rows that will never come.
  const resources = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/resources');
  await page.goto('/');
  const answer = await resources;
  expect(answer.status(), `GET /api/resources answered: ${await answer.text()}`).toBe(200);

  await expect(page).toHaveURL(/\/resources\/drivers$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Resources' })).toBeVisible();
  const drivers = page.getByRole('table');
  await expect(drivers.getByRole('row')).toHaveCount(19);
  await expect(drivers.getByRole('row', { name: /Thomas Girard/ })).toContainText(
    'Expired · blocking',
  );

  await page.getByRole('link', { name: /Expiries/ }).click();
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(10);
  await expect(rows.nth(1)).toContainText('T. Girard');
  await expect(rows.nth(9)).toContainText('L. Fabre');
});

import { expect, test } from '@playwright/test';

// The whole slice in the browser: service worker, Hono, PGlite and the exclusion constraint.
test('books a resource and is refused an overlap', async ({ page }) => {
  // Answered by the service worker: if the in-browser API fails, say so rather than time out
  // looking for options that will never come.
  const resources = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/resources');
  await page.goto('/');
  const answer = await resources;
  expect(answer.status(), `GET /api/resources answered: ${await answer.text()}`).toBe(200);
  await expect(page.getByRole('heading', { name: 'Resource bookings' })).toBeVisible();

  const resource = page.getByLabel('Resource');
  await expect(resource.locator('option')).not.toHaveCount(0);
  await resource.selectOption({ label: 'K. Benali · Driver' });

  await page.getByLabel('Label').fill('CMD-2053');
  await page.getByLabel('Start').fill('2030-01-07T08:00');
  await page.getByLabel('End').fill('2030-01-07T12:00');
  await page.getByRole('button', { name: 'Book' }).click();
  await expect(page.getByRole('status')).toHaveText('Booking created.');
  // The form moves on: empty label, next slot, so no warning against the booking just made.
  await expect(page.getByLabel('Label')).toHaveValue('');
  await expect(page.getByLabel('Start')).toHaveValue('2030-01-07T12:00');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByLabel('Label').fill('CMD-2054');
  await page.getByLabel('Start').fill('2030-01-07T11:00');
  await page.getByLabel('End').fill('2030-01-07T14:00');
  await expect(page.getByRole('alert')).toContainText('CMD-2053');
  await page.getByRole('button', { name: 'Book' }).click();
  await expect(page.getByRole('alert').last()).toContainText('Refused by the server');
});

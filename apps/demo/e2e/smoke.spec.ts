import { expect, test } from '@playwright/test';

// The whole slice in the browser: service worker, Hono, PGlite and the exclusion constraint.
test('books a resource and is refused an overlap', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Resource bookings' })).toBeVisible();

  const resource = page.getByLabel('Resource');
  await expect(resource.locator('option')).not.toHaveCount(0);
  await resource.selectOption({ label: 'K. Benali · Driver' });

  await page.getByLabel('Label').fill('CMD-2053');
  await page.getByLabel('Start').fill('2030-01-07T08:00');
  await page.getByLabel('End').fill('2030-01-07T12:00');
  await page.getByRole('button', { name: 'Book' }).click();
  await expect(page.getByRole('status')).toHaveText('Booking created.');

  await page.getByLabel('Label').fill('CMD-2054');
  await page.getByLabel('Start').fill('2030-01-07T11:00');
  await page.getByLabel('End').fill('2030-01-07T14:00');
  await expect(page.getByRole('alert')).toContainText('CMD-2053');
  await page.getByRole('button', { name: 'Book' }).click();
  await expect(page.getByRole('alert').last()).toContainText('Refused by the server');
});

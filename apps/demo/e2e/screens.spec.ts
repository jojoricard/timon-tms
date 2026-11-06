import { expect, type Page, test } from '@playwright/test';

// Details of single screens: what a banner says and for how long, where a badge sits, what a
// number field accepts, and the language switch keeping the work under way.

async function open(page: Page, path: string) {
  const ready = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/resources' && r.status() === 200,
    { timeout: 45_000 },
  );
  await page.goto('/');
  await ready;
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function newDriver(page: Page, lastName: string) {
  await open(page, '/resources/drivers/new');
  await page.getByLabel('Last name').fill(lastName);
  await page.getByLabel('First name').fill('Test');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/resources\/drivers\/[0-9a-f-]{36}$/);
}

test('an archived resource says so in one banner', async ({ page }) => {
  await newDriver(page, 'Archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  const banners = page.locator('main .t-banner');
  await expect(banners).toHaveCount(1);
  await expect(banners).toContainText('This resource is archived');
  await expect(banners).toContainText('can be restored');
});

test('"Saved." goes with the next action', async ({ page }) => {
  await newDriver(page, 'Saved');
  await page.getByLabel('Phone').fill('06 12 34 56 78');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  const editor = page.getByRole('form', { name: 'Adding a document' });
  await editor.getByLabel('Type').selectOption({ index: 1 });
  await editor.getByLabel('Expires').fill('2030-01-01');
  await editor.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.resource-documents tbody tr')).toHaveCount(1);
  await expect(page.getByText('Saved.')).toHaveCount(0);
});

test('a customer saved says "Saved."', async ({ page }) => {
  await open(page, '/customers');
  await page.locator('main table tbody .row-link').first().click();
  await page.getByLabel('City').first().fill('Ailleurs');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
});

test('a weight takes digits only', async ({ page }) => {
  await open(page, '/resources/power-units/new');
  await page.getByLabel('Gross vehicle weight (kg)').fill('1e3');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Gross vehicle weight: “1e3” is not a whole number')).toBeVisible();
});

test('a started unit shows its badges by its title, and no saving advice', async ({ page }) => {
  await open(page, '/resources/units');
  await page.locator('main table tbody .row-link').first().click();
  await expect(page.getByRole('button', { name: 'Change driver or trailer' })).toBeVisible();
  await expect(page.getByText(/A warning only: the unit can be saved/)).toHaveCount(0);
  const title = await page.getByRole('heading', { level: 1 }).boundingBox();
  const badge = await page.locator('.t-page-header .t-badge').first().boundingBox();
  expect(badge && title).toBeTruthy();
  if (!badge || !title) return;
  // On the line of the title, right after it.
  expect(badge.x - (title.x + title.width)).toBeLessThan(40);
  expect(badge.y + badge.height / 2).toBeGreaterThan(title.y);
  expect(badge.y + badge.height / 2).toBeLessThan(title.y + title.height);
});

test('switching the language keeps an import under way', async ({ page }) => {
  await open(page, '/customers/import');
  await page.getByLabel('CSV file').setInputFiles({
    name: 'customers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('code;name;country\nLANG-1;Langue;France'),
  });
  await expect(page.getByRole('button', { name: 'Import every line (1)' })).toBeEnabled();
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.getByRole('heading', { level: 1, name: 'Importer des clients' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tout importer (1)' })).toBeEnabled();
  await expect(page.getByRole('cell', { name: 'LANG-1' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});

test('in English, every date is British: day before month, no comma after the weekday', async ({
  page,
}) => {
  const american =
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*, /;
  for (const path of [
    '/resources/drivers',
    '/resources/trailers',
    '/resources/expiries',
    '/resources/units',
    '/customers',
    '/customers/sites',
  ]) {
    await open(page, path);
    await expect(page.locator('main table').first()).toBeVisible();
    expect(await page.locator('main').innerText(), path).not.toMatch(american);
  }
  await open(page, '/resources/drivers');
  await page.getByRole('link', { name: 'Karim Benali' }).click();
  await expect(page.getByRole('region', { name: /^Units/ })).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(american);
  await expect(page.locator('main')).toContainText(/\d{2}\/\d{2}\/\d{4}/);
});

test('the expiry counters say they cover every resource, whatever the filters', async ({
  page,
}) => {
  await open(page, '/resources/expiries');
  await expect(
    page.getByText('These counters cover every resource in service, whatever the filters below.'),
  ).toBeVisible();
  const counters = (await page.locator('.t-metrics').textContent()) ?? '';
  await page.getByRole('button', { name: 'Trailers' }).click();
  await page.getByLabel('Blocking only').check();
  await expect(page.locator('.t-metrics')).toHaveText(counters);
});

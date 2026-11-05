import { expect, type Page, test } from '@playwright/test';

// How every form behaves: one request per submit, errors next to their field, no input lost
// without a warning. Each test gets a fresh browser context, hence a fresh demo haulier.

/** Opens a page once the in-browser API answers: its database starts with the first request. */
async function open(page: Page, path: string) {
  const ready = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/reference-lists', {
    timeout: 45_000,
  });
  await page.goto(path);
  expect((await ready).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** The drivers in service, read from the in-browser API. */
async function drivers(page: Page): Promise<{ firstName: string; lastName: string }[]> {
  return page.evaluate(async () => {
    const response = await fetch('/api/resources?kind=driver');
    const body = (await response.json()) as {
      resources: { firstName: string; lastName: string }[];
    };
    return body.resources;
  });
}

/** Counts the requests the page sends with this method to this API path. */
function countRequests(page: Page, method: string, path: RegExp) {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.method() === method && path.test(new URL(request.url()).pathname)) {
      seen.push(request.url());
    }
  });
  return () => seen.length;
}

/**
 * Three clicks in the same task, faster than any person: React has not rendered the disabled
 * button between them, so only a lock taken at the first click stops the second.
 */
async function burst(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).evaluate((button: HTMLButtonElement) => {
    for (let i = 0; i < 3; i += 1) button.click();
  });
}

test.describe('one request per submit', () => {
  test('a burst of clicks on Create creates one driver', async ({ page }) => {
    await open(page, '/resources/drivers/new');
    await page.getByLabel('Last name').fill('Doublon');
    await page.getByLabel('First name').fill('Test');
    await burst(page, 'Create');
    await expect(page).toHaveURL(/\/resources\/drivers\/[0-9a-f-]{36}$/);
    const same = (await drivers(page)).filter((d) => d.lastName === 'Doublon');
    expect(same).toHaveLength(1);
  });

  test('a burst of clicks on Import imports the file once', async ({ page }) => {
    await open(page, '/resources/drivers/import');
    await page.getByLabel('CSV file').setInputFiles({
      name: 'import.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(['nom;prenom', 'Import;Alice', 'Import;Bruno'].join('\n')),
    });
    await expect(page.getByRole('button', { name: 'Import every line (2)' })).toBeEnabled();
    await burst(page, 'Import every line (2)');
    await expect(page.getByText(/Imported: 2\./)).toBeVisible();
    const imported = (await drivers(page)).filter((d) => d.lastName === 'Import');
    expect(imported).toHaveLength(2);
  });

  test('a burst of clicks on Archive sends one request', async ({ page }) => {
    await open(page, '/resources/drivers/new');
    await page.getByLabel('Last name').fill('Archive');
    await page.getByLabel('First name').fill('Test');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
    const archives = countRequests(page, 'POST', /\/api\/resources\/[^/]+\/archive$/);
    await burst(page, 'Archive');
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    expect(archives()).toBe(1);
  });
});

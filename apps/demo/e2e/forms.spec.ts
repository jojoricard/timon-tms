import { expect, type Locator, type Page, test } from '@playwright/test';

// How every form behaves: one request per submit, errors next to their field, no input lost
// without a warning. Each test gets a fresh browser context, hence a fresh demo haulier.

/**
 * Opens a page once the in-browser API answers: its database is created and seeded with the
 * first request, which the home screen makes.
 */
async function open(page: Page, path: string) {
  const ready = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/resources' && r.status() === 200,
    { timeout: 45_000 },
  );
  await page.goto('/');
  await ready;
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main :is(tbody tr, input, select)').first()).toBeVisible();
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
async function burst(page: Page, name: string, within: Page | Locator = page) {
  await within.getByRole('button', { name, exact: true }).evaluate((button: HTMLButtonElement) => {
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

  test('a burst of clicks on Archive, once confirmed, sends one request', async ({ page }) => {
    await open(page, '/resources/drivers/new');
    await page.getByLabel('Last name').fill('Archive');
    await page.getByLabel('First name').fill('Test');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
    const archives = countRequests(page, 'POST', /\/api\/resources\/[^/]+\/archive$/);
    await page.getByRole('button', { name: 'Archive' }).click();
    await burst(page, 'Archive', page.getByRole('alertdialog'));
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    expect(archives()).toBe(1);
  });
});

/** The first row of a list, opened. */
async function openFirst(page: Page, path: string) {
  await open(page, path);
  await page.locator('main table tbody .row-link').first().click();
  await expect(page).not.toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test.describe('errors under their fields', () => {
  test('an empty power unit shows every required field at once, the focus on the first', async ({
    page,
  }) => {
    await open(page, '/resources/power-units/new');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Registration plate is required')).toBeVisible();
    await expect(page.getByText('Regulatory category is required')).toBeVisible();
    await expect(page.getByText('Gross vehicle weight is required')).toBeVisible();
    await expect(page.getByLabel('Registration plate')).toBeFocused();
    await expect(page.getByLabel('Registration plate')).toHaveAttribute('aria-invalid', 'true');
  });

  test('an empty customer names the legal name, the field it shows', async ({ page }) => {
    await open(page, '/customers/new');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Legal name is required')).toBeVisible();
    await expect(page.getByText(/^Name is required/)).toHaveCount(0);
    await expect(page.getByLabel('Legal name')).toBeFocused();
  });

  test('a contact without phone or email marks both, and takes the focus', async ({ page }) => {
    await open(page, '/customers/new');
    await page.getByLabel('Legal name').fill('Contact test');
    await page.getByLabel('Code', { exact: true }).fill('CONTACT-TEST');
    await page.getByRole('button', { name: 'Add a contact' }).click();
    const row = page.getByRole('group', { name: 'Contact 1' });
    await row.getByLabel('Name').fill('Jean');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(row.getByLabel('Phone')).toHaveAttribute('aria-invalid', 'true');
    await expect(row.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
    await expect(row.getByLabel('Phone')).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('texts take the limits of the API', async ({ page }) => {
    await open(page, '/resources/drivers/new');
    await expect(page.getByLabel('First name')).toHaveAttribute('maxlength', '200');
    await expect(page.getByLabel('Last name')).toHaveAttribute('maxlength', '200');
  });

  test('a text the API refuses as too long shows under its field', async ({ page }) => {
    await open(page, '/resources/drivers/new');
    await page.getByLabel('Last name').fill('Long');
    const first = page.getByLabel('First name');
    // Past the limit the field sets, as a client without it would send.
    await first.evaluate((input) => input.removeAttribute('maxlength'));
    await first.fill('X'.repeat(300));
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('First name: 200 characters at most')).toBeVisible();
    await expect(first).toHaveAttribute('aria-invalid', 'true');
    await expect(first).toBeFocused();
    await expect(page.getByText(/request failed/i)).toHaveCount(0);
  });

  test('a unit ending before it starts says so under the end', async ({ page }) => {
    await open(page, '/resources/units/new');
    await page.getByLabel('Start').fill('2026-11-05T11:00');
    await page.getByLabel('End (optional)').fill('2026-11-05T09:00');
    await page.getByRole('button', { name: 'Save unit' }).click();
    const end = page.getByLabel('End (optional)');
    await expect(end).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.t-field', { has: end })).toContainText(
      'The end must be after the start',
    );
  });

  test('a document issued after it expires is refused on its date', async ({ page }) => {
    await openFirst(page, '/resources/drivers');
    const editor = page.getByRole('form', { name: 'Adding a document' });
    await editor.getByLabel('Type').selectOption({ index: 1 });
    await editor.getByLabel('Issued').fill('2027-01-10');
    await editor.getByLabel('Expires').fill('2026-01-10');
    await editor.getByRole('button', { name: 'Add' }).click();
    await expect(editor.getByLabel('Issued')).toHaveAttribute('aria-invalid', 'true');
    await expect(editor.getByLabel('Issued')).toBeFocused();
    await expect(editor.getByText('The issue date is after the expiry date')).toBeVisible();
  });

  test('an opening time that cannot be read is named as typed', async ({ page }) => {
    await openFirst(page, '/customers/sites');
    const from = page.getByLabel('Monday, from').first();
    await from.fill('25:00');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Monday: 25:00 is not a valid time')).toBeVisible();
    await expect(from).toHaveAttribute('aria-invalid', 'true');
    await expect(from).toBeFocused();
  });

  test('editing a document brings its form into view, titled after the action', async ({
    page,
  }) => {
    await openFirst(page, '/resources/drivers');
    await page
      .getByRole('button', { name: /^Edit / })
      .first()
      .click();
    const editor = page.getByRole('form', { name: /^Editing: / });
    await expect(editor).toBeInViewport();
    await expect(editor.getByLabel('Reference')).toBeFocused();
  });
});

test.describe('leaving a changed form', () => {
  test('asks before leaving, in the language of the product', async ({ page }) => {
    await open(page, '/resources/power-units/new');
    await page.getByLabel('Make and model').fill('Volvo test');
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Power units' })
      .click();
    const dialog = page.getByRole('alertdialog', { name: 'Leave without saving?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay on the page' }).click();
    await expect(page).toHaveURL(/\/resources\/power-units\/new$/);
    await expect(page.getByLabel('Make and model')).toHaveValue('Volvo test');
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Power units' })
      .click();
    await dialog.getByRole('button', { name: 'Leave without saving' }).click();
    await expect(page).toHaveURL(/\/resources\/power-units$/);
  });

  test('asks the browser before unloading a changed form, not an unchanged one', async ({
    page,
  }) => {
    await openFirst(page, '/customers');
    const asked: string[] = [];
    page.on('dialog', async (dialog) => {
      asked.push(dialog.type());
      await dialog.dismiss();
    });
    await page.getByLabel('City').first().fill('Ailleurs');
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => asked).toEqual(['beforeunload']);
  });

  test('does not ask once the changes are saved', async ({ page }) => {
    await openFirst(page, '/customers');
    await page.getByLabel('City').first().fill('Ailleurs');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Ailleurs · France')).toBeVisible();
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first().click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/customers$/);
  });
});

import { expect, type Page, test } from '@playwright/test';

// What the screens say: an unknown address, an empty search, a status, the rules of an import
// and its errors, each in words that fit what is on the screen.

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

const csv = (name: string, lines: string[]) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(lines.join('\n')),
});

/** Today in Paris, as the demo counts days. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

test('an unknown address shows a page not found, with a way back', async ({ page }) => {
  await open(page, '/sites');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to the resources' }).click();
  await expect(page).toHaveURL(/\/resources\/drivers$/);
});

test('an empty search names what is searched', async ({ page }) => {
  await open(page, '/customers');
  await page.getByRole('searchbox').fill('zzz');
  await expect(page.getByText('No customer matches.')).toBeVisible();
  await page.goto('/customers/sites');
  await page.getByRole('searchbox').fill('zzz');
  await expect(page.getByText('No site matches.')).toBeVisible();
});

test('a document expiring today has the status "Expiring"', async ({ page }) => {
  await open(page, '/resources/drivers/new');
  await page.getByLabel('Last name').fill('Today');
  await page.getByLabel('First name').fill('Test');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/resources\/drivers\/[0-9a-f-]{36}$/);
  const editor = page.getByRole('form', { name: 'Adding a document' });
  await editor.getByLabel('Type').selectOption({ index: 1 });
  await editor.getByLabel('Expires').fill(today());
  await editor.getByRole('button', { name: 'Add' }).click();
  const row = page.locator('.resource-documents tbody tr').first();
  await expect(row.locator('.t-badge')).toHaveText('Expiring');
  await expect(row).toContainText('today');
});

test('the notes of a customer have one label, marked optional', async ({ page }) => {
  await open(page, '/customers');
  await page.locator('main table tbody .row-link').first().click();
  await expect(page.getByRole('textbox', { name: 'Notes (optional)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notes (optional)' })).toBeVisible();
  // The heading names the field: no second "Notes" shows above it.
  await expect(page.locator('main label', { hasText: 'Notes' })).toHaveClass('t-visually-hidden');
});

test('the driver import shows the rules of drivers only', async ({ page }) => {
  await open(page, '/resources/drivers/import');
  await expect(page.getByText('All or nothing: one invalid line, nothing imported')).toBeVisible();
  await expect(page.getByText(/Plates compared/)).toHaveCount(0);
  await expect(page.getByText(/Kind and category/)).toHaveCount(0);
  await expect(page.getByText(/kilograms/)).toHaveCount(0);
  await page.goto('/resources/power-units/import');
  await expect(page.getByText(/Plates compared/)).toBeVisible();
});

test('a file in one column points to the separator', async ({ page }) => {
  await open(page, '/resources/drivers/import');
  await page.getByLabel('CSV file').setInputFiles(csv('drivers.csv', ['nom|prenom', 'Pipe|Paul']));
  await expect(page.getByText(/single column: are its columns separated by a semicolon, a comma or a tab/)).toBeVisible();
});

test('unreadable hours recall how hours are written, in the same case as the table', async ({
  page,
  context,
}) => {
  await context.route('https://data.geopf.fr/**', (route) => route.abort());
  await open(page, '/customers/sites/import');
  await page
    .getByLabel('CSV file')
    .setInputFiles(
      csv('sites.csv', [
        'name;street;postcode;city;monday',
        'Site A;1 rue de Lyon;69800;Saint-Priest;25:00-26:00',
      ]),
    );
  const listed = page.getByText(/^line 2: Monday:/);
  await expect(listed).toContainText('06:00-12:00/14:00-18:00');
  const issue = (await listed.textContent())?.replace(/^line 2: /, '') ?? '';
  await expect(page.locator('td .check-issue')).toHaveText(`✕ ${issue}`);
});

test('a customer with no city shows a dash, as other empty cells do', async ({ page }) => {
  await open(page, '/customers/new');
  await page.getByLabel('Legal name').fill('Sans ville');
  await page.getByLabel('Code', { exact: true }).fill('SANS-VILLE');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  await page.goto('/customers?q=SANS-VILLE');
  const row = page.getByRole('row', { name: /SANS-VILLE/ });
  await expect(row.getByRole('cell').nth(1)).toHaveText('—');
});

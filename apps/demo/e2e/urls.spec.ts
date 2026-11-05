import { expect, type Page, test } from '@playwright/test';

// What a list shows is in its address: a filter survives a reload and the back button, as the date
// of the units screen does. Moving that date by a day counts every click.

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

const lists = [
  { path: '/resources/drivers', chip: 'Expiring', search: 'status=expiring' },
  { path: '/resources/units', chip: 'Expired or missing document', search: 'filter=documents' },
  { path: '/customers', chip: 'France', search: 'country=france' },
  { path: '/customers/sites', chip: 'Not located', search: 'filter=not-located' },
];

for (const list of lists) {
  test(`${list.path}: a filter is kept in the address`, async ({ page }) => {
    await open(page, list.path);
    const chip = page.getByRole('button', { name: new RegExp(`^${list.chip}`) });
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`[?&]${list.search}`));
    await page.reload();
    await expect(page.getByRole('button', { name: new RegExp(`^${list.chip}`) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(list.search));
    await expect(page.getByRole('button', { name: /^All/ }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
}

test('the expiries keep their kind and "blocking only" in the address', async ({ page }) => {
  await open(page, '/resources/expiries');
  await page.getByRole('button', { name: /^Drivers/ }).click();
  await page.getByLabel('Blocking only').check();
  await expect(page).toHaveURL(/kind=driver/);
  await expect(page).toHaveURL(/blocking=true/);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Drivers/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Blocking only')).toBeChecked();
});

test('the search and "show archived" are kept in the address', async ({ page }) => {
  await open(page, '/resources/drivers');
  await page.getByPlaceholder(/name/i).fill('benali');
  await page.getByLabel('Show archived').check();
  await expect(page).toHaveURL(/q=benali/);
  await expect(page).toHaveURL(/archived=true/);
  await page.reload();
  await expect(page.getByPlaceholder(/name/i)).toHaveValue('benali');
  await expect(page.getByLabel('Show archived')).toBeChecked();
});

test('three quick clicks on the next day move three days', async ({ page }) => {
  await open(page, '/resources/units?at=2026-11-06T19%3A59');
  const at = page.getByLabel('Date and time shown');
  await expect(at).toHaveValue('2026-11-06T19:59');
  await page.getByRole('button', { name: 'Next day' }).evaluate((button: HTMLButtonElement) => {
    for (let i = 0; i < 3; i += 1) button.click();
  });
  await expect(at).toHaveValue('2026-11-09T19:59');
  await expect(page).toHaveURL(/at=2026-11-09T19%3A59/);
});

import { expect, type Page, test } from '@playwright/test';

// SPEC-004, Import and Splitting an order, on the demo build (criteria 11 to 13 and 17). Dates
// are counted from today, as the demo seeds its orders.

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

/** The next working day after today, in Paris, as dd/mm/yyyy. */
function workday(after = 1): string {
  const day = new Date(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())}T12:00:00Z`,
  );
  let left = after;
  while (left > 0 || day.getUTCDay() === 0 || day.getUTCDay() === 6) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) left -= 1;
  }
  const [year, month, date] = day.toISOString().slice(0, 10).split('-');
  return `${date}/${month}/${year}`;
}

const corbas = 'Hub de Corbas — cross-dock';
const venissieux = 'Dépôt de Vénissieux';
const torino = 'Transalpina magazzino';
const chassieu = 'Bricolage Chassieu';

const header =
  'customer_code;customer_reference;pickup_site;pickup_date;pickup_from;pickup_to;' +
  'delivery_site;delivery_date;delivery_from;delivery_to;description;quantity;packaging;weight_kg';

/** A line of the file: a customer, a reference, a pickup and a delivery on one day. */
const line = (
  customer: string,
  reference: string,
  pickup: string,
  delivery: string,
  description: string,
  day = workday(),
) =>
  [
    customer,
    reference,
    pickup,
    day,
    '07:00',
    '08:00',
    delivery,
    day,
    '14:00',
    '16:00',
    description,
    '8',
    'pallet',
    '4200',
  ].join(';');

async function upload(page: Page, name: string, lines: string[]) {
  await page.locator('main input[type=file]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from([header, ...lines].join('\n')),
  });
}

test('criteria 11 and 12: two pickups and two deliveries imported to review, then split', async ({
  page,
}) => {
  await open(page, '/orders');
  await page.getByRole('link', { name: 'Import CSV' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Import orders' })).toBeVisible();

  const reference = `TR-E2E-${Date.now() % 100_000}`;
  await upload(page, 'transalpina-nov.csv', [
    line('TRANSALP-IT', reference, corbas, torino, 'Disques de frein'),
    line('TRANSALP-IT', reference, venissieux, chassieu, 'Boîtes de vitesses'),
  ]);
  const preview = page.getByRole('table', { name: /Orders of transalpina-nov\.csv/ });
  const row = preview.getByRole('row', { name: new RegExp(reference) });
  await expect(row).toContainText('2 pickups · 2 deliveries');
  await expect(row).toContainText('To review');
  await expect(row.getByRole('cell').nth(2)).toHaveText('2–3');
  await page.getByRole('button', { name: 'Import 1 order' }).click();

  await expect(page).toHaveURL(/\/orders\?/);
  await expect(page.getByRole('status')).toContainText('1 order imported, 1 to review');
  await page.getByRole('searchbox').fill(reference);
  await page
    .getByRole('row', { name: new RegExp(reference) })
    .getByRole('link', { name: /^CMD-/ })
    .click();
  await expect(page.locator('.t-page-title')).toContainText('To review');
  const number = (await page.locator('.t-page-title .t-plate').textContent()) ?? '';
  await expect(page.getByText('2 pickups and 2 deliveries')).toBeVisible();

  await page.getByRole('link', { name: 'Split' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Split ${number}` })).toBeVisible();
  await expect(page.getByText('imported from transalpina-nov.csv')).toBeVisible();
  const kept = page.getByRole('region', { name: `Stays in ${number}` });
  const moved = page.getByRole('region', { name: 'New order' });
  await expect(kept).toContainText('Wrong shape');
  const split = page.getByRole('button', { name: 'Split into two orders' });
  await expect(split).toBeDisabled();

  await kept.getByRole('button', { name: 'Move Boîtes de vitesses to the new order' }).click();
  await expect(kept).toContainText('Valid shape');
  await expect(moved).toContainText('Valid shape');
  await expect(moved).toContainText('One pickup, one delivery');
  // The new order takes the stops of its line: the pickup at Vénissieux, the delivery at Chassieu.
  await expect(moved.locator('.split-stops li')).toHaveText([
    /Pickup.*Vénissieux/,
    /Delivery.*Chassieu/,
  ]);
  await split.click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toHaveAccessibleName(`Split ${number} into two orders?`);
  await dialog.getByRole('button', { name: 'Split' }).click();

  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?split=[0-9a-f-]{36}$/);
  await expect(page.locator('.t-page-title .t-plate')).toHaveText(number);
  await expect(page.locator('.t-page-title')).toContainText('To plan');
  const banner = page.getByRole('status').filter({ hasText: 'Split' });
  await expect(banner).toContainText(/Split: the new order is CMD-\d{4}-\d{6}/);
  const other = (await banner.getByRole('link').textContent()) ?? '';

  await page.getByRole('link', { name: /^History/ }).click();
  await expect(page.locator('.history-entry').first()).toContainText(
    `Split: line 2 moved to ${other}`,
  );
  await page.getByRole('link', { name: other }).first().click();
  await expect(page.locator('.t-page-title .t-plate')).toHaveText(other);
  await page.getByRole('link', { name: /^History/ }).click();
  await expect(page.locator('.history-entry').first()).toContainText(`Split from ${number}`);
});

test('criterion 13: an unknown site on line 7 is listed and nothing can be imported', async ({
  page,
}) => {
  await open(page, '/orders/import');
  const lines = Array.from({ length: 6 }, (_, i) =>
    line(
      'PHARMALP',
      `PH-E2E-${Math.floor(i / 2)}`,
      i === 5 ? 'Pharmalp, quai froid' : corbas,
      chassieu,
      `Ligne ${i + 2}`,
    ),
  );
  await upload(page, 'pharmalp-week-46.csv', lines);
  await expect(
    page.getByText('line 7: pickup site: unknown value “Pharmalp, quai froid”'),
  ).toBeVisible();
  await expect(
    page.getByText('Nothing is imported until the file is free of errors'),
  ).toBeVisible();
  const preview = page.getByRole('table', { name: /Orders of pharmalp-week-46\.csv/ });
  await expect(preview.getByRole('row', { name: /PH-E2E-2/ })).toContainText('1 error');
  await expect(page.getByRole('button', { name: /^Import 3 orders/ })).toBeDisabled();
  await expect(page.getByRole('row', { name: /^packaging/ })).toContainText(
    'euro pallet / palette europe',
  );
});

test('criterion 17: the import and split screens in French', async ({ page }) => {
  await open(page, '/orders/import');
  await page.getByLabel('Language').selectOption('fr');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Importer des commandes' }),
  ).toBeVisible();
  await upload(page, 'commandes.csv', [
    line('TRANSALP-IT', 'TR-FR-1', corbas, torino, 'Disques de frein'),
    line('TRANSALP-IT', 'TR-FR-1', venissieux, chassieu, 'Filtres'),
  ]);
  await expect(page.getByRole('row', { name: /TR-FR-1/ })).toContainText(
    '2 chargements · 2 livraisons',
  );
  await expect(page.getByRole('row', { name: /TR-FR-1/ })).toContainText('À revoir');
  await expect(page.getByRole('button', { name: 'Importer 1 commande' })).toBeEnabled();

  await page.goto('/orders?status=to-review');
  await page
    .getByRole('row', { name: /Transalpina/ })
    .getByRole('link')
    .first()
    .click();
  await page.getByRole('link', { name: 'Scinder' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Scinder CMD-/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scinder en deux commandes' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Nouvelle commande' })).toBeVisible();
  await expect(page.getByText('Forme incorrecte').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Déplacer .* vers la nouvelle commande$/ }).first(),
  ).toBeVisible();
});

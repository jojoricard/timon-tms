import { expect, type Locator, type Page, test } from '@playwright/test';

// SPEC-004 on the demo build: entering an order, the rules and warnings the form shows, cancelling,
// the history and duplication, in English and in French. The demo seeds its orders from today, so
// dates are counted from today too.

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

/** The next working day after today, in Paris, as the date input takes it. */
function workday(after = 1): string {
  const day = new Date(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())}T12:00:00Z`,
  );
  let left = after;
  while (left > 0 || day.getUTCDay() === 0 || day.getUTCDay() === 6) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) left -= 1;
  }
  return day.toISOString().slice(0, 10);
}

const corbas = 'Hub de Corbas — cross-dock';
const chassieu = 'Bricolage Chassieu';
const venissieux = 'Dépôt de Vénissieux';
const meyzieu = 'Entrepôt pharma Meyzieu';
const dockC = 'Plateforme Saint-Priest — quai C';

async function setStop(stop: Locator, site: string, date: string, from: string, to: string) {
  await stop.getByLabel('Site').selectOption({ label: site });
  await stop.getByLabel('Date').fill(date);
  await stop.getByLabel('From', { exact: true }).fill(from);
  await stop.getByLabel('To', { exact: true }).fill(to);
  const booking = stop.getByLabel('Booking made');
  if ((await booking.count()) > 0) await booking.check();
}

async function setLine(line: Locator, description: string, quantity: string, kg: string) {
  await line.getByLabel(/Description$/).fill(description);
  await line.getByLabel('Quantity').fill(quantity);
  await line.getByLabel('Gross weight (kg)').fill(kg);
}

/** A new order of the dairy: a pickup at Corbas from 08:00 to 10:00, one delivery given. */
async function newOrder(page: Page, day: string, [site, from, to]: [string, string, string]) {
  await open(page, '/orders/new');
  await page
    .getByLabel('Customer', { exact: true })
    .selectOption({ label: 'Laiterie des Monts du Lyonnais (MONTS-LAIT)' });
  await setStop(page.getByRole('group', { name: 'Pickup 1' }), corbas, day, '08:00', '10:00');
  await setStop(page.getByRole('group', { name: 'Delivery 1' }), site, day, from, to);
  await setLine(page.getByRole('group', { name: 'Line 1' }), 'Yaourts nature', '10', '5000');
}

async function create(page: Page) {
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.locator('.t-page-title .t-plate')).toHaveText(/^CMD-\d{4}-\d{6}$/);
  return (await page.locator('.t-page-title .t-plate').textContent()) ?? '';
}

test('criterion 1: one pickup and two deliveries get the next number, to plan', async ({
  page,
}) => {
  const day = workday();
  await newOrder(page, day, [chassieu, '10:00', '11:00']);
  await page.getByRole('button', { name: 'Add a delivery' }).click();
  await setStop(page.getByRole('group', { name: 'Delivery 2' }), venissieux, day, '14:00', '15:00');
  await page.getByRole('button', { name: 'Add a line' }).click();
  const second = page.getByRole('group', { name: 'Line 2' });
  await setLine(second, 'Fromages blancs', '4', '2000');
  await second.getByLabel('Delivery').selectOption({ label: venissieux });
  // Each line names its delivery once there are two.
  await page
    .getByRole('group', { name: 'Line 1' })
    .getByLabel('Delivery')
    .selectOption({ label: chassieu });

  await create(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Laiterie des Monts du Lyonnais',
  );
  await expect(page.locator('.t-page-title .t-badge').first()).toHaveText('To plan');
  await expect(page.getByRole('group', { name: 'Delivery 2' }).getByLabel('Site')).toHaveValue(
    /.+/,
  );
});

test('criterion 2: a site not located cannot be saved, and the form says why', async ({ page }) => {
  await newOrder(page, workday(), [dockC, '12:00', '13:00']);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(
    page.getByText(`The site ${dockC} is not located: locate it in the address book first`),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/new$/);
  await expect(page.getByRole('group', { name: 'Delivery 1' }).getByLabel('Site')).toBeFocused();
});

test('criterion 3: a delivery before its pickup is refused', async ({ page }) => {
  await newOrder(page, workday(), [chassieu, '06:00', '07:30']);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(
    page.getByText(`The delivery ends before the pickup at ${corbas} starts, at 08:00`),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/new$/);
});

test('criterion 4: a slot at lunch in Meyzieu warns, and the order is saved', async ({ page }) => {
  await newOrder(page, workday(), [meyzieu, '12:15', '13:00']);
  const warnings = page.getByRole('region', { name: /^Warnings/ });
  await expect(warnings).toContainText(
    `Delivery at ${meyzieu}: the site is closed from 12:00 to 13:30`,
  );
  await expect(page.getByRole('group', { name: 'Delivery 1' })).toContainText(
    'Open 08:00–12:00 · 13:30–16:00',
  );
  await create(page);
  await expect(page.locator('.t-page-title')).toContainText('1 warning');
});

test('criteria 10, 14 and 16: change, history, cancel with a reason, duplicate', async ({
  page,
}) => {
  const day = workday();
  await newOrder(page, day, [meyzieu, '09:00', '10:00']);
  const number = await create(page);

  // Criterion 14: a slot changed shows in the history, old and new.
  const delivery = page.getByRole('group', { name: 'Delivery 1' });
  await delivery.getByLabel('From', { exact: true }).fill('14:00');
  await delivery.getByLabel('To', { exact: true }).fill('15:00');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('link', { name: /^History/ }).click();
  await expect(page).toHaveURL(/tab=history/);
  const [y, m, d] = day.split('-');
  await expect(page.locator('.history-entry').first()).toContainText(
    `Delivery at ${meyzieu}: slot ${d}/${m}/${y} 09:00–10:00 to ${d}/${m}/${y} 14:00–15:00.`,
  );
  await expect(page.locator('.history-entry').nth(1)).toContainText('Created by hand');

  // Criterion 10: a reason is asked; the order becomes cancelled, read only, out of the list.
  await page.getByRole('link', { name: 'Order', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByRole('alertdialog', { name: `Cancel ${number}?` });
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(dialog.getByText('Reason is required')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Annulée par le client au téléphone');
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.t-page-title .t-badge').first()).toHaveText('Cancelled');
  await expect(page.getByText('This order is cancelled (Annulée par le client')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByLabel('Customer', { exact: true })).toBeDisabled();

  await page.getByRole('link', { name: 'Orders', exact: true }).first().click();
  await expect(page.locator('main tbody .row-link').first()).toBeVisible();
  await expect(page.getByRole('link', { name: number })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancelled' }).click();
  await expect(page.getByRole('link', { name: number })).toBeVisible();

  // Criterion 16: duplicated, a new order to plan with the same customer, stops and goods.
  await page.getByRole('link', { name: number }).click();
  await page.getByRole('link', { name: 'Duplicate' }).click();
  await expect(page).toHaveURL(/\/orders\/new\?from=/);
  await expect(page.getByText(`Copy of ${number}: set the dates of the stops`)).toBeVisible();
  const pickup = page.getByRole('group', { name: 'Pickup 1' });
  const copied = page.getByRole('group', { name: 'Delivery 1' });
  await expect(pickup.getByLabel('Date')).toHaveValue('');
  await expect(copied.getByLabel('Date')).toHaveValue('');
  await expect(copied.getByLabel('From', { exact: true })).toHaveValue('14:00');
  await expect(page.getByRole('group', { name: 'Line 1' }).getByLabel(/Description$/)).toHaveValue(
    'Yaourts nature',
  );
  await pickup.getByLabel('Date').fill(workday(2));
  await copied.getByLabel('Date').fill(workday(2));
  const copy = await create(page);
  expect(copy).not.toBe(number);
  await expect(page.locator('.t-page-title .t-badge').first()).toHaveText('To plan');
  await page.getByRole('link', { name: /^History/ }).click();
  const created = page.locator('.history-entry').first();
  await expect(created).toContainText('Created by duplication');
  await expect(created).toContainText(`Copy of ${number}.`);
});

test('the list: grouped by day, filtered by status, searched by number', async ({ page }) => {
  await open(page, '/orders');
  await expect(page.locator('main tbody tr.group-row').first()).toContainText(/\d+ orders?$/);
  await page.getByRole('button', { name: /^To plan/ }).click();
  await expect(page).toHaveURL(/status=to-review/);
  const review = page.locator('main tbody tr:not(.group-row)');
  await expect(review).toHaveCount(2);
  await expect(review.first()).toContainText('To review');
  await page.getByRole('button', { name: /^To plan/ }).click();
  await expect(page).not.toHaveURL(/status=/);

  await page.getByRole('searchbox').fill('zzz');
  await expect(page.getByText('No order matches.')).toBeVisible();
  await expect(page).toHaveURL(/q=zzz/);
});

test.describe('in French', () => {
  test.use({ locale: 'fr-FR' });

  test('criterion 17: every label, status, warning and message of the order screens', async ({
    page,
  }) => {
    await open(page, '/orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Commandes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Commandes', exact: true }).first()).toBeVisible();
    const table = page.locator('main table');
    for (const title of ['Numéro', 'Client et référence', 'Premier chargement', 'Exigences']) {
      await expect(table.locator('thead')).toContainText(title);
    }
    await expect(table).toContainText('À planifier');
    await expect(table).toContainText('À revoir');
    await expect(table).toContainText("Hors heures d'ouverture");
    await expect(table).not.toContainText('To plan');

    await page.getByRole('link', { name: 'Nouvelle commande' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Nouvelle commande' })).toBeVisible();
    for (const label of ['Client', 'Référence client', 'Désignation', 'Poids brut (kg)']) {
      await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    }
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page.getByText('Client obligatoire')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Chargement 1' })).toBeVisible();
    await page
      .getByRole('group', { name: 'Livraison 1' })
      .getByLabel('Site')
      .selectOption({ label: meyzieu });
    await page.getByRole('group', { name: 'Livraison 1' }).getByLabel('Date').fill(workday());
    await page
      .getByRole('group', { name: 'Livraison 1' })
      .getByLabel('De', { exact: true })
      .fill('12:15');
    await page
      .getByRole('group', { name: 'Livraison 1' })
      .getByLabel('À', { exact: true })
      .fill('13:00');
    await expect(page.getByRole('region', { name: /^Alertes/ })).toContainText(
      'le site est fermé de 12:00 à 13:30',
    );
    await expect(page.getByRole('region', { name: /^Alertes/ })).toContainText(
      'le site demande un rendez-vous, pas encore pris',
    );

    await page.goto('/orders');
    await page.locator('main tbody .row-link').first().click();
    await expect(page.getByRole('button', { name: 'Annuler la commande' })).toBeVisible();
    await page.getByRole('link', { name: /^Historique/ }).click();
    await expect(page.getByText('Créée par le générateur de démonstration')).toBeVisible();
    await expect(page.getByText('Auteur non enregistré').first()).toBeVisible();
    await expect(page.getByText('Ce qui est enregistré')).toBeVisible();
  });
});

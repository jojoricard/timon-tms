import { expect, type Page, test } from '@playwright/test';

// SPEC-002 acceptance criteria that live in the interface, on the demo build. The IGN service
// and the map tiles are never reached: each test routes them.

test.beforeEach(async ({ context }) => {
  await context.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await context.route('https://data.geopf.fr/**', (route) => route.abort());
});

/** Opens a page once the in-browser API answers: its database starts with the first request. */
async function open(page: Page, path: string) {
  const ready = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith('/api/'), {
    timeout: 45_000,
  });
  await page.goto(path);
  expect((await ready).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test('the customers of the mockups are listed, in France and abroad', async ({ page }) => {
  await open(page, '/customers');
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(13);
  await expect(page.getByRole('row', { name: /Dupont Matériaux/ })).toContainText(
    '749 008 934 00012',
  );
  await page.getByRole('button', { name: /^Abroad/ }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole('table')).toContainText('Transalpina Ricambi');
});

test('criterion 1: a wrong check digit is refused, the right one proposes the VAT number', async ({
  page,
}) => {
  await open(page, '/customers/new');
  await page.getByLabel('Legal name').fill('Nouveau client');
  await page.getByLabel('Code', { exact: true }).fill('NOUVEAU');
  const siret = page.getByLabel(/^SIRET/);
  await siret.fill('404 833 048 00015');
  await expect(
    page.getByText('The SIRET check digit is wrong, or it does not have 14 digits'),
  ).toBeVisible();
  await siret.fill('404 833 048 00014');
  await expect(page.getByText('The SIRET check digit is wrong')).toHaveCount(0);
  await expect(page.getByLabel(/^VAT number/)).toHaveValue('FR83404833048');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nouveau client' })).toBeVisible();
});

test('criterion 4: a contact with a name only asks for a phone or an email', async ({ page }) => {
  await open(page, '/customers/new');
  await page.getByLabel('Legal name').fill('Sans contact');
  await page.getByLabel('Code', { exact: true }).fill('SANS-CONTACT');
  await page.getByRole('button', { name: 'Add a contact' }).click();
  await page
    .getByRole('group', { name: 'Contact 1' })
    .getByLabel('Name', { exact: true })
    .fill('Yanis Mercier');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'A contact needs a phone or an email.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'New customer' })).toBeVisible();
});

test('criterion 14: the equipment ticked on a driver shows in the form and the list', async ({
  page,
}) => {
  await open(page, '/resources/drivers');
  await page.getByRole('link', { name: 'Karim Benali' }).click();
  const equipment = page.getByRole('group', { name: 'Protective equipment' });
  await equipment.getByLabel('Safety shoes').check();
  await equipment.getByLabel('High-visibility vest').check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(equipment.getByLabel('Safety shoes')).toBeChecked();
  await expect(equipment.getByText('2 of 5 held')).toBeVisible();
  await page.getByRole('link', { name: 'Drivers' }).click();
  const row = page.getByRole('row', { name: /Karim Benali/ });
  await expect(row.getByRole('listitem')).toHaveText(['Shoes', 'Vest']);
});

test('criterion 15: in French, labels, statuses and opening hours are French', async ({ page }) => {
  await open(page, '/customers');
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Étranger/ })).toBeVisible();

  await page.getByRole('link', { name: /^Sites/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sites' })).toBeVisible();
  await expect(page.getByRole('row', { name: /quai C/ })).toContainText('Non localisé');
  await expect(page.getByRole('row', { name: /Hub de Corbas/ })).toContainText('Portail');

  await page.getByRole('link', { name: 'Plateforme Saint-Priest — quai B' }).click();
  await expect(page.getByRole('group', { name: 'Lundi' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Dimanche' })).toContainText('Fermé');
  await expect(page.getByText('Exigences')).toBeVisible();
});

test('a row opens its record from any cell; a button in the row keeps its own action', async ({
  page,
}) => {
  await open(page, '/customers');
  await page
    .getByRole('row', { name: /Dupont Matériaux/ })
    .getByText('749 008 934 00012')
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dupont Matériaux' })).toBeVisible();

  const usualSites = page.getByRole('region', { name: 'Usual sites' }).getByRole('row');
  await expect(usualSites).toHaveCount(5);
  await page.getByRole('button', { name: 'Remove Bricolage Chassieu' }).click();
  await expect(usualSites).toHaveCount(4);
  await expect(page.getByRole('heading', { level: 1, name: 'Dupont Matériaux' })).toBeVisible();

  await open(page, '/resources/expiries');
  await page
    .getByRole('row', { name: /T\. Girard/ })
    .getByRole('cell', { name: 'Blocking', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Thomas Girard' })).toBeVisible();
});

import { expect, type Page, test } from '@playwright/test';

// SPEC-001 acceptance criteria that live in the interface, on the demo build. Each test gets
// a fresh browser context, hence a fresh demo haulier.

/** Opens a page once the in-browser API answers: its database starts with the first request. */
async function open(page: Page, path: string) {
  const ready = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/reference-lists', {
    timeout: 45_000,
  });
  await page.goto(path);
  expect((await ready).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

const csv = (lines: string[]) => ({
  name: 'import.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(lines.join('\n')),
});

test('criterion 4: a lapsed health check is expired in the warning colour, not blocking', async ({
  page,
}) => {
  await open(page, '/resources/drivers');
  const badge = page.getByRole('row', { name: /Karim Benali/ }).getByText('Expired · not blocking');
  await expect(badge).toHaveAttribute('data-tone', 'warning');
});

test('criterion 5: a plate already active is refused, naming the resource that has it', async ({
  page,
}) => {
  await open(page, '/resources/power-units/new');
  await page.getByLabel('Registration plate').fill('ab 123 cd');
  await page
    .getByRole('group', { name: 'Regulatory category' })
    .getByRole('radio', { name: 'N3' })
    .check();
  await page.getByLabel('Gross vehicle weight (kg)').fill('19000');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(
    page.getByText('This plate is already used by AB-123-CD, an active tractor.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open AB-123-CD' })).toBeVisible();
});

test('criterion 6: a light van in N3 is refused, with the allowed category', async ({ page }) => {
  await open(page, '/resources/power-units/new');
  await page.getByRole('group', { name: 'Kind' }).getByRole('radio', { name: 'Light van' }).check();
  await page
    .getByRole('group', { name: 'Regulatory category' })
    .getByRole('radio', { name: 'N3' })
    .check();
  await expect(page.getByText('A light van is N1, not N3')).toBeVisible();
});

test('criterion 14: the category agrees with the gross vehicle weight', async ({ page }) => {
  await open(page, '/resources/power-units/new');
  await page
    .getByRole('group', { name: 'Regulatory category' })
    .getByRole('radio', { name: 'N3' })
    .check();
  await page.getByLabel('Gross vehicle weight (kg)').fill('7500');
  await expect(
    page.getByText('N3 is over 12,000 kg, and this vehicle weighs 7,500 kg'),
  ).toBeVisible();

  await open(page, '/resources/trailers/new');
  await page.getByLabel('Gross vehicle weight (kg)').fill('34000');
  await page
    .getByRole('group', { name: 'Regulatory category' })
    .getByRole('radio', { name: 'O3' })
    .check();
  await expect(page.getByText(/^O3 is over 3,500 kg and up to 10,000 kg/)).toBeVisible();
});

/** The last names of the drivers, in the order of the list. */
async function lastNames(page: Page) {
  const names = await page
    .getByRole('table')
    .getByRole('rowheader')
    .getByRole('link')
    .allInnerTexts();
  return names.map((name) => name.split(' ').slice(1).join(' '));
}
const sorted = (names: string[]) =>
  [...names].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

test('criterion 16: a renamed driver takes the display name and the place of the new names', async ({
  page,
}) => {
  await open(page, '/resources/drivers/new');
  await page.getByLabel('Last name').fill("D'Artagnan");
  await page.getByLabel('First name').fill('Xavier');
  await expect(page.getByLabel(/^Display name/)).toHaveAttribute('placeholder', "X. D'Artagnan");
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText("X. D'Artagnan");

  await page.getByLabel('Last name').fill('Zola');
  await page.getByLabel('First name').fill('Émile');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('É. Zola');
  await expect(page.getByLabel(/^Display name/)).toHaveValue('');

  await open(page, '/resources/drivers');
  await expect(page.getByRole('row', { name: /Émile Zola/ })).toContainText('É. Zola');
  const names = await lastNames(page);
  expect(names).toEqual(sorted(names));
  expect(names.at(-1)).toBe('Zola');
});

test('criterion 17: an employee number already used is refused, naming the driver', async ({
  page,
}) => {
  await open(page, '/resources/drivers/new');
  await page.getByLabel('Last name').fill('Nouveau');
  await page.getByLabel('First name').fill('Paul');
  await page.getByLabel(/^Employee number/).fill('e-1001');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('This employee number is already used by K. Benali.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open K. Benali' })).toBeVisible();
});

test('criterion 18: the phone "abc" is refused, French and foreign numbers are accepted', async ({
  page,
}) => {
  await open(page, '/resources/drivers/new');
  const phone = page.getByLabel(/^Phone/);
  await page.getByLabel('Last name').fill('Tel');
  await page.getByLabel('First name').fill('Test');
  await phone.fill('abc');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Phone: not a phone number (eight digits at least)')).toBeVisible();
  for (const number of ['06 12 34 56 78', '+49 30 1234567']) {
    await phone.fill(number);
    await expect(page.getByText(/not a phone number/)).toHaveCount(0);
  }
});

test('the import screen lists the accepted values of each column and the formats', async ({
  page,
}) => {
  await open(page, '/resources/power-units/import');
  const guide = page.getByRole('region', { name: 'Columns and accepted values' });
  await expect(guide.getByRole('row', { name: /^kind/ })).toContainText(
    'One of: tractor / tracteur · rigid truck / rigid / porteur',
  );
  await expect(guide.getByRole('row', { name: /^category/ })).toContainText('N1 · N2 · N3');
  await expect(guide.getByRole('row', { name: /^roadworthiness/ })).toContainText(
    'dd/mm/yyyy or yyyy-mm-dd',
  );
  await expect(page.getByText('Columns separated by a semicolon, a comma or a tab')).toBeVisible();

  await page.getByLabel('Language').selectOption('fr');
  await open(page, '/resources/drivers/import');
  const colonnes = page.getByRole('region', { name: 'Colonnes et valeurs acceptées' });
  await expect(colonnes.getByRole('row', { name: /^epi/ })).toContainText(
    'safety shoes / shoes / chaussures de securite / chaussures',
  );
  const lines = ['nom	prenom	epi	permis_ce', 'Zola	Émile	gilet|casque	2030-03-15'];
  await page.getByLabel(/Fichier CSV/).setInputFiles(csv(lines));
  await expect(page.getByRole('button', { name: /Tout importer/ })).toBeEnabled();
});

test('criterion 7: a tractor offers no body type', async ({ page }) => {
  await open(page, '/resources/power-units/new');
  await expect(
    page.getByRole('group', { name: 'Kind' }).getByRole('radio', { name: 'Tractor' }),
  ).toBeChecked();
  await expect(page.getByLabel('Body type')).toBeDisabled();
  await page
    .getByRole('group', { name: 'Kind' })
    .getByRole('radio', { name: 'Rigid truck' })
    .check();
  await expect(page.getByLabel('Body type')).toBeEnabled();
});

test('criterion 9: one driver without a last name, nothing imported', async ({ page }) => {
  await open(page, '/resources/drivers/import');
  const lines = ['last_name;first_name;licence_ce'];
  for (let line = 2; line <= 41; line += 1) {
    lines.push(line === 17 ? ';Paul;15/03/2030' : `Driver${line};Paul;15/03/2030`);
  }
  await page.getByLabel('CSV file').setInputFiles(csv(lines));
  await expect(page.getByText('line 17: last name is required')).toBeVisible();
  await expect(page.getByRole('button', { name: /Import every line/ })).toBeDisabled();
  await open(page, '/resources/drivers');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(19);
});

test('criterion 10: forty valid trailers are imported and listed', async ({ page }) => {
  await open(page, '/resources/trailers/import');
  const lines = ['plate;kind;category;gvw_kg;body_type;roadworthiness'];
  for (let i = 0; i < 40; i += 1)
    lines.push(`TR-${100 + i};semi-trailer;O4;35000;curtainsider;15/04/2027`);
  await page.getByLabel('CSV file').setInputFiles(csv(lines));
  await expect(page.getByText('Every line is valid.')).toBeVisible();
  await page.getByRole('button', { name: 'Import every line (40)' }).click();
  await expect(page.getByText('Imported: 40.')).toBeVisible();
  await page.getByRole('searchbox').fill('TR-');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(41);
});

test('criterion 11: an archived driver is hidden, shown on request and restored', async ({
  page,
}) => {
  await open(page, '/resources/drivers');
  await page.getByRole('link', { name: 'Camille Dupuis' }).click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('This resource is archived')).toBeVisible();

  await page.getByRole('link', { name: 'Drivers' }).click();
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(18);
  await expect(table).not.toContainText('Camille Dupuis');

  await page.getByLabel('Show archived').check();
  await table.getByRole('button', { name: 'Restore C. Dupuis' }).click();
  await page.getByLabel('Show archived').uncheck();
  await expect(table.getByRole('row', { name: /Camille Dupuis/ })).toBeVisible();
});

test('criterion 13: in French, labels, statuses and errors are French', async ({ page }) => {
  await open(page, '/resources/drivers');
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.getByRole('heading', { level: 1, name: 'Moyens' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Thomas Girard/ })).toContainText('Expiré · bloquant');
  await expect(page.getByRole('row', { name: /Lucie Fabre/ })).toContainText('À renouveler');

  await page.getByRole('link', { name: /Échéances/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Échéances' })).toBeVisible();
  await expect(page.getByText('Contrôle du chronotachygraphe')).toBeVisible();

  await open(page, '/resources/power-units/new');
  await page
    .getByRole('group', { name: 'Type' })
    .getByRole('radio', { name: 'Utilitaire léger' })
    .check();
  await page
    .getByRole('group', { name: 'Catégorie réglementaire' })
    .getByRole('radio', { name: 'N3' })
    .check();
  await expect(page.getByText('Type utilitaire léger : N1, pas N3')).toBeVisible();

  await open(page, '/resources/drivers/import');
  await page.getByLabel('Fichier CSV').setInputFiles(csv(['nom;prenom', ';Paul']));
  await expect(page.getByText('ligne 2 : nom obligatoire')).toBeVisible();
});

test('tabs and filters work from the keyboard', async ({ page }) => {
  await open(page, '/resources/drivers');
  const expired = page.getByRole('button', { name: /^Expired/ });
  await expired.focus();
  await page.keyboard.press('Space');
  await expect(expired).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(3);

  await page.getByRole('link', { name: /Trailers/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/resources\/trailers$/);
  await expect(page.getByRole('link', { name: /Trailers/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

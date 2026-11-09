import { expect, type Locator, type Page, test } from '@playwright/test';

// Actions that are hard to undo ask first, in one shared dialog: archiving a resource, a
// customer or a site, deleting a document, deleting a unit that has not started (SPEC-001
// rule 11, SPEC-002 rule 6, SPEC-003 rule 6). Each test gets a fresh demo haulier.

test.beforeEach(async ({ context }) => {
  await context.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await context.route('https://data.geopf.fr/**', (route) => route.abort());
});

/** Opens a page once the in-browser API has answered `api`: its database starts then. */
async function open(page: Page, path: string, api = '/api/reference-lists') {
  const ready = page.waitForResponse((r) => new URL(r.url()).pathname === api, {
    timeout: 45_000,
  });
  await page.goto(path);
  expect((await ready).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** The confirmation open on the page. */
const confirmation = (page: Page) => page.getByRole('alertdialog');

/** Tab and Shift+Tab go round the dialog's buttons and never leave it. */
async function expectFocusTrapped(page: Page, dialog: Locator) {
  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
}

test('archiving a resource asks first, in French; Escape keeps it, the focus stays inside', async ({
  page,
}) => {
  await open(page, '/resources/drivers');
  await page.getByLabel('Language').selectOption('fr');
  await page.getByRole('link', { name: 'Camille Dupuis' }).click();
  await page.getByRole('button', { name: 'Archiver' }).click();

  const dialog = confirmation(page);
  await expect(dialog).toHaveAccessibleName('Archiver C. Dupuis ?');
  await expect(dialog).toContainText("Il n'est jamais supprimé");
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await expectFocusTrapped(page, dialog);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Archiver' })).toBeVisible();

  await page.getByRole('button', { name: 'Archiver' }).click();
  await confirmation(page).getByRole('button', { name: 'Archiver' }).click();
  await expect(page.getByRole('button', { name: 'Restaurer' })).toBeVisible();
});

test('SPEC-001 criterion 15: an archived driver cannot be changed until restored', async ({
  page,
}) => {
  // Camille Dupuis belongs to no unit: she can be archived.
  await open(page, '/resources/drivers');
  await page.getByRole('link', { name: 'Camille Dupuis' }).click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await confirmation(page).getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();

  await expect(page.getByLabel('Last name')).toBeDisabled();
  await expect(page.getByLabel(/^Phone/)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  const documents = page.getByRole('region', { name: 'Documents' });
  await expect(documents.getByRole('row')).not.toHaveCount(1);
  await expect(documents.getByRole('button', { name: /^(Edit|Remove)/ })).toHaveCount(0);
  await expect(documents.getByRole('button', { name: 'Add' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByLabel('Last name')).toBeEnabled();
  await expect(documents.getByRole('button', { name: /^Remove/ }).first()).toBeVisible();
});

test('deleting a document asks first, and Cancel keeps it', async ({ page }) => {
  await open(page, '/resources/drivers');
  await page.getByRole('link', { name: 'Karim Benali' }).click();
  const documents = page.getByRole('region', { name: 'Documents' });
  const rows = documents.getByRole('row');
  const remove = documents.getByRole('button', { name: /^Remove/ }).first();
  const label = (await remove.getAttribute('aria-label'))?.replace(/^Remove /, '') ?? '';
  const before = await rows.count();

  await remove.click();
  const dialog = confirmation(page);
  await expect(dialog).toHaveAccessibleName(`Remove ${label}?`);
  await expect(dialog).toContainText('This cannot be undone.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(rows).toHaveCount(before);

  await remove.click();
  await confirmation(page).getByRole('button', { name: 'Remove' }).click();
  await expect(rows).toHaveCount(before - 1);
});

test('archiving a customer and a site asks first', async ({ page }) => {
  // A customer with no order is archived once confirmed.
  await open(page, '/customers/new', '/api/reference-lists');
  await page.getByLabel('Legal name').fill('Client sans commande');
  await page.getByLabel('Code', { exact: true }).fill('SANS-CMD');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Client sans commande' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(confirmation(page)).toHaveAccessibleName(/^Archive Client sans commande/);
  await confirmation(page).getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await expect(page.getByText('This customer is archived')).toBeVisible();

  await open(page, '/customers', '/api/customers');
  await page
    .getByRole('link', { name: /Dupont Matériaux/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(confirmation(page)).toHaveAccessibleName(/^Archive Dupont Matériaux/);
  await expect(confirmation(page)).toContainText('Its usual sites stay active.');
  await confirmation(page).getByRole('button', { name: 'Archive' }).click();
  // SPEC-004 rule 8: every demo customer has orders to plan, so the archiving is refused and the
  // orders are named.
  await expect(page.getByRole('alert')).toContainText(
    /^Used by the orders CMD-\d{4}-\d{6}(, CMD-\d{4}-\d{6})*, to plan or to review: cancel or change them first\.$/,
  );
  await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();

  await open(page, '/customers/sites', '/api/sites');
  await page.locator('main table tbody .row-link').first().click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(confirmation(page)).toContainText('It is never deleted and can be restored.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
});

test('deleting a unit that has not started asks first', async ({ page }) => {
  const start = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
  await open(page, `/resources/units/new?start=${start}T06:00`, '/api/units/options');
  await page.getByRole('radio', { name: /AB-123-CD/ }).check();
  await page.getByRole('radio', { name: /Marc Laurent/ }).check();
  await page.getByRole('button', { name: 'Save unit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Units' })).toBeVisible();

  await open(page, `/resources/units?at=${start}T08:00`, '/api/units');
  await page.getByRole('link', { name: 'M. Laurent' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = confirmation(page);
  await expect(dialog).toHaveAccessibleName('Delete M. Laurent?');
  await expect(dialog).toContainText('This unit has not started yet.');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Units' })).toBeVisible();
});

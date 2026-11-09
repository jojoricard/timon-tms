import { expect, type Page, test } from '@playwright/test';

// ADR-005: a save made from a version another page has since changed is refused. One dialog
// says so, in the product's language, and offers to reload the record or to stay on the page.
// Both pages share one browser context, hence one service worker and one demo database.

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

const staleDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Record changed' });

test('T-006: the second save is refused; Stay keeps the input, Reload shows the first save', async ({
  page: a,
  context,
}) => {
  await open(a, '/resources/drivers');
  await a.getByRole('link', { name: 'Camille Dupuis' }).click();
  await expect(a.getByLabel(/^Phone/)).toBeEditable();
  const employeeNumber = await a.getByLabel(/^Employee number/).inputValue();

  const b = await context.newPage();
  await open(b, new URL(a.url()).pathname);
  await b.getByLabel(/^Phone/).fill('06 11 22 33 44');
  await b.getByRole('button', { name: 'Save changes' }).click();
  await expect(b.getByText('Saved.')).toBeVisible();

  await a.getByLabel(/^Employee number/).fill('GP-118');
  await a.getByRole('button', { name: 'Save changes' }).click();
  const dialog = staleDialog(a);
  await expect(dialog).toContainText(
    'This record was changed after you opened it. Reload it to see the current version; your unsaved changes will be lost.',
  );
  // The dialog is the only answer: no message on the form as well.
  await expect(a.getByText('Saved.')).toHaveCount(0);
  await expect(a.getByRole('alert')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Stay on this page' }).click();
  await expect(dialog).toBeHidden();
  await expect(a.getByLabel(/^Employee number/)).toHaveValue('GP-118');

  await a.getByRole('button', { name: 'Save changes' }).click();
  await staleDialog(a).getByRole('button', { name: 'Reload' }).click();
  await expect(staleDialog(a)).toBeHidden();
  await expect(a.getByRole('alertdialog')).toHaveCount(0);
  await expect(a.getByLabel(/^Phone/)).toHaveValue('06 11 22 33 44');
  await expect(a.getByLabel(/^Employee number/)).toHaveValue(employeeNumber);

  // The reloaded form saves from the current version.
  await a.getByLabel(/^Employee number/).fill('GP-118');
  await a.getByRole('button', { name: 'Save changes' }).click();
  await expect(a.getByText('Saved.')).toBeVisible();
});

test('saving twice from the same form starts each save from the version the last one left', async ({
  page,
}) => {
  await open(page, '/resources/drivers');
  await page.getByRole('link', { name: 'Camille Dupuis' }).click();
  await page.getByLabel(/^Phone/).fill('06 11 22 33 44');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByLabel(/^Phone/).fill('06 55 66 77 88');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(staleDialog(page)).toHaveCount(0);
});

test('in French, the dialog and its buttons are French', async ({ page: a, context }) => {
  await open(a, '/resources/drivers');
  await a.getByLabel('Language').selectOption('fr');
  await a.getByRole('link', { name: 'Camille Dupuis' }).click();
  await expect(a.getByLabel(/^Téléphone/)).toBeEditable();

  const b = await context.newPage();
  await open(b, new URL(a.url()).pathname);
  // The language is kept per browser: the second page may open in either.
  await b.getByLabel(/^(Phone|Téléphone)/).fill('06 11 22 33 44');
  const saved = b.waitForResponse((r) => r.request().method() === 'PUT');
  await b.getByRole('button', { name: /^(Save changes|Enregistrer)/ }).click();
  expect((await saved).status()).toBe(200);

  await a.getByLabel(/^Téléphone/).fill('04 00 00 00 00');
  await a.getByRole('button', { name: /^Enregistrer/ }).click();
  const dialog = a.getByRole('alertdialog', { name: 'Fiche modifiée' });
  await expect(dialog).toContainText('Cette fiche a été modifiée après son ouverture.');
  await expect(dialog.getByRole('button', { name: 'Recharger' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Rester sur cette page' })).toBeVisible();
});

test('a restore from the archived list, after the record changed elsewhere, asks to reload', async ({
  page: list,
  context,
}) => {
  // Camille Dupuis belongs to no unit: she can be archived.
  await open(list, '/resources/drivers');
  await list.getByRole('link', { name: 'Camille Dupuis' }).click();
  await list.getByRole('button', { name: 'Archive' }).click();
  await list.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(list.getByRole('button', { name: 'Restore' })).toBeVisible();
  const record = new URL(list.url()).pathname;

  await list.getByRole('link', { name: 'Drivers' }).click();
  await list.getByLabel('Show archived').check();
  const table = list.getByRole('table');
  await expect(table.getByRole('button', { name: 'Restore C. Dupuis' })).toBeVisible();

  // Another page restores her, then archives her again: the list still shows the old version.
  const other = await context.newPage();
  await open(other, record);
  await other.getByRole('button', { name: 'Restore' }).click();
  await other.getByRole('button', { name: 'Archive' }).click();
  await other.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(other.getByRole('button', { name: 'Restore' })).toBeVisible();

  await table.getByRole('button', { name: 'Restore C. Dupuis' }).click();
  const dialog = staleDialog(list);
  await expect(dialog).toBeVisible();
  await expect(list.locator('.t-field-error')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Reload' }).click();
  await expect(dialog).toBeHidden();
  // Reloaded, the list shows her archived at the current version, and the restore now applies.
  await table.getByRole('button', { name: 'Restore C. Dupuis' }).click();
  await expect(staleDialog(list)).toHaveCount(0);
  await list.getByLabel('Show archived').uncheck();
  await expect(table.getByRole('row', { name: /Camille Dupuis/ })).toBeVisible();
});

test('an order changed in another page refuses the save; cancelling from the old version too', async ({
  page: a,
  context,
}) => {
  await open(a, '/orders', '/api/orders');
  await a.locator('main tbody .row-link').first().click();
  await expect(a.getByLabel('Customer', { exact: true })).toBeEditable();

  const b = await context.newPage();
  await open(b, new URL(a.url()).pathname, '/api/reference-lists');
  await b.getByRole('textbox', { name: 'Notes' }).fill('Quai 4, appeler avant.');
  await b.getByRole('button', { name: 'Save changes' }).click();
  await expect(b.getByText('Saved.')).toBeVisible();

  await a.getByRole('textbox', { name: 'Notes' }).fill('Quai 2.');
  await a.getByRole('button', { name: 'Save changes' }).click();
  await expect(staleDialog(a)).toBeVisible();
  await staleDialog(a).getByRole('button', { name: 'Stay on this page' }).click();
  await expect(a.getByRole('textbox', { name: 'Notes' })).toHaveValue('Quai 2.');

  // The one-click cancelling names the version too.
  await a.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = a.getByRole('alertdialog', { name: /^Cancel CMD-/ });
  await dialog.getByLabel('Reason').fill('Doublon');
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(staleDialog(a)).toBeVisible();
  await staleDialog(a).getByRole('button', { name: 'Reload' }).click();
  await expect(a.getByRole('textbox', { name: 'Notes' })).toHaveValue('Quai 4, appeler avant.');
  await expect(a.locator('.t-page-title .t-badge').first()).toHaveText('To plan');
});

import { expect, type Page, test } from '@playwright/test';

// SPEC-003 acceptance criteria that live in the interface, on the demo build. Each test gets a
// fresh browser context, hence a fresh demo haulier, whose units are dated from today.

/** Opens a page once the in-browser API has answered `api`: its database starts then. */
async function open(page: Page, path: string, api: string) {
  const ready = page.waitForResponse((r) => new URL(r.url()).pathname === api, {
    timeout: 45_000,
  });
  await page.goto(path);
  expect((await ready).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** The day `offset` days from today in Paris, as YYYY-MM-DD. */
function parisDay(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

/** "06/11 06:00": how the interface shows a time. */
const shown = (day: string, time: string) => `${day.slice(8, 10)}/${day.slice(5, 7)} ${time}`;

test('criteria 1 and 2: a unit is composed from free resources; a C1 driver is greyed', async ({
  page,
}) => {
  const start = `${parisDay(2)}T06:00`;
  await open(page, `/resources/units/new?start=${start}`, '/api/units/options');
  await expect(page.getByLabel('Start')).toHaveValue(start);

  await page.getByRole('radio', { name: /AB-123-CD/ }).check();
  await page.getByRole('radio', { name: /SR-4475/ }).check();
  await expect(page.getByText('Licence needed')).toBeVisible();
  await expect(page.locator('.licence-category')).toHaveText('CE');

  const giraud = page.getByRole('radio', { name: /Laura Giraud/ });
  await expect(giraud).toBeDisabled();
  await expect(page.locator('label', { has: giraud })).toContainText('Holds C1, needs CE');

  await page.getByRole('radio', { name: /Marc Laurent/ }).check();
  await page.getByRole('button', { name: 'Save unit' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Units' })).toBeVisible();
  const row = page.getByRole('row', { name: /M\. Laurent/ });
  await expect(row).toContainText('AB-123-CD');
  await expect(row).toContainText('SR-4475');
  await expect(row).toContainText(shown(parisDay(2), '06:00'));
});

test('criterion 4: no semi-trailer behind a rigid truck, no trailer behind a light van', async ({
  page,
}) => {
  // The demo's rigid trucks are all in units with no end: a new unit cannot start with them. A
  // free one is created first.
  await open(page, '/resources/power-units/new', '/api/reference-lists');
  await page.getByLabel('Registration plate').fill('RT-404-AB');
  await page.getByRole('radio', { name: 'Rigid truck' }).check();
  await page.getByRole('radio', { name: 'N3' }).check();
  await page.getByLabel(/^Gross vehicle weight/).fill('19000');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Rigid truck/ })).toBeVisible();
  await page.getByRole('link', { name: 'New unit with this vehicle' }).click();
  const semi = page.getByRole('radio', { name: /SR-4475/ });
  await expect(semi).toBeDisabled();
  await expect(page.locator('label', { has: semi })).toContainText('Semi-trailer: needs a tractor');

  await page.getByRole('radio', { name: /JK-318-LM/ }).check();
  for (const trailer of ['SR-4475', 'RQ-0915', 'FR-2210']) {
    const radio = page.getByRole('radio', { name: new RegExp(trailer) });
    await expect(radio).toBeDisabled();
    await expect(page.locator('label', { has: radio })).toContainText(
      'A light van takes no trailer',
    );
  }
});

test('criterion 8: a change of driver ends the unit and starts another', async ({ page }) => {
  await open(page, '/resources/units', '/api/units');
  await page.getByRole('button', { name: 'Change the driver or trailer of S. Moreau' }).click();
  const dialog = page.getByRole('dialog', { name: "Change S. Moreau's unit" });
  const from = `${parisDay(1)}T06:00`;
  await dialog.getByLabel('From').fill(from);
  await dialog.getByRole('radio', { name: /Marc Laurent/ }).check();
  await expect(dialog.getByText('Marc Laurent is free from')).toBeVisible();
  await dialog.getByRole('button', { name: /Change driver from/ }).click();
  await expect(dialog).toBeHidden();

  // Before the change, Samuel Moreau still drives EF-789-GH.
  await open(page, `/resources/units?at=${parisDay(0)}T23:00`, '/api/units');
  await expect(page.getByRole('row', { name: /EF-789-GH/ })).toContainText('Samuel Moreau');

  // After it, Marc Laurent drives the same tractor and trailer; Samuel Moreau is free.
  await open(page, `/resources/units?at=${parisDay(1)}T08:00`, '/api/units');
  const row = page.getByRole('row', { name: /EF-789-GH/ });
  await expect(row).toContainText('Marc Laurent');
  await expect(row).toContainText('SR-4480');
  const drivers = page.getByRole('region', { name: /^Drivers/ });
  await drivers.getByRole('button', { name: /more/ }).click();
  await expect(drivers).toContainText('Samuel Moreau');
});

test('criterion 13: the change of driver lists the drivers it cannot take, greyed, with the reason', async ({
  page,
}) => {
  await open(page, '/resources/units', '/api/units');
  await page.getByRole('button', { name: 'Change the driver or trailer of S. Moreau' }).click();
  const dialog = page.getByRole('dialog', { name: "Change S. Moreau's unit" });
  await dialog.getByLabel('From').fill(`${parisDay(1)}T06:00`);
  const giraud = dialog.getByRole('radio', { name: /Laura Giraud/ });
  await expect(giraud).toBeDisabled();
  await expect(giraud).toHaveAccessibleName(/Holds C1, needs CE/);
  const marchand = dialog.getByRole('radio', { name: /Élodie Marchand/ });
  await expect(marchand).toBeDisabled();
  await expect(marchand).toHaveAccessibleName(/In É\. Marchand since/);
  await expect(dialog.getByRole('radio', { name: /Marc Laurent/ })).toBeEnabled();
  await expect(dialog.getByRole('radio', { name: /Samuel Moreau/ })).toHaveCount(0);
});

test('criterion 14: a tractor in a unit with no end cannot start another; the unit is named', async ({
  page,
}) => {
  await open(page, '/resources/power-units', '/api/reference-lists');
  await page.getByRole('link', { name: 'CD-456-EF' }).click();
  const units = page.getByRole('region', { name: /^Units/ });
  await expect(units.getByRole('button', { name: 'New unit with this vehicle' })).toBeDisabled();
  await expect(units).toContainText('In the unit H. Perrin, with no end');
  await expect(units.getByRole('link', { name: 'New unit with this vehicle' })).toHaveCount(0);

  // A vehicle in no unit offers it.
  await open(page, '/resources/power-units', '/api/reference-lists');
  await page.getByRole('link', { name: 'JK-318-LM' }).click();
  await expect(page.getByRole('link', { name: 'New unit with this vehicle' })).toBeVisible();
});

test('criterion 11: a trailer in a running unit cannot be archived; the unit is named', async ({
  page,
}) => {
  await open(page, '/resources/trailers', '/api/reference-lists');
  await page.getByRole('link', { name: 'SR-4471' }).click();
  const units = page.getByRole('region', { name: /^Units/ });
  await expect(units.getByRole('row', { name: /H\. Perrin/ })).toContainText('Running');
  await expect(units.getByRole('row', { name: /M\. Laurent/ })).toContainText('Ended');

  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'This resource belongs to the unit H. Perrin' }),
  ).toContainText('End the unit first.');
});

test('criterion 12: in French, every label, reason and message of the units is French', async ({
  page,
}) => {
  await open(page, '/resources/units', '/api/units');
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.getByRole('heading', { level: 1, name: 'Ensembles' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Véhicule' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Unit 5/ })).toContainText('Sans conducteur');
  await expect(page.getByRole('heading', { name: 'Libres à ce moment' })).toBeVisible();
  await expect(page.getByText('Heures de Paris (Europe/Paris)')).toBeVisible();

  await page
    .getByRole('button', { name: 'Changer le conducteur ou la remorque de S. Moreau' })
    .click();
  const dialog = page.getByRole('dialog', { name: "Changer l'ensemble S. Moreau" });
  await expect(dialog.getByText('Ce qui sera enregistré')).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  await page.getByRole('link', { name: 'Nouvel ensemble' }).click();
  await page.getByRole('radio', { name: /JK-318-LM/ }).check();
  await expect(
    page.getByText('Un utilitaire léger ne prend pas de remorque').first(),
  ).toBeVisible();
  await page.getByRole('button', { name: "Enregistrer l'ensemble" }).click();
  await expect(
    page.getByText(
      "Un ensemble a besoin d'un conducteur ou d'une remorque en plus de son véhicule",
    ),
  ).toBeVisible();
});

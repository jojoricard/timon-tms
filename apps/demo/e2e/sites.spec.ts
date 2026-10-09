import { type BrowserContext, expect, type Page, test } from '@playwright/test';

// SPEC-002 criteria about sites, on the demo build. The service worker's calls to the IGN go
// through the browser context, so each test decides what the "service" answers.

const quaiB = { latitude: 45.6906, longitude: 4.9488 };

/** The IGN answering with one house number at `point`. */
async function ign(
  context: BrowserContext,
  label: string,
  point: { latitude: number; longitude: number },
) {
  await context.route('https://data.geopf.fr/**', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
            properties: {
              label,
              name: label.replace(/ \d{5} .*$/, ''),
              type: 'housenumber',
              score: 0.97,
              postcode: label.match(/\d{5}/)?.[0] ?? '',
              city: label.replace(/^.* \d{5} /, ''),
            },
          },
        ],
      },
    }),
  );
}

test.beforeEach(async ({ context }) => {
  await context.route('https://tile.openstreetmap.org/**', (route) => route.abort());
});

async function open(page: Page, path: string) {
  const ready = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith('/api/'), {
    timeout: 45_000,
  });
  await page.goto(path);
  expect((await ready).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** The badge saying how the site is located, next to the address title. */
const locatedBy = (page: Page) => page.getByRole('region', { name: 'Address' }).locator('.t-badge');

async function newSite(page: Page, name: string) {
  await open(page, '/customers/sites/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
}

test("criterion 5: choosing the suggestion for 2 avenue de l'Europe locates the site by address", async ({
  page,
  context,
}) => {
  await ign(context, "2 Avenue de l'Europe 78140 Vélizy-Villacoublay", {
    latitude: 48.784357,
    longitude: 2.218975,
  });
  await newSite(page, 'Vélizy');
  await page
    .getByRole('combobox', { name: 'Street' })
    .fill("2 avenue de l'Europe 78140 Vélizy-Villacoublay");
  await page
    .getByRole('option', { name: /2 Avenue de l'Europe 78140 Vélizy-Villacoublay/ })
    .click();
  await expect(page.getByLabel('Postcode')).toHaveValue('78140');
  await expect(page.getByLabel('City')).toHaveValue('Vélizy-Villacoublay');
  await expect(page.getByText(/^48\.7843\d, 2\.2189\d$/)).toBeVisible();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vélizy' })).toBeVisible();
  await expect(locatedBy(page)).toHaveText('Address');
});

test('criterion 6: a site in Germany placed by hand is in Europe/Berlin', async ({ page }) => {
  await newSite(page, 'Lager München');
  await page.getByLabel('Country').selectOption('DE');
  await page.getByRole('combobox', { name: 'Street' }).fill('Hauptstraße 1');
  await page.getByLabel('Postcode').fill('80331');
  await page.getByLabel('City').fill('München');
  await page.getByRole('application', { name: /Map of the site/ }).click();
  await expect(page.getByText('Time zone · Europe/Berlin')).toBeVisible();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lager München' })).toBeVisible();
  await expect(locatedBy(page)).toHaveText('By hand');
});

test('criterion 7: with the IGN unreachable, a French site is saved as not located', async ({
  page,
  context,
}) => {
  await context.route('https://data.geopf.fr/**', (route) => route.abort());
  await newSite(page, 'Hors ligne');
  await page.getByRole('combobox', { name: 'Street' }).fill('3 rue Inconnue');
  await page.getByLabel('Postcode').fill('69800');
  await page.getByLabel('City').fill('Saint-Priest');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Hors ligne' })).toBeVisible();
  await expect(locatedBy(page)).toHaveText('Not located');

  await page.getByRole('link', { name: 'Sites' }).first().click();
  await page.getByRole('button', { name: /^Not located/ }).click();
  await expect(page.getByRole('table')).toContainText('Hors ligne');
});

test('criterion 8: a site 30 metres from an active one is named in a warning, and saved', async ({
  page,
  context,
}) => {
  await ign(context, '16 Rue des Frères Lumière 69800 Saint-Priest', {
    latitude: quaiB.latitude + 30 / 111_195,
    longitude: quaiB.longitude,
  });
  await newSite(page, 'Quai D');
  await page.getByRole('combobox', { name: 'Street' }).fill('16 rue des Frères Lumière 69800');
  await page.getByRole('option', { name: /16 Rue des Frères Lumière/ }).click();
  await expect(
    page.getByText('30 m from an active site: Plateforme Saint-Priest — quai B.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Quai D' })).toBeVisible();
});

test('criterion 9: overlapping hours are refused; a night over two days is saved', async ({
  page,
}) => {
  await page.context().route('https://data.geopf.fr/**', (route) => route.abort());
  await newSite(page, 'Horaires');
  await page.getByLabel('Country').selectOption('DE');
  await page.getByRole('combobox', { name: 'Street' }).fill('Hauptstraße 2');
  await page.getByLabel('City').fill('Berlin');

  const monday = page.getByRole('group', { name: 'Monday' });
  await monday.getByRole('button', { name: 'Add a range on Monday' }).click();
  await monday.getByRole('button', { name: 'Add a range on Monday' }).click();
  const from = monday.getByLabel('Monday, from');
  const to = monday.getByLabel('Monday, to');
  await from.nth(0).fill('06:00');
  await to.nth(0).fill('12:00');
  await from.nth(1).fill('11:00');
  await to.nth(1).fill('18:00');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(monday.getByRole('alert')).toHaveText('Monday: 06:00–12:00 and 11:00–18:00 overlap');

  await from.nth(0).fill('22:00');
  await to.nth(0).fill('24:00');
  await monday.getByRole('button', { name: /Remove the range 11:00–18:00/ }).click();
  const tuesday = page.getByRole('group', { name: 'Tuesday' });
  await tuesday.getByRole('button', { name: 'Add a range on Tuesday' }).click();
  await tuesday.getByLabel('Tuesday, from').fill('00:00');
  await tuesday.getByLabel('Tuesday, to').fill('05:00');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Horaires' })).toBeVisible();
});

test('criterion 12: postcode "7814" on line 42 stops an import of 300 sites', async ({
  page,
  context,
}) => {
  await context.route('https://data.geopf.fr/**', (route) => route.abort());
  await open(page, '/customers/sites/import');
  const lines = ['name;street;postcode;city;monday'];
  for (let line = 2; line <= 301; line += 1) {
    lines.push(
      `Site ${line};${line} rue de Lyon;${line === 42 ? '7814' : '69800'};Saint-Priest;06:00-12:00`,
    );
  }
  await page.getByLabel('CSV file').setInputFiles({
    name: 'sites.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(lines.join('\n')),
  });
  await expect(page.getByText('line 42: postcode must have five digits')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: /Import every line/ })).toBeDisabled();
});

import { expect, type Page, test } from '@playwright/test';

// Every screen fits the window: the page never scrolls sideways, at a laptop width and at a phone
// width. A table wider than the window scrolls inside its frame instead, with a shade on the edge
// that has more to show; the main lists fit their frame on a laptop. No text in a table runs past
// its cell. One test per width visits every screen in the same browser context, so the demo
// haulier is created once.

type Screen = {
  name: string;
  path: string;
  /** Opens the first record of the list, for a form. */
  open?: { url: RegExp };
  /** Opens the change dialog of the unit. */
  dialog?: boolean;
  /** Opens this tab of the record. */
  tab?: RegExp;
  /** A list whose table is wider than a phone. */
  table?: boolean;
  /** A main list: its table fits its frame at 1,280 px. */
  main?: boolean;
  /** A form with a table. */
  cells?: boolean;
};

const screens: Screen[] = [
  { name: 'orders', main: true, path: '/orders', table: true },
  { name: 'order form', path: '/orders', open: { url: /\/orders\/[0-9a-f-]{36}$/ } },
  {
    name: 'order history',
    path: '/orders',
    open: { url: /\/orders\/[0-9a-f-]{36}$/ },
    tab: /^(History|Historique)/,
  },
  { name: 'new order', path: '/orders/new' },
  { name: 'drivers', main: true, path: '/resources/drivers', table: true },
  { name: 'power units', main: true, path: '/resources/power-units', table: true },
  { name: 'trailers', main: true, path: '/resources/trailers', table: true },
  { name: 'expiries', main: true, path: '/resources/expiries', table: true },
  { name: 'units', main: true, path: '/resources/units', table: true },
  { name: 'resource import', path: '/resources/drivers/import' },
  { name: 'customers', path: '/customers', table: true },
  { name: 'sites', path: '/customers/sites', table: true },
  { name: 'customer import', path: '/customers/import' },
  { name: 'site import', path: '/customers/sites/import' },
  {
    name: 'driver form',
    cells: true,
    path: '/resources/drivers',
    open: { url: /\/resources\/drivers\/[^/]+$/ },
  },
  {
    name: 'power unit form',
    cells: true,
    path: '/resources/power-units',
    open: { url: /\/resources\/power-units\/[^/]+$/ },
  },
  { name: 'customer form', cells: true, path: '/customers', open: { url: /\/customers\/[^/]+$/ } },
  { name: 'site form', path: '/customers/sites', open: { url: /\/customers\/sites\/[^/]+$/ } },
  { name: 'unit form', path: '/resources/units/new' },
  {
    name: 'unit page',
    cells: true,
    path: '/resources/units',
    open: { url: /\/resources\/units\/[^/]+$/ },
  },
  {
    name: 'change dialog',
    path: '/resources/units',
    open: { url: /\/resources\/units\/[^/]+$/ },
    dialog: true,
  },
];

/** Waits until the screen shows its data: a table row, or a form field. */
async function settle(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main :is(tbody tr, input, select)').first()).toBeVisible();
}

async function visit(page: Page, screen: Screen) {
  await page.goto(screen.path);
  await settle(page);
  if (screen.open) {
    await page.locator('main table tbody .row-link').first().click();
    await expect(page).toHaveURL(screen.open.url);
    await settle(page);
  }
  if (screen.tab) {
    await page.getByRole('link', { name: screen.tab }).click();
    await expect(page.locator('main .history-entry').first()).toBeVisible();
  }
  if (screen.dialog) {
    await page.getByRole('button', { name: 'Change driver or trailer' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }
  // A list shows its search field before its rows: wait for the rows, and for the fonts that set
  // their widths, before measuring anything.
  if (screen.table || screen.cells) {
    await expect(page.locator('main .t-table tbody tr').first()).toBeVisible();
  }
  await page.evaluate(() => document.fonts.ready);
}

/** The first table of the screen: its frame, and the area inside it that scrolls. */
const table = (page: Page) => ({
  frame: page.locator('main .t-table-frame').first(),
  scroller: page.locator('main .t-table-scroll').first(),
});

/** How far the scroller reaches past its frame, in pixels: 0 when the table fits. */
const overflow = (page: Page) =>
  table(page).scroller.evaluate((el) => el.scrollWidth - el.clientWidth);

/**
 * The texts of the screen's tables that run past the content box of their cell: each text node is
 * measured with a range, against the cell's right edge less its padding. Visually hidden text is
 * left out.
 */
const overrunningText = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    for (const cell of document.querySelectorAll('main .t-table :is(th, td)')) {
      const style = getComputedStyle(cell);
      const limit =
        cell.getBoundingClientRect().right -
        Number.parseFloat(style.paddingRight) -
        Number.parseFloat(style.borderRightWidth);
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        if (!text || node.parentElement?.closest('.t-visually-hidden, caption')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const right = Math.max(...[...range.getClientRects()].map((r) => r.right));
        if (right > limit + 0.5) found.push(`"${text}" by ${Math.ceil(right - limit)} px`);
      }
    }
    return found;
  });

/** Opens the demo once its in-browser API has answered: its database is created and seeded then. */
async function start(page: Page) {
  const ready = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/resources' && r.status() === 200,
    { timeout: 45_000 },
  );
  await page.goto('/');
  await ready;
}

/** How far the page reaches past the window, in pixels: 0 when nothing sticks out. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });

for (const width of [1280, 390]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: width < 640 ? 844 : 900 } });

    test('no screen scrolls sideways; wide tables scroll in their frame', async ({ page }) => {
      // Twenty-one screens in a row: more than the time one screen is given.
      test.setTimeout(180_000);
      await start(page);

      for (const screen of screens) {
        await test.step(screen.name, async () => {
          await visit(page, screen);
          expect(await sideways(page), `${screen.name} scrolls sideways`).toBe(0);
          if (width < 640 && screen.table) {
            const { frame, scroller } = table(page);
            expect(await overflow(page), `${screen.name}: the table scrolls`).toBeGreaterThan(0);
            await expect(frame, `${screen.name}: the trailing edge is shaded`).toHaveAttribute(
              'data-more',
            );
            await scroller.evaluate((el) => {
              el.scrollLeft = el.scrollWidth;
            });
            await expect(frame, `${screen.name}: no shade once at the end`).not.toHaveAttribute(
              'data-more',
            );
            await expect(frame).toHaveAttribute('data-scrolled');
          }
          if (width >= 1280 && screen.main) {
            expect(await overflow(page), `${screen.name}: the table fits its frame`).toBe(0);
          }
          const current = page.locator('main .t-tabs [aria-current="page"]');
          if (screen.main && (await current.count()) > 0) {
            await expect(current, `${screen.name}: the current tab is in view`).toBeInViewport({
              ratio: 1,
            });
          }
        });
      }
    });
  });
}

test.describe('at 1280 px, in French', () => {
  test.use({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });

  test('the main lists fit their frame', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Moyens' })).toBeVisible();

    for (const screen of screens.filter((s) => s.main)) {
      await test.step(screen.name, async () => {
        await visit(page, screen);
        expect(await overflow(page), `${screen.name}: the table fits its frame`).toBe(0);
      });
    }
  });
});

// Where tables sit at their least width, and the phone, in both languages: a code, a date or a
// column title that cannot wrap widens its column; it never runs into the next one.
for (const width of [1024, 390]) {
  for (const locale of ['en-GB', 'fr-FR']) {
    test.describe(`at ${width} px, ${locale}`, () => {
      test.use({ viewport: { width, height: width < 640 ? 844 : 900 }, locale });

      test('no text in a table runs past its cell', async ({ page }) => {
        test.setTimeout(150_000);
        await start(page);
        for (const screen of screens.filter((s) => s.table || s.cells)) {
          await test.step(screen.name, async () => {
            await visit(page, screen);
            expect(await overrunningText(page), `${screen.name}: text past its cell`).toEqual([]);
          });
        }
      });
    });
  }
}

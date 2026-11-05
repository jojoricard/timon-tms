import { expect, type Page, test } from '@playwright/test';

// Tables and fields keep to their frame: long text wraps in its cell, a text area grows down only,
// the actions of a table in a form stay in view, the tabs show no scrollbar.

async function open(page: Page, path: string) {
  const ready = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/resources' && r.status() === 200,
    { timeout: 45_000 },
  );
  await page.goto('/');
  await ready;
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main :is(tbody tr, input, select)').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** How far the first table reaches past its frame, in pixels: 0 when it fits. */
const overflow = (page: Page) =>
  page
    .locator('main .t-table-scroll')
    .first()
    .evaluate((el) => el.scrollWidth - el.clientWidth);

test('a long word wraps in its cell and leaves the columns their width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, '/resources/drivers/new');
  await page.getByLabel('Last name').fill('Long');
  await page.getByLabel('First name').fill('X'.repeat(100));
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/resources\/drivers\/[0-9a-f-]{36}$/);
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Drivers' })
    .click();
  await expect(page.getByRole('row', { name: /X{20}/ })).toBeVisible();
  expect(await overflow(page)).toBe(0);
});

test('a text area grows down only, within its card', async ({ page }) => {
  await open(page, '/customers');
  await page.locator('main table tbody .row-link').first().click();
  const notes = page.locator('main textarea').first();
  await expect(notes).toBeVisible();
  const style = await notes.evaluate((el) => {
    const s = getComputedStyle(el);
    return { resize: s.resize, maxWidth: s.maxWidth };
  });
  expect(style).toEqual({ resize: 'vertical', maxWidth: '100%' });
});

/**
 * The first Remove button of a table is inside its card. When the table scrolls, the button stays
 * in place while the row scrolls under it.
 */
async function actionsStay(page: Page, frameSelector: string, scrolls: boolean) {
  const frame = page.locator(frameSelector).first();
  const remove = frame.getByRole('button', { name: /^Remove / }).first();
  await expect(remove).toBeVisible();
  const scroller = frame.locator('.t-table-scroll');
  const hidden = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(hidden > 0).toBe(scrolls);
  const frameBox = await frame.boundingBox();
  const removeBox = await remove.boundingBox();
  expect((removeBox?.x ?? 0) + (removeBox?.width ?? 0)).toBeLessThanOrEqual(
    (frameBox?.x ?? 0) + (frameBox?.width ?? 0),
  );
  await scroller.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  expect((await remove.boundingBox())?.x).toBeCloseTo(removeBox?.x ?? 0, 0);
}

test('the actions of a table in a form stay in view at the end of their row', async ({ page }) => {
  // The documents scrolled in their card at 1,100 px; long words now wrap and they fit. The usual
  // sites scroll at every width.
  await page.setViewportSize({ width: 1100, height: 900 });
  await open(page, '/resources/drivers');
  await page.getByRole('link', { name: 'Karim Benali' }).click();
  await actionsStay(page, '.resource-documents .t-table-frame', false);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/customers');
  await page.locator('main table tbody .row-link').first().click();
  await actionsStay(page, 'main .t-table-frame', true);
});

test('the tabs scroll without a scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page, '/resources/drivers');
  const tabs = page.getByRole('navigation', { name: 'Resource lists' }).locator('.t-tabs');
  expect(await tabs.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('none');
});

test('the next expiry reads its date on a line of its own, in every row', async ({ page }) => {
  await page.setViewportSize({ width: 1150, height: 900 });
  await open(page, '/resources/power-units');
  const cells = page.locator('main tbody td.next-expiry');
  await expect(cells.first()).toBeVisible();
  const placed = await cells.evaluateAll((all) =>
    all
      .filter((cell) => cell.querySelector('.next-expiry-date'))
      .map((cell) => {
        const label = cell.querySelector('.next-expiry-type')?.getBoundingClientRect();
        const date = cell.querySelector('.next-expiry-date')?.getBoundingClientRect();
        return label && date ? date.top >= label.bottom - 1 : false;
      }),
  );
  expect(placed.length).toBeGreaterThan(0);
  expect(placed.every(Boolean)).toBe(true);
});

test('an open-ended unit says so in the text font, not the font of dates', async ({ page }) => {
  await open(page, '/resources/units');
  const cell = page.getByRole('cell', { name: 'Open-ended' }).first();
  await expect(cell).toBeVisible();
  const [cellFont, dateFont] = await Promise.all([
    cell.evaluate((el) => getComputedStyle(el).fontFamily),
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-mono')),
  ]);
  expect(cellFont).not.toContain(dateFont.split(',')[0]?.trim() ?? 'mono');
});

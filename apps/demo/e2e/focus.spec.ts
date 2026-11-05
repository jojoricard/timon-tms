import { expect, type Page, test } from '@playwright/test';

// Keyboard focus is always visible: every element reached with Tab, on every screen, in the light
// and the dark theme, draws a ring. A control hidden behind its own drawing, such as the radio of a
// segmented control, draws it on the element that shows it.

/** Opens the demo once its in-browser API has answered: its database is created then. */
async function start(page: Page) {
  const ready = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/resources' && r.status() === 200,
    { timeout: 45_000 },
  );
  await page.goto('/');
  await ready;
}

type Screen = {
  name: string;
  path: string;
  /** Opens the first record of the list. */
  open?: boolean;
  /** Opens the change dialog of the unit, and tabs inside it. */
  dialog?: boolean;
};

const screens: Screen[] = [
  { name: 'drivers', path: '/resources/drivers' },
  { name: 'driver form', path: '/resources/drivers', open: true },
  { name: 'new power unit', path: '/resources/power-units/new' },
  { name: 'expiries', path: '/resources/expiries' },
  { name: 'units', path: '/resources/units' },
  { name: 'new unit', path: '/resources/units/new' },
  { name: 'unit page', path: '/resources/units', open: true },
  { name: 'change dialog', path: '/resources/units', open: true, dialog: true },
  { name: 'driver import', path: '/resources/drivers/import' },
  { name: 'customers', path: '/customers' },
  { name: 'customer form', path: '/customers', open: true },
  { name: 'sites', path: '/customers/sites' },
  { name: 'site form', path: '/customers/sites', open: true },
  { name: 'new site', path: '/customers/sites/new' },
];

/** Waits for the data of the screen: a table row, or a form field. */
async function settle(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main :is(tbody tr, input, select)').first()).toBeVisible();
}

async function visit(page: Page, screen: Screen) {
  await page.goto(screen.path);
  await settle(page);
  if (screen.open) {
    await page.locator('main table tbody .row-link').first().click();
    await expect(page).not.toHaveURL(new RegExp(`${screen.path}$`));
    await settle(page);
  }
  if (screen.dialog) {
    await page.getByRole('button', { name: 'Change driver or trailer' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } else {
    await page.locator('body').click({ position: { x: 1, y: 1 } });
  }
}

/**
 * Tabs through the page. Returns the elements that showed no ring, and the kinds of element
 * reached, so the report says what was checked.
 */
async function tabThrough(page: Page, stops: number) {
  const missing = new Set<string>();
  const reached = new Set<string>();
  for (let i = 0; i < stops; i += 1) {
    await page.keyboard.press('Tab');
    const found = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const ring = (target: Element | null) => {
        if (!target) return false;
        const style = getComputedStyle(target);
        return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
      };
      const type = element.getAttribute('type');
      const role = element.getAttribute('role');
      const kind = `${element.tagName.toLowerCase()}${type ? `[${type}]` : ''}${role ? `(${role})` : ''}`;
      // A visually hidden input shows its focus on the element drawn next to it, or its label.
      const drawn = [element, element.nextElementSibling, element.closest('label')];
      if (drawn.some(ring)) return { kind, missing: null };
      const name = element.getAttribute('aria-label') ?? (element.textContent ?? '').trim();
      return { kind, missing: `${kind} "${name.slice(0, 40)}"` };
    });
    if (!found) continue;
    reached.add(found.kind);
    if (found.missing) missing.add(found.missing);
  }
  return { missing: [...missing], reached: [...reached] };
}

for (const scheme of ['light', 'dark'] as const) {
  test(`every element reached with Tab shows a ring, ${scheme} theme`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ colorScheme: scheme });
    const report: Record<string, string[]> = {};
    const reached = new Set<string>();
    await start(page);
    for (const screen of screens) {
      await visit(page, screen);
      const result = await tabThrough(page, 50);
      for (const kind of result.reached) reached.add(kind);
      if (result.missing.length > 0) report[screen.name] = result.missing;
    }
    test.info().annotations.push({ type: 'reached', description: [...reached].sort().join(', ') });
    // The ring has the colour of the token, not an unresolved reference.
    const focus = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-focus').trim(),
    );
    expect(focus).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(report).toEqual({});
  });
}

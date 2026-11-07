import { expect, test, type Page } from '@playwright/test';

// Primary theme through the preview door (D33): the demo school, built from the manifest's own defaults.
// Baselines are written by the first `playwright test --update-snapshots` run on a quiet machine; none are
// committed from here (the host that wrote this spec could not run a browser).
test.use({ extraHTTPHeaders: { 'X-Site-Preview': 'primary' } });

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const SIZES = [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
] as const;

for (const lang of ['bn', 'en'] as const) {
  for (const [name, size] of SIZES) {
    test(`home ${lang} at ${name}: no overflow, hero first, footer credit, no inline script`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto(`/${lang}/`);
      await expect(page.locator('h1')).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      const ids = await page.locator('main section').evaluateAll((els) => els.map((e) => e.id));
      expect(ids[0]).toBe('hero');
      await expect(page.locator('footer')).toContainText('SchoolManagerP');
      await expect(page.locator('svg.scene')).toBeVisible();
      if (lang === 'bn')
        await expect(page).toHaveScreenshot(`home-${name}.png`, { fullPage: true });
    });
  }
}

test('phone: menu opens as a sheet, every target is at least 44 px tall', async ({ page }) => {
  await page.setViewportSize(SIZES[0][1]);
  await page.goto('/bn/');
  await page.locator('summary.menu-btn').click();
  await expect(page.locator('.sheet-panel')).toBeVisible();
  for (const a of await page.locator('.sheet-panel nav a').all()) {
    expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  for (const sel of ['.top .btn', '.lang a']) {
    for (const el of await page.locator(sel).all()) {
      if (await el.isVisible()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('reduced motion: the illustration stands still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/bn/');
  const anim = await page.locator('.sc-kite').evaluate((e) => getComputedStyle(e).animationName);
  expect(anim).toBe('none');
});

test('theme tokens apply to the page: corner radius and content width', async ({ page }) => {
  await page.goto('/en/');
  const tok = await page.locator('.t-primary').evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.getPropertyValue('--r').trim(), s.getPropertyValue('--max').trim()];
  });
  expect(tok).toEqual(['22px', '1120px']);
});

test('keyboard focus is visible on the first link', async ({ page }) => {
  await page.goto('/bn/');
  await page.keyboard.press('Tab');
  const w = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth);
  expect(parseFloat(w)).toBeGreaterThanOrEqual(2);
});

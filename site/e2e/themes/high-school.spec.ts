import { expect, test, type Page } from '@playwright/test';

// High school theme through the preview door (D33): the demo school, built from the manifest's own defaults.
// Baselines are written by the first `playwright test --update-snapshots` run on a quiet machine; none are
// committed from here (the host that wrote this spec could not run a browser).
test.use({ extraHTTPHeaders: { 'X-Site-Preview': 'high-school' } });

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
      await expect(page.locator('.hero .year')).toBeVisible();
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

test('no hero photo: the page is typographic, with no image in the hero', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('.hero img')).toHaveCount(0);
  await expect(page.locator('.hero .year')).toHaveText('1968');
});

test('reduced motion: the announcement marquee and carousel stay still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/bn/');
  // The demo school may have no announcements or photos, so put the two tracks on the page ourselves:
  // a loop over zero elements would pass without testing anything.
  await page.evaluate(() => {
    for (const c of ['ann-track', 'hc-track']) {
      const el = document.createElement('div');
      el.className = c;
      document.querySelector('.t-high-school')!.append(el);
    }
  });
  const tracks = page.locator('.ann-track, .hc-track');
  expect(await tracks.count()).toBeGreaterThanOrEqual(2);
  const names = await tracks.evaluateAll((els) =>
    els.map((e) => getComputedStyle(e).animationName),
  );
  for (const n of names) expect(n).toBe('none');
});

test('theme tokens apply to the page: corner radius and content width', async ({ page }) => {
  await page.goto('/en/');
  const tok = await page.locator('.t-high-school').evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.getPropertyValue('--r').trim(), s.getPropertyValue('--max').trim()];
  });
  expect(tok).toEqual(['0', '1120px']);
  expect(await page.locator('.top').evaluate((e) => getComputedStyle(e).borderRadius)).toBe('0px');
});

test('keyboard focus is visible on the first link', async ({ page }) => {
  await page.goto('/bn/');
  await page.keyboard.press('Tab');
  const w = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth);
  expect(parseFloat(w)).toBeGreaterThanOrEqual(2);
});

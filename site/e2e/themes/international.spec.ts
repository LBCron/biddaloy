import { expect, test, type Page } from '@playwright/test';

// International theme through the preview door (D33): the demo school, built from the manifest's own defaults.
// Baselines are written by the first `playwright test --update-snapshots` run on a quiet machine; none are
// committed from here (the host that wrote this spec could not run a browser).
test.use({ extraHTTPHeaders: { 'X-Site-Preview': 'international' } });

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const SIZES = [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
] as const;
const PAGES = ['about', 'academics', 'admissions', 'notices', 'teachers', 'contact'] as const;

for (const lang of ['bn', 'en'] as const) {
  for (const [name, size] of SIZES) {
    test(`home ${lang} at ${name}: no overflow, hero first, footer credit`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(`/${lang}/`);
      await expect(page.locator('h1')).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      const ids = await page.locator('main section').evaluateAll((els) => els.map((e) => e.id));
      expect(ids[0]).toBe('hero');
      await expect(page.locator('footer')).toContainText('SchoolManagerP');
      if (lang === 'bn')
        await expect(page).toHaveScreenshot(`home-${name}.png`, { fullPage: true });
    });
    for (const p of PAGES) {
      test(`${p} ${lang} at ${name}: no overflow`, async ({ page }) => {
        await page.setViewportSize(size);
        await page.goto(`/${lang}/${p}/`);
        expect(await noOverflow(page)).toBe(true);
      });
    }
  }
}

test('phone: menu opens the sheet, every target at least 44 px tall', async ({ page }) => {
  await page.setViewportSize(SIZES[0][1]);
  await page.goto('/bn/');
  await page.locator('summary.menu-btn').click();
  await expect(page.locator('.sheet-panel')).toBeVisible();
  for (const a of await page.locator('.sheet-panel a').all())
    expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const sel of ['.top .btn', '.lang a'])
    for (const el of await page.locator(sel).all())
      if (await el.isVisible()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('hero: type-led with the plate fallback and an accent word, no photo', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('.hero img')).toHaveCount(0);
  await expect(page.locator('.hero h1 em')).toHaveText('world');
  await expect(page.locator('.hero .plate-art')).toBeVisible();
});

test('academics: the pathway has six numbered steps', async ({ page }) => {
  await page.goto('/en/academics/');
  await expect(page.locator('.blocks .block')).toHaveCount(6);
});

test('reduced motion: the announcement and photo tracks stay still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/bn/');
  // The demo school may have no announcements or photos, so put the two tracks on the page ourselves:
  // a loop over zero elements would pass without testing anything. (This theme has no entrance animation.)
  await page.evaluate(() => {
    for (const c of ['ann-track', 'hc-track']) {
      const el = document.createElement('div');
      el.className = c;
      document.querySelector('.t-international')!.append(el);
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
  const tok = await page.locator('.t-international').evaluate((e) => {
    const s = getComputedStyle(e);
    return [s.getPropertyValue('--r').trim(), s.getPropertyValue('--max').trim()];
  });
  expect(tok).toEqual(['2px', '1160px']);
});

test('palette variants differ only in computed colours', async ({ page }) => {
  await page.setViewportSize(SIZES[0][1]);
  await page.goto('/bn/');
  const box = async () => (await page.locator('.hero').boundingBox())!.height;
  const before = await box();
  await page.evaluate(() =>
    document.documentElement.style.setProperty('--primary', 'rgb(1, 2, 3)'),
  );
  expect(await box()).toBe(before);
});

test('keyboard focus is visible on the first link', async ({ page }) => {
  await page.goto('/bn/');
  await page.keyboard.press('Tab');
  const w = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth);
  expect(parseFloat(w)).toBeGreaterThanOrEqual(2);
});

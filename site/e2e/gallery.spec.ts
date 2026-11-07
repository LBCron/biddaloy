import { expect, test, type Page } from '@playwright/test';

// [40.6.07] gal.localhost: 12 photos on home, 30 on the page, link on. nogal.localhost: gallery on, no photo.
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const SIZES = [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
] as const;

for (const [name, size] of SIZES) {
  test.describe(`gallery at ${name}`, () => {
    test.use({ baseURL: 'http://gal.localhost:4321', viewport: size });

    test('home: carousel with the 12 photos, no overflow, link to the page', async ({ page }) => {
      await page.goto('/bn/');
      await expect(page.locator('#gallery .gc-slide')).toHaveCount(12);
      expect(await noOverflow(page)).toBe(true);
      await expect(page.locator('#gallery .seeall a')).toHaveAttribute('href', '/bn/gallery/');
      await expect(page.locator('nav.nav a[href="/bn/gallery/"]')).toHaveCount(1);
    });

    test('page: grid, viewer opens, arrows move, Esc closes and focus returns', async ({
      page,
    }) => {
      await page.goto('/bn/gallery/');
      await expect(page.locator('h2')).toHaveText('বার্ষিক ক্রীড়া');
      await expect(page.locator('.gg-tile')).toHaveCount(30);
      expect(await noOverflow(page)).toBe(true);
      const tile = page.locator('.gg-tile').first();
      await tile.click();
      await expect(page.locator('dialog.gv')).toBeVisible();
      await expect(page.locator('.gv-cap')).toHaveText('প্রথম ছবি');
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.gv-img')).toHaveAttribute('src', '/media/p1');
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog.gv')).toBeHidden();
      await expect(tile).toBeFocused();
    });

    test('sitemap lists the gallery page', async ({ request }) => {
      const xml = await (await request.get('/sitemap.xml')).text();
      expect(xml).toContain('/bn/gallery/');
    });

    test('/en/gallery: English heading, Bangla fallback caption', async ({ page }) => {
      await page.goto('/en/gallery/');
      await expect(page.locator('h1')).toHaveText('Gallery');
      await page.locator('.gg-tile').first().click();
      await expect(page.locator('.gv-cap')).toHaveText('প্রথম ছবি');
    });
  });
}

test.describe('no photo', () => {
  test.use({ baseURL: 'http://nogal.localhost:4321', viewport: SIZES[0][1] });
  test('no section, no gap, the page is the 404, no nav item', async ({ page }) => {
    await page.goto('/bn/');
    await expect(page.locator('#gallery')).toHaveCount(0);
    await expect(page.locator('nav.nav a[href="/bn/gallery/"]')).toHaveCount(0);
    const res = await page.goto('/bn/gallery/');
    expect(res?.status()).toBe(404);
  });
});

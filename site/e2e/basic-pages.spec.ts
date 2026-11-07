import { expect, test, type Page } from '@playwright/test';

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const [name, size] of [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
] as const) {
  for (const path of ['about', 'teachers', 'contact']) {
    test(`/${path}/ at ${name}: renders, no horizontal overflow, credit in footer`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.goto(`/bn/${path}/`);
      await expect(page.locator('main h2').first()).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      await expect(page.locator('footer')).toContainText('SchoolManagerP');
    });
  }
}

test('teachers page lists every teacher; a page the API has not enabled is the 404 page', async ({
  page,
}) => {
  await page.goto('/bn/teachers/');
  await expect(page.locator('.tcard')).toHaveCount(3);
  const res = await page.goto('/bn/results/');
  expect(res?.status()).toBe(404);
});

test('page head carries description and og tags', async ({ page }) => {
  await page.goto('/bn/about/');
  await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
});

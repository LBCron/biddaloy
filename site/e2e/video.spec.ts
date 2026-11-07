import { expect, test, type Page } from '@playwright/test';

// [40.6.07] vid / vidb / vidx.localhost: heading above, below, and a null video id.
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const SIZES = [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
] as const;

for (const [name, size] of SIZES) {
  test.describe(`video at ${name}`, () => {
    test.use({ viewport: size });

    test.describe('heading above', () => {
      test.use({ baseURL: 'http://vid.localhost:4321' });
      test('no iframe and no YouTube request until play; Enter then adds one sandboxed iframe', async ({
        page,
      }) => {
        const hits: string[] = [];
        page.on('request', (r) => {
          if (/youtube|ytimg|google/.test(new URL(r.url()).hostname)) hits.push(r.url());
        });
        await page.goto('/bn/');
        expect(await noOverflow(page)).toBe(true);
        await expect(page.locator('iframe')).toHaveCount(0);
        expect(hits).toEqual([]);
        const heading = await page.locator('.ve-h').boundingBox();
        const box = await page.locator('.ve-box').boundingBox();
        expect(heading!.y).toBeLessThan(box!.y);
        await page.locator('.ve-play').focus();
        await page.keyboard.press('Enter');
        const f = page.locator('iframe');
        await expect(f).toHaveCount(1);
        await expect(f).toHaveAttribute(
          'src',
          /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/,
        );
        await expect(f).toHaveAttribute('sandbox', /allow-scripts/);
      });
    });

    test.describe('heading below', () => {
      test.use({ baseURL: 'http://vidb.localhost:4321' });
      test('heading follows the player', async ({ page }) => {
        await page.goto('/bn/');
        const heading = await page.locator('.ve-h').boundingBox();
        const box = await page.locator('.ve-box').boundingBox();
        expect(heading!.y).toBeGreaterThan(box!.y);
      });
    });

    test.describe('no id', () => {
      test.use({ baseURL: 'http://vidx.localhost:4321' });
      test('renders nothing', async ({ page }) => {
        await page.goto('/bn/');
        await expect(page.locator('#video')).toHaveCount(0);
      });
    });
  });
}

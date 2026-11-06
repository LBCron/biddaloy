import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__/basic';
const NOTICES = [
  { id: '1', title: { bn: 'পরীক্ষার নোটিশ', en: 'Exam notice' }, date: '2026-11-15' },
];

async function stubIsland(page: Page) {
  await page.route('**/_api/island/notices', (r) => r.fulfill({ json: NOTICES }));
}
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const [name, size] of [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
] as const) {
  test(`home renders at ${name}: no overflow, hero, sections in config order`, async ({ page }) => {
    await page.setViewportSize(size);
    await stubIsland(page);
    await page.goto('/bn/');
    await expect(page.locator('h1')).toHaveText('ভালো মানুষ হওয়ার শিক্ষা');
    expect(await noOverflow(page)).toBe(true);
    await expect(page.locator('.notice')).toHaveCount(1);
    const ids = await page
      .locator('main section')
      .evaluateAll((els) => els.map((e) => e.id || e.className));
    expect(ids).toEqual(['hero', 'about', 'news', 'teachers']);
    await page.screenshot({ path: `${SHOTS}/home-${name}.png`, fullPage: true });
  });
}

test('marquee pauses on hover; carousel advances; disabled item hidden', async ({ page }) => {
  await stubIsland(page);
  await page.goto('/bn/');
  const track = page.locator('.ann-track');
  await expect(track).toHaveCSS('animation-play-state', 'running');
  await page.locator('.ann').hover();
  await expect(track).toHaveCSS('animation-play-state', 'paused');
  await expect(page.locator('.ann-set').first().locator('li')).toHaveCount(2);
  await page.locator('.hc-next').click();
  await expect(page.locator('.hc-dots button').nth(1)).toHaveAttribute('aria-current', 'true');
});

test('/en/ shows English and falls back to Bangla where English is empty', async ({ page }) => {
  await stubIsland(page);
  await page.goto('/en/');
  await expect(page.locator('h1')).toHaveText('Education that builds good people');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.hero .lead')).toHaveText('বাংলা ট্যাগলাইন');
  await expect(page.locator('#about p')).toHaveText('বাংলা বিবরণ');
  await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute(
    'href',
    'https://ok.localhost/bn/',
  );
});

test('unknown host shows the 404 page', async ({ page }) => {
  const res = await page.goto('http://nope.localhost:4321/bn/');
  expect(res?.status()).toBe(404);
  await expect(page.locator('h1')).toContainText('এখানে কোনো সাইট নেই');
});

test('API 500 shows the 503 page with Retry-After', async ({ page }) => {
  const res = await page.goto('http://down.localhost:4321/bn/');
  expect(res?.status()).toBe(503);
  expect(res?.headers()['retry-after']).toBe('60');
  await expect(page.locator('h1')).toContainText('কিছুক্ষণ পর আবার চেষ্টা করুন');
});

test('/ redirects to /bn/ and a bad language segment is 404', async ({ page }) => {
  await stubIsland(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/bn\/$/);
  expect((await page.goto('/fr/'))?.status()).toBe(404);
});

test('preview header renders demo content with noindex', async ({ page }) => {
  await stubIsland(page);
  await page.setExtraHTTPHeaders({ 'x-site-preview': 'basic' });
  const res = await page.goto('http://nope.localhost:4321/bn/');
  expect(res?.status()).toBe(200);
  expect(res?.headers()['x-robots-tag']).toBe('noindex');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('h1')).toBeVisible();
});

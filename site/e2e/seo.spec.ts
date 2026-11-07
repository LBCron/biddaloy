import { expect, test } from '@playwright/test';

// Against the stub by-host API (ok.localhost = fixture site, anything else = unknown host).
test('sitemap lists bn and en alternates', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  expect(xml).toContain('<loc>https://ok.localhost/bn/</loc>');
  expect(xml).toContain('hreflang="en" href="https://ok.localhost/en/"');
});

test('robots allows and points at the sitemap', async ({ request }) => {
  const body = await (await request.get('/robots.txt')).text();
  expect(body).toContain('Sitemap: https://ok.localhost/sitemap.xml');
});

test('og card is a 1200x630 png', async ({ request }) => {
  const res = await request.get('/og/home.png');
  expect(res.headers()['content-type']).toBe('image/png');
  const buf = await res.body();
  expect(buf.readUInt32BE(16)).toBe(1200);
  expect(buf.readUInt32BE(20)).toBe(630);
});

test('home carries parseable school JSON-LD', async ({ page }) => {
  await page.goto('/bn/');
  const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(JSON.parse(raw!)['@type']).toBe('EducationalOrganization');
});

test('unknown host: sitemap 404 body equals the page 404 body', async ({ request }) => {
  const base = 'http://nope.localhost:4321';
  const a = await request.get(`${base}/sitemap.xml`);
  const b = await request.get(`${base}/bn/about/`);
  expect(a.status()).toBe(404);
  expect(await a.text()).toBe(await b.text());
});

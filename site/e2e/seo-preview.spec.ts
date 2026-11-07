import { expect, test } from '@playwright/test';

// Header preview: noindex everywhere, only robots.txt answers, unknown theme names are a 404.
const PREVIEW = { 'X-Site-Preview': 'primary' };

test('preview: robots.txt disallows all; sitemap, feed and card are 404', async ({ request }) => {
  const robots = await request.get('/robots.txt', { headers: PREVIEW });
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
  for (const path of ['/sitemap.xml', '/feed.xml', '/og/home.png']) {
    expect((await request.get(path, { headers: PREVIEW })).status()).toBe(404);
  }
});

test('preview: prototype keys are not themes (404, never 500)', async ({ request }) => {
  for (const theme of ['constructor', '__proto__', 'toString']) {
    const res = await request.get('/bn/', { headers: { 'X-Site-Preview': theme } });
    expect(res.status()).toBe(404);
  }
});

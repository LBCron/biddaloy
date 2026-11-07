import { http, HttpResponse } from 'msw';

import type { WebsiteConfig } from '../../../hooks/use-website';

const site = (overrides: Partial<WebsiteConfig> = {}): WebsiteConfig => ({
  theme: 'basic',
  palette: 'green',
  enabled: false,
  noindex: false,
  subdomain: 'demo-school',
  version: 1,
  draft_revision: 1,
  published_at: null,
  has_published: false,
  draft: {},
  ...overrides,
});

export const websiteDefaultHandlers = [
  http.get('/api/v1/website', () => HttpResponse.json(site())),
  http.get('/api/v1/website/themes', () => HttpResponse.json([])),
  http.put('/api/v1/website/draft', () => HttpResponse.json(site({ draft_revision: 2 }))),
  http.post('/api/v1/website/publish', () =>
    HttpResponse.json(site({ has_published: true, enabled: true })),
  ),
  http.post('/api/v1/website/enabled', async ({ request }) =>
    HttpResponse.json(site({ enabled: ((await request.json()) as { enabled: boolean }).enabled })),
  ),
  http.get('/api/v1/website/subdomain/check', () => HttpResponse.json({ available: true })),
  http.get('/api/v1/website/subdomain/suggest', () =>
    HttpResponse.json(['demo-school', 'demo-school-bd']),
  ),
  http.put('/api/v1/website/subdomain', () => HttpResponse.json(site())),
  http.get('/api/v1/website/preview-token', () =>
    HttpResponse.json({ url: 'https://demo-school.example.test/?preview=t' }),
  ),
  http.get('/api/v1/website/media', () =>
    HttpResponse.json({ items: [], usedBytes: 0, quotaBytes: 100 * 1024 * 1024 }),
  ),
  http.post('/api/v1/website/media', () => HttpResponse.json({ id: 'media-1' })),
  http.delete('/api/v1/website/media/:id', () => new HttpResponse(null, { status: 204 })),
];

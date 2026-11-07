import { http, HttpResponse } from 'msw';

import type { WebsiteConfig } from '../../../hooks/use-website';
import type { SitePost } from '../../../hooks/use-website-content';

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
  has_unpublished_changes: true,
  draft: {},
  ...overrides,
});

const post: SitePost = {
  id: 'post-1',
  kind: 'POST',
  slug: 'first-post',
  title: { bn: 'প্রথম পোস্ট', en: 'First post' },
  body: [{ type: 'paragraph', children: [{ text: '' }] }],
  published_at: null,
  updated_at: '2026-01-01T00:00:00.000Z',
};

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
    HttpResponse.json({ suggestions: ['demo-school', 'demo-school-bd'] }),
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
  http.get('/api/v1/website/posts', () => HttpResponse.json([])),
  http.get('/api/v1/website/posts/:id', ({ params }) =>
    HttpResponse.json({ ...post, id: String(params['id']) }),
  ),
  http.post('/api/v1/website/posts', () => HttpResponse.json(post)),
  http.put('/api/v1/website/posts/:id', () => HttpResponse.json(post)),
  http.delete('/api/v1/website/posts/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/v1/website/posts/:id/publish', () =>
    HttpResponse.json({ ...post, published_at: '2026-01-01T00:00:00.000Z' }),
  ),
  http.post('/api/v1/website/posts/:id/unpublish', () => HttpResponse.json(post)),
  http.get('/api/v1/website/enquiries', () =>
    HttpResponse.json({ items: [], total: 0, page: 1, limit: 20 }),
  ),
  http.post('/api/v1/website/enquiries/:id/seen', () => new HttpResponse(null, { status: 204 })),
  http.delete('/api/v1/website/enquiries/:id', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/v1/website/teachers', () => HttpResponse.json([])),
  http.put('/api/v1/website/teachers/:userId', () =>
    HttpResponse.json({
      user_id: 'u1',
      name: 'Teacher',
      show_on_website: true,
      featured: false,
      subjects: [],
    }),
  ),
];

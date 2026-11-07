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
  cover_media_id: null,
  body: [{ type: 'paragraph', children: [{ text: '' }] }],
  published_at: null,
  updated_at: '2026-01-01T00:00:00.000Z',
};

/** In-memory gallery so component and tab tests need no server. Reset by `resetGalleryMock`. */
type Album = {
  id: string;
  title: { bn: string; en: string };
  sortOrder: number;
  photos: { id: string; mediaId: string; caption: { bn: string; en: string }; sortOrder: number }[];
};
let albums: Album[] = [];
let seq = 0;
export const resetGalleryMock = (seed: Album[] = []) => {
  albums = seed;
  seq = 0;
};
const renumber = (a: Album) => {
  a.photos.forEach((p, i) => (p.sortOrder = i));
  return a;
};
const reorder = <T extends { id: string; sortOrder: number }>(list: T[], ids: string[]) =>
  ids.map((id, i) => ({ ...list.find((x) => x.id === id)!, sortOrder: i }));

const galleryHandlers = [
  http.get('/api/v1/website/gallery/albums', () => HttpResponse.json(albums)),
  http.post('/api/v1/website/gallery/albums', async ({ request }) => {
    const { title } = (await request.json()) as { title: Record<string, string> };
    const album: Album = {
      id: `album-${++seq}`,
      title: { bn: title.bn ?? '', en: title.en ?? '' },
      sortOrder: albums.length,
      photos: [],
    };
    albums.push(album);
    return HttpResponse.json(album);
  }),
  http.put('/api/v1/website/gallery/albums/order', async ({ request }) => {
    albums = reorder(albums, ((await request.json()) as { ids: string[] }).ids);
    return HttpResponse.json(albums);
  }),
  http.patch('/api/v1/website/gallery/albums/:id', async ({ params, request }) => {
    const album = albums.find((a) => a.id === params.id);
    if (!album) return HttpResponse.json({ statusCode: 404 }, { status: 404 });
    const { title } = (await request.json()) as { title: Record<string, string> };
    album.title = { bn: title.bn ?? '', en: title.en ?? '' };
    return HttpResponse.json(album);
  }),
  http.delete('/api/v1/website/gallery/albums/:id', ({ params }) => {
    albums = albums.filter((a) => a.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('/api/v1/website/gallery/albums/:id/photos', ({ params }) => {
    const album = albums.find((a) => a.id === params.id);
    if (!album) return HttpResponse.json({ statusCode: 404 }, { status: 404 });
    const photo = {
      id: `photo-${++seq}`,
      mediaId: `media-${seq}`,
      caption: { bn: '', en: '' },
      sortOrder: album.photos.length,
    };
    album.photos.push(photo);
    return HttpResponse.json(photo);
  }),
  http.put('/api/v1/website/gallery/albums/:id/photos/order', async ({ params, request }) => {
    const album = albums.find((a) => a.id === params.id);
    if (!album) return HttpResponse.json({ statusCode: 404 }, { status: 404 });
    album.photos = reorder(album.photos, ((await request.json()) as { ids: string[] }).ids);
    return HttpResponse.json(renumber(album));
  }),
  http.patch('/api/v1/website/gallery/photos/:id', async ({ params, request }) => {
    const photo = albums.flatMap((a) => a.photos).find((p) => p.id === params.id);
    if (!photo) return HttpResponse.json({ statusCode: 404 }, { status: 404 });
    const { caption } = (await request.json()) as { caption: Record<string, string> | null };
    photo.caption = { bn: caption?.bn ?? '', en: caption?.en ?? '' };
    return HttpResponse.json(photo);
  }),
  http.delete('/api/v1/website/gallery/photos/:id', ({ params }) => {
    albums.forEach((a) => (a.photos = a.photos.filter((p) => p.id !== params.id)));
    return new HttpResponse(null, { status: 204 });
  }),
];

export const websiteDefaultHandlers = [
  ...galleryHandlers,
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
  http.get('/api/v1/website/posts', () => HttpResponse.json({ items: [], total: 0 })),
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
    HttpResponse.json({ items: [], total: 0, unseen: 0 }),
  ),
  http.post('/api/v1/website/enquiries/:id/seen', () => new HttpResponse(null, { status: 204 })),
  http.delete('/api/v1/website/enquiries/:id', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/v1/website/teachers', () => HttpResponse.json([])),
  http.put('/api/v1/website/teachers/:userId', () =>
    HttpResponse.json({
      user_id: 'u1',
      full_name: 'Teacher',
      role: 'TEACHER',
      show_on_website: true,
      featured: false,
      sort_order: 0,
      subjects: [],
      bio: null,
      credentials: null,
      photo_media_id: null,
    }),
  ),
];

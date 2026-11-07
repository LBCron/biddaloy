import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  useCaptionGalleryPhoto,
  useCreateGalleryAlbum,
  useDeleteGalleryAlbum,
  useDeleteGalleryPhoto,
  useGalleryAlbums,
  useRenameGalleryAlbum,
  useReorderGalleryAlbums,
  useReorderGalleryPhotos,
  useUploadGalleryPhoto,
} from './use-website-gallery';

const B = '/api/v1/website/gallery';
const fail = () => HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 });
const opts = { tenantId: 't1' };
const photo = { id: 'p1', mediaId: 'm1', caption: { bn: '', en: '' }, sortOrder: 0 };
const album = { id: 'a1', title: { bn: 'ক', en: '' }, sortOrder: 0, photos: [] };

type Mut = { mutate: (v: unknown) => void; isError: boolean; isSuccess: boolean };

const cases: [string, 'post' | 'put' | 'patch' | 'delete', string, () => unknown, unknown][] = [
  ['create album', 'post', `${B}/albums`, () => useCreateGalleryAlbum(), { title: { bn: 'ক' } }],
  [
    'rename album',
    'patch',
    `${B}/albums/a1`,
    () => useRenameGalleryAlbum(),
    { id: 'a1', title: { bn: 'খ' } },
  ],
  ['delete album', 'delete', `${B}/albums/a1`, () => useDeleteGalleryAlbum(), 'a1'],
  ['reorder albums', 'put', `${B}/albums/order`, () => useReorderGalleryAlbums(), ['a2', 'a1']],
  [
    'reorder photos',
    'put',
    `${B}/albums/a1/photos/order`,
    () => useReorderGalleryPhotos('a1'),
    ['p2', 'p1'],
  ],
  [
    'caption photo',
    'patch',
    `${B}/photos/p1`,
    () => useCaptionGalleryPhoto(),
    { id: 'p1', caption: { bn: 'ক', en: 'a' } },
  ],
  ['delete photo', 'delete', `${B}/photos/p1`, () => useDeleteGalleryPhoto(), 'p1'],
  [
    'upload photo',
    'post',
    `${B}/albums/a1/photos`,
    () => useUploadGalleryPhoto('a1'),
    new Blob(['x'], { type: 'image/webp' }),
  ],
];

describe('gallery mutations', () => {
  it.each(cases)('%s is not retried on failure', async (_n, method, url, hook, arg) => {
    let calls = 0;
    server.use(
      http[method](url, () => {
        calls += 1;
        return fail();
      }),
    );
    const { result } = renderHookWithProviders(hook as () => Mut, opts);
    result.current.mutate(arg);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });

  it('create album sends the title and an Idempotency-Key', async () => {
    let body: unknown;
    let key: string | null = null;
    server.use(
      http.post(`${B}/albums`, async ({ request }) => {
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json(album);
      }),
    );
    const { result } = renderHookWithProviders(() => useCreateGalleryAlbum(), opts);
    result.current.mutate({ title: { bn: 'ক', en: '' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ title: { bn: 'ক', en: '' } });
    expect(key).toBeTruthy();
  });

  it('reorder sends the complete id list as { ids }', async () => {
    let body: unknown;
    server.use(
      http.put(`${B}/albums/order`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHookWithProviders(() => useReorderGalleryAlbums(), opts);
    result.current.mutate(['a2', 'a1']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(body).toEqual({ ids: ['a2', 'a1'] });
  });

  it('upload posts multipart, keeps its key after a failure and rotates it on success', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post(`${B}/albums/a1/photos`, ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        expect(request.headers.get('Content-Type')).toMatch(/multipart\/form-data/);
        return keys.length === 1 ? fail() : HttpResponse.json(photo);
      }),
    );
    const blob = new Blob(['x'], { type: 'image/webp' });
    const { result } = renderHookWithProviders(() => useUploadGalleryPhoto('a1'), opts);
    result.current.mutate(blob);
    await waitFor(() => expect(result.current.isError).toBe(true));
    result.current.mutate(blob);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    result.current.mutate(blob);
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('upload and delete refresh the media (usage) query', async () => {
    server.use(
      http.post(`${B}/albums/a1/photos`, () => HttpResponse.json(photo)),
      http.delete(`${B}/photos/p1`, () => new HttpResponse(null, { status: 204 })),
    );
    const { result, queryClient } = renderHookWithProviders(
      () => ({ up: useUploadGalleryPhoto('a1'), del: useDeleteGalleryPhoto() }),
      opts,
    );
    const hits: string[] = [];
    const orig = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = ((f: { queryKey?: unknown }) => {
      hits.push(JSON.stringify(f?.queryKey));
      return orig(f as never);
    }) as never;
    result.current.up.mutate(new Blob(['x'], { type: 'image/webp' }));
    await waitFor(() => expect(result.current.up.isSuccess).toBe(true));
    result.current.del.mutate('p1');
    await waitFor(() => expect(result.current.del.isSuccess).toBe(true));
    expect(hits.filter((k) => k === '["website","media"]')).toHaveLength(2);
  });
});

describe('useGalleryAlbums', () => {
  it('reads the album list', async () => {
    server.use(http.get(`${B}/albums`, () => HttpResponse.json([album])));
    const { result } = renderHookWithProviders(() => useGalleryAlbums(), opts);
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });
});

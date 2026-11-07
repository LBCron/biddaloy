import { UserRole } from '@biddaloy/shared';
import { toast } from '@biddaloy/ui/components';
import {
  apiErrorBody,
  cleanupTestState,
  renderWithRouter,
  server,
  userEvent,
} from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { mockWebsite } from './-test-handlers';

type Photo = {
  id: string;
  mediaId: string;
  caption: { bn: string; en: string };
  sortOrder: number;
};
type Album = {
  id: string;
  title: { bn: string; en: string };
  sortOrder: number;
  photos: Photo[];
};

const photo = (n: number, caption = ''): Photo => ({
  id: `p${n}`,
  mediaId: `m${n}`,
  caption: { bn: caption, en: '' },
  sortOrder: n - 1,
});
const album = (n: number, photos: Photo[] = []): Album => ({
  id: `a${n}`,
  title: { bn: `বিভাগ ${n}`, en: '' },
  sortOrder: n - 1,
  photos,
});

/** In-memory gallery routes; `log` records every write as `METHOD path body`. */
function mockGallery(initial: Album[]) {
  let albums = initial;
  const log: string[] = [];
  const tenants: (string | null)[] = [];
  const note = (r: Request, body?: unknown) =>
    log.push(
      `${r.method} ${new URL(r.url).pathname.replace('/api/v1/website/gallery', '')}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`,
    );
  mockWebsite();
  server.use(
    http.get('/api/v1/website/gallery/albums', ({ request }) => {
      tenants.push(request.headers.get('X-Tenant-ID'));
      return HttpResponse.json(albums);
    }),
    http.post('/api/v1/website/gallery/albums', async ({ request }) => {
      const body = (await request.json()) as { title: { bn?: string; en?: string } };
      note(request, body);
      const created = album(albums.length + 1);
      albums = [...albums, created];
      return HttpResponse.json(created);
    }),
    http.put('/api/v1/website/gallery/albums/order', async ({ request }) => {
      const { ids } = (await request.json()) as { ids: string[] };
      note(request, { ids });
      albums = ids.map((id, i) => ({ ...albums.find((a) => a.id === id)!, sortOrder: i }));
      return HttpResponse.json(albums);
    }),
    http.delete('/api/v1/website/gallery/albums/:id', ({ params, request }) => {
      note(request);
      albums = albums.filter((a) => a.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/v1/website/gallery/albums/:id/photos', ({ params, request }) => {
      note(request);
      const target = albums.find((a) => a.id === params.id)!;
      const added = photo(target.photos.length + 1 + 100);
      albums = albums.map((a) => (a.id === target.id ? { ...a, photos: [...a.photos, added] } : a));
      return HttpResponse.json(added);
    }),
    http.put('/api/v1/website/gallery/albums/:id/photos/order', async ({ params, request }) => {
      const { ids } = (await request.json()) as { ids: string[] };
      note(request, { ids });
      const target = albums.find((a) => a.id === params.id)!;
      const photos = ids.map((id, i) => ({
        ...target.photos.find((p) => p.id === id)!,
        sortOrder: i,
      }));
      albums = albums.map((a) => (a.id === target.id ? { ...a, photos } : a));
      return HttpResponse.json({ ...target, photos });
    }),
    http.patch('/api/v1/website/gallery/photos/:id', async ({ params, request }) => {
      const body = (await request.json()) as { caption: { bn: string; en: string } | null };
      note(request, body);
      albums = albums.map((a) => ({
        ...a,
        photos: a.photos.map((p) =>
          p.id === params.id ? { ...p, caption: body.caption ?? { bn: '', en: '' } } : p,
        ),
      }));
      return HttpResponse.json({ id: params.id });
    }),
    http.delete('/api/v1/website/gallery/photos/:id', ({ params, request }) => {
      note(request);
      albums = albums.map((a) => ({ ...a, photos: a.photos.filter((p) => p.id !== params.id) }));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { log, tenants };
}

const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/website/gallery'],
    tenantId: 'tenant-1',
    role: UserRole.ADMIN,
    locale: 'en',
  });

describe('Website › Gallery', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the empty state and the new-section button; creating one shows a card', async () => {
    const { log } = mockGallery([]);
    render();
    expect(await screen.findByText(/No photos yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'New gallery section' }));
    expect(await screen.findByLabelText(/^Gallery section name \(বাংলা\)/)).toBeTruthy();
    expect(log[0]).toMatch(/^POST \/albums \{"title":\{"bn":"","en":"Gallery section 1"\}\}$/);
  });

  it('sends the tenant header on every call', async () => {
    const { tenants } = mockGallery([album(1)]);
    render();
    await screen.findByLabelText(/^Gallery section name \(বাংলা\)/);
    expect(tenants.length).toBeGreaterThan(0);
    expect(tenants.every((t) => t === 'tenant-1')).toBe(true);
  });

  it('disables the new-section button at the 20th section and says why', async () => {
    mockGallery(Array.from({ length: 20 }, (_, i) => album(i + 1)));
    render();
    const button = await screen.findByRole('button', { name: 'New gallery section' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/most gallery sections/)).toBeTruthy();
  });

  it('reorders sections with the complete id list', async () => {
    const { log } = mockGallery([album(1), album(2), album(3)]);
    render();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Move gallery section বিভাগ 3 up, place 3' }),
    );
    await waitFor(() => expect(log).toContain('PUT /albums/order {"ids":["a1","a3","a2"]}'));
  });

  it('asks once before deleting a section and names the photo count', async () => {
    const { log } = mockGallery([album(1, [photo(1), photo(2), photo(3)])]);
    render();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete this gallery section' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/its 3 photos will be removed/)).toBeTruthy();
    expect(log.filter((l) => l.startsWith('DELETE'))).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete section' }));
    await waitFor(() => expect(log).toContain('DELETE /albums/a1'));
  });

  it('saves a caption when focus leaves the pair, and reorders photos with the full list', async () => {
    const { log } = mockGallery([album(1, [photo(1), photo(2)])]);
    render();
    const caption = await screen.findByLabelText('Caption, photo 1 (বাংলা)');
    await userEvent.type(caption, 'প্রধান ফটক');
    await userEvent.tab();
    await userEvent.tab();
    await waitFor(() =>
      expect(log.find((l) => l.startsWith('PATCH /photos/p1'))).toBe(
        'PATCH /photos/p1 {"caption":{"bn":"প্রধান ফটক","en":""}}',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move photo 2 up' }));
    await waitFor(() => expect(log).toContain('PUT /albums/a1/photos/order {"ids":["p2","p1"]}'));
  });

  it('shows one fixed sentence when a delete fails, never the server text', async () => {
    mockGallery([album(1, [photo(1)])]);
    server.use(
      http.delete('/api/v1/website/gallery/photos/:id', () =>
        HttpResponse.json(apiErrorBody(409, 'site.media_in_use', '/photos/p1'), { status: 409 }),
      ),
    );
    const error = vi.spyOn(toast, 'error');
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete photo 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    const text = error.mock.calls[0]![0];
    expect(text).toMatch(/shown on your website now/);
    expect(text).not.toMatch(/site\.media_in_use/);
  });
});

describe('Website › Gallery upload', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 4000;
        naturalHeight = 3000;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type) =>
      cb(new Blob(['x'], { type: type ?? 'image/png' })),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('uploads through the card and the grid shows the new photo', async () => {
    const { log } = mockGallery([album(1)]);
    render();
    await screen.findByLabelText(/^Gallery section name \(বাংলা\)/);
    fireEvent.change(screen.getByTestId('gallery-files'), {
      target: { files: [new File(['x'], 'gate.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(log).toContain('POST /albums/a1/photos'));
    expect(await screen.findByLabelText('Caption, photo 1 (বাংলা)')).toBeTruthy();
  });
});

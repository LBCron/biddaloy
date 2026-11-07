import { renderWithProviders, server, userEvent } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { GallerySectionCard } from './-gallery-section-card';

// The server returns `caption: null` for a photo uploaded without a caption.
const photo = (n: number, caption: { bn: string; en: string } | null = { bn: '', en: '' }) => ({
  id: `p${n}`,
  mediaId: `m${n}`,
  caption,
  sortOrder: n - 1,
});
const album = (photos: ReturnType<typeof photo>[]) => ({
  id: 'a1',
  title: { bn: 'অনুষ্ঠান', en: 'Events' },
  sortOrder: 0,
  photos,
});

const props = (photos: ReturnType<typeof photo>[]) => ({
  album: album(photos),
  index: 0,
  count: 1,
  imageUrl: (id: string) => `https://school.example.test/media/${id}`,
  usedBytes: 0,
  quotaBytes: 100,
  onMove: vi.fn(),
  onDelete: vi.fn(),
});

const render = (photos: ReturnType<typeof photo>[]) =>
  renderWithProviders(<GallerySectionCard {...props(photos)} />, {
    tenantId: 'tenant-1',
    locale: 'en',
  });

describe('GallerySectionCard', () => {
  it('tells the uploader how many photos still fit (60 minus the photos here)', async () => {
    render(Array.from({ length: 60 }, (_, i) => photo(i + 1)));
    // 60 of 60: nothing more fits, so the drop area is off.
    const drop = await screen.findByRole('button', { name: /Choose photos/ });
    expect(drop.hasAttribute('disabled')).toBe(true);
  });

  it('keeps the drop area on while there is room', async () => {
    render([photo(1), photo(2)]);
    const drop = await screen.findByRole('button', { name: /Choose photos/ });
    expect(drop.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('2 photos')).toBeTruthy();
  });

  it('asks inline before deleting a photo, and Keep cancels without a call', async () => {
    const calls: string[] = [];
    server.use(
      http.delete('/api/v1/website/gallery/photos/:id', ({ params }) => {
        calls.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render([photo(1), photo(2)]);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete photo 2' }));
    expect(screen.getByText('Delete this photo?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText('Delete this photo?')).toBeNull();
    expect(calls).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Delete photo 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls).toEqual(['p2']));
  });

  it('shows the stored photo from the site address, with no token in it', async () => {
    render([photo(1)]);
    await screen.findByRole('heading');
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://school.example.test/media/m1');
  });

  it('a photo with no caption (caption: null) renders and does not crash the tab', async () => {
    render([photo(1, null), photo(2, { bn: 'ছবি', en: 'Picture' })]);
    await screen.findByRole('heading');
    expect(document.querySelectorAll('img')).toHaveLength(2);
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });

  it('a long caption is cut at 120 characters before it is sent', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch('/api/v1/website/gallery/photos/:id', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(photo(1));
      }),
    );
    render([photo(1)]);
    const field = await screen.findByLabelText(/^Caption, photo 1 \(বাংলা\)/);
    fireEvent.change(field, { target: { value: 'ক'.repeat(150) } });
    fireEvent.blur(field);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0] as { caption: { bn: string } }).caption.bn).toHaveLength(120);
  });
});

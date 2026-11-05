import '@biddaloy/ui/test';

import { cleanupTestState, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderPortalCard } from '../../../routes/portal/-card-test-utils';

import { LatestNoticesCard } from './latest-notices-card';
import { MyNoticePage } from './my-notice-detail';
import { MyNoticesList } from './my-notices-list';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/;

function item(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Winter break',
    important: false,
    pinned: false,
    published_at: '2026-11-20T04:00:00.000Z',
    expires_on: null,
    edited: false,
    seen: false,
    acknowledged: false,
    forStudents: [],
    ...over,
  };
}

function mockList(rows: ReturnType<typeof item>[]) {
  const tabs: (string | null)[] = [];
  server.use(
    http.get('/api/v1/notices/mine', ({ request }) => {
      tabs.push(new URL(request.url).searchParams.get('tab'));
      return HttpResponse.json({ data: rows, total: rows.length, page: 1, limit: 20 });
    }),
  );
  return tabs;
}

function mockDetail(over: Record<string, unknown> = {}) {
  let detailCalls = 0;
  let acked = false;
  server.use(
    http.get('/api/v1/notices/mine/:id', () => {
      detailCalls += 1;
      return HttpResponse.json({
        ...item({ important: true, acknowledged: acked, ...over }),
        body: 'School is closed.\nSee you in January.',
        files: [],
      });
    }),
    http.post('/api/v1/notices/mine/:id/acknowledge', () => {
      acked = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { calls: () => detailCalls };
}

describe('MyNoticesList', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('loads the current tab, then the archive tab', async () => {
    const tabs = mockList([item()]);
    renderPortalCard(<MyNoticesList />);
    expect(await screen.findByText('Winter break')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Archive' }));
    await waitFor(() => expect(tabs).toContain('archive'));
    expect(tabs[0]).toBe('current');
  });

  it('shows the important and edited tags as the shared StatusBadge', async () => {
    mockList([item({ important: true, edited: true })]);
    const { container } = renderPortalCard(<MyNoticesList />);
    await screen.findAllByText('Important');
    const badges = [...container.querySelectorAll('[data-slot="status-badge"]')];
    const tone = (label: string) =>
      badges.find((b) => b.textContent === label)?.getAttribute('data-tone');
    expect(tone('Important')).toBe('danger');
    expect(tone('Edited')).toBe('neutral');
  });

  it('shows the guardian child line and never a UUID', async () => {
    mockList([item({ forStudents: ['Rahim, 6 A'] })]);
    const { container } = renderPortalCard(<MyNoticesList />);
    expect(await screen.findByText('For Rahim, 6 A')).toBeTruthy();
    expect(container.textContent).not.toMatch(UUID);
  });

  it('opening a row calls the detail (seen); acknowledge shows only when needed and hides after', async () => {
    mockList([item({ important: true })]);
    const detail = mockDetail();
    renderPortalCard(<MyNoticesList />);
    await userEvent.click(await screen.findByRole('button', { name: 'Winter break' }));
    const ack = await screen.findByRole('button', { name: 'I have read this' });
    expect(detail.calls()).toBe(1);
    await userEvent.click(ack);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'I have read this' })).toBeNull(),
    );
  });

  it('a plain notice has no acknowledge button', async () => {
    mockList([item()]);
    mockDetail({ important: false });
    renderPortalCard(<MyNoticesList />);
    await userEvent.click(await screen.findByRole('button', { name: 'Winter break' }));
    await screen.findByText(/School is closed/);
    expect(screen.queryByRole('button', { name: 'I have read this' })).toBeNull();
  });

  it('a PDF opens its tab in the click itself, then points it at the blob (Safari keeps the popup)', async () => {
    const PDF = {
      id: '22222222-2222-4222-8222-222222222222',
      original_name: 'Routine.pdf',
      mime_type: 'application/pdf',
      size_bytes: 10,
    };
    mockList([item()]);
    // A held response: the file stays "downloading" until release(), which the handler sets.
    let release: (() => void) | undefined;
    server.use(
      http.get('/api/v1/notices/mine/:id', () =>
        HttpResponse.json({ ...item(), body: 'See the file.', files: [PDF] }),
      ),
      http.get('/api/v1/notices/:id/files/:fileId', async () => {
        await new Promise<void>((r) => (release = r));
        return new HttpResponse(new Blob(['%PDF']), {
          headers: { 'Content-Type': 'application/pdf' },
        });
      }),
    );
    const popup = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    // Fake object URLs for this test only (URL itself stays a constructor).
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      renderPortalCard(<MyNoticesList />);
      await userEvent.click(await screen.findByRole('button', { name: 'Winter break' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Open Routine.pdf' }));
      // Opened before the file arrived, with the opener cut.
      expect(open).toHaveBeenCalledWith('', '_blank');
      expect(popup.opener).toBeNull();
      expect(popup.location.href).toBe('');
      await waitFor(() => expect(release).toBeDefined());
      release?.();
      await waitFor(() => expect(popup.location.href).toBe('blob:pdf'));
      expect(popup.close).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      create.mockRestore();
      revoke.mockRestore();
    }
  });

  it('empty current tab says so', async () => {
    mockList([]);
    renderPortalCard(<MyNoticesList />);
    expect(await screen.findByText('No current notices')).toBeTruthy();
  });
});

describe('MyNoticePage (/portal/notices/<id>)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('the page h1 is the notice title, shown once, with a link back to the list (#3438)', async () => {
    const detail = mockDetail();
    renderPortalCard(<MyNoticePage id="11111111-1111-4111-8111-111111111111" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Winter break' })).toBeTruthy();
    await screen.findByText(/School is closed/);
    expect(screen.getAllByRole('heading', { name: 'Winter break' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Notices' }).getAttribute('href')).toBe(
      '/portal/notices',
    );
    expect(detail.calls()).toBe(1); // the page title and the body share one "seen" read
  });
});

describe('LatestNoticesCard (portal Overview)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('a row opens its notice and "All notices" opens the list, both through the router (#3437)', async () => {
    mockList([item()]);
    const { router } = renderPortalCard(<LatestNoticesCard variant="full" portalLinks />);
    const row = await screen.findByRole('link', { name: /Winter break/ });
    expect(screen.getByRole('link', { name: 'All notices' }).getAttribute('href')).toBe(
      '/portal/notices',
    );
    await userEvent.click(row);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/portal/notices/11111111-1111-4111-8111-111111111111',
      ),
    );
  });
});

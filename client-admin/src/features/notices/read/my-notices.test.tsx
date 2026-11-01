import '@biddaloy/ui/test';

import { cleanupTestState, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { renderPortalCard } from '../../../routes/portal/-card-test-utils';

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

  it('empty current tab says so', async () => {
    mockList([]);
    renderPortalCard(<MyNoticesList />);
    expect(await screen.findByText('No current notices')).toBeTruthy();
  });
});

/** [53.3.g1.01] Staff notice list: rows, empty and error states, withdraw asks first, no retry. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { NoticeList } from './notice-list';

const notice = (over: Record<string, unknown>) => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Exam routine',
  status: 'PUBLISHED',
  important: false,
  pinned: false,
  isPublic: false,
  expiresOn: null,
  authorUserId: '22222222-2222-4222-8222-222222222222',
  authorName: 'Karim',
  publishedAt: '2026-10-09T05:00:00.000Z',
  editedAt: null,
  withdrawnAt: null,
  smsStatus: 'NONE',
  recipientCount: 4,
  seenCount: 3,
  createdAt: '2026-10-08T05:00:00.000Z',
  ...over,
});

function renderList() {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    validateSearch: (s: Record<string, unknown>) => s,
    component: NoticeList,
  });
  return renderWithRouter(root.addChildren([index]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('NoticeList', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders rows with "seen 3 of 4" and withdraws only after confirming', async () => {
    const user = userEvent.setup();
    let withdrawn = '';
    server.use(
      http.get('*/notices', () =>
        HttpResponse.json({
          items: [
            notice({}),
            notice({
              id: '33333333-3333-4333-8333-333333333333',
              title: 'Old draft',
              status: 'DRAFT',
              publishedAt: null,
            }),
          ],
          total: 2,
          page: 1,
          limit: 25,
        }),
      ),
      http.post('*/notices/:id/withdraw', ({ params }) => {
        withdrawn = params.id as string;
        return HttpResponse.json(notice({ status: 'WITHDRAWN' }));
      }),
    );
    renderList();

    expect(await screen.findByText('Exam routine')).toBeTruthy();
    expect(screen.getAllByText('Old draft').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^[3৩] of [4৪]$/).length).toBeGreaterThan(0);
    // Only the published row can be withdrawn.
    const buttons = screen.getAllByRole('button', { name: 'Withdraw' });
    expect(buttons).toHaveLength(1);

    await user.click(buttons[0]!);
    const dialog = await screen.findByRole('alertdialog');
    expect(withdrawn).toBe('');
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(withdrawn).toBe('11111111-1111-4111-8111-111111111111'));
  });

  it('renders the empty state', async () => {
    server.use(
      http.get('*/notices', () => HttpResponse.json({ items: [], total: 0, page: 1, limit: 25 })),
    );
    renderList();
    expect(await screen.findByText('No notices yet')).toBeTruthy();
  });

  it('renders the error state', async () => {
    server.use(
      http.get('*/notices', () =>
        HttpResponse.json({ statusCode: 400, message: 'bad' }, { status: 400 }),
      ),
    );
    renderList();
    expect(await screen.findByText('Could not load the notices.')).toBeTruthy();
  });

  it('a failed withdraw is asked once: the mutation does not retry', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get('*/notices', () =>
        HttpResponse.json({ items: [notice({})], total: 1, page: 1, limit: 25 }),
      ),
      http.post('*/notices/:id/withdraw', () => {
        calls += 1;
        return HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 });
      }),
    );
    renderList();
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(calls).toBe(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(1);
  });
});

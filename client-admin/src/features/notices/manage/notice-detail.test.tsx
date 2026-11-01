/** [53.3.g1.01] Notice detail: tab in the URL, report counts, names not ids, glossary. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { NoticeDetail } from './notice-detail';

const ID = '11111111-1111-4111-8111-111111111111';

const notice = {
  id: ID,
  title: 'Exam routine',
  body: 'Line one\nLine two',
  status: 'PUBLISHED',
  important: true,
  pinned: false,
  isPublic: true,
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
};

const report = {
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      kind: 'GUARDIAN',
      name: 'Rahim Uddin',
      forStudent: 'Sumi, 6 A',
      hasLogin: true,
      seenAt: '2026-10-09T06:00:00.000Z',
      linkOpenedAt: null,
      acknowledgedAt: null,
      unreachable: false,
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
  totals: { people: 4, seen: 3, linkOpened: 1, acknowledged: 2, unreachable: 1 },
};

const NEVER_SAY =
  /\b(announcement|audience|recipients?|payload|severity|priority|acknowledge|private|visibility|revoke|soft delete|invalidate)\b/i;

function renderDetail() {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => <NoticeDetail noticeId={ID} />,
  });
  return renderWithRouter(root.addChildren([index]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('NoticeDetail', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('switches tabs, keeps the tab in the URL, shows counts and names only', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`*/notices/${ID}`, () => HttpResponse.json(notice)),
      http.get(`*/notices/${ID}/report`, () => HttpResponse.json(report)),
    );
    const { router, container } = renderDetail();

    expect(await screen.findByText(/Line one/)).toBeTruthy();
    expect(container.querySelector('[data-slot="notice-extras"]')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Who has read it' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: 'report' }));

    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Sumi, 6 A')).toBeTruthy();
    for (const label of ['Total', 'Seen in the app', 'Opened the link', 'Could not be reached']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(await screen.findByText(/^[4৪]$/)).toBeTruthy();

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(NEVER_SAY);
  });

  it('opens straight on the report tab from the URL', async () => {
    server.use(
      http.get(`*/notices/${ID}`, () => HttpResponse.json(notice)),
      http.get(`*/notices/${ID}/report`, () => HttpResponse.json(report)),
    );
    const root = createRootRoute();
    const index = createRoute({
      getParentRoute: () => root,
      path: '/',
      validateSearch: (s: Record<string, unknown>) => s,
      component: () => <NoticeDetail noticeId={ID} />,
    });
    renderWithRouter(root.addChildren([index]), {
      initialEntries: ['/?tab=report'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
  });
});

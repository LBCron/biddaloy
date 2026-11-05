/** [53.6.01] Link panel and SMS status panel on the notice detail. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { NoticeLinkPanel, NoticeSmsPanel } from './notice-link-panel';
import type { Notice } from './use-notices';

const ID = '11111111-1111-4111-8111-111111111111';
const base: Notice = {
  id: ID,
  title: 'Exam routine',
  status: 'PUBLISHED',
  important: false,
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

function renderPanels(notice: Notice, canApprove = true) {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    validateSearch: (s: Record<string, unknown>) => s,
    component: () => (
      <>
        <NoticeLinkPanel notice={notice} />
        <NoticeSmsPanel notice={notice} canApprove={canApprove} />
      </>
    ),
  });
  return renderWithRouter(root.addChildren([index]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('notice link and SMS panels', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('a private notice says only the people it was sent to, with no link buttons', async () => {
    renderPanels({ ...base, isPublic: false });
    expect(await screen.findByText('Only the people it was sent to')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off the link' })).toBeNull();
  });

  it('New link asks first, then shows the new link once, and copy works', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    server.use(
      http.post(`*/notices/${ID}/public-link`, () => {
        calls.push('post');
        return HttpResponse.json({ token: 'tok123' }, { status: 201 });
      }),
    );
    renderPanels(base);

    await user.click(await screen.findByRole('button', { name: 'New link' }));
    expect(calls).toEqual([]); // the dialog asks first
    expect(screen.getByText('The old link stops working', { exact: false })).toBeTruthy();
    const confirm = screen.getAllByRole('button', { name: 'New link' }).at(-1)!;
    // Nothing is deleted, so no trash can (#3487; 21-ui-patterns §5 keeps it for delete).
    expect(confirm.querySelector('.lucide-trash-2')).toBeNull();
    await user.click(confirm);

    const box = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Notice link' });
    expect(box.value).toBe(`${window.location.origin}/n/tok123`);
    expect(calls).toEqual(['post']);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('Turn off the link asks first and then calls DELETE', async () => {
    const user = userEvent.setup();
    let deleted = 0;
    server.use(
      http.delete(`*/notices/${ID}/public-link`, () => {
        deleted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPanels(base);

    await user.click(await screen.findByRole('button', { name: 'Turn off the link' }));
    expect(deleted).toBe(0);
    await user.click(screen.getAllByRole('button', { name: 'Turn off the link' }).at(-1)!);
    await waitFor(() => expect(deleted).toBe(1));
  });

  it('shows the SMS status and asks for an SMS with an idempotency key', async () => {
    const user = userEvent.setup();
    let key: string | null = null;
    server.use(
      http.post(`*/notices/${ID}/sms/request`, ({ request }) => {
        key = request.headers.get('idempotency-key');
        return HttpResponse.json({ ...base, smsStatus: 'PENDING' });
      }),
    );
    renderPanels({ ...base, isPublic: false });

    expect(await screen.findByText('Not asked')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ask for an SMS' }));
    await waitFor(() => expect(key).toBeTruthy());
  });

  it('a waiting request offers the approval page only for an approver', async () => {
    const pending = { ...base, smsStatus: 'PENDING' as const };
    const { unmount } = renderPanels(pending, true);
    expect(await screen.findByText('Waiting')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Look at the SMS' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask for an SMS' })).toBeNull();
    unmount();
    renderPanels(pending, false);
    expect(await screen.findByText('Waiting')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Look at the SMS' })).toBeNull();
  });
});

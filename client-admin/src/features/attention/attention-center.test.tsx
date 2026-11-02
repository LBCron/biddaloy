/** [67.2.04] The shared attention hook: bar, modal, seen, navigation, `?alerts=1`, error state. */
import '@biddaloy/ui/test';

import { AlertCategory, AlertRecipientState, AlertSeverity, AlertSource } from '@biddaloy/shared';
import { NotificationBell } from '@biddaloy/ui/components';
import {
  alertItemFactory,
  attentionSummaryFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { createRootRoute, createRoute, useSearch } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { useAttentionCenter } from './attention-center';

function Layout() {
  const attention = useAttentionCenter({ todoTo: '/notifications' });
  const search = useSearch({ strict: false });
  return (
    <>
      {attention.bar}
      {attention.modal}
      <NotificationBell attention={attention.bell} />
      <output data-testid="search">{JSON.stringify(search)}</output>
    </>
  );
}

function renderCenter(initial = '/') {
  const root = createRootRoute();
  const mk = (path: string) => createRoute({ getParentRoute: () => root, path, component: Layout });
  return renderWithRouter(root.addChildren([mk('/'), mk('/dashboard'), mk('/notifications')]), {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
    accessToken: 'a.b.c',
    initialEntries: [initial],
  });
}

const item = (over = {}) =>
  alertItemFactory({
    recipientId: 'r1',
    title: 'Trial ends soon',
    state: AlertRecipientState.OPEN,
    ...over,
  });

function mockAttention(summary: object, items = [item()]) {
  const calls = { items: [] as string[], seen: [] as unknown[] };
  server.use(
    http.get('*/attention/summary', () => HttpResponse.json(attentionSummaryFactory(summary))),
    http.get('*/attention/items', ({ request }) => {
      calls.items.push(new URL(request.url).search);
      return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
    }),
    http.post('*/attention/items/seen', async ({ request }) => {
      calls.seen.push(await request.json());
      return HttpResponse.json({ updated: items.length });
    }),
  );
  return calls;
}

afterEach(cleanupTestState);

describe('useAttentionCenter', () => {
  it('shows nothing when there are no alerts', async () => {
    mockAttention({ critical: 0, warning: 0, reminder: 0, activeTotal: 0, top: null });
    renderCenter();
    await screen.findByRole('button', { name: 'Notifications' });
    expect(screen.queryByText(/urgent|warning/i)).toBeNull();
  });

  it('bar counts open alerts, bell badge counts active; click opens the modal and reports seen once', async () => {
    const calls = mockAttention({ critical: 1, warning: 2, reminder: 0, activeTotal: 4 });
    renderCenter();
    const bar = await screen.findByRole('button', { name: /1 urgent/i });
    expect((await screen.findByRole('button', { name: /Notifications, 4 need/ })).textContent).toBe(
      '4',
    );
    await userEvent.click(bar);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(calls.items[0]).toContain('tab=active'));
    await waitFor(() => expect(calls.seen).toEqual([{ recipientIds: ['r1'] }]));
  });

  it('Esc closes the dialog and returns focus to the bar button', async () => {
    mockAttention({ critical: 1, warning: 0, reminder: 0, activeTotal: 1 });
    renderCenter();
    const barButton = await screen.findByRole('button', { name: /1 urgent/i });
    await userEvent.click(barButton);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(barButton));
  });

  it('the main action navigates to actionUrl and closes the dialog', async () => {
    mockAttention({ critical: 1, warning: 0, reminder: 0, activeTotal: 1 }, [
      item({ actionUrl: '/dashboard?trial=1', actionLabel: 'See trial' }),
    ]);
    const { router } = renderCenter();
    await userEvent.click(await screen.findByRole('button', { name: /1 urgent/i }));
    await userEvent.click(await screen.findByRole('button', { name: /See trial/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(String((router.state.location.search as Record<string, unknown>).trial)).toBe('1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hiding a closable item posts hide', async () => {
    mockAttention({ critical: 0, warning: 1, reminder: 0, activeTotal: 1 }, [
      item({ severity: AlertSeverity.WARNING, closable: true }),
    ]);
    let hidden = 0;
    server.use(
      http.post('*/attention/items/r1/hide', () => {
        hidden += 1;
        return HttpResponse.json(item({ state: AlertRecipientState.HIDDEN }));
      }),
    );
    renderCenter();
    await userEvent.click(await screen.findByRole('button', { name: /1 warning/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close: Trial ends soon' }));
    await waitFor(() => expect(hidden).toBe(1));
  });

  it('a failed hide shows an error line on that card', async () => {
    mockAttention({ critical: 0, warning: 1, reminder: 0, activeTotal: 1 }, [
      item({ severity: AlertSeverity.WARNING, closable: true }),
    ]);
    server.use(
      http.post('*/attention/items/r1/hide', () => new HttpResponse(null, { status: 500 })),
    );
    renderCenter();
    await userEvent.click(await screen.findByRole('button', { name: /1 warning/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close: Trial ends soon' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That did not work. Try again.');
  });

  it('a failed acknowledge shows on the important card, not on the SMS task of the same notice', async () => {
    const noticeUrl = '/communications/notices/11111111-1111-4111-8111-111111111111';
    // SMS task first: the old lookup by notice id in actionUrl picked the first match
    mockAttention({ critical: 0, warning: 1, reminder: 1, activeTotal: 2 }, [
      item({
        recipientId: 'r-sms',
        title: 'SMS task',
        source: AlertSource.NOTICE,
        category: AlertCategory.NOTICE,
        ruleKey: 'notice.sms-approval',
        severity: AlertSeverity.REMINDER,
        actionUrl: `${noticeUrl}?sms=1`,
      }),
      item({
        recipientId: 'r-imp',
        title: 'Important notice',
        source: AlertSource.NOTICE,
        category: AlertCategory.NOTICE,
        ruleKey: 'notice.important',
        severity: AlertSeverity.WARNING,
        actionUrl: noticeUrl,
      }),
    ]);
    server.use(
      http.post('*/notices/mine/*/acknowledge', () => new HttpResponse(null, { status: 500 })),
    );
    renderCenter();
    await userEvent.click(await screen.findByRole('button', { name: /1 warning/i }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark as read: Important notice' }),
    );
    const line = await screen.findByRole('alert');
    expect(line.textContent).toBe('That did not work. Try again.');
    expect(line.closest('[data-alert-item]')?.getAttribute('data-alert-item')).toBe('r-imp');
  });

  it('?alerts=1 opens the modal and closing removes only that flag', async () => {
    mockAttention({ critical: 1, warning: 0, reminder: 0, activeTotal: 1 });
    renderCenter('/?alerts=1&keep=x');
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const search = JSON.parse(screen.getByTestId('search').textContent ?? '{}');
    expect(search.alerts).toBeUndefined();
    expect(search.keep).toBe('x');
  });

  it('summary 500: no bar, bell shows the error and Retry refetches', async () => {
    let calls = 0;
    server.use(
      http.get('*/attention/summary', () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );
    renderCenter();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Could not load alerts.', {}, { timeout: 8000 })).toBeTruthy();
    const before = calls;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });
});

import { AlertCategory, AlertRecipientState, AlertSeverity, AlertSource } from '@biddaloy/shared';
import { clearNotifications, pushNotification, setActiveTenant } from '@biddaloy/ui/api';
import {
  alertItemFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

import { AttentionWorklist } from './attention-worklist';

function itemsHandler(items: ReturnType<typeof alertItemFactory>[], seen?: URLSearchParams[]) {
  return http.get('*/attention/items', ({ request }) => {
    seen?.push(new URL(request.url).searchParams);
    return HttpResponse.json({ items, total: items.length });
  });
}

function renderStaff(path = '/notifications') {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('AttentionWorklist (staff)', () => {
  afterEach(async () => {
    clearNotifications();
    vi.unstubAllGlobals();
    await cleanupTestState();
  });

  it('lists open and closed items in server order with their status', async () => {
    server.use(
      itemsHandler([
        alertItemFactory({ title: 'Take attendance 7B' }),
        alertItemFactory({ title: 'Hidden one', state: AlertRecipientState.HIDDEN }),
        alertItemFactory({
          title: 'Snoozed one',
          state: AlertRecipientState.HIDDEN,
          snoozedUntil: '2026-10-12T04:00:00.000Z',
        }),
      ]),
    );
    renderStaff();

    expect(await screen.findByText('Take attendance 7B')).toBeTruthy();
    expect(screen.getByText('Closed for now')).toBeTruthy();
    expect(screen.getByText(/Snoozed until/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'To-do (3)' })).toBeTruthy();
  });

  it('links the text action, closes via POST hide, and gives a critical item no Close', async () => {
    const user = userEvent.setup();
    const hidden: string[] = [];
    const open = alertItemFactory({
      title: 'Warn item',
      actionLabel: 'Do it',
      actionUrl: '/attendance',
    });
    const critical = alertItemFactory({
      title: 'Critical item',
      severity: AlertSeverity.CRITICAL,
      closable: false,
    });
    let items = [open, critical];
    server.use(
      http.get('*/attention/items', () => HttpResponse.json({ items, total: items.length })),
      http.post('*/attention/items/:id/hide', ({ params }) => {
        hidden.push(String(params.id));
        items = [{ ...open, state: AlertRecipientState.HIDDEN }, critical];
        return HttpResponse.json(items[0]);
      }),
    );
    renderStaff();

    const link = await screen.findAllByRole('link', { name: 'Do it' });
    expect(link[0]?.getAttribute('href')).toBe('/attendance');
    expect(screen.queryAllByRole('button', { name: 'Close: Critical item' })).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Close: Warn item' }));
    await waitFor(() => expect(hidden).toEqual([open.recipientId]));
    expect(await screen.findByText('Closed for now')).toBeTruthy();
  });

  it('never asks staff for /students/mine (parent/student only, a 403 for staff)', async () => {
    let mine = 0;
    server.use(
      itemsHandler([alertItemFactory({ title: 'Staff item' })]),
      http.get('*/students/mine', () => {
        mine += 1;
        return HttpResponse.json([]);
      }),
    );
    renderStaff();

    expect(await screen.findByText('Staff item')).toBeTruthy();
    expect(mine).toBe(0);
  });

  it('sends the category and section filters', async () => {
    const seen: URLSearchParams[] = [];
    server.use(itemsHandler([], seen));
    renderStaff(`/notifications?category=${AlertCategory.HOMEWORK}&section_id=sec-1`);

    await waitFor(() => {
      const last = seen.at(-1);
      expect(last?.get('category')).toBe('HOMEWORK');
      expect(last?.get('sectionId')).toBe('sec-1');
      expect(last?.get('tab')).toBe('active');
    });
  });

  it('history tab: fixed-by text, device card, mark all read', async () => {
    const user = userEvent.setup();
    const seen: URLSearchParams[] = [];
    server.use(
      itemsHandler(
        [
          alertItemFactory({
            title: 'Old alert',
            state: AlertRecipientState.RESOLVED,
            resolvedAt: '2026-10-08T04:00:00.000Z',
            resolvedByName: 'Rahima',
          }),
        ],
        seen,
      ),
    );
    setActiveTenant('tenant-1');
    pushNotification({ tenantId: 'tenant-1', message: 'Import finished', variant: 'success' });
    renderStaff('/notifications?tab=history');

    expect(await screen.findByText(/Fixed by Rahima/)).toBeTruthy();
    expect(seen.at(-1)?.get('tab')).toBe('history');
    expect(screen.getByRole('heading', { name: 'Recent messages on this device' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Import finished/ })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull());
  });

  it('shows the empty state, and an error with Retry', async () => {
    server.use(itemsHandler([]));
    renderStaff();
    expect(await screen.findByText('Nothing to do')).toBeTruthy();
  });

  it('shows a load error with Retry on a 500', async () => {
    server.use(http.get('*/attention/items', () => new HttpResponse(null, { status: 500 })));
    renderStaff();
    expect(await screen.findByText('Could not load alerts.', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('renders cards with the action label at phone width', async () => {
    vi.stubGlobal('innerWidth', 390);
    server.use(itemsHandler([alertItemFactory({ actionLabel: 'Take attendance' })]));
    renderStaff();
    expect((await screen.findAllByText('Take attendance')).length).toBeGreaterThan(0);
  });

  it('has no accessibility violations', async () => {
    server.use(itemsHandler([alertItemFactory({ title: 'A11y item' })]));
    const { container } = renderStaff();
    await screen.findByText('A11y item');
    await expect(container).toHaveNoViolations();
  });
});

describe('AttentionWorklist (portal)', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the child filter for two children and sends studentId', async () => {
    const seen: URLSearchParams[] = [];
    const kids = [studentFactory({ full_name: 'Fatima' }), studentFactory({ full_name: 'Karim' })];
    server.use(
      itemsHandler([], seen),
      http.get('/api/v1/students/mine', () => HttpResponse.json(kids)),
    );
    const root = createRootRoute();
    const index = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => (
        <AttentionWorklist scope="portal" tab="active" onTabChange={() => undefined} />
      ),
    });
    renderWithRouter(root.addChildren([index]), {
      initialEntries: [`/?student_id=${kids[1]?.id}`],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale: 'en',
    });

    await waitFor(() => expect(seen.at(-1)?.get('studentId')).toBe(kids[1]?.id));
    expect(await screen.findByText('Child')).toBeTruthy();
  });

  it('notice rows: acknowledge posts once and the row leaves; SMS task only links', async () => {
    const user = userEvent.setup();
    const acked: string[] = [];
    const base = { source: AlertSource.NOTICE, category: AlertCategory.NOTICE };
    const imp = alertItemFactory({
      ...base,
      ruleKey: 'notice.important',
      title: 'Exam routine',
      actionUrl: '/communications/notices/n-1',
    });
    const task = alertItemFactory({
      ...base,
      ruleKey: 'notice.sms-approval',
      title: 'Fee notice',
      actionUrl: '/communications/notices/n-2?sms=1',
    });
    let items = [imp, task];
    server.use(
      http.get('*/attention/items', () => HttpResponse.json({ items, total: items.length })),
      http.post('*/notices/mine/:id/acknowledge', ({ params }) => {
        acked.push(String(params.id));
        items = [task];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderStaff();

    expect(await screen.findByText('SMS approval pending: Fee notice')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close: Exam routine' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Mark as read: Exam routine' }));
    await waitFor(() => expect(acked).toEqual(['n-1']));
    await waitFor(() => expect(screen.queryByText('Exam routine')).toBeNull());
    expect(screen.queryAllByRole('button', { name: /Mark as read/ })).toHaveLength(0);
  });
});

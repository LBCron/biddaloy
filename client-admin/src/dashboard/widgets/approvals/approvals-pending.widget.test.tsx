import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, {
  ApprovalsPendingView,
  type PendingCountDto,
  widgetKey,
} from './approvals-pending.widget';

const URL = '/api/v1/dashboard/widgets/approvals-pending';

const BASE = {
  total: 8,
  by_type: [
    { type: 'STAFF_LEAVE', count: 5 },
    { type: 'FEE_WAIVER', count: 2 },
    { type: 'TESTIMONIAL', count: 1 },
  ],
  oldest_pending_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
};

function renderWidget(variant: 'full' | 'compact' | 'tile', locale: 'en' | 'bn' = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="S" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('approvals-pending widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('approvals-pending');
  });

  it('full: total, oldest sentence, one row per type linking to the filtered inbox', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('8 waiting')).toBeTruthy();
    expect(screen.getByText(/Oldest sent/)).toBeTruthy();
    const leave = screen.getByRole('link', { name: 'Staff leave' });
    expect(leave.getAttribute('href')).toContain('type=STAFF_LEAVE');
    expect(leave.getAttribute('href')).toContain('view=inbox');
    expect(screen.getByRole('link', { name: 'Fee waiver' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Testimonial' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the inbox' })).toBeTruthy();
  });

  it('bn: counts use Bengali digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('৮টা অপেক্ষায়')).toBeTruthy();
    expect(screen.getByText('৫')).toBeTruthy();
  });

  it('zero: nothing-waiting sentence, no type rows', async () => {
    serve({ total: 0, by_type: [], oldest_pending_at: null });
    renderWidget('full');
    expect(await screen.findByText('Nothing is waiting for your approval.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Staff leave' })).toBeNull();
  });

  it('tile: label, total, oldest note', async () => {
    serve(BASE);
    renderWidget('tile');
    // The tenant region (bn numerals) loads after first paint, so accept either digit.
    expect(await screen.findByText(/^(8|৮)$/)).toBeTruthy();
    expect(screen.getByText('Waiting for your approval')).toBeTruthy();
    expect(screen.getByText(/Oldest sent/)).toBeTruthy();
  });

  it('error: Retry refetches', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 });
      }),
    );
    renderWidget('full');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
  });

  it('tile: a failed refetch shows the error, not the stale count', async () => {
    const root = createRootRoute();
    const index = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => (
        <ApprovalsPendingView
          data={BASE as PendingCountDto}
          variant="tile"
          failed
          onRetry={() => undefined}
        />
      ),
    });
    renderWithRouter(root.addChildren([index]), { locale: 'en', role: 'ADMIN', tenantId: 't-1' });
    // The collapsed card shows the error in its header; Retry is one tap away in the body.
    expect(await screen.findByText('This widget could not load.')).toBeTruthy();
    expect(screen.queryByText(/^(8|৮)$/)).toBeNull();
  });

  it('is axe clean on full', async () => {
    serve(BASE);
    const { container } = renderWidget('full');
    await screen.findByText('8 waiting');
    await expect(container).toHaveNoViolations();
  });

  it('signal: pending shows needs-action text', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText('8 waiting');
    expect(screen.getByText('Needs action')).toBeTruthy();
  });

  it('signal: none pending shows healthy, not needs-action', async () => {
    serve({ ...BASE, total: 0, by_type: [], oldest_pending_at: null });
    renderWidget('full');
    await screen.findByRole('link', { name: /./ });
    expect(screen.queryByText('Needs action')).toBeNull();
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('tile carries the signal too (phone key numbers, #3594)', async () => {
    serve(BASE);
    renderWidget('tile');
    const marker = await waitFor(() => {
      const el = document.querySelector('[data-signal]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(marker.getAttribute('data-signal')).toBe('critical');
    expect(marker.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(marker.querySelector('.sr-only')!.textContent).toBe('Needs action');
  });
});

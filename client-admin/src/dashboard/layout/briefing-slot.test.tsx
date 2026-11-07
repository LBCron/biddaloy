import '@biddaloy/ui/test';

import {
  alertItemFactory,
  attentionSummaryFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { BriefingSlot } from './briefing-slot';

function renderSlot(locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <BriefingSlot />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) =>
  server.use(http.get('/api/v1/attention/summary', () => HttpResponse.json(body)));

describe('BriefingSlot (attention summary, Epic 67 D1)', () => {
  afterEach(cleanupTestState);

  it('count > 0: headline parts, most-urgent title, one primary link', async () => {
    serve(
      attentionSummaryFactory({
        critical: 1,
        warning: 2,
        reminder: 0,
        activeTotal: 3,
        top: { ...alertItemFactory({ title: 'Section 7B attendance not taken' }) },
      }),
    );
    renderSlot();
    expect(await screen.findByText(/1 urgent · 2 warnings/)).toBeTruthy();
    expect(screen.getByText('most urgent: Section 7B attendance not taken')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe('See all to-do (3)');
  });

  it('signal (#3594 D12): critical → needs action, warning only → watch, reminder only → none', async () => {
    serve(attentionSummaryFactory({ critical: 1, warning: 2, activeTotal: 3 }));
    const first = renderSlot();
    const marker = await waitFor(() => {
      const el = first.container.querySelector('[data-signal]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(marker.getAttribute('data-signal')).toBe('critical');
    expect(marker.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(marker.querySelector('.sr-only')!.textContent).toBe('Needs action');
    first.unmount();
    await cleanupTestState();

    serve(attentionSummaryFactory({ warning: 2, activeTotal: 2 }));
    const second = renderSlot();
    await screen.findByText(/2 warnings/);
    expect(second.container.querySelector('[data-signal]')!.getAttribute('data-signal')).toBe(
      'warn',
    );
    expect(screen.getByText('Keep an eye on this').className).toContain('sr-only');
    second.unmount();
    await cleanupTestState();

    serve(attentionSummaryFactory({ reminder: 1, activeTotal: 1 }));
    const third = renderSlot();
    await screen.findByRole('link');
    expect(third.container.querySelector('[data-signal]')).toBeNull();
  });

  it('count 0 → all-clear line, no button', async () => {
    serve(attentionSummaryFactory());
    renderSlot();
    expect(await screen.findByText('Nothing needs you right now.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('bn digits in the counts', async () => {
    serve(attentionSummaryFactory({ warning: 3, activeTotal: 3 }));
    renderSlot('bn');
    expect(await screen.findByRole('link', { name: /৩/ })).toBeTruthy();
  });

  it('request failing → renders nothing', async () => {
    server.use(
      http.get('/api/v1/attention/summary', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    const { container } = renderSlot();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Nothing needs you right now.')).toBeNull();
  });
});

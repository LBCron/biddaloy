import '@biddaloy/ui/test';

import { cleanupTestState, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { renderPortalCard } from '../../../routes/portal/-card-test-utils';
import { WIDGET_COMPONENTS } from '../registry';

import Widget, { widgetKey } from './latest-notices.widget';

const row = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Notice ${n}`,
  important: false,
  pinned: false,
  published_at: '2026-11-20T04:00:00.000Z',
  expires_on: null,
  edited: false,
  seen: true,
  acknowledged: false,
  forStudents: [],
});

describe('latest-notices widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('is registered under its key', () => {
    expect(widgetKey).toBe('latest-notices');
    expect(WIDGET_COMPONENTS.has('latest-notices')).toBe(true);
  });

  it('renders 3 rows', async () => {
    server.use(
      http.get('/api/v1/notices/mine', () =>
        HttpResponse.json({ data: [row(1), row(2), row(3)], total: 3, page: 1, limit: 3 }),
      ),
    );
    renderPortalCard(<Widget variant="full" size="M" />, 'en', 'TEACHER');
    expect((await screen.findAllByText('Notice 1')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Notice 3').length).toBeGreaterThan(0);
    // #3430 finding 3: `/portal/notices` bounced staff to the dashboard; the staff list route is
    // not mounted yet (#3381), so the staff widget shows no list link.
    expect(screen.queryByRole('link', { name: 'All notices' })).toBeNull();
  });

  it('empty state', async () => {
    server.use(
      http.get('/api/v1/notices/mine', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 3 }),
      ),
    );
    renderPortalCard(<Widget variant="full" size="M" />, 'en', 'TEACHER');
    expect((await screen.findAllByText('No new notices')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'All notices' })).toBeNull();
  });

  it('error state has a retry', async () => {
    server.use(http.get('/api/v1/notices/mine', () => new HttpResponse(null, { status: 403 })));
    renderPortalCard(<Widget variant="full" size="M" />, 'en', 'TEACHER');
    expect((await screen.findAllByRole('button', { name: 'Try again' })).length).toBeGreaterThan(0);
  });
});

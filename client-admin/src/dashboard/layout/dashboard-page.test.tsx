import '@biddaloy/ui/test';

import { ROLE_DEFAULT_LAYOUTS } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute, useSearch } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DashboardPage } from './dashboard-page';

function TestRoute() {
  return <DashboardPage customize={useSearch({ strict: false }).customize === 1} />;
}

function tree() {
  const root = createRootRoute();
  const dash = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    validateSearch: (s: Record<string, unknown>) => ({
      customize: s.customize === 1 ? (1 as const) : undefined,
    }),
    component: TestRoute,
  });
  return root.addChildren([dash]);
}

/** `none` = brand-new school, `some` = partly done, default = finished. */
function onboardingBody(state: 'none' | 'some' | 'done' | 'hidden') {
  const done = [state !== 'none', state === 'done' || state === 'hidden'];
  return {
    finished_at: null,
    dismissed_at: state === 'hidden' ? '2026-10-01T00:00:00Z' : null,
    seen: true,
    setup_path: null,
    items: [
      { id: 'profile', done: done[0] },
      { id: 'structure', done: done[1] },
    ].map((i) => (state === 'hidden' ? { ...i, done: false } : i)),
    counts: { classes: 0, sections: 0, students: 0, staff: 1 },
  };
}

function mockApi(
  opts: {
    preferences?: unknown;
    userStatus?: number;
    onboarding?: 'none' | 'some' | 'done' | 'hidden';
  } = {},
) {
  server.use(
    http.get('/api/v1/onboarding/status', () =>
      HttpResponse.json(onboardingBody(opts.onboarding ?? 'done')),
    ),
    http.get('/api/v1/users/me', () =>
      opts.userStatus
        ? HttpResponse.json({ message: 'boom' }, { status: opts.userStatus })
        : HttpResponse.json({ id: 'u1', full_name: 'Head', preferences: opts.preferences ?? null }),
    ),
    http.get('/api/v1/attention/summary', () =>
      HttpResponse.json({
        critical: 0,
        warning: 0,
        reminder: 0,
        activeTotal: 0,
        top: null,
        updatedAt: null,
        staleMinutes: 0,
      }),
    ),
    http.get('/api/v1/notices/mine', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 3 }),
    ),
    http.get('/api/v1/calendar/events', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 6, totalPages: 1 }),
    ),
  );
}

const render = (url = '/dashboard', role = 'ADMIN') =>
  renderWithRouter(tree(), {
    initialEntries: [url],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

const point = (received_pct: number) => ({
  as_of: '2026-10-07',
  received: 1,
  billed_for_month: 1,
  received_pct,
});

/** Committee aggregates: attendance 1 point short of target, collection 8 points ahead. */
function mockCommittee(over: Partial<Record<string, number>> = {}) {
  const bodies: Record<string, object> = {
    enrollment: { years: [], current_count: 10, previous_count: 9 },
    attendance: {
      months: [{ month: '2026-10', percentage: 89 }],
      current_month_percentage: 89,
      year_percentage: 88,
      target_percentage: 90,
    },
    finance: {
      months: [],
      year_outstanding: 0,
      current_month: {
        ...point(70),
        month: '2026-10',
        last_month_same_point: null,
        last_year_same_point: point(62),
      },
    },
    'pass-rate': {
      exam_name: 'X',
      classes: [],
      overall_pass_percentage: null,
      recent_rounds: [],
      previous_pass_percentage: null,
    },
  };
  const hits: string[] = [];
  server.use(
    ...Object.entries(bodies).map(([key, body]) =>
      http.get(`/api/v1/dashboard/widgets/committee-${key}`, () => {
        const status = over[key];
        return status ? HttpResponse.json({ message: 'x' }, { status }) : HttpResponse.json(body);
      }),
    ),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'y', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/dashboard/briefing', () => {
      hits.push('briefing');
      return HttpResponse.json({});
    }),
  );
  return hits;
}

describe('DashboardPage', () => {
  afterEach(cleanupTestState);

  it('renders the title and today, and the all-clear briefing', async () => {
    mockApi();
    render();
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    expect(await screen.findByText('Nothing needs you right now.')).toBeTruthy();
  });

  describe('setup checklist (D15)', () => {
    const card = () => screen.queryAllByRole('heading', { name: 'Finish setting up your school' });

    it('ADMIN, brand-new school: checklist alone, no grid', async () => {
      mockApi({ onboarding: 'none' });
      render();
      await waitFor(() => expect(card().length).toBeGreaterThan(0));
      expect(screen.queryAllByRole('heading', { name: 'Upcoming' })).toHaveLength(0);
    });

    it('ADMIN, partly done: grid, checklist is the last widget before the notices card', async () => {
      mockApi({ onboarding: 'some' });
      render();
      await waitFor(() => expect(card().length).toBeGreaterThan(0));
      expect((await screen.findAllByRole('heading', { name: 'Upcoming' })).length).toBeGreaterThan(
        0,
      );
      const all = screen.getAllByRole('heading', { level: 2 });
      expect(all[all.length - 2]!.textContent).toBe('Finish setting up your school');
      expect(all[all.length - 1]!.textContent).toBe('Latest notices');
    });

    it('ADMIN, finished: no checklist', async () => {
      mockApi({ onboarding: 'done' });
      render();
      await screen.findAllByRole('heading', { name: 'Upcoming' });
      expect(card()).toHaveLength(0);
    });

    it('ADMIN, hidden by the admin: no checklist', async () => {
      mockApi({ onboarding: 'hidden' });
      render();
      await screen.findAllByRole('heading', { name: 'Upcoming' });
      expect(card()).toHaveLength(0);
    });

    it('TEACHER never sees it, even for a brand-new school', async () => {
      mockApi({ onboarding: 'none' });
      render('/dashboard', 'TEACHER');
      await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
      await new Promise((r) => setTimeout(r, 50));
      expect(card()).toHaveLength(0);
    });
  });

  it('Customise goes to ?customize=1', async () => {
    mockApi();
    const { router } = render();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Customise' }))[0]!);
    expect(router.state.location.search).toMatchObject({ customize: 1 });
  });

  it('shows the Upcoming widget for a role with CALENDAR_READ', async () => {
    mockApi();
    render();
    expect((await screen.findAllByRole('heading', { name: 'Upcoming' })).length).toBeGreaterThan(0);
  });

  it('falls back to the role default when the prefs read fails', async () => {
    mockApi({ userStatus: 500 });
    render();
    expect((await screen.findAllByRole('heading', { name: 'Upcoming' })).length).toBeGreaterThan(0);
    expect(screen.queryByText('All widgets are hidden')).toBeNull();
  });

  it('a visible key with no component file renders nothing and no error', async () => {
    mockApi();
    render();
    await screen.findAllByRole('heading', { name: 'Upcoming' });
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('all keys hidden -> EmptyState whose Customise goes to ?customize=1', async () => {
    mockApi({
      preferences: {
        dashboard: {
          ADMIN: { widgets: ROLE_DEFAULT_LAYOUTS.ADMIN.map((key) => ({ key, hidden: true })) },
        },
      },
    });
    const { router } = render();
    expect(await screen.findByText('All widgets are hidden')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Customise' });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(router.state.location.search).toMatchObject({ customize: 1 });
  });

  it('?customize=1 shows customise mode instead of the grid', async () => {
    mockApi();
    render('/dashboard?customize=1');
    expect(await screen.findByText('Customising')).toBeTruthy();
    expect(screen.queryByText('Nothing needs you right now.')).toBeNull();
  });

  it('COMMITTEE: privacy line, one filled print button, summary banner, no briefing request', async () => {
    mockApi();
    const hits = mockCommittee();
    render('/dashboard', 'COMMITTEE');
    expect(
      await screen.findByText('For the committee: totals only, no personal details'),
    ).toBeTruthy();
    const print = await screen.findByRole('link', { name: 'Print monthly meeting report' });
    expect(print.getAttribute('href')).toBe('/print/committee-report?from=%2Fdashboard');
    expect(
      await screen.findByText(
        'Attendance is close to its target — collection is 8% ahead of this time last year.',
      ),
    ).toBeTruthy();
    expect(await screen.findByText(/Academic year 2026/)).toBeTruthy();
    expect(hits).toEqual([]);
  });

  it('COMMITTEE with the finance route failing: banner keeps the attendance clause', async () => {
    mockApi();
    mockCommittee({ finance: 500 });
    render('/dashboard', 'COMMITTEE');
    expect(
      await screen.findByText('Attendance is close to its target.', {}, { timeout: 15000 }),
    ).toBeTruthy();
  });

  it('EXECUTIVE: no print button, no privacy line, briefing as before', async () => {
    mockApi();
    render('/dashboard', 'EXECUTIVE');
    expect(await screen.findByText('Nothing needs you right now.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Print monthly meeting report' })).toBeNull();
    expect(screen.queryByText('For the committee: totals only, no personal details')).toBeNull();
  });
});

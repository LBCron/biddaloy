import '@biddaloy/ui/test';

import { ROLE_DEFAULT_LAYOUTS, WIDGET_CATALOGUE, type DashboardWidgetKey } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import dashboardEn from '../../../../ui/src/i18n/locales/en/dashboard.json';
import { WIDGET_COMPONENTS } from '../widgets/registry';

import { DashboardPage } from './dashboard-page';

/**
 * [8.10.7.4.99] The wave-4 widgets through the real page shell: the TEACHER and ACCOUNTANT default
 * layouts with every widget route mocked (MSW), a failing route, a hidden widget and the phone
 * grid. Rendered as TEACHER / ACCOUNTANT, not ADMIN: ADMIN holds SETTINGS_MANAGE, so it reads the
 * test harness's default school settings (`ui/src/test/msw/handlers/schools.ts`, Bangla numerals)
 * and prints Bangla digits under the `en` locale; the other roles take the locale default.
 */

const titleOf = (key: string) =>
  (dashboardEn.widgets as unknown as Record<string, { title: string }>)[key]!.title;

/** One sample body per wave-3/4 widget route that the two default layouts use. */
const period = { section_id: 's1', class_name: '7', section_name: 'B', subject_name_en: 'Maths' };
const FIXTURES: Record<string, unknown> = {
  'my-routine-today': {
    date: '2026-10-07',
    is_working_day: true,
    periods: [
      {
        ...period,
        starts_at: '08:00',
        ends_at: '08:40',
        subject_name_bn: null,
        room_label: 'D-1',
        is_homeroom: false,
        covering: false,
        cancelled: false,
      },
    ],
    next_day: null,
  },
  'my-pending-sections': {
    date: '2026-10-07',
    is_working_day: true,
    pending_count: 1,
    sections: [
      {
        section_id: 's-b',
        class_name: '7',
        section_name: 'B',
        student_count: 40,
        taken: false,
        unmarked: 40,
      },
    ],
  },
  'my-mark-deadlines': {
    outstanding_students: 8,
    items: [
      {
        exam_id: 'e1',
        exam_name: 'Half-yearly',
        section_id: 's1',
        class_name: '7',
        section_name: 'A',
        subject_id: 'sub1',
        subject_name_en: 'Mathematics',
        subject_name_bn: null,
        entered: 32,
        expected: 40,
        state: 'DRAFT',
        mark_entry_deadline: null,
        last_sitting_date: null,
      },
    ],
  },
  'homework-to-check': {
    total_submitted: 18,
    assignment_count: 1,
    items: [
      {
        assignment_id: 'a1',
        homework_id: 'h1',
        title: 'Chapter 3 sums',
        class_name: '7',
        section_name: 'B',
        subject_name_en: 'Mathematics',
        subject_name_bn: null,
        due_date: '2026-10-06',
        submitted_count: 11,
      },
    ],
  },
  'my-leave-balance': {
    has_profile: true,
    year: 2026,
    total_quota_days: 12,
    total_used_days: 4,
    total_balance_days: 8,
    by_type: [],
  },
  'class-teacher-streaks': {
    section: { section_id: 'sec1', class_name: '7', section_name: 'B' },
    as_of_date: '2026-10-06',
    total: 1,
    items: [
      {
        student_id: '1',
        student_name: 'Rafi Ahmed',
        roll_number: 4,
        length: 6,
        since_date: '2026-09-30',
      },
    ],
  },
  'my-syllabus-progress': {
    items: [
      {
        class_id: 'c1',
        class_name: '6',
        sections: [{ section_id: 's1', section_name: 'A' }],
        subject_id: 'sub1',
        subject_name_en: 'Math',
        subject_name_bn: null,
        done: 80,
        total: 100,
        percentage: 80,
      },
    ],
  },
  'collection-today': {
    date: '2026-10-07',
    net: 48500,
    payment_count: 23,
    yesterday_same_time_net: 41200,
    groups: [
      {
        group: 'CASH',
        net: 22000,
        payment_count: 11,
        methods: [{ payment_method: 'CASH', net: 22000, payment_count: 11 }],
      },
      {
        group: 'BANK',
        net: 20000,
        payment_count: 7,
        methods: [{ payment_method: 'CARD', net: 20000, payment_count: 7 }],
      },
    ],
  },
  'collection-month': {
    month: '2026-10',
    as_of: '2026-10-07',
    received: 882000,
    billed_for_month: 1210000,
    received_pct: 73,
    last_month_same_point: {
      as_of: '2026-09-07',
      received: 790000,
      billed_for_month: 1215000,
      received_pct: 65,
    },
    last_year_same_point: null,
  },
  'fee-generation-status': {
    period: '2026-10',
    generated: true,
    first_generated_at: '2026-10-01T00:00:12.000Z',
    bill_count: 412,
    batch_count: 1,
    next_scheduled_run: '2026-11-01',
  },
  'reminders-pending': {
    student_count: 38,
    guardian_count: 31,
    oldest_threshold_date: '2026-09-10',
  },
  'collection-by-month': {
    year: 2026,
    year_to_date_net: 1000000,
    month_to_date_net: 48500,
    previous_month_same_days_net: 41200,
    months: Array.from({ length: 12 }, (_, i) => ({
      year: 2026,
      month: i + 1,
      net: i < 9 ? 90000 : i === 9 ? 48500 : null,
      is_current: i === 9,
    })),
  },
  'dues-ageing': {
    as_of: '2026-10-07',
    total_due: 386000,
    buckets: [
      { bucket: '0_30', amount: 192000, share_pct: 50 },
      { bucket: '31_60', amount: 118000, share_pct: 31 },
      { bucket: '60_PLUS', amount: 76000, share_pct: 20 },
    ],
  },
  'recent-payments': {
    total_of_shown: 3000,
    items: [
      {
        payment_id: 'p-1',
        student_name: 'Student 1',
        class_name: 'Class 6',
        section_name: 'A',
        amount: 3000,
        payment_method: 'CASH',
        payment_status: 'SUCCESS',
        payment_date: '2026-10-07T04:06:00.000Z',
      },
    ],
  },
  'dues-by-class': {
    total_due: 120000,
    classes: [{ class_id: 'c-1', class_name: 'Class 10', amount: 120000, student_count: 20 }],
  },
  'homework-submission-rate': {
    window: { from: '2026-10-01', to: '2026-10-07' },
    overall: { submitted: 45, assigned: 60, percentage: 75 },
    classes: [{ class_id: 'c6', class_name: '6', submitted: 25, assigned: 30, percentage: 83 }],
  },
  'recent-activity': {
    items: [
      {
        id: 'a1',
        action: 'UPDATE',
        entity_type: 'Student',
        entity_label: null,
        performed_by_name: 'Rahim',
        created_at: '2026-10-07T04:00:00.000Z',
        changed_field_count: 2,
      },
    ],
  },
};

const TEACHER = ROLE_DEFAULT_LAYOUTS.TEACHER;
const ACCOUNTANT = ROLE_DEFAULT_LAYOUTS.ACCOUNTANT;
/** `latest-notices` reads `/notices/mine`, not a dashboard widget route, so it is never in `requested`. */
const widgetRoutes = (keys: DashboardWidgetKey[]) =>
  new Set(keys.filter((k) => k !== 'latest-notices'));
/** Every key wave 4 added a widget file for (collection-month is wave 3's and is not listed). */
const WAVE_4_KEYS: DashboardWidgetKey[] = [
  ...TEACHER.filter((k) => k !== 'latest-notices'),
  ...ACCOUNTANT.filter((k) => k !== 'collection-month' && k !== 'latest-notices'),
  'homework-submission-rate',
  'recent-activity',
];

function tree() {
  const root = createRootRoute();
  const dash = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    component: () => <DashboardPage customize={false} />,
  });
  return root.addChildren([dash]);
}

/** Mocks the shell calls and every widget route; `fail` answers 500, `prefs` is the saved layout. */
function mockApi(opts: { fail?: string; prefs?: unknown; role: 'TEACHER' | 'ACCOUNTANT' }) {
  const requested: string[] = [];
  server.use(
    http.get('/api/v1/users/me', () =>
      HttpResponse.json({
        id: 'u1',
        full_name: 'Head',
        preferences: opts.prefs ? { dashboard: { [opts.role]: opts.prefs } } : null,
      }),
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
    http.get('/api/v1/calendar/events', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 6, totalPages: 1 }),
    ),
    http.get('/api/v1/notices/mine', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 3 }),
    ),
    http.get('/api/v1/dashboard/widgets/:key', ({ params }) => {
      const key = String(params.key);
      requested.push(key);
      return key === opts.fail
        ? HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 })
        : HttpResponse.json(FIXTURES[key] ?? {});
    }),
  );
  return requested;
}

const render = (role: 'TEACHER' | 'ACCOUNTANT') =>
  renderWithRouter(tree(), {
    initialEntries: ['/dashboard'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

/** The h2 of every card in the desktop grid, in DOM order. */
const desktopTitles = () =>
  within(screen.getByTestId('grid-desktop'))
    .getAllByRole('heading', { level: 2 })
    .map((h) => h.textContent);

describe('wave-4 widgets in the dashboard page', () => {
  afterEach(cleanupTestState);

  it('TEACHER: the default layout renders its eight cards, the last being the notices card in order', async () => {
    const requested = mockApi({ role: 'TEACHER' });
    render('TEACHER');
    await waitFor(() => expect(new Set(requested)).toEqual(widgetRoutes(TEACHER)));
    await waitFor(() => expect(document.querySelector('[data-slot="widget-skeleton"]')).toBeNull());
    expect(TEACHER).toHaveLength(8);
    expect(desktopTitles()).toEqual(TEACHER.map(titleOf));
  });

  it('ACCOUNTANT: the default layout renders its nine cards in order, incl. collection-month', async () => {
    const requested = mockApi({ role: 'ACCOUNTANT' });
    render('ACCOUNTANT');
    await waitFor(() => expect(new Set(requested)).toEqual(widgetRoutes(ACCOUNTANT)));
    await waitFor(() => expect(document.querySelector('[data-slot="widget-skeleton"]')).toBeNull());
    expect(ACCOUNTANT).toHaveLength(9);
    expect(ACCOUNTANT).toContain('collection-month');
    expect(desktopTitles()).toEqual(ACCOUNTANT.map(titleOf));
  });

  it("a 500 on one route shows that card's error with Try again; the others still render (D6)", async () => {
    mockApi({ role: 'TEACHER', fail: 'my-pending-sections' });
    render('TEACHER');
    const desktop = within(await screen.findByTestId('grid-desktop'));
    // The failing card (the retry waits out the query's backoff) ...
    expect(
      await desktop.findByRole('button', { name: 'Try again' }, { timeout: 15_000 }),
    ).toBeTruthy();
    expect(desktop.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    // ... and a neighbour that loaded.
    expect(await desktop.findByText('Chapter 3 sums')).toBeTruthy();
    expect(desktopTitles()).toEqual(TEACHER.map(titleOf));
  }, 30_000);

  it('a widget hidden in the saved layout is never requested', async () => {
    const requested = mockApi({
      role: 'TEACHER',
      prefs: { widgets: [{ key: 'my-leave-balance', hidden: true }] },
    });
    render('TEACHER');
    await waitFor(() =>
      expect(requested.length).toBeGreaterThanOrEqual(widgetRoutes(TEACHER).size - 1),
    );
    await waitFor(() => expect(document.querySelector('[data-slot="widget-skeleton"]')).toBeNull());
    expect(requested).not.toContain('my-leave-balance');
    expect(desktopTitles()).not.toContain(titleOf('my-leave-balance'));
  });

  it('phone: key numbers hold only the phoneTile keys; every other key is a compact card (D16)', async () => {
    const requested = mockApi({ role: 'TEACHER' });
    render('TEACHER');
    await waitFor(() => expect(new Set(requested)).toEqual(widgetRoutes(TEACHER)));
    await waitFor(() => expect(document.querySelector('[data-slot="widget-skeleton"]')).toBeNull());

    const tileKeys = TEACHER.filter((k) => WIDGET_CATALOGUE[k].phoneTile);
    const phone = screen.getByTestId('grid-phone');
    const tiles = within(phone).getByRole('region', { name: 'Key numbers' });
    expect(tiles.children).toHaveLength(tileKeys.length);
    // Tiles first, then one compact card for every key that is not an S tile on its own.
    const tileOnly = tileKeys.filter((k) => WIDGET_CATALOGUE[k].sizes[0] === 'S');
    expect(phone.children).toHaveLength(1 + TEACHER.length - tileOnly.length);
    expect(phone.firstElementChild).toBe(tiles);
  });

  it('every wave-4 widget file is found by the registry glob', () => {
    expect(WAVE_4_KEYS).toHaveLength(16);
    for (const key of WAVE_4_KEYS) expect(WIDGET_COMPONENTS.has(key), key).toBe(true);
  });
});

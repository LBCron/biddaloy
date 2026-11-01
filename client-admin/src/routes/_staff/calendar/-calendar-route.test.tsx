/**
 * [31.4] `/calendar` through the real route tree: header actions, month grid
 * + day panel, the `?panel=` full-page form and the delete confirmation.
 * Region is not pinned (config loads async), so text assertions accept bn or en.
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

// Local 03:00 on 5 Oct in any zone: in UTC+6 the UTC day is still 4 Oct (B20).
vi.useFakeTimers({ toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});

function event(overrides: {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  type?: string;
  published?: boolean;
}) {
  return {
    type: 'EVENT',
    description: null,
    start_time: null,
    end_time: null,
    counts_as_working_day: true,
    class_ids: [],
    audience: 'ALL',
    is_locked: false,
    published: true,
    academic_year_id: 'ay-1',
    ...overrides,
  };
}

const EVENTS = [
  event({ id: 'ev-old', name: 'Yesterday fair', start_date: '2026-10-04', end_date: '2026-10-04' }),
  event({ id: 'ev-today', name: 'Sports day', start_date: '2026-10-05', end_date: '2026-10-05' }),
  event({
    id: 'ev-draft',
    name: 'Draft picnic',
    start_date: '2026-10-12',
    end_date: '2026-10-12',
    published: false,
  }),
];

function mockCalendar() {
  server.use(
    http.get('/api/v1/calendar-settings', () =>
      HttpResponse.json({ firstDayOfWeek: 0, weeklyOffDays: [5, 6] }),
    ),
    http.get('/api/v1/calendar/events', () =>
      HttpResponse.json({
        data: EVENTS,
        total: EVENTS.length,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/calendar/public-holidays', () => HttpResponse.json([])),
    http.get('/api/v1/calendar/events/:id', ({ params }) =>
      HttpResponse.json(EVENTS.find((e) => e.id === params.id)),
    ),
    http.delete('/api/v1/calendar/events/:id', () => new HttpResponse(null, { status: 204 })),
  );
}

/** The day panel is the `complementary` landmark that has a heading (the sidebar has none). */
function dayPanel() {
  return screen.getAllByRole('complementary').find((el) => el.querySelector('h3'))!;
}

function renderCalendar(path = '/calendar?month=2026-10', role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

describe('/calendar', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 9, 5, 3, 0));
    mockCalendar();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('shows one primary action, holidays/import inline, no grid/agenda toggle', async () => {
    renderCalendar();

    expect(
      await screen.findByRole('button', { name: /^(Add event|ইভেন্ট যোগ করুন)$/ }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Government holidays|সরকারি ছুটি/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^(Import|আমদানি)$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Agenda|এজেন্ডা)$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Month|মাস)$/ })).toBeNull();
  });

  it('shows a (?) after the Add event header action [44.3.03]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    renderCalendar();
    await screen.findByTestId('day-cell-2026-10-05');
    await screen.findAllByRole('button', { name: /^Help:/ });
    expect(
      document.querySelector('[data-help-id="people.calendar.action.addEvent"]'),
    ).not.toBeNull();
  });

  it('shows the event form (?) hints [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    renderCalendar();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^(Add event|ইভেন্ট যোগ করুন)$/ }));
    await screen.findByRole('heading', { name: /^(Add event|ইভেন্ট যোগ করুন)$/, level: 1 });
    await expectHelp('people.calendar.field.countsAsWorkingDay');
    await expectHelp('people.calendar.field.notify');
  });

  it('labels the month with the month name and year, not "2026-10"', async () => {
    renderCalendar();

    await screen.findByTestId('day-cell-2026-10-05');
    expect(screen.queryByText('2026-10')).toBeNull();
    expect(screen.getByText(/অক্টোবর ২০২৬|October 2026/)).toBeTruthy();
  });

  it('fills the day panel from the clicked day, defaulting to the local today (B20)', async () => {
    renderCalendar();
    const user = userEvent.setup();

    await screen.findByTestId('day-cell-2026-10-05');
    expect(within(dayPanel()).getByText('Sports day')).toBeTruthy();

    await user.click(screen.getByTestId('day-cell-2026-10-12'));
    await waitFor(() => expect(within(dayPanel()).getByText('Draft picnic')).toBeTruthy());
  });

  it('treats the local day as today in the upcoming panel (B20)', async () => {
    renderCalendar();

    await screen.findByTestId('day-cell-2026-10-05');
    const upcoming = screen.getByRole('heading', { name: /^(Upcoming|আসন্ন)$/ }).closest('div')!;
    expect(within(upcoming).queryByText('Yesterday fair')).toBeNull();
    expect(within(upcoming).getByText('Sports day')).toBeTruthy();
  });

  it('lists events from today to today + 60 days even when a past month is on screen', async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      http.get('/api/v1/calendar/events', ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(params);
        const upcoming = params.get('from') === '2026-10-05';
        return HttpResponse.json({
          data: upcoming
            ? [
                event({
                  id: 'ev-far',
                  name: 'Founders day',
                  start_date: '2026-11-24',
                  end_date: '2026-11-24',
                }),
              ]
            : [],
          total: upcoming ? 1 : 0,
          page: 1,
          limit: 100,
          totalPages: 1,
        });
      }),
    );
    renderCalendar('/calendar?month=2026-01');

    const upcoming = (await screen.findByRole('heading', { name: /^(Upcoming|আসন্ন)$/ })).closest(
      'div',
    )!;
    expect(await within(upcoming).findByText('Founders day')).toBeTruthy();
    expect(
      requests.some((p) => p.get('from') === '2026-10-05' && p.get('to') === '2026-12-04'),
    ).toBe(true);
  });

  it('opens the full-page event form from ?panel=new-event', async () => {
    renderCalendar();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /^(Add event|ইভেন্ট যোগ করুন)$/ }));

    expect(
      await screen.findByRole('heading', { name: /^(Add event|ইভেন্ট যোগ করুন)$/, level: 1 }),
    ).toBeTruthy();
  });

  it('asks before deleting an event from its details', async () => {
    let deleted = false;
    server.use(
      http.delete('/api/v1/calendar/events/:id', () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderCalendar();
    const user = userEvent.setup();

    await screen.findByTestId('day-cell-2026-10-05');
    await user.click(within(dayPanel()).getByRole('button', { name: 'Sports day' }));
    const details = await screen.findByRole('dialog');
    await user.click(await within(details).findByRole('button', { name: /^(Delete|মুছুন)$/ }));

    const confirm = await screen.findByRole('alertdialog');
    expect(deleted).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: /^(Delete|মুছুন)$/ }));

    await waitFor(() => expect(deleted).toBe(true));
  });

  it('hides every manage action from a read-only role', async () => {
    renderCalendar('/calendar?month=2026-10', 'TEACHER');

    await screen.findByTestId('day-cell-2026-10-05');
    expect(screen.queryByRole('button', { name: /^(Add event|ইভেন্ট যোগ করুন)$/ })).toBeNull();
  });

  it('starts the day panel inside the visible month when ?month is not the current one', async () => {
    renderCalendar('/calendar?month=2026-12');

    await screen.findByTestId('day-cell-2026-12-01');
    expect(within(dayPanel()).getByRole('heading', { level: 3 }).textContent).toMatch(/1|১/);
    expect(within(dayPanel()).getByRole('heading', { level: 3 }).textContent).toMatch(
      /Dec|ডিসেম্বর/,
    );
  });

  it('drops ?panel=edit-event when it has no event id', async () => {
    renderCalendar('/calendar?month=2026-10&panel=edit-event');

    await screen.findByTestId('day-cell-2026-10-05');
    await waitFor(() => expect(window.location.search).not.toContain('edit-event'));
  });
});

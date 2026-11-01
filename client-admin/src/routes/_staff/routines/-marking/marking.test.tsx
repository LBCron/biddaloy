import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../../help/test-utils';
import { routeTree } from '../../../../routeTree.gen';

// Wednesday. Only Date is faked so msw / userEvent timers keep running.
vi.useFakeTimers({ toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});
vi.setSystemTime(new Date('2026-09-23T09:00:00.000Z'));
const TODAY = '2026-09-23';

afterEach(async () => {
  await cleanupTestState();
});

function jwt(sub: string): string {
  const payload = btoa(JSON.stringify({ sub }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const page = (data: unknown[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 100,
  totalPages: 1,
});

interface P {
  lesson: { id: string; number: number; title: string; part: number; of: number } | null;
  routine_slot_id: string;
  plan_id: string | null;
  cancelled: boolean;
  substituting: boolean;
  can_mark: boolean;
  delivery: null | {
    id: string;
    status: string;
    reason: string | null;
    note: string | null;
    is_extra: boolean;
    auto: boolean;
    recorded_at: string;
  };
  sequence: number;
}

function period(o: Partial<P> & { routine_slot_id: string }) {
  return {
    section: { id: 'section-1', name: '7-B' },
    subject: { id: 'subject-en', name_en: 'English', name_bn: 'ইংরেজি' },
    period_slot_id: 'period-1',
    sequence: 1,
    starts_at: '09:20:00',
    ends_at: '10:00:00',
    substituting: false,
    cancelled: false,
    plan_id: 'plan-1',
    lesson: { id: 'lesson-12', number: 12, title: 'Adding fractions', part: 1, of: 3 },
    delivery: null,
    can_mark: true,
    ...o,
  };
}

const DELIVERY = {
  id: 'd1',
  status: 'TAUGHT',
  reason: null,
  note: null,
  is_extra: false,
  auto: false,
  recorded_at: '2026-09-23T02:42:00.000Z',
};

const NO_DUE = { unreported_periods: 0, oldest_date: null, school_days_until_escalation: 2 };

interface Setup {
  periods?: ReturnType<typeof period>[];
  due?:
    | typeof NO_DUE
    | { unreported_periods: number; oldest_date: string; school_days_until_escalation: number };
  dayPeriods?: Record<string, ReturnType<typeof period>[]>;
}

const seen = {
  puts: [] as Record<string, unknown>[],
  bulk: 0,
  dayRequests: [] as string[],
  resolve: [] as string[],
};

function setup({ periods = [], due = NO_DUE, dayPeriods = {} }: Setup = {}) {
  seen.puts = [];
  seen.bulk = 0;
  seen.dayRequests = [];
  seen.resolve = [];
  server.use(
    http.get('/api/v1/subjects', () =>
      HttpResponse.json(
        page([{ id: 'subject-en', name_en: 'English', name_bn: 'ইংরেজি', code: 'ENG' }]),
      ),
    ),
    http.get('/api/v1/routines/rooms', () => HttpResponse.json(page([]))),
    http.get('/api/v1/classes', () => HttpResponse.json(page([]))),
    http.get('/api/v1/routines/shifts', () => HttpResponse.json(page([]))),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json(page([{ id: 'year-1', name: '2026', is_current: true }])),
    ),
    http.get('/api/v1/routines', () =>
      HttpResponse.json([
        {
          id: 'routine-1',
          academic_year_id: 'year-1',
          state: 'PUBLISHED',
          created_at: '2026-01-01',
        },
      ]),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json(page([{ id: 'teacher-1', user: { id: 'me', full_name: 'Ms Nahar' } }])),
    ),
    http.get('/api/v1/routines/resolve', ({ request }) => {
      const url = new URL(request.url);
      seen.resolve.push(`${url.searchParams.get('from')}..${url.searchParams.get('to')}`);
      return HttpResponse.json([
        {
          date: '2026-09-24',
          routine_slot_id: 'slot-next',
          section_id: 'section-1',
          period_slot_id: 'period-1',
          weekday: 4,
          subject_id: 'subject-en',
          room_id: null,
          kind: 'CLASS',
          teacher_ids: ['teacher-1'],
          substituted: false,
          cancelled: false,
        },
      ]);
    }),
    http.get('/api/v1/schools/:id/settings', () =>
      HttpResponse.json({ studyPlans: { statusDeadline: '18:00', escalateAfterSchoolDays: 2 } }),
    ),
    http.get('/api/v1/lesson-deliveries', ({ request }) => {
      const date = new URL(request.url).searchParams.get('date') ?? '';
      seen.dayRequests.push(date);
      return HttpResponse.json({
        date,
        periods: dayPeriods[date] ?? (date === '2026-09-24' ? [] : periods),
        due,
      });
    }),
    http.put('/api/v1/lesson-deliveries', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      seen.puts.push(body);
      return HttpResponse.json({ ...DELIVERY, status: body.status });
    }),
    http.post('/api/v1/lesson-deliveries/today-all-taught', () => {
      seen.bulk += 1;
      return HttpResponse.json({ created: 1, skipped: 0, deliveries: [] });
    }),
  );
}

function render(
  path = '/routines/my',
  role: 'TEACHER' | 'ADMIN' = 'TEACHER',
  locale: 'en' | 'bn' = 'en',
) {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role,
    accessToken: jwt('me'),
    locale,
  });
}

const OPEN = period({ routine_slot_id: 'slot-1' });
const DONE = period({
  routine_slot_id: 'slot-2',
  sequence: 2,
  lesson: { id: 'lesson-7', number: 7, title: 'Decimals', part: 3, of: 3 },
  delivery: DELIVERY,
});
// What the server sends for a period without a plan: no plan and no lesson (a null lesson used to crash the page).
const NO_PLAN = period({ routine_slot_id: 'slot-3', sequence: 3, plan_id: null, lesson: null });
const CANCELLED = period({
  routine_slot_id: 'slot-4',
  sequence: 4,
  cancelled: true,
  delivery: { ...DELIVERY, status: 'NOT_TAUGHT', reason: 'CANCELLED', auto: true },
});

beforeEach(() => {
  seen.puts = [];
});

describe('/routines/my marking', () => {
  it('shows one lesson-status (?) in the day header, not one per period card [#3313]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    setup({ periods: [OPEN, period({ routine_slot_id: 'slot-2' })] });
    render();
    await screen.findAllByText('Lesson 12: Adding fractions');
    await expectHelp('academics.myRoutine.field.lessonStatus');
    expect(
      document.querySelectorAll('[data-help-id="academics.myRoutine.field.lessonStatus"]'),
    ).toHaveLength(1);
  });

  it('a planned period shows its lesson; picking taught / partly sends the status', async () => {
    setup({ periods: [OPEN] });
    const user = userEvent.setup();
    render();

    expect(await screen.findByText('Lesson 12: Adding fractions')).toBeTruthy();
    const group = screen.getByRole('radiogroup', { name: /1st period|Period 1/ });
    await user.click(within(group).getByRole('radio', { name: 'Taught' }));
    await waitFor(() => expect(seen.puts).toHaveLength(1));
    expect(seen.puts[0]).toMatchObject({ status: 'TAUGHT', date: TODAY, section_id: 'section-1' });

    await user.click(within(group).getByRole('radio', { name: 'Partly' }));
    await waitFor(() => expect(seen.puts).toHaveLength(2));
    expect(seen.puts[1]).toMatchObject({ status: 'PARTLY' });
  });

  it('not taught opens the dialog first; Other needs a note; Teacher absent submits', async () => {
    setup({ periods: [OPEN] });
    const user = userEvent.setup();
    render();

    const notTaught = await screen.findByRole('radio', { name: 'Not taught' });
    await user.click(notTaught);
    const dialog = await screen.findByRole('dialog');
    expect(seen.puts).toHaveLength(0);

    const submit = within(dialog).getByRole('button', { name: 'Report as not taught' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole('radio', { name: 'Other' }));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(dialog).getByRole('textbox', { name: 'What happened' }), 'Fire drill');
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    await user.click(within(dialog).getByRole('radio', { name: 'Teacher absent' }));
    await user.click(submit);
    await waitFor(() => expect(seen.puts).toHaveLength(1));
    expect(seen.puts[0]).toMatchObject({ status: 'NOT_TAUGHT', reason: 'TEACHER_ABSENT' });
  });

  it('Enter on a reason radio reports; Enter on Cancel cancels and saves nothing', async () => {
    setup({ periods: [OPEN] });
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('radio', { name: 'Not taught' }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Teacher absent' }));
    within(dialog).getByRole('button', { name: 'Cancel' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(seen.puts).toHaveLength(0);

    await user.click(screen.getByRole('radio', { name: 'Not taught' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Teacher absent' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(seen.puts).toHaveLength(1));
    expect(seen.puts[0]).toMatchObject({ status: 'NOT_TAUGHT', reason: 'TEACHER_ABSENT' });
  });

  it('Esc closes the dialog and focus returns to the not-taught button', async () => {
    setup({ periods: [OPEN] });
    const user = userEvent.setup();
    render();

    const notTaught = await screen.findByRole('radio', { name: 'Not taught' });
    await user.click(notTaught);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(notTaught);
    expect(seen.puts).toHaveLength(0);
  });

  it('a period with no plan has no status group and links to make a study plan', async () => {
    setup({ periods: [NO_PLAN] });
    render('/routines/my', 'ADMIN');

    const link = await screen.findByRole('link', { name: 'Make a study plan' });
    expect(link.getAttribute('href')).toContain('/academics/syllabus');
    expect(link.getAttribute('href')).toContain('tab=plans');
    expect(link.getAttribute('href')).toContain('new=1');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText(/no study plan for English yet/)).toBeTruthy();
  });

  it('a planned period with no lesson left to teach still shows its status group', async () => {
    setup({ periods: [period({ routine_slot_id: 'slot-5', lesson: null })] });
    render();

    expect(await screen.findByRole('radiogroup')).toBeTruthy();
    expect(screen.queryByText("Today's lesson")).toBeNull();
  });

  it('a cancelled / auto period has no status group, only the explanation', async () => {
    setup({ periods: [CANCELLED] });
    render();

    expect(
      await screen.findByText(/cancelled in the routine, so it was reported for you/),
    ).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('the bulk button shows only with an open planned period and is the only filled button', async () => {
    setup({ periods: [OPEN, DONE, NO_PLAN, CANCELLED] });
    const user = userEvent.setup();
    const { container } = render();

    const bulk = await screen.findByRole('button', { name: "All of today's periods were taught" });
    expect(screen.getByText(/Only the 1 remaining period gets/)).toBeTruthy();
    const filled = Array.from(container.querySelectorAll('button[data-variant="default"]'));
    expect(filled).toEqual([bulk]);

    await user.click(bulk);
    await waitFor(() => expect(seen.bulk).toBe(1));
    await waitFor(() =>
      expect(seen.dayRequests.filter((d) => d === TODAY).length).toBeGreaterThan(1),
    );
  });

  it('no bulk button when every planned period is already marked', async () => {
    setup({ periods: [DONE, NO_PLAN, CANCELLED] });
    render();

    await screen.findByText(/Reported at/);
    expect(screen.queryByRole('button', { name: "All of today's periods were taught" })).toBeNull();
  });

  it('a failed save rolls the group back and shows the sentence', async () => {
    setup({ periods: [OPEN] });
    server.use(
      http.put('/api/v1/lesson-deliveries', () =>
        HttpResponse.json({ message: 'x' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    render();

    const taught = await screen.findByRole('radio', { name: 'Taught' });
    await user.click(taught);
    expect(await screen.findByText("Couldn't save. Try again.")).toBeTruthy();
    expect(taught.getAttribute('aria-checked')).toBe('false');
  });

  it('a failed not-taught save shows an alert inside the dialog', async () => {
    setup({ periods: [OPEN] });
    server.use(
      http.put('/api/v1/lesson-deliveries', () =>
        HttpResponse.json({ message: 'x' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('radio', { name: 'Not taught' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Teacher absent' }));
    await user.click(within(dialog).getByRole('button', { name: 'Report as not taught' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe("Couldn't save. Try again.");
  });

  it('a failed taught pick does not show an error in the not-taught dialog', async () => {
    setup({ periods: [OPEN] });
    server.use(
      http.put('/api/v1/lesson-deliveries', () =>
        HttpResponse.json({ message: 'x' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole('radio', { name: 'Taught' }));
    await screen.findByText("Couldn't save. Try again.");
    await user.click(screen.getByRole('radio', { name: 'Not taught' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('a successful not-taught submit returns focus to the not-taught button', async () => {
    setup({ periods: [OPEN] });
    const user = userEvent.setup();
    render();

    const notTaught = await screen.findByRole('radio', { name: 'Not taught' });
    await user.click(notTaught);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Teacher absent' }));
    await user.click(within(dialog).getByRole('button', { name: 'Report as not taught' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(notTaught));
  });

  it('a period outside the window is disabled with the admin-only caption', async () => {
    setup({ periods: [{ ...DONE, can_mark: false }] });
    render();

    expect(await screen.findByText('Only an admin can change this now.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Taught' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the covering label for a substituted period', async () => {
    setup({ periods: [{ ...OPEN, substituting: true }] });
    render();

    expect(await screen.findByText(/Covering for/)).toBeTruthy();
  });

  describe('due banner', () => {
    it('yesterday wording with a button to ?date=yesterday', async () => {
      setup({
        periods: [OPEN],
        due: { unreported_periods: 1, oldest_date: '2026-09-22', school_days_until_escalation: 1 },
      });
      const user = userEvent.setup();
      render();

      expect(await screen.findByText('1 period from yesterday not reported')).toBeTruthy();
      expect(screen.getByText(/after 1 more school day/)).toBeTruthy();
      await user.click(screen.getByRole('button', { name: "Report yesterday's periods" }));
      await waitFor(() => expect(seen.dayRequests).toContain('2026-09-22'));
    });

    it('an older date uses the "since" wording', async () => {
      setup({
        periods: [OPEN],
        due: { unreported_periods: 3, oldest_date: '2026-09-20', school_days_until_escalation: 0 },
      });
      render();

      expect(await screen.findByText(/3 periods not reported since/)).toBeTruthy();
      expect(screen.getByText('The academic coordinator and admin have been told.')).toBeTruthy();
    });

    it('no banner when nothing is unreported', async () => {
      setup({ periods: [OPEN] });
      render();

      await screen.findByText('Lesson 12: Adding fractions');
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('?date=', () => {
    it.each(['2026-09-14', '2026-09-30'])('%s falls back to today', async (d) => {
      setup({ periods: [OPEN] });
      render(`/routines/my?date=${d}`);

      expect(await screen.findByText(/^Today,/)).toBeTruthy();
      expect(seen.dayRequests[0]).toBe(TODAY);
    });

    it('a past day hides the deadline badge and the bulk button', async () => {
      setup({ dayPeriods: { '2026-09-22': [OPEN] } });
      render('/routines/my?date=2026-09-22');

      await screen.findByText('Lesson 12: Adding fractions');
      expect(screen.queryByText(/Report by/)).toBeNull();
      expect(
        screen.queryByRole('button', { name: "All of today's periods were taught" }),
      ).toBeNull();
      expect(screen.getByRole('button', { name: 'Back to today' })).toBeTruthy();
    });
  });

  it('next days load a day only once its row is expanded', async () => {
    setup({
      periods: [OPEN],
      dayPeriods: {
        '2026-09-24': [
          period({
            routine_slot_id: 'slot-n',
            plan_id: 'p',
            lesson: { id: 'l', number: 13, title: 'Subtracting fractions', part: 1, of: 2 },
          }),
        ],
      },
    });
    const user = userEvent.setup();
    render();

    const row = within(
      (await screen.findByRole('heading', { name: 'Next days' })).closest('section')!,
    ).getByRole('button');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(seen.dayRequests).not.toContain('2026-09-24');
    await user.click(row);
    expect(await screen.findByText('Lesson 13: Subtracting fractions')).toBeTruthy();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(seen.dayRequests).toContain('2026-09-24');
  });

  it('Bangla: times and counts use Bangla digits', async () => {
    setup({ periods: [OPEN, DONE] });
    render('/routines/my', 'TEACHER', 'bn');

    expect(await screen.findByText(/পাঠ ১২: Adding fractions/)).toBeTruthy();
    expect(screen.getAllByText(/৯:২০/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/9:20/);
  });

  it('has no axe violations', async () => {
    setup({ periods: [OPEN, DONE, NO_PLAN, CANCELLED] });
    const { container } = render();

    await screen.findAllByText('Lesson 12: Adding fractions');
    await expect(container).toHaveNoViolations();
  });
});

import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

// A fixed calendar date (e.g. '2026-09-10') would stop being "in the
// future" the day the test suite outlives it. 30 days out is always
// safely ahead of whenever this actually runs.
function futureDateIso(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

function registerBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    section: { id: 'section-1', section_name: 'A', class_name: 'Class 5' },
    session: {
      id: null,
      date: '2026-09-04',
      period_no: null,
      state: 'DRAFT',
      version: 0,
      marked_by_user_id: null,
      marked_at: null,
      finalized_at: null,
    },
    editable: true,
    reason_required: false,
    non_working_day: false,
    policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
    students: [
      {
        student_id: 'student-1',
        roll_number: 1,
        full_name: 'Rafi Ahmed',
        record_id: null,
        status: null,
        minutes_late: null,
        remarks: null,
        source: null,
        correction_count: 0,
      },
      {
        student_id: 'student-2',
        roll_number: 2,
        full_name: 'Nusrat Jahan',
        record_id: null,
        status: null,
        minutes_late: null,
        remarks: null,
        source: null,
        correction_count: 0,
      },
    ],
    ...overrides,
  };
}

describe('/attendance/$sectionId', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
    window.localStorage.clear();
  });

  it('renders the roster and toggles PRESENT/ABSENT on row click', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const row = await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    await user.click(row);

    expect(await screen.findByText('Present 1')).toBeTruthy();

    await user.click(row);
    expect(await screen.findByText('Absent 1')).toBeTruthy();
  });

  it('shows one h1 and a labelled date field, and writes an ISO date when a day is picked', async () => {
    const requestedDates: Array<string | null> = [];
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', ({ request }) => {
        requestedDates.push(new URL(request.url).searchParams.get('date'));
        return HttpResponse.json(registerBody());
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Class 5 – A' })).toBeTruthy();
    const user = userEvent.setup();
    // Visible label and accessible name are both "Date" (not "Attendance").
    expect(screen.getByText('Date')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Date' }));
    await user.click(document.querySelector('[data-date="2026-09-10"]') as HTMLElement);

    await waitFor(() => expect(requestedDates).toContain('2026-09-10'));
  });

  it('shows five count badges including Leave, and the Submitted badge for a finalized register', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          registerBody({
            session: {
              id: 'session-1',
              date: '2026-09-04',
              period_no: null,
              state: 'FINALIZED',
              version: 2,
              marked_by_user_id: 'user-2',
              marked_at: '2026-09-04T00:00:00.000Z',
              finalized_at: '2026-09-04T01:00:00.000Z',
            },
            students: [
              {
                student_id: 'student-1',
                roll_number: 1,
                full_name: 'Rafi Ahmed',
                record_id: 'record-1',
                status: 'LEAVE',
                minutes_late: null,
                remarks: null,
                source: 'TEACHER',
                correction_count: 0,
              },
              {
                student_id: 'student-2',
                roll_number: 2,
                full_name: 'Nusrat Jahan',
                record_id: null,
                status: null,
                minutes_late: null,
                remarks: null,
                source: null,
                correction_count: 0,
              },
            ],
          }),
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText('Leave 1')).toBeTruthy();
    expect(screen.getByText('Present 0')).toBeTruthy();
    expect(screen.getByText('Absent 0')).toBeTruthy();
    expect(screen.getByText('Late 0')).toBeTruthy();
    expect(screen.getByText('Unmarked 1')).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
  });

  it('keeps the submit bar in the content column (not fixed) and offers one primary', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const submit = await screen.findByRole('button', { name: 'Submit attendance' });
    const bar = submit.parentElement as HTMLElement;
    expect(bar.className).toContain('sticky');
    expect(bar.className).not.toContain('fixed');
    expect(within(bar).getByText('2 unmarked')).toBeTruthy();
  });

  it('toasts the translated sentence, never the server message, when submit fails with a 500', async () => {
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
      http.put('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          {
            statusCode: 500,
            message: 'relation "attendance_sessions" does not exist',
            timestamp: new Date().toISOString(),
            path: '/attendance/sections/section-1/register',
            requestId: 'req-1',
          },
          { status: 500 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByText('Rafi Ahmed'));
    await user.click(screen.getByText('Nusrat Jahan'));
    await user.click(screen.getByRole('button', { name: 'Submit attendance' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Could not save attendance'));
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  describe('[76.5.03] write gate, first-period hint, rest absent', () => {
    function mount(body: Record<string, unknown>) {
      server.use(
        http.get('/api/v1/attendance/sections/section-1/register', () =>
          HttpResponse.json(registerBody(body)),
        ),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });
    }

    it('shows the banner and no Save or marking buttons when can_write is false', async () => {
      mount({ can_write: false, write_reason: 'CLASS_TEACHER_ONLY' });
      expect(await screen.findByText(/Only the class teacher saves this register/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Submit attendance' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Mark the rest absent' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'All present' })).toBeNull();
    });

    it('shows Save and no banner when can_write is true', async () => {
      mount({ can_write: true, write_reason: null });
      expect(await screen.findByRole('button', { name: 'Submit attendance' })).toBeTruthy();
      expect(screen.queryByText(/Only the class teacher saves/)).toBeNull();
    });

    it('shows the first-period hint only when flagged', async () => {
      mount({ first_period_today: true });
      expect(await screen.findByText(/You teach the first period/)).toBeTruthy();
    });

    it('hides the first-period hint when not flagged', async () => {
      mount({ first_period_today: false });
      await screen.findByText('Rafi Ahmed');
      expect(screen.queryByText(/You teach the first period/)).toBeNull();
    });

    it('"Mark the rest absent" sends ABSENT for unmarked rows only', async () => {
      let body: { entries?: { student_id: string; status: string }[] } | null = null;
      server.use(
        http.put('/api/v1/attendance/sections/section-1/register', async ({ request }) => {
          body = (await request.json()) as typeof body;
          return HttpResponse.json({}, { status: 500 });
        }),
      );
      vi.spyOn(toast, 'error').mockImplementation(() => '');
      mount({});
      const user = userEvent.setup();
      await user.click(await screen.findByText('Rafi Ahmed')); // PRESENT
      await user.click(screen.getByRole('button', { name: 'Mark the rest absent' }));
      await user.click(screen.getByRole('button', { name: 'Submit attendance' }));
      await waitFor(() => expect(body).not.toBeNull());
      const byId = Object.fromEntries(body!.entries!.map((r) => [r.student_id, r.status]));
      expect(byId).toEqual({ 'student-1': 'PRESENT', 'student-2': 'ABSENT' });
    });
  });

  it('sends finalize: true when the register is submitted', async () => {
    let body: { finalize?: boolean } | null = null;
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
      http.put('/api/v1/attendance/sections/section-1/register', async ({ request }) => {
        body = (await request.json()) as { finalize?: boolean };
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    vi.spyOn(toast, 'error').mockImplementation(() => '');

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByText('Rafi Ahmed'));
    await user.click(screen.getByText('Nusrat Jahan'));
    await user.click(screen.getByRole('button', { name: 'Submit attendance' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.finalize).toBe(true);
  });

  it('asks for a reason when one is required, blocks an empty one, and sends it', async () => {
    const bodies: { reason?: string }[] = [];
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody({ reason_required: true })),
      ),
      http.put('/api/v1/attendance/sections/section-1/register', async ({ request }) => {
        bodies.push((await request.json()) as { reason?: string });
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    vi.spyOn(toast, 'error').mockImplementation(() => '');

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByText('Rafi Ahmed'));
    await user.click(screen.getByText('Nusrat Jahan'));
    await user.click(screen.getByRole('button', { name: 'Submit attendance' }));
    expect(await screen.findByText('Write a reason of at least 3 characters.')).toBeTruthy();
    expect(bodies).toHaveLength(0);

    await user.type(screen.getByLabelText('Why are you changing this register?'), 'late slip');
    await user.click(screen.getByRole('button', { name: 'Submit attendance' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.reason).toBe('late slip');
  });

  it('shows the reason field for a finalized register even when reason_required is false', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          registerBody({
            session: {
              id: 'session-1',
              date: '2026-09-04',
              period_no: null,
              state: 'FINALIZED',
              version: 1,
              marked_by_user_id: 'u1',
              marked_at: '2026-09-04T01:00:00.000Z',
              finalized_at: '2026-09-04T01:00:00.000Z',
            },
          }),
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByLabelText('Why are you changing this register?')).toBeTruthy();
  });

  it('shows no reason field for an in-window draft register', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByRole('button', { name: 'Submit attendance' });
    expect(screen.queryByLabelText('Why are you changing this register?')).toBeNull();
  });

  it('shows an error state with Retry when the register fails to load', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'forbidden',
            timestamp: new Date().toISOString(),
            path: '/attendance/sections/section-1/register',
            requestId: 'req-1',
          },
          { status: 403 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText("Could not load this section's attendance.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('forbidden')).toBeNull();
  });

  it('ArrowDown moves roving focus to the next row', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const firstRow = await screen.findByText('Rafi Ahmed');
    const secondRow = screen.getByText('Nusrat Jahan');
    const firstButton = firstRow.closest('button') as HTMLButtonElement;
    const secondButton = secondRow.closest('button') as HTMLButtonElement;

    firstButton.focus();
    const user = userEvent.setup();
    await user.keyboard('{ArrowDown}');

    await waitFor(() => expect(document.activeElement).toBe(secondButton));
  });

  it('shows the confirm-unmarked dialog before submitting with unmarked students', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit attendance' }));

    expect(await screen.findByText('2 students unmarked')).toBeTruthy();
  });

  it('409 conflict opens the conflict dialog with keep-mine/take-theirs', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(registerBody()),
      ),
      http.put('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'This register changed since you last loaded it',
            timestamp: new Date().toISOString(),
            path: '/attendance/sections/section-1/register',
            requestId: 'req-1',
            details: {
              code: 'ATTENDANCE_VERSION_CONFLICT',
              current_version: 1,
              register: registerBody({
                session: {
                  id: 'session-1',
                  date: '2026-09-04',
                  period_no: null,
                  state: 'DRAFT',
                  version: 1,
                  marked_by_user_id: 'user-2',
                  marked_at: '2026-09-04T00:00:00.000Z',
                  finalized_at: null,
                },
                students: [
                  {
                    student_id: 'student-1',
                    roll_number: 1,
                    full_name: 'Rafi Ahmed',
                    record_id: 'record-1',
                    status: 'ABSENT',
                    minutes_late: null,
                    remarks: null,
                    source: 'TEACHER',
                    correction_count: 0,
                  },
                  {
                    student_id: 'student-2',
                    roll_number: 2,
                    full_name: 'Nusrat Jahan',
                    record_id: null,
                    status: null,
                    minutes_late: null,
                    remarks: null,
                    source: null,
                    correction_count: 0,
                  },
                ],
              }),
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const row = await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    await user.click(row); // marks student-1 PRESENT locally
    await user.click(screen.getByText('Nusrat Jahan')); // marks student-2 PRESENT locally

    expect(await screen.findByText('Present 2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Submit attendance' }));

    expect(
      await screen.findByRole('heading', { name: 'This register changed since you loaded it' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take theirs' })).toBeTruthy();
  });

  it('"Take theirs" replaces the draft with the freshly-refetched register, not the stale one', async () => {
    const serverRegister = registerBody({
      session: {
        id: 'session-1',
        date: '2026-09-04',
        period_no: null,
        state: 'DRAFT',
        version: 1,
        marked_by_user_id: 'user-2',
        marked_at: '2026-09-04T00:00:00.000Z',
        finalized_at: null,
      },
      students: [
        {
          student_id: 'student-1',
          roll_number: 1,
          full_name: 'Rafi Ahmed',
          record_id: 'record-1',
          status: 'ABSENT',
          minutes_late: null,
          remarks: null,
          source: 'TEACHER',
          correction_count: 0,
        },
        {
          student_id: 'student-2',
          roll_number: 2,
          full_name: 'Nusrat Jahan',
          record_id: null,
          status: null,
          minutes_late: null,
          remarks: null,
          source: null,
          correction_count: 0,
        },
      ],
    });
    server.use(
      // The initial load — still the old (stale) version, deliberately
      // disagreeing with `serverRegister` below.
      http.get(
        '/api/v1/attendance/sections/section-1/register',
        () => HttpResponse.json(registerBody()),
        { once: true },
      ),
      http.put('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'This register changed since you last loaded it',
            timestamp: new Date().toISOString(),
            path: '/attendance/sections/section-1/register',
            requestId: 'req-1',
            details: { code: 'ATTENDANCE_VERSION_CONFLICT', current_version: 1 },
          },
          { status: 409 },
        ),
      ),
      // What "Take theirs" refetches — the real current server state.
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(serverRegister),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const row = await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    await user.click(row); // marks student-1 PRESENT locally
    await user.click(screen.getByText('Nusrat Jahan')); // marks student-2 PRESENT locally
    expect(await screen.findByText('Present 2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Submit attendance' }));
    await screen.findByRole('heading', { name: 'This register changed since you loaded it' });
    await user.click(screen.getByRole('button', { name: 'Take theirs' }));

    // The draft now reflects `serverRegister` (Rafi Absent, Nusrat
    // unmarked) — not the two locally-clicked PRESENT marks, and not
    // the stale first-load register either.
    await waitFor(() => expect(screen.getByText('Absent 1')).toBeTruthy());
    expect(screen.queryByText('Present 2')).toBeNull();
  });

  // [9.7]
  function outsideWindowBody() {
    return registerBody({
      editable: false,
      reason_required: true,
      policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: false },
      students: [
        {
          student_id: 'student-1',
          roll_number: 1,
          full_name: 'Rafi Ahmed',
          record_id: 'record-1',
          status: 'ABSENT',
          minutes_late: null,
          remarks: null,
          source: 'TEACHER',
          correction_count: 2,
        },
        {
          student_id: 'student-2',
          roll_number: 2,
          full_name: 'Nusrat Jahan',
          record_id: 'record-2',
          status: 'PRESENT',
          minutes_late: null,
          remarks: null,
          source: 'TEACHER',
          correction_count: 0,
        },
      ],
    });
  }

  it('[9.7] a TEACHER (no ATTENDANCE_CORRECT) gets History-only rows and the "ask an administrator" line', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(outsideWindowBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    expect(
      screen.getByText('This register is older than 3 days. Ask an administrator to correct it.'),
    ).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /More actions for/ })[0]!);
    expect(screen.queryByRole('menuitem', { name: 'Correct' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'History' })).toBeTruthy();
  });

  it('[9.7] an ADMIN (holds ATTENDANCE_CORRECT) gets a Correct option on an outside-window row', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(outsideWindowBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /More actions for/ })[0]!);
    expect(screen.getByRole('menuitem', { name: 'Correct' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'History' })).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: 'Correct' }));
    expect(await screen.findByRole('heading', { name: 'Correct attendance' })).toBeTruthy();
  });

  it('[9.7] a row with correction_count > 0 gets an "Edited" badge', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(outsideWindowBody()),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/section-1?date=2026-09-04'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    // Only Rafi Ahmed's row (correction_count: 2) carries the badge.
    expect(screen.getAllByText('Edited')).toHaveLength(1);
  });

  it('[9.7] a future date under allow_future_dates only offers LEAVE', async () => {
    const date = futureDateIso();
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          registerBody({
            session: {
              id: null,
              date,
              period_no: null,
              state: 'DRAFT',
              version: 0,
              marked_by_user_id: null,
              marked_at: null,
              finalized_at: null,
            },
            policy: { late_after: '09:00', correction_window_days: 3, allow_future_dates: true },
          }),
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [`/attendance/section-1?date=${date}`],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('Rafi Ahmed');
    const user = userEvent.setup();
    // The compact row tap only ever sets PRESENT/ABSENT directly — the
    // popover is what exposes the full allowed-status list to assert on.
    await user.click(screen.getByLabelText(/Rafi Ahmed, currently/));
    const popover = screen.getByRole('dialog', {
      name: 'Change attendance status for Rafi Ahmed',
    });
    expect(within(popover).getByRole('button', { name: 'Leave' })).toBeTruthy();
    expect(within(popover).queryByRole('button', { name: 'Present' })).toBeNull();
    expect(within(popover).queryByRole('button', { name: 'Absent' })).toBeNull();
    expect(within(popover).queryByRole('button', { name: 'Late' })).toBeNull();

    // [review] The popover only limits its own options — row-click and
    // the keyboard shortcuts are a second path to the same mutation and
    // must be rejected independently, not just hidden from the UI.
    await user.keyboard('{Escape}');
    // The row button (rendered before `AttendanceStatusControl`'s own
    // trigger, which also has "Rafi Ahmed" in its accessible name).
    const rowButtons = screen.getAllByRole('button', { name: /Rafi Ahmed/ });
    const rowButton = rowButtons[0];
    if (!rowButton) throw new Error('expected the row button to be present');
    const stillUnmarked = () =>
      screen.getByLabelText('Rafi Ahmed, currently Unmarked. Change status');

    await user.click(rowButton);
    expect(stillUnmarked()).toBeTruthy();

    await user.keyboard('p');
    expect(stillUnmarked()).toBeTruthy();

    await user.keyboard('{Shift>}p{/Shift}');
    expect(stillUnmarked()).toBeTruthy();
  });

  describe('[41.4.4] period switcher', () => {
    const PERIODS = [
      {
        period_no: 1,
        name: 'P1',
        starts_at: '08:00',
        ends_at: '08:45',
        subject_id: 'sub-1',
        subject_name: 'Maths',
        teacher_names: [],
        state: null,
      },
    ];

    function mockPeriodRoutes(periods: unknown[] = PERIODS) {
      server.use(
        http.get('/api/v1/attendance/sections/section-1/periods', () => HttpResponse.json(periods)),
      );
    }

    function periodRegister(suggested: string | null) {
      const base = registerBody();
      return {
        ...base,
        session: { ...base.session, period_no: 1 },
        students: base.students.map((st, i) => ({
          ...st,
          suggested_status: i === 0 ? suggested : null,
        })),
      };
    }

    function mockRegisters(
      periodBody: Record<string, unknown>,
      requests: Array<string | null> = [],
    ) {
      server.use(
        http.get('/api/v1/attendance/sections/section-1/register', ({ request }) => {
          const url = new URL(request.url);
          requests.push(url.searchParams.get('period_no'));
          return HttpResponse.json(url.searchParams.has('period_no') ? periodBody : registerBody());
        }),
      );
    }

    it('choosing a period updates ?period= and loads that register', async () => {
      mockPeriodRoutes();
      const requests: Array<string | null> = [];
      mockRegisters(periodRegister(null), requests);
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('tab', { name: /P1 · Maths/ }));
      await waitFor(() => expect(requests).toContain('1'));
      await user.click(screen.getByRole('tab', { name: 'Whole day' }));
      await waitFor(() =>
        expect(screen.getByRole('tab', { name: 'Whole day' }).getAttribute('aria-selected')).toBe(
          'true',
        ),
      );
    });

    it('prefills from suggested_status and shows the notice once', async () => {
      mockPeriodRoutes();
      mockRegisters(periodRegister('ABSENT'));
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04&period=1'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });

      expect(
        await screen.findByText('Students absent or on leave today are already filled in.'),
      ).toBeTruthy();
      expect(await screen.findByText('Absent 1')).toBeTruthy();
    });

    it('prefills when the period tab is picked from the day register', async () => {
      mockPeriodRoutes();
      // As in the app: the day register is saved (a session, marks), and the
      // period register answers a little later than the tab click.
      const day = registerBody();
      server.use(
        http.get('/api/v1/attendance/sections/section-1/register', async ({ request }) => {
          if (!new URL(request.url).searchParams.has('period_no')) {
            return HttpResponse.json({
              ...day,
              session: { ...day.session, id: 'day-session', version: 2 },
              students: day.students.map((st, i) => ({
                ...st,
                status: i === 0 ? 'ABSENT' : 'PRESENT',
              })),
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json(periodRegister('ABSENT'));
        }),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });

      const user = userEvent.setup();
      await screen.findByText('Absent 1');
      await user.click(await screen.findByRole('tab', { name: /P1 · Maths/ }));
      expect(
        await screen.findByText('Students absent or on leave today are already filled in.'),
      ).toBeTruthy();
      expect(await screen.findByText('Absent 1')).toBeTruthy();
    });

    it('does not prefill over an existing local draft for that period', async () => {
      window.localStorage.setItem(
        'attendance-draft:tenant-1:section-1:2026-09-04:1',
        JSON.stringify({ 'student-2': { status: 'PRESENT', minutes_late: null } }),
      );
      mockPeriodRoutes();
      mockRegisters(periodRegister('ABSENT'));
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04&period=1'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });

      await screen.findByText('Rafi Ahmed');
      await screen.findByText('Present 1');
      expect(
        screen.queryByText('Students absent or on leave today are already filled in.'),
      ).toBeNull();
      expect(screen.getByText('Absent 0')).toBeTruthy();
    });

    it('stores the day draft and the period draft under separate keys', async () => {
      mockPeriodRoutes();
      mockRegisters(periodRegister('ABSENT'));
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04&period=1'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });

      await screen.findByText('Absent 1');
      await waitFor(() =>
        expect(
          window.localStorage.getItem('attendance-draft:tenant-1:section-1:2026-09-04:1'),
        ).toContain('ABSENT'),
      );
      expect(
        window.localStorage.getItem('attendance-draft:tenant-1:section-1:2026-09-04'),
      ).toBeNull();
    });

    it("switching tabs never writes one tab's draft under another tab's key", async () => {
      mockPeriodRoutes();
      server.use(
        http.get('/api/v1/attendance/sections/section-1/register', async ({ request }) => {
          const isPeriod = new URL(request.url).searchParams.has('period_no');
          // Slow period data: the cached period register shows while this refetches.
          if (isPeriod) await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json(isPeriod ? periodRegister(null) : registerBody());
        }),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04&period=1'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });

      const user = userEvent.setup();
      await screen.findByText('Rafi Ahmed');
      await user.click(await screen.findByRole('tab', { name: 'Whole day' }));
      await waitFor(() =>
        expect(screen.getByRole('tab', { name: 'Whole day' }).getAttribute('aria-selected')).toBe(
          'true',
        ),
      );
      await user.click(await screen.findByText('Rafi Ahmed'));
      expect(await screen.findByText('Present 1')).toBeTruthy();

      const periodKey = 'attendance-draft:tenant-1:section-1:2026-09-04:1';
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      await user.click(screen.getByRole('tab', { name: /P1 · Maths/ }));
      expect(await screen.findByText('Present 0')).toBeTruthy();

      const periodWrites = setItem.mock.calls.filter(([key]) => key === periodKey);
      expect(periodWrites.length).toBeGreaterThan(0);
      for (const [, value] of periodWrites) expect(value).not.toContain('PRESENT');
    });

    it('a 403 ATTENDANCE_PERIOD_DISABLED drops ?period= and shows the day register', async () => {
      mockPeriodRoutes([]);
      server.use(
        http.get('/api/v1/attendance/sections/section-1/register', ({ request }) =>
          new URL(request.url).searchParams.has('period_no')
            ? HttpResponse.json(
                {
                  statusCode: 403,
                  message: 'Forbidden',
                  timestamp: '2026-09-04T00:00:00Z',
                  path: '/',
                  requestId: 'r',
                  details: { code: 'ATTENDANCE_PERIOD_DISABLED' },
                },
                { status: 403 },
              )
            : HttpResponse.json(registerBody()),
        ),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04&period=1'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });

      expect(await screen.findByText('Rafi Ahmed')).toBeTruthy();
    });

    it('shows the routine hint to an admin with the switch on, never to a teacher', async () => {
      mockPeriodRoutes([]);
      mockRegisters(registerBody());
      server.use(
        http.get('/api/v1/schools/tenant-1/settings', () =>
          HttpResponse.json({ attendance: { periodAttendance: { enabled: true } } }),
        ),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04'],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
      expect(
        await screen.findByText('Periods appear here once the routine is published.'),
      ).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Open routines' }).getAttribute('href')).toBe(
        '/routines',
      );
    });

    it('does not show the routine hint to a teacher', async () => {
      mockPeriodRoutes([]);
      mockRegisters(registerBody());
      renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });
      await screen.findByText('Rafi Ahmed');
      expect(screen.queryByText('Periods appear here once the routine is published.')).toBeNull();
    });
  });
  it('[2632] a save queued offline stays on the register instead of leaving for the list', async () => {
    // The list route's chunk is not precached, so an offline navigation there would fail
    // into the error fallback and a hard reload; the queued toast must survive instead.
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const toastSpy = vi.spyOn(toast, 'success').mockImplementation(() => '');
    server.use(
      http.get('/api/v1/attendance/sections/section-1/register', () =>
        HttpResponse.json(
          registerBody({
            students: [
              {
                student_id: 'student-1',
                roll_number: 1,
                full_name: 'Rafi Ahmed',
                record_id: null,
                status: null,
                minutes_late: null,
                remarks: null,
                source: null,
                correction_count: 0,
              },
            ],
          }),
        ),
      ),
    );
    try {
      const { router } = renderWithRouter(routeTree, {
        initialEntries: ['/attendance/section-1?date=2026-09-04'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });
      const user = userEvent.setup();
      await user.click(await screen.findByText('Rafi Ahmed'));
      await user.click(screen.getByRole('button', { name: 'Save on device' }));

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          "Saved on device — will sync when you're back online",
        ),
      );
      expect(router.state.location.pathname).toBe('/attendance/section-1');
    } finally {
      onLine.mockRestore();
      toastSpy.mockRestore();
    }
  });
});

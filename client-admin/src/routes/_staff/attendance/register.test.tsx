import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server, userEvent } from '@biddaloy/ui/test';
import { tenantTodayIso } from '@biddaloy/ui/utils';
import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

// `register.tsx`'s search schema validates these with `z.string().uuid()`,
// which (unlike `reports.tsx`, whose filters bag isn't schema-validated)
// enforces the real RFC 4122 variant nibble — a same-digit placeholder
// like `1111...` silently fails that check and gets dropped by `.catch()`.
const CLASS_ID = '11111111-1111-4111-8111-111111111111';
const SECTION_ID = '22222222-2222-4222-8222-222222222222';

/** Every day of `month` (`YYYY-MM`): 28 to 31 of them. Tests that use the current month must not
 * assume 31 days (November has 30, and "2026-11-31" is not a date). */
function datesOfMonth(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(y, m, 0).getDate();
  return Array.from({ length: days }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    is_working_day: true,
  }));
}

function registerRow(overrides: Record<string, unknown> = {}) {
  return {
    student_id: 'student-1',
    roll_number: 4,
    full_name: 'Karim Rahman',
    marks: { '2026-01-01': 'PRESENT', '2026-01-02': 'ABSENT' },
    summary: {
      student_id: 'student-1',
      from: '2026-01-01',
      to: '2026-01-31',
      working_days: 26,
      marked_days: 20,
      present_days: 18,
      late_days: 1,
      absent_days: 1,
      leave_days: 0,
      unmarked_days: 6,
      attendance_percentage: 90,
      policy: {
        late_counts_as_present: true,
        leave_counts_as_working_day: true,
        denominator: 'WORKING_DAYS',
      },
    },
    ...overrides,
  };
}

// The default test tenant settings say Bangla digits and month names; the tests that read
// formatted numbers/months pin the English region so locale and region agree.
const pinEnglishRegion = http.get('/api/v1/schools/:schoolId/settings', () =>
  HttpResponse.json({ version: 1, region: REGION_BD_EN }),
);

describe('/attendance/register', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('shows a (?) after the Print header action [44.3.06]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/register'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByRole('heading', { name: 'No section picked yet' });
    await screen.findAllByRole('button', { name: /^Help:/ });
    expect(
      document.querySelector('[data-help-id="attendance.attendanceRegister.action.print"]'),
    ).not.toBeNull();
  });

  it('prompts for a section instead of fetching anything when none is selected', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/register'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(
        screen.getByText('Pick a class, section and month to generate the register.'),
      ).toBeTruthy(),
    );
    expect(screen.getByRole('heading', { name: 'No section picked yet' })).toBeTruthy();
    // Kit selects and month picker, each with a visible label — no native controls.
    expect(screen.getByLabelText('Class')).toBeTruthy();
    expect(screen.getByLabelText('Section')).toBeTruthy();
    expect(screen.getByLabelText('Month')).toBeTruthy();
    expect(document.querySelector('select, input[type="month"]')).toBeNull();
    // Nothing to print yet.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(true);
  });

  it('renders 31 day columns plus totals, each cell carrying an sr-only status word, for a 31-day month', async () => {
    server.use(
      pinEnglishRegion,
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: datesOfMonth('2026-01'), rows: [registerRow()] }),
      ),
    );

    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await localeReady;

    const table = await screen.findByRole('table');
    // 31 day columns + Roll + Student + 5 total columns = 38 header cells.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(38);

    // Not just the visible "P"/"A" abbreviation — an accessible full word
    // per day cell too. `getAllByText` (not `getByText`) since "Present"/
    // "Absent" also legitimately appear once as this table's own
    // "Present"/"Absent" total-column headers.
    expect(within(table).getAllByText('Present').length).toBeGreaterThan(1);
    expect(within(table).getAllByText('Absent').length).toBeGreaterThan(1);
    // Letters come from i18n and are explained by a legend; Print is on once rows load.
    expect(within(table).getAllByText('P').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('A').length).toBeGreaterThan(0);
    expect(screen.getByText('P = Present')).toBeTruthy();
    expect(screen.getByText('— = school closed')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false);
    expect(await screen.findByText('Total 1')).toBeTruthy();
  });

  it('shows an unrecognized status as "?" / "Unknown", never the raw enum', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({
          dates: [{ date: '2026-01-01', is_working_day: true }],
          // A status this client doesn't know about yet — the DTO cast
          // in register.tsx is a type assertion, not a validation, so the
          // server can send anything.
          rows: [registerRow({ marks: { '2026-01-01': 'HALF_DAY' } })],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('table');
    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.queryByText('HALF_DAY')).toBeNull();
  });

  it('names class, section and month in the table caption', async () => {
    server.use(
      pinEnglishRegion,
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [{ id: CLASS_ID, name: 'Class 5', section_count: 1, student_count: 30 }],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ id: SECTION_ID, section_name: 'A', enrolled_count: 30 }]),
      ),
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: datesOfMonth('2026-01'), rows: [registerRow()] }),
      ),
    );

    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await localeReady;

    await waitFor(() =>
      expect(screen.getByText('Attendance register — Class 5 – A, January 2026')).toBeTruthy(),
    );
    expect(await screen.findByRole('heading', { name: 'Class 5 – A · January 2026' })).toBeTruthy();
  });

  it('shows an empty state when the section has no students', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: datesOfMonth('2026-01'), rows: [] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('No students in this section.')).toBeTruthy());
    expect(screen.getByText('The register appears once students are enrolled.')).toBeTruthy();
    // A retry cannot change an empty section — no fake action.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows an error state when the register-matrix request fails', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Could not load the register.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('falls back to the locale default region for a user without SETTINGS_MANAGE', async () => {
    let settingsRequested = false;
    server.use(
      http.get('/api/v1/schools/:schoolId/settings', () => {
        settingsRequested = true;
        return HttpResponse.json({ version: 1, region: { ...REGION_BD_EN, numerals: 'bengali' } });
      }),
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: datesOfMonth('2026-01'), rows: [registerRow()] }),
      ),
    );

    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });
    await localeReady;

    // The school settings are never read for a teacher, so the tenant's Bengali digits
    // never apply: the totals footer uses the locale-default (English) region.
    expect(await screen.findByText('Total 1')).toBeTruthy();
    expect(settingsRequested).toBe(false);
  });
});

// [41.4.3] Month edit. jsdom's matchMedia stub reports "no match" (phone) by
// default; a test flips the cached `md` query to simulate a desktop.
const MD_QUERY = '(min-width: 768px)';
function setDesktop(on: boolean) {
  (window.matchMedia(MD_QUERY) as { matches: boolean }).matches = on;
}

const EDIT_URL = `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`;

function useMatrix(putHandler?: Parameters<typeof http.put>[1]) {
  server.use(
    pinEnglishRegion,
    http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
      HttpResponse.json({
        dates: datesOfMonth('2026-01'),
        versions: { '2026-01-01': 3 },
        rows: [
          registerRow(),
          registerRow({
            student_id: 'student-2',
            roll_number: 5,
            full_name: 'Rina Akter',
            marks: { '2026-01-01': 'PRESENT' },
          }),
        ],
      }),
    ),
    ...(putHandler
      ? [http.put('/api/v1/attendance/sections/:sectionId/register-matrix', putHandler)]
      : []),
  );
}

async function openEditor(role = 'ADMIN', url = EDIT_URL) {
  const { localeReady } = renderWithRouter(routeTree, {
    initialEntries: [url],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
  await localeReady;
}

describe('/attendance/register month edit', () => {
  afterEach(async () => {
    setDesktop(false);
    await cleanupTestState();
  });

  it('hides Edit without ATTENDANCE_MARK', async () => {
    setDesktop(true);
    useMatrix();
    await openEditor('ACCOUNTANT');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('saves one item per changed date with every marked student', async () => {
    setDesktop(true);
    let body: Record<string, unknown> | undefined;
    useMatrix(async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ saved_dates: ['2026-01-01', '2026-01-03'], versions: {} });
    });
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const grid = await screen.findByRole('grid');
    // Jan 1: Karim PRESENT -> ABSENT. Jan 3: nobody marked yet -> Karim LATE.
    within(grid)
      .getByRole('gridcell', { name: /Karim Rahman, .*: Present/ })
      .focus();
    await user.keyboard('a');
    within(grid)
      .getAllByRole('gridcell', { name: /Karim Rahman, .*: Not marked/ })[0]!
      .focus();
    await user.keyboard('l');
    expect(await screen.findByText('2 cells changed')).toBeTruthy();
    expect(screen.getByText(/will be created/)).toBeTruthy();

    // All of January is past the 2-day window, so a reason is needed.
    await user.type(screen.getByLabelText(/Reason for correction/), 'Copied from paper register');
    await user.click(screen.getByRole('button', { name: 'Save (2)' }));

    await waitFor(() => expect(body).toBeTruthy());
    const days = body!.days as { date: string; base_version: number | null; entries: unknown[] }[];
    expect(days.map((d) => d.date)).toEqual(['2026-01-01', '2026-01-03']);
    expect(days[0]).toMatchObject({
      base_version: 3,
      entries: [
        { student_id: 'student-1', status: 'ABSENT' },
        { student_id: 'student-2', status: 'PRESENT' },
      ],
    });
    expect(days[1]).toMatchObject({
      base_version: null,
      entries: [{ student_id: 'student-1', status: 'LATE' }],
    });
    expect(body!.reason).toBe('Copied from paper register');
    expect(typeof body!.client_request_id).toBe('string');
    // Edit mode is left once saved.
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
  });

  it('Ctrl+S saves from the reason field, not only from the grid', async () => {
    setDesktop(true);
    let puts = 0;
    useMatrix(() => {
      puts += 1;
      return HttpResponse.json({ saved_dates: ['2026-01-01'], versions: {} });
    });
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.type(screen.getByLabelText(/Reason for correction/), 'Paper register');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(puts).toBe(1));
  });

  it('requires a reason for an old date and sends nothing without it', async () => {
    setDesktop(true);
    let puts = 0;
    useMatrix(() => {
      puts += 1;
      return HttpResponse.json({ saved_dates: [], versions: {} });
    });
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    expect(screen.getByText(/outside the correction window/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Write a reason of at least 3 letters.',
    );
    expect(puts).toBe(0);
  });

  // The school's date (Asia/Dhaka in REGION_BD_EN), never the runner's clock.
  const dhakaToday = () => tenantTodayIso(REGION_BD_EN);

  /** Today's register exists (version 1). `respond` gets the PUT count (1, 2, ...). */
  function useTodayMatrix(respond: (n: number) => Response) {
    const today = dhakaToday();
    const month = today.slice(0, 7);
    const bodies: Record<string, unknown>[] = [];
    server.use(
      pinEnglishRegion,
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({
          dates: datesOfMonth(month),
          versions: { [today]: 1 },
          rows: [registerRow({ marks: { [today]: 'PRESENT' } })],
        }),
      ),
      http.put('/api/v1/attendance/sections/:sectionId/register-matrix', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return respond(bodies.length);
      }),
    );
    return {
      bodies,
      url: `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=${month}`,
    };
  }

  it('sends a typed reason even for an in-window day', async () => {
    setDesktop(true);
    const { bodies, url } = useTodayMatrix(() =>
      HttpResponse.json({ saved_dates: [dhakaToday()], versions: {} }),
    );
    const user = userEvent.setup();
    await openEditor('ADMIN', url);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    // Inside the window: not required up front...
    expect(screen.queryByText(/outside the correction window/)).toBeNull();
    // ...but a reason the user typed is never dropped (a FINALIZED day needs one).
    await user.type(screen.getByLabelText(/Reason for correction/), '  Typed anyway ');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.reason).toBe('Typed anyway');
  });

  it('a 1-2 letter reason is an error even when none is required, not silently dropped', async () => {
    setDesktop(true);
    const { bodies, url } = useTodayMatrix(() =>
      HttpResponse.json({ saved_dates: [dhakaToday()], versions: {} }),
    );
    const user = userEvent.setup();
    await openEditor('ADMIN', url);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.type(screen.getByLabelText(/Reason for correction/), 'ok');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Write a reason of at least 3 letters.',
    );
    expect(bodies).toHaveLength(0);
  });

  it('with no reason, a 422 ATTENDANCE_REASON_REQUIRED marks the field required', async () => {
    setDesktop(true);
    // Today's register is already FINALIZED: the server asks for a reason once.
    const { bodies, url } = useTodayMatrix((n) =>
      n === 1
        ? HttpResponse.json(
            {
              statusCode: 422,
              message: 'reason',
              timestamp: new Date().toISOString(),
              path: '/attendance/sections/x/register-matrix',
              requestId: 'req-1',
              details: { code: 'ATTENDANCE_REASON_REQUIRED', dates: [dhakaToday()] },
            },
            { status: 422 },
          )
        : HttpResponse.json({ saved_dates: [dhakaToday()], versions: {} }),
    );
    const user = userEvent.setup();
    await openEditor('ADMIN', url);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Write a reason of at least 3 letters.',
    );
    expect(bodies[0]).not.toHaveProperty('reason');

    await user.type(screen.getByLabelText(/Reason for correction/), 'Paper register');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.reason).toBe('Paper register');
  });

  it("uses the tenant's correction window when it can read the settings", async () => {
    setDesktop(true);
    useMatrix();
    // Added after `useMatrix` so it wins: a 10 000-day window puts January 2026
    // inside it, so no reason is asked for up front.
    server.use(
      http.get('/api/v1/schools/:schoolId/settings', () =>
        HttpResponse.json({
          version: 1,
          region: REGION_BD_EN,
          attendance: { correctionWindowDays: 10_000 },
        }),
      ),
    );
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    expect(await screen.findByText('1 cell changed')).toBeTruthy();
    expect(screen.queryByText(/outside the correction window/)).toBeNull();
  });

  it('a 403 ATTENDANCE_WINDOW_CLOSED names the days and can drop them from the draft', async () => {
    setDesktop(true);
    useMatrix(() =>
      HttpResponse.json(
        {
          statusCode: 403,
          message: 'closed',
          timestamp: new Date().toISOString(),
          path: '/attendance/sections/x/register-matrix',
          requestId: 'req-1',
          details: { code: 'ATTENDANCE_WINDOW_CLOSED', dates: ['2026-01-01'] },
        },
        { status: 403 },
      ),
    );
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.type(screen.getByLabelText(/Reason for correction/), 'Paper register');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));

    const dialog = await screen.findByRole('dialog', { name: 'Nothing was saved' });
    expect(
      within(dialog).getByText(/can only be changed by someone who can correct attendance/)
        .textContent,
    ).toContain('2026');
    // Not "write a reason": no reason can fix a missing permission.
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove these days from my changes' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Save (0)' }).hasAttribute('disabled')).toBe(true);
  });

  it('a 422 ATTENDANCE_MATRIX_LOCKED_DATE says the day cannot be marked, not "someone changed"', async () => {
    setDesktop(true);
    let puts = 0;
    useMatrix(() => {
      puts += 1;
      return HttpResponse.json(
        {
          statusCode: 422,
          message: 'locked',
          timestamp: new Date().toISOString(),
          path: '/attendance/sections/x/register-matrix',
          requestId: 'req-1',
          details: { code: 'ATTENDANCE_MATRIX_LOCKED_DATE', dates: ['2026-01-01'] },
        },
        { status: 422 },
      );
    });
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.type(screen.getByLabelText(/Reason for correction/), 'Paper register');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));

    const dialog = await screen.findByRole('dialog', { name: 'Nothing was saved' });
    expect(within(dialog).getByText(/cannot be marked/)).toBeTruthy();
    expect(within(dialog).queryByText(/while you were editing/)).toBeNull();
    // Ctrl+S under the dialog does not resend the refused save.
    await user.keyboard('{Control>}s{/Control}');
    expect(puts).toBe(1);
    // Only the listed days are bad: drop them, keep the rest of the draft.
    await user.click(
      within(dialog).getByRole('button', { name: 'Remove these days from my changes' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Save (0)' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the conflicting dates, saves nothing, and Reload keeps edit mode with an empty draft', async () => {
    setDesktop(true);
    useMatrix(() =>
      HttpResponse.json(
        {
          statusCode: 409,
          message: 'conflict',
          timestamp: new Date().toISOString(),
          path: '/attendance/sections/x/register-matrix',
          requestId: 'req-1',
          details: { code: 'ATTENDANCE_MATRIX_CONFLICT', dates: ['2026-01-01'] },
        },
        { status: 409 },
      ),
    );
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.type(screen.getByLabelText(/Reason for correction/), 'Paper register');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));

    expect(await screen.findByText('Nothing was saved')).toBeTruthy();
    expect(screen.getByText(/while you were editing/).textContent).toContain('2026');
    await user.click(screen.getByRole('button', { name: 'Reload the month' }));
    await waitFor(() => expect(screen.queryByText('Nothing was saved')).toBeNull());
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save (0)' }).hasAttribute('disabled')).toBe(true);

    // Esc on a conflict reloads too: the stale draft never survives a dismiss.
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));
    expect(await screen.findByText('Nothing was saved')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Nothing was saved')).toBeNull());
    expect(screen.getByRole('button', { name: 'Save (0)' }).hasAttribute('disabled')).toBe(true);
  });

  it('edit mode shows a skeleton, not the old grid, while a new month loads', async () => {
    setDesktop(true);
    useMatrix();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      // February only; January falls through to `useMatrix`'s handler.
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', async ({ request }) => {
        if (new URL(request.url).searchParams.get('month') !== '2026-02') return;
        await gate;
        return HttpResponse.json({
          dates: datesOfMonth('2026-02').slice(0, 28),
          versions: {},
          rows: [registerRow({ marks: {} })],
        });
      }),
    );
    const { localeReady, router } = renderWithRouter(routeTree, {
      initialEntries: [`${EDIT_URL}&edit=true`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await localeReady;
    await screen.findByRole('grid');

    await act(() =>
      router.navigate({
        to: '/attendance/register',
        search: { class_id: CLASS_ID, section_id: SECTION_ID, month: '2026-02', edit: true },
      }),
    );
    // January's grid is gone while February loads: nothing can be edited onto it.
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    release();
    expect(await screen.findByRole('grid')).toBeTruthy();
  });

  it('asks before discarding changes on Cancel', async () => {
    setDesktop(true);
    useMatrix();
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('1 changed cell will be lost.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
  });

  it('keeps the draft when the viewport drops below md mid-edit', async () => {
    setDesktop(true);
    useMatrix();
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    expect(await screen.findByText('1 cell changed')).toBeTruthy();

    const flip = (on: boolean) =>
      act(() => {
        setDesktop(on);
        window.matchMedia(MD_QUERY).dispatchEvent(new Event('change'));
      });
    flip(false);
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
    flip(true);

    expect(await screen.findByText('1 cell changed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save (1)' })).toBeTruthy();
  });

  it('on a phone: notice, no Edit button, ?edit is ignored, day numbers link to the roster', async () => {
    useMatrix();
    await openEditor('ADMIN', `${EDIT_URL}&edit=true`);
    await screen.findByRole('table');
    expect(screen.getByText(/cannot be edited on a phone/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
    const link = screen.getAllByRole('link', { name: /Open the register of/ })[0]!;
    expect(link.getAttribute('href')).toContain(`/attendance/${SECTION_ID}`);
    expect(link.getAttribute('href')).toContain('date=2026-01-01');
  });
});

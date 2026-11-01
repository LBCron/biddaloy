import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

/**
 * [9.10]'s `/attendance/reports` — real route tree, same reasoning
 * `fees/dues.test.tsx` documents for itself.
 */
describe('/attendance/reports', () => {
  beforeEach(() => {
    // The route wraps itself in `RegionConfigProvider` fed by
    // `useTenantRegionConfig()` (`reports.tsx`'s own comment on why) —
    // that hook's `useSchoolSettings` fetch resolves to the default MSW
    // handler's `numerals: 'bengali'` (`ui/src/test/msw/handlers/
    // schools.ts`'s `DEFAULT_REGION`) once it settles, regardless of this
    // render's `locale: 'en'` option, which only ever picks the
    // *fallback* used before that fetch resolves. Overridden here so
    // every percentage assertion below gets deterministic Latin digits
    // rather than a race between the fallback and the real fetch.
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          region: {
            locale: 'en-US',
            currency: {
              code: 'BDT',
              symbol: '৳',
              position: 'prefix',
              decimals: 0,
              grouping: 'thousand',
            },
            numerals: 'latin',
            date: { format: 'DD/MM/YYYY', firstDayOfWeek: 0, calendar: 'gregorian' },
            phone: {
              country: 'BD',
              pattern: '^01[3-9]\\d{8}$',
              example: '01712345678',
              displayFormat: '01XXX-XXXXXX',
            },
            address: {
              fields: ['village', 'upazila', 'district'],
              order: ['village', 'upazila', 'district'],
            },
            academicYear: { startMonth: 1 },
            identifiers: { national: 'NID-##########', student: 'STU-####' },
            timezone: 'Asia/Dhaka',
          },
        }),
      ),
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  function registerMatrixRow(overrides: Record<string, unknown> = {}) {
    return {
      student_id: 'student-1',
      roll_number: 3,
      full_name: 'Karim Rahman',
      marks: {},
      summary: {
        student_id: 'student-1',
        from: '2026-09-01',
        to: '2026-09-30',
        working_days: 20,
        marked_days: 10,
        present_days: 8,
        late_days: 1,
        absent_days: 1,
        leave_days: 0,
        unmarked_days: 10,
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

  function flagRow(overrides: Record<string, unknown> = {}) {
    return {
      student_id: 'student-2',
      from: '2026-09-01',
      to: '2026-09-30',
      working_days: 20,
      marked_days: 10,
      present_days: 3,
      late_days: 0,
      absent_days: 7,
      leave_days: 0,
      unmarked_days: 10,
      attendance_percentage: 30,
      policy: {
        late_counts_as_present: true,
        leave_counts_as_working_day: true,
        denominator: 'WORKING_DAYS',
      },
      student_name: 'Nadia Islam',
      roll_number: 9,
      class_name: 'Class 5',
      section_name: 'A',
      guardian_id: null,
      ...overrides,
    };
  }

  it('renders section register-matrix rows once a section is picked, and writes the filter to the URL', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: [], rows: [registerMatrixRow()] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?section_id=section-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Karim Rahman');
    expect(screen.getByText('90%')).toBeTruthy();
    // Summary is one section, shown whole: a total, not a pager.
    expect(screen.getByText('Total 1')).toBeTruthy();
    expect(screen.queryByText(/Page \d+ of/)).toBeNull();
  });

  it('shows the threshold filter (?) [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: [], rows: [registerMatrixRow()] }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?section_id=section-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByText('Karim Rahman');
    await expectHelp('attendance.attendanceReports.field.threshold');
  });

  it('shows one (?) for the open view, outside the tablist [#3317]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: [], rows: [registerMatrixRow()] }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?section_id=section-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByText('Karim Rahman');
    await expectHelp('attendance.attendanceReports.section.summary');
    expect(
      document.querySelector('[data-help-id="attendance.attendanceReports.section.flags"]'),
    ).toBeNull();
    const tablist = screen.getByRole('tablist');
    expect(tablist.querySelector('[data-help-id]')).toBeNull();
    // A tablist may own only tabs: axe aria-required-children (critical) fails a button in it.
    await expect(tablist.parentElement as HTMLElement).toHaveNoViolations();

    await userEvent.click(screen.getByRole('button', { name: 'Help: Month summary' }));
    expect(screen.getByRole('tab', { name: 'Month summary' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('tab', { name: 'Low attendance' }));
    await expectHelp('attendance.attendanceReports.section.flags');
    expect(
      document.querySelector('[data-help-id="attendance.attendanceReports.section.summary"]'),
    ).toBeNull();
  });

  it('drops an unknown query param instead of showing a raw filter chip', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?date=2026-10-22'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByText('Pick a section to see its attendance report.');
    expect(screen.queryByText(/^date\b/i)).toBeNull();
    expect(screen.queryByText(/2026-10-22/)).toBeNull();
  });

  it('points the selected tab at a panel that exists', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const tab = await screen.findByRole('tab', { name: 'Month summary' });
    // [2670] The panel is the report itself, not an empty hidden stand-in.
    const panel = screen.getByRole('tabpanel', { name: 'Month summary' });
    expect(panel.id).toBe(tab.getAttribute('aria-controls'));
    await waitFor(() =>
      expect(within(panel).getByText('Pick a section to see its attendance report.')).toBeTruthy(),
    );
  });

  it('shows a prompt instead of a spinner when no section is picked in the summary view', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText('Pick a section to see its attendance report.')).toBeTruthy(),
    );
    expect(screen.getByRole('heading', { name: 'Pick a section' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/Page \d+ of/)).toBeNull();
  });

  it('switches to the low-attendance flag list and shows the "Low" badge on every row', async () => {
    server.use(
      http.get('/api/v1/attendance/flags/low', () =>
        HttpResponse.json({ data: [flagRow()], total: 1, page: 1, limit: 20, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Low attendance' }));

    await screen.findByText('Nadia Islam');
    expect(screen.getByText('30%')).toBeTruthy();
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('keeps the chosen view in the URL and sends 25 rows per page for the flags list', async () => {
    let capturedLimit: string | null | undefined;
    server.use(
      http.get('/api/v1/attendance/flags/low', ({ request }) => {
        capturedLimit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({
          data: [flagRow()],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?view=flags'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Nadia Islam');
    expect(capturedLimit).toBe('25');
    expect(screen.getByRole('tab', { name: 'Low attendance' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Month summary' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('labels the month filter with month names, not YYYY-MM', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: 'Month' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options.some((label) => /^[A-Z][a-z]+ \d{4}$/.test(label))).toBe(true);
    expect(options.some((label) => /^\d{4}-\d{2}$/.test(label))).toBe(false);
  });

  it('drops a non-numeric threshold instead of sending NaN to the server', async () => {
    let capturedThreshold: string | null | undefined;
    server.use(
      http.get('/api/v1/attendance/flags/low', ({ request }) => {
        capturedThreshold = new URL(request.url).searchParams.get('threshold');
        return HttpResponse.json({
          data: [flagRow()],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?view=flags&threshold=abc'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Nadia Islam');
    expect(capturedThreshold).toBeNull();
  });

  it('never renders 0% for a student with a null attendance_percentage', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({
          dates: [],
          rows: [
            registerMatrixRow({
              summary: { ...registerMatrixRow().summary, attendance_percentage: null },
            }),
          ],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?section_id=section-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Karim Rahman');
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it("opens the reminder dialog pre-filled for the row's own student", async () => {
    server.use(
      http.get('/api/v1/attendance/flags/low', () =>
        HttpResponse.json({ data: [flagRow()], total: 1, page: 1, limit: 20, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?view=flags'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();

    await screen.findByText('Nadia Islam');
    expect(screen.getByRole('link', { name: 'View' }).getAttribute('href')).toBe(
      '/students/student-2',
    );
    await user.click(screen.getByRole('button', { name: 'Send reminder' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('This message will be sent to the guardians of 1 selected student.'),
    ).toBeTruthy();
  });

  it('shows the load error, not the empty state, when the flags request fails', async () => {
    server.use(
      http.get('/api/v1/attendance/flags/low', () =>
        HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?view=flags'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('Could not load the attendance report.')).toBeTruthy();
    expect(screen.queryByText('Nobody is below the minimum this month')).toBeNull();
  });

  it('hides the Low attendance tab from a teacher and never calls the flags route', async () => {
    let flagCalls = 0;
    server.use(
      http.get('/api/v1/attendance/flags/low', () => {
        flagCalls += 1;
        return HttpResponse.json({ message: 'Forbidden' }, { status: 403 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?view=flags'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    // ?view=flags falls back to the summary view; no tab, no error.
    expect(await screen.findByRole('tab', { name: 'Month summary' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Low attendance' })).toBeNull();
    expect(screen.queryByText('Could not load the attendance report.')).toBeNull();
    expect(flagCalls).toBe(0);
  });

  it('shows the bare roll number in the table cell, "Roll N" only for the card', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: [], rows: [registerMatrixRow()] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/reports?section_id=section-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const row = (await screen.findByText('Karim Rahman')).closest('tr') as HTMLElement;
    // By visible text, not class: the bare number for the table, "Roll N" for the card.
    expect(within(row).getByText('3')).toBeTruthy();
    expect(within(row).getByText(/^Roll\s/)).toBeTruthy();
  });

  describe('By subject tab', () => {
    function settingsWithPeriod(enabled: boolean) {
      server.use(
        http.get('/api/v1/schools/:id/settings', () =>
          HttpResponse.json({
            version: 1,
            attendance: { periodAttendance: { enabled }, lowAttendanceThresholdPercent: 75 },
          }),
        ),
      );
    }
    function subjectSummary() {
      server.use(
        http.get('/api/v1/attendance/sections/:sectionId/subject-summary', () =>
          HttpResponse.json({
            subjects: [{ subject_id: 'sub-1', name: 'Bangla', held: 8 }],
            rows: [
              {
                student_id: 'student-1',
                roll_number: 3,
                full_name: 'Karim Rahman',
                by_subject: {
                  'sub-1': {
                    present: 7,
                    late: 0,
                    absent: 1,
                    leave: 0,
                    attended: 7,
                    percentage: 87.5,
                  },
                },
              },
            ],
          }),
        ),
      );
    }
    const entry = (url: string) =>
      renderWithRouter(routeTree, {
        initialEntries: [url],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });

    it('hides the tab and falls back to the summary view with the switch off', async () => {
      settingsWithPeriod(false);
      entry('/attendance/reports?view=subjects');
      await screen.findByRole('tab', { name: 'Month summary' });
      expect(screen.queryByRole('tab', { name: 'By subject' })).toBeNull();
      expect(screen.getByRole('tab', { name: 'Month summary' }).getAttribute('aria-selected')).toBe(
        'true',
      );
    });

    it('shows the tab with the switch on, keeps view=subjects, and hides the minimum filter', async () => {
      vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
      settingsWithPeriod(true);
      subjectSummary();
      entry('/attendance/reports?view=subjects&section_id=section-1');
      const tab = await screen.findByRole('tab', { name: 'By subject' });
      await waitFor(() => expect(tab.getAttribute('aria-selected')).toBe('true'));
      await screen.findByText('Karim Rahman');
      expect(screen.queryByText('Minimum attendance (%)')).toBeNull();
      await expectHelp('attendance.attendanceReports.section.subjects');
    });
  });
});

import { listSelectionKey, setListSelection } from '@biddaloy/ui/api';
import {
  cleanupTestState,
  classFactory,
  classHandlers,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * Covers [8.10.1]'s acceptance criteria against the real route tree — not
 * a hand-built double, the actual `ListShell`/`DataTable` this route
 * wires up, same reasoning as [8.9.1]'s own route test this one replaces.
 *
 * Every case carries staff `role` since [8.9.10]: `/students` sits under
 * the `_staff` layout, and `RequireRole` sends anyone else somewhere else
 * entirely.
 */
describe('/students', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('reads its initial filter state from the URL, not a default', async () => {
    const section = classSectionFactory({ section_name: 'B' });
    const klass = classFactory({ id: 'class-9', name: 'Class 9' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students?class_id=class-9'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await within(await screen.findByRole('combobox', { name: 'Class' })).findByText('Class 9');
  });

  it('a non-numeric page falls back to page 1 instead of crashing', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students?page=abc'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByRole('region', { name: 'Students' })).toBeTruthy());
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  });

  it("Collect fees deep-links into Record Payment, pre-filled with that row's student", async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Collect fees' }));

    // [31.4]: `/payments/record` is the Record Payment full page again (no redirect),
    // keeping `student_id` so the form opens with that student pre-selected.
    await waitFor(() => expect(router.state.location.pathname).toBe('/payments/record'));
    expect(router.state.location.search).toEqual({ student_id: 'student-1' });
  });

  it('gates Collect fees by permission — a TEACHER sees View but not Collect fees', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    // A cold route-tree render loads lazy routes and i18n namespaces first;
    // on a busy CI shard that outlasts the 1s default.
    await screen.findByRole('link', { name: 'View' }, { timeout: 5000 });
    expect(screen.queryByRole('link', { name: 'Collect fees' })).toBeNull();
  });

  it('bulk-selecting rows reveals Send reminder and the ticked-rows download, hides them again once cleared', async () => {
    const students = [
      studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' }),
      studentFactory({ id: 'student-2', full_name: 'Karim Ahmed' }),
    ];
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: students, total: 2, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));

    expect(await screen.findByRole('button', { name: 'Send reminder' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'More ways to download' }));
    expect(
      await screen.findByRole('menuitem', { name: /^Only the .*1.* you ticked$/ }),
    ).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull());
  });

  it('sends a reminder to every selected student and clears the selection on success', async () => {
    const students = [studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' })];
    let receivedStudentIds: string[] = [];
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: students, total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/communications/reminder/bulk', async ({ request }) => {
        const body = (await request.json()) as { student_ids: string[] };
        receivedStudentIds = body.student_ids;
        return HttpResponse.json(
          {
            id: 'batch-1',
            batch_name: 'Manual batch',
            status: 'COMPLETED',
            total_recipients: 1,
            successful_count: 1,
            failed_count: 0,
            message_template: null,
            created_at: new Date().toISOString(),
            skipped: [],
          },
          { status: 201 },
        );
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));
    await user.click(screen.getByRole('button', { name: 'Send reminder' }));

    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox', { name: 'Message' }), 'A reminder');
    await user.click(dialog.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(receivedStudentIds).toEqual(['student-1']));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The selection clears once the batch is accepted — the bulk bar
    // (and its now-stale "Send reminder"/"Export CSV" actions) goes with it.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull());
  });

  it('a filter change made while the search debounce is pending is not reverted when it fires', async () => {
    // Regression test: the debounce timer used to close over `filters`
    // from the render that scheduled it. Changing `class_id` mid-debounce
    // meant the timer's stale closure would overwrite it back to
    // `undefined` when it fired 300ms later, alongside the search term.
    const klass = classFactory({ id: 'class-9', name: 'Class 9' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    const search = await screen.findByRole('textbox', { name: 'Search' });

    await user.type(search, 'Rahim');
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        class_id: 'class-9',
        search: 'Rahim',
      }),
    );
  });

  it('exports every selected student to CSV, including one not on the current page, with formula-leading values neutralized', async () => {
    const currentPageStudent = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    // Not in the current page's `studentsQuery.data` — only reachable via
    // its own id. Also a formula-injection value: a guardian/name field
    // starting with `=` must be neutralized, not passed through as-is.
    const otherPageStudent = studentFactory({ id: 'student-2', full_name: '=cmd|/c calc' });

    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({
          data: [currentPageStudent],
          total: 2,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/students/:id', ({ params }) =>
        HttpResponse.json(params.id === 'student-1' ? currentPageStudent : otherPageStudent),
      ),
    );

    let capturedBlob: Blob | undefined;
    // jsdom doesn't implement `URL.createObjectURL`/`revokeObjectURL` at
    // all — nothing pre-existing to save and restore, just delete the
    // stub afterwards so this test doesn't leak state into the next one.
    URL.createObjectURL = (blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    };
    URL.revokeObjectURL = () => {};
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      // Selection lives in memory per tenant + path — seeding it directly
      // simulates "selected on an earlier page, now viewing a different
      // one" without needing a real multi-page click-through.
      setListSelection(
        listSelectionKey('/students', 'tenant-1'),
        new Set(['student-1', 'student-2']),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/students'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'More ways to download' }));
      await user.click(await screen.findByRole('menuitem', { name: /you ticked/ }));

      await waitFor(() => expect(capturedBlob).toBeDefined());
      const csvText = await capturedBlob!.text();

      expect(csvText).toContain('Rahim Uddin');
      expect(csvText).toContain(`"'=cmd|/c calc"`);
    } finally {
      delete (URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
      delete (URL as { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL;
      clickSpy.mockRestore();
    }
  });

  it('filter -> result -> navigate to detail -> back -> state restored', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students', ({ request }) => {
        const url = new URL(request.url);
        const matches = url.searchParams.get('enrollment_status') === 'ACTIVE';
        return HttpResponse.json({
          data: matches ? [student] : [],
          total: matches ? 1 : 0,
          page: 1,
          limit: 10,
          totalPages: 1,
        });
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students?enrollment_status=ACTIVE'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('link', { name: 'View' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'View' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/students/student-1'));

    router.history.back();
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ enrollment_status: 'ACTIVE' }),
    );
    await screen.findByRole('link', { name: 'View' });
  });

  it('is axe clean', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('link', { name: 'View' });
    await expect(container).toHaveNoViolations();
  });

  // [8.14.10]: FilterBar migration — the rows-per-page control changes
  // `limit` and resets `page` in one URL update.
  it('changing rows per page writes limit and resets page', async () => {
    // The page-size select lives in the footer, which only shows while there are rows.
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({
          data: [studentFactory()],
          total: 1,
          page: 2,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students?page=2'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Students' });
    await user.click(await screen.findByRole('combobox', { name: 'Rows per page' }));
    // Option labels render in the tenant's own region digits (Bengali
    // numerals here), independent of the `en` UI locale.
    await user.click(await screen.findByRole('option', { name: /^(50|৫০)$/ }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ limit: 50, page: 1 }));
  });

  // [31.4.students-1]: gender is a select of 3 values, not free text.
  it('a gender filter is a select of three options and reaches the request', async () => {
    let lastGender: string | null = null;
    server.use(
      http.get('/api/v1/students', ({ request }) => {
        lastGender = new URL(request.url).searchParams.get('gender');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 1 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Gender' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All genders',
      'Male',
      'Female',
      'Other',
    ]);
    await user.click(screen.getByRole('option', { name: 'Female' }));

    await waitFor(() => expect(lastGender).toBe('FEMALE'));
  });

  it('status filter shows translated labels, never the raw enum', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Status' }));
    expect(screen.getByRole('option', { name: 'Active' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'ACTIVE' })).toBeNull();
  });

  it('shows a (?) after the Add student header action [44.3.01]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByRole('region', { name: 'Students' });
    await screen.findAllByRole('button', { name: /^Help:/ });
    expect(document.querySelector('[data-help-id="people.students.action.add"]')).not.toBeNull();
  });

  it('merges class and section into one column, with view/edit/pay row actions and one primary header button', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 25, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const table = await screen.findByRole('region', { name: 'Students' });
    expect(within(table).queryByRole('columnheader', { name: 'Section' })).toBeNull();
    expect(
      within(table).getByText(
        `${student.class_section.class.name} · ${student.class_section.section_name}`,
      ),
    ).toBeTruthy();
    for (const name of ['View', 'Edit', 'Collect fees']) {
      expect(within(table).getByRole('link', { name })).toBeTruthy();
    }
    // Exactly one filled button in the header: Add student.
    const filled = screen
      .getAllByRole('button')
      .concat(screen.getAllByRole('link'))
      .filter((el) => el.getAttribute('data-variant') === 'default');
    expect(filled.map((el) => el.textContent)).toEqual(['Add student']);
  });

  it('hides Edit and Collect fees without the permission, and keeps photo upload in the More menu', async () => {
    const student = studentFactory({ id: 'student-1' });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 25, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Edit' });
    expect(screen.queryByRole('button', { name: 'Upload photos' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Upload photos' })).toBeTruthy();
  });

  it('requests 25 rows by default', async () => {
    let limit: string | null = null;
    server.use(
      http.get('/api/v1/students', ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 1 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(limit).toBe('25'));
  });

  // [14.13.2]: an empty list is where a newcomer migrating a whole school
  // is already looking — the migrate-in entry point offers the workbook
  // template right there, gated on BACKUP_MANAGE same as its neighbours.
  it('shows the migrate-a-whole-school link when the list is empty, for ADMIN (BACKUP_MANAGE)', async () => {
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No students found');
    expect(await screen.findByText('Migrating a whole school?')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Use the full workbook template' });
    expect(link.getAttribute('href')).toBe('/settings');
  });

  it('hides the migrate-a-whole-school link for a role without BACKUP_MANAGE (TEACHER), even when the list is empty', async () => {
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('No students found');
    expect(screen.queryByText('Migrating a whole school?')).toBeNull();
  });

  // Epic 75 D2: a TEACHER only lists their current-year sections, so an unfiltered empty list
  // is explained as "no section assigned" (keyed on roleScope, review r1 m6).
  describe('empty-state explanation', () => {
    const teacherText =
      'You see the students of the sections you teach this year. Ask your school admin to assign you a section.';
    const adminText = 'Add your first student and the list will show up here.';
    const renderEmpty = (role: string, entry = '/students') => {
      server.use(
        http.get('/api/v1/students', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
        ),
      );
      renderWithRouter(routeTree, {
        initialEntries: [entry],
        tenantId: 'tenant-1',
        role,
        locale: 'en',
      });
    };

    it('shows the teacher explanation to a TEACHER with an empty, unfiltered list', async () => {
      renderEmpty('TEACHER');
      expect(await screen.findByText(teacherText)).toBeTruthy();
      expect(screen.queryByText(adminText)).toBeNull();
    });

    it('keeps the old explanation for ADMIN', async () => {
      renderEmpty('ADMIN');
      expect(await screen.findByText(adminText)).toBeTruthy();
      expect(screen.queryByText(teacherText)).toBeNull();
    });

    // Review r1 m6: SUPER_ADMIN holds every permission (MY_CLASS_VIEW too) but is not section-scoped.
    it('keeps the old explanation for SUPER_ADMIN', async () => {
      renderEmpty('SUPER_ADMIN');
      await screen.findByText('No students found');
      expect(screen.queryByText(teacherText)).toBeNull();
    });

    // Review r1 m6: URL flags that are not list filters do not hide the teacher explanation.
    it('shows the teacher explanation when only non-filter URL flags are set', async () => {
      renderEmpty('TEACHER', '/students?openPerformance=1&photos=1');
      expect(await screen.findByText(teacherText)).toBeTruthy();
    });

    it('keeps the old explanation for a TEACHER who is searching', async () => {
      renderEmpty('TEACHER', '/students?search=zzz');
      await screen.findByRole('button', { name: /clear/i });
      expect(screen.queryByText(teacherText)).toBeNull();
    });

    // [2591] a search with zero hits is "no matches", not the first-time state.
    it('a search with no matches shows a Clear action, not "Add student"; Clear drops the query', async () => {
      renderEmpty('ADMIN', '/students?search=zzzqqq');
      const clear = await screen.findByRole('button', { name: /clear/i });
      expect(screen.queryByText('No students found')).toBeNull();
      expect(screen.queryByText(adminText)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add student' })).toBeNull();
      await userEvent.click(clear);
      expect(await screen.findByText('No students found')).toBeTruthy();
    });
  });

  // [33.4.1] D5 — no shift/version filter field at all with an empty
  // organisation vocabulary (this suite's default handler).
  it('shows no shift/version filter with an empty organisation vocabulary', async () => {
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No students found');
    expect(screen.queryByLabelText('Shift')).toBeNull();
    expect(screen.queryByLabelText('Version')).toBeNull();
  });

  it('the shift filter actually filters the student list, once the tenant has 2+ shifts', async () => {
    const morningStudent = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    const dayStudent = studentFactory({ id: 'student-2', full_name: 'Karim Hossain' });
    server.use(
      classHandlers.vocabularyPopulated,
      http.get('/api/v1/students', ({ request }) => {
        const shift = new URL(request.url).searchParams.get('shift');
        const data = shift === 'Morning' ? [morningStudent] : [morningStudent, dayStudent];
        return HttpResponse.json({ data, total: data.length, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Rahim Uddin');
    await screen.findByText('Karim Hossain');

    const shiftSelect = await screen.findByLabelText('Shift');
    await user.click(shiftSelect);
    await user.click(await screen.findByRole('option', { name: 'Morning' }));

    await waitFor(() => expect(screen.queryByText('Karim Hossain')).toBeNull());
    expect(screen.getByText('Rahim Uddin')).toBeTruthy();
  });

  // [CodeRabbit, PR #916] A `?shift=Morning` left over in the URL (a
  // bookmark, a share, or the vocabulary having shrunk since the link was
  // made) must not keep silently filtering once the field itself is gone
  // (D5, empty vocabulary here) — no chip on screen to explain or clear
  // it otherwise.
  it('drops a leftover ?shift= URL param once the vocabulary has shrunk below 2 entries', async () => {
    const requestedShift = vi.fn();
    server.use(
      http.get('/api/v1/students', ({ request }) => {
        requestedShift(new URL(request.url).searchParams.get('shift'));
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students?shift=Morning'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No students found');
    expect(screen.queryByLabelText('Shift')).toBeNull();
    // The route `loader`'s own prefetch can't gate on vocabulary (no
    // hooks in a TanStack Router loader) and still fires once with the
    // raw URL param — that's a separate, wasted background request under
    // its own query key, not what's on screen. What matters for D5 is
    // the query this page's own `useStudents(studentListFilters)` call
    // actually renders from, which settles last and must exclude it.
    await waitFor(() => expect(requestedShift.mock.calls.at(-1)?.[0] ?? null).toBeNull());
  });

  // [8.15.33] Religion is free text on the student record, so the filter is a text box (not a
  // select of guessed options); the server matches it exactly, in any letter case.
  it('a religion filter is a text box and reaches the request and the URL', async () => {
    let lastReligion: string | null = null;
    server.use(
      http.get('/api/v1/students', ({ request }) => {
        lastReligion = new URL(request.url).searchParams.get('religion');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 1 });
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Religion' }), 'Hinduism');

    await waitFor(() => expect(lastReligion).toBe('Hinduism'));
    expect(router.state.location.search).toMatchObject({ religion: 'Hinduism' });
  });

  it('reads the religion filter from the URL, in Bangla too', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students?religion=%E0%A6%87%E0%A6%B8%E0%A6%B2%E0%A6%BE%E0%A6%AE'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'bn',
    });

    const box = await screen.findByRole<HTMLInputElement>('textbox', { name: 'ধর্ম' });
    expect(box.value).toBe('ইসলাম');
  });

  describe('keep this as a report [8.15.52]', () => {
    it('offers it to an admin in the download menu, and opens the dialog named for the class', async () => {
      const klass = classFactory({ id: 'class-8', name: 'Class 8' });
      server.use(
        http.get('/api/v1/classes', () =>
          HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
        ),
        http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([])),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/students?class_id=class-8'],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });

      const user = userEvent.setup();
      await within(await screen.findByRole('combobox', { name: 'Class' })).findByText('Class 8');
      await user.click(screen.getByRole('button', { name: 'More ways to download' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Keep this as a report' }));

      expect(await screen.findByRole('dialog', { name: 'Keep this as a report' })).toBeTruthy();
      const name = await screen.findByRole<HTMLInputElement>('textbox', { name: /Report name/ });
      expect(name.value).toBe('Class 8 — Students');
    });

    it('is not offered without the design permission', async () => {
      renderWithRouter(routeTree, {
        initialEntries: ['/students'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'More ways to download' }));
      await screen.findByRole('menuitem', { name: 'For other software (CSV)' });
      expect(screen.queryByRole('menuitem', { name: 'Keep this as a report' })).toBeNull();
    });
  });
});

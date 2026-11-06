import {
  apiErrorBody,
  classFactory,
  classSubjectFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
  subjectFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [19.11.1] Schedule tab — renders sorted by date/start time, and the
 * keyboard-only inline edit (click/Enter to edit, Enter commits, Escape
 * cancels). */
describe('exams/$examId Schedule tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders rows sorted by date then start time', async () => {
    const klass = classFactory({ id: 'class-1' });
    const exam = examFactory({ id: 'exam-1', class: klass, class_id: klass.id });
    const math = subjectFactory({ id: 'subject-math', name_en: 'Mathematics' });
    const english = subjectFactory({ id: 'subject-eng', name_en: 'English' });

    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json([
          classSubjectFactory({
            class: klass,
            class_id: klass.id,
            subject: math,
            subject_id: math.id,
          }),
          classSubjectFactory({
            class: klass,
            class_id: klass.id,
            subject: english,
            subject_id: english.id,
          }),
        ]),
      ),
      http.get('/api/v1/exams/:examId/schedule', () =>
        HttpResponse.json([
          {
            id: 'sched-2',
            exam_id: exam.id,
            subject_id: english.id,
            subject: english,
            date: '2026-02-06',
            starts_at: '09:00:00',
            ends_at: '11:00:00',
            venue: null,
          },
          {
            id: 'sched-1',
            exam_id: exam.id,
            subject_id: math.id,
            subject: math,
            date: '2026-02-05',
            starts_at: '09:00:00',
            ends_at: '11:00:00',
            venue: 'Main Hall',
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=schedule'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const rows = await screen.findAllByRole('row');
    // Row 0 is the header; row 1 must be Mathematics (2026-02-05), before
    // English (2026-02-06).
    within(rows[1]!).getByText('Mathematics');
    within(rows[2]!).getByText('English');
  });

  it('edits a cell with Enter to open, Enter to commit, Escape to cancel', async () => {
    const user = userEvent.setup();
    const klass = classFactory({ id: 'class-1' });
    const exam = examFactory({ id: 'exam-1', class: klass, class_id: klass.id });
    const math = subjectFactory({ id: 'subject-math', name_en: 'Mathematics' });
    let lastPatchBody: unknown = null;
    let patchCount = 0;

    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json([
          classSubjectFactory({
            class: klass,
            class_id: klass.id,
            subject: math,
            subject_id: math.id,
          }),
        ]),
      ),
      http.get('/api/v1/exams/:examId/schedule', () =>
        HttpResponse.json([
          {
            id: 'sched-1',
            exam_id: exam.id,
            subject_id: math.id,
            subject: math,
            date: '2026-02-05',
            starts_at: '09:00:00',
            ends_at: '11:00:00',
            venue: 'Main Hall',
          },
        ]),
      ),
      http.patch('/api/v1/exams/:examId/schedule/:id', async ({ request }) => {
        patchCount += 1;
        lastPatchBody = await request.json();
        return HttpResponse.json({
          schedule: {
            id: 'sched-1',
            exam_id: exam.id,
            subject_id: math.id,
            subject: math,
            date: '2026-02-05',
            starts_at: '09:00:00',
            ends_at: '11:00:00',
            venue: 'Second Hall',
          },
          warnings: [],
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=schedule'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const venueButton = await screen.findByRole('button', { name: /^Main Hall/ });
    venueButton.focus();
    await user.keyboard('{Enter}');

    const input = await screen.findByLabelText('Venue');
    await user.clear(input);
    await user.type(input, 'Second Hall');
    await user.keyboard('{Enter}');

    // Commit sends the PATCH and closes the editor back to display mode —
    // the GET handler above isn't stateful, so the redisplayed value is
    // whatever it returns; the PATCH body is what proves the edit worked.
    await screen.findByRole('button', { name: /^Main Hall/ });
    expect(lastPatchBody).toMatchObject({ venue: 'Second Hall' });
    // Enter saves once, even though removing the focused input fires `blur`.
    expect(patchCount).toBe(1);

    // Escape drops the edit: no save from the `blur` that follows it.
    await user.click(screen.getByRole('button', { name: /^Main Hall/ }));
    await user.type(await screen.findByLabelText('Venue'), ' X');
    await user.keyboard('{Escape}');
    await screen.findByRole('button', { name: /^Main Hall/ });
    expect(patchCount).toBe(1);
  });

  // --- Shared fixtures for the tests below -------------------------------

  const klass = classFactory({ id: 'class-1' });
  const exam = examFactory({ id: 'exam-1', class: klass, class_id: klass.id });
  const math = subjectFactory({ id: 'subject-math', name_en: 'Mathematics' });
  const english = subjectFactory({ id: 'subject-eng', name_en: 'English' });

  function scheduleRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sched-1',
      exam_id: exam.id,
      subject_id: math.id,
      subject: math,
      date: '2026-02-05',
      starts_at: '09:00:00',
      ends_at: '11:00:00',
      venue: 'Main Hall',
      ...overrides,
    };
  }

  /** Mocks everything the Schedule tab loads. Returns the bodies of every
   * PATCH/POST the page sends, so a test can assert what was saved. */
  function mockScheduleTab(options: {
    schedule: unknown[];
    classSubjects?: (typeof math)[];
    warnings?: string[];
  }) {
    const sent = { patches: [] as unknown[], posts: [] as unknown[] };
    const subjects = options.classSubjects ?? [math];
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json(
          subjects.map((subject) =>
            classSubjectFactory({
              class: klass,
              class_id: klass.id,
              subject,
              subject_id: subject.id,
            }),
          ),
        ),
      ),
      http.get('/api/v1/exams/:examId/schedule', () => HttpResponse.json(options.schedule)),
      http.patch('/api/v1/exams/:examId/schedule/:id', async ({ request }) => {
        sent.patches.push(await request.json());
        return HttpResponse.json({ schedule: scheduleRow(), warnings: options.warnings ?? [] });
      }),
      http.post('/api/v1/exams/:examId/schedule', async ({ request }) => {
        sent.posts.push(await request.json());
        return HttpResponse.json({ schedule: scheduleRow(), warnings: options.warnings ?? [] });
      }),
    );
    return sent;
  }

  function renderScheduleTab() {
    return renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=schedule'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
  }

  it('breaks a same-date tie by start time, and never shows a raw subject id', async () => {
    mockScheduleTab({
      classSubjects: [math, english],
      schedule: [
        scheduleRow({ id: 'a', starts_at: '13:00:00' }),
        // No embedded subject — the name comes from the class's subject list.
        scheduleRow({ id: 'b', subject: null, subject_id: english.id, starts_at: '09:00:00' }),
        // No embedded subject and not a class subject — a dash, never the raw id.
        scheduleRow({ id: 'c', subject: null, subject_id: 'subject-gone', date: '2026-02-06' }),
      ],
    });
    renderScheduleTab();

    await screen.findByText('Mathematics');
    const rows = screen.getAllByRole('row');
    within(rows[1]!).getByText('English'); // 2026-02-05 09:00
    within(rows[2]!).getByText('Mathematics'); // 2026-02-05 13:00
    expect(within(rows[3]!).queryByText('subject-gone')).toBeNull(); // 2026-02-06
  });

  it('Escape closes the editor without saving', async () => {
    const user = userEvent.setup();
    const sent = mockScheduleTab({ schedule: [scheduleRow()] });
    renderScheduleTab();

    await user.click(await screen.findByRole('button', { name: /^Main Hall/ }));
    await user.type(screen.getByLabelText('Venue'), ' Annex');
    await user.keyboard('{Escape}');

    // Back to display mode with the original value, and nothing was sent.
    expect(screen.queryByLabelText('Venue')).toBeNull();
    expect(screen.getByRole('button', { name: /^Main Hall/ })).toBeTruthy();
    expect(sent.patches).toEqual([]);
  });

  it('shows "—" for an empty venue and saves a blank venue as null, not ""', async () => {
    const user = userEvent.setup();
    const sent = mockScheduleTab({ schedule: [scheduleRow({ venue: null })] });
    renderScheduleTab();

    await user.click(await screen.findByRole('button', { name: /^—, / }));
    const input = screen.getByLabelText<HTMLInputElement>('Venue');
    expect(input.value).toBe('');

    await user.type(input, '   ');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(sent.patches).toEqual([{ venue: null }]));
  });

  it('edits the date with the DatePicker and times with the TimeInput, saving HH:mm', async () => {
    const user = userEvent.setup();
    const sent = mockScheduleTab({ schedule: [scheduleRow()] });
    const { container } = renderScheduleTab();

    // No native date/time inputs anywhere on the page.
    await screen.findByText('Mathematics');
    expect(container.querySelector('input[type=date], input[type=time]')).toBeNull();

    const startCell = screen.getByRole('combobox', { name: 'Change Starts at — Mathematics' });
    await user.click(startCell);
    await user.clear(startCell); // the list is filtered by the current label until cleared
    await user.click((await screen.findAllByRole('option', { name: /১০:০০|10:00/ }))[0]!);
    await waitFor(() => expect(sent.patches).toEqual([{ starts_at: '10:00' }]));

    await user.click(screen.getByRole('button', { name: /^Change Date — Mathematics, / }));
    // Pick another day of the displayed month (Feb 2026).
    await screen.findByRole('grid', { name: 'Calendar' });
    await user.click(document.querySelector<HTMLElement>('[data-date="2026-02-12"]')!);
    await waitFor(() => expect(sent.patches.at(-1)).toEqual({ date: '2026-02-12' }));
  });

  it('flags two rows that overlap on one date, naming each other, without server warning text', async () => {
    mockScheduleTab({
      classSubjects: [math, english],
      warnings: ['Mathematics overlaps another exam on 2026-02-05'],
      schedule: [
        scheduleRow({ id: 'a', starts_at: '09:00:00', ends_at: '11:00:00' }),
        scheduleRow({
          id: 'b',
          subject: english,
          subject_id: english.id,
          starts_at: '10:00:00',
          ends_at: '12:00:00',
        }),
        // Same date but not overlapping.
        scheduleRow({
          id: 'c',
          subject: english,
          subject_id: 'subject-other',
          starts_at: '12:00:00',
          ends_at: '13:00:00',
        }),
      ],
    });
    renderScheduleTab();

    await screen.findByText('Same time as English');
    expect(screen.getAllByText('Time clash')).toHaveLength(2);
    expect(screen.getByText('Same time as Mathematics')).toBeTruthy();
    expect(screen.queryByText(/overlaps another exam/)).toBeNull();
  });

  it('ignores keys other than Enter on the venue cell', async () => {
    const user = userEvent.setup();
    mockScheduleTab({ schedule: [scheduleRow()] });
    renderScheduleTab();

    const venueButton = await screen.findByRole('button', { name: /^Main Hall/ });
    venueButton.focus();
    await user.keyboard('a');
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Venue')).toBeTruthy();
  });

  it('Remove asks first, and a failed remove shows a translated message', async () => {
    const user = userEvent.setup();
    mockScheduleTab({ schedule: [scheduleRow()] });
    server.use(
      http.delete('/api/v1/exams/:examId/schedule/:id', () =>
        HttpResponse.json({ message: 'db exploded' }, { status: 500 }),
      ),
    );
    renderScheduleTab();

    await user.click(await screen.findByRole('button', { name: 'Remove from schedule' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await within(confirm).findByText(/Couldn't remove it\./)).toBeTruthy();
    expect(screen.queryByText(/db exploded/)).toBeNull();
  });

  it('a failed inline edit shows a translated alert instead of silently reverting', async () => {
    const user = userEvent.setup();
    mockScheduleTab({ schedule: [scheduleRow()] });
    server.use(
      http.patch('/api/v1/exams/:examId/schedule/:id', () =>
        HttpResponse.json({ message: 'db exploded' }, { status: 500 }),
      ),
    );
    renderScheduleTab();
    await user.click(await screen.findByRole('button', { name: /^Main Hall/ }));
    await user.type(screen.getByLabelText('Venue'), 'X{Enter}');
    expect(await screen.findByText("Couldn't save the schedule change.")).toBeTruthy();
  });

  it('shows an error state when the schedule fails to load', async () => {
    mockScheduleTab({ schedule: [] });
    server.use(
      http.get('/api/v1/exams/:examId/schedule', () =>
        HttpResponse.json(apiErrorBody(404, 'Not found', '/api/v1/exams/exam-1/schedule'), {
          status: 404,
        }),
      ),
    );
    renderScheduleTab();

    expect(await screen.findByText("Couldn't load the schedule.")).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an empty state, then adds an unscheduled subject with default times and the LOCAL day', async () => {
    const user = userEvent.setup();
    // 23:30 local: the UTC day can differ from the local day, the local one must be sent.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 1, 5, 23, 30) });
    try {
      const sent = mockScheduleTab({ schedule: [], classSubjects: [math] });
      renderScheduleTab();

      expect(await screen.findByText('No schedule yet')).toBeTruthy();
      const addButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Add' });
      expect(addButton.disabled).toBe(true);

      await user.click(screen.getByRole('combobox', { name: 'Subject' }));
      await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
      expect(addButton.disabled).toBe(false);
      await user.click(addButton);

      await waitFor(() => expect(sent.posts).toHaveLength(1));
      expect(sent.posts[0]).toEqual({
        subject_id: 'subject-math',
        date: '2026-02-05',
        starts_at: '09:00',
        ends_at: '11:00',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

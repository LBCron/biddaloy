import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../../routeTree.gen';

import { planFactory, scheduleFactory, scheduleLesson } from './test-fixtures';

type Plan = ReturnType<typeof planFactory>;

function mockApi(plan: Plan = planFactory()) {
  server.use(
    http.get('/api/v1/study-plans/:id', () => HttpResponse.json(plan)),
    http.get('/api/v1/study-plans/:id/schedule', () =>
      HttpResponse.json(scheduleFactory([scheduleLesson('l1', 'UPCOMING')])),
    ),
    http.get('/api/v1/syllabus-topics', () => HttpResponse.json([])),
    http.get('/api/v1/classes/class-1', () =>
      HttpResponse.json({ id: 'class-1', name: 'Class 7', shift_id: 'shift-1' }),
    ),
    http.get('/api/v1/routines/shifts/shift-1/period-slots', () =>
      HttpResponse.json([
        { id: 'slot-1', sequence: 3, kind: 'CLASS', starts_at: '09:20:00', ends_at: '10:00:00' },
      ]),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: 'class-1', name: 'Class 7' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes/:id/sections', () =>
      HttpResponse.json([
        { id: 'sec-1', section_name: 'A', enrolled_count: 3 },
        { id: 'sec-2', section_name: 'B', enrolled_count: 4 },
      ]),
    ),
    http.get('/api/v1/exams', () =>
      HttpResponse.json({
        data: [
          { id: 'e1', name: 'Half-yearly' },
          { id: 'e2', name: 'Final' },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [{ id: 't-2', user: { full_name: 'Karim Uddin' } }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

function renderPage(role: 'ADMIN' | 'TEACHER' | 'EXECUTIVE' = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/academics/study-plans/plan-1'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

const menuItem = (name: string) => screen.queryByRole('menuitem', { name });
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'More actions' }));
}
const lessons3 = [
  { id: 'l1', title: 'Fractions', periods: 1 },
  { id: 'l2', title: 'Ratio', periods: 1 },
  { id: 'l3', title: 'Decimals', periods: 1 },
];
const errorResponse = (status: number, code: string, extra: object = {}) =>
  HttpResponse.json(
    { ...apiErrorBody(status, 'Error', '/api/v1/x'), details: { code, ...extra } },
    { status },
  );

describe('plan header actions', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupTestState();
  });

  it('a teacher editor sees extra class, CSV, copy, marker, delete; not library or owner', async () => {
    mockApi();
    renderPage('TEACHER');
    const user = userEvent.setup();

    expect(await screen.findByRole('button', { name: 'Log extra class' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeTruthy();
    await openMore(user);
    expect(menuItem('Copy to another section')).toBeTruthy();
    expect(menuItem('Set exam syllabus marker')).toBeTruthy();
    expect(menuItem('Delete plan')).toBeTruthy();
    expect(menuItem('Add to library')).toBeNull();
    expect(menuItem('Change owner')).toBeNull();
  });

  it('ADMIN sees every action', async () => {
    mockApi();
    renderPage('ADMIN');
    const user = userEvent.setup();

    await screen.findByRole('button', { name: 'Log extra class' });
    await openMore(user);
    for (const name of [
      'Copy to another section',
      'Add to library',
      'Set exam syllabus marker',
      'Change owner',
      'Delete plan',
    ]) {
      expect(menuItem(name)).toBeTruthy();
    }
  });

  it('a read-only user sees only Download CSV', async () => {
    mockApi(planFactory({ can_edit: false }));
    renderPage('TEACHER');

    expect(await screen.findByRole('button', { name: 'Download CSV' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Log extra class' })).toBeNull();
    // CSV is the only action, and on phone it lives in More (the trigger is phone-only).
    expect(screen.getByRole('button', { name: 'More actions' }).className).toContain('md:hidden');
  });

  describe('log extra class', () => {
    async function openExtra(role: 'ADMIN' | 'TEACHER') {
      // Only Date is faked so the calendar's "today" is fixed; timers stay real.
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 2, 15, 10) });
      mockApi();
      renderPage(role);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Log extra class' }));
      const dialog = await screen.findByRole('dialog');
      return { user, dialog };
    }
    const cell = (iso: string) => document.querySelector<HTMLElement>(`[data-date="${iso}"]`)!;

    it('disables future dates and, for a teacher, days older than 7', async () => {
      const { user, dialog } = await openExtra('TEACHER');
      await user.click(within(dialog).getByRole('button', { name: /^Date, / }));
      await screen.findByRole('grid', { name: 'Calendar' });

      expect(cell('2026-03-16').getAttribute('aria-disabled')).toBe('true');
      expect(cell('2026-03-15').getAttribute('aria-disabled')).toBeNull();
      expect(cell('2026-03-08').getAttribute('aria-disabled')).toBeNull();
      expect(cell('2026-03-07').getAttribute('aria-disabled')).toBe('true');
    });

    it('lets ADMIN pick 8 days back', async () => {
      const { user, dialog } = await openExtra('ADMIN');
      await user.click(within(dialog).getByRole('button', { name: /^Date, / }));
      await screen.findByRole('grid', { name: 'Calendar' });

      expect(cell('2026-03-07').getAttribute('aria-disabled')).toBeNull();
      expect(cell('2026-03-16').getAttribute('aria-disabled')).toBe('true');
    });

    it('posts section, subject, date and period; a 409 shows the sentence and keeps the dialog', async () => {
      const { user, dialog } = await openExtra('ADMIN');
      let body: unknown;
      let fail = true;
      server.use(
        http.post('/api/v1/lesson-deliveries/extra', async ({ request }) => {
          body = await request.json();
          return fail
            ? errorResponse(409, 'LESSON_DELIVERY_SLOT_TAKEN')
            : HttpResponse.json({ id: 'd1' }, { status: 201 });
        }),
      );

      await user.click(within(dialog).getByRole('combobox', { name: 'Period' }));
      await user.click(await screen.findByRole('option', { name: /Period 3/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Log extra class' }));

      expect((await within(dialog).findByRole('alert')).textContent).toBe(
        'This period is already recorded for this day.',
      );
      expect(body).toEqual({
        section_id: 'sec-1',
        subject_id: 'sub-1',
        date: '2026-03-15',
        period_slot_id: 'slot-1',
      });
      fail = false;
      await user.click(within(dialog).getByRole('button', { name: 'Log extra class' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('a routine-period 409 links to My routine for that date', async () => {
      const { user, dialog } = await openExtra('ADMIN');
      server.use(
        http.post('/api/v1/lesson-deliveries/extra', () =>
          errorResponse(409, 'LESSON_DELIVERY_IS_ROUTINE_PERIOD'),
        ),
      );
      await user.click(within(dialog).getByRole('combobox', { name: 'Period' }));
      await user.click(await screen.findByRole('option', { name: /Period 3/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Log extra class' }));

      const alert = await within(dialog).findByRole('alert');
      expect(alert.textContent).toContain('Mathematics already has this period in the routine');
      expect(
        within(alert).getByRole('link', { name: 'Open My routine' }).getAttribute('href'),
      ).toContain('/routines/my');
    });
  });

  describe('copy to another section', () => {
    async function openCopy() {
      mockApi();
      const view = renderPage('ADMIN');
      const user = userEvent.setup();
      await openMore(user);
      await user.click(await screen.findByRole('menuitem', { name: 'Copy to another section' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('combobox', { name: 'Section' }));
      await user.click(await screen.findByRole('option', { name: 'Class 7-B' }));
      return { user, dialog, view };
    }

    it('excludes the current section, posts the target and navigates to the new plan', async () => {
      let body: unknown;
      const { user, dialog, view } = await openCopy();
      expect(screen.queryByRole('option', { name: 'Class 7-A' })).toBeNull();
      server.use(
        http.post('/api/v1/study-plans/plan-1/copy-to-section', async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(planFactory({ id: 'plan-9' }), { status: 201 });
        }),
        http.get('/api/v1/study-plans/plan-9', () =>
          HttpResponse.json(planFactory({ id: 'plan-9' })),
        ),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Copy' }));

      await waitFor(() => expect(body).toEqual({ section_id: 'sec-2' }));
      await waitFor(() =>
        expect(view.router.state.location.pathname).toBe('/academics/study-plans/plan-9'),
      );
    });

    it('403 and 409 show their sentences; the 409 links to the existing plan', async () => {
      const { user, dialog } = await openCopy();
      server.use(
        http.post('/api/v1/study-plans/plan-1/copy-to-section', () =>
          errorResponse(403, 'STUDY_PLAN_OUT_OF_SCOPE'),
        ),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
      expect((await within(dialog).findByRole('alert')).textContent).toBe(
        "You don't teach Mathematics in that section.",
      );

      server.use(
        http.post('/api/v1/study-plans/plan-1/copy-to-section', () =>
          errorResponse(409, 'STUDY_PLAN_EXISTS', { existing_id: 'plan-5' }),
        ),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
      expect(
        await within(dialog).findByText(/That section already has a plan for this term\./),
      ).toBeTruthy();
      expect(within(dialog).getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe(
        '/academics/study-plans/plan-5',
      );
    });
  });

  describe('exam markers', () => {
    const withMarker = () =>
      planFactory({
        lessons: lessons3,
        exam_markers: [{ exam_id: 'e1', up_to_lesson_id: 'l1', exam_name: 'Half-yearly' }],
      });

    async function pick(
      user: ReturnType<typeof userEvent.setup>,
      dialog: HTMLElement,
      label: string,
      option: RegExp,
    ) {
      await user.click(within(dialog).getByRole('combobox', { name: label }));
      await user.click(await screen.findByRole('option', { name: option }));
    }

    it('re-adding an exam replaces its marker, remove drops one, and PUT carries the whole list', async () => {
      mockApi(withMarker());
      let body: unknown;
      server.use(
        http.put('/api/v1/study-plans/plan-1/exam-markers', async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(withMarker());
        }),
      );
      renderPage('ADMIN');
      const user = userEvent.setup();
      await openMore(user);
      await user.click(await screen.findByRole('menuitem', { name: 'Set exam syllabus marker' }));
      const dialog = await screen.findByRole('dialog');

      // replace Half-yearly (lesson 1) with lesson 3, add Final up to lesson 2
      await pick(user, dialog, 'Exam', /Half-yearly/);
      await pick(user, dialog, 'Up to lesson', /Decimals/);
      await user.click(within(dialog).getByRole('button', { name: 'Add marker' }));
      await pick(user, dialog, 'Exam', /Final/);
      await pick(user, dialog, 'Up to lesson', /Ratio/);
      await user.click(within(dialog).getByRole('button', { name: 'Add marker' }));

      expect(within(dialog).getAllByRole('listitem')).toHaveLength(2);
      expect(within(dialog).getByText(/Half-yearly · up to lesson 3 'Decimals'/)).toBeTruthy();

      await user.click(within(dialog).getByRole('button', { name: 'Remove Final marker' }));
      expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);

      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(body).toEqual({ markers: [{ exam_id: 'e1', up_to_lesson_id: 'l3' }] }),
      );
    });

    it('opening from a marker row preselects its exam and lesson', async () => {
      mockApi(withMarker());
      server.use(
        http.get('/api/v1/study-plans/:id/schedule', () =>
          HttpResponse.json(
            scheduleFactory([
              scheduleLesson('l1', 'UPCOMING'),
              scheduleLesson('l2', 'UPCOMING'),
              scheduleLesson('l3', 'UPCOMING'),
            ]),
          ),
        ),
      );
      renderPage('ADMIN');
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Set exam syllabus marker' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('combobox', { name: 'Exam' }).textContent).toBe(
        'Half-yearly',
      );
      expect(within(dialog).getByRole('combobox', { name: 'Up to lesson' }).textContent).toContain(
        'Fractions',
      );
    });
  });

  it('Save folds in a pending pick: edit a marker row, change lesson, Save', async () => {
    mockApi(
      planFactory({
        lessons: lessons3,
        exam_markers: [{ exam_id: 'e1', up_to_lesson_id: 'l1', exam_name: 'Half-yearly' }],
      }),
    );
    let body: unknown;
    server.use(
      http.put('/api/v1/study-plans/plan-1/exam-markers', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(planFactory());
      }),
    );
    renderPage('ADMIN');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Set exam syllabus marker' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'Up to lesson' }));
    await user.click(await screen.findByRole('option', { name: /Decimals/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(body).toEqual({ markers: [{ exam_id: 'e1', up_to_lesson_id: 'l3' }] }),
    );
  });

  it('change owner: the routine option sends owner_override_teacher_id null', async () => {
    mockApi(planFactory({ owner_override_teacher_id: 't-2' }));
    let body: unknown;
    server.use(
      http.patch('/api/v1/study-plans/plan-1', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(planFactory());
      }),
    );
    renderPage('ADMIN');
    const user = userEvent.setup();
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Change owner' }));
    const dialog = await screen.findByRole('dialog');

    expect(
      within(dialog).getByText("By default the routine's teacher owns the plan."),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole('radio', { name: /Routine's teacher \(Rahima Akter\)/ }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toEqual({ owner_override_teacher_id: null }));
  });

  it('add to library posts the name and links to the library tab', async () => {
    mockApi();
    let body: unknown;
    server.use(
      http.post('/api/v1/study-plan-templates/from-plan/plan-1', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 'tpl-1' }, { status: 201 });
      }),
    );
    renderPage('ADMIN');
    const user = userEvent.setup();
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Add to library' }));
    const dialog = await screen.findByRole('dialog');

    const name = within(dialog).getByLabelText<HTMLInputElement>('Template name');
    expect(name.value).toBe('Mathematics Class 7 — First term');
    await user.click(within(dialog).getByRole('button', { name: 'Add to library' }));

    await waitFor(() => expect(body).toEqual({ name: 'Mathematics Class 7 — First term' }));
    const link = await within(dialog).findByRole('link', { name: 'Open the library' });
    expect(link.getAttribute('href')).toContain('/academics/syllabus');
    expect(link.getAttribute('href')).toContain('tab=library');
  });

  describe('delete plan', () => {
    async function openDelete() {
      mockApi();
      const view = renderPage('TEACHER');
      const user = userEvent.setup();
      await openMore(user);
      await user.click(await screen.findByRole('menuitem', { name: 'Delete plan' }));
      const dialog = await screen.findByRole('alertdialog');
      return { user, dialog, view };
    }

    it('confirms, deletes and navigates to the plans tab', async () => {
      const { user, dialog, view } = await openDelete();
      expect(dialog.textContent).toContain(
        'Delete the plan for Class 7-A · Mathematics · First term? Recorded periods stay; the lesson list is removed.',
      );
      let deleted = false;
      server.use(
        http.delete('/api/v1/study-plans/plan-1', () => {
          deleted = true;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Delete plan' }));

      await waitFor(() => expect(deleted).toBe(true));
      await waitFor(() => expect(view.router.state.location.pathname).toBe('/academics/syllabus'));
      expect(view.router.state.location.searchStr).toContain('tab=plans');
    });

    it('a failed delete closes the dialog and shows a sentence from the code', async () => {
      const { user, dialog } = await openDelete();
      server.use(
        http.delete('/api/v1/study-plans/plan-1', () =>
          errorResponse(403, 'STUDY_PLAN_OUT_OF_SCOPE'),
        ),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Delete plan' }));

      expect((await screen.findByRole('alert')).textContent).toBe(
        'You can only change plans for the subjects you teach.',
      );
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });
});

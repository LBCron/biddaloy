import { HomeworkGradingMode } from '@biddaloy/shared';
import {
  apiErrorBody,
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';
import { pickDate } from '../../../../test/pick-date';

const notifyOutcome = vi.hoisted(() => vi.fn());
vi.mock('@biddaloy/ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@biddaloy/ui/api')>()),
  notifyOutcome,
}));

describe('/academics/homework/$homeworkId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const sectionRow = {
    id: 'a1',
    homework_id: 'hw-1',
    section_id: 'section-1',
    student_id: null,
    assigned_date: '2026-10-20',
    due_date: '2026-10-30',
    status: 'ACTIVE',
    target_section_id: 'section-1',
    section_name: 'A',
    student_name: null,
  };

  // Default is one live row: an empty list repeats the "Assign" button in its empty state.
  const assignmentsHandler = (rows: unknown[] = [sectionRow]) =>
    http.get('/api/v1/homework/:id/assignments', () => HttpResponse.json(rows));

  const homework = {
    id: 'hw-1',
    subject_id: 'subject-1',
    class_id: 'class-1',
    title: 'Algebra worksheet',
    description: 'Chapter 3 exercises',
    grading_mode: HomeworkGradingMode.TICK,
    attachments: [],
    created_at: '2026-09-01T00:00:00.000Z',
  };

  it('renders title, grading mode and description', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler(),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Algebra worksheet' });
    expect(screen.getByText('Chapter 3 exercises')).toBeTruthy();
    expect(screen.getByText('Tick (done / not done)')).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('404 shows an error state', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () =>
        HttpResponse.json(apiErrorBody(404, 'Not found', '/api/v1/homework/missing'), {
          status: 404,
        }),
      ),
      assignmentsHandler(),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/missing'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('We could not find this record')).toBeTruthy();
  });

  it('assign dialog submits and shows a confirmation', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
    let assignBody: Record<string, unknown> | undefined;

    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler(),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework/:id/assign', async ({ request }) => {
        assignBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: 'assignment-1',
          homework_id: 'hw-1',
          section_id: assignBody.section_id,
          student_id: null,
          assigned_date: assignBody.assigned_date,
          due_date: assignBody.due_date,
          status: 'ACTIVE',
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Assign to section or student' }));

    await screen.findByRole('dialog');
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(assignBody).toBeDefined());
    expect(assignBody?.section_id).toBe(section.id);
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a failed assign shows the generic error, not the server message', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });

    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler(),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework/:id/assign', () =>
        HttpResponse.json(apiErrorBody(400, 'internal backend detail', '/x'), { status: 400 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Assign to section or student' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByText('internal backend detail')).toBeNull();
  });

  it('#3172 a 409 HOMEWORK_TARGET_TAKEN on assign shows its own sentence', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });

    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler(),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework/:id/assign', () =>
        HttpResponse.json(
          {
            ...apiErrorBody(409, 'This homework is already assigned to that target', '/x'),
            details: { code: 'HOMEWORK_TARGET_TAKEN' },
          },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Assign to section or student' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(
      await screen.findByText(
        'This homework is already assigned to that section or student. Pick another one, or change the row that is already there.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull();
  });

  const renderAdmin = () =>
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/hw-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

  it('a live row has a Change button, a superseded row does not', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler([sectionRow, { ...sectionRow, id: 'a0', status: 'SUPERSEDED' }]),
    );

    renderAdmin();

    expect(await screen.findAllByRole('button', { name: 'Change Section A' })).toHaveLength(1);
  });

  it('lists names, dates and status, never ids', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler([
        sectionRow,
        {
          ...sectionRow,
          id: 'a2-student-row-id',
          section_id: null,
          student_id: 'st-1',
          section_name: 'B',
          student_name: 'Rahim Uddin',
        },
        { ...sectionRow, id: 'a0-old-row-id', status: 'SUPERSEDED' },
      ]),
    );

    renderAdmin();

    expect((await screen.findAllByText('Section A')).length).toBeGreaterThan(0);
    expect(screen.getByText('Rahim Uddin · Section B')).toBeTruthy();
    expect(screen.getByText('Superseded')).toBeTruthy();
    expect(screen.getAllByText(/30/).length).toBeGreaterThan(0);
    expect(screen.queryByText('a2-student-row-id')).toBeNull();
    expect(screen.queryByText('section-1')).toBeNull();
  });

  it('Change opens a prefilled dialog, saves over the row and confirms', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler(),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework-assignments/:id/reassign', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...sectionRow, id: 'a9', ...body });
      }),
    );

    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change Section A' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      section_id: 'section-1',
      assigned_date: '2026-10-20',
      due_date: '2026-10-30',
    });
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a failed Change (500) keeps the dialog with the generic error and refetches the list', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
    let listCalls = 0;
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      http.get('/api/v1/homework/:id/assignments', () => {
        listCalls += 1;
        return HttpResponse.json([sectionRow]);
      }),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework-assignments/:id/reassign', () =>
        HttpResponse.json(apiErrorBody(500, 'internal backend detail', '/x'), { status: 500 }),
      ),
    );

    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change Section A' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByText('internal backend detail')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
  });

  const ROW_CHANGED = 'This row was already changed. The list is up to date now.';
  const klass = classFactory({ id: 'class-1', name: 'Class 6' });
  const sectionA = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
  // Shared handlers for pages that open a dialog; counts list fetches.
  const serveDialogs = (rows: unknown[], counter?: { calls: number }) =>
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      http.get('/api/v1/homework/:id/assignments', () => {
        if (counter) counter.calls += 1;
        return HttpResponse.json(rows);
      }),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([sectionA])),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

  it('shows actions by status: ACTIVE three, DEACTIVATED only Reactivate, SUPERSEDED none', async () => {
    serveDialogs([
      sectionRow,
      { ...sectionRow, id: 'a2', section_name: 'B', status: 'DEACTIVATED' },
      { ...sectionRow, id: 'a0', section_name: 'Z', status: 'SUPERSEDED' },
    ]);
    renderAdmin();

    expect(
      await screen.findByRole('button', { name: 'Change due date for Section A' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change Section A' })).toBeTruthy();
    // #2899: Check work leads, so 4 actions overflow and Deactivate sits in "More actions".
    expect(screen.getByRole('button', { name: 'Check work for Section A' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Deactivate Section A' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reactivate Section B' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change Section B' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deactivate Section B' })).toBeNull();
    // SUPERSEDED: only Check work (work handed in stays viewable).
    expect(screen.getAllByRole('button', { name: /Section Z/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Check work for Section Z' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Deactivate Section A' })).toBeTruthy();
  });

  // Deactivate is the 4th action, so it lives in the "More actions" menu.
  const openDeactivate = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate Section A' }));
  };

  it('Deactivate asks first, sends the status, toasts and refetches', async () => {
    const counter = { calls: 0 };
    let body: unknown;
    serveDialogs([sectionRow], counter);
    server.use(
      http.patch('/api/v1/homework-assignments/:id', async ({ request, params }) => {
        body = { id: params.id, ...((await request.json()) as object) };
        return HttpResponse.json({ ...sectionRow, status: 'DEACTIVATED' });
      }),
    );
    renderAdmin();

    const user = userEvent.setup();
    await openDeactivate(user);
    expect(
      await screen.findByRole('alertdialog', { name: 'Deactivate this homework for Section A?' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(body).toEqual({ id: 'a1', status: 'DEACTIVATED' }));
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(counter.calls).toBeGreaterThan(1));
  });

  // #3173: Deactivate is undoable (Reactivate), so its confirm must not be drawn as a delete.
  it('the Deactivate confirm shows no trash icon', async () => {
    serveDialogs([sectionRow]);
    renderAdmin();

    const user = userEvent.setup();
    await openDeactivate(user);
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Deactivate this homework for Section A?',
    });
    expect(dialog.querySelector('svg.lucide-trash-2')).toBeNull();
  });

  // #3173: the server lists at most 100 rows, so a full page says that more may be missing.
  it('a full page of 100 rows says older rows are not listed; fewer rows say nothing', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...sectionRow, id: `a${i}` }));
    serveDialogs(many);
    const { unmount } = renderAdmin();
    expect(
      await screen.findByText(
        'Only the first 100 rows are shown, active ones first. Older rows are not listed.',
      ),
    ).toBeTruthy();
    unmount();

    serveDialogs(many.slice(0, 99));
    renderAdmin();
    await screen.findAllByText('Section A');
    expect(screen.queryByText(/Only the first 100 rows/)).toBeNull();
  });

  it('Reactivate sends ACTIVE', async () => {
    let body: unknown;
    serveDialogs([{ ...sectionRow, id: 'a2', status: 'DEACTIVATED' }]);
    server.use(
      http.patch('/api/v1/homework-assignments/:id', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(sectionRow);
      }),
    );
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reactivate Section A' }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(body).toEqual({ status: 'ACTIVE' }));
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })),
    );
  });

  it('a 400 on Deactivate closes the dialog and toasts a fixed text, never the server message', async () => {
    serveDialogs([sectionRow]);
    server.use(
      http.patch('/api/v1/homework-assignments/:id', () =>
        HttpResponse.json(apiErrorBody(400, 'internal backend detail', '/x'), { status: 400 }),
      ),
    );
    renderAdmin();

    const user = userEvent.setup();
    await openDeactivate(user);
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', message: ROW_CHANGED }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByText('internal backend detail')).toBeNull();
  });

  it('Due date saves the picked date in place and toasts', async () => {
    let body: unknown;
    serveDialogs([sectionRow]);
    server.use(
      http.patch('/api/v1/homework-assignments/:id', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...sectionRow, due_date: '2026-11-05' });
      }),
    );
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change due date for Section A' }));
    await screen.findByRole('dialog');
    await pickDate(user, 'Due date', '2026-11-05');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toEqual({ due_date: '2026-11-05' }));
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Due date 500 keeps the dialog open with the generic error', async () => {
    serveDialogs([sectionRow]);
    server.use(
      http.patch('/api/v1/homework-assignments/:id', () =>
        HttpResponse.json(apiErrorBody(500, 'internal backend detail', '/x'), { status: 500 }),
      ),
    );
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change due date for Section A' }));
    await screen.findByRole('dialog');
    await pickDate(user, 'Due date', '2026-11-05');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('internal backend detail')).toBeNull();
  });

  it('Due date 400 closes the dialog with the row-changed toast', async () => {
    serveDialogs([sectionRow]);
    server.use(
      http.patch('/api/v1/homework-assignments/:id', () =>
        HttpResponse.json(apiErrorBody(400, 'internal backend detail', '/x'), { status: 400 }),
      ),
    );
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change due date for Section A' }));
    await screen.findByRole('dialog');
    await pickDate(user, 'Due date', '2026-11-05');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', message: ROW_CHANGED }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Deactivate 500 closes the dialog and toasts the generic error', async () => {
    serveDialogs([sectionRow]);
    server.use(
      http.patch('/api/v1/homework-assignments/:id', () =>
        HttpResponse.json(apiErrorBody(500, 'internal backend detail', '/x'), { status: 500 }),
      ),
    );
    renderAdmin();

    const user = userEvent.setup();
    await openDeactivate(user);
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          message: 'Something went wrong. Please try again.',
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByText('internal backend detail')).toBeNull();
  });

  it('Due date before the assigned date shows the field error and sends nothing', async () => {
    let sent = false;
    serveDialogs([sectionRow]);
    server.use(
      http.patch('/api/v1/homework-assignments/:id', () => {
        sent = true;
        return HttpResponse.json(sectionRow);
      }),
    );
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change due date for Section A' }));
    await screen.findByRole('dialog');
    await pickDate(user, 'Due date', '2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Due date must be on or after the assigned date.')).toBeTruthy();
    expect(sent).toBe(false);
  });

  it('a 400 on Change closes the dialog with the row-changed toast (D4)', async () => {
    const counter = { calls: 0 };
    serveDialogs([sectionRow], counter);
    server.use(
      http.post('/api/v1/homework-assignments/:id/reassign', () =>
        HttpResponse.json(apiErrorBody(400, 'internal backend detail', '/x'), { status: 400 }),
      ),
    );
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change Section A' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', message: ROW_CHANGED }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(counter.calls).toBeGreaterThan(1));
  });

  it('Change for a student who moved out of the class asks for a section and sends nothing (D6)', async () => {
    let sent = false;
    serveDialogs([
      {
        ...sectionRow,
        section_id: null,
        student_id: 'st-1',
        student_name: 'Rahim Uddin',
        section_name: 'X',
        target_section_id: 'section-x',
      },
    ]);
    server.use(
      http.post('/api/v1/homework-assignments/:id/reassign', () => {
        sent = true;
        return HttpResponse.json(sectionRow);
      }),
    );
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change Rahim Uddin · Section X' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Pick a section.')).toBeTruthy();
    expect(sent).toBe(false);
  });

  it('a held student past the first page still shows by name and is sent (D6)', async () => {
    let body: Record<string, unknown> | undefined;
    serveDialogs([
      {
        ...sectionRow,
        section_id: null,
        student_id: 'st-1',
        student_name: 'Rahim Uddin',
        section_name: 'A',
      },
    ]);
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('/api/v1/homework-assignments/:id/reassign', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...sectionRow, id: 'a9' });
      }),
    );
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change Rahim Uddin · Section A' }));
    await screen.findByRole('dialog');
    // The trigger shows the held student by name even though the list is empty.
    expect(
      await screen.findByText('Rahim Uddin', { selector: '[data-slot], button span, span' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ student_id: 'st-1' });
  });

  // #3173: a section over one page (100) must not leave students past the first page out.
  it('the student picker loads every page of the section, not just the first', async () => {
    const pages: string[] = [];
    serveDialogs([
      {
        ...sectionRow,
        section_id: null,
        student_id: 'st-1',
        student_name: 'Rahim Uddin',
        section_name: 'A',
      },
    ]);
    server.use(
      http.get('/api/v1/students', ({ request }) => {
        const page = new URL(request.url).searchParams.get('page') ?? '1';
        pages.push(page);
        return HttpResponse.json({
          data: [],
          total: 150,
          page: Number(page),
          limit: 100,
          totalPages: 2,
        });
      }),
    );
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change Rahim Uddin · Section A' }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(pages.sort()).toEqual(['1', '2']));
  });

  it('an empty list says nobody has the homework yet', async () => {
    server.use(
      http.get('/api/v1/homework/:id', () => HttpResponse.json(homework)),
      assignmentsHandler([]),
    );

    renderAdmin();

    expect(await screen.findByText('Not given to anyone yet')).toBeTruthy();
  });

  // ---- #2899: Check work ----
  const A1 = '11111111-1111-4111-8111-111111111111';
  const liveRow = { ...sectionRow, id: A1 };
  const roster = [
    {
      student_id: 'st-1',
      student_name: 'Karim Rahman',
      roll_number: 1,
      submission_id: null,
      status: 'NOT_SUBMITTED',
      marks: null,
      attachment_count: 0,
    },
    {
      student_id: 'st-2',
      student_name: 'Rahim Uddin',
      roll_number: 2,
      submission_id: 's-2',
      status: 'SUBMITTED',
      marks: null,
      attachment_count: 1,
    },
  ];
  const submissionsHandler = (rows: unknown[] = roster, counter?: { calls: number }) =>
    http.get('/api/v1/homework-assignments/:id/submissions', () => {
      if (counter) counter.calls += 1;
      return HttpResponse.json(rows);
    });
  const renderDeepLink = () =>
    renderWithRouter(routeTree, {
      initialEntries: [`/academics/homework/hw-1?assignment=${A1}`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

  it('every row, including deactivated and superseded, has Check work', async () => {
    serveDialogs([
      liveRow,
      { ...sectionRow, id: 'a2', section_name: 'B', status: 'DEACTIVATED' },
      { ...sectionRow, id: 'a0', section_name: 'Z', status: 'SUPERSEDED' },
    ]);
    renderAdmin();

    for (const name of ['A', 'B', 'Z']) {
      expect(
        await screen.findByRole('button', { name: `Check work for Section ${name}` }),
      ).toBeTruthy();
    }
  });

  it('a deep link opens the list for that assignment', async () => {
    serveDialogs([liveRow]);
    server.use(submissionsHandler());
    renderDeepLink();

    expect(await screen.findByRole('heading', { name: 'Check work · Section A' })).toBeTruthy();
    expect(await screen.findByText('Karim Rahman')).toBeTruthy();
    expect(screen.getByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(
      screen.getByText('Tick each student who did the homework, then press Save.'),
    ).toBeTruthy();
  });

  it('an ?assignment id that is not a row of this homework shows not-found, never the grid', async () => {
    serveDialogs([{ ...sectionRow, id: '22222222-2222-4222-8222-222222222222' }]);
    server.use(submissionsHandler());
    renderDeepLink();

    expect(
      await screen.findByText(
        'This list cannot be opened. It may be for a section you do not teach.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('Check work on a row opens the list', async () => {
    serveDialogs([liveRow]);
    server.use(submissionsHandler());
    renderAdmin();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Check work for Section A' }));
    expect(await screen.findByRole('heading', { name: 'Check work · Section A' })).toBeTruthy();
  });

  it('Save sends one PATCH with only the changed student, toasts and refetches', async () => {
    const counter = { calls: 0 };
    const bodies: unknown[] = [];
    serveDialogs([liveRow]);
    server.use(
      submissionsHandler(roster, counter),
      http.patch('/api/v1/homework-assignments/:id/submissions', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(roster);
      }),
    );
    renderDeepLink();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Mark Karim Rahman done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(bodies).toEqual([{ items: [{ student_id: 'st-1', status: 'DONE' }] }]),
    );
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success', message: 'Saved.' }),
      ),
    );
    await waitFor(() => expect(counter.calls).toBeGreaterThan(1));
  });

  it('a 400 on Save toasts a fixed text, refetches and never shows the server message', async () => {
    const counter = { calls: 0 };
    serveDialogs([liveRow]);
    server.use(
      submissionsHandler(roster, counter),
      http.patch('/api/v1/homework-assignments/:id/submissions', () =>
        HttpResponse.json(apiErrorBody(400, 'internal backend detail', '/x'), { status: 400 }),
      ),
    );
    renderDeepLink();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Mark Karim Rahman done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          message:
            'This list changed while you were working. It is up to date now; check it and save again.',
        }),
      ),
    );
    await waitFor(() => expect(counter.calls).toBeGreaterThan(1));
    expect(screen.queryByText('internal backend detail')).toBeNull();
  });

  it('a 500 on Save keeps the draft', async () => {
    serveDialogs([liveRow]);
    server.use(
      submissionsHandler(),
      http.patch('/api/v1/homework-assignments/:id/submissions', () =>
        HttpResponse.json(apiErrorBody(500, 'internal backend detail', '/x'), { status: 500 }),
      ),
    );
    renderDeepLink();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Mark Karim Rahman done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          message: 'Something went wrong. Please try again.',
        }),
      ),
    );
    expect(
      screen.getByRole('checkbox', { name: 'Mark Karim Rahman done' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('a 404 on the list says it cannot be opened and shows no grid', async () => {
    serveDialogs([liveRow]);
    server.use(
      http.get('/api/v1/homework-assignments/:id/submissions', () =>
        HttpResponse.json(apiErrorBody(404, 'Homework assignment not found', '/x'), {
          status: 404,
        }),
      ),
    );
    renderDeepLink();

    expect(
      await screen.findByText(
        'This list cannot be opened. It may be for a section you do not teach.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('closing with unsaved changes asks before discarding', async () => {
    serveDialogs([liveRow]);
    server.use(submissionsHandler());
    renderDeepLink();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Mark Karim Rahman done' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('closing a deep link with no history removes the overlay and keeps the page', async () => {
    serveDialogs([liveRow]);
    server.use(submissionsHandler());
    renderDeepLink();

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Check work · Section A' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Check work · Section A' })).toBeNull(),
    );
    expect(screen.getByRole('heading', { name: 'Algebra worksheet' })).toBeTruthy();
  });
});

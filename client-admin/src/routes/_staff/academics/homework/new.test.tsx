import { HomeworkGradingMode } from '@biddaloy/shared';
import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  studentFactory,
  subjectFactory,
} from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../../help/test-utils';
import { routeTree } from '../../../../routeTree.gen';
import { pickDate } from '../../../../test/pick-date';

describe('/academics/homework/new', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  function setUpPickers() {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const subject = subjectFactory({ id: 'subject-1', name_en: 'Mathematics' });
    const section = classSectionFactory({ id: 'section-1', section_name: 'A', class: klass });
    const student = studentFactory({ id: 'student-1', full_name: 'Karim Ahmed' });

    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/subjects', () =>
        HttpResponse.json([{ ...subject, subject, subject_id: subject.id, class: klass }]),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    return { klass, subject, section, student };
  }

  async function fillCreateBasics(user: ReturnType<typeof userEvent.setup>, className: string) {
    await user.click(screen.getByRole('combobox', { name: /^Class/ }));
    await user.click(await screen.findByRole('option', { name: className }));
    await user.click(screen.getByRole('combobox', { name: /^Subject/ }));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
    await user.type(screen.getByRole('textbox', { name: /^Title/ }), 'Algebra worksheet');
  }

  it('shows the target (?) [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    setUpPickers();
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByRole('textbox', { name: /^Title/ });
    await expectHelp('academics.homework.field.target');
  });

  it('happy path: section target creates then assigns with section_id only', async () => {
    const { klass, section } = setUpPickers();
    let createCount = 0;
    let assignBody: Record<string, unknown> | undefined;

    server.use(
      http.post('/api/v1/homework', () => {
        createCount += 1;
        return HttpResponse.json(
          {
            id: 'hw-1',
            subject_id: 'subject-1',
            class_id: klass.id,
            title: 'Algebra worksheet',
            description: null,
            grading_mode: HomeworkGradingMode.TICK,
            attachments: [],
            created_at: '2026-09-01T00:00:00.000Z',
          },
          { status: 201 },
        );
      }),
      http.post('/api/v1/homework/:id/assign', async ({ request }) => {
        assignBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: 'assignment-1',
          homework_id: 'hw-1',
          section_id: assignBody.section_id ?? null,
          student_id: assignBody.student_id ?? null,
          assigned_date: assignBody.assigned_date,
          due_date: assignBody.due_date,
          status: 'ACTIVE',
        });
      }),
      http.get('/api/v1/homework/:id', () =>
        HttpResponse.json({
          id: 'hw-1',
          subject_id: 'subject-1',
          class_id: klass.id,
          title: 'Algebra worksheet',
          description: null,
          grading_mode: HomeworkGradingMode.TICK,
          attachments: [],
          created_at: '2026-09-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await fillCreateBasics(user, klass.name);
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Give homework' }));

    await waitFor(() => expect(assignBody).toBeDefined());
    expect(createCount).toBe(1);
    expect(assignBody?.section_id).toBe(section.id);
    expect(assignBody?.student_id).toBeUndefined();
    await screen.findByRole('heading', { name: 'Algebra worksheet' });
  });

  it('student target sends student_id and no section_id', async () => {
    const { klass, section, student } = setUpPickers();
    let assignBody: Record<string, unknown> | undefined;

    server.use(
      http.post('/api/v1/homework', () =>
        HttpResponse.json(
          {
            id: 'hw-1',
            subject_id: 'subject-1',
            class_id: klass.id,
            title: 'Algebra worksheet',
            description: null,
            grading_mode: HomeworkGradingMode.TICK,
            attachments: [],
            created_at: '2026-09-01T00:00:00.000Z',
          },
          { status: 201 },
        ),
      ),
      http.post('/api/v1/homework/:id/assign', async ({ request }) => {
        assignBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: 'assignment-1',
          homework_id: 'hw-1',
          section_id: null,
          student_id: assignBody.student_id,
          assigned_date: assignBody.assigned_date,
          due_date: assignBody.due_date,
          status: 'ACTIVE',
        });
      }),
      http.get('/api/v1/homework/:id', () =>
        HttpResponse.json({
          id: 'hw-1',
          subject_id: 'subject-1',
          class_id: klass.id,
          title: 'Algebra worksheet',
          description: null,
          grading_mode: HomeworkGradingMode.TICK,
          attachments: [],
          created_at: '2026-09-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await fillCreateBasics(user, klass.name);
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('radio', { name: 'Student' }));
    await user.click(screen.getByRole('combobox', { name: /^Student/ }));
    await user.click(await screen.findByRole('option', { name: /Karim Ahmed/ }));
    await user.click(screen.getByRole('button', { name: 'Give homework' }));

    await waitFor(() => expect(assignBody).toBeDefined());
    expect(assignBody?.student_id).toBe(student.id);
    expect(assignBody?.section_id).toBeUndefined();
  });

  it('assign 400 after a successful create shows an error and a retry does not re-create', async () => {
    const { klass, section } = setUpPickers();
    let createCount = 0;
    let assignCount = 0;

    server.use(
      http.post('/api/v1/homework', () => {
        createCount += 1;
        return HttpResponse.json(
          {
            id: 'hw-1',
            subject_id: 'subject-1',
            class_id: klass.id,
            title: 'Algebra worksheet',
            description: null,
            grading_mode: HomeworkGradingMode.TICK,
            attachments: [],
            created_at: '2026-09-01T00:00:00.000Z',
          },
          { status: 201 },
        );
      }),
      http.post('/api/v1/homework/:id/assign', () => {
        assignCount += 1;
        return HttpResponse.json({ message: 'Bad request' }, { status: 400 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await fillCreateBasics(user, klass.name);
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Give homework' }));

    await screen.findByRole('alert');
    expect(createCount).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Give homework' }));
    await waitFor(() => expect(assignCount).toBe(2));
    expect(createCount).toBe(1);
  });

  it('prefills class/section from search params', async () => {
    const { klass, section } = setUpPickers();

    renderWithRouter(routeTree, {
      initialEntries: [`/academics/homework/new?class_id=${klass.id}&section_id=${section.id}`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Create homework' });
    await waitFor(() =>
      within(screen.getByRole('combobox', { name: /^Class/ })).getByText(klass.name),
    );
    await waitFor(() =>
      within(screen.getByRole('combobox', { name: /^Section/ })).getByText(section.section_name),
    );
  });

  it('due date before assigned date shows an inline error and sends no request', async () => {
    const { klass, section } = setUpPickers();
    let assignCount = 0;
    server.use(
      http.post('/api/v1/homework/:id/assign', () => {
        assignCount += 1;
        return HttpResponse.json({});
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await fillCreateBasics(user, klass.name);
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));

    await pickDate(user, 'Due date', '2020-01-01');
    await user.click(screen.getByRole('button', { name: 'Give homework' }));

    expect(await screen.findByText(/Due date must be on or after/i)).toBeTruthy();
    // The only error is the date's, so focus moves to its picker, not left on the button.
    expect(document.activeElement?.id).toBe('homework-form-due');
    expect(assignCount).toBe(0);
  });

  it('a missing title shows its own message under the field and sends no request', async () => {
    const { klass, section } = setUpPickers();
    let createCount = 0;
    server.use(
      http.post('/api/v1/homework', () => {
        createCount += 1;
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await user.click(screen.getByRole('combobox', { name: /^Class/ }));
    await user.click(await screen.findByRole('option', { name: klass.name }));
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    await user.click(screen.getByRole('button', { name: 'Give homework' }));

    expect(await screen.findByText('Write a title.')).toBeTruthy();
    expect(screen.getByText('Pick a subject.')).toBeTruthy();
    expect(createCount).toBe(0);
  });

  it('Cancel with typed text asks before leaving', async () => {
    setUpPickers();
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await user.type(screen.getByRole('textbox', { name: /^Title/ }), 'Algebra');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Create homework', hidden: true })).toBeTruthy();
  });

  it('submitting the form twice in a row creates one homework', async () => {
    const { klass, section } = setUpPickers();
    let createCount = 0;
    server.use(
      http.post('/api/v1/homework', async () => {
        createCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ id: 'hw-1' }, { status: 201 });
      }),
      http.post('/api/v1/homework/:id/assign', () => HttpResponse.json({}, { status: 400 })),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Create homework' });
    await fillCreateBasics(user, klass.name);
    await user.click(screen.getByRole('combobox', { name: /^Section/ }));
    await user.click(await screen.findByRole('option', { name: section.section_name }));
    const form = document.getElementById('homework-create-form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(createCount).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(createCount).toBe(1);
  });
});

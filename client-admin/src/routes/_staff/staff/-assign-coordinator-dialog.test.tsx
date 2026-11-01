/**
 * [83.3.3] Rendered directly (no route of its own), like `-assign-teacher-dialog.test.tsx`.
 */
import {
  apiErrorBody,
  classFactory,
  cleanupTestState,
  renderWithProviders,
  server,
  subjectFactory,
  teacherFactory,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssignCoordinatorDialog } from './-assign-coordinator-dialog';

const TEACHER = teacherFactory({ id: 'teacher-1', employee_id: 'EMP-00001' });
const SUBJECT = subjectFactory({ id: 'subject-1', name_en: 'Mathematics', code: 'MATH' });
const SIX = classFactory({ id: 'class-6', name: 'Class 6' });
const SEVEN = classFactory({ id: 'class-7', name: 'Class 7' });
const paginated = <T,>(rows: T[]) => ({
  data: rows,
  total: rows.length,
  page: 1,
  limit: 100,
  totalPages: 1,
});

function handlers(onPost: (body: unknown) => Response | Promise<Response>) {
  server.use(
    http.get('/api/v1/teachers', () => HttpResponse.json(paginated([TEACHER]))),
    http.get('/api/v1/subjects', () => HttpResponse.json(paginated([SUBJECT]))),
    http.get('/api/v1/classes', () => HttpResponse.json(paginated([SIX, SEVEN]))),
    http.post('/api/v1/coordinators', async ({ request }) => onPost(await request.json())),
  );
}

async function renderDialog() {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <AssignCoordinatorDialog open onOpenChange={onOpenChange} teacherId="teacher-1" />,
    { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
  );
  await view.localeReady;
  return { onOpenChange };
}

async function pickClasses(user: ReturnType<typeof userEvent.setup>, names: RegExp[]) {
  const combo = await screen.findByRole('combobox', { name: 'Classes' });
  for (const name of names) {
    combo.focus();
    await waitFor(() => expect(combo.getAttribute('aria-expanded')).toBe('true'));
    await user.click(await screen.findByRole('option', { name }));
  }
}

describe('AssignCoordinatorDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('a blank subject posts no subjectId (class coordinator of two classes)', async () => {
    let body: unknown;
    handlers((b) => {
      body = b;
      return HttpResponse.json([], { status: 201 });
    });
    const { onOpenChange } = await renderDialog();
    const user = userEvent.setup();
    await pickClasses(user, [/Class 6/, /Class 7/]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toEqual({ teacherId: 'teacher-1', classIds: ['class-6', 'class-7'] });
  });

  it('a chosen subject posts subjectId', async () => {
    let body: unknown;
    handlers((b) => {
      body = b;
      return HttpResponse.json([], { status: 201 });
    });
    await renderDialog();
    const user = userEvent.setup();
    await pickClasses(user, [/Class 6/]);
    const subject = screen.getByRole('combobox', { name: 'Subject' });
    subject.focus();
    await waitFor(() => expect(subject.getAttribute('aria-expanded')).toBe('true'));
    await user.click(await screen.findByRole('option', { name: /MATH/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(body).toEqual({
        teacherId: 'teacher-1',
        classIds: ['class-6'],
        subjectId: 'subject-1',
      }),
    );
  });

  it('a 409 shows the fixed sentence beside Save', async () => {
    handlers(() =>
      HttpResponse.json(apiErrorBody(409, 'x', '/api/v1/coordinators'), { status: 409 }),
    );
    await renderDialog();
    const user = userEvent.setup();
    await pickClasses(user, [/Class 6/]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This coordinator assignment already exists.')).toBeTruthy();
  });

  it('no class chosen: a line beside Save, nothing posted', async () => {
    let posted = false;
    handlers(() => {
      posted = true;
      return HttpResponse.json([], { status: 201 });
    });
    await renderDialog();
    const user = userEvent.setup();
    await screen.findByRole('combobox', { name: 'Classes' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose at least one class.')).toBeTruthy();
    expect(posted).toBe(false);
  });
});

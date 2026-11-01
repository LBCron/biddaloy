import '@biddaloy/ui/test';

import { ExamKind } from '@biddaloy/shared';
import { createAppQueryClient } from '@biddaloy/ui/api';
import {
  academicYearFactory,
  apiErrorBody,
  classFactory,
  cleanupTestState,
  examFactory,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { toIsoDate } from '@biddaloy/ui/utils';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../help/test-utils';

import { ExamFormDialog } from './-exam-form-dialog';

// No Toaster is mounted in tests, so the toast calls are spies.
const toastSuccess = vi.hoisted(() => vi.fn());
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('@biddaloy/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/components')>();
  return {
    ...actual,
    toast: Object.assign(
      (...a: Parameters<typeof actual.toast>) => actual.toast(...a),
      actual.toast,
      {
        success: toastSuccess,
        info: toastInfo,
      },
    ),
  };
});

const year = academicYearFactory({ id: 'year-1', name: '2026' });
const cls = classFactory({ id: 'class-1', name: 'Class 6' });
const TEMPLATES = [
  { id: 'tpl-1', name: 'Half-yearly', kind: 'TERM', rowCount: 4, classGrades: [6] },
];

function mockApi(opts: { templates?: unknown[]; post?: () => Response | Promise<Response> } = {}) {
  const bodies: Record<string, unknown>[] = [];
  let templateCalls = 0;
  server.use(
    http.get('/api/v1/academic-years', () => HttpResponse.json({ data: [year], total: 1 })),
    http.get('/api/v1/classes', () => HttpResponse.json({ data: [cls], total: 1 })),
    http.get('/api/v1/exam-templates', () => {
      templateCalls += 1;
      return HttpResponse.json(opts.templates ?? TEMPLATES);
    }),
    http.post('/api/v1/exams', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return (
        opts.post?.() ??
        HttpResponse.json(
          { ...examFactory({ id: 'exam-9' }), components_created: 3 },
          { status: 201 },
        )
      );
    }),
  );
  return { bodies, templateCalls: () => templateCalls };
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, template?: string) {
  await user.type(screen.getByLabelText('Name'), 'Half Yearly');
  await user.click(screen.getByRole('combobox', { name: 'Academic year' }));
  await user.click(await screen.findByRole('option', { name: '2026' }));
  await user.click(screen.getByRole('combobox', { name: 'Class' }));
  await user.click(await screen.findByRole('option', { name: 'Class 6' }));
  if (template) {
    await user.click(
      screen.getByRole('combobox', { name: 'Start from an exam structure (optional)' }),
    );
    await user.click(await screen.findByRole('option', { name: template }));
  }
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

const renderDialog = (props: Partial<React.ComponentProps<typeof ExamFormDialog>> = {}) =>
  renderWithProviders(
    <ExamFormDialog open onOpenChange={() => {}} mode="create" onSaved={() => {}} {...props} />,
    { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
  );

describe('ExamFormDialog template field', () => {
  afterEach(async () => {
    toastSuccess.mockReset();
    toastInfo.mockReset();
    await cleanupTestState();
  });

  it('shows the name and kind (?) [#3293]', async () => {
    mockApi({ templates: [] });
    renderWithProviders(
      withHelp(<ExamFormDialog open onOpenChange={() => {}} mode="create" onSaved={() => {}} />),
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    await screen.findByLabelText('Name');
    await expectHelp('examsResults.exams.field.name');
    await expectHelp('examsResults.exams.field.kind');
  });

  it('is hidden when the tenant has no templates', async () => {
    const api = mockApi({ templates: [] });
    renderDialog();
    await waitFor(() => expect(api.templateCalls()).toBe(1));
    expect(
      screen.queryByRole('combobox', { name: 'Start from an exam structure (optional)' }),
    ).toBeNull();
  });

  it('is hidden in edit mode and does not fetch templates', async () => {
    const api = mockApi();
    renderDialog({ mode: 'edit', examId: 'exam-1' });
    await screen.findByLabelText('Name');
    expect(
      screen.queryByRole('combobox', { name: 'Start from an exam structure (optional)' }),
    ).toBeNull();
    expect(api.templateCalls()).toBe(0);
  });

  it('sends template_id and toasts the component count', async () => {
    const api = mockApi();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user, 'Half-yearly');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Exam created with ৩ parts'));
    expect(api.bodies[0]).toMatchObject({ template_id: 'tpl-1' });
  });

  it('prefills from defaultTemplateId', async () => {
    const api = mockApi();
    const user = userEvent.setup();
    renderDialog({ defaultTemplateId: 'tpl-1' });
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user);
    await waitFor(() => expect(api.bodies[0]).toMatchObject({ template_id: 'tpl-1' }));
  });

  it('hints when the template matched nothing', async () => {
    mockApi({
      post: () =>
        HttpResponse.json(
          { ...examFactory({ id: 'exam-9' }), components_created: 0 },
          { status: 201 },
        ),
    });
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user, 'Half-yearly');
    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('omits template_id and toasts nothing without a template', async () => {
    const api = mockApi();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user);
    await waitFor(() => expect(api.bodies).toHaveLength(1));
    expect(api.bodies[0]).not.toHaveProperty('template_id');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('disables the class select until an academic year is picked', async () => {
    mockApi();
    renderDialog();
    const classSelect = await screen.findByRole('combobox', { name: 'Class' });
    expect((classSelect as HTMLButtonElement).disabled).toBe(true);
    expect(classSelect.textContent).toContain('Pick an academic year first');
  });

  it('shows the translated error, never the server text', async () => {
    mockApi({
      post: () => HttpResponse.json({ message: 'Exam template x not found' }, { status: 404 }),
    });
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('combobox', { name: 'Start from an exam structure (optional)' });
    await fillAndSubmit(user, 'Half-yearly');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't save the exam.");
    expect(alert.textContent).not.toMatch(/404|not found/);
  });
});

describe('ExamFormDialog mark entry deadline', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const trigger = () => screen.getByRole('button', { name: 'Mark entry deadline' });

  it('has a visible label, the help text, and no clear button without a value', async () => {
    mockApi();
    renderDialog();
    await screen.findByLabelText('Name');
    expect(screen.getByText('Mark entry deadline', { selector: 'label' })).toBeTruthy();
    expect(screen.getByText(/Teachers see the days left/)).toBeTruthy();
    expect(trigger().textContent).toContain('Pick a date');
    expect(screen.queryByRole('button', { name: 'Clear date' })).toBeNull();
  });

  it('create with a picked date posts it as YYYY-MM-DD; without one omits it', async () => {
    const api = mockApi();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByLabelText('Name');
    await user.click(trigger());
    const iso = `${toIsoDate(new Date()).slice(0, 8)}10`;
    await user.click(document.querySelector<HTMLElement>(`[data-date="${iso}"]`)!);
    await fillAndSubmit(user);
    await waitFor(() => expect(api.bodies[0]).toMatchObject({ mark_entry_deadline: iso }));
  });

  it('create without a date omits the field', async () => {
    const api = mockApi();
    const user = userEvent.setup();
    renderDialog();
    await screen.findByLabelText('Name');
    await fillAndSubmit(user);
    await waitFor(() => expect(api.bodies).toHaveLength(1));
    expect(api.bodies[0]).not.toHaveProperty('mark_entry_deadline');
  });

  it('edit shows the saved date; clearing and saving sends null', async () => {
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.patch('/api/v1/exams/exam-1', async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(examFactory({ id: 'exam-1' }));
      }),
    );
    const user = userEvent.setup();
    renderDialog({
      mode: 'edit',
      examId: 'exam-1',
      initialValues: {
        name: 'Half Yearly',
        kind: ExamKind.TERM,
        mark_entry_deadline: '2026-10-10',
      },
    });
    await screen.findByLabelText('Name');
    expect(trigger().textContent).toContain('১০ই অক্টোবর, ২০২৬');
    await user.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(screen.queryByRole('button', { name: 'Clear date' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches[0]).toMatchObject({ mark_entry_deadline: null }));
  });

  it('edit keeps an unchanged deadline', async () => {
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.patch('/api/v1/exams/exam-1', async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(examFactory({ id: 'exam-1' }));
      }),
    );
    const user = userEvent.setup();
    renderDialog({
      mode: 'edit',
      examId: 'exam-1',
      initialValues: {
        name: 'Half Yearly',
        kind: ExamKind.TERM,
        mark_entry_deadline: '2026-10-10',
      },
    });
    await screen.findByLabelText('Name');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches[0]).toMatchObject({ mark_entry_deadline: '2026-10-10' }));
  });

  describe('ExamFormDialog double submit [2622]', () => {
    afterEach(async () => {
      await cleanupTestState();
    });

    it('two rapid submits send one POST', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const api = mockApi({
        post: () => gate.then(() => HttpResponse.json(examFactory(), { status: 201 })),
      });
      const onSaved = vi.fn();
      const user = userEvent.setup();
      renderWithProviders(
        <ExamFormDialog open onOpenChange={() => {}} mode="create" onSaved={onSaved} />,
        { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1', queryClient: createAppQueryClient() },
      );
      await user.type(await screen.findByLabelText('Name'), 'Half Yearly');
      await user.click(screen.getByRole('combobox', { name: 'Academic year' }));
      await user.click(await screen.findByRole('option', { name: '2026' }));
      await user.click(screen.getByRole('combobox', { name: 'Class' }));
      await user.click(await screen.findByRole('option', { name: 'Class 6' }));
      const save = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(save);
      fireEvent.click(save);
      await new Promise((r) => setTimeout(r, 50));
      release();
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(api.bodies).toHaveLength(1);
    });

    const coded = (status: number, code: string) => () =>
      HttpResponse.json(
        { ...apiErrorBody(status, 'x', '/api/v1/exams'), details: { code } },
        { status },
      );

    it('a 409 EXAM_PUBLISHED on edit says the results are published, not a name clash', async () => {
      server.use(http.patch('/api/v1/exams/:id', coded(409, 'EXAM_PUBLISHED')));
      const user = userEvent.setup();
      renderDialog({
        mode: 'edit',
        examId: 'exam-1',
        initialValues: { name: 'Half Yearly', kind: ExamKind.TERM, mark_entry_deadline: null },
      });
      await screen.findByLabelText('Name');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect((await screen.findByRole('alert')).textContent).toBe(
        "This exam's results are published. Reopen the results before changing its type.",
      );
    });

    it('a 400 CLASS_HAS_NO_GRADE on create says the class needs a grade', async () => {
      mockApi({ post: coded(400, 'CLASS_HAS_NO_GRADE') });
      const user = userEvent.setup();
      renderDialog();
      await fillAndSubmit(user);
      expect((await screen.findByRole('alert')).textContent).toMatch(/has no grade set/);
    });

    it('a 409 EXAM_NAME_TAKEN says it already exists', async () => {
      mockApi({ post: coded(409, 'EXAM_NAME_TAKEN') });
      const user = userEvent.setup();
      renderDialog();
      await fillAndSubmit(user);
      expect((await screen.findByRole('alert')).textContent).toBe(
        'An exam with this name already exists.',
      );
    });
  });
});

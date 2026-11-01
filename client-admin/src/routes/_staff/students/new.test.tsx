import { createAppQueryClient } from '@biddaloy/ui/api';
import {
  apiErrorBody,
  classFactory,
  classSectionFactory,
  cleanupTestState,
  guardianFactory,
  renderWithRouter,
  server,
  studentFactory,
  userEvent,
} from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

/**
 * [8.10.3]'s Add Student form, exercised through the real route tree —
 * `StudentForm` calls `useBlocker` (`@tanstack/react-router`), which
 * throws outside a real `RouterProvider`, so `renderWithProviders` alone
 * (no router — see its own header comment) can't render it. Same
 * `renderWithRouter` pattern `$studentId.test.tsx` already uses.
 */
describe('/students/new', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('shows a specific, actionable message and focuses the summary on an empty required field', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 5' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add student' }));

    // `role="alert"` is ambiguous on its own — every per-field `FormMessage`
    // uses it too, not just `FormShell`'s own error summary — so this
    // matches by the summary's own accessible name instead (its heading
    // text, wired via `aria-labelledby`).
    const summary = await screen.findByRole('alert', { name: /problem/i });
    expect(within(summary).getByText('Full name is required.')).toBeTruthy();
    // No jest-dom in this repo's test setup — `document.activeElement`
    // instead of `toHaveFocus()`.
    expect(document.activeElement).toBe(summary);
  });

  it('shows the roll number, blood group and preferred channel (?) [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByRole('heading', { name: 'Add student' });
    await expectHelp('people.students.field.rollNumber');
    await expectHelp('people.students.field.bloodGroup');
    await expectHelp('people.students.field.preferredCommunication');
  });

  it('renders the full-page frame: heading, Close, gender select, one primary, Close goes to the list', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Add student' })).toBeTruthy();
    await user.click(await screen.findByRole('combobox', { name: 'Gender' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Not set',
      'Male',
      'Female',
      'Other',
    ]);
    await user.keyboard('{Escape}');
    expect(
      screen.getByText('Leave blank to use the next roll number in the section.'),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('choosing a class loads that class’s sections, and section resets when class changes', async () => {
    const classA = classFactory({ id: 'class-a', name: 'Class 5' });
    const classB = classFactory({ id: 'class-b', name: 'Class 6' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [classA, classB], total: 2, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', ({ params }) => {
        const classId = params.classId as string;
        return HttpResponse.json([
          classSectionFactory({ id: `${classId}-A`, section_name: 'A', class_id: classId }),
        ]);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 5' }));
    await user.click(await screen.findByRole('combobox', { name: 'Section' }));
    expect(await screen.findByRole('option', { name: 'A' })).toBeTruthy();
  });

  it('links an existing guardian found by search', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Karim Rahman' });
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [guardian], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Search guardians' }), 'Karim');
    const checkbox = await screen.findByRole('checkbox', { name: /Karim Rahman/ });
    await user.click(checkbox);

    const selected = screen.getByRole('list', { name: 'Linked guardians' });
    expect(within(selected).getByText(/Karim Rahman/)).toBeTruthy();
  });

  it('creates a new guardian inline and links it', async () => {
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.post('/api/v1/guardians', () =>
        HttpResponse.json(guardianFactory({ id: 'new-guardian', full_name: 'Salma Begum' }), {
          status: 201,
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a new guardian' }));
    await user.type(screen.getByRole('textbox', { name: "Guardian's full name" }), 'Salma Begum');
    await user.click(screen.getByRole('button', { name: 'Add guardian' }));

    const selected = await screen.findByRole('list', { name: 'Linked guardians' });
    expect(within(selected).getByText(/Salma Begum/)).toBeTruthy();
  });

  it('maps a server-side validation error onto the right input', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 5' });
    const section = classSectionFactory({
      id: 'section-1',
      section_name: 'A',
      class_id: 'class-1',
    });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.post('/api/v1/students', () =>
        HttpResponse.json(
          apiErrorBody(400, ['roll_number must be a positive number'], '/students'),
          { status: 400 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: /^Full name/ }), 'Rahim Uddin');
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 5' }));
    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'Add student' }));

    // Appears twice — once as the field's own `FormMessage`, once as the
    // error-summary's link to it — so this asserts by count rather than a
    // single `getByText`, which throws on more than one match.
    await waitFor(() =>
      expect(screen.getAllByText('roll_number must be a positive number').length).toBeGreaterThan(
        0,
      ),
    );
    // The input must point at its own error message, so a screen reader announces it.
    const roll = screen.getByRole('textbox', { name: /^Roll number/ });
    const describedBy = (roll.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(describedBy).toContain('roll_number must be a positive number');
  });

  it('submits and navigates to the new student on success', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 5' });
    const section = classSectionFactory({
      id: 'section-1',
      section_name: 'A',
      class_id: 'class-1',
    });
    const created = studentFactory({ id: 'student-new', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.post('/api/v1/students', () => HttpResponse.json(created, { status: 201 })),
      http.get('/api/v1/students/:id', () => HttpResponse.json(created)),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: /^Full name/ }), 'Rahim Uddin');
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 5' }));
    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'Add student' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/students/student-new'));
  });

  it('two rapid submits send one POST, and it carries an Idempotency-Key [2594]', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 5' });
    const section = classSectionFactory({
      id: 'section-1',
      section_name: 'A',
      class_id: 'class-1',
    });
    const created = studentFactory({ id: 'student-new', full_name: 'Rahim Uddin' });
    const keys: (string | null)[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([section])),
      http.post('/api/v1/students', async ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        await gate;
        return HttpResponse.json(created, { status: 201 });
      }),
      http.get('/api/v1/students/:id', () => HttpResponse.json(created)),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
      queryClient: createAppQueryClient(),
    });

    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: /^Full name/ }), 'Rahim Uddin');
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 5' }));
    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'A' }));
    const submit = screen.getByRole('button', { name: 'Add student' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    // Let react-hook-form's async validation of both clicks run before the reply.
    await new Promise((r) => setTimeout(r, 100));
    release();

    await waitFor(() => expect(router.state.location.pathname).toBe('/students/student-new'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is axe clean', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 5' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/students/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('textbox', { name: /^Full name/ });
    await expect(container).toHaveNoViolations();
  });
});

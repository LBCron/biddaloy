import {
  apiErrorBody,
  cleanupTestState,
  guardianFactory,
  renderWithRouter,
  server,
  studentFactory,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/students/$studentId/edit', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('prefills the form from the existing student and their linked guardians', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Karim Rahman' });
    const student = studentFactory({
      id: 'student-1',
      full_name: 'Rahim Uddin',
      roll_number: 7,
      guardians: [guardian],
    });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByDisplayValue('Rahim Uddin')).toBeTruthy();
    expect(screen.getByDisplayValue('7')).toBeTruthy();
    const selected = screen.getByRole('list', { name: 'Linked guardians' });
    expect(selected.textContent).toContain('Karim Rahman');
  });

  it('submits a PATCH and navigates back to the detail page on success', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin', guardians: [] });
    let patchBody: unknown;
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.patch('/api/v1/students/:id', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...student, full_name: 'Rahim Uddin Khan' });
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const fullName = await screen.findByDisplayValue('Rahim Uddin');
    const user = userEvent.setup();
    await user.clear(fullName);
    await user.type(fullName, 'Rahim Uddin Khan');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/students/student-1'));
    expect(patchBody).toMatchObject({ full_name: 'Rahim Uddin Khan' });
  });

  it('keeps Save disabled until something changes, and sends only the changed key', async () => {
    const student = studentFactory({
      id: 'student-1',
      full_name: 'Rahim Uddin',
      gender: 'Male (legacy)',
      guardians: [],
    });
    let patchBody: Record<string, unknown> = {};
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.patch('/api/v1/students/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(student);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const fullName = await screen.findByDisplayValue('Rahim Uddin');
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' });
    expect(save.disabled).toBe(true);
    const user = userEvent.setup();
    await user.type(fullName, 'x');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patchBody).toEqual({ full_name: 'Rahim Uddinx' }));
  });

  it('[2683] enables Save after "Restore draft" and sends the restored change', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin', guardians: [] });
    let patchBody: Record<string, unknown> = {};
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.patch('/api/v1/students/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(student);
      }),
    );
    window.localStorage.setItem(
      'form-shell-draft:tenant-1:student-1',
      JSON.stringify({ full_name: 'Rahim Draft' }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore draft' }));
    expect(await screen.findByDisplayValue('Rahim Draft')).toBeTruthy();
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' });
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(patchBody).toEqual({ full_name: 'Rahim Draft' }));
  });

  it('[2683] restores a drafted date of birth as a date and sends it', async () => {
    const student = studentFactory({
      id: 'student-1',
      full_name: 'Rahim Uddin',
      date_of_birth: '2010-01-01',
      guardians: [],
    });
    let patchBody: Record<string, unknown> = {};
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.patch('/api/v1/students/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(student);
      }),
    );
    // The autosave writes JSON, so a drafted Date comes back as an ISO string.
    window.localStorage.setItem(
      'form-shell-draft:tenant-1:student-1',
      JSON.stringify({ date_of_birth: new Date(2015, 4, 20) }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore draft' }));
    const save = await screen.findByRole<HTMLButtonElement>('button', { name: 'Save changes' });
    await waitFor(() => expect(save.disabled).toBe(false));
    await user.click(save);
    await waitFor(() => expect(patchBody).toEqual({ date_of_birth: '2015-05-20' }));
  });

  it('[2683] a restored draft keeps the current guardians, not the drafted set', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Karim Rahman' });
    const student = studentFactory({
      id: 'student-1',
      full_name: 'Rahim Uddin',
      guardians: [guardian],
    });
    let patchBody: Record<string, unknown> = {};
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.patch('/api/v1/students/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(student);
      }),
    );
    // Stale draft: typed before guardian-1 was linked elsewhere.
    window.localStorage.setItem(
      'form-shell-draft:tenant-1:student-1',
      JSON.stringify({ full_name: 'Rahim Draft', guardian_ids: [] }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Restore draft' }));
    expect(await screen.findByDisplayValue('Rahim Draft')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patchBody).toEqual({ full_name: 'Rahim Draft' }));
  });

  it('[2683] keeps Save disabled for a whitespace-only edit', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin', guardians: [] });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const fullName = await screen.findByDisplayValue('Rahim Uddin');
    await userEvent.setup().type(fullName, '   ');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' }).disabled).toBe(
      true,
    );
  });

  it('renders the error state inside the full-page frame', async () => {
    server.use(
      http.get('/api/v1/students/:id', () =>
        HttpResponse.json(apiErrorBody(404, 'x', '/api/v1/x'), { status: 404 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'Edit student' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Close' })).toBeTruthy();
    // [2598] A 404 says "not found" with no retry, and Save stays disabled.
    expect(
      await screen.findByText('It may have been deleted, or the link may be wrong.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save changes' }).disabled).toBe(
      true,
    );
  });

  it('is axe clean', async () => {
    const student = studentFactory({ id: 'student-1', guardians: [] });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByDisplayValue(student.full_name);
    await expect(container).toHaveNoViolations();
  });

  it('[76.5.07] ?focus=card focuses the card field; a 409 shows the fixed sentence under it', async () => {
    const student = studentFactory({ id: 'student-1', card_no: null, guardians: [] });
    let patchBody: unknown;
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.patch('/api/v1/students/:id', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json(
          {
            ...apiErrorBody(409, 'x', '/api/v1/students/student-1'),
            details: { code: 'CARD_NO_TAKEN' },
          },
          { status: 409 },
        );
      }),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit?focus=card'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const input = await screen.findByLabelText('Card number');
    await waitFor(() => expect(document.activeElement).toBe(input));
    const user = userEvent.setup();
    await user.type(input, 'AB-7');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      (await screen.findAllByText('This card number already belongs to another student.')).length,
    ).toBeGreaterThan(0);
    expect(patchBody).toEqual({ card_no: 'AB-7' });
    // [review] The input carries the form's field id, so the error summary link can reach it.
    expect(input.id).toBe('student-form-card_no');
    // [review] Editing the number after the 409 must not bring the stale error back as a generic one.
    await user.type(input, '8');
    // MutationErrorMessage maps a 409 to common:errors.conflict.
    expect(screen.queryByText(/clashes with a record that already exists/)).toBeNull();
  });
});

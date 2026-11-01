import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

/** [26.6.1] `/promotions/new` — see the `## Plan — #1003` GitHub comment
 * for the full design this covers: the `?classId=` prefill, D13's
 * suggested-but-editable target class, D14's per-reason blocking, D21's
 * published-only exam list, and D8's BLOCK/SNAKE choice. */
describe('/promotions/new', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  const year2026 = academicYearFactory({
    id: 'year-2026',
    name: '2026-2027',
    start_date: '2026-01-01T00:00:00.000Z',
  });
  const year2027 = academicYearFactory({
    id: 'year-2027',
    name: '2027-2028',
    start_date: '2027-01-01T00:00:00.000Z',
  });
  const class6 = classFactory({
    id: '00000000-0000-4000-8000-000000000006',
    name: 'Class 6',
    academic_year: year2026,
    academic_year_id: year2026.id,
  });
  const class7 = classFactory({
    id: 'class-7',
    name: 'Class 7',
    academic_year: year2027,
    academic_year_id: year2027.id,
  });

  function stubBase(overrides: { suggestion?: object } = {}) {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [year2026, year2027],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes', ({ request }) => {
        const url = new URL(request.url);
        const academicYearId = url.searchParams.get('academic_year_id');
        const data = academicYearId
          ? [class6, class7].filter((c) => c.academic_year_id === academicYearId)
          : [class6, class7];
        return HttpResponse.json({ data, total: data.length, page: 1, limit: 100, totalPages: 1 });
      }),
      http.get('/api/v1/promotions/suggest-target', () =>
        HttpResponse.json(
          overrides.suggestion ?? {
            target_class: { id: class7.id, name: class7.name },
            retain_class: null,
            sections: [],
          },
        ),
      ),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({
          data: [
            examFactory({
              id: 'exam-draft',
              name: 'Draft exam',
              status: 'DRAFT',
              class: class6,
              class_id: class6.id,
              academic_year: year2026,
              academic_year_id: year2026.id,
            }),
            examFactory({
              id: 'exam-processed',
              name: 'Processed exam',
              status: 'PROCESSED',
              class: class6,
              class_id: class6.id,
              academic_year: year2026,
              academic_year_id: year2026.id,
            }),
            examFactory({
              id: 'exam-published',
              name: 'Published exam',
              status: 'PUBLISHED',
              class: class6,
              class_id: class6.id,
              academic_year: year2026,
              academic_year_id: year2026.id,
            }),
          ],
          total: 3,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );
  }

  it('prefills the source class from ?classId=', async () => {
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const sourceClassSelect = await screen.findByRole('combobox', { name: 'Current class' });
    await within(sourceClassSelect).findByText('Class 6 (2026-2027)');
  });

  it('defaults the target year to the next year by start_date', async () => {
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const targetYearSelect = await screen.findByRole('combobox', { name: 'Next academic year' });
    await within(targetYearSelect).findByText('2027-2028');
  });

  it('shows the suggested target class', async () => {
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const targetClassSelect = await screen.findByRole('combobox', { name: 'Next class' });
    await within(targetClassSelect).findByText('Class 7');
  });

  it('shows the target class, exams and algorithm (?) [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByRole('combobox', { name: 'Next class' });
    await expectHelp('examsResults.promotion.field.targetClass');
    await expectHelp('examsResults.promotion.field.exams');
    await expectHelp('examsResults.promotion.field.algorithm');
  });

  it('shows the target class (?) on the read-only graduate branch [#3314]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    stubBase({ suggestion: { target_class: null, retain_class: null, sections: [] } });
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByText('Graduate (no target class)');
    expect(screen.queryByRole('combobox', { name: 'Next class' })).toBeNull();
    await expectHelp('examsResults.promotion.field.targetClass');
  });

  it('only lists PUBLISHED exams, preselected', async () => {
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const checkbox = await screen.findByRole('checkbox', { name: /Published exam/ });
    expect(checkbox).toBeTruthy();
    expect(screen.queryByText('Draft exam')).toBeNull();
    expect(screen.queryByText('Processed exam')).toBeNull();
    expect((checkbox as HTMLInputElement).getAttribute('aria-checked')).not.toBe('false');
  });

  it('disables submit once every exam is unchecked', async () => {
    const user = userEvent.setup();
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const checkbox = await screen.findByRole('checkbox', { name: /Published exam/ });
    await user.click(checkbox);

    await screen.findByText('Select at least one exam.');
    expect(screen.getByRole('button', { name: 'Create list' }).hasAttribute('disabled')).toBe(true);
  });

  it('blocks submit and shows the classes link for a blocking reason', async () => {
    stubBase({
      suggestion: {
        target_class: null,
        retain_class: null,
        sections: [],
        blocking_reason: 'TARGET_SECTIONS_MISSING',
      },
    });
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText(
      'The target class has no sections yet — create at least one before running this.',
    );
    const link = await screen.findByRole('link', { name: /Open classes for/ });
    expect(link.getAttribute('href')).toBe(`/classes?academic_year_id=${year2027.id}`);
    expect(screen.getByRole('button', { name: 'Create list' }).hasAttribute('disabled')).toBe(true);
  });

  it('unblocks PICK_TARGET_CLASS once a target class is picked', async () => {
    const user = userEvent.setup();
    stubBase({
      suggestion: {
        target_class: null,
        retain_class: null,
        sections: [],
        blocking_reason: 'PICK_TARGET_CLASS',
      },
    });
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Choose a target class, or graduate the source class.');
    expect(screen.getByRole('button', { name: 'Create list' }).hasAttribute('disabled')).toBe(true);

    const targetClassSelect = screen.getByRole('combobox', { name: 'Next class' });
    await user.click(targetClassSelect);
    await user.click(await screen.findByRole('option', { name: 'Class 7' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create list' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
  });

  it('submits the right body', async () => {
    const user = userEvent.setup();
    stubBase();
    let posted: unknown;
    server.use(
      http.post('/api/v1/promotions', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'run-new' }, { status: 201 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const targetClassSelect = await screen.findByRole('combobox', { name: 'Next class' });
    await within(targetClassSelect).findByText('Class 7');
    await user.click(screen.getByRole('radio', { name: /^Snake/ }));

    const submit = await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Create list' });
      expect(button.hasAttribute('disabled')).toBe(false);
      return button;
    });
    await user.click(submit);

    await waitFor(() =>
      expect(posted).toEqual({
        source_class_id: '00000000-0000-4000-8000-000000000006',
        target_academic_year_id: 'year-2027',
        exam_ids: ['exam-published'],
        algorithm: 'SNAKE',
        target_class_id: 'class-7',
      }),
    );
  });

  it('is a full-page form: h1, Close, labelled placeholders, Create disabled until valid', async () => {
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { level: 1, name: 'New promotion list' });
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    const source = await screen.findByRole('combobox', { name: 'Current class' });
    expect(within(source).getByText('Select')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Next academic year' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create list' }).hasAttribute('disabled')).toBe(true);
  });

  it.each(['Close', 'Cancel'])('%s with a changed form asks before leaving', async (name) => {
    const user = userEvent.setup();
    stubBase();
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click(await screen.findByRole('radio', { name: /^Snake/ }));
    await user.click(screen.getByRole('button', { name }));

    await screen.findByText('Discard your changes?');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByText('Discard your changes?')).toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: 'New promotion list' })).toBeTruthy();
  });

  it('shows a translated error, not the server message, when creating fails', async () => {
    const user = userEvent.setup();
    stubBase();
    server.use(
      http.post('/api/v1/promotions', () =>
        HttpResponse.json({ message: 'raw server text' }, { status: 500 }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const targetClass = await screen.findByRole('combobox', { name: 'Next class' });
    await within(targetClass).findByText('Class 7');
    const submit = await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Create list' });
      expect(button.hasAttribute('disabled')).toBe(false);
      return button;
    });
    await user.click(submit);

    await screen.findByText("Couldn't create the list. Please try again.");
    expect(screen.queryByText('raw server text')).toBeNull();
  });

  it('Close is ignored while the create request is pending', async () => {
    const user = userEvent.setup();
    stubBase();
    server.use(
      http.post('/api/v1/promotions', async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return HttpResponse.json({ id: 'run-new' }, { status: 201 });
      }),
    );
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/promotions/new?classId=00000000-0000-4000-8000-000000000006'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const targetClass = await screen.findByRole('combobox', { name: 'Next class' });
    await within(targetClass).findByText('Class 7');
    const submit = await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Create list' });
      expect(button.hasAttribute('disabled')).toBe(false);
      return button;
    });
    await user.click(submit);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.hasAttribute('disabled')).toBe(true);
    await user.click(cancel);

    expect(screen.getByRole('heading', { level: 1, name: 'New promotion list' })).toBeTruthy();
    // The create was not abandoned: it finishes and opens the new list.
    await waitFor(() => expect(router.state.location.pathname).toBe('/promotions/run-new'));
  });
});

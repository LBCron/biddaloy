import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

const GRID_URL = '/api/v1/exams/exam-1/marks';

const baseGrid = {
  exam_id: 'exam-1',
  section_id: 'sec-1',
  subject_id: 'subj-1',
  state: 'DRAFT' as const,
  submitted_by: null,
  submitted_at: null,
  students: [{ id: 's1', roll_number: 1, full_name: 'Rafi Ahmed' }],
  components: [
    {
      id: 'c1',
      name: 'Written',
      kind: 'WRITTEN',
      source: 'MANUAL',
      full_marks: '100',
      pass_marks: null,
      sequence: 1,
    },
  ],
  cells: [],
  derived: {},
};

describe('/marks/$examId/$sectionId/$subjectId', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  // [44.4 / #3012] The (?) after "Submit" resolves the generated guide entry.
  it('shows the (?) after the submit button when a handbook URL is set', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    server.use(http.get(GRID_URL, () => HttpResponse.json(baseGrid)));
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });
    await screen.findByLabelText('Rafi Ahmed — Written');
    // By id: the page-level (?) carries the same "Help: <page title>" name.
    await waitFor(() =>
      expect(
        document.querySelector('[data-help-id="examsResults.marksEntry.action.submit"]'),
      ).not.toBeNull(),
    );
  });

  it('shows the mark grid (?) beside the keyboard help [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    server.use(http.get(GRID_URL, () => HttpResponse.json(baseGrid)));
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });
    await screen.findByLabelText('Rafi Ahmed — Written');
    await expectHelp('examsResults.marksEntry.field.mark');
  });

  it('shows the mark (?) once above the stepper on a phone [#3314]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }));
    try {
      server.use(http.get(GRID_URL, () => HttpResponse.json(baseGrid)));
      renderWithRouter(routeTree, {
        initialEntries: ['/marks/exam-1/sec-1/subj-1'],
        tenantId: 'tenant-1',
        role: 'TEACHER',
        locale: 'en',
      });
      await expectHelp('examsResults.marksEntry.field.mark');
      expect(
        document.querySelectorAll('[data-help-id="examsResults.marksEntry.field.mark"]'),
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the save-state header and moves saving -> saved after a batch commits', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, async ({ request }) => {
        const body = (await request.json()) as { cells: Array<Record<string, unknown>> };
        return HttpResponse.json({
          cells: body.cells.map((cell) => ({ ...cell, saved_at: new Date().toISOString() })),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('No changes yet');
    const cell = await screen.findByLabelText('Rafi Ahmed — Written');
    await user.type(cell, '90');

    // Debounced batch fires ~600ms after the last keystroke, then the
    // header settles on the authoritative "saved" line.
    await within(screen.getByTestId('save-state-line')).findByText(/All changes saved/, undefined, {
      timeout: 3000,
    });
  });

  it('shows "Saving…" while a batch is in flight', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, async ({ request }) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const body = (await request.json()) as { cells: Array<Record<string, unknown>> };
        return HttpResponse.json({
          cells: body.cells.map((cell) => ({ ...cell, saved_at: new Date().toISOString() })),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText('Rafi Ahmed — Written');
    await user.type(cell, '90');

    await within(screen.getByTestId('save-state-line')).findByText(/Saving/, undefined, {
      timeout: 3000,
    });
    await within(screen.getByTestId('save-state-line')).findByText(/All changes saved/, undefined, {
      timeout: 3000,
    });
  });

  it("keeps a failed save's value in the cell and keeps retrying", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, async ({ request }) => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json({ message: 'boom' }, { status: 500 });
        }
        const body = (await request.json()) as { cells: Array<Record<string, unknown>> };
        return HttpResponse.json({
          cells: body.cells.map((cell) => ({ ...cell, saved_at: new Date().toISOString() })),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    await user.type(cell, '90');

    await within(screen.getByTestId('save-state-line')).findByText(/not saved/, undefined, {
      timeout: 2000,
    });
    // Never discarded — the typed value stays in the cell.
    // The cell re-renders the kept value in the region's numerals.
    expect(cell.value).toBe(formatNumber(90, REGION_BD_BN));

    await within(screen.getByTestId('save-state-line')).findByText(/All changes saved/, undefined, {
      timeout: 5000,
    });
  });

  it('a blank cell blocks submit: alert shows and the confirm button is disabled', async () => {
    const user = userEvent.setup();
    server.use(http.get(GRID_URL, () => HttpResponse.json(baseGrid)));

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByLabelText('Rafi Ahmed — Written');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('alert');
    expect(within(dialog).getByRole('alert').textContent).toContain(
      `${formatNumber(1, REGION_BD_BN)} blank cell must be filled first`,
    );
    expect(within(dialog).getByRole('button', { name: 'Submit' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('a late joiner with no marks does not block submit, and the grid is read-only afterwards', async () => {
    const user = userEvent.setup();
    let state: 'DRAFT' | 'SUBMITTED' = 'DRAFT';
    const grid = {
      ...baseGrid,
      students: [
        { id: 's1', roll_number: 1, full_name: 'Rafi Ahmed' },
        { id: 's2', roll_number: 2, full_name: 'Late Joiner', joined_after_exam: true },
      ],
      cells: [{ student_id: 's1', component_id: 'c1', value: '80.00', status: 'PRESENT' }],
    };
    server.use(
      http.get(GRID_URL, () => HttpResponse.json({ ...grid, state })),
      http.post(`${GRID_URL}/submit`, () => {
        state = 'SUBMITTED';
        return HttpResponse.json({
          ...grid,
          state: 'SUBMITTED',
          submitted_by: 'user-1',
          submitted_at: new Date().toISOString(),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByLabelText('Rafi Ahmed — Written');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('alert')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));

    await screen.findByText(/Only an admin can reopen it/);
    const submittedCell = screen.getByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    expect(submittedCell.disabled).toBe(true);
  });

  it('a student who does not take this optional subject does not block submit', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(GRID_URL, () =>
        HttpResponse.json({
          ...baseGrid,
          students: [
            { id: 's1', roll_number: 1, full_name: 'Rafi Ahmed' },
            { id: 's2', roll_number: 2, full_name: 'Not Taking', not_taking: true },
          ],
          cells: [{ student_id: 's1', component_id: 'c1', value: '80.00', status: 'PRESENT' }],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByLabelText('Rafi Ahmed — Written');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Submit' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('a stale page that gets 409 GRID_INCOMPLETE shows the blocking line', async () => {
    const user = userEvent.setup();
    const filled = {
      ...baseGrid,
      cells: [{ student_id: 's1', component_id: 'c1', value: '80.00', status: 'PRESENT' }],
    };
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(filled)),
      http.post(`${GRID_URL}/submit`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: '2 blank cell(s).',
            timestamp: new Date().toISOString(),
            path: '/x',
            requestId: 'r1',
            details: { code: 'GRID_INCOMPLETE', blank_count: 2, blank: [] },
          },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByLabelText('Rafi Ahmed — Written');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await within(dialog).findByText(/blank cells must be filled first/);
  });

  // Submit locks the grid, so a mark typed just before it must be saved
  // first — and the blank count must reflect it, not the page-load grid.
  it('submitting right after typing saves the mark first and counts it as filled', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    let state: 'DRAFT' | 'SUBMITTED' = 'DRAFT';
    server.use(
      http.get(GRID_URL, () => HttpResponse.json({ ...baseGrid, state })),
      http.patch(GRID_URL, async ({ request }) => {
        calls.push('save');
        const body = (await request.json()) as { cells: Array<Record<string, unknown>> };
        return HttpResponse.json({
          cells: body.cells.map((cell) => ({ ...cell, saved_at: new Date().toISOString() })),
        });
      }),
      http.post(`${GRID_URL}/submit`, () => {
        calls.push('submit');
        state = 'SUBMITTED';
        return HttpResponse.json({
          ...baseGrid,
          state: 'SUBMITTED',
          submitted_by: 'user-1',
          submitted_at: new Date().toISOString(),
        });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Rafi Ahmed — Written'), '90');
    // Well inside the 600ms debounce — nothing has been saved yet.
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('heading', { name: 'Submit this marks list?' });
    expect(screen.queryByText(/must be filled first/)).toBeNull();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit' }));

    await screen.findByText(/Only an admin can reopen it/);
    expect(calls).toEqual(['save', 'submit']);
  });

  it('does not submit when saving the pending marks fails', async () => {
    const user = userEvent.setup();
    let submitted = false;
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
      http.post(`${GRID_URL}/submit`, () => {
        submitted = true;
        return HttpResponse.json({ ...baseGrid, state: 'SUBMITTED' });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Rafi Ahmed — Written'), '90');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('heading', { name: 'Submit this marks list?' });
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    // The dialog closes so the header's "not saved" line is visible.
    await within(screen.getByTestId('save-state-line')).findByText(/not saved/);
    expect(screen.queryByRole('heading', { name: 'Submit this marks list?' })).toBeNull();
    expect(submitted).toBe(false);
  });

  it('a submitted grid a teacher opens is read-only from the start', async () => {
    server.use(
      http.get(GRID_URL, () =>
        HttpResponse.json({
          ...baseGrid,
          state: 'SUBMITTED',
          submitted_by: 'user-1',
          submitted_at: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    expect(cell.disabled).toBe(true);
    // A plain teacher has no Reopen action.
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  it('an exam controller (view only) sees an unsubmitted grid read-only with no submit', async () => {
    const user = userEvent.setup();
    server.use(http.get(GRID_URL, () => HttpResponse.json(baseGrid)));

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'EXAM_CONTROLLER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    expect(cell.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    // The Ctrl+Enter shortcut is gated the same way as the button.
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.queryByRole('heading', { name: 'Submit this marks list?' })).toBeNull();
  });

  it('a teacher can edit an unsubmitted grid and Ctrl+Enter opens submit', async () => {
    const user = userEvent.setup();
    server.use(http.get(GRID_URL, () => HttpResponse.json(baseGrid)));

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const cell = await screen.findByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    expect(cell.disabled).toBe(false);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await screen.findByRole('heading', { name: 'Submit this marks list?' });
  });

  it('an admin sees a Reopen action on a submitted grid', async () => {
    server.use(
      http.get(GRID_URL, () =>
        HttpResponse.json({
          ...baseGrid,
          state: 'SUBMITTED',
          submitted_by: 'user-1',
          submitted_at: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('button', { name: 'Reopen' });
  });

  const mathDraft = {
    section_id: 'sec-1',
    section_name: 'Six - A',
    subject_id: 'subj-1',
    subject_name: 'Math',
    subject_name_bn: null,
    state: 'DRAFT',
  };
  const englishDraft = { ...mathDraft, subject_id: 'subj-other', subject_name: 'English' };

  it('a submitted grid listed only in grids names its subject and section, with no save line', async () => {
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' });
    server.use(
      http.get(GRID_URL, () =>
        HttpResponse.json({
          ...baseGrid,
          state: 'SUBMITTED',
          submitted_by: 'user-1',
          submitted_at: '2026-01-01T00:00:00.000Z',
        }),
      ),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
      ),
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({
          counts: { DRAFT: 0, SUBMITTED: 1 },
          outstanding: [],
          grids: [{ ...mathDraft, state: 'SUBMITTED' }],
        }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText(
      `Math · Section Six - A · Half Yearly 2026 · ${formatNumber(1, REGION_BD_BN)} student`,
    );
    expect(screen.queryByText('No changes yet')).toBeNull();
    expect(screen.queryByTestId('save-state-line')).toBeNull();
  });

  it('names the subject, section and exam in the subtitle', async () => {
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' });
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
      ),
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({
          counts: { DRAFT: 1, SUBMITTED: 0 },
          outstanding: [mathDraft],
          grids: [mathDraft],
        }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText(
      `Math · Section Six - A · Half Yearly 2026 · ${formatNumber(1, REGION_BD_BN)} student`,
    );
    // Desktop only: the keyboard help and the student total.
    expect(screen.getByText(`Total ${formatNumber(1, REGION_BD_BN)}`)).toBeTruthy();
    expect(screen.getByText('Enter')).toBeTruthy();
  });

  it("never borrows another subject's name for the subtitle, but still names the section", async () => {
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' });
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
      ),
      // This subject is done, so only another subject of the section is outstanding.
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({
          counts: { DRAFT: 1, SUBMITTED: 1 },
          outstanding: [englishDraft],
          grids: [englishDraft],
        }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText(
      `Section Six - A · Half Yearly 2026 · ${formatNumber(1, REGION_BD_BN)} student`,
    );
    expect(screen.queryByText(/English/)).toBeNull();
  });

  it('shows the saved time without seconds, in the tenant numerals', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, async ({ request }) => {
        const body = (await request.json()) as { cells: Array<Record<string, unknown>> };
        return HttpResponse.json({
          cells: body.cells.map((cell) => ({ ...cell, saved_at: new Date().toISOString() })),
        });
      }),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Rafi Ahmed — Written'), '90');
    const line = await within(screen.getByTestId('save-state-line')).findByText(
      /All changes saved/,
      undefined,
      { timeout: 3000 },
    );
    // "<hh>:<mm>" in Bangla digits and no seconds part.
    expect(line.textContent).toMatch(/[০-৯]{1,2}:[০-৯]{2}(?!:)/);
    expect(line.textContent).not.toMatch(/:[০-৯]{2}:/);
  });

  it('a submitted grid shows a Submitted badge and a date sentence, never the user id', async () => {
    server.use(
      http.get(GRID_URL, () =>
        HttpResponse.json({
          ...baseGrid,
          state: 'SUBMITTED',
          submitted_by: 'user-uuid-123',
          submitted_at: '2026-09-09T09:45:00.000Z',
        }),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Submitted');
    await screen.findByText(/Only an admin can reopen it/);
    expect(screen.queryByText(/user-uuid-123/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });

  it('an error response shows the load-error sentence, not the page title', async () => {
    server.use(http.get(GRID_URL, () => HttpResponse.json({ message: 'x' }, { status: 400 })));
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText("Couldn't load marks lists.");
    expect(screen.queryByRole('heading', { name: 'Marks list' })).toBeNull();
  });

  it('asks before leaving with unsaved marks', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(GRID_URL, () => HttpResponse.json(baseGrid)),
      http.patch(GRID_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/marks/exam-1/sec-1/subj-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await user.type(await screen.findByLabelText('Rafi Ahmed — Written'), '90');
    const navLinks = screen.getAllByRole('link', { name: 'Enter marks' });
    expect(navLinks.every((a) => a.getAttribute('href') === '/marks')).toBe(true);
    await user.click(navLinks.find((a) => a.closest('aside, nav'))!);
    await screen.findByRole('heading', { name: 'Leave without saving?' });
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('heading', { name: 'Leave without saving?' })).toBeNull();
  });
});

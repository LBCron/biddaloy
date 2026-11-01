import { toast } from '@biddaloy/ui/components';
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

const RUN_URL = '/api/v1/promotions/run-1';

function entry(overrides: Record<string, unknown> = {}) {
  const studentId = typeof overrides.student_id === 'string' ? overrides.student_id : 's1';
  return {
    id: `entry-${studentId}`,
    tenant_id: 'tenant-1',
    run_id: 'run-1',
    student_id: 's1',
    source_enrollment_id: 'enr-1',
    source_section_id: 'sec-src',
    merit_rank: 1,
    mean_gpa: '4.50',
    total_marks_sum: '450',
    passed_all: true,
    suggested_outcome: 'PROMOTE',
    final_outcome: 'PROMOTE',
    is_override: false,
    override_note: null,
    overridden_by_user_id: null,
    group_name: null,
    target_class_id: 'class-7',
    target_section_id: 'sec-a',
    new_roll_number: 1,
    placement_error: null,
    target_enrollment_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    student_name: 'Rafi Ahmed',
    student_roll_number: 1,
    ...overrides,
  };
}

function baseRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    tenant_id: 'tenant-1',
    source_class_id: 'class-6',
    source_academic_year_id: 'year-2026',
    target_academic_year_id: 'year-2027',
    target_class_id: 'class-7',
    exam_ids: ['exam-1'],
    algorithm: 'BLOCK',
    status: 'DRAFT',
    refreshed_at: '2026-01-01T00:00:00.000Z',
    committed_at: null,
    committed_by_user_id: null,
    approved_by_user_id: null,
    override_count: 0,
    created_by_user_id: 'user-admin',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    entries: [entry()],
    ...overrides,
  };
}

function stubCommon() {
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [
          { id: 'year-2026', name: '2026-2027' },
          { id: 'year-2027', name: '2027-2028' },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [
          { id: 'class-6', name: 'Class 6' },
          { id: 'class-7', name: 'Class 7' },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes/vocabulary', () =>
      HttpResponse.json({ groups: ['Science', 'Arts'] }),
    ),
    http.get('/api/v1/classes/class-7/sections', () =>
      HttpResponse.json([{ id: 'sec-a', section_name: 'A', capacity: 40, enrolled_count: 10 }]),
    ),
  );
}

type Entry = ReturnType<typeof entry>;
type EntryPatch = {
  student_id: string;
  final_outcome?: string;
  group_name?: string;
  override_note?: string;
};

/** A run server that validates entry PATCHes the way `patchEntries` does:
 * 400 on a blank note (DTO), 422 on an override with no note, a
 * non-override's note nulled, the whole batch applied or none of it. It
 * records every PATCH body and the stored run at the moment of commit. */
function statefulRun(initial: ReturnType<typeof baseRun> = baseRun()) {
  let entries = initial.entries.map((row) => ({ ...row }));
  let status = 'DRAFT';
  const record = {
    patches: [] as EntryPatch[][],
    entries: () => entries,
    committed: null as Entry[] | null,
  };
  const current = () => ({ ...initial, status, entries });
  server.use(
    http.get(RUN_URL, () => HttpResponse.json(current())),
    http.patch(`${RUN_URL}/entries`, async ({ request }) => {
      const body = (await request.json()) as EntryPatch[];
      record.patches.push(body);
      if (
        body.some((patch) => patch.override_note !== undefined && patch.override_note.trim() === '')
      ) {
        return HttpResponse.json(apiErrorBody(400, 'Bad Request', `${RUN_URL}/entries`), {
          status: 400,
        });
      }
      const next = entries.map((row) => ({ ...row }));
      for (const patch of body) {
        const row = next.find((candidate) => candidate.student_id === patch.student_id);
        if (!row) continue;
        const finalOutcome = patch.final_outcome ?? row.final_outcome;
        const override = finalOutcome !== row.suggested_outcome;
        const note = override ? (patch.override_note ?? row.override_note) : null;
        if (override && !note) {
          return HttpResponse.json(
            apiErrorBody(422, 'Unprocessable Entity', `${RUN_URL}/entries`),
            {
              status: 422,
            },
          );
        }
        Object.assign(row, {
          final_outcome: finalOutcome,
          is_override: override,
          override_note: note,
          ...(patch.group_name !== undefined ? { group_name: patch.group_name } : {}),
        });
      }
      entries = next;
      return HttpResponse.json(current());
    }),
    http.post(`${RUN_URL}/commit`, () => {
      record.committed = entries.map((row) => ({ ...row }));
      status = 'COMMITTED';
      return HttpResponse.json(current());
    }),
  );
  return record;
}

function renderRun() {
  renderWithRouter(routeTree, {
    initialEntries: ['/promotions/run-1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('/promotions/$runId', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('shows the final decision and override note (?) in the grid header [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    stubCommon();
    statefulRun();
    renderRun();
    await screen.findByLabelText('Final decision');
    await expectHelp('examsResults.promotion.field.finalOutcome');
    await expectHelp('examsResults.promotion.field.overrideNote');
  });

  it('R on a promoted row marks the override and focuses the note; clearing the note shows the error', async () => {
    const user = userEvent.setup();
    stubCommon();
    statefulRun();
    renderRun();

    const outcomeCell = await screen.findByLabelText('Final decision');
    outcomeCell.focus();
    await user.keyboard('r');

    await screen.findByText('Changed by hand');
    const note = await screen.findByLabelText('Why changed');
    await waitFor(() => expect(document.activeElement).toBe(note));

    await user.click(note);
    await user.keyboard('{Backspace}');
    note.blur();
    await screen.findByText('Write why you changed it.');
  });

  async function overrideWithNote(user: ReturnType<typeof userEvent.setup>) {
    const outcomeCell = await screen.findByLabelText('Final decision');
    outcomeCell.focus();
    await user.keyboard('r');
    const note = await screen.findByLabelText('Why changed');
    await waitFor(() => expect(document.activeElement).toBe(note));
    await user.keyboard('Weak in maths');
    return outcomeCell;
  }

  it('saves an override together with its note, in one request', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    await overrideWithNote(user);

    await waitFor(() => expect(record.patches).toHaveLength(1), { timeout: 2000 });
    expect(record.patches[0]).toEqual([
      { student_id: 's1', final_outcome: 'RETAIN', override_note: 'Weak in maths' },
    ]);
    expect(record.entries()[0]).toMatchObject({
      final_outcome: 'RETAIN',
      override_note: 'Weak in maths',
    });
  });

  it('reverting to the suggested outcome drops the pending note save', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    const outcomeCell = await overrideWithNote(user);
    outcomeCell.focus();
    await user.keyboard('p');

    await waitFor(() => expect(record.patches).toHaveLength(1));
    await sleep(700);
    expect(record.patches).toEqual([[{ student_id: 's1', final_outcome: 'PROMOTE' }]]);
    expect(record.entries()[0]).toMatchObject({ final_outcome: 'PROMOTE', override_note: null });
  });

  it('flushes a note still in its debounce before committing', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    await overrideWithNote(user);
    await user.keyboard('{Control>}{Enter}{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Finalise' }));

    await waitFor(() => expect(record.committed).not.toBeNull());
    expect(record.committed?.[0]).toMatchObject({
      final_outcome: 'RETAIN',
      override_note: 'Weak in maths',
    });
  });

  it('keeps the stored note when an overridden row switches to another override', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun(
      baseRun({
        entries: [entry({ final_outcome: 'RETAIN', is_override: true, override_note: 'old' })],
      }),
    );
    renderRun();

    await user.click(await screen.findByRole('combobox', { name: 'Final decision' }));
    await user.click(await screen.findByRole('option', { name: 'Promote on condition' }));

    await waitFor(() =>
      expect(record.patches).toEqual([
        [{ student_id: 's1', final_outcome: 'CONDITIONAL', override_note: 'old' }],
      ]),
    );
  });

  it('reports a failed save and does not commit', async () => {
    const user = userEvent.setup();
    const toastError = vi.spyOn(toast, 'error');
    stubCommon();
    const record = statefulRun();
    server.use(
      http.patch(`${RUN_URL}/entries`, () =>
        HttpResponse.json(apiErrorBody(500, 'Internal Server Error', `${RUN_URL}/entries`), {
          status: 500,
        }),
      ),
    );
    renderRun();

    await overrideWithNote(user);
    await user.keyboard('{Control>}{Enter}{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Finalise' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not save this change. Please try again.'),
    );
    expect(record.committed).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('a group change triggers an update', async () => {
    const user = userEvent.setup();
    stubCommon();
    let patchedBody: unknown;
    server.use(
      http.get(RUN_URL, () => HttpResponse.json(baseRun())),
      http.patch(`${RUN_URL}/entries`, async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json(baseRun());
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/run-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await user.click(await screen.findByLabelText('Group'));
    await user.click(await screen.findByText('Science'));

    await waitFor(() => expect(patchedBody).toEqual([{ student_id: 's1', group_name: 'Science' }]));
  });

  // Only the commit endpoint returns these codes — so drive a real commit
  // (Ctrl+Enter → confirm) rather than faking them on the entries PATCH.
  async function commitAndGetConflict(
    code: 'STALE_RESULTS' | 'COHORT_CHANGED' | 'RETAIN_CLASS_MISSING',
  ) {
    const user = userEvent.setup();
    stubCommon();
    server.use(
      http.get(RUN_URL, () => HttpResponse.json(baseRun())),
      http.post(`${RUN_URL}/commit`, () =>
        HttpResponse.json(
          { ...apiErrorBody(409, 'Conflict', `${RUN_URL}/commit`), details: { code } },
          { status: 409 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/run-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const outcomeCell = await screen.findByLabelText('Final decision');
    outcomeCell.focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Finalise' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }

  it('shows the stale-results banner when commit returns STALE_RESULTS', async () => {
    await commitAndGetConflict('STALE_RESULTS');
    await screen.findByText('Results changed since this preview — refresh');
  });

  it("the stale-results banner's Refresh button refreshes the run", async () => {
    await commitAndGetConflict('STALE_RESULTS');
    let refreshed = false;
    server.use(
      http.post(`${RUN_URL}/refresh`, () => {
        refreshed = true;
        return HttpResponse.json(baseRun());
      }),
    );

    const banner = (
      await screen.findByText('Results changed since this preview — refresh')
    ).closest('section') as HTMLElement;
    await userEvent.click(within(banner).getByRole('button', { name: 'Update from results' }));

    await waitFor(() => expect(refreshed).toBe(true));
    await waitFor(() =>
      expect(screen.queryByText('Results changed since this preview — refresh')).toBeNull(),
    );
  });

  it('tells the user to press Update from results when commit returns COHORT_CHANGED', async () => {
    await commitAndGetConflict('COHORT_CHANGED');
    await screen.findByText(/Press Update from results, check the list, then commit again/);
    // The toolbar button plus the one the banner now carries.
    expect(screen.getAllByRole('button', { name: 'Update from results' })).toHaveLength(2);
    expect(screen.queryByText('Results changed since this preview — refresh')).toBeNull();
  });

  it('says a retain class is needed when commit returns RETAIN_CLASS_MISSING (#2924)', async () => {
    const toastError = vi.spyOn(toast, 'error');
    await commitAndGetConflict('RETAIN_CLASS_MISSING');
    expect(toastError).toHaveBeenCalledWith(
      "No class is set up to retain students who didn't pass — add one first.",
    );
  });

  it('renders a committed run read-only', async () => {
    stubCommon();
    server.use(
      http.get(RUN_URL, () =>
        HttpResponse.json(
          baseRun({
            status: 'COMMITTED',
            committed_at: '2026-02-01T00:00:00.000Z',
            committed_by_user_id: 'user-admin',
            approved_by_user_id: 'user-admin2',
            entries: [entry({ final_outcome: 'PROMOTE' })],
          }),
        ),
      ),
      http.get('/api/v1/users/user-admin', () =>
        HttpResponse.json({ id: 'user-admin', full_name: 'Admin One' }),
      ),
      http.get('/api/v1/users/user-admin2', () =>
        HttpResponse.json({ id: 'user-admin2', full_name: 'Admin Two' }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/promotions/run-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await within(await screen.findByRole('status')).findByText('Promoted ১');
    expect(screen.queryByRole('button', { name: /Finalise/ })).toBeNull();
    // No decision control on a finalised list: plain text, no combobox.
    expect(screen.queryByRole('combobox', { name: 'Final decision' })).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
    await screen.findByText('Admin One');
    await screen.findByText('Admin Two');
    expect(screen.getByText('Finalised by')).toBeTruthy();
    expect(screen.getByText('Approved by')).toBeTruthy();
  });

  it('the final decision is a combobox a mouse user can change', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    const trigger = await screen.findByRole('combobox', { name: 'Final decision' });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Retain' }));

    const row = trigger.closest('tr') as HTMLElement;
    await within(row).findByText('Changed by hand');
    const note = within(row).getByRole('textbox', { name: 'Why changed' });
    expect(note.getAttribute('placeholder')).toBe('Why did you change it?');
    await user.type(note, 'Absent a lot');
    await waitFor(
      () =>
        expect(record.patches.at(-1)).toEqual([
          { student_id: 's1', final_outcome: 'RETAIN', override_note: 'Absent a lot' },
        ]),
      { timeout: 2000 },
    );
  });

  it('shows a placement problem in words, in the row and in one alert card, never the code', async () => {
    stubCommon();
    server.use(
      http.get(RUN_URL, () =>
        HttpResponse.json(
          baseRun({
            entries: [entry({ placement_error: 'OVER_CAPACITY', target_section_id: null })],
          }),
        ),
      ),
    );
    renderRun();

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: /Fix .* problem\(s\) before finalising/ }),
    ).toBeTruthy();
    expect(screen.getByText('No room in any section')).toBeTruthy();
    expect(screen.queryByText(/OVER_CAPACITY/)).toBeNull();
  });

  it('shows and blocks on a placement problem of a saved Promote override (#2926)', async () => {
    const user = userEvent.setup();
    stubCommon();
    server.use(
      http.get(RUN_URL, () =>
        HttpResponse.json(
          baseRun({
            entries: [
              entry({
                suggested_outcome: 'RETAIN',
                final_outcome: 'PROMOTE',
                is_override: true,
                override_note: 'Parents asked',
                placement_error: 'OVER_CAPACITY',
                target_section_id: null,
              }),
            ],
          }),
        ),
      ),
    );
    renderRun();

    expect(await screen.findByText('No room in any section')).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /Finalise/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Fix every placement error before finalising.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Finalise' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('the Finalise button carries no shortcut text and Delete asks before deleting', async () => {
    const user = userEvent.setup();
    stubCommon();
    statefulRun();
    let deleted = false;
    server.use(
      http.delete(RUN_URL, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderRun();

    const finalise = await screen.findByRole('button', { name: 'Finalise' });
    expect(finalise.textContent).not.toContain('Ctrl');

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete list' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(deleted).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deleted).toBe(false);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete list' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('shows a dash, never the id, for a class that is not in the lookups', async () => {
    stubCommon();
    server.use(
      http.get(RUN_URL, () => HttpResponse.json(baseRun({ source_class_id: 'class-ghost' }))),
    );
    renderRun();

    await screen.findByRole('heading', { level: 1, name: '— → Class 7' });
    expect(screen.queryByText(/class-ghost/)).toBeNull();
  });

  it('has no Group column when the school has no groups', async () => {
    stubCommon();
    server.use(
      http.get('/api/v1/classes/vocabulary', () => HttpResponse.json({ groups: [] })),
      http.get(RUN_URL, () => HttpResponse.json(baseRun())),
    );
    renderRun();

    await screen.findByRole('combobox', { name: 'Final decision' });
    expect(screen.queryByRole('columnheader', { name: 'Group' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Final decision' })).toBeTruthy();
  });

  it('offers Promote on condition, counts it as promoted and saves it with its note', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    const trigger = await screen.findByRole('combobox', { name: 'Final decision' });
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Promote on condition' }));

    const row = trigger.closest('tr') as HTMLElement;
    const note = await within(row).findByRole('textbox', { name: 'Why changed' });
    await user.type(note, 'Re-test by March');
    await waitFor(
      () =>
        expect(record.patches.at(-1)).toEqual([
          { student_id: 's1', final_outcome: 'CONDITIONAL', override_note: 'Re-test by March' },
        ]),
      { timeout: 2000 },
    );
    const summary = screen.getByRole('status');
    expect(within(summary).getByText('Promoted ১')).toBeTruthy();
    expect(within(summary).getByText('Graduated ০')).toBeTruthy();
  });

  it('a normal run has no Graduate option, and the G key does nothing', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    const cell = await screen.findByRole('combobox', { name: 'Final decision' });
    cell.focus();
    await user.keyboard('g');
    expect(record.patches).toEqual([]);
    await user.click(cell);
    expect(await screen.findByRole('option', { name: 'Retain' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Graduate' })).toBeNull();
  });

  it('a graduation run does not offer Promote on condition', async () => {
    const user = userEvent.setup();
    stubCommon();
    server.use(
      http.get(RUN_URL, () =>
        HttpResponse.json(
          baseRun({
            target_class_id: null,
            entries: [
              entry({
                suggested_outcome: 'GRADUATE',
                final_outcome: 'GRADUATE',
                target_section_id: null,
                new_roll_number: null,
              }),
            ],
          }),
        ),
      ),
    );
    renderRun();

    await user.click(await screen.findByRole('combobox', { name: 'Final decision' }));
    expect(await screen.findByRole('option', { name: 'Graduate' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Promote on condition' })).toBeNull();
  });

  it('on a phone a graduation run offers 3 decisions, without Promote on condition', async () => {
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
      stubCommon();
      server.use(
        http.get(RUN_URL, () =>
          HttpResponse.json(
            baseRun({
              target_class_id: null,
              entries: [entry({ suggested_outcome: 'GRADUATE', final_outcome: 'GRADUATE' })],
            }),
          ),
        ),
      );
      renderRun();

      const group = await screen.findByRole('radiogroup', { name: 'Final decision' });
      expect(within(group).getAllByRole('radio')).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('on a phone the decision is a radio group and the stepper buttons are named', async () => {
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
      stubCommon();
      server.use(
        http.get(RUN_URL, () =>
          HttpResponse.json(baseRun({ entries: [entry(), entry({ student_id: 's2', id: 'e2' })] })),
        ),
      );
      renderRun();

      const group = await screen.findByRole('radiogroup', { name: 'Final decision' });
      expect(within(group).getAllByRole('radio')).toHaveLength(3);
      expect(screen.getByRole('button', { name: 'Previous student' })).toBeTruthy();
      // [#3314] The phone card carries the same two (?) as the desktop header.
      await expectHelp('examsResults.promotion.field.finalOutcome');
      await expectHelp('examsResults.promotion.field.overrideNote');
      expect(screen.getByRole('button', { name: 'Next student' })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Ctrl+Enter does not open the commit dialog on a committed run', async () => {
    const user = userEvent.setup();
    stubCommon();
    server.use(
      http.get(RUN_URL, () =>
        HttpResponse.json(
          baseRun({ status: 'COMMITTED', committed_at: '2026-02-01T00:00:00.000Z' }),
        ),
      ),
    );
    renderRun();

    await screen.findByRole('heading', { level: 1, name: /→/ });
    await user.keyboard('{Control>}{Enter}{/Control}');
    await sleep(50);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('letters other than P/R/G typed on the closed decision change nothing', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    const trigger = await screen.findByRole('combobox', { name: 'Final decision' });
    trigger.focus();
    await user.keyboard('অউxa');
    await sleep(100);

    expect(record.patches).toHaveLength(0);
    expect(trigger.textContent).toContain('Promote');
  });

  it('Ctrl+R on the decision sets nothing', async () => {
    const user = userEvent.setup();
    stubCommon();
    const record = statefulRun();
    renderRun();

    const trigger = await screen.findByRole('combobox', { name: 'Final decision' });
    trigger.focus();
    await user.keyboard('{Control>}r{/Control}');
    await sleep(100);

    expect(record.patches).toHaveLength(0);
  });

  it('arrow keys move between rows on the decision trigger', async () => {
    const user = userEvent.setup();
    stubCommon();
    statefulRun(
      baseRun({
        entries: [
          entry(),
          entry({ student_id: 's2', id: 'e2', merit_rank: 2, student_name: 'Two' }),
        ],
      }),
    );
    renderRun();

    const triggers = await screen.findAllByRole('combobox', { name: 'Final decision' });
    triggers[0]?.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(triggers[1]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(triggers[0]);
  });

  it('picking an override from the open list moves focus to the reason box', async () => {
    const user = userEvent.setup();
    stubCommon();
    statefulRun();
    renderRun();

    await user.click(await screen.findByRole('combobox', { name: 'Final decision' }));
    await user.click(await screen.findByRole('option', { name: 'Retain' }));
    const note = await screen.findByRole('textbox', { name: 'Why changed' });
    await waitFor(() => expect(document.activeElement).toBe(note));
  });

  it('a delete that fails with 409 says so and reloads the run', async () => {
    const user = userEvent.setup();
    const toastError = vi.spyOn(toast, 'error');
    stubCommon();
    statefulRun();
    server.use(
      http.delete(RUN_URL, () =>
        HttpResponse.json(apiErrorBody(409, 'Conflict', RUN_URL), { status: 409 }),
      ),
    );
    renderRun();

    await screen.findByRole('combobox', { name: 'Final decision' });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete list' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "This list can't be deleted any more — someone may have finalised it. The page has been refreshed.",
      ),
    );
  });

  it('Ctrl+Enter while the delete confirm is open does not stack the commit dialog', async () => {
    const user = userEvent.setup();
    stubCommon();
    statefulRun();
    renderRun();

    await screen.findByRole('combobox', { name: 'Final decision' });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete list' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await sleep(50);
    expect(screen.queryByRole('button', { name: 'Finalise' })).toBeNull();
  });

  it('a finalised run shows each decision as plain text', async () => {
    stubCommon();
    server.use(
      http.get(RUN_URL, () =>
        HttpResponse.json(
          baseRun({ status: 'COMMITTED', committed_at: '2026-02-01T00:00:00.000Z' }),
        ),
      ),
    );
    renderRun();

    const row = (await screen.findByText('Rafi Ahmed')).closest('tr') as HTMLElement;
    expect(within(row).getAllByText('Promote').length).toBeGreaterThan(0);
    expect(within(row).queryByRole('combobox', { name: 'Final decision' })).toBeNull();
  });
});

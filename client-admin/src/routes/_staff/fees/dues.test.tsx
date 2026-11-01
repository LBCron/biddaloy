import { cleanupTestState, classFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

// The default test RegionConfig is Bangla; pin REGION_BD_EN for this page so assertions read
// in Latin digits.
vi.mock('@biddaloy/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/i18n')>();
  return { ...actual, useRegionConfig: () => actual.REGION_BD_EN };
});

function renderEn(options: Parameters<typeof renderWithRouter>[1]) {
  return renderWithRouter(routeTree, options);
}

/** [8.10.4]'s dues queue — real route tree, not a hand-built double, so
 * `ListShell`/`DataTable` and the Flagged toggle actually wire up. Same
 * reasoning `students/index.test.tsx` documents for itself. `handlers.ts`'s
 * shared `feeDefaultHandlers` already registers a zero-balance
 * `GET students/:id/wallet` default — [16.4.5]'s `WalletChip` mounts one
 * per visible row, so every pre-existing test here needs that default
 * (or its own override) to avoid tripping `onUnhandledRequest: 'error'`. */
describe('/fees/dues', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  // [44.4 / #3014] The (?) beside the header Record payment action (finance.dues.action.collect).
  it('shows the (?) for a declared id when a handbook URL is set', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    try {
      server.use(
        http.get('/api/v1/fees/dues', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
        ),
      );
      renderEn({
        initialEntries: ['/fees/dues'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });
      // By id: the page-level (?) carries the same "Help: <page title>" name.
      await waitFor(() =>
        expect(
          document.querySelector('[data-help-id="finance.dues.action.collect"]'),
        ).not.toBeNull(),
      );
      await expectHelp('finance.dues.field.flagged'); // [#3293]
    } finally {
      vi.unstubAllEnvs();
    }
  });

  function feeDue(overrides: Record<string, unknown> = {}) {
    return {
      student_fee_id: 'fee-1',
      fee_structure_id: 'structure-1',
      fee_name: 'Tuition',
      fee_type: 'MONTHLY_TUITION',
      month: 3,
      year: 2026,
      period_start: '2026-03-01T00:00:00.000Z',
      period_type: 'MONTH',
      occurrence: 1,
      is_late_fee: false,
      total_amount: 500,
      paid_amount: 0,
      discount_amount: 0,
      standing_discount_amount: 0,
      one_off_discount_amount: 0,
      balance: 500,
      status: 'PENDING',
      due_date: null,
      reminder_threshold_date: null,
      ...overrides,
    };
  }

  function duesRow(overrides: Record<string, unknown> = {}) {
    return {
      student_id: 'student-1',
      full_name: 'Karim Rahman',
      registration_number: 'REG-1',
      roll_number: 1,
      class_name: 'Class 5',
      section_name: 'A',
      total_due: 500,
      months_overdue: 0,
      dues: [feeDue()],
      ...overrides,
    };
  }

  it('renders the dues queue with derived status and amounts', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText(/Karim Rahman/);
    expect(screen.getByText('Pending')).toBeTruthy();
    // Caption under the name: registration number and roll.
    expect(screen.getByText('REG-1 · Roll 1')).toBeTruthy();
    // Section is merged into the class cell.
    expect(screen.getByText('Class 5 · A')).toBeTruthy();
  });

  it('requests 25 rows per page by default', async () => {
    let limit: string | null = null;
    server.use(
      http.get('/api/v1/fees/dues', ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({
          data: [duesRow()],
          total: 1,
          page: 1,
          limit: 25,
          totalPages: 1,
        });
      }),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText(/Karim Rahman/);
    expect(limit).toBe('25');
  });

  it('shows Overdue status when months_overdue is greater than zero', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({
          data: [duesRow({ months_overdue: 2 })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText(/Karim Rahman/);
    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('the Flagged toggle preserves class/section filters and calls the flagged endpoint', async () => {
    const klass = classFactory({ id: 'class-9', name: 'Class 9' });
    let flaggedRequested = false;
    let flaggedClassId: string | null = null;
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
      ),
      http.get('/api/v1/fees/dues/flagged', ({ request }) => {
        flaggedClassId = new URL(request.url).searchParams.get('class_id');
        flaggedRequested = true;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      }),
    );

    const { router } = renderEn({
      initialEntries: ['/fees/dues?class_id=class-9&month=3&search=Karim'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await within(await screen.findByRole('combobox', { name: 'Class' })).findByText('Class 9');

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Overdue only' }));

    await waitFor(() => expect(flaggedRequested).toBe(true));
    expect(flaggedClassId).toBe('class-9');
    expect(router.state.location.search).toMatchObject({ class_id: 'class-9', flagged: 'true' });
    // Flagged mode renders only class and section; month and the typed search are cleared.
    expect(router.state.location.search).not.toHaveProperty('month');
    expect(router.state.location.search).not.toHaveProperty('search');
    expect(screen.queryByRole('textbox', { name: 'Search' })).toBeNull();
    for (const name of ['Month', 'Year', 'Status', 'Fee type']) {
      expect(screen.queryByRole('combobox', { name })).toBeNull();
    }
    expect(screen.getByRole('combobox', { name: 'Class' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Section' })).toBeTruthy();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route for a TEACHER, who holds no `FEE_COLLECT` — this was
  // [8.14.17]'s own headline audit finding (a TEACHER's direct visit
  // used to render every student's payment balance with only the
  // `Collect` link hidden). `_staff.access.test.tsx` covers this same
  // case across roles; this one stays local to the route it belongs to.
  it('refuses the whole route for a TEACHER, who lacks FEE_COLLECT', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByText(/Karim Rahman/)).toBeNull();
  });

  it('Collect reaches Record Payment in one interaction', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    const collect = await screen.findByRole('link', { name: 'Collect fee' });
    expect(collect.getAttribute('href')).toBe('/payments/record?student_id=student-1');
    await user.click(collect);

    // [31.4]: `/payments/record` is the Record Payment full page again (no redirect),
    // keeping `student_id` so the form opens with that student pre-selected.
    await waitFor(() => expect(router.state.location.pathname).toBe('/payments/record'));
    expect(router.state.location.search).toEqual({ student_id: 'student-1' });
  });

  it('the header Record payment is the one primary action and opens the Record Payment page', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 25, totalPages: 1 }),
      ),
    );

    const { router } = renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Record payment' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/payments/record'));
    expect(router.state.location.search).toEqual({});
  });

  it('the row Remind action opens the send-reminder dialog without selecting rows', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 25, totalPages: 1 }),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remind' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
  });

  it('bulk-selecting a row reveals Send reminder and Export CSV', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));

    expect(await screen.findByRole('button', { name: 'Send reminder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeTruthy();
    // [16.5.1] Bulk "Generate invoice" was removed — invoices can only be
    // created from a real payment now, there's no more arbitrary
    // line-item invoice for outstanding dues.
    expect(screen.queryByRole('button', { name: 'Generate invoice' })).toBeNull();
  });

  it('exports the selected row to CSV with derived status and formula-leading values neutralized', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({
          data: [duesRow({ full_name: '=cmd|/c calc' })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    server.use(
      http.get('/api/v1/communications/last-reminders', () =>
        HttpResponse.json([{ student_id: 'student-1', sent_at: '2026-03-05T10:00:00.000Z' }]),
      ),
    );

    let capturedBlob: Blob | undefined;
    // jsdom doesn't implement `URL.createObjectURL`/`revokeObjectURL` at
    // all — same stub-and-restore pattern `students/index.test.tsx` uses.
    URL.createObjectURL = (blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    };
    URL.revokeObjectURL = () => {};
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      renderEn({
        initialEntries: ['/fees/dues'],
        tenantId: 'tenant-1',
        role: 'ACCOUNTANT',
        locale: 'en',
      });

      const user = userEvent.setup();
      await user.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));
      await user.click(screen.getByRole('button', { name: 'Export CSV' }));

      const csv = await capturedBlob!.text();
      expect(csv).toContain("'=cmd|/c calc");
      expect(csv).not.toContain('\n=cmd');
      // Last-reminder cell is an ISO date, not the display date.
      expect(csv).toContain('2026-03-05');
    } finally {
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      clickSpy.mockRestore();
    }
  });

  it('is axe clean', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const { container } = renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText(/Karim Rahman/);
    await expect(container).toHaveNoViolations();
  });

  // [8.14.10]: FilterBar migration — the rows-per-page control changes
  // `limit` and resets `page` in one URL update.
  it('changing rows per page writes limit and resets page', async () => {
    // The page-size select lives in the footer, which only shows while there are rows.
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 2, limit: 10, totalPages: 1 }),
      ),
    );

    const { router } = renderEn({
      initialEntries: ['/fees/dues?page=2'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Search' });
    await user.click(await screen.findByRole('combobox', { name: 'Rows per page' }));
    // Option labels render in the tenant's own region digits (Bengali
    // numerals here), independent of the `en` UI locale.
    await user.click(await screen.findByRole('option', { name: /^(50|৫০)$/ }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ limit: 50, page: 1 }));
  });

  // [8.14.10]: `section_id`'s FilterBar descriptor has no options until a
  // class is chosen (empty `options`, in place of the old `disabled`
  // prop `SelectFilterField` has no equivalent for) — a class must still
  // be pickable regardless.
  it('offers no section options until a class is chosen', async () => {
    const klass = classFactory({ id: 'class-9', name: 'Class 9' });
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Search' });
    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    // Only the built-in "All sections" option — no real section to pick.
    expect(screen.queryAllByRole('option')).toHaveLength(1);
  });

  // [8.14.10]: the dues queue is searchable by student name/registration
  // number — `useFeeDues`'s `search` param was already wired but never
  // surfaced as a FilterBar field until now.
  it('searching by student name/registration number writes search and calls the API', async () => {
    let lastSearch: string | null = null;
    server.use(
      http.get('/api/v1/fees/dues', ({ request }) => {
        lastSearch = new URL(request.url).searchParams.get('search');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      }),
    );

    const { router } = renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Search' });
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'Karim');

    await waitFor(() => expect(router.state.location.search).toMatchObject({ search: 'Karim' }));
    await waitFor(() => expect(lastSearch).toBe('Karim'));
  });

  // [16.4.5]'s Tests contract: "one row per student with two fees; expand
  // shows both."
  it('renders one row per student with two fees, and expanding shows both per-fee lines', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({
          data: [
            duesRow({
              total_due: 800,
              dues: [
                feeDue({ student_fee_id: 'fee-1', fee_name: 'Tuition', balance: 500 }),
                feeDue({
                  student_fee_id: 'fee-2',
                  fee_name: 'Exam fee',
                  balance: 300,
                  is_late_fee: true,
                  occurrence: 2,
                }),
              ],
            }),
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    // Still one row for the student, not one per fee.
    await screen.findByText(/Karim Rahman/);
    expect(screen.getAllByText(/Karim Rahman/)).toHaveLength(1);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /2 fees for Karim Rahman/ }));

    const list = await screen.findByRole('list', { name: /2 fees for Karim Rahman/ });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Tuition')).toBeTruthy();
    expect(within(items[0]!).getByText('৳500.00')).toBeTruthy();
    expect(within(items[0]!).getByText(/^March 2026 · due —$/)).toBeTruthy();
    expect(within(items[1]!).getByText('Exam fee (2)')).toBeTruthy();
    expect(within(items[1]!).getByText('Late fee')).toBeTruthy();
    // The per-line pay buttons are gone.
    expect(within(list).queryByRole('button')).toBeNull();
  });

  it('month filter options are month names, not 01–12', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Search' });
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    expect(await screen.findByRole('option', { name: 'October' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '10' })).toBeNull();
  });

  it('filters by fee type', async () => {
    let lastFeeType: string | null = null;
    server.use(
      http.get('/api/v1/fees/dues', ({ request }) => {
        lastFeeType = new URL(request.url).searchParams.get('fee_type');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      }),
    );

    const { router } = renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Search' });
    await user.click(screen.getByRole('combobox', { name: 'Fee type' }));
    await user.click(await screen.findByRole('option', { name: 'Exam fee' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ fee_type: 'EXAM_FEE' }),
    );
    await waitFor(() => expect(lastFeeType).toBe('EXAM_FEE'));
  });

  it('shows the credit balance as an amount', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.get('/api/v1/students/:id/wallet', () =>
        HttpResponse.json({ balance: 250, transactions: [] }),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByText(/Karim Rahman/);
    expect(await screen.findByText('৳250.00')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Credit balance' })).toBeTruthy();
  });

  it('shows the last reminder as a long date once the reminders arrive', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [duesRow()], total: 1, page: 1, limit: 25, totalPages: 1 }),
      ),
      http.get('/api/v1/communications/last-reminders', () =>
        HttpResponse.json([{ student_id: 'student-1', sent_at: '2026-03-05T10:00:00.000Z' }]),
      ),
    );

    renderEn({
      initialEntries: ['/fees/dues'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText('5th March, 2026')).toBeTruthy();
  });
});

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const Y1 = '7c1e0000-0000-4000-8000-0000000000a1';
const Y2 = '7c1e0000-0000-4000-8000-0000000000a2';
const SID = '7c1e0000-0000-4000-8000-0000000000b1';

const row = (type: string, status: string, count: number) => ({ type, status, count });
const REPORT = {
  by_type_status: [
    row('STAFF_LEAVE', 'APPROVED', 142),
    row('STAFF_LEAVE', 'PENDING', 2),
    row('TESTIMONIAL', 'UNDER_CONSIDERATION', 5),
    row('TESTIMONIAL', 'REJECTED', 19),
    row('TESTIMONIAL', 'WITHDRAWN', 7),
    row('TESTIMONIAL', 'CANCELLED', 9),
  ],
  by_month: [{ month: '2026-09', submitted: 42, approved: 34, rejected: 5 }],
  avg_decision_hours: 18.5,
  stale_pending: [
    {
      id: SID,
      serial: '2026/0031',
      type: 'TESTIMONIAL',
      applicant_name: 'Rashida Begum',
      current_step: 0,
      created_at: '2026-09-30T05:00:00.000Z',
    },
  ],
  on_leave_today: { staff: [], students: [] },
  staff_leave_days: [
    { staff_profile_id: 'sp1', name: 'Karim Ali', by_type: { SICK: 5, CASUAL: 2 }, by_month: {} },
  ],
};

function render(report: object = REPORT, { locale = 'bn', search = '', status = 200 } = {}) {
  const calls: URL[] = [];
  server.use(
    http.get('/api/v1/applications/reports', ({ request }) => {
      calls.push(new URL(request.url));
      return status === 200
        ? HttpResponse.json(report)
        : HttpResponse.json({ statusCode: status, message: 'x', code: 'X' }, { status });
    }),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [
          { id: Y1, name: '2026', is_current: true },
          { id: Y2, name: '2025', is_current: false },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
  const view = renderWithRouter(routeTree, {
    initialEntries: [`/applications/reports${search}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale,
  });
  return { calls, router: view.router };
}

describe('/applications/reports', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('sums the tiles and formats the average in bn', async () => {
    render();
    const tiles = await screen.findByLabelText('মোট হিসাব');
    await waitFor(() => expect(within(tiles).getByText('১৮৪')).toBeTruthy());
    expect(within(tiles).getByText('১৪২')).toBeTruthy();
    expect(within(tiles).getByText('১৯')).toBeTruthy();
    expect(within(tiles).getByText('১৮.৫ ঘণ্টা')).toBeTruthy();
  });

  // #3059: dates alone count every year, so the tile must not say "this academic year".
  it.each([
    ['', 'This academic year'],
    [`?academic_year_id=${Y2}&from=2026-01-01`, 'This academic year'],
    ['?from=2026-01-01&to=2026-03-31', 'In the dates you picked'],
  ])('the Submitted tile caption for search %j is "%s"', async (search, caption) => {
    render(REPORT, { locale: 'en', search });
    const tiles = await screen.findByLabelText('Totals');
    expect(await within(tiles).findByText(caption)).toBeTruthy();
    const other =
      caption === 'This academic year' ? 'In the dates you picked' : 'This academic year';
    expect(within(tiles).queryByText(other)).toBeNull();
  });

  it('shows a dash when there is no average', async () => {
    render({ ...REPORT, avg_decision_hours: null });
    const tiles = await screen.findByLabelText('মোট হিসাব');
    await waitFor(() => expect(within(tiles).getByText('১৮৪')).toBeTruthy());
    expect(within(tiles).getByText('—')).toBeTruthy();
  });

  it('keeps the serial in Latin digits and links the view action', async () => {
    render();
    expect(await screen.findByText('2026/0031')).toBeTruthy();
    const link = screen.getAllByRole('link', { name: 'দেখুন — 2026/0031' })[0]!;
    expect(link.getAttribute('href')).toBe(`/applications/${SID}`);
  });

  it('pivots statuses: withdrawn + cancelled are other, under consideration is pending', async () => {
    render();
    const table = await screen.findByRole('table', { name: 'ধরন ও অবস্থা' });
    // withdrawn 7 + cancelled 9 = 16 other; under consideration 5 counts as pending.
    const cells = (await within(table).findByText('১৬')).closest('tr')!.textContent;
    expect(cells).toContain('৫');
    expect(cells).toContain('১৯');
  });

  it('shows one-line empties for the on-leave lists', async () => {
    render();
    expect((await screen.findAllByText('আজ কেউ ছুটিতে নেই।')).length).toBe(2);
  });

  it('no applications: the empty state replaces only the application tables, not leave days', async () => {
    render(
      { ...REPORT, by_type_status: [], by_month: [], stale_pending: [], avg_decision_hours: null },
      { locale: 'en' },
    );
    expect(await screen.findByText('No applications in this period')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'By type and status' })).toBeNull();
    // staff_leave_days comes from leave_records, which holds pre-cut-over leave too.
    expect(screen.getAllByText('Karim Ali').length).toBeGreaterThan(0);
  });

  it('writes the chosen year to the URL and refetches with it', async () => {
    const { calls, router } = render(REPORT, { locale: 'en' });
    await screen.findByText('2026/0031');
    await userEvent.click(screen.getAllByRole('combobox', { name: 'Academic year' })[0]!);
    await userEvent.click(await screen.findByRole('option', { name: '2025' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ academic_year_id: Y2 }),
    );
    await waitFor(() => expect(calls.at(-1)?.searchParams.get('academic_year_id')).toBe(Y2));
  });

  it('names the year in the subtitle when no dates are set (#3034)', async () => {
    render(REPORT, { locale: 'en' });
    await screen.findByText('2026/0031');
    expect(screen.getByText(/^Academic year 2026 · all applications/)).toBeTruthy();
  });

  it('drops the year from the subtitle when only dates filter (#3034)', async () => {
    render(REPORT, { locale: 'en', search: '?from=2026-01-01&to=2026-03-31' });
    await screen.findByText('2026/0031');
    expect(screen.queryByText(/all applications/)).toBeNull();
  });

  it('labels the year picker "All years" when dates are set without a year (#3059)', async () => {
    render(REPORT, { locale: 'en', search: '?from=2026-01-01' });
    await screen.findByText('2026/0031');
    expect(screen.getAllByRole('combobox', { name: 'Academic year' })[0]!.textContent).toContain(
      'All years',
    );
  });

  it('the no-year option says "All years" when a year is picked and a date bound remains', async () => {
    render(REPORT, { locale: 'en', search: `?academic_year_id=${Y2}&from=2026-01-01` });
    await screen.findByText('2026/0031');
    await userEvent.click(screen.getAllByRole('combobox', { name: 'Academic year' })[0]!);
    expect(await screen.findByRole('option', { name: 'All years' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Current year/ })).toBeNull();
  });

  it('keeps "Current year" in the picker when no dates are set (#3059)', async () => {
    render(REPORT, { locale: 'en' });
    await screen.findByText('2026/0031');
    expect(screen.getAllByRole('combobox', { name: 'Academic year' })[0]!.textContent).toContain(
      'Current year',
    );
  });

  it.each([
    ['?from=2026-01-01', /^From /],
    ['?to=2026-03-31', /^Up to /],
  ])('shows a one-sided date subtitle for %s (#3059)', async (search, pattern) => {
    render(REPORT, { locale: 'en', search });
    await screen.findByText('2026/0031');
    expect(screen.getByText(pattern)).toBeTruthy();
  });

  it('shows ErrorState and retry refetches', async () => {
    const { calls } = render(REPORT, { status: 500 });
    // The reports query keeps its own retry (two backoffs, ~3 s) over the test client's retry: false.
    const retry = await screen.findByRole(
      'button',
      { name: 'আবার চেষ্টা করুন' },
      { timeout: 8000 },
    );
    expect(screen.getByText('প্রতিবেদন আনা যায়নি।')).toBeTruthy();
    const before = calls.length;
    await userEvent.click(retry);
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  });

  it('sets the document title and has a single h1', async () => {
    render();
    await screen.findByText('2026/0031');
    expect(document.title).toBe('প্রতিবেদন · আবেদনপত্র · SchoolManager');
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBe(1);
  });
});

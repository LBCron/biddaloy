import { apiClient } from '@biddaloy/ui/api';
import { i18n } from '@biddaloy/ui/i18n';
import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const YEAR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_YEAR_ID = '22222222-2222-4222-8222-222222222222';

interface Row {
  class_name: string;
  class_order: number;
  gender: string;
  religion: string;
  count: number | null;
  suppressed: boolean;
}

const row = (
  class_name: string,
  class_order: number,
  gender: string,
  count: number | null,
  religion = 'Islam',
): Row => ({ class_name, class_order, gender, religion, count, suppressed: count === null });

/** Class 6: 40 boys + 38 girls; Class 7: 35 boys + 41 girls. One religion, so no religion columns. */
function countResponse(overrides: Record<string, unknown> = {}) {
  return {
    academic_year_id: YEAR_ID,
    academic_year_name: '2026',
    rows: [
      row('Class 6', 6, 'MALE', 40),
      row('Class 6', 6, 'FEMALE', 38),
      row('Class 7', 7, 'MALE', 35),
      row('Class 7', 7, 'FEMALE', 41),
    ],
    totals: { students: 154 },
    staff: {
      rows: [
        { staff_type: 'NON_TEACHING', count: 6, suppressed: false },
        { staff_type: 'TEACHING', count: 18, suppressed: false },
      ],
      total: 24,
    },
    ...overrides,
  };
}

function serveCount(body: unknown = countResponse()) {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get('/api/v1/reports/student-count', ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json(body as Record<string, unknown>);
    }),
    http.get('/api/v1/schools/me/profile', () =>
      HttpResponse.json({ name: 'Green Valley School', name_bn: null, registration_id: '123456' }),
    ),
  );
  return seen;
}

function renderPage(entry = '/reports/student-count', role = 'ADMIN', locale: 'en' | 'bn' = 'en') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale,
  });
}

/** The class table (the phone cards repeat its numbers in a list). */
async function classTable() {
  return within(
    await screen.findByRole('region', { name: 'Students by class, gender and religion' }),
  );
}

/** Answers `.../export` with a file. MSW cannot answer a blob request in this jsdom, so
 * `apiClient.get` is stubbed for export URLs; every other request still goes to MSW. */
function stubExport() {
  const sent: { url: string; params: Record<string, string> }[] = [];
  const real = apiClient.get.bind(apiClient);
  vi.spyOn(apiClient, 'get').mockImplementation(((
    url: string,
    config?: { params?: Record<string, string> },
  ) => {
    if (!url.includes('/export')) return real(url, config);
    sent.push({ url, params: { ...config?.params } });
    return Promise.resolve({ status: 200, headers: {}, data: new Blob(['file']) });
  }) as typeof apiClient.get);
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return sent;
}

describe('/reports/student-count [8.15.54]', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    await cleanupTestState();
  });

  it('opens on the current year without a button press, and says what the page is for', async () => {
    const seen = serveCount();
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Student count (BANBEIS)' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Take the student numbers for the BANBEIS annual survey from here.'),
    ).toBeTruthy();
    expect(await screen.findByText('Academic year 2026')).toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.has('academic_year_id')).toBe(false);
  });

  it('shows class rows, gender columns, and a Total row and column', async () => {
    serveCount();
    renderPage();

    const table = await classTable();
    expect(table.getByRole('columnheader', { name: 'Boys' })).toBeTruthy();
    expect(table.getByRole('columnheader', { name: 'Girls' })).toBeTruthy();
    expect(table.getByRole('columnheader', { name: 'Total' })).toBeTruthy();
    const class6 = table.getByRole('row', { name: /Class 6/ });
    expect(
      within(class6)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['40', '38', '78']);
    const class7 = table.getByRole('row', { name: /Class 7/ });
    expect(
      within(class7)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['35', '41', '76']);
    // Column totals add up the visible cells; the grand total is the server's true total.
    const total = table.getByRole('row', { name: /^Total/ });
    expect(
      within(total)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['75', '79', '154']);
  });

  it('splits each gender by religion only when more than one religion is recorded', async () => {
    serveCount(
      countResponse({
        rows: [
          row('Class 6', 6, 'MALE', 30, 'Islam'),
          row('Class 6', 6, 'MALE', 10, 'Hinduism'),
          row('Class 6', 6, 'FEMALE', 38, 'Islam'),
        ],
        totals: { students: 78 },
      }),
    );
    renderPage();

    const table = await classTable();
    // One religion column per gender group.
    expect(table.getAllByRole('columnheader', { name: 'Hinduism' })).toHaveLength(2);
    expect(table.getAllByRole('columnheader', { name: 'Islam' })).toHaveLength(2);
    // A combination the server did not list is a true zero, not a gap.
    const class6 = table.getByRole('row', { name: /Class 6/ });
    expect(
      within(class6)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual([
      '30', // boys, Islam
      '10', // boys, Hinduism
      '40', // boys, all
      '38', // girls, Islam
      '0', // girls, Hinduism
      '38', // girls, all
      '78',
    ]);
  });

  it('shows "—" with the reason, never 0, for a hidden count (COMMITTEE), and keeps the true total', async () => {
    serveCount(
      countResponse({
        rows: [
          row('Class 6', 6, 'MALE', 40),
          row('Class 6', 6, 'FEMALE', null),
          row('Class 7', 7, 'MALE', 35),
          row('Class 7', 7, 'FEMALE', 41),
        ],
        staff: {
          rows: [
            { staff_type: 'TEACHING', count: 18, suppressed: false },
            { staff_type: 'NON_TEACHING', count: null, suppressed: true },
          ],
          total: 22,
        },
        totals: { students: 154 },
      }),
    );
    renderPage('/reports/student-count', 'COMMITTEE');

    const table = await classTable();
    const class6 = table.getByRole('row', { name: /Class 6/ });
    const cells = within(class6).getAllByRole('cell');
    expect(cells[0]?.textContent).toBe('40');
    // The hidden cell, and a class total that would need it.
    expect(cells[1]?.textContent).toBe('—');
    expect(cells[2]?.textContent).toBe('—');
    expect(within(cells[1]!).getByRole('img').getAttribute('aria-label')).toBe(
      'Hidden to protect privacy (fewer than 5)',
    );
    // Class 7 has nothing hidden, so its total is real.
    expect(
      within(table.getByRole('row', { name: /Class 7/ }))
        .getAllByRole('cell')
        .at(-1)?.textContent,
    ).toBe('76');
    // The girls' column total needs the hidden cell; the grand total is the server's.
    const total = within(table.getByRole('row', { name: /^Total/ })).getAllByRole('cell');
    expect(total.map((c) => c.textContent)).toEqual(['75', '—', '154']);
    expect(screen.getByText(/fewer than 5 students are counted there/)).toBeTruthy();
    // No "0" was invented for a hidden cell anywhere on the page.
    expect(screen.queryByText('0')).toBeNull();
    // The phone card says "—" too, never 0.
    expect(
      screen.getByText('Class 6', { selector: 'span.font-medium' }).closest('p')?.textContent,
    ).toBe('Class 6 — Boys 40 · Girls — · Total —');
    // A COMMITTEE caller cannot download, only read.
    expect(screen.queryByRole('button', { name: /Download to Excel/ })).toBeNull();
    // Staff too: the hidden type is a dash, the staff total stays true.
    const staff = within(screen.getByRole('table', { name: 'Teachers and staff by type' }));
    expect(staff.getByRole('row', { name: /Other staff/ }).textContent).toContain('—');
    expect(staff.getByRole('row', { name: /^Total/ }).textContent).toContain('22');
  });

  it('shows teachers and staff by type only (staff gender is not stored)', async () => {
    serveCount();
    renderPage();

    const staff = within(await screen.findByRole('table', { name: 'Teachers and staff by type' }));
    expect(staff.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Type',
      'People',
    ]);
    const rows = staff.getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual(['TypePeople', 'Teachers18', 'Other staff6', 'Total24']);
  });

  it('lays each class out as one card on a phone: "Class 6 — Boys 40 · Girls 38 · Total 78"', async () => {
    serveCount();
    renderPage();

    await classTable();
    const card = screen.getByText('Class 6', { selector: 'span.font-medium' }).closest('p');
    expect(card?.textContent).toBe('Class 6 — Boys 40 · Girls 38 · Total 78');
  });

  it('prints from the header, and the printed page names the school, its EIIN and the year', async () => {
    serveCount();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    const header = (await screen.findByText('Green Valley School')).closest('header');
    expect(header?.className).toContain('print:block');
    expect(await screen.findByText('Academic year 2026 · EIIN: 123456')).toBeTruthy();
    expect(header?.contains(screen.getByText('Academic year 2026 · EIIN: 123456'))).toBe(true);
  });

  it('downloads the class table to Excel for the year on screen, and the staff table separately', async () => {
    serveCount();
    const sent = stubExport();
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Download to Excel' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      url: '/reports/student-count/export',
      params: { academic_year_id: YEAR_ID, format: 'XLSX', table: 'students' },
    });
    await user.click(
      screen.getByRole('button', { name: 'Download the teachers and staff table to Excel' }),
    );
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.params.table).toBe('staff');
  });

  it('changes the year from the "Change" menu and asks for that year', async () => {
    const seen = serveCount();
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [
            academicYearFactory({ id: YEAR_ID, name: '2026', is_current: true }),
            academicYearFactory({ id: OTHER_YEAR_ID, name: '2025', is_current: false }),
          ],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );
    const { router } = renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Change the academic year' }));
    await user.click(await screen.findByRole('menuitemradio', { name: '2025' }));

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ academic_year_id: OTHER_YEAR_ID }),
    );
    await waitFor(() => expect(seen.at(-1)?.get('academic_year_id')).toBe(OTHER_YEAR_ID));
  });

  it('drops a malformed year id from the URL instead of sending it', async () => {
    const seen = serveCount();
    renderPage('/reports/student-count?academic_year_id=not-a-uuid');
    await screen.findByText('Academic year 2026');
    expect(seen[0]?.has('academic_year_id')).toBe(false);
  });

  it('says what to do when no academic year is chosen yet', async () => {
    serveCount(
      countResponse({
        academic_year_id: null,
        academic_year_name: null,
        rows: [],
        totals: { students: 0 },
      }),
    );
    renderPage();
    expect(await screen.findByText('No academic year chosen yet')).toBeTruthy();
    expect(screen.getByText(/Choose a year with “Change” above/)).toBeTruthy();
  });

  it('says what to change when the year has no students', async () => {
    serveCount(countResponse({ rows: [], totals: { students: 0 } }));
    renderPage();
    expect(await screen.findByText('No students counted for this year')).toBeTruthy();
  });

  it('shows an error with a retry when the count fails to load', async () => {
    server.use(
      http.get('/api/v1/reports/student-count', () => HttpResponse.json({}, { status: 500 })),
      http.get('/api/v1/schools/me/profile', () => HttpResponse.json({ name: 'Green Valley' })),
    );
    renderPage();
    expect(
      await screen.findByText('Could not load the student count.', {}, { timeout: 15000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows a failed download inline, next to the buttons', async () => {
    serveCount();
    const real = apiClient.get.bind(apiClient);
    vi.spyOn(apiClient, 'get').mockImplementation((url: string, config?: object) =>
      url.includes('/export') ? Promise.reject(new Error('boom')) : real(url, config),
    );
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Download to Excel' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The file could not be downloaded. Try again.',
    );
  });

  it('reads in Bangla with Bangla digits under bn', async () => {
    serveCount();
    renderPage('/reports/student-count', 'ADMIN', 'bn');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'ছাত্রসংখ্যা (BANBEIS)' }),
    ).toBeTruthy();
    expect(await screen.findByText('শিক্ষাবর্ষ ২০২৬')).toBeTruthy();
    const table = within(
      await screen.findByRole('region', { name: 'শ্রেণি, লিঙ্গ ও ধর্ম অনুযায়ী ছাত্রসংখ্যা' }),
    );
    expect(table.getByRole('columnheader', { name: 'ছাত্র' })).toBeTruthy();
    expect(table.getByRole('columnheader', { name: 'ছাত্রী' })).toBeTruthy();
    expect(table.getByRole('row', { name: /Class 6/ }).textContent).toContain('৭৮');
    expect(screen.getByRole('button', { name: 'Excel-এ নামান' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'প্রিন্ট' })).toBeTruthy();
    expect(
      screen.getByText('Class 6', { selector: 'span.font-medium' }).closest('p')?.textContent,
    ).toBe('Class 6 — ছাত্র ৪০ · ছাত্রী ৩৮ · মোট ৭৮');
  });

  it('is axe clean', async () => {
    serveCount();
    const { container } = renderPage();
    await classTable();
    await expect(container).toHaveNoViolations();
  });
});

/**
 * The 8.15 glossary (`docs/ux-research/8.15-reports-glossary.md`, D21): words a school user must
 * never read on a report screen. Checked over every string this ticket and 8.15.17 add, in both
 * languages: `reports.json` `studentCount.*` and `common.json` `export.*`.
 */
describe('glossary: no "never say" word in the strings added by 8.15.17 and 8.15.54', () => {
  // English words from the glossary's "Never say" column (and the one-click download's
  // "export (as a button label)"); Bangla words are the same ideas as spelt in Bangla script.
  const NEVER_SAY = [
    'dimension',
    'column picker',
    'group by',
    'aggregate',
    'measure',
    'predicate',
    'parameter',
    'crosstab',
    'pivot',
    'debit',
    'credit',
    'balance',
    'receivable',
    'ledger',
    'export',
    'schedule',
    'cron',
    'subscription',
    'snapshot',
    'template',
    'clone',
    'query',
    'timeout',
  ];
  const NEVER_SAY_BN = [
    'ডাইমেনশন',
    'অ্যাগ্রিগেট',
    'মেজার',
    'পিভট',
    'ক্রসট্যাব',
    'ডেবিট',
    'ক্রেডিট',
    'লেজার',
    'ব্যালেন্স',
    'এক্সপোর্ট',
    'স্ন্যাপশট',
    'টেমপ্লেট',
    'কোয়েরি',
  ];

  function strings(node: unknown, path = ''): [string, string][] {
    if (typeof node === 'string') return [[path, node]];
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([key, value]) =>
        strings(value, path ? `${path}.${key}` : key),
      );
    }
    return [];
  }

  async function added(lng: 'en' | 'bn') {
    await i18n.loadNamespaces(['common', 'reports']);
    const common = i18n.getResourceBundle(lng, 'common') as { export: unknown };
    const reports = i18n.getResourceBundle(lng, 'reports') as { studentCount: unknown };
    return [
      ...strings(common.export, 'common:export'),
      ...strings(reports.studentCount, 'reports:studentCount'),
    ];
  }

  it.each(['en', 'bn'] as const)('has none in %s', async (lng) => {
    const all = await added(lng);
    expect(all.length).toBeGreaterThan(40);
    const words = [...NEVER_SAY, ...NEVER_SAY_BN];
    const offenders = all.filter(([, text]) =>
      words.some((word) => new RegExp(`(^|[^\\p{L}])${word}`, 'iu').test(text)),
    );
    expect(offenders).toEqual([]);
  });

  it('never calls the one-click download "CSV" or "export"; CSV appears only as the other-software choice', async () => {
    for (const lng of ['en', 'bn'] as const) {
      const all = await added(lng);
      const withCsv = all.filter(([, text]) => /csv/i.test(text)).map(([path]) => path);
      expect(withCsv).toEqual(['common:export.csv']);
    }
  });

  it('keeps the glossary wording for the one-click download in both languages', async () => {
    expect(await added('en')).toContainEqual(['common:export.excel', 'Download to Excel']);
    expect(await added('bn')).toContainEqual(['common:export.excel', 'Excel-এ নামান']);
    expect(await added('bn')).toContainEqual([
      'reports:studentCount.actions.download',
      'Excel-এ নামান',
    ]);
  });
});

describe('/reports/student-count: a count opens the list of those people [8.15.42]', () => {
  const CLASS_6 = '55555555-5555-4555-8555-555555555555';

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  function serveClasses() {
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [classFactory({ id: CLASS_6, name: 'Class 6' })],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );
  }

  it('girls in class 6 are one click from the number, and Go back returns to the count', async () => {
    serveCount();
    serveClasses();
    const { router } = renderPage();
    const user = userEvent.setup();

    // The plain-words name says where it goes and what the number is.
    const link = await (
      await classTable()
    ).findByRole('link', { name: 'See the list: Class 6, Girls (38)' });
    await user.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
    expect(router.state.location.search).toMatchObject({
      class_id: CLASS_6,
      gender: 'FEMALE',
      // The count is of active students, so the list must be too.
      enrollment_status: 'ACTIVE',
      from: '/reports/student-count',
    });
    await user.click(await screen.findByRole('link', { name: 'Go back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/reports/student-count'));
  });

  it('makes no link for a hidden count, so the people it hides stay hidden', async () => {
    serveCount(
      countResponse({
        rows: [row('Class 6', 6, 'MALE', 40), row('Class 6', 6, 'FEMALE', null)],
      }),
    );
    serveClasses();
    renderPage();

    const table = await classTable();
    expect(
      await table.findByRole('link', { name: 'See the list: Class 6, Boys (40)' }),
    ).toBeTruthy();
    expect(table.queryByRole('link', { name: /Girls/ })).toBeNull();
  });

  it('makes no link for a year the student list cannot show', async () => {
    serveCount(countResponse({ academic_year_id: OTHER_YEAR_ID, academic_year_name: '2025' }));
    serveClasses();
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [
            academicYearFactory({ id: YEAR_ID, name: '2026', is_current: true }),
            academicYearFactory({ id: OTHER_YEAR_ID, name: '2025', is_current: false }),
          ],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );
    renderPage(`/reports/student-count?academic_year_id=${OTHER_YEAR_ID}`);

    const table = await classTable();
    expect((await table.findAllByText('38')).length).toBeGreaterThan(0);
    expect(table.queryAllByRole('link')).toHaveLength(0);
  });
});

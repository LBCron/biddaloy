/**
 * [8.15.17] "Download everything that matches" on the six lists: students, guardians, invoices,
 * dues, payments and the audit trail. Real route tree, so each page's own filters reach the export
 * request. One shared table keeps the six lists saying and doing the same thing; the few
 * list-specific rules (no permission, the overdue-only dues list) follow it.
 *
 * `apiClient.get` is stubbed for `.../export` URLs instead of using MSW: a `responseType: 'blob'`
 * request through MSW's XHR interceptor fails in this jsdom (its `Response` cannot take a jsdom
 * `Blob`). Everything else still goes to MSW, and the real `downloadListExport` runs.
 */
import { apiClient } from '@biddaloy/ui/api';
import {
  auditEntryFactory,
  cleanupTestState,
  guardianFactory,
  invoiceFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

/** Answers `.../export` with a file, or with the server's HTTP 413 `EXPORT_TOO_LARGE`. */
function stubExport(answer: 'file' | 'too-large' = 'file') {
  const sent: { url: string; params: Record<string, string> }[] = [];
  const real = apiClient.get.bind(apiClient);
  vi.spyOn(apiClient, 'get').mockImplementation(((
    url: string,
    config?: { params?: Record<string, string> },
  ) => {
    if (!url.includes('/export')) return real(url, config);
    sent.push({ url, params: { ...config?.params } });
    return Promise.resolve({
      status: answer === 'file' ? 200 : 413,
      headers: {},
      data: new Blob([
        answer === 'file'
          ? 'file'
          : JSON.stringify({ details: { code: 'EXPORT_TOO_LARGE', rows: 5000 } }),
      ]),
    });
  }) as typeof apiClient.get);
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return sent;
}

interface ListCase {
  name: string;
  role: string;
  /** The list route with filters (and a page number the export must drop). */
  entry: string;
  listUrl: string;
  row: unknown;
  exportUrl: string;
  /** What the export request must carry: the active filters plus the format. */
  params: Record<string, string>;
  /** What one row is called in the button ("42 items", "321 people"). */
  unit: 'people' | 'items';
  /** The sentence for more than 5,000 rows. */
  tooLarge: string;
  /** Whether the list has row selection, so the arrow menu also offers the ticked rows. */
  selectable: boolean;
}

const PEOPLE_BY_CLASS =
  'Cannot download more than 5,000 people at once yet. Narrow it by class or section.';
const PEOPLE_BY_FILTER = 'Cannot download more than 5,000 people at once yet. Narrow the filters.';
const ITEMS_BY_FILTER = 'Cannot download more than 5,000 items at once yet. Narrow the filters.';

const CASES: ListCase[] = [
  {
    name: 'students',
    role: 'ADMIN',
    entry: '/students?class_id=class-9&gender=FEMALE&search=Rahim&page=3&limit=50',
    listUrl: '/api/v1/students',
    row: studentFactory({ id: 'student-1' }),
    exportUrl: '/students/export',
    params: { class_id: 'class-9', gender: 'FEMALE', search: 'Rahim' },
    unit: 'people',
    tooLarge: PEOPLE_BY_CLASS,
    selectable: true,
  },
  {
    name: 'guardians',
    role: 'ADMIN',
    entry: '/guardians?relationship=Father&search=Karim&page=2',
    listUrl: '/api/v1/guardians',
    row: guardianFactory({ id: 'guardian-1' }),
    exportUrl: '/guardians/export',
    params: { relationship: 'Father', search: 'Karim' },
    unit: 'people',
    tooLarge: PEOPLE_BY_FILTER,
    selectable: false,
  },
  {
    name: 'invoices',
    role: 'ACCOUNTANT',
    entry: '/invoices?status=OVERDUE&from_date=2026-01-01&page=2',
    listUrl: '/api/v1/invoices',
    row: invoiceFactory({ id: 'invoice-1' }),
    exportUrl: '/invoices/export',
    params: { status: 'OVERDUE', from_date: '2026-01-01' },
    unit: 'items',
    tooLarge: ITEMS_BY_FILTER,
    selectable: false,
  },
  {
    name: 'dues',
    role: 'ACCOUNTANT',
    entry: '/fees/dues?class_id=class-7&status=PENDING&search=Karim&page=2',
    listUrl: '/api/v1/fees/dues',
    row: {
      student_id: 'student-1',
      full_name: 'Karim Rahman',
      registration_number: 'REG-1',
      roll_number: 1,
      class_name: 'Class 7',
      section_name: 'A',
      total_due: 500,
      months_overdue: 0,
      dues: [],
    },
    exportUrl: '/fees/dues/export',
    params: { class_id: 'class-7', status: 'PENDING', search: 'Karim' },
    unit: 'people',
    tooLarge: PEOPLE_BY_CLASS,
    selectable: true,
  },
  {
    name: 'payments',
    role: 'ACCOUNTANT',
    entry: '/payments?payment_method=BKASH&date_from=2026-03-01&include_reversed=true&page=2',
    listUrl: '/api/v1/payments',
    row: {
      id: 'p1',
      student: { full_name: 'Rahim Uddin', registration_number: 'REG-001' },
      total_amount: 1500,
      payment_method: 'BKASH',
      transaction_reference: null,
      payment_date: '2026-03-05T06:00:00.000Z',
      reversal_of_payment_id: null,
      reversed_by_payment_id: null,
    },
    exportUrl: '/payments/export',
    params: { payment_method: 'BKASH', date_from: '2026-03-01', include_reversed: 'true' },
    unit: 'items',
    tooLarge: ITEMS_BY_FILTER,
    selectable: false,
  },
  {
    name: 'audit logs',
    role: 'ADMIN',
    entry: '/audit-logs?action=UPDATE&entity_type=Student&from_date=2026-01-01&page=2',
    listUrl: '/api/v1/audit-logs',
    row: auditEntryFactory(),
    exportUrl: '/audit-logs/export',
    params: { action: 'UPDATE', entity_type: 'Student', from_date: '2026-01-01' },
    unit: 'items',
    tooLarge: ITEMS_BY_FILTER,
    selectable: false,
  },
];

function serveList(listUrl: string, row: unknown, total: number) {
  server.use(
    http.get(listUrl, () =>
      HttpResponse.json({
        data: [row],
        total,
        page: 1,
        limit: 25,
        totalPages: Math.ceil(total / 25),
      }),
    ),
  );
}

function open(entry: string, role: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  await cleanupTestState();
});

describe.each(CASES)('$name list: download everything that matches [8.15.17]', (c) => {
  it('one click downloads the filtered list as Excel, with exactly the active filters', async () => {
    serveList(c.listUrl, c.row, 321);
    const sent = stubExport();
    open(c.entry, c.role);
    const user = userEvent.setup();
    // Some of these pages show the default Bangla digits under the English words.
    const button = await screen.findByRole(
      'button',
      { name: new RegExp(`Download to Excel.*(321|৩২১).*${c.unit}`) },
      { timeout: 5000 },
    );
    await user.click(button);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ url: c.exportUrl, params: { ...c.params, format: 'XLSX' } });
  });

  it('offers the CSV for other software from the arrow', async () => {
    serveList(c.listUrl, c.row, 2);
    const sent = stubExport();
    open(c.entry, c.role);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'More ways to download' }));
    // The ticked-rows item shows only once rows are ticked (and only where rows can be ticked).
    expect(screen.queryByRole('menuitem', { name: /you ticked/ })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: /CSV/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.params.format).toBe('CSV');
  });

  it('says what to do next, inline, when more than 5,000 rows match', async () => {
    serveList(c.listUrl, c.row, 9000);
    stubExport('too-large');
    open(c.entry, c.role);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Download to Excel/ }));
    expect(toLatinDigits((await screen.findByRole('alert')).textContent ?? '')).toBe(c.tooLarge);
  });
});

describe('who can download everything [8.15.17]', () => {
  it('hides it from a role without REPORTS_EXPORT (a TEACHER on the students list)', async () => {
    serveList('/api/v1/students', studentFactory({ id: 'student-1' }), 3);
    open('/students', 'TEACHER');
    await screen.findByRole('link', { name: 'View' }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: /Download to Excel/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More ways to download' })).toBeNull();
  });

  it('offers no "everything" download on the overdue-only dues list, which the export route cannot filter', async () => {
    const dues = CASES.find((c) => c.name === 'dues')!;
    serveList(dues.listUrl, dues.row, 3);
    server.use(
      http.get('/api/v1/fees/dues/flagged', () =>
        HttpResponse.json({ data: [dues.row], total: 1, page: 1, limit: 25, totalPages: 1 }),
      ),
    );
    open('/fees/dues', 'ACCOUNTANT');
    expect(await screen.findByRole('button', { name: /Download to Excel/ })).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Overdue only' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Download to Excel/ })).toBeNull(),
    );
  });
});

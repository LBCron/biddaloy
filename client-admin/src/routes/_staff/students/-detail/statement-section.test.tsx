import {
  academicYearFactory,
  cleanupTestState,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bnFees from '../../../../../../ui/src/i18n/locales/bn/fees.json';
import enFees from '../../../../../../ui/src/i18n/locales/en/fees.json';

import { StatementSection } from './statement-section';

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

/** One bill of 1,200, a part payment of 500 and a discount of 100: 600 still owed. */
function statement(overrides: Record<string, unknown> = {}) {
  return {
    student_id: STUDENT_ID,
    student_name: 'Rahim Uddin',
    registration_number: 'REG-1',
    from: null,
    to: null,
    opening_balance: 0,
    closing_balance: 600,
    entries: [
      {
        date: '2026-03-01',
        kind: 'BILL',
        description: 'Tuition',
        debit: 1200,
        credit: 0,
        balance: 1200,
      },
      {
        date: '2026-03-10',
        kind: 'PAYMENT',
        description: 'Tuition',
        debit: 0,
        credit: 500,
        balance: 700,
      },
      {
        date: '2026-03-10',
        kind: 'DISCOUNT',
        description: 'Tuition',
        debit: 0,
        credit: 100,
        balance: 600,
      },
    ],
    wallet_balance: 0,
    wallet_moves: [],
    ...overrides,
  };
}

/** Serves the statement and records the query string of each request. */
function serve(body: Record<string, unknown>, years: Record<string, unknown>[] = []) {
  const queries: string[] = [];
  server.use(
    http.get('/api/v1/students/:id/statement', ({ request }) => {
      queries.push(new URL(request.url).search);
      return HttpResponse.json(body);
    }),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({ data: years, total: years.length, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/schools/:schoolId/settings', () => HttpResponse.json({})),
  );
  return queries;
}

function renderSection(locale: 'en' | 'bn' = 'en', role = 'ADMIN') {
  return renderWithProviders(<StatementSection studentId={STUDENT_ID} />, {
    locale,
    tenantId: 'tenant-1',
    role,
  });
}

/** Every string value under a JSON object, for the word scan. */
function valuesOf(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node && typeof node === 'object') return Object.values(node).flatMap(valuesOf);
  return [];
}

describe('students/-detail/statement-section', () => {
  afterEach(async () => {
    await cleanupTestState();
    document.documentElement.classList.remove('printing-statement');
    vi.restoreAllMocks();
  });

  it('shows what is still owed, the last payment date and the table with bold opening and closing rows', async () => {
    serve(statement());
    const { localeReady } = renderSection();
    await localeReady;

    expect(await screen.findByText(/Still owed now: .*৬০০/)).toBeTruthy();
    expect(screen.getByText(/Last paid on .*১০/)).toBeTruthy();

    const table = screen.getByRole('table');
    for (const name of ['Date', 'What', 'Charged', 'Paid', 'Still owed']) {
      expect(within(table).getByRole('columnheader', { name })).toBeTruthy();
    }
    // A discount and a payment both sit under "Paid"; the discount says what it is.
    expect(within(table).getByText('Discount')).toBeTruthy();
    // Opening and closing rows are bold.
    const opening = within(table)
      .getByRole('rowheader', { name: 'Still owed at the start' })
      .closest('tr');
    expect(opening?.classList.contains('font-semibold')).toBe(true);
    const closing = within(table)
      .getByRole('rowheader', { name: 'Still owed at the end' })
      .closest('tr');
    expect(closing?.classList.contains('font-semibold')).toBe(true);
    expect(closing?.textContent).toContain('৬০০');
  });

  it('says all paid when nothing is owed', async () => {
    serve(statement({ closing_balance: 0 }));
    const { localeReady } = renderSection();
    await localeReady;
    expect(await screen.findByText('All paid')).toBeTruthy();
    expect(screen.queryByText(/Still owed now/)).toBeNull();
  });

  it('writes the amounts in Bangla digits with the Bangla words', async () => {
    serve(statement({ closing_balance: 1200 }));
    const { localeReady } = renderSection('bn');
    await localeReady;

    expect(await screen.findByText(/এখন বাকি: .*১,২০০/)).toBeTruthy();
    const table = screen.getByRole('table');
    for (const name of ['তারিখ', 'বিবরণ', 'বিল', 'জমা', 'বাকি']) {
      expect(within(table).getByRole('columnheader', { name })).toBeTruthy();
    }
  });

  it('starts at the beginning of the current academic year and leaves the end open', async () => {
    const queries = serve(statement(), [
      academicYearFactory({
        id: 'y1',
        name: '2025',
        start_date: '2025-01-01T00:00:00.000Z',
        is_current: false,
      }),
      academicYearFactory({
        id: 'y2',
        name: '2026',
        start_date: '2026-01-01T00:00:00.000Z',
        is_current: true,
      }),
    ]);
    const { localeReady } = renderSection();
    await localeReady;
    await screen.findByRole('table');
    expect(queries).toEqual(['?from=2026-01-01']);
  });

  it('lists the wallet apart and says it is not part of what is owed', async () => {
    serve(
      statement({
        wallet_balance: 300,
        wallet_moves: [{ date: '2026-03-02', kind: 'CREDIT_OVERPAYMENT', amount: 300, note: null }],
      }),
    );
    const { localeReady } = renderSection();
    await localeReady;
    expect(await screen.findByText(/not part of what is still owed/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Advance money' })).toBeTruthy();
    // The wallet is not in the running table.
    expect(within(screen.getByRole('table')).queryByText(/Advance money/)).toBeNull();
  });

  it('has a Print button that prints only this section, then lets the page back', async () => {
    serve(statement());
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { localeReady, user } = renderSection();
    await localeReady;
    const button = await screen.findByRole('button', { name: 'Print' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    await user.click(button);
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('printing-statement')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement.classList.contains('printing-statement')).toBe(false);
  });

  it('says plainly what to change when the dates hold nothing', async () => {
    serve(statement({ entries: [], closing_balance: 0 }));
    const { localeReady } = renderSection();
    await localeReady;
    expect(await screen.findByText('No bills or payments in these dates')).toBeTruthy();
    expect(screen.getByText('Try another From or To date.')).toBeTruthy();
  });

  it('never shows debit, credit or ledger, in either language', async () => {
    const banned = /debit|credit|ledger|ডেবিট|ক্রেডিট|লেজার|খতিয়ান/i;
    // The words we ship.
    for (const json of [enFees.statement, bnFees.statement]) {
      for (const value of valuesOf(json)) expect(value).not.toMatch(banned);
    }
    // What is on the screen, with a wallet move so every branch renders.
    for (const locale of ['en', 'bn'] as const) {
      serve(
        statement({
          wallet_balance: 300,
          wallet_moves: [
            { date: '2026-03-02', kind: 'CREDIT_OVERPAYMENT', amount: 300, note: null },
          ],
        }),
      );
      const { localeReady, container, unmount } = renderSection(locale);
      await localeReady;
      await screen.findByRole('table');
      expect(container.textContent ?? '').not.toMatch(banned);
      unmount();
    }
  });
});

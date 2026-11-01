/**
 * `/payments` — the payment list ([31.4]) over the real route tree, per
 * `bulk-reminder-wizard.test.tsx`'s own convention. Record payment is its
 * own page now: the header button and the old `?record=1` link both land
 * on `/payments/record`.
 */
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp } from '../../../help/test-utils';
import { routeTree } from '../../../routeTree.gen';

function render(initialEntries: string[]) {
  return renderWithRouter(routeTree, {
    initialEntries,
    tenantId: 'tenant-1',
    role: 'ACCOUNTANT',
    locale: 'en',
  });
}

const row = (over: Record<string, unknown>) => ({
  id: 'p1',
  student: { full_name: 'Rahim Uddin', registration_number: 'REG-001' },
  total_amount: 1500,
  payment_method: 'CASH',
  transaction_reference: null,
  payment_date: '2026-03-05T06:00:00.000Z',
  reversal_of_payment_id: null,
  reversed_by_payment_id: null,
  ...over,
});

function mockList(seen?: URLSearchParams[]) {
  server.use(
    http.get('/api/v1/payments', ({ request }) => {
      const params = new URL(request.url).searchParams;
      seen?.push(params);
      const reversed = params.get('include_reversed') === 'true';
      const data = [
        row({}),
        row({ id: 'p2', student: null, payment_method: 'BKASH', transaction_reference: 'TX-9' }),
        ...(reversed ? [row({ id: 'p3', reversed_by_payment_id: 'p4' })] : []),
      ];
      return HttpResponse.json({ data, total: data.length, page: 1, limit: 25 });
    }),
  );
}

describe('/payments', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestState();
  });

  it('lists payments with labelled method, deleted-student fallback and one primary action', async () => {
    mockList();
    const { localeReady } = render(['/payments']);
    await localeReady;

    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Deleted student')).toBeTruthy();
    expect(screen.getByText('Cash')).toBeTruthy();
    expect(screen.getByText('TX-9')).toBeTruthy();
    expect(screen.queryByText('CASH')).toBeNull();
    expect(screen.getByText('Showing 1–2 of 2')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Record payment' })).toHaveLength(1);
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  });

  it('shows a payment made between 00:00 and 06:00 Dhaka time on the same day as the detail page', async () => {
    // 20:00 UTC on the 4th is 02:00 on the 5th in Dhaka.
    const stamp = '2026-03-04T20:00:00.000Z';
    server.use(
      http.get('/api/v1/payments', () =>
        HttpResponse.json({ data: [row({ payment_date: stamp })], total: 1, page: 1, limit: 25 }),
      ),
    );
    const { localeReady } = render(['/payments']);
    await localeReady;

    expect(await screen.findByText(formatDate(parseServerDate(stamp), REGION_BD_EN))).toBeTruthy();
  });

  it('shows the Show reversed too (?) [#3293]', async () => {
    vi.stubEnv('VITE_HANDBOOK_URL', 'https://guide.test');
    mockList();
    const { localeReady } = render(['/payments']);
    await localeReady;
    await screen.findByText('Rahim Uddin');
    await expectHelp('finance.payments.field.includeReversed');
  });

  it('"Show reversed too" sends include_reversed=true and reveals the status column', async () => {
    const seen: URLSearchParams[] = [];
    mockList(seen);
    const user = userEvent.setup();
    const { localeReady } = render(['/payments']);
    await localeReady;
    await screen.findByText('Rahim Uddin');

    await user.click(await screen.findByRole('checkbox', { name: 'Show reversed too' }));

    await waitFor(() => expect(seen.some((p) => p.get('include_reversed') === 'true')).toBe(true));
    const header = await screen.findByRole('columnheader', { name: 'Status' });
    expect(within(header.closest('table')!).getByText('Reversed')).toBeTruthy();
  });

  it('redirects the old ?record=1 link to /payments/record, keeping student_id', async () => {
    server.use(
      http.get('/api/v1/payments/cart', () =>
        HttpResponse.json({
          students: [],
          total_balance: 0,
          suggested: { allocations: [], wallet_used: 0, remaining: 0, to_wallet: 0 },
        }),
      ),
    );

    const { localeReady, router } = render(['/payments?record=1&student_id=student-1']);
    await localeReady;

    await waitFor(() => expect(router.state.location.pathname).toBe('/payments/record'));
    expect(router.state.location.search).toEqual({ student_id: 'student-1' });
  });

  it('the header button navigates to /payments/record', async () => {
    const user = userEvent.setup();
    mockList();
    const { localeReady, router } = render(['/payments']);
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Record payment' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/payments/record'));
  });
});

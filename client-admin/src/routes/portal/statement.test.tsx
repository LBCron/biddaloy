import {
  cleanupTestState,
  classFactory,
  classSectionFactory,
  renderWithProviders,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bnFees from '../../../../ui/src/i18n/locales/bn/fees.json';
import bnNav from '../../../../ui/src/i18n/locales/bn/nav.json';
import enFees from '../../../../ui/src/i18n/locales/en/fees.json';
import enNav from '../../../../ui/src/i18n/locales/en/nav.json';
import { routeTree } from '../../routeTree.gen';
import { StatementSection } from '../_staff/students/-detail/statement-section';

const FATIMA = '11111111-1111-4111-8111-111111111111';
const KARIM = '22222222-2222-4222-8222-222222222222';

function child(name: string, id: string, roll: number) {
  return studentFactory({
    id,
    full_name: name,
    roll_number: roll,
    class_section: classSectionFactory({
      section_name: 'A',
      class: classFactory({ name: 'Class 6' }),
    }),
  });
}

/** One bill of 1,200 and a part payment of 500: 700 still owed. */
function statement(overrides: Record<string, unknown> = {}) {
  return {
    student_id: FATIMA,
    student_name: 'Fatima',
    registration_number: 'REG-1',
    from: null,
    to: null,
    opening_balance: 0,
    closing_balance: 700,
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
    ],
    wallet_balance: 0,
    wallet_moves: [],
    ...overrides,
  };
}

/** Serves the children and each child's portal statement; records every request URL. */
function serve(options: {
  students?: ReturnType<typeof child>[];
  byStudent?: Record<string, Record<string, unknown>>;
}) {
  const students = options.students ?? [child('Fatima', FATIMA, 12)];
  const requests: string[] = [];
  server.use(
    http.get('/api/v1/students/mine', () => HttpResponse.json(students)),
    http.get('/api/v1/portal/students/:id/statement', ({ request, params }) => {
      requests.push(request.url.replace(/^.*\/api\/v1/, ''));
      const body = options.byStudent?.[params.id as string] ?? statement();
      return HttpResponse.json(body);
    }),
    http.get('/api/v1/schools/me/profile', () => HttpResponse.json({ name: 'Ananta School' })),
    http.get('/api/v1/schools/:schoolId/settings', () => HttpResponse.json({})),
  );
  return requests;
}

function renderPortal(path = '/portal/statement', locale: 'en' | 'bn' = 'en') {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: 'PARENT',
    locale,
  });
}

function valuesOf(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node && typeof node === 'object') return Object.values(node).flatMap(valuesOf);
  return [];
}

describe('/portal/statement', () => {
  afterEach(async () => {
    await cleanupTestState();
    document.documentElement.classList.remove('printing-statement');
    vi.restoreAllMocks();
  });

  it('shows what is still owed in large type, then one card per line', async () => {
    const requests = serve({});
    const { localeReady } = renderPortal();
    await localeReady;

    expect(await screen.findByText(/Still owed now: .*700/)).toBeTruthy();
    expect(screen.getByText(/Last paid on .*10/)).toBeTruthy();
    // One page title, and it is the nav word.
    expect(
      within(screen.getByRole('main'))
        .getAllByRole('heading', { level: 1 })
        .filter((h) => h.textContent === 'Statement'),
    ).toHaveLength(1);

    const lines = within(screen.getByRole('region', { name: 'Bills and payments' })).getAllByRole(
      'listitem',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]?.textContent).toContain('Charged');
    expect(lines[1]?.textContent).toContain('Paid');
    expect(lines[1]?.textContent).toContain('Still owed after');
    expect(screen.getByText('Still owed at the start')).toBeTruthy();
    expect(screen.getByText('Still owed at the end')).toBeTruthy();

    // A guardian cannot read the academic years, so no start date is sent: everything is asked for.
    expect(requests).toEqual([`/portal/students/${FATIMA}/statement`]);
    expect(screen.getByText(/Showing everything since the start/)).toBeTruthy();
  });

  it('writes the amounts in Bangla digits with the Bangla words', async () => {
    serve({ byStudent: { [FATIMA]: statement({ closing_balance: 1200 }) } });
    const { localeReady } = renderPortal('/portal/statement', 'bn');
    await localeReady;
    expect(await screen.findByText(/এখন বাকি: .*১,২০০/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'হিসাব' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ডাউনলোড / প্রিন্ট' })).toBeTruthy();
    expect(screen.getByText('শুরুতে বাকি')).toBeTruthy();
    expect(screen.getByText('শেষে বাকি')).toBeTruthy();
  });

  it('says all paid, and offers no Pay now button (online payment is not live)', async () => {
    serve({ byStudent: { [FATIMA]: statement({ closing_balance: 0 }) } });
    const { localeReady } = renderPortal();
    await localeReady;
    expect(await screen.findByText('All paid')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pay/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /pay now/i })).toBeNull();
  });

  it('switches between children, one statement each', async () => {
    const requests = serve({
      students: [child('Fatima', FATIMA, 12), child('Karim', KARIM, 7)],
      byStudent: {
        [KARIM]: statement({ student_id: KARIM, student_name: 'Karim', closing_balance: 0 }),
      },
    });
    const { localeReady } = renderPortal();
    const user = userEvent.setup();
    await localeReady;
    expect(await screen.findByText(/Still owed now/)).toBeTruthy();

    await user.click(screen.getByRole('link', { name: /Karim/ }));
    expect(await screen.findByText('All paid')).toBeTruthy();
    expect(requests).toContain(`/portal/students/${KARIM}/statement`);
  });

  it('has one Download / Print button that prints only the statement', async () => {
    serve({});
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { localeReady } = renderPortal();
    const user = userEvent.setup();
    await localeReady;
    const buttons = await screen.findAllByRole('button', { name: 'Download / Print' });
    expect(buttons).toHaveLength(1);

    await user.click(buttons[0]!);
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('printing-statement')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement.classList.contains('printing-statement')).toBe(false);
  });

  it('lists the wallet apart and says it is not part of what is owed', async () => {
    serve({
      byStudent: {
        [FATIMA]: statement({
          wallet_balance: 300,
          wallet_moves: [
            { date: '2026-03-02', kind: 'CREDIT_OVERPAYMENT', amount: 300, note: null },
          ],
        }),
      },
    });
    const { localeReady } = renderPortal();
    await localeReady;
    expect(await screen.findByText(/not part of what is still owed/)).toBeTruthy();
  });

  it('shows one error frame with no heading, and a way to try again', async () => {
    serve({});
    server.use(
      http.get('/api/v1/portal/students/:id/statement', () =>
        HttpResponse.json({ message: 'internal detail' }, { status: 403 }),
      ),
    );
    const { localeReady } = renderPortal();
    await localeReady;
    expect(await screen.findByText('Could not load the statement. Try again.')).toBeTruthy();
    expect(screen.queryByText(/internal detail/)).toBeNull();
    expect(within(screen.getByRole('main')).queryAllByRole('heading', { level: 1 })).toHaveLength(
      0,
    );
  });

  it('shows the same closing balance as the staff Fees tab for the same statement', async () => {
    // The portal page and the staff section read one statement with one rule.
    const body = statement({ closing_balance: 1234.5 });
    serve({ byStudent: { [FATIMA]: body } });
    server.use(
      http.get('/api/v1/students/:id/statement', () => HttpResponse.json(body)),
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );
    const portal = renderPortal();
    await portal.localeReady;
    const portalLine = (await screen.findByText(/Still owed now/)).textContent;
    portal.unmount();

    const staff = renderWithProviders(<StatementSection studentId={FATIMA} />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });
    await staff.localeReady;
    const staffLine = (await screen.findByText(/Still owed now/)).textContent;
    // The two test harnesses pick different digit systems; the number itself must be the same.
    const latin = (text: string | null) =>
      (text ?? '').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
    expect(latin(portalLine)).toContain('1,234.50');
    expect(latin(staffLine)).toBe(latin(portalLine));
  });

  it('never shows debit, credit or ledger, in either language', async () => {
    const banned = /debit|credit|ledger|ডেবিট|ক্রেডিট|লেজার|খতিয়ান/i;
    for (const json of [enFees.statement, bnFees.statement]) {
      for (const value of valuesOf(json)) expect(value).not.toMatch(banned);
    }
    expect(enNav.items.portalStatement).not.toMatch(banned);
    expect(bnNav.items.portalStatement).not.toMatch(banned);
    for (const locale of ['en', 'bn'] as const) {
      serve({
        byStudent: {
          [FATIMA]: statement({
            wallet_balance: 300,
            wallet_moves: [
              { date: '2026-03-02', kind: 'CREDIT_OVERPAYMENT', amount: 300, note: null },
            ],
          }),
        },
      });
      const view = renderPortal('/portal/statement', locale);
      await view.localeReady;
      const main = await screen.findByRole('main');
      await waitFor(() => expect(within(main).getAllByRole('listitem').length).toBeGreaterThan(0));
      expect(main.textContent ?? '').not.toMatch(banned);
      view.unmount();
    }
  });
});

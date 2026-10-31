import '@biddaloy/ui/test';

import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

import { sortByLeastHelpful } from './reports-usage';

/** The console has no school region, so numbers come in the default digits; compare them as Latin. */
const latin = (text: string | null | undefined) =>
  (text ?? '').replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));

const row = (over: Record<string, unknown>) => ({
  report_key: 'student-list',
  runs: 10,
  schools: 2,
  unique_users: 4,
  helpful_pct: 80,
  too_slow: 0,
  empty_results: 0,
  large_exports: 0,
  latest_comments: [],
  ...over,
});

const USAGE = {
  from: '2026-10-01',
  to: '2026-10-31',
  reports: [
    row({ report_key: 'student-list', runs: 50, helpful_pct: 90 }),
    row({
      report_key: 'public-exam-results',
      runs: 42,
      schools: 6,
      unique_users: 11,
      helpful_pct: 38,
      too_slow: 3,
      empty_results: 9,
      large_exports: 1,
      latest_comments: ['Needs the pass mark', '<img src=x onerror="alert(1)"> wrong year'],
    }),
    row({ report_key: 'custom', runs: 7, helpful_pct: null }),
    row({ report_key: 'staff-by-type-gender', runs: 3, helpful_pct: 61 }),
  ],
};

function serve(requests: string[] = []) {
  server.use(
    http.get('/api/v1/platform/reports/usage', ({ request }) => {
      requests.push(new URL(request.url).search);
      return HttpResponse.json(USAGE);
    }),
  );
}

const render = (role: string = UserRole.SUPER_ADMIN, locale: 'en' | 'bn' = 'en') =>
  renderWithRouter(routeTree, {
    initialEntries: ['/reports-usage'],
    tenantId: 'tenant-1',
    role,
    locale,
  });

afterEach(async () => {
  await cleanupTestState();
});

describe('sortByLeastHelpful', () => {
  it('puts the lowest helpful share first, no answers last, and the busier report first on a tie', () => {
    const sorted = sortByLeastHelpful([
      row({ report_key: 'a', helpful_pct: null, runs: 99 }),
      row({ report_key: 'b', helpful_pct: 50, runs: 1 }),
      row({ report_key: 'c', helpful_pct: 50, runs: 5 }),
      row({ report_key: 'd', helpful_pct: 10, runs: 2 }),
    ]);
    expect(sorted.map((r) => r.report_key)).toEqual(['d', 'c', 'b', 'a']);
  });
});

describe('/reports-usage [8.15.55]', () => {
  it('shows each report with its counts and the friction signals, least helpful first', async () => {
    const requests: string[] = [];
    serve(requests);
    render();
    const list = await screen.findByRole('list', {
      name: 'How often each report is opened, and where people struggle',
    });
    const names = within(list)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    // 38% < 61% < 90%, then the one nobody answered about.
    expect(names).toEqual([
      'Public exam results',
      'Teachers and staff by type',
      'Student list',
      'Reports schools made themselves',
    ]);
    const first = within(list.querySelector('li')!);
    expect(latin(first.getByText('Times opened').nextSibling?.textContent)).toBe('42');
    expect(latin(first.getByText('Found useful').nextSibling?.textContent)).toBe('38%');
    expect(latin(first.getByText('Too slow').nextSibling?.textContent)).toBe('3');
    expect(latin(first.getByText('Nothing to show').nextSibling?.textContent)).toBe('9');
    expect(latin(first.getByText('Large downloads').nextSibling?.textContent)).toBe('1');
    expect(within(list).getByText('No answers yet')).toBeTruthy();
    // The default period is 30 days: the request names its start only.
    expect(requests[0]).toMatch(/^\?from=\d{4}-\d{2}-\d{2}$/);
  });

  it('shows a comment as plain text, never as HTML', async () => {
    serve();
    const { container } = render();
    await screen.findByText('Needs the pass mark');
    // The tag is visible as typed text, and no element was made from it.
    expect(screen.getByText(/<img src=x onerror="alert\(1\)"> wrong year/)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('asks again for a longer period', async () => {
    const requests: string[] = [];
    serve(requests);
    render();
    await screen.findByText('Needs the pass mark');
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Period' }));
    await user.click(await screen.findByRole('option', { name: 'Last year' }));
    await waitFor(() => expect(requests.length).toBeGreaterThan(1));
    expect(requests[0]).not.toBe(requests[requests.length - 1]);
  });

  it('is in the platform menu for the platform admin', async () => {
    serve();
    render();
    await screen.findByRole('heading', { level: 1, name: 'How reports are used' });
    expect(screen.getAllByRole('link', { name: 'Report usage' }).length).toBeGreaterThan(0);
  });

  it('is hidden from every school role: they are sent to the dashboard and nothing is asked', async () => {
    const requests: string[] = [];
    serve(requests);
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json({ id: 'u1', preferences: null })),
    );
    const { router } = render(UserRole.ADMIN);
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(screen.queryByRole('heading', { name: 'How reports are used' })).toBeNull();
    expect(requests).toEqual([]);
  });

  it('says in place when the numbers could not be loaded, with a way to try again', async () => {
    server.use(
      http.get('/api/v1/platform/reports/usage', () =>
        HttpResponse.json({ message: 'boom' }, { status: 403 }),
      ),
    );
    render();
    expect(await screen.findByText('The usage numbers could not be loaded.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('has no jargon word on screen, in English or in Bangla', async () => {
    const banned = /schedul|snapshot|cron|widget|সময়সূচি|স্ন্যাপশট|উইজেট/i;
    serve();
    const en = render();
    await screen.findByText('Needs the pass mark');
    expect(screen.getByRole('main').textContent).not.toMatch(banned);
    en.unmount();
    await cleanupTestState();

    serve();
    const bn = render(UserRole.SUPER_ADMIN, 'bn');
    await bn.localeReady;
    await screen.findByText('Needs the pass mark');
    expect(screen.getByRole('main').textContent).toContain('রিপোর্ট কেমন কাজে লাগছে');
    expect(screen.getByRole('main').textContent).not.toMatch(banned);
  });
});

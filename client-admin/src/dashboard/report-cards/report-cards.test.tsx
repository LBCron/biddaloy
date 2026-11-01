import '@biddaloy/ui/test';

import type { ReportCatalogueEntry } from '@biddaloy/ui/hooks';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { academicYearFactory, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PinnedReportCards,
  pickUsefulReports,
  UsefulReportsCard,
  widgetToResult,
} from './report-cards';

const entry = (key: string, over: Partial<ReportCatalogueEntry> = {}): ReportCatalogueEntry => ({
  id: `id-${key}`,
  key,
  name_en: `Name of ${key}`,
  name_bn: `নাম ${key}`,
  version_id: 'v1',
  system_template_key: key,
  ...over,
});

const BANBEIS = entry('student-count-banbeis', { name_en: 'Students by class (BANBEIS)' });
const LIST = entry('student-list', { name_en: 'Student list' });
const STAFF = entry('staff-by-type-gender', { name_en: 'Teachers and staff by type' });
const EXAMS = entry('public-exam-results', { name_en: 'Public exam results' });
const OWED = entry('defaulters-guardian-contact', { name_en: 'Still owed' });
const ALL = [LIST, BANBEIS, STAFF, EXAMS, OWED];
const YEAR_START = '2026-01-01T00:00:00.000Z';

describe('pickUsefulReports [8.15.47, D24]', () => {
  it('suggests at most three, with the BANBEIS count first when it was never opened', () => {
    const picks = pickUsefulReports(ALL, {}, YEAR_START);
    expect(picks.map((p) => p.entry.key)).toEqual([
      'student-count-banbeis',
      'student-list',
      'staff-by-type-gender',
    ]);
    expect(picks[0]!.notThisYear).toBe(false);
  });

  it('puts BANBEIS first when it was opened only in an earlier academic year, and says so', () => {
    const picks = pickUsefulReports(
      ALL,
      { [BANBEIS.id]: '2025-03-01T00:00:00.000Z', [LIST.id]: '2026-02-01T00:00:00.000Z' },
      YEAR_START,
    );
    expect(picks.map((p) => p.entry.key)).toEqual([
      'student-count-banbeis',
      'staff-by-type-gender',
      'public-exam-results',
    ]);
    expect(picks[0]!.notThisYear).toBe(true);
  });

  it('leaves out every report already opened, and BANBEIS once it was opened this year', () => {
    const opened = Object.fromEntries(ALL.map((r) => [r.id, '2026-05-01T00:00:00.000Z'] as const));
    expect(pickUsefulReports(ALL, opened, YEAR_START)).toEqual([]);
  });

  it('never suggests a copy a school made from a ready report, or a report of its own', () => {
    const copy = entry('student-list-copy', { system_template_key: 'student-list' });
    const own = entry('my-report', { system_template_key: null });
    expect(pickUsefulReports([copy, own], {}, YEAR_START)).toEqual([]);
  });

  it('does not treat an open as old before the academic year is known', () => {
    expect(
      pickUsefulReports([BANBEIS], { [BANBEIS.id]: '2020-01-01T00:00:00.000Z' }, undefined),
    ).toEqual([]);
  });
});

function tree(Card: () => React.ReactNode) {
  const root = createRootRoute();
  return root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: '/',
      component: Card as () => React.ReactNode,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/reports/$reportId',
      component: () => <p data-testid="runner" />,
    }),
  ]);
}

function serveCatalogue(reports: ReportCatalogueEntry[]) {
  server.use(
    http.get('/api/v1/reports/catalogue', () => HttpResponse.json([{ folder: null, reports }])),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [academicYearFactory({ is_current: true, start_date: YEAR_START })],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

const SCOPE = 'tenant-1.-';
const render = (Card: () => React.ReactNode, role = 'ADMIN') =>
  renderWithRouter(tree(Card), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await cleanupTestState();
});

describe('UsefulReportsCard', () => {
  it('lists up to three reports with one line each and one link each, BANBEIS first', async () => {
    serveCatalogue(ALL);
    render(UsefulReportsCard);
    const card = await screen.findByRole('region', { name: 'Reports you may need' });
    const links = within(card).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/reports/id-student-count-banbeis',
      '/reports/id-student-list',
      '/reports/id-staff-by-type-gender',
    ]);
    expect(
      within(card).getByText(
        'How many students there are in each class, boys and girls, by religion.',
      ),
    ).toBeTruthy();
  });

  it('is shown to the accountant and the executive, and to nobody else', async () => {
    serveCatalogue(ALL);
    for (const role of ['ACCOUNTANT', 'EXECUTIVE']) {
      const view = render(UsefulReportsCard, role);
      expect(await screen.findByRole('region', { name: 'Reports you may need' })).toBeTruthy();
      view.unmount();
      await cleanupTestState();
    }
    render(UsefulReportsCard, 'TEACHER');
    // Give a wrong card time to appear.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.queryByRole('region', { name: 'Reports you may need' })).toBeNull();
  });

  it('can be hidden, and stays hidden the next time', async () => {
    serveCatalogue(ALL);
    const first = render(UsefulReportsCard);
    const card = await screen.findByRole('region', { name: 'Reports you may need' });
    await (
      await import('@testing-library/user-event')
    ).default
      .setup()
      .click(within(card).getByRole('button', { name: 'Hide this card' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Reports you may need' })).toBeNull(),
    );
    expect(localStorage.getItem(`reports.usefulCard.${SCOPE}`)).toBe('1');

    first.unmount();
    render(UsefulReportsCard);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.queryByRole('region', { name: 'Reports you may need' })).toBeNull();
  });

  it('disappears on its own once every ready report was opened this year', async () => {
    serveCatalogue(ALL);
    localStorage.setItem(
      `reports.opened.${SCOPE}`,
      JSON.stringify(Object.fromEntries(ALL.map((r) => [r.id, '2026-05-01T00:00:00.000Z']))),
    );
    render(UsefulReportsCard);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.queryByRole('region', { name: 'Reports you may need' })).toBeNull();
  });

  it('still works when the browser store is blocked', async () => {
    serveCatalogue(ALL);
    // Only the report keys are refused, so the rest of the app (language, sign-in) still works.
    const realGet = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem')!.value as (
      this: Storage,
      key: string,
    ) => string | null;
    const realSet = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')!.value as (
      this: Storage,
      key: string,
      value: string,
    ) => void;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (key.startsWith('reports.')) throw new Error('blocked');
      return realGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.startsWith('reports.')) throw new Error('blocked');
      realSet.call(this, key, value);
    });
    render(UsefulReportsCard);
    const card = await screen.findByRole('region', { name: 'Reports you may need' });
    await (
      await import('@testing-library/user-event')
    ).default
      .setup()
      .click(within(card).getByRole('button', { name: 'Hide this card' }));
    // Not remembered, but hidden for this visit and never an error.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Reports you may need' })).toBeNull(),
    );
  });
});

describe('PinnedReportCards', () => {
  const widget = {
    definition_id: 'id-student-list',
    name_en: 'Student list',
    name_bn: 'ছাত্রছাত্রীর তালিকা',
    columns: [
      { key: 'class', label_en: 'Class', label_bn: 'শ্রেণি', type: 'TEXT', kind: 'dimension' },
      { key: 'n', label_en: 'Students', label_bn: 'ছাত্রছাত্রী', type: 'NUMBER', kind: 'measure' },
    ],
    rows: [
      { class: 'Class 6', n: 78 },
      { class: 'Class 7', n: 71 },
    ],
    truncated: false,
    suppressed: false,
  };
  const pin = (...ids: string[]) =>
    localStorage.setItem(`reports.pins.${SCOPE}`, JSON.stringify(ids));

  it('shows a pinned report from its fixture: the name, the rows and a way to open or remove it', async () => {
    serveCatalogue([LIST]);
    server.use(
      http.get('/api/v1/dashboard/widgets/report/id-student-list', () => HttpResponse.json(widget)),
    );
    pin('id-student-list');
    render(PinnedReportCards);
    const card = await screen.findByRole('region', { name: 'Student list' });
    expect(await within(card).findByText('Class 6')).toBeTruthy();
    expect(within(card).getByText('Class 7')).toBeTruthy();
    expect(within(card).getAllByText(/^(78|71)$/)).toHaveLength(2);
    expect(within(card).getByRole('link', { name: 'Open the full report' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Remove from my dashboard' })).toBeTruthy();
  });

  it('removes the card in one click and forgets the pin', async () => {
    serveCatalogue([LIST]);
    server.use(
      http.get('/api/v1/dashboard/widgets/report/id-student-list', () => HttpResponse.json(widget)),
    );
    pin('id-student-list');
    render(PinnedReportCards);
    const card = await screen.findByRole('region', { name: 'Student list' });
    await (
      await import('@testing-library/user-event')
    ).default
      .setup()
      .click(within(card).getByRole('button', { name: 'Remove from my dashboard' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Student list' })).toBeNull());
    expect(JSON.parse(localStorage.getItem(`reports.pins.${SCOPE}`) ?? 'null')).toEqual([]);
  });

  it('says in place when one card fails, and skips a report the role can no longer open', async () => {
    serveCatalogue([LIST]);
    server.use(
      http.get('/api/v1/dashboard/widgets/report/id-student-list', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    pin('id-gone', 'id-student-list');
    render(PinnedReportCards);
    const card = await screen.findByRole('region', { name: 'Student list' });
    expect(await within(card).findByRole('alert')).toBeTruthy();
    expect(within(card).getByText('This report could not be shown.')).toBeTruthy();
    // The pinned id that is not in the catalogue made no card.
    expect(screen.getAllByRole('region')).toHaveLength(1);
  });

  it('renders nothing when nothing is pinned', async () => {
    serveCatalogue([LIST]);
    const { container } = render(PinnedReportCards);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(container.querySelector('section')).toBeNull();
  });
});

describe('widgetToResult', () => {
  it('gives the report renderers the shape they read', () => {
    const result = widgetToResult({
      definition_id: 'x',
      name_en: 'x',
      name_bn: 'x',
      columns: [],
      rows: [{ a: 1 }],
      truncated: true,
      suppressed: false,
    });
    expect(result).toMatchObject({ total_rows: 1, total_pages: 1, truncated: true, masked: [] });
    expect(REGION_BD_EN.numerals).toBe('latin');
  });
});

import '@biddaloy/ui/test';

import { apiClient } from '@biddaloy/ui/api';
import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bnPlatform from '../../../../../../ui/src/i18n/locales/bn/platform.json';
import bnReports from '../../../../../../ui/src/i18n/locales/bn/reports.json';
import enPlatform from '../../../../../../ui/src/i18n/locales/en/platform.json';
import enReports from '../../../../../../ui/src/i18n/locales/en/reports.json';
import { routeTree } from '../../../../routeTree.gen';

import { ScheduleDialog } from './schedule-dialog';
import { KeepCopyDialog, SnapshotsPanel } from './snapshots-panel';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  await cleanupTestState();
});

/** The runner puts the school's region around these; a test does the same, in the language shown. */
const inRegion = (node: React.ReactElement, locale: 'en' | 'bn' = 'en') => (
  <RegionConfigProvider value={locale === 'bn' ? REGION_BD_BN : REGION_BD_EN}>
    {node}
  </RegionConfigProvider>
);

/** Every string in a translation subtree. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('plain words [8.15.47, 8.15.55]', () => {
  // The glossary (D21): a person never reads these words. Only the new sections are scanned: the
  // rest of `reports.json` is another ticket's and not changed here.
  const banned = /schedul|snapshot|cron|widget|সময়সূচি|স্ন্যাপশট|উইজেট/i;
  const sections = ['delivery', 'copies', 'pinned', 'usefulCard', 'landing', 'listHint'] as const;

  it.each([
    ['en', enReports],
    ['bn', bnReports],
  ] as const)('the %s report sections have no jargon', (_locale, reports) => {
    for (const section of sections) {
      for (const text of strings(reports[section])) {
        expect(text, `${section}: ${text}`).not.toMatch(banned);
      }
    }
  });

  it.each([
    ['en', enPlatform],
    ['bn', bnPlatform],
  ] as const)('the %s platform usage page has no jargon', (_locale, platform) => {
    for (const text of strings(platform.reportsUsage)) {
      expect(text, text).not.toMatch(banned);
    }
  });

  it('has the same keys in both languages', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix];
    for (const section of sections) {
      expect(keys(bnReports[section]).sort()).toEqual(keys(enReports[section]).sort());
    }
    expect(keys(bnPlatform.reportsUsage).sort()).toEqual(keys(enPlatform.reportsUsage).sort());
  });
});

describe('ScheduleDialog: email this regularly', () => {
  function serveSchedules(existing: unknown[] = []) {
    const created: { body: Record<string, unknown>; key: string | null }[] = [];
    const removed: string[] = [];
    server.use(
      http.get(`/api/v1/reports/definitions/${REPORT_ID}/schedules`, () =>
        HttpResponse.json(existing),
      ),
      http.post(`/api/v1/reports/definitions/${REPORT_ID}/schedules`, async ({ request }) => {
        created.push({
          body: (await request.json()) as Record<string, unknown>,
          key: request.headers.get('Idempotency-Key'),
        });
        return HttpResponse.json({ id: 'sch-1' });
      }),
      http.delete(`/api/v1/reports/definitions/${REPORT_ID}/schedules/:id`, ({ params }) => {
        removed.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return { created, removed };
  }

  const open = (locale: 'en' | 'bn' = 'en', params: Record<string, unknown> = {}) =>
    renderWithProviders(
      inRegion(
        <ScheduleDialog open onOpenChange={() => {}} definitionId={REPORT_ID} params={params} />,
        locale,
      ),
      { tenantId: 'tenant-1', role: 'ACCOUNTANT', locale },
    );

  it("reads as one sentence with the defaults: monthly, the 1st, 9 am, the person's own role", async () => {
    const { created } = serveSchedules();
    const { user } = open('en', { class: ['Class 6'] });
    const dialog = await screen.findByRole('dialog', { name: 'Email this report regularly' });
    const piece = (name: string) => within(dialog).getByRole('combobox', { name });

    expect(piece('How often').textContent).toContain('month');
    expect(piece('Day of the month').textContent).toContain('1');
    expect(piece('Time').textContent).toContain('9:00 am');
    expect(piece('Send to').textContent).toContain('Accountant');
    // The words around the controls make the sentence.
    expect(dialog.textContent).toMatch(/Every .* on day .* at .*, send to/);

    await user.click(within(dialog).getByRole('button', { name: 'Start emailing' }));
    await waitFor(() => expect(created).toHaveLength(1));
    // Plain fields only: the server builds the cron. The answers of the open report go along.
    expect(created[0]!.body).toEqual({
      frequency: 'MONTHLY',
      day_of_month: 1,
      local_time: '09:00',
      params: { class: ['Class 6'] },
      recipient_roles: ['ACCOUNTANT'],
      format: 'XLSX',
    });
    expect(Object.keys(created[0]!.body).join(' ')).not.toMatch(/cron/i);
    expect(created[0]!.key).toBeTruthy();
  });

  it('changes the sentence when it becomes weekly, and sends the weekday instead of the date', async () => {
    const { created } = serveSchedules();
    const { user } = open();
    const dialog = await screen.findByRole('dialog', { name: 'Email this report regularly' });

    await user.click(within(dialog).getByRole('combobox', { name: 'How often' }));
    await user.click(await screen.findByRole('option', { name: 'week' }));
    expect(within(dialog).queryByRole('combobox', { name: 'Day of the month' })).toBeNull();
    await user.click(within(dialog).getByRole('combobox', { name: 'Day of the week' }));
    await user.click(await screen.findByRole('option', { name: 'Friday' }));
    await user.click(within(dialog).getByRole('button', { name: 'Start emailing' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]!.body).toMatchObject({ frequency: 'WEEKLY', day_of_week: 5 });
    expect(created[0]!.body).not.toHaveProperty('day_of_month');
  });

  it('puts the Bangla words in the Bangla order, with Bangla digits', async () => {
    serveSchedules();
    const view = open('bn');
    await view.localeReady;
    const dialog = await screen.findByRole('dialog', { name: 'নিয়মিত ইমেইলে পাঠান' });
    // প্রতি [মাসের] [১] তারিখ [সকাল ৯টায়] [হিসাবরক্ষক]-কে পাঠান
    expect(dialog.textContent).toMatch(/প্রতি.*মাসের.*১.*তারিখ.*সকাল ৯টায়.*হিসাবরক্ষক.*-কে পাঠান/);
  });

  it('says in place when it could not be set up, and does not close', async () => {
    server.use(
      http.get(`/api/v1/reports/definitions/${REPORT_ID}/schedules`, () => HttpResponse.json([])),
      http.post(`/api/v1/reports/definitions/${REPORT_ID}/schedules`, () =>
        HttpResponse.json({ message: 'no' }, { status: 409 }),
      ),
    );
    const { user } = open();
    const dialog = await screen.findByRole('dialog', { name: 'Email this report regularly' });
    await user.click(within(dialog).getByRole('button', { name: 'Start emailing' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'This could not be set up. Try again.',
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('lists the regular emails already set up, and stops one', async () => {
    const { removed } = serveSchedules([
      {
        id: 'sch-9',
        definition_id: REPORT_ID,
        frequency: 'WEEKLY',
        day_of_week: 0,
        day_of_month: null,
        local_time: '08:00',
        params: {},
        recipient_roles: ['ACCOUNTANT'],
        format: 'XLSX',
        active: true,
        last_run_id: null,
        created_at: '2026-10-01T00:00:00.000Z',
      },
    ]);
    const { user } = open();
    const dialog = await screen.findByRole('dialog', { name: 'Email this report regularly' });
    const stop = await within(dialog).findByRole('button', {
      name: 'Stop: Every week on Sunday at 8:00 am, send to Accountant',
    });
    await user.click(stop);
    await waitFor(() => expect(removed).toEqual(['sch-9']));
  });
});

describe("KeepCopyDialog: keep today's copy", () => {
  function serveKeep() {
    const kept: { body: Record<string, unknown>; key: string | null; runId: string }[] = [];
    server.use(
      http.post('/api/v1/reports/runs/:id/snapshot', async ({ request, params }) => {
        kept.push({
          body: (await request.json()) as Record<string, unknown>,
          key: request.headers.get('Idempotency-Key'),
          runId: String(params.id),
        });
        return HttpResponse.json({ id: 'snap-1' });
      }),
    );
    return kept;
  }

  const open = () =>
    renderWithProviders(inRegion(<KeepCopyDialog open onOpenChange={() => {}} runId={RUN_ID} />), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

  it('asks one question, starts the date at today, and keeps the copy of this run', async () => {
    const kept = serveKeep();
    const { user } = open();
    const dialog = await screen.findByRole('dialog', { name: "Keep today's copy" });
    const date = within(dialog).getByLabelText<HTMLInputElement>('Numbers as of');
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await user.type(within(dialog).getByLabelText('What is it for?'), 'BANBEIS 2026 submission');
    await user.click(within(dialog).getByRole('button', { name: 'Keep copy' }));

    await waitFor(() => expect(kept).toHaveLength(1));
    expect(kept[0]!.runId).toBe(RUN_ID);
    // The date was not changed, so the server's own today (school time) stays the default.
    expect(kept[0]!.body).toEqual({ label: 'BANBEIS 2026 submission' });
    expect(kept[0]!.key).toBeTruthy();
  });

  it('sends the date only when the person changed it', async () => {
    const kept = serveKeep();
    const { user } = open();
    const dialog = await screen.findByRole('dialog', { name: "Keep today's copy" });
    const date = within(dialog).getByLabelText('Numbers as of');
    await user.clear(date);
    await user.type(date, '2026-03-31');
    await user.click(within(dialog).getByRole('button', { name: 'Keep copy' }));
    await waitFor(() => expect(kept).toHaveLength(1));
    expect(kept[0]!.body).toEqual({ as_of: '2026-03-31' });
  });
});

describe('SnapshotsPanel: kept copies', () => {
  const copy = (over: Record<string, unknown>) => ({
    id: 'snap-1',
    definition_id: REPORT_ID,
    name_en: 'Students by class',
    name_bn: 'শ্রেণি অনুযায়ী ছাত্রছাত্রী',
    as_of: '2026-03-31',
    label: 'BANBEIS 2026 submission',
    row_count: 12,
    created_at: '2026-03-31T10:00:00.000Z',
    ...over,
  });
  const serveList = (items: unknown[]) =>
    server.use(
      http.get('/api/v1/reports/snapshots', () =>
        HttpResponse.json({ items, limit: 100, offset: 0, has_more: false }),
      ),
    );

  it('lists the copies of this report with date, what for and a download', async () => {
    serveList([
      copy({}),
      copy({ id: 'snap-2', definition_id: '99999999-9999-4999-8999-999999999999', label: 'Other' }),
    ]);
    renderWithProviders(inRegion(<SnapshotsPanel definitionId={REPORT_ID} enabled />), {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const panel = await screen.findByRole('region', { name: 'Kept copies' });
    const rows = within(panel).getAllByRole('row');
    // One header row and one copy: the other report's copy is not shown here.
    expect(rows).toHaveLength(2);
    expect(within(panel).getByText('BANBEIS 2026 submission')).toBeTruthy();
    expect(within(panel).queryByText('Other')).toBeNull();
    expect(
      within(panel).getByRole('button', { name: 'Download to Excel: BANBEIS 2026 submission' }),
    ).toBeTruthy();
  });

  it('downloads the kept file, unchanged', async () => {
    serveList([copy({})]);
    // jsdom cannot serve a binary body through the mock server, so the one download call is stubbed.
    const real = apiClient.get.bind(apiClient);
    const asked: string[] = [];
    vi.spyOn(apiClient, 'get').mockImplementation((url: string, config?: unknown) => {
      if (!url.endsWith('/download')) return real(url, config as never);
      asked.push(url);
      return Promise.resolve({
        data: new Blob(['x']),
        headers: { 'content-disposition': 'attachment; filename="copy.xlsx"' },
      });
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const { user } = renderWithProviders(
      inRegion(<SnapshotsPanel definitionId={REPORT_ID} enabled />),
      {
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      },
    );
    await user.click(
      await screen.findByRole('button', { name: 'Download to Excel: BANBEIS 2026 submission' }),
    );
    await waitFor(() => expect(asked).toEqual(['/reports/snapshots/snap-1/download']));
  });

  it('shows nothing at all when there are no copies', async () => {
    serveList([]);
    const { container } = renderWithProviders(
      inRegion(<SnapshotsPanel definitionId={REPORT_ID} enabled />),
      { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
    );
    await waitFor(() => expect(container.querySelector('[aria-busy]')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Kept copies' })).toBeNull();
  });
});

describe('the runner More menu', () => {
  const catalogue = [
    {
      folder: null,
      reports: [
        {
          id: REPORT_ID,
          key: 'students-by-class',
          name_en: 'Students by class',
          name_bn: 'শ্রেণি অনুযায়ী ছাত্রছাত্রী',
          version_id: 'v1',
          system_template_key: null,
        },
      ],
    },
  ];
  function serve() {
    server.use(
      http.get('/api/v1/reports/catalogue', () => HttpResponse.json(catalogue)),
      http.get('/api/v1/reports/definitions/:id', () => HttpResponse.json({ draft: null })),
      http.get('/api/v1/reports/snapshots', () =>
        HttpResponse.json({ items: [], limit: 100, offset: 0, has_more: false }),
      ),
      http.post('/api/v1/reports/run', () =>
        HttpResponse.json({
          columns: [
            {
              key: 'n',
              label_en: 'Students',
              label_bn: 'ছাত্রছাত্রী',
              type: 'NUMBER',
              kind: 'measure',
            },
          ],
          rows: [{ n: 40 }],
          masked: [],
          suppressed: false,
          truncated: false,
          total_rows: 1,
          page: 1,
          page_size: 100,
          total_pages: 1,
          run_id: RUN_ID,
        }),
      ),
    );
  }
  async function openMenu(role: string) {
    serve();
    renderWithRouter(routeTree, {
      initialEntries: [`/reports/${REPORT_ID}`],
      tenantId: 'tenant-1',
      role,
      locale: 'en',
    });
    await screen.findByRole('heading', { level: 1, name: 'Students by class' });
    await within(screen.getByRole('main')).findAllByText('40');
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole('main')).getByRole('button', { name: 'More actions' }),
    );
    return user;
  }

  it('gives an admin the three plain-word choices', async () => {
    await openMenu('ADMIN');
    expect(await screen.findByRole('menuitem', { name: 'Email this regularly' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: "Keep today's copy" })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Show on my dashboard' })).toBeTruthy();
  });

  it('does not offer the regular email to an accountant, who still keeps copies', async () => {
    await openMenu('ACCOUNTANT');
    expect(await screen.findByRole('menuitem', { name: "Keep today's copy" })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Email this regularly' })).toBeNull();
  });

  it('puts the report on the dashboard in one click, with no dialog, and offers to take it off', async () => {
    const user = await openMenu('ADMIN');
    await user.click(await screen.findByRole('menuitem', { name: 'Show on my dashboard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const stored = Object.entries(localStorage).find(([k]) => k.startsWith('reports.pins.'));
    expect(JSON.parse(stored![1])).toEqual([REPORT_ID]);

    await user.click(
      within(screen.getByRole('main')).getByRole('button', { name: 'More actions' }),
    );
    expect(await screen.findByRole('menuitem', { name: 'Remove from my dashboard' })).toBeTruthy();
  });

  it('notes the open for the dashboard card', async () => {
    await openMenu('ADMIN');
    const stored = Object.entries(localStorage).find(([k]) => k.startsWith('reports.opened.'));
    expect(Object.keys(JSON.parse(stored![1]))).toEqual([REPORT_ID]);
  });
});

const LANDING_RUN_ID = '44444444-4444-4444-8444-444444444444';

function landingStatus(over: Record<string, unknown> = {}) {
  return {
    id: LANDING_RUN_ID,
    kind: 'SCHEDULED',
    status: 'DONE',
    format: 'XLSX',
    row_count: 120,
    error_code: null,
    expires_at: '2026-11-01T09:00:00.000Z',
    downloadable: true,
    ...over,
  };
}

function serveLanding(body: () => Response | Promise<Response>) {
  server.use(
    http.get(`/api/v1/reports/runs/${LANDING_RUN_ID}`, body),
    // The hub behind "See all reports".
    http.get('/api/v1/reports/catalogue', () => HttpResponse.json([])),
  );
}

async function openLanding(role = 'ADMIN', locale: 'en' | 'bn' = 'en') {
  const view = renderWithRouter(routeTree, {
    initialEntries: [`/reports/runs/${LANDING_RUN_ID}`],
    tenantId: 'tenant-1',
    role,
    locale,
  });
  await screen.findByRole('main');
  return view;
}

const landingPage = () => within(screen.getByRole('main'));

describe('/reports/runs/$runId [8.15.47]: where the email link lands', () => {
  it('offers the download when the file is ready, and asks for it through the signed-in client', async () => {
    serveLanding(() => HttpResponse.json(landingStatus()));
    const asked: string[] = [];
    const real = apiClient.get.bind(apiClient);
    vi.spyOn(apiClient, 'get').mockImplementation((url: string, config?: unknown) => {
      if (!url.endsWith('/download')) return real(url, config as never);
      asked.push(url);
      return Promise.resolve({
        data: new Blob(['x']),
        headers: { 'content-disposition': 'attachment; filename="report.xlsx"' },
      });
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const { container } = await openLanding();

    expect(
      await landingPage().findByRole('heading', { level: 1, name: 'Your report is ready' }),
    ).toBeTruthy();
    await userEvent.setup().click(landingPage().getByRole('button', { name: 'Download to Excel' }));
    await waitFor(() => expect(asked).toEqual([`/reports/runs/${LANDING_RUN_ID}/download`]));
    await expect(container).toHaveNoViolations();
  });

  it('says it is being prepared while the file is queued, and moves on by itself', async () => {
    let calls = 0;
    serveLanding(() => {
      calls += 1;
      return HttpResponse.json(
        landingStatus(calls === 1 ? { status: 'QUEUED', downloadable: false } : {}),
      );
    });
    await openLanding();
    expect(
      await landingPage().findByRole('heading', {
        level: 1,
        name: 'Your report is being prepared',
      }),
    ).toBeTruthy();
    // The page asks again on its own (every few seconds) and then shows the download.
    expect(
      await landingPage().findByRole(
        'heading',
        { level: 1, name: 'Your report is ready' },
        { timeout: 9000 },
      ),
    ).toBeTruthy();
  }, 15000);

  it('says the file is gone after 24 hours, and how to get fresh numbers', async () => {
    serveLanding(() =>
      HttpResponse.json(landingStatus({ status: 'EXPIRED', downloadable: false })),
    );
    await openLanding();
    expect(
      await landingPage().findByRole('heading', { level: 1, name: 'This file is no longer there' }),
    ).toBeTruthy();
    expect(landingPage().getByText(/Open the report again to get fresh numbers/)).toBeTruthy();
    expect(landingPage().getByRole('button', { name: 'See all reports' })).toBeTruthy();
    expect(landingPage().queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('says the file is gone when it is done but no longer downloadable', async () => {
    serveLanding(() => HttpResponse.json(landingStatus({ downloadable: false })));
    await openLanding();
    expect(
      await landingPage().findByRole('heading', { level: 1, name: 'This file is no longer there' }),
    ).toBeTruthy();
  });

  it('says a report that failed could not be made', async () => {
    serveLanding(() =>
      HttpResponse.json(landingStatus({ status: 'FAILED', downloadable: false, error_code: 'X' })),
    );
    await openLanding();
    expect(
      await landingPage().findByRole('heading', {
        level: 1,
        name: 'This report could not be made',
      }),
    ).toBeTruthy();
  });

  it("gives the same plain answer for someone else's file and for one that was removed", async () => {
    serveLanding(() =>
      HttpResponse.json(
        { statusCode: 404, message: 'Run not found', requestId: 'req-1' },
        { status: 404 },
      ),
    );
    await openLanding();
    expect(
      await landingPage().findByRole('heading', { level: 1, name: 'We cannot find this file' }),
    ).toBeTruthy();
    expect(landingPage().getByText(/Sign in with the account that got the email/)).toBeTruthy();
  });

  it('says a role that cannot take files out may read the report on screen only', async () => {
    serveLanding(() => HttpResponse.json(landingStatus()));
    await openLanding('TEACHER');
    expect(
      await landingPage().findByRole('heading', {
        level: 1,
        name: 'You can read this report on screen only',
      }),
    ).toBeTruthy();
    expect(landingPage().queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('offers a retry when the page could not be loaded for another reason', async () => {
    serveLanding(() => HttpResponse.json({ message: 'boom' }, { status: 500 }));
    await openLanding();
    expect(await landingPage().findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('speaks Bangla, with the glossary words', async () => {
    serveLanding(() => HttpResponse.json(landingStatus()));
    const view = await openLanding('ADMIN', 'bn');
    await view.localeReady;
    expect(
      await landingPage().findByRole('heading', { level: 1, name: 'আপনার রিপোর্ট তৈরি' }),
    ).toBeTruthy();
    expect(landingPage().getByRole('button', { name: 'Excel-এ নামান' })).toBeTruthy();
  });

  it('has no jargon word in its text', () => {
    const text = JSON.stringify(enReports.landing);
    expect(text).not.toMatch(/schedul|snapshot|cron|widget/i);
  });
});

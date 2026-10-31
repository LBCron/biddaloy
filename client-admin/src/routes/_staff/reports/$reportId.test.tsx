import { apiClient } from '@biddaloy/ui/api';
import { toast } from '@biddaloy/ui/components';
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

import { CODED_REPORTS, visibleCodedReports } from './-coded-reports';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

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

/** What a designer reads: a year (required) and a class, shown as a table of counts. */
function definition(layout: Record<string, unknown> = crosstab) {
  return {
    id: REPORT_ID,
    key: 'students-by-class',
    name_en: 'Students by class',
    name_bn: 'শ্রেণি অনুযায়ী ছাত্রছাত্রী',
    folder: null,
    status: 'PUBLISHED',
    visible_roles: [],
    current_version_id: 'v1',
    system_template_key: null,
    version: 1,
    updated_at: '2026-10-01T00:00:00.000Z',
    draft: {
      schema: 1,
      subjectArea: 'STUDENTS',
      parameters: [
        {
          key: 'year',
          type: 'ACADEMIC_YEAR',
          label_en: 'Academic year',
          label_bn: 'শিক্ষাবর্ষ',
          required: true,
        },
        { key: 'class', type: 'CLASS', label_en: 'Class', label_bn: 'শ্রেণি', required: false },
      ],
      dataset: { dimensions: [], measures: [], filters: [], sort: [] },
      layout,
      page: { title_en: 'x', title_bn: 'x', orientation: 'portrait' },
      drill: [],
      calculated: [],
      format: [],
    },
  };
}

const crosstab = {
  type: 'CROSSTAB',
  rows: ['class'],
  columns: ['gender'],
  cell_measure: 'students',
};

const columns = [
  { key: 'class', label_en: 'Class', label_bn: 'শ্রেণি', type: 'TEXT', kind: 'dimension' },
  { key: 'gender', label_en: 'Gender', label_bn: 'লিঙ্গ', type: 'TEXT', kind: 'dimension' },
  {
    key: 'students',
    label_en: 'Students',
    label_bn: 'ছাত্রছাত্রী',
    type: 'NUMBER',
    kind: 'measure',
  },
];

function runResult(overrides: Record<string, unknown> = {}) {
  return {
    columns,
    rows: [
      { class: 'Class 6', gender: 'Boy', students: 40 },
      { class: 'Class 6', gender: 'Girl', students: 38 },
    ],
    masked: [],
    suppressed: false,
    truncated: false,
    total_rows: 2,
    page: 1,
    page_size: 100,
    total_pages: 1,
    run_id: RUN_ID,
    ...overrides,
  };
}

interface Served {
  runs: Record<string, unknown>[];
  definitionRequests: number;
  feedback: Record<string, unknown>[];
}

function serve(options: { run?: () => Response | Promise<Response>; designer?: boolean } = {}) {
  const served: Served = { runs: [], definitionRequests: 0, feedback: [] };
  server.use(
    http.get('/api/v1/reports/catalogue', () => HttpResponse.json(catalogue)),
    http.get('/api/v1/reports/definitions/:id', () => {
      served.definitionRequests += 1;
      return HttpResponse.json(definition());
    }),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [
          academicYearFactory({ name: '2025', is_current: false }),
          academicYearFactory({ name: '2026', is_current: true }),
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [classFactory({ name: 'Class 6' }), classFactory({ name: 'Class 7' })],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.post('/api/v1/reports/run', async ({ request }) => {
      served.runs.push((await request.json()) as Record<string, unknown>);
      return options.run ? options.run() : HttpResponse.json(runResult());
    }),
    http.post('/api/v1/reports/runs/:id/feedback', async ({ request }) => {
      served.feedback.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ ok: true });
    }),
  );
  return served;
}

async function renderRunner(
  id = REPORT_ID,
  role = 'ADMIN',
  locale: 'en' | 'bn' = 'en',
  search = '',
) {
  const view = renderWithRouter(routeTree, {
    initialEntries: [`/reports/${id}${search}`],
    tenantId: 'tenant-1',
    role,
    locale,
  });
  // The shell is up; the report itself arrives after its own requests.
  await screen.findByRole('main');
  return view;
}

/** The page itself: the sidebar repeats some words. */
const page = () => within(screen.getByRole('main'));

describe('/reports/$reportId [8.15.29]', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    await cleanupTestState();
  });

  it('runs at once with the default answers, and shows the answer as a table of counts', async () => {
    const served = serve();
    const { container } = await renderRunner();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Students by class' }),
    ).toBeTruthy();
    // The counts are on screen with no button pressed.
    expect((await page().findAllByText('40')).length).toBeGreaterThan(0);
    expect(page().getAllByText('38').length).toBeGreaterThan(0);
    expect(served.runs).toEqual([{ definitionId: REPORT_ID, params: { year: '2026' } }]);
    // The answers are one line above the result.
    expect(page().getByRole('button', { name: /2026.*All classes.*Change/ })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('runs exactly once, however many times it re-renders', async () => {
    const served = serve();
    await renderRunner();
    await page().findAllByText('40');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(served.runs).toHaveLength(1);
  });

  it('opens the form from the line, runs again on Show report, and keeps the answers in the address', async () => {
    const served = serve();
    const { router } = await renderRunner();
    const user = userEvent.setup();
    await page().findAllByText('40');

    await user.click(page().getByRole('button', { name: /Change/ }));
    expect(page().getByRole('form', { name: 'Choices for this report' })).toBeTruthy();
    await user.click(await page().findByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 7' }));
    await user.keyboard('{Escape}');
    await user.click(page().getByRole('button', { name: 'Show report' }));

    await waitFor(() => expect(served.runs).toHaveLength(2));
    expect(served.runs[1]).toEqual({
      definitionId: REPORT_ID,
      params: { year: '2026', class: ['Class 7'] },
    });
    // The form folds back into the line, now naming the class.
    expect(await page().findByRole('button', { name: /2026.*Class 7.*Change/ })).toBeTruthy();
    expect(page().queryByRole('form')).toBeNull();
    expect(router.state.location.search).toEqual({ p: { year: '2026', class: ['Class 7'] } });
  });

  it('opens from a link with answers in it, and runs with them', async () => {
    const served = serve();
    const p = encodeURIComponent(JSON.stringify({ year: '2025', class: ['Class 6'] }));
    await renderRunner(REPORT_ID, 'ADMIN', 'en', `?p=${p}`);
    await page().findAllByText('40');
    expect(served.runs[0]).toEqual({
      definitionId: REPORT_ID,
      params: { year: '2025', class: ['Class 6'] },
    });
  });

  it('gives someone who may not design reports a plain table, and never asks for the definition', async () => {
    const served = serve();
    await renderRunner(REPORT_ID, 'TEACHER');

    expect(await page().findByRole('columnheader', { name: 'Students' })).toBeTruthy();
    expect(served.definitionRequests).toBe(0);
    // No questions are known, so none are asked; the server applies the report's own defaults.
    expect(served.runs).toEqual([{ definitionId: REPORT_ID }]);
    expect(page().queryByRole('button', { name: /Change/ })).toBeNull();
  });

  it('says "narrow the filters" when the report is too slow, and opens the form to do it', async () => {
    serve({
      run: () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'slow',
            requestId: 'req-1',
            details: { code: 'REPORT_TOO_SLOW' },
          },
          { status: 422 },
        ),
    });
    await renderRunner();

    expect(
      await page().findByText('This report is taking too long. Narrow the filters and try again.'),
    ).toBeTruthy();
    expect(await page().findByRole('form', { name: 'Choices for this report' })).toBeTruthy();
  });

  it('says so when the report is not in the person’s catalogue', async () => {
    serve();
    await renderRunner(OTHER_ID);
    expect(await screen.findByText('This report is not available')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'See all reports' })).toBeTruthy();
  });

  it('says what to change when nothing matches', async () => {
    serve({ run: () => HttpResponse.json(runResult({ rows: [], total_rows: 0 })) });
    await renderRunner();
    expect(await page().findByText('Nobody matches these choices')).toBeTruthy();
  });

  it('says that only the first rows are shown when the report is cut short', async () => {
    serve({ run: () => HttpResponse.json(runResult({ truncated: true, total_rows: 10000 })) });
    await renderRunner();
    expect(
      await page().findByText(
        'Showing the first 10,000 rows only. Narrow the choices to see the rest.',
      ),
    ).toBeTruthy();
  });

  it('Print opens the print page in a new tab with the answers it was run with', async () => {
    serve();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await renderRunner();
    const user = userEvent.setup();
    await page().findAllByText('40');
    await user.click(page().getByRole('button', { name: 'Print' }));

    const url = new URL(String(open.mock.calls[0]?.[0]), 'http://localhost');
    expect(url.pathname).toBe('/print/document');
    expect(url.searchParams.get('doc')).toBe('report');
    expect(url.searchParams.get('definitionId')).toBe(REPORT_ID);
    expect(JSON.parse(url.searchParams.get('params') ?? '')).toEqual({ year: '2026' });
    expect(open.mock.calls[0]?.[1]).toBe('_blank');
  });

  it('downloads everything as Excel, and says when a large file is being prepared', async () => {
    serve();
    const info = vi.spyOn(toast, 'info').mockImplementation(() => 1);
    const real = apiClient.post.bind(apiClient);
    const sent: { url: string; body: unknown; headers?: Record<string, string> | undefined }[] = [];
    vi.spyOn(apiClient, 'post').mockImplementation(((
      url: string,
      body?: unknown,
      config?: { headers?: Record<string, string> },
    ) => {
      if (url !== '/reports/runs/export') return real(url, body, config);
      sent.push({ url, body, headers: config?.headers });
      return Promise.resolve({
        status: 202,
        headers: {},
        data: { run_id: RUN_ID, status: 'QUEUED' },
      });
    }) as typeof apiClient.post);
    await renderRunner();
    const user = userEvent.setup();
    await page().findAllByText('40');
    await user.click(page().getByRole('button', { name: /Download to Excel/ }));

    await waitFor(() => expect(info).toHaveBeenCalled());
    expect(sent[0]?.body).toEqual({
      definitionId: REPORT_ID,
      params: { year: '2026' },
      format: 'XLSX',
    });
    // A double click or a lost reply must not start two files.
    expect(sent[0]?.headers?.['Idempotency-Key']).toBeTruthy();
  });

  describe('"was this report useful?"', () => {
    it('is one quiet line under the result; a thumb sends at once and it never asks again', async () => {
      const served = serve();
      await renderRunner();
      const user = userEvent.setup();
      await page().findAllByText('40');
      expect(page().getByText('Was this report useful?')).toBeTruthy();

      await user.click(page().getByRole('button', { name: 'Yes' }));
      expect(await page().findByText('Thank you.')).toBeTruthy();
      expect(served.feedback).toEqual([{ helpful: true }]);
    });

    it('does not come back for a report already answered', async () => {
      serve();
      localStorage.setItem(`reports.feedback.${REPORT_ID}`, '1');
      await renderRunner();
      await page().findAllByText('40');
      expect(page().queryByText('Was this report useful?')).toBeNull();
    });

    it('"no" opens one optional box, "What was missing?", and sends the words with the answer', async () => {
      const served = serve();
      await renderRunner();
      const user = userEvent.setup();
      await page().findAllByText('40');

      await user.click(page().getByRole('button', { name: 'No' }));
      await user.type(page().getByRole('textbox', { name: 'What was missing?' }), 'Section wise');
      await user.click(page().getByRole('button', { name: 'Send' }));
      expect(await page().findByText('Thank you.')).toBeTruthy();
      expect(served.feedback).toEqual([{ helpful: false, comment: 'Section wise' }]);
      expect(localStorage.getItem(`reports.feedback.${REPORT_ID}`)).not.toBeNull();
    });

    it('never blocks the result: a failed answer is a small message beside it, and the table stays', async () => {
      serve();
      server.use(
        http.post('/api/v1/reports/runs/:id/feedback', () =>
          HttpResponse.json({ statusCode: 500, message: 'x', requestId: 'req-2' }, { status: 500 }),
        ),
      );
      await renderRunner();
      const user = userEvent.setup();
      await page().findAllByText('40');
      await user.click(page().getByRole('button', { name: 'Yes' }));
      expect(await page().findByText('Could not send your answer.')).toBeTruthy();
      expect(page().getAllByText('40').length).toBeGreaterThan(0);
    });
  });

  it('writes the screen in Bangla, with the glossary words', async () => {
    serve();
    await renderRunner(REPORT_ID, 'ADMIN', 'bn');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'শ্রেণি অনুযায়ী ছাত্রছাত্রী' }),
    ).toBeTruthy();
    expect(await page().findByText('এই রিপোর্টটা কাজে লাগল?')).toBeTruthy();
    expect(page().getByRole('button', { name: /Excel-এ নামান/ })).toBeTruthy();
    expect(page().getByRole('button', { name: 'হ্যাঁ' })).toBeTruthy();
  });
});

// ---- /reports (the hub) [8.15.29] ----

const STUDENT_LIST_ID = '11111111-1111-4111-8111-111111111111';
const DUES_ID = '22222222-2222-4222-8222-222222222222';

const hubCatalogue = [
  {
    folder: null,
    reports: [
      {
        id: STUDENT_LIST_ID,
        key: 'student-list',
        name_en: 'Student list',
        name_bn: 'শিক্ষার্থীর তালিকা',
        version_id: 'v1',
        system_template_key: null,
      },
    ],
  },
  {
    folder: 'Money',
    reports: [
      {
        id: DUES_ID,
        key: 'dues-by-class',
        name_en: 'Dues by class',
        name_bn: 'শ্রেণি অনুযায়ী বাকি',
        version_id: 'v2',
        system_template_key: null,
      },
    ],
  },
];

function serveCatalogue(body: unknown = hubCatalogue) {
  server.use(http.get('/api/v1/reports/catalogue', () => HttpResponse.json(body as never)));
}

/** The page itself: the sidebar also links to the coded reports, so queries stay inside `main`. */

function renderHub(role = 'ADMIN', locale: 'en' | 'bn' = 'en') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/reports'],
    tenantId: 'tenant-1',
    role,
    locale,
  });
}

describe('/reports [8.15.29]', () => {
  afterEach(async () => {
    localStorage.clear();
    await cleanupTestState();
  });

  it('lists the school’s reports and the coded ones, by folder, each with one plain line', async () => {
    serveCatalogue();
    renderHub();

    expect(await screen.findByRole('heading', { level: 1, name: 'All reports' })).toBeTruthy();
    // A defined report in the unnamed folder, and one in a named folder.
    const ready = await screen.findByRole('region', { name: 'Ready reports' });
    expect(within(ready).getByRole('link', { name: 'Student list' }).getAttribute('href')).toBe(
      `/reports/${STUDENT_LIST_ID}`,
    );
    const money = page().getByRole('region', { name: 'Money' });
    expect(within(money).getByRole('link', { name: 'Dues by class' })).toBeTruthy();
    // A coded report links to its own screen, with its own plain line.
    const fees = page().getByRole('region', { name: 'Fees and money' });
    expect(
      within(fees).getByRole('link', { name: 'Fee collection report' }).getAttribute('href'),
    ).toBe('/reports/collections');
    expect(
      within(fees).getByText('How much was paid each day, by which method and to whom.'),
    ).toBeTruthy();
  });

  it('shows a teacher only the coded reports the role may open', async () => {
    serveCatalogue([]);
    renderHub('TEACHER');

    await screen.findByRole('heading', { level: 1, name: 'All reports' });
    // The student count is a ready report now, so a teacher (not in its audience) no longer sees a card.
    expect(page().queryByRole('link', { name: 'Student count (BANBEIS)' })).toBeNull();
    // Attendance reports need ATTENDANCE_READ, which a teacher holds.
    expect(page().getByRole('link', { name: 'Attendance reports' })).toBeTruthy();
    // Fee collection needs REPORT_COLLECTIONS_READ, which a teacher does not hold.
    expect(page().queryByRole('link', { name: 'Fee collection report' })).toBeNull();
    expect(page().queryByRole('link', { name: 'Application reports' })).toBeNull();
  });

  it('every coded report asks the same permission as its own page', () => {
    // Nothing is listed for a role holding no permission at all.
    expect(visibleCodedReports(() => false)).toEqual([]);
    expect(visibleCodedReports(() => true)).toHaveLength(CODED_REPORTS.length);
  });

  it('search matches the Bangla name, the English name and the plain line', async () => {
    serveCatalogue();
    renderHub();
    const user = userEvent.setup();
    const box = await screen.findByRole('searchbox', { name: 'Find a report' });

    await user.type(box, 'শ্রেণি অনুযায়ী');
    expect(await page().findByRole('link', { name: 'Dues by class' })).toBeTruthy();
    expect(page().queryByRole('link', { name: 'Student list' })).toBeNull();

    await user.clear(box);
    await user.type(box, 'which method');
    expect(await page().findByRole('link', { name: 'Fee collection report' })).toBeTruthy();
    expect(page().queryByRole('link', { name: 'Dues by class' })).toBeNull();

    await user.clear(box);
    await user.type(box, 'zzzz');
    expect(await screen.findByText('No report matches')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await page().findByRole('link', { name: 'Student list' })).toBeTruthy();
  });

  it('a favourite is pinned to the top, remembered in this browser, and leaves its folder', async () => {
    serveCatalogue();
    renderHub();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Add Dues by class to favourites' }),
    );

    const favourites = await screen.findByRole('region', { name: 'Favourites' });
    expect(within(favourites).getByRole('link', { name: 'Dues by class' })).toBeTruthy();
    // It shows once, not again under its folder.
    expect(page().getAllByRole('link', { name: 'Dues by class' })).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('reports.favourites') ?? '[]')).toEqual([
      `defined:${DUES_ID}`,
    ]);
    const pressed = within(favourites).getByRole('button', {
      name: 'Remove Dues by class from favourites',
    });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
  });

  it('still works when the browser will not store favourites', async () => {
    serveCatalogue();
    // A browser that refuses to store (private mode, blocked site data).
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderHub();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add Student list to favourites' }));
    expect(await screen.findByRole('region', { name: 'Favourites' })).toBeTruthy();
    blocked.mockRestore();
  });

  it('still shows the coded reports when the school’s own list cannot be loaded, with a way to retry', async () => {
    server.use(
      http.get('/api/v1/reports/catalogue', () =>
        HttpResponse.json({ message: 'x' }, { status: 500 }),
      ),
    );
    renderHub();
    expect(await screen.findByText('The ready reports could not be loaded.')).toBeTruthy();
    expect(page().getByRole('link', { name: 'Fee collection report' })).toBeTruthy();
  });

  it('writes the hub in Bangla', async () => {
    serveCatalogue();
    renderHub('ADMIN', 'bn');
    expect(await screen.findByRole('heading', { level: 1, name: 'সব রিপোর্ট' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'শিক্ষার্থীর তালিকা' })).toBeTruthy();
    expect(page().getByRole('link', { name: 'ফি আদায়ের প্রতিবেদন' })).toBeTruthy();
  });
});

describe('/reports: New report [8.15.41]', () => {
  afterEach(async () => {
    localStorage.clear();
    await cleanupTestState();
  });

  it('offers New report to the admin only, as a link to the designer', async () => {
    serveCatalogue();
    renderHub('ADMIN');
    const link = await screen.findByRole('link', { name: 'New report' });
    expect(link.getAttribute('href')).toBe('/reports/new');
  });

  it('does not offer it to an accountant, who may not design reports', async () => {
    serveCatalogue();
    renderHub('ACCOUNTANT');
    await screen.findByRole('heading', { level: 1, name: 'All reports' });
    expect(screen.queryByRole('link', { name: 'New report' })).toBeNull();
  });
});

describe('/reports/$reportId: colours and links [8.15.42]', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    await cleanupTestState();
  });

  /** A table of counts with a drill to the student list report and a rule that colours counts over 39. */
  function serveWithDrill() {
    const served = serve();
    const body = definition({ ...crosstab, totals: true });
    body.draft.drill = [
      {
        field: 'class',
        target: { report: 'student-list' },
        pass: { class: 'class' },
      },
    ] as never;
    body.draft.format = [
      {
        field: 'students',
        when: { field: 'students', op: 'GT', value: 39 },
        style: { tone: 'bad' },
      },
    ] as never;
    server.use(
      http.get('/api/v1/reports/definitions/:id', () => HttpResponse.json(body)),
      http.get('/api/v1/reports/catalogue', () =>
        HttpResponse.json([
          {
            folder: null,
            reports: [
              ...catalogue[0]!.reports,
              {
                id: OTHER_ID,
                key: 'student-list',
                name_en: 'Student list',
                name_bn: 'ছাত্রছাত্রীর তালিকা',
                version_id: 'v2',
                system_template_key: 'student-list',
              },
            ],
          },
        ]),
      ),
    );
    return served;
  }

  it('colours a count with an icon and a word, and says what the colour means under the report', async () => {
    serveWithDrill();
    await renderRunner();
    await page().findAllByText('40');

    // 40 is over 39: it is read out with its colour. 38 is not.
    expect(page().getAllByText('(Red)')).toHaveLength(1);
    // The legend is the designer's own sentence.
    expect(page().getByRole('region', { name: 'What the colours mean' }).textContent).toContain(
      'Red = If Students is more than 39 then',
    );
  });

  it("opens the other report with the clicked class, and Go back keeps the first report's choices", async () => {
    const served = serveWithDrill();
    const { router } = await renderRunner();
    const user = userEvent.setup();
    await page().findAllByText('40');

    await user.click(page().getByRole('link', { name: 'See the list: Class 6, Boy (40)' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/reports/${OTHER_ID}`));
    // The other report really runs for that class only, not for every class.
    await waitFor(() =>
      expect(served.runs.at(-1)).toMatchObject({
        definitionId: OTHER_ID,
        params: { class: ['Class 6'] },
      }),
    );
    expect(router.state.location.search).toMatchObject({
      p: { class: 'Class 6' },
      from: `/reports/${REPORT_ID}`,
    });
    await user.click(await page().findByRole('link', { name: 'Go back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/reports/${REPORT_ID}`));
  });

  it('ignores a "from" that leaves the app', async () => {
    serve();
    await renderRunner(REPORT_ID, 'ADMIN', 'en', '?from=https%3A%2F%2Fevil.example%2F');
    await page().findAllByText('40');
    expect(page().queryByRole('link', { name: 'Go back' })).toBeNull();
  });

  it('shows a designer the way into the editor', async () => {
    serve();
    await renderRunner();
    await page().findAllByText('40');
    const link = await page().findByRole('link', { name: 'Change' });
    expect(link.getAttribute('href')).toBe(`/reports/${REPORT_ID}/edit`);
  });
});

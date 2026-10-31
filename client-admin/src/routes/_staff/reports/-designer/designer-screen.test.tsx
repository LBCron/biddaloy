import { readFileSync } from 'node:fs';
import path from 'node:path';

import { apiClient } from '@biddaloy/ui/api';
import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  renderHookWithProviders,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

import {
  BLANK_DRAFT,
  areaInfo,
  buildDefinition,
  movePick,
  placeError,
  PREVIEW_DELAY_MS,
  usePreviewResult,
} from './use-designer-state';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const COPY_ID = '44444444-4444-4444-8444-444444444444';

const meta = {
  schema_version: 1,
  areas: [
    {
      key: 'STUDENTS',
      fields: [
        field('class', 'Class', 'শ্রেণি', 'TEXT', { groupable: true }),
        field('class_order', 'Class order', 'শ্রেণির ক্রম', 'NUMBER', { groupable: true }),
        field('gender', 'Gender', 'লিঙ্গ', 'ENUM', {
          groupable: true,
          enum_values: ['MALE', 'FEMALE'],
        }),
        field('status', 'Status', 'অবস্থা', 'ENUM', { enum_values: ['ACTIVE', 'INACTIVE'] }),
        // A name can be shown but not split by, so it cannot sit beside a count.
        field('name', 'Student name', 'শিক্ষার্থীর নাম', 'TEXT', { groupable: false }),
      ],
      measures: [
        {
          key: 'students',
          label_en: 'Students',
          label_bn: 'ছাত্রছাত্রী',
          fn: 'COUNT_DISTINCT',
          type: 'NUMBER',
          sensitivity: 'PUBLIC',
        },
      ],
    },
  ],
};

function field(
  key: string,
  label_en: string,
  label_bn: string,
  type: string,
  extra: { groupable?: boolean; enum_values?: string[] } = {},
) {
  return {
    key,
    label_en,
    label_bn,
    type,
    sensitivity: 'PUBLIC',
    filterable: true,
    groupable: extra.groupable ?? false,
    sortable: true,
    ...(extra.enum_values ? { enum_values: extra.enum_values } : {}),
  };
}

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

const runResult = {
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
  page_size: 2,
  total_pages: 1,
  run_id: 'r1',
};

const catalogue = [
  {
    folder: null,
    reports: [
      {
        id: REPORT_ID,
        key: 'student-list',
        name_en: 'Student list',
        name_bn: 'ছাত্রছাত্রীর তালিকা',
        version_id: 'v1',
        system_template_key: 'student-list',
      },
    ],
  },
];

function serve(options: { run?: () => Response | Promise<Response> } = {}) {
  const served = {
    runs: [] as Record<string, unknown>[],
    clones: 0,
    patches: [] as Record<string, unknown>[],
  };
  server.use(
    http.get('/api/v1/reports/meta', () => HttpResponse.json(meta)),
    http.get('/api/v1/reports/catalogue', () => HttpResponse.json(catalogue)),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [academicYearFactory({ name: '2026', is_current: true })],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [classFactory({ name: 'Class 6' })],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.post('/api/v1/reports/run', async ({ request }) => {
      served.runs.push((await request.json()) as Record<string, unknown>);
      return options.run ? options.run() : HttpResponse.json(runResult);
    }),
    http.patch('/api/v1/reports/definitions/:id', async ({ request }) => {
      served.patches.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: COPY_ID });
    }),
    http.post('/api/v1/reports/definitions/:id/clone', () => {
      served.clones += 1;
      return HttpResponse.json({ id: COPY_ID });
    }),
    http.get('/api/v1/reports/definitions/:id', () =>
      HttpResponse.json({
        id: COPY_ID,
        key: 'student-list-copy',
        name_en: 'Student list (copy)',
        name_bn: 'ছাত্রছাত্রীর তালিকা (কপি)',
        folder: null,
        status: 'DRAFT',
        visible_roles: [],
        current_version_id: null,
        system_template_key: 'student-list',
        version: null,
        updated_at: '2026-10-01T00:00:00.000Z',
        draft: {
          schema: 1,
          subjectArea: 'STUDENTS',
          parameters: [],
          dataset: {
            dimensions: [{ field: 'class' }, { field: 'name' }],
            measures: [],
            filters: [],
            sort: [],
          },
          layout: { type: 'TABLE', totals: false },
          page: { title_en: 'x', title_bn: 'x', orientation: 'portrait' },
          drill: [],
          calculated: [],
          format: [],
        },
      }),
    ),
  );
  return served;
}

function renderAt(entry: string, role = 'ADMIN', locale: 'en' | 'bn' = 'en') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale,
  });
}

const page = () => within(screen.getByRole('main'));

describe('/reports/new [8.15.41]', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('turns "how many …, by …" into a table of counts in two choices', async () => {
    const served = serve();
    renderAt('/reports/new');
    const user = userEvent.setup();

    // Choice 1 and 2: split by class, then by gender. The card's third dropdown is "of whom" (students).
    const card = within(await screen.findByRole('group', { name: 'How many …, by …?' }));
    await user.click(card.getByRole('combobox', { name: 'By' }));
    await user.click(await screen.findByRole('option', { name: 'Class' }));
    await user.click(card.getByRole('combobox', { name: 'And (optional)' }));
    await user.click(await screen.findByRole('option', { name: 'Gender' }));
    await user.click(card.getByRole('button', { name: 'Start' }));

    // The designer is open with both splits picked, and the preview shows the counts.
    expect(await page().findByRole('heading', { level: 1, name: 'New report' })).toBeTruthy();
    await waitFor(() => expect(served.runs).toHaveLength(1));
    const sent = served.runs[0] as {
      definition: {
        layout: Record<string, unknown>;
        dataset: Record<string, unknown>;
      };
    };
    expect(sent.definition.layout).toMatchObject({
      type: 'CROSSTAB',
      rows: ['class'],
      columns: ['gender'],
      cell_measure: 'students',
    });
    // A preview is 50 rows, whatever the report would run with.
    expect(sent.definition.dataset.limit).toBe(50);
    expect((await page().findAllByText('40')).length).toBeGreaterThan(0);
    // The layout switcher says why it chose a table of counts.
    expect(
      page().getByText('You picked two splits, so a table of rows and columns is shown'),
    ).toBeTruthy();
  });

  it('copies a ready report and opens the copy for changing', async () => {
    const served = serve();
    const { router } = renderAt('/reports/new');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Student list/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/reports/${COPY_ID}/edit`));
    expect(served.clones).toBe(1);
    // The copy's own draft fills the designer.
    expect(await page().findByRole('heading', { level: 1, name: 'Change report' })).toBeTruthy();
  });

  it('says a refused combination in plain words, beside the picker', async () => {
    serve({
      run: () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'This report splits by a field that cannot be split.',
            requestId: 'req-1',
            details: { code: 'NOT_GROUPABLE', path: 'dataset.dimensions[1]' },
          },
          { status: 422 },
        ),
    });
    renderAt(`/reports/${COPY_ID}/edit`);
    await screen.findByRole('main');
    // The draft shows a name (not groupable) and no count: add a count so the two clash.
    const user = userEvent.setup();
    await user.click(await page().findByRole('button', { name: 'Count / Add up: Students' }));

    const alert = await page().findByText(/These two cannot be split together: Student name/);
    expect(alert.getAttribute('role')).toBe('alert');
    // No code, no field key from the server.
    expect(alert.textContent).not.toMatch(/NOT_GROUPABLE|dataset\./);
  });

  it('saves a report that already exists with Ctrl+S, changing only the name in the language in use', async () => {
    const served = serve();
    renderAt(`/reports/${COPY_ID}/edit`, 'ADMIN', 'bn');
    await screen.findByRole('main');
    const user = userEvent.setup();
    await page().findByRole('heading', { level: 1, name: 'রিপোর্ট বদলান' });

    await user.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(served.patches).toHaveLength(1));
    const sent = served.patches[0]!;
    // The English name was never touched: a Bangla save must not turn it into Bangla.
    expect(sent).toHaveProperty('name_bn', 'ছাত্রছাত্রীর তালিকা (কপি)');
    expect(sent).not.toHaveProperty('name_en');
  });

  it('is closed to a teacher', async () => {
    renderAt('/reports/new', 'TEACHER');
    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByText('Start from a ready report')).toBeNull();
  });

  it('opens the save step with Ctrl+S, naming the report from the question', async () => {
    serve();
    renderAt('/reports/new');
    const user = userEvent.setup();
    const card = within(await screen.findByRole('group', { name: 'How many …, by …?' }));
    await user.click(card.getByRole('button', { name: 'Start' }));
    await page().findByRole('heading', { level: 1, name: 'New report' });

    await user.keyboard('{Control>}s{/Control}');

    const dialog = await screen.findByRole('dialog', { name: 'Save this report' });
    expect(within(dialog).getByRole('textbox', { name: 'Report name' })).toHaveProperty(
      'value',
      'Students by Class, Gender',
    );
    // Admin always sees it, and the buttons are the two the ticket names.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Switch on for everyone' })).toBeTruthy();
  });
});

describe('the designer state', () => {
  const info = areaInfo(meta, 'STUDENTS');

  it('builds a table of counts sorted in school order, and nothing while nothing is picked', () => {
    expect(buildDefinition(BLANK_DRAFT, info)).toBeNull();
    const draft = {
      ...BLANK_DRAFT,
      picks: { show: [], split: ['class', 'gender'], count: ['students'] },
    };
    const definition = buildDefinition(draft, info)!;
    expect(definition.layout.type).toBe('CROSSTAB');
    // `class_order` is added so Six comes before Ten.
    expect(definition.dataset.dimensions.map((d) => d.field)).toEqual([
      'class_order',
      'class',
      'gender',
    ]);
    expect(definition.dataset.measures).toEqual([{ field: 'students', fn: 'COUNT_DISTINCT' }]);
  });

  it('moves a pick with Alt+↑ / Alt+↓ and stops at the ends', () => {
    const picks = { show: ['a', 'b', 'c'], split: [], count: [] };
    expect(movePick(picks, 'show', 'b', -1).show).toEqual(['b', 'a', 'c']);
    expect(movePick(picks, 'show', 'c', 1)).toBe(picks);
    expect(movePick(picks, 'show', 'a', -1)).toBe(picks);
  });

  it('puts an error beside the field the server pointed at', () => {
    const draft = { ...BLANK_DRAFT, picks: { show: ['name'], split: [], count: ['students'] } };
    expect(
      placeError(
        { details: { code: 'NOT_GROUPABLE', path: 'dataset.dimensions[0]' } },
        draft,
        info,
      ),
    ).toEqual({ zone: 'picks', code: 'NOT_GROUPABLE', fieldKey: 'name' });
    expect(
      placeError({ details: { code: 'BAD_VALUE', path: 'dataset.filters[2]' } }, draft, info),
    ).toEqual({ zone: 'filter', code: 'BAD_VALUE', index: 2 });
    expect(placeError(new Error('network'), draft, info)).toBeNull();
  });
});

describe('the live preview', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const info = areaInfo(meta, 'STUDENTS');
  const definition = buildDefinition(
    { ...BLANK_DRAFT, picks: { show: [], split: ['class'], count: ['students'] } },
    info,
  )!;

  it('waits 400 ms after the last change, asks for 50 rows, and keeps the old result while loading', async () => {
    vi.useFakeTimers();
    const post = vi
      .spyOn(apiClient, 'post')
      .mockImplementation(() => Promise.resolve({ status: 200, data: runResult }));
    const { result, rerender } = renderHookWithProviders(
      ({ params }: { params: Record<string, unknown> }) => usePreviewResult(definition, params),
      { initialProps: { params: {} } },
    );

    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS - 1));
    expect(post).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(post).toHaveBeenCalledTimes(1);
    const body = post.mock.calls[0]![1] as { definition: { dataset: { limit: number } } };
    expect(body.definition.dataset.limit).toBe(50);
    expect(result.current.result).toEqual(runResult);

    // A change: nothing is sent for 400 ms, and the old result stays on screen meanwhile.
    rerender({ params: { year: '2025' } });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS - 1));
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);
    expect(result.current.result).toEqual(runResult);

    // Another change before the wait is over restarts it: still one request, not two.
    rerender({ params: { year: '2024' } });
    await act(() => vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS));
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('words on the designer', () => {
  const read = (file: string) =>
    JSON.parse(readFileSync(path.resolve(__dirname, file), 'utf8')) as Record<string, unknown>;
  const flatten = (node: unknown, prefix = ''): Record<string, string> =>
    typeof node === 'string'
      ? { [prefix]: node }
      : Object.entries(node as Record<string, unknown>).reduce(
          (all, [key, value]) => ({ ...all, ...flatten(value, prefix ? `${prefix}.${key}` : key) }),
          {},
        );
  const root = '../../../../../../';
  const glossary = readFileSync(
    path.resolve(__dirname, `${root}docs/ux-research/8.15-reports-glossary.md`),
    'utf8',
  );
  // The "Never say" column of the glossary's table.
  const neverSay = [
    ...new Set(
      glossary
        .split('## Rules')[0]!
        .split('\n')
        .filter((line) => line.startsWith('|') && !/^\|\s*(Idea|-)/.test(line))
        .flatMap((line) => (line.split('|').at(-2) ?? '').split(','))
        .map((term) => term.replace(/\(.*?\)/g, '').trim())
        .filter(Boolean),
    ),
  ];

  for (const language of ['en', 'bn']) {
    it(`${language}: no BI jargon from the glossary's never-say column`, () => {
      const words = flatten(read(`${root}ui/src/i18n/locales/${language}/reportDesigner.json`));
      expect(neverSay.length).toBeGreaterThan(30);
      for (const [key, text] of Object.entries(words)) {
        for (const term of neverSay) {
          expect(text, `${language} ${key} must not say "${term}"`).not.toMatch(
            new RegExp(
              `(^|[^\\p{L}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`,
              'iu',
            ),
          );
        }
      }
    });
  }

  it('has the same keys in both languages, and the ticket sentences in Bangla', () => {
    const bn = flatten(read(`${root}ui/src/i18n/locales/bn/reportDesigner.json`));
    const en = flatten(read(`${root}ui/src/i18n/locales/en/reportDesigner.json`));
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    expect(bn['start.ready.title']).toBe('একটি তৈরি রিপোর্ট থেকে শুরু করুন');
    expect(bn['start.question.title']).toBe('একটি প্রশ্ন দিয়ে শুরু করুন');
    expect(bn['start.blank']).toBe('ফাঁকা থেকে শুরু');
    expect(bn['back']).toBe('ফিরে যান');
  });
});

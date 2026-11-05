/** [70.5.x] `/my-class/$sectionId/notes`: target switch, locked target, save payload, dirty guard. */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const BASE = '/api/v1/my-class/sections/section-1/report-card-notes';
const ITEMS = [
  { key: 'discipline', name_bn: 'শৃঙ্খলা', name_en: 'Discipline' },
  { key: 'neatness', name_bn: 'পরিচ্ছন্নতা', name_en: 'Neatness' },
];
const exam = (id: string, name: string, status: string, created: string) => ({
  id,
  name,
  status,
  academic_year_id: 'year-1',
  academic_year: { is_current: true },
  created_at: created,
});

const view = (over: Record<string, unknown>) => ({
  target: { exam_id: null, final_result_id: null },
  section_id: 'section-1',
  locked: false,
  conduct_items: ITEMS,
  rows: [
    {
      student_id: 's1',
      full_name: 'Rafi',
      full_name_bn: null,
      roll_number: 1,
      remark: 'Good',
      conduct: { discipline: 'A' },
    },
    {
      student_id: 's2',
      full_name: 'Mina',
      full_name_bn: null,
      roll_number: 2,
      remark: null,
      conduct: {},
    },
  ],
  ...over,
});

let saved: unknown;
let saveStatus = 204;

function mockAll() {
  saved = undefined;
  saveStatus = 204;
  server.use(
    http.get('/api/v1/my-class/sections', () =>
      HttpResponse.json([
        {
          section_id: 'section-1',
          section_name: 'A',
          class_id: 'class-7',
          class_name: 'Class 7',
          assignment_type: 'CLASS_TEACHER',
        },
      ]),
    ),
    http.get('/api/v1/exams', () =>
      HttpResponse.json({
        data: [
          exam('exam-1', 'Half Yearly', 'PUBLISHED', '2026-09-01T00:00:00Z'),
          exam('exam-2', 'Model Test', 'DRAFT', '2026-10-01T00:00:00Z'),
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/final-results', () =>
      HttpResponse.json([
        {
          class: { id: 'class-7', name: 'Class 7' },
          final_result_id: 'final-1',
          status: 'DRAFT',
          published_at: null,
        },
      ]),
    ),
    http.get(`${BASE}/missing`, () =>
      HttpResponse.json({ total: 2, missing_remark: 1, missing_conduct: 2 }),
    ),
    http.get(BASE, ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('exam_id') === 'exam-1') {
        return HttpResponse.json(view({ locked: true }));
      }
      return HttpResponse.json(view({}));
    }),
    http.put(BASE, async ({ request }) => {
      saved = await request.json();
      if (saveStatus === 409) {
        return HttpResponse.json(
          { statusCode: 409, message: 'locked', requestId: 'r1' },
          { status: 409 },
        );
      }
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

function render(entry = '/my-class/section-1/notes?for=final') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('/my-class/$sectionId/notes', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('loads the final result grid with the progress line and no banned words', async () => {
    mockAll();
    render();
    expect(await screen.findByLabelText("Class teacher's remark — Rafi")).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Class teacher's remark — Rafi").value).toBe(
      'Good',
    );
    expect(
      screen.getByText('1 students still need a remark and 2 still need conduct grades.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Remarks and conduct — Class 7 – A/ })).toBeTruthy();
    await waitFor(() => expect(document.title).toContain('Remarks and conduct'));
    expect(document.body.textContent ?? '').not.toMatch(
      /composition|weight|override|best-of|snapshot|comment/i,
    );
  });

  it('switching the target reloads, and a published one is read-only', async () => {
    const user = userEvent.setup();
    mockAll();
    render();
    await screen.findByLabelText("Class teacher's remark — Rafi");
    await user.click(screen.getByRole('combobox', { name: 'For which result' }));
    await user.click(await screen.findByRole('option', { name: 'Half Yearly (published)' }));
    expect(await screen.findByText(/the result is published/i)).toBeTruthy();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Class teacher's remark — Rafi").disabled,
    ).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true);
  });

  it('saves the full grid in one PUT, blank remark as null', async () => {
    const user = userEvent.setup();
    mockAll();
    render();
    const mina = await screen.findByLabelText("Class teacher's remark — Mina");
    await user.type(mina, 'Kind');
    await user.click(screen.getByRole('combobox', { name: 'Neatness — Mina' }));
    await user.click(await screen.findByRole('option', { name: 'B' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toEqual({
      notes: [
        { student_id: 's1', remark: 'Good', conduct: { discipline: 'A' } },
        { student_id: 's2', remark: 'Kind', conduct: { neatness: 'B' } },
      ],
    });
    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('says the result is published when the server answers 409', async () => {
    const user = userEvent.setup();
    mockAll();
    saveStatus = 409;
    render();
    await user.type(await screen.findByLabelText("Class teacher's remark — Mina"), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/the result is published/i)).toBeTruthy();
  });

  it('asks before closing with unsaved edits', async () => {
    const user = userEvent.setup();
    mockAll();
    render();
    await user.type(await screen.findByLabelText("Class teacher's remark — Mina"), 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('a background refetch of the same target keeps unsaved typing', async () => {
    const user = userEvent.setup();
    mockAll();
    let gets = 0;
    server.use(
      http.get(BASE, () => {
        gets += 1;
        const changed = gets > 1;
        return HttpResponse.json(
          view({
            rows: [
              {
                student_id: 's1',
                full_name: 'Rafi',
                full_name_bn: null,
                roll_number: 1,
                remark: changed ? 'Changed elsewhere' : 'Good',
                conduct: {},
              },
            ],
          }),
        );
      }),
    );
    const { queryClient } = render();
    const box = await screen.findByLabelText<HTMLTextAreaElement>("Class teacher's remark — Rafi");
    await user.type(box, ' typed');
    await queryClient.invalidateQueries({ queryKey: ['report-card-notes'] });
    await waitFor(() => expect(gets).toBeGreaterThan(1));
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Class teacher's remark — Rafi").value,
    ).toBe('Good typed');
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false),
    );
  });
});

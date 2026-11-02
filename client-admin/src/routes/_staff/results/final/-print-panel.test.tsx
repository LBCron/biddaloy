/**
 * [70.5.3] Print tab: not available before the build, an A4 preview of the final report card once
 * built, and "print all" fetches every card and prints in place.
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

// The route-permission entries for these pages land with the nav/route-map ticket (#3421). Until then
// the closed-by-default gate would refuse them, so the same two entries are added here.
vi.mock('../../../../route-permissions', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../../route-permissions')>();
  const { Permission } = await import('@biddaloy/shared');
  return {
    ...mod,
    STAFF_ROUTE_PERMISSIONS: {
      ...mod.STAFF_ROUTE_PERMISSIONS,
      '/_staff/results/final/': Permission.RESULT_PROCESS,
      '/_staff/results/final/$finalResultId': Permission.RESULT_PROCESS,
    },
  };
});

import { mockFinal, type Status } from './-test-fixtures';

const card = {
  final_result_id: 'fr-1',
  academic_year_name: '2026',
  student: { full_name: 'Rima Akter', roll_number: 1 },
  final: { total_marks: 91, gpa: 5, grade: 'A+', position: 1, is_fail: false },
  exams: [
    { exam_id: 'e1', exam_name: 'Half Yearly', total_marks: 88, gpa: 5 },
    { exam_id: 'e2', exam_name: 'Annual', total_marks: 93, gpa: 5 },
  ],
  subjects: [
    {
      subject_name: 'Maths',
      obtained: 91,
      grade: 'A+',
      gpa: 5,
      is_fail: false,
      is_fourth_subject: false,
      per_exam: [
        { exam_id: 'e1', obtained: 88 },
        { exam_id: 'e2', obtained: 93 },
      ],
    },
  ],
  legend: [{ grade: 'A+', gpa: 5, comment: null }],
  attendance: { working_days: 200, present_days: 190 },
  remark: 'Hard working',
  conduct: [{ key: 'discipline', name_bn: 'শৃঙ্খলা', name_en: 'Discipline', grade: 'A' }],
  issuer: { name: 'Demo School', name_bn: null, address: null, phone: null, email: null },
  logo_url: null,
};

async function open(status: Status) {
  mockFinal(status);
  server.use(http.get('/api/v1/final-results/fr-1/students/st1', () => HttpResponse.json(card)));
  renderWithRouter(routeTree, {
    initialEntries: ['/results/final/fr-1?tab=print'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  await screen.findByRole('tab', { name: 'Print' });
}

describe('Print tab', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('asks for the build first', async () => {
    await open('DRAFT');
    await screen.findByText('Build the results first, then you can print the cards.');
    expect(screen.queryByRole('button', { name: /Print all cards/ })).toBeNull();
  });

  it('previews the final card with the remark and the per-exam columns', async () => {
    await open('PROCESSED');
    await screen.findByText('Hard working');
    expect(screen.getAllByText('Half Yearly').length).toBeGreaterThan(0);
    expect(screen.getByText('Maths')).toBeTruthy();
  });

  it('prints every card of the section in place', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await open('PROCESSED');
    await screen.findByText('Hard working');
    await userEvent.click(screen.getByRole('button', { name: /Print all cards/ }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  /** 101 students, so the section needs a second page of rows. */
  function bigSection(failId?: string) {
    const rowOf = (n: number) => ({
      student: { id: `st${n}`, full_name: `Student ${n}`, roll_number: n },
      total_marks: 50,
      gpa: 3,
      grade: 'B',
      position: n,
      section_position: n,
      is_fail: false,
      working_days: 200,
      present_days: 190,
      per_exam: [],
    });
    const offsets: number[] = [];
    let live = 0;
    let peak = 0;
    let cards = 0;
    server.use(
      http.get('/api/v1/final-results/fr-1/rows', ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0);
        offsets.push(offset);
        const from = offset + 1;
        const to = Math.min(offset + 100, 101);
        return HttpResponse.json({
          data: Array.from({ length: to - from + 1 }, (_, k) => rowOf(from + k)),
          total: 101,
          limit: 100,
          offset,
        });
      }),
      http.get('/api/v1/final-results/fr-1/students/:id', async ({ params }) => {
        live++;
        peak = Math.max(peak, live);
        cards++;
        await new Promise((r) => setTimeout(r, 1));
        live--;
        if (params.id === failId) return HttpResponse.json({ message: 'no' }, { status: 500 });
        return HttpResponse.json({
          ...card,
          student: { full_name: String(params.id), roll_number: 1 },
        });
      }),
    );
    return { offsets, peak: () => peak, cards: () => cards };
  }

  it('reads every page of the section and fetches a few cards at a time', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await open('PROCESSED');
    const big = bigSection();
    await screen.findByText('Hard working');
    await userEvent.click(screen.getByRole('button', { name: /Print all cards/ }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(big.offsets).toContain(100);
    expect(big.cards()).toBeGreaterThanOrEqual(101);
    expect(big.peak()).toBeLessThanOrEqual(4);
  });

  it('marks a card that failed and still prints the rest', async () => {
    let area = '';
    let parent: Element | null = null;
    let css = '';
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      const el = document.querySelector('.final-print-area');
      area = el?.textContent ?? '';
      parent = el?.parentElement ?? null;
      css = el?.querySelector('style')?.textContent ?? '';
    });
    await open('PROCESSED');
    bigSection('st3');
    await screen.findByText('Hard working');
    await userEvent.click(screen.getByRole('button', { name: /Print all cards/ }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(area).toContain('Student 3');
    expect(area).toContain("card couldn't load");
    // Only the sheets print: the area is a direct child of <body> and every sibling is dropped.
    expect(parent).toBe(document.body);
    expect(css).toContain('body > *:not(.final-print-area)');
  });
});

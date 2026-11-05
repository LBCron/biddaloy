import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [19.9.1] Staff results panel — every exam, unpublished ones labelled so
 * staff never mistake an unpublished grade for one a parent can see. */
const STUDENT = studentFactory({ id: 'student-1' });

const enrollment = (yearId: string, start: string) => ({
  id: `enr-${yearId}`,
  academic_year_id: yearId,
  academic_year: { id: yearId, name: yearId, start_date: start },
});

/** `cards` maps an academic year id to the final card the server returns for it (else 404). */
function renderPanel(
  finals: unknown[] = [],
  cards: Record<string, { name: string }> = {},
  years = [enrollment('year-1', '2026-01-01T00:00:00Z')],
  finalsFail = false, // the `/final-results` lookup answers 500
) {
  //The panel renders router links, so it is mounted through the real route.
  server.use(
    http.get('/api/v1/students/:id', () => HttpResponse.json(STUDENT)),
    http.get('/api/v1/enrollments/student/:id', () => HttpResponse.json(years)),
    http.get('/api/v1/final-results', () =>
      finalsFail
        ? HttpResponse.json({ statusCode: 500, message: 'boom' }, { status: 500 })
        : HttpResponse.json(finals),
    ),
    http.get('/api/v1/students/:studentId/final-result-card', ({ request }) => {
      const card = cards[new URL(request.url).searchParams.get('academic_year_id') ?? ''];
      if (!card) return HttpResponse.json({ statusCode: 404, message: 'none' }, { status: 404 });
      return HttpResponse.json({
        final_result_id: 'final-1',
        academic_year_name: card.name,
        final: { total_marks: 812, gpa: 4.5, grade: 'A', position: 3, is_fail: false },
      });
    }),
    http.get('/api/v1/students/:studentId/promotion-overrides', () => HttpResponse.json([])),
  );
  return renderWithRouter(routeTree, {
    initialEntries: ['/students/student-1?tab=results'],
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}

describe('ResultsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows every exam, labelling the unpublished one', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/results', () =>
        HttpResponse.json([
          {
            exam_id: 'exam-published',
            exam_name: 'First Term Exam',
            exam_kind: 'TERM',
            published: true,
            total_marks: 450,
            gpa: 5.0,
            grade: 'A+',
            position: 1,
            is_fail: false,
          },
          {
            exam_id: 'exam-unpublished',
            exam_name: 'Monthly Test',
            exam_kind: 'MONTHLY',
            published: false,
            total_marks: 60,
            gpa: 3.0,
            grade: 'B',
            position: 2,
            is_fail: false,
          },
        ]),
      ),
    );

    renderPanel();

    expect(await screen.findByText('First Term Exam')).toBeTruthy();
    expect(screen.getByText('Monthly Test')).toBeTruthy();
    expect(screen.getByText('Not yet published')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'View result' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/results/exam-published/student-1',
      '/results/exam-unpublished/student-1',
    ]);
  });

  it('marks a failed exam with a badge', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/results', () =>
        HttpResponse.json([
          {
            exam_id: 'exam-fail',
            exam_name: 'Half Yearly',
            exam_kind: 'TERM',
            published: true,
            total_marks: 100,
            gpa: 0,
            grade: 'F',
            position: 30,
            is_fail: true,
          },
        ]),
      ),
    );

    renderPanel();

    await screen.findByText('Half Yearly');
    expect(screen.getByText('0.00')).toBeTruthy();
  });

  it('renders the empty state for a student with no results', async () => {
    server.use(http.get('/api/v1/students/:studentId/results', () => HttpResponse.json([])));

    renderPanel();

    expect(await screen.findByText('No results yet for this student.')).toBeTruthy();
  });

  const oneExam = () =>
    http.get('/api/v1/students/:studentId/results', () =>
      HttpResponse.json([
        {
          exam_id: 'exam-1',
          exam_name: 'First Term Exam',
          exam_kind: 'TERM',
          published: true,
          total_marks: 450,
          gpa: 5.0,
          grade: 'A+',
          position: 1,
          is_fail: false,
        },
      ]),
    );

  const finalsList = (status: string) => [
    {
      class: { id: STUDENT.class_section.class_id, name: 'Class 6' },
      final_result_id: 'final-1',
      status,
      published_at: null,
    },
  ];

  it('shows the published final result above the exam rows', async () => {
    server.use(oneExam());
    renderPanel(finalsList('PUBLISHED'), { 'year-1': { name: '2026' } });

    const final = await screen.findByTestId('student-final-result');
    expect(final.textContent).toContain('Final result 2026');
    expect(final.textContent).toContain('812');
    expect(final.textContent).toContain('4.50');
    expect(screen.queryByText('Not yet published')).toBeNull();
    // Final row sits before the exam table in the DOM.
    expect(
      final.compareDocumentPosition(screen.getByText('First Term Exam')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the unpublished warning when the final status lookup fails', async () => {
    server.use(oneExam());
    renderPanel([], { 'year-1': { name: '2026' } }, undefined, true);

    const final = await screen.findByTestId('student-final-result');
    expect(await within(final).findByText('Not yet published')).toBeTruthy();
  });

  it('shows no final row when the server has no final for the year', async () => {
    server.use(oneExam());
    renderPanel(finalsList('DRAFT'));

    await screen.findByText('First Term Exam');
    expect(screen.queryByTestId('student-final-result')).toBeNull();
  });

  it("a promoted student still sees last year's final", async () => {
    server.use(oneExam());
    renderPanel(finalsList('PUBLISHED'), { 'year-0': { name: '2025' } }, [
      enrollment('year-1', '2026-01-01T00:00:00Z'),
      enrollment('year-0', '2025-01-01T00:00:00Z'),
    ]);

    const final = await screen.findByTestId('student-final-result');
    expect(final.textContent).toContain('Final result 2025');
  });
});

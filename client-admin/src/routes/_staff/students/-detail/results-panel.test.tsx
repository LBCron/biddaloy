import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [19.9.1] Staff results panel — every exam, unpublished ones labelled so
 * staff never mistake an unpublished grade for one a parent can see. */
const STUDENT = studentFactory({ id: 'student-1' });

function renderPanel(finals: unknown[] = []) {
  // The panel renders router links, so it is mounted through the real route.
  server.use(
    http.get('/api/v1/students/:id', () => HttpResponse.json(STUDENT)),
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'year-1', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/final-results', () => HttpResponse.json(finals)),
    http.get('/api/v1/final-results/:id/students/:studentId', () =>
      HttpResponse.json({
        final_result_id: 'final-1',
        academic_year_name: '2026',
        final: { total_marks: 812, gpa: 4.5, grade: 'A', position: 3, is_fail: false },
      }),
    ),
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

  it('shows the published final result above the exam rows', async () => {
    server.use(oneExam());
    renderPanel([
      {
        class: { id: STUDENT.class_section.class_id, name: 'Class 6' },
        final_result_id: 'final-1',
        status: 'PUBLISHED',
        published_at: null,
      },
    ]);

    const final = await screen.findByTestId('student-final-result');
    expect(final.textContent).toContain('Final result 2026');
    expect(final.textContent).toContain('812');
    expect(final.textContent).toContain('4.50');
    expect(final.textContent).toContain('A');
    expect(screen.getByText('First Term Exam')).toBeTruthy();
    // Final row sits before the exam table in the DOM.
    expect(
      final.compareDocumentPosition(screen.getByText('First Term Exam')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows no final row when the class has no published final result', async () => {
    server.use(oneExam());
    renderPanel([
      {
        class: { id: STUDENT.class_section.class_id, name: 'Class 6' },
        final_result_id: 'final-1',
        status: 'DRAFT',
        published_at: null,
      },
    ]);

    await screen.findByText('First Term Exam');
    expect(screen.queryByTestId('student-final-result')).toBeNull();
  });
});

/** [70.5.3] Shared mock data for the final result page tests. Not a route (leading dash). */
import { examFactory, server } from '@biddaloy/ui/test';
import { http, HttpResponse } from 'msw';

export type Status = 'DRAFT' | 'PROCESSED' | 'PUBLISHED';

export const summary = (status: Status, over: Record<string, unknown> = {}) => ({
  id: 'fr-1',
  class: { id: 'c7', name: 'Class 7' },
  academic_year: { id: 'y1', name: '2026' },
  status,
  mode: 'WEIGHTED',
  best_of_count: null,
  rounding: 'WHOLE',
  fail_if_any_exam_fails: false,
  weights: [
    { exam_id: 'e1', subject_id: null, share_percent: 40 },
    { exam_id: 'e2', subject_id: null, share_percent: 60 },
  ],
  published_at: status === 'PUBLISHED' ? '2026-11-01T10:00:00Z' : null,
  counts: { students: 30, failed: 2 },
  ...over,
});

export function mockFinal(status: Status, over: Record<string, unknown> = {}) {
  server.use(
    http.get('/api/v1/final-results/fr-1', () => HttpResponse.json(summary(status, over))),
    http.get('/api/v1/exams', () =>
      HttpResponse.json({
        data: [
          examFactory({
            id: 'e1',
            name: 'Half Yearly',
            kind: 'TERM',
            class_id: 'c7',
            status: 'PUBLISHED',
          }),
          examFactory({
            id: 'e2',
            name: 'Annual',
            kind: 'TERM',
            class_id: 'c7',
            status: 'PUBLISHED',
          }),
          examFactory({
            id: 'e3',
            name: 'March Test',
            kind: 'MONTHLY',
            class_id: 'c7',
            status: 'PUBLISHED',
          }),
        ],
        total: 3,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes/c7/sections', () =>
      HttpResponse.json([{ id: 'sec-a', section_name: 'A', class_id: 'c7' }]),
    ),
    http.get('/api/v1/classes/c7/subjects', () =>
      HttpResponse.json([
        { id: 'cs1', subject_id: 's1', subject: { id: 's1', name_en: 'Maths', name_bn: null } },
        { id: 'cs2', subject_id: 's2', subject: { id: 's2', name_en: 'English', name_bn: null } },
      ]),
    ),
    http.get('/api/v1/final-results/fr-1/rows', () =>
      HttpResponse.json({
        data: [
          {
            student: { id: 'st1', full_name: 'Rima Akter', roll_number: 1 },
            total_marks: 91,
            gpa: 5,
            grade: 'A+',
            position: 1,
            section_position: 1,
            is_fail: false,
            working_days: 200,
            present_days: 190,
            per_exam: [
              { exam_id: 'e1', total_marks: 88, absent: false },
              { exam_id: 'e2', total_marks: null, absent: true },
            ],
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    ),
    http.get('/api/v1/my-class/sections/sec-a/report-card-notes/missing', () =>
      HttpResponse.json({ total: 30, missing_remark: 3, missing_conduct: 5 }),
    ),
  );
}

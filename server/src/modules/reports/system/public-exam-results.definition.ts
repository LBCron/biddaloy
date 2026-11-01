import { AggregateFn, ReportLayoutType, ReportSubjectArea } from '@biddaloy/shared';
import { FINANCE_AND_LEADERS, definitionFor, type SystemReportDef } from './definition-helpers';

/** [8.15.32] Public exam results, grouped by exam, with how many passed. */
export const publicExamResults: SystemReportDef = {
  key: 'public-exam-results',
  nameEn: 'Public exam results',
  nameBn: 'পাবলিক পরীক্ষার ফল',
  descriptionEn: 'For each public exam and year, how many students sat it and how many passed.',
  descriptionBn: 'প্রতিটি পাবলিক পরীক্ষা ও সালে কতজন অংশ নিয়েছে ও কতজন পাস করেছে।',
  folder: 'Exams',
  visibleRoles: FINANCE_AND_LEADERS,
  definition: definitionFor(
    ReportSubjectArea.PUBLIC_EXAMS,
    {
      parameters: [],
      dataset: {
        dimensions: [{ field: 'exam' }, { field: 'year' }],
        measures: [
          { field: 'exams', fn: AggregateFn.COUNT },
          { field: 'passed', fn: AggregateFn.COUNT },
          { field: 'average_gpa', fn: AggregateFn.AVG },
        ],
        filters: [],
        sort: [
          { field: 'exam', dir: 'asc' },
          { field: 'year', dir: 'desc' },
        ],
      },
      layout: { type: ReportLayoutType.GROUPED, group_by: ['exam'], subtotals: true, totals: true },
    },
    { en: 'Public exam results', bn: 'পাবলিক পরীক্ষার ফল' },
  ),
};

import type { TabSpec } from '../../codec/tab-spec';
import { examsTab } from './exams.tab';
import { examTemplatesTab } from './exam-templates.tab';
import { examTemplateComponentsTab } from './exam-template-components.tab';
import { examComponentsTab } from './exam-components.tab';
import { examSchedulesTab } from './exam-schedules.tab';
import { markGridsTab } from './mark-grids.tab';
import { marksTab } from './marks.tab';
import { resultsTab } from './results.tab';
import { resultSubjectsTab } from './result-subjects.tab';
import { studentSubjectChoicesTab } from './student-subject-choices.tab';
import {
  finalResultsTab,
  finalResultWeightsTab,
  finalResultRowsTab,
  finalResultSubjectsTab,
  reportCardNotesTab,
} from './final-results.tabs';
import { seatPlansTab } from './seat-plans.tab';
import { seatPlanSchedulesTab } from './seat-plan-schedules.tab';
import { seatAllocationsTab } from './seat-allocations.tab';

/**
 * Tabs owned by the exams lane (19.10.1, #906). Registered in dependency
 * order: `exams` first (depends on `academic_years`/`classes`), then
 * `exam_components` (depends on `exams`/`subjects`), then `mark_grids`
 * (depends on `exams`/`sections`/`subjects`), then `marks` (depends on all
 * of the above plus `students`), then `results` (depends on
 * `exams`/`students`/`grading_scales`), then `result_subjects` (depends on
 * `results`), and finally `student_subject_choices` (depends on
 * `students`/`class_subjects`, unrelated to the rest of this group but
 * placed last since nothing after it depends on it).
 *
 * `seat_plans`/`seat_plan_schedules`/`seat_allocations` (25.5, #1054) are
 * deliberately NOT in this array even though their tab files live in this
 * same directory. `seat_allocations` depends on `rooms`/`users`, both of
 * which are registered in barrels that come AFTER `examsTabs` in
 * `registry.ts`'s `ALL_TABS` — folding them into this array would put them
 * before their own dependencies and fail `assertRegistryValid`'s ordering
 * check. They are registered individually in `registry.ts` instead, the
 * same way `homeworkTab` and friends are (see that file's own comment
 * there), and only re-exported from here so this group's barrel still
 * names them.
 */
export const examsTabs: TabSpec<any, any>[] = [
  // [35.1.5] Templates have no dependencies, so they lead the group.
  examTemplatesTab,
  examTemplateComponentsTab,
  examsTab,
  examComponentsTab,
  examSchedulesTab,
  markGridsTab,
  marksTab,
  resultsTab,
  resultSubjectsTab,
  studentSubjectChoicesTab,
  // [70.6.01] After results and choices; they depend on exams, students, sections, users.
  finalResultsTab,
  finalResultWeightsTab,
  finalResultRowsTab,
  finalResultSubjectsTab,
  reportCardNotesTab,
];

export {
  examTemplatesTab,
  examTemplateComponentsTab,
  examsTab,
  examComponentsTab,
  examSchedulesTab,
  markGridsTab,
  marksTab,
  resultsTab,
  resultSubjectsTab,
  studentSubjectChoicesTab,
  finalResultsTab,
  finalResultWeightsTab,
  finalResultRowsTab,
  finalResultSubjectsTab,
  reportCardNotesTab,
  seatPlansTab,
  seatPlanSchedulesTab,
  seatAllocationsTab,
};
export type { ExamTemplateRow } from './exam-templates.tab';
export type { ExamTemplateComponentRow } from './exam-template-components.tab';
export type { ExamRow } from './exams.tab';
export type { ExamComponentRow } from './exam-components.tab';
export type { ExamScheduleRow } from './exam-schedules.tab';
export type { MarkGridRow } from './mark-grids.tab';
export type { MarkRow } from './marks.tab';
export type { ResultRow } from './results.tab';
export type { ResultSubjectRow } from './result-subjects.tab';
export type { StudentSubjectChoiceRow } from './student-subject-choices.tab';
export type { SeatPlanRow } from './seat-plans.tab';
export type { SeatPlanScheduleRow } from './seat-plan-schedules.tab';
export type { SeatAllocationRow } from './seat-allocations.tab';

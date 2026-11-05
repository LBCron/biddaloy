import { FinalResultMode, FinalResultRounding, FinalResultStatus } from '@biddaloy/shared';
import { FinalResult } from '../../../final-results/entities/final-result.entity';
import { FinalResultWeight } from '../../../final-results/entities/final-result-weight.entity';
import { FinalResultRow } from '../../../final-results/entities/final-result-row.entity';
import { FinalResultSubject } from '../../../final-results/entities/final-result-subject.entity';
import { ReportCardNote } from '../../../report-card-notes/entities/report-card-note.entity';
import { createRefChildTab } from '../people/ref-child-tab.factory';
import { academicYearsTab } from '../academics/academic-years.tab';
import { classesTab } from '../academics/classes.tab';
import { sectionsTab } from '../academics/sections.tab';
import { subjectsTab } from '../academics/subjects.tab';
import { gradingScalesTab } from '../grading/grading-scales.tab';
import { studentsTab } from '../people/students.tab';
import { usersTab } from '../people/users.tab';
import { examsTab } from './exams.tab';

/**
 * [70.6.01] Epic 70's five tables. Built with `createRefChildTab`.
 *
 * Restore rules (see `codec/insert-only-tabs.ts`): `final_results`,
 * `final_result_rows` and `final_result_subjects` are add-only, like `results`
 * (a restore never changes a computed or published card). Weights and notes
 * are replaced by their unique keys.
 */
const L = (en: string, bn: string) => ({ en, bn });

export const finalResultsTab = createRefChildTab<FinalResult>({
  name: 'final_results',
  entityClass: FinalResult,
  refs: [
    { key: 'class', fk: 'class_id', tab: classesTab, label: L('Class', 'শ্রেণী') },
    {
      key: 'academic_year',
      fk: 'academic_year_id',
      tab: academicYearsTab,
      label: L('Academic year', 'শিক্ষাবর্ষ'),
    },
  ],
  fields: [
    {
      key: 'status',
      type: 'enum',
      enumValues: Object.values(FinalResultStatus),
      required: true,
      label: L('Status', 'অবস্থা'),
    },
    {
      key: 'mode',
      type: 'enum',
      enumValues: Object.values(FinalResultMode),
      required: true,
      label: L('Mode', 'পদ্ধতি'),
    },
    { key: 'best_of_count', type: 'int', label: L('Best of', 'সেরা কয়টি') },
    {
      key: 'rounding',
      type: 'enum',
      enumValues: Object.values(FinalResultRounding),
      required: true,
      label: L('Rounding', 'রাউন্ডিং'),
    },
    {
      key: 'fail_if_any_exam_fails',
      type: 'bool',
      required: true,
      label: L('Fail if any exam fails', 'কোনো পরীক্ষায় ফেল করলে ফেল'),
    },
    { key: 'published_at', type: 'datetime', label: L('Published at', 'প্রকাশের সময়') },
  ],
  naturalKey: ['class', 'academic_year'],
});

export const finalResultWeightsTab = createRefChildTab<FinalResultWeight>({
  name: 'final_result_weights',
  entityClass: FinalResultWeight,
  refs: [
    {
      key: 'final_result',
      fk: 'final_result_id',
      tab: finalResultsTab,
      label: L('Final result', 'চূড়ান্ত ফলাফল'),
    },
    { key: 'exam', fk: 'exam_id', tab: examsTab, label: L('Exam', 'পরীক্ষা') },
    // Blank = the share covers the whole exam (D7).
    {
      key: 'subject',
      fk: 'subject_id',
      tab: subjectsTab,
      label: L('Subject', 'বিষয়'),
      optional: true,
    },
  ],
  fields: [
    {
      key: 'share_percent',
      type: 'money',
      required: true,
      label: L('Share percent', 'অংশ শতাংশ'),
    },
  ],
  naturalKey: ['final_result', 'exam', 'subject'],
});

export const finalResultRowsTab = createRefChildTab<FinalResultRow>({
  name: 'final_result_rows',
  entityClass: FinalResultRow,
  refs: [
    {
      key: 'final_result',
      fk: 'final_result_id',
      tab: finalResultsTab,
      label: L('Final result', 'চূড়ান্ত ফলাফল'),
    },
    { key: 'student', fk: 'student_id', tab: studentsTab, label: L('Student', 'শিক্ষার্থী') },
    {
      key: 'section',
      fk: 'section_id',
      tab: sectionsTab,
      label: L('Section', 'শাখা'),
      optional: true,
    },
    {
      // D19 pin: exported and restored exactly, never re-derived.
      key: 'grading_scale',
      fk: 'grading_scale_id',
      tab: gradingScalesTab,
      label: L('Grading scale', 'গ্রেডিং স্কেল'),
    },
  ],
  fields: [
    { key: 'total_marks', type: 'money', required: true, label: L('Total marks', 'মোট নম্বর') },
    { key: 'gpa', type: 'money', required: true, label: L('GPA', 'জিপিএ') },
    { key: 'grade', type: 'string', required: true, label: L('Grade', 'গ্রেড') },
    { key: 'position', type: 'int', label: L('Position', 'অবস্থান') },
    { key: 'section_position', type: 'int', label: L('Section position', 'শাখায় অবস্থান') },
    { key: 'is_fail', type: 'bool', required: true, label: L('Failed', 'ফেল') },
    {
      key: 'grading_scale_revision',
      type: 'int',
      required: true,
      label: L('Scale revision', 'স্কেল সংশোধন'),
    },
    {
      key: 'rule_version',
      type: 'string',
      required: true,
      label: L('Rule version', 'নিয়ম সংস্করণ'),
    },
    { key: 'computed_at', type: 'datetime', required: true, label: L('Computed at', 'গণনার সময়') },
    { key: 'published_at', type: 'datetime', label: L('Published at', 'প্রকাশের সময়') },
    { key: 'working_days', type: 'int', label: L('Working days', 'কার্যদিবস') },
    { key: 'present_days', type: 'int', label: L('Present days', 'উপস্থিত দিন') },
  ],
  naturalKey: ['final_result', 'student'],
});

export const finalResultSubjectsTab = createRefChildTab<FinalResultSubject>({
  name: 'final_result_subjects',
  entityClass: FinalResultSubject,
  refs: [
    {
      key: 'final_result_row',
      fk: 'final_result_row_id',
      tab: finalResultRowsTab,
      label: L('Final result row', 'চূড়ান্ত ফলাফলের সারি'),
    },
    { key: 'subject', fk: 'subject_id', tab: subjectsTab, label: L('Subject', 'বিষয়') },
  ],
  fields: [
    { key: 'obtained', type: 'money', required: true, label: L('Obtained', 'প্রাপ্ত নম্বর') },
    { key: 'grade', type: 'string', required: true, label: L('Grade', 'গ্রেড') },
    { key: 'gpa', type: 'money', required: true, label: L('GPA', 'জিপিএ') },
    { key: 'is_fail', type: 'bool', required: true, label: L('Failed', 'ফেল') },
    {
      key: 'is_fourth_subject',
      type: 'bool',
      required: true,
      label: L('Fourth subject', 'চতুর্থ বিষয়'),
    },
  ],
  naturalKey: ['final_result_row', 'subject'],
});

export const reportCardNotesTab = createRefChildTab<ReportCardNote>({
  name: 'report_card_notes',
  entityClass: ReportCardNote,
  refs: [
    { key: 'student', fk: 'student_id', tab: studentsTab, label: L('Student', 'শিক্ষার্থী') },
    // Exactly one of exam / final_result is set (DB CHECK).
    { key: 'exam', fk: 'exam_id', tab: examsTab, label: L('Exam', 'পরীক্ষা'), optional: true },
    {
      key: 'final_result',
      fk: 'final_result_id',
      tab: finalResultsTab,
      label: L('Final result', 'চূড়ান্ত ফলাফল'),
      optional: true,
    },
    // A departed author exports blank and restores as null (the FK is SET NULL anyway).
    {
      key: 'updated_by',
      fk: 'updated_by_user_id',
      tab: usersTab,
      label: L('Updated by', 'সর্বশেষ সম্পাদনা'),
      optional: true,
    },
  ],
  fields: [
    { key: 'remark', type: 'string', label: L('Remark', 'মন্তব্য') },
    { key: 'conduct', type: 'json', required: true, label: L('Conduct', 'আচরণ') },
  ],
  naturalKey: ['student', 'exam', 'final_result'],
  checkRow: (r) =>
    (r.exam_id ? 1 : 0) + (r.final_result_id ? 1 : 0) === 1
      ? null
      : { column: 'exam', message: 'Set exactly one of "exam" and "final_result".' },
});

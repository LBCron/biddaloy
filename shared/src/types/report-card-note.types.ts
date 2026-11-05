import type { ConductGrade } from '../enums/exams';

/** One conduct line on a report card (tenant-configurable, D30). */
export interface ConductItem {
  key: string;
  name_bn: string;
  name_en: string;
}

export const DEFAULT_CONDUCT_ITEMS: ConductItem[] = [
  { key: 'discipline', name_bn: 'শৃঙ্খলা', name_en: 'Discipline' },
  { key: 'neatness', name_bn: 'পরিচ্ছন্নতা', name_en: 'Neatness' },
  { key: 'punctuality', name_bn: 'সময়ানুবর্তিতা', name_en: 'Punctuality' },
  { key: 'sports', name_bn: 'খেলাধুলা ও সহশিক্ষা', name_en: 'Sports & co-curricular' },
];

export interface ReportCardNoteView {
  student_id: string;
  remark: string | null;
  /** conduct item key → grade */
  conduct: Record<string, ConductGrade>;
}

export interface SaveReportCardNotesDto {
  target: { exam_id: string } | { final_result_id: string };
  notes: ReportCardNoteView[];
}

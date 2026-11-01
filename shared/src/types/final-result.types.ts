import type {
  ConductGrade,
  FinalResultMode,
  FinalResultRounding,
  FinalResultStatus,
} from '../enums/exams';

export interface FinalResultWeight {
  exam_id: string;
  /** null = the share applies to the whole exam, else one subject only */
  subject_id: string | null;
  share_percent: number;
}

export interface FinalResultSummary {
  id: string;
  class: { id: string; name: string };
  academic_year: { id: string; name: string };
  status: FinalResultStatus;
  mode: FinalResultMode;
  best_of_count: number | null;
  rounding: FinalResultRounding;
  fail_if_any_exam_fails: boolean;
  weights: FinalResultWeight[];
  published_at: string | null;
  counts: { students: number; failed: number };
}

export interface FinalResultRowView {
  student: { id: string; full_name: string; roll_number: number };
  total_marks: number;
  gpa: number;
  grade: string;
  position: number | null;
  section_position: number | null;
  is_fail: boolean;
  working_days: number | null;
  present_days: number | null;
  per_exam: Array<{ exam_id: string; total_marks: number | null; absent: boolean }>;
}

/** Report card for the final result: the final column plus one column per exam. */
export interface FinalResultStudentCard {
  final_result_id: string;
  academic_year_name: string;
  student: { full_name: string; roll_number: number };
  final: {
    total_marks: number;
    gpa: number;
    grade: string;
    position: number | null;
    is_fail: boolean;
  };
  exams: Array<{
    exam_id: string;
    exam_name: string;
    total_marks: number | null;
    gpa: number | null;
  }>;
  subjects: Array<{
    subject_name: string;
    obtained: number;
    grade: string;
    gpa: number;
    is_fail: boolean;
    is_fourth_subject: boolean;
    per_exam: Array<{ exam_id: string; obtained: number | null }>;
  }>;
  legend: Array<{ grade: string; gpa: number | null; comment: string | null }>;
  attendance: { working_days: number | null; present_days: number | null };
  remark: string | null;
  conduct: Array<{ key: string; name_bn: string; name_en: string; grade: ConductGrade | null }>;
  /** Same snapshot the exam report card carries (`buildIssuerSnapshot`). */
  issuer: Record<string, unknown>;
  logo_url: string | null;
}

export interface CreateFinalResultDto {
  class_id: string;
  academic_year_id: string;
  mode: FinalResultMode;
  best_of_count?: number | null;
  rounding?: FinalResultRounding;
  fail_if_any_exam_fails?: boolean;
  weights: FinalResultWeight[];
}

export type UpdateFinalResultDto = Partial<
  Omit<CreateFinalResultDto, 'class_id' | 'academic_year_id'>
>;

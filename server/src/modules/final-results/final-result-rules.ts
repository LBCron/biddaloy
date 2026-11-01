import { FinalResultMode, FinalResultRounding } from '@biddaloy/shared';
import { toPaisa } from '../../common/constants/money';
import { roundHalfUp2, type SubjectTotal } from '../exams/result-rules';

/**
 * [70.1.3] Pure rules for a cross-exam final result (Epic 70). No DB, no Nest.
 *
 * Input: each student's per-exam subject marks plus the final's settings.
 * Output: one `SubjectTotal` per subject, the shape `result-rules.ts`
 * `gradeSubjectTotal` takes, so the caller finishes with the existing
 * `combineSubjects` and `rankByMerit` (`result-rules.ts` is untouched, D31).
 *
 * Every exam is first turned into a percentage of its own full marks, so exams
 * with different full marks mix fairly. The combined percentage is then scaled
 * back to the subject's LARGEST full marks (`obtained = percent / 100 * max full`),
 * which keeps `obtained` readable on a card: 80% of a 100-mark subject is 80.
 */

/** Rule version stored on `final_result_rows.rule_version`. */
export const FINAL_RULE_VERSION = 'final-1';

export interface FinalWeight {
  exam_id: string;
  /** null = the share applies to the whole exam; set = override for that subject only */
  subject_id: string | null;
  /** 0-100, 2 decimals. A string when it comes straight off the `numeric(5,2)` column. */
  share_percent: number | string;
}

export interface FinalSettings {
  mode: FinalResultMode;
  best_of_count: number | null;
  rounding: FinalResultRounding;
  fail_if_any_exam_fails: boolean;
  weights: FinalWeight[];
}

export interface ExamSubjectMark {
  exam_id: string;
  subject_id: string;
  /** null = absent: counts as 0 for its share (D2), whatever `full_marks` says. */
  obtained: number | null;
  /** 0 with `obtained` set = every component EXEMPT: the exam did not have the
   * subject for this student, so it drops out like D22. */
  full_marks: number;
  is_fail: boolean;
}

export interface CombinedSubject {
  obtained: number;
  full_marks: number;
  /** True when the fail-if-any-exam-fails switch is on and any exam failed this subject. */
  is_fail_from_exam: boolean;
  /** 0-100, from the rounded `obtained` (as `computeSubjectTotal` does), so the grade
   * matches the mark the card prints. */
  percent: number;
  is_absent: boolean;
}

/** The configured shares for one subject do not add up to 100. */
export class SharesNotHundred extends Error {
  constructor(
    readonly subject_id: string,
    readonly total: number,
  ) {
    super('The shares for this subject must add up to 100.');
    this.name = 'SharesNotHundred';
  }
}

/**
 * Share (summing to 100) of each exam that contains the subject.
 *
 * - Rows for this subject win over the exam-level default rows (D6d), all or none.
 * - No rows at all = equal shares.
 * - The configured rows must sum to 100 first, else `SharesNotHundred`.
 * - Then exams that do not contain the subject drop out and the rest are
 *   renormalised to 100 (D22).
 */
export function effectiveShares(
  settings: FinalSettings,
  subjectId: string,
  examIdsWithSubject: string[],
): Map<string, number> {
  const own = settings.weights.filter((w) => w.subject_id === subjectId);
  const rows = own.length > 0 ? own : settings.weights.filter((w) => w.subject_id === null);

  const shares = new Map<string, number>();
  if (rows.length === 0) {
    for (const id of examIdsWithSubject) shares.set(id, 100 / examIdsWithSubject.length);
    return shares;
  }

  // Shares are numeric(5,2): add them in whole hundredths, exactly, never with a
  // float tolerance (Rule 26's toPaisa). Number() also takes the column's string.
  const configured = rows.reduce((sum, r) => sum + toPaisa(r.share_percent), 0);
  if (configured !== 10_000) throw new SharesNotHundred(subjectId, configured / 100);

  const kept = rows.filter((r) => examIdsWithSubject.includes(r.exam_id));
  const keptSum = kept.reduce((sum, r) => sum + toPaisa(r.share_percent), 0);
  if (keptSum === 0) {
    // The subject sits in no weighted exam: fall back to equal rather than divide by zero.
    for (const id of examIdsWithSubject) shares.set(id, 100 / examIdsWithSubject.length);
    return shares;
  }
  for (const r of kept) shares.set(r.exam_id, (toPaisa(r.share_percent) / keptSum) * 100);
  return shares;
}

const percentOf = (m: ExamSubjectMark): number =>
  // Absent counts as 0 (D2) and a zero-mark paper cannot divide.
  m.obtained === null || m.full_marks <= 0 ? 0 : (m.obtained / m.full_marks) * 100;

/** One subject's marks across exams -> one combined subject. `marks` is for a single subject. */
export function combineSubject(marks: ExamSubjectMark[], settings: FinalSettings): CombinedSubject {
  const is_fail_from_exam = settings.fail_if_any_exam_fails && marks.some((m) => m.is_fail);
  // An all-EXEMPT paper (full 0, not absent) leaves the subject, as `computeSubjectTotal`
  // drops EXEMPT: the other exams renormalise (D22). Absent stays and counts 0 (D2).
  const counted = marks.filter((m) => m.obtained === null || m.full_marks > 0);
  if (counted.length === 0) {
    // Nothing to grade: full_marks 0 is graded '-' by `gradeSubjectTotal`.
    return { obtained: 0, full_marks: 0, percent: 0, is_absent: false, is_fail_from_exam };
  }
  const percents = counted.map(percentOf);

  let percent: number;
  if (settings.mode === FinalResultMode.BEST_OF) {
    // Best N by percentage, equal mean (D23). N missing or too big = use all.
    // At least 1 (the DB CHECK says so too), so the mean never divides by zero.
    const n = Math.max(1, Math.min(settings.best_of_count ?? counted.length, counted.length));
    const best = [...percents].sort((a, b) => b - a).slice(0, n);
    percent = best.reduce((s, p) => s + p, 0) / best.length;
  } else {
    const shares = effectiveShares(
      settings,
      counted[0].subject_id,
      counted.map((m) => m.exam_id),
    );
    percent = counted.reduce(
      (s, m, i) => s + ((shares.get(m.exam_id) ?? 0) / 100) * percents[i],
      0,
    );
  }

  const full_marks = Math.max(...counted.map((m) => m.full_marks));
  const scaled = Math.min((percent / 100) * full_marks, full_marks);
  const obtained =
    settings.rounding === FinalResultRounding.WHOLE
      ? Math.round(roundHalfUp2(scaled))
      : roundHalfUp2(scaled);

  return {
    obtained,
    full_marks,
    // From the rounded mark: 39.55 of 50 rounds to 40, so it grades as 80%, not 79.1%.
    percent: full_marks > 0 ? (obtained / full_marks) * 100 : 0,
    is_absent: counted.every((m) => m.obtained === null),
    is_fail_from_exam,
  };
}

/**
 * All of one student's marks -> one `SubjectTotal` per subject (union of the subjects
 * across exams, D26), ready for `gradeSubjectTotal`. `component_failed` carries the
 * fail-if-any-exam-fails switch.
 */
export function combineStudent(
  allMarks: ExamSubjectMark[],
  settings: FinalSettings,
): Array<SubjectTotal & { subject_id: string }> {
  const bySubject = new Map<string, ExamSubjectMark[]>();
  for (const m of allMarks)
    bySubject.set(m.subject_id, [...(bySubject.get(m.subject_id) ?? []), m]);

  return [...bySubject.entries()].map(([subject_id, marks]) => {
    const c = combineSubject(marks, settings);
    return {
      subject_id,
      obtained: c.obtained,
      full_marks: c.full_marks,
      percent: c.percent,
      is_absent: c.is_absent,
      component_failed: c.is_fail_from_exam,
    };
  });
}

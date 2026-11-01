import { FinalResultMode, FinalResultRounding } from '@biddaloy/shared';
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
  share_percent: number;
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
  /** null = absent */
  obtained: number | null;
  full_marks: number;
  is_fail: boolean;
}

export interface CombinedSubject {
  obtained: number;
  full_marks: number;
  /** True when the fail-if-any-exam-fails switch is on and any exam failed this subject. */
  is_fail_from_exam: boolean;
  /** 0-100, unrounded. */
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

const SUM_TOLERANCE = 0.005;

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

  const configured = rows.reduce((sum, r) => sum + r.share_percent, 0);
  if (Math.abs(configured - 100) > SUM_TOLERANCE) throw new SharesNotHundred(subjectId, configured);

  const kept = rows.filter((r) => examIdsWithSubject.includes(r.exam_id));
  const keptSum = kept.reduce((sum, r) => sum + r.share_percent, 0);
  if (keptSum === 0) {
    // The subject sits in no weighted exam: fall back to equal rather than divide by zero.
    for (const id of examIdsWithSubject) shares.set(id, 100 / examIdsWithSubject.length);
    return shares;
  }
  for (const r of kept) shares.set(r.exam_id, (r.share_percent / keptSum) * 100);
  return shares;
}

const percentOf = (m: ExamSubjectMark): number =>
  // Absent counts as 0 (D2) and a zero-mark paper cannot divide.
  m.obtained === null || m.full_marks <= 0 ? 0 : (m.obtained / m.full_marks) * 100;

/** One subject's marks across exams -> one combined subject. `marks` is for a single subject. */
export function combineSubject(marks: ExamSubjectMark[], settings: FinalSettings): CombinedSubject {
  const percents = marks.map(percentOf);

  let percent: number;
  if (settings.mode === FinalResultMode.BEST_OF) {
    // Best N by percentage, equal mean (D23). N missing or too big = use all.
    const n = Math.min(settings.best_of_count ?? marks.length, marks.length);
    const best = [...percents].sort((a, b) => b - a).slice(0, n);
    percent = best.reduce((s, p) => s + p, 0) / best.length;
  } else {
    const shares = effectiveShares(
      settings,
      marks[0].subject_id,
      marks.map((m) => m.exam_id),
    );
    percent = marks.reduce((s, m, i) => s + ((shares.get(m.exam_id) ?? 0) / 100) * percents[i], 0);
  }

  const full_marks = Math.max(...marks.map((m) => m.full_marks));
  const scaled = Math.min((percent / 100) * full_marks, full_marks);
  const obtained =
    settings.rounding === FinalResultRounding.WHOLE
      ? Math.round(roundHalfUp2(scaled))
      : roundHalfUp2(scaled);

  return {
    obtained,
    full_marks,
    percent,
    is_absent: marks.every((m) => m.obtained === null),
    is_fail_from_exam: settings.fail_if_any_exam_fails && marks.some((m) => m.is_fail),
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

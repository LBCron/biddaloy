/**
 * Epic 19.0 exam/marks/result enums. Const-object + type pattern (not TS
 * `enum`), matching `entity-label.ts`.
 */

/** What kind of exam this is (19.2.1's `Exam` entity). */
export const ExamKind = {
  TERM: 'TERM',
  MONTHLY: 'MONTHLY',
  MODEL: 'MODEL',
  OTHER: 'OTHER',
} as const;
export type ExamKind = (typeof ExamKind)[keyof typeof ExamKind];

/**
 * An exam's lifecycle state (D12). DRAFT → PROCESSED → PUBLISHED.
 * Reopening a PUBLISHED exam back to PROCESSED requires `@RequireApproval`
 * plus an audit record (19.5.1) — this enum only names the states.
 */
export const ExamStatus = {
  DRAFT: 'DRAFT',
  PROCESSED: 'PROCESSED',
  PUBLISHED: 'PUBLISHED',
} as const;
export type ExamStatus = (typeof ExamStatus)[keyof typeof ExamStatus];

/** What an `ExamComponent` measures (19.2.1). */
export const ExamComponentKind = {
  WRITTEN: 'WRITTEN',
  MCQ: 'MCQ',
  VIVA: 'VIVA',
  LAB: 'LAB',
  PRACTICAL: 'PRACTICAL',
  MONTHLY_TEST: 'MONTHLY_TEST',
  // [19.3.1] D11 — read-only, computed from AttendanceRecord.
  ATTENDANCE: 'ATTENDANCE',
  OTHER: 'OTHER',
} as const;
export type ExamComponentKind = (typeof ExamComponentKind)[keyof typeof ExamComponentKind];

/**
 * Where an `ExamComponent`'s marks come from. MANUAL is entered on the
 * marks grid; DERIVED is computed by the server (currently only the
 * ATTENDANCE component kind, D11) and never accepts direct entry.
 */
export const ExamComponentSource = {
  MANUAL: 'MANUAL',
  DERIVED: 'DERIVED',
} as const;
export type ExamComponentSource = (typeof ExamComponentSource)[keyof typeof ExamComponentSource];

/** A student's presence status for one exam component's mark. */
export const MarkStatus = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  EXEMPT: 'EXEMPT',
} as const;
export type MarkStatus = (typeof MarkStatus)[keyof typeof MarkStatus];

/**
 * D12 — per section-subject marks-entry grid state. DRAFT is editable;
 * SUBMITTED locks entry (subject to the exam's own ExamStatus).
 */
export const MarkGridState = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
} as const;
export type MarkGridState = (typeof MarkGridState)[keyof typeof MarkGridState];

/** What a `PromotionRun` decides for one student (26.x). */
export const PromotionOutcome = {
  PROMOTE: 'PROMOTE',
  RETAIN: 'RETAIN',
  GRADUATE: 'GRADUATE',
  /**
   * Promoted with a stated condition (override note). Never suggested by the
   * algorithm; moves the student up like PROMOTE (SENSE-13).
   */
  CONDITIONAL: 'CONDITIONAL',
} as const;
export type PromotionOutcome = (typeof PromotionOutcome)[keyof typeof PromotionOutcome];

/**
 * A `PromotionRun`'s lifecycle state (26.x). DRAFT is editable/re-runnable;
 * COMMITTED has moved students and is final.
 */
export const PromotionRunStatus = {
  DRAFT: 'DRAFT',
  COMMITTED: 'COMMITTED',
} as const;
export type PromotionRunStatus = (typeof PromotionRunStatus)[keyof typeof PromotionRunStatus];

/** How a `PromotionRun` places promoted students into next-year sections. */
export const PlacementAlgorithm = {
  BLOCK: 'BLOCK',
  SNAKE: 'SNAKE',
} as const;
export type PlacementAlgorithm = (typeof PlacementAlgorithm)[keyof typeof PlacementAlgorithm];

/** A cross-exam final result's lifecycle (70.1.1). Same three states as `ExamStatus`. */
export const FinalResultStatus = {
  DRAFT: 'DRAFT',
  PROCESSED: 'PROCESSED',
  PUBLISHED: 'PUBLISHED',
} as const;
export type FinalResultStatus = (typeof FinalResultStatus)[keyof typeof FinalResultStatus];

/** How a final result combines exams: weighted shares, or best N exams. */
export const FinalResultMode = {
  WEIGHTED: 'WEIGHTED',
  BEST_OF: 'BEST_OF',
} as const;
export type FinalResultMode = (typeof FinalResultMode)[keyof typeof FinalResultMode];

/** Rounding applied to a final subject/total mark. */
export const FinalResultRounding = {
  WHOLE: 'WHOLE',
  TWO_DECIMALS: 'TWO_DECIMALS',
} as const;
export type FinalResultRounding = (typeof FinalResultRounding)[keyof typeof FinalResultRounding];

/** Letter grade for one conduct item on a report card. */
export const ConductGrade = { A: 'A', B: 'B', C: 'C', D: 'D' } as const;
export type ConductGrade = (typeof ConductGrade)[keyof typeof ConductGrade];

/**
 * D13: a restore may add these rows but never change or remove one.
 * Corrections go through the app, where locks, approvals and per-row audit apply.
 * Grading scales, bands and exam components are here too: they decide a
 * result's grade and pass/fail, so changing them by restore would skip the
 * app's D16 refusal, approval and recompute (review r1 #2).
 */
export const INSERT_ONLY_TABS: ReadonlySet<string> = new Set([
  'payments',
  'payment_allocations',
  'student_fees',
  'invoices',
  'exams',
  'marks',
  'mark_grids',
  'results',
  'result_subjects',
  // [70.6.01] computed and published cards: add, never change.
  'final_results',
  'final_result_rows',
  'final_result_subjects',
  'exam_components',
  'grading_scales',
  'grading_bands',
]);

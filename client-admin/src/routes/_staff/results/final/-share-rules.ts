/**
 * [70.5.3] Pure share helpers for the Setup tab. The server (`final-result-rules.ts`
 * `effectiveShares`) stays the judge; this only previews the same rule and builds the
 * `weights` body, so no request is needed to show "how each subject is counted" (D22).
 */
import type { FinalResultWeightDto } from '@biddaloy/shared';

/** Whole hundredths, never float tolerance (Rule 26). */
const hundredths = (v: number): number => Math.round(v * 100);

/** Equal shares that add to exactly 100: the last exam takes the rounding leftover. */
export function equalShares(n: number): number[] {
  if (n <= 0) return [];
  const each = Math.floor(10_000 / n) / 100;
  const out = Array.from({ length: n }, () => each);
  out[n - 1] = (10_000 - hundredths(each) * (n - 1)) / 100;
  return out;
}

export function sumShares(values: Array<number | undefined>): number {
  return values.reduce<number>((s, v) => s + hundredths(v ?? 0), 0) / 100;
}

export interface WeightsInput {
  examIds: string[];
  /** Whole-exam share by exam id. */
  shares: Record<string, number | undefined>;
  /** Per-subject overrides, subject id -> exam id -> share. Empty = off. */
  subjectShares: Record<string, Record<string, number | undefined>>;
  /** Best-of ignores shares: send equal ones so the stored set stays valid. */
  bestOf: boolean;
}

export function buildWeights({
  examIds,
  shares,
  subjectShares,
  bestOf,
}: WeightsInput): FinalResultWeightDto[] {
  const eq = equalShares(examIds.length);
  const whole = examIds.map((exam_id, i) => ({
    exam_id,
    subject_id: null,
    share_percent: bestOf ? (eq[i] ?? 0) : (shares[exam_id] ?? 0),
  }));
  if (bestOf) return whole;
  const own = Object.entries(subjectShares).flatMap(([subject_id, row]) =>
    examIds.map((exam_id) => ({ exam_id, subject_id, share_percent: row[exam_id] ?? 0 })),
  );
  return [...whole, ...own];
}

/** What one subject uses: its own rows when it has any, else the whole-exam rows. */
export function previewShares(
  weights: FinalResultWeightDto[],
  examIds: string[],
  subjectId: string,
): Record<string, number> {
  const own = weights.filter((w) => w.subject_id === subjectId);
  const rows = own.length > 0 ? own : weights.filter((w) => w.subject_id === null);
  if (rows.length === 0) {
    const eq = equalShares(examIds.length);
    return Object.fromEntries(examIds.map((id, i) => [id, eq[i] ?? 0]));
  }
  return Object.fromEntries(
    examIds.map((id) => [id, rows.find((r) => r.exam_id === id)?.share_percent ?? 0]),
  );
}

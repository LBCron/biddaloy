import { UserRole } from '@biddaloy/shared';

/** D14: a COMMITTEE member never sees a count below this (0 to 4 are hidden). */
export const SMALL_CELL_THRESHOLD = 5;

/** The roles the small-cell rule applies to. Everyone else sees true counts. */
export function smallCellRuleApplies(role: string): boolean {
  return role === UserRole.COMMITTEE;
}

/** `count` as shown to `role`: the number, or `null` when the rule hides it. */
export function visibleCount(count: number, role: string): number | null {
  return smallCellRuleApplies(role) && count < SMALL_CELL_THRESHOLD ? null : count;
}

/**
 * Hides small counts in report rows (D14). Cells are hidden, not totals: a total is computed
 * from the true counts by the caller and left alone. Each row that lost a cell gets
 * `suppressed: true` so the screen can show "—" with a tooltip instead of 0.
 */
export function suppressSmallCells<T extends Record<string, unknown>>(
  rows: readonly T[],
  countKeys: readonly string[],
  role: string,
): Array<T & { suppressed: boolean }> {
  return rows.map((row) => {
    let suppressed = false;
    const next: Record<string, unknown> = { ...row };
    if (smallCellRuleApplies(role)) {
      for (const key of countKeys) {
        const value = row[key];
        if (typeof value === 'number' && value < SMALL_CELL_THRESHOLD) {
          next[key] = null;
          suppressed = true;
        }
      }
    }
    return { ...(next as T), suppressed };
  });
}

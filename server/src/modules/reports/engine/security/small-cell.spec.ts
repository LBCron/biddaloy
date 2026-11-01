import { describe, expect, it } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { SMALL_CELL_THRESHOLD, suppressSmallCells, visibleCount } from './small-cell';

describe('small-cell rule (D14)', () => {
  it('hides a count of 4 from COMMITTEE', () => {
    expect(visibleCount(4, UserRole.COMMITTEE)).toBeNull();
  });

  it('shows a count of 5 to COMMITTEE', () => {
    expect(SMALL_CELL_THRESHOLD).toBe(5);
    expect(visibleCount(5, UserRole.COMMITTEE)).toBe(5);
  });

  it('hides 0 as well: "under 5" includes none', () => {
    expect(visibleCount(0, UserRole.COMMITTEE)).toBeNull();
  });

  it.each([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER])(
    'leaves %s untouched',
    (role) => {
      expect(visibleCount(1, role)).toBe(1);
      const rows = [{ class_name: 'Six', count: 2 }];
      expect(suppressSmallCells(rows, ['count'], role)).toEqual([
        { class_name: 'Six', count: 2, suppressed: false },
      ]);
    },
  );

  it('nulls only the small cells of a COMMITTEE row and flags the row', () => {
    const rows = [
      { class_name: 'Six', students: 40, girls: 3 },
      { class_name: 'Seven', students: 38, girls: 21 },
    ];
    expect(suppressSmallCells(rows, ['students', 'girls'], UserRole.COMMITTEE)).toEqual([
      { class_name: 'Six', students: 40, girls: null, suppressed: true },
      { class_name: 'Seven', students: 38, girls: 21, suppressed: false },
    ]);
  });

  it('does not change the rows it was given', () => {
    const rows = [{ count: 1 }];
    suppressSmallCells(rows, ['count'], UserRole.COMMITTEE);
    expect(rows).toEqual([{ count: 1 }]);
  });
});

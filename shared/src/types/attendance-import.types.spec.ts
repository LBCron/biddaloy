import { describe, expect, it } from 'vitest';

import { AttendanceStatus, DailyAttendanceSource, DailyRegisterWriteReason } from '../enums';
import { ATTENDANCE_SHEET_STATUS_CODES } from './attendance-import.types';

describe('attendance import types', () => {
  it('has codes for every status, no code shared across statuses', () => {
    const all = Object.values(ATTENDANCE_SHEET_STATUS_CODES)
      .flat()
      .map((c) => c.toLowerCase());
    expect(Object.keys(ATTENDANCE_SHEET_STATUS_CODES).sort()).toEqual(
      Object.values(AttendanceStatus).sort(),
    );
    expect(new Set(all).size).toBe(all.length);
  });
  it('exports the enums', () => {
    expect(Object.values(DailyAttendanceSource)).toHaveLength(4);
    expect(Object.values(DailyRegisterWriteReason)).toHaveLength(3);
  });
});

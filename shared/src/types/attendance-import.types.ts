import type { AttendanceStatus } from '../enums';

/** Fixed sheet codes, matched case-insensitively (D6). Blank = unchanged. */
export const ATTENDANCE_SHEET_STATUS_CODES = {
  PRESENT: ['P', 'উ'],
  ABSENT: ['A', 'অ'],
  LATE: ['L', 'দে'],
  LEAVE: ['LV', 'ছু'],
} as const satisfies Record<AttendanceStatus, readonly string[]>;

export const ATTENDANCE_SHEET_MAX_ROWS = 2000;
export const ATTENDANCE_SHEET_MAX_BYTES = 5 * 1024 * 1024;
export const ATTENDANCE_SHEET_MAX_SECTIONS = 10;

export type AttendanceImportRowOutcome = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'ERROR';

export type AttendanceImportRowCode =
  | 'ROLL_NOT_IN_SECTION'
  | 'SECTION_NOT_FOUND'
  | 'NOT_ALLOWED_SECTION'
  | 'DATE_OUTSIDE_YEAR'
  | 'NON_WORKING_DAY'
  | 'FUTURE_DATE'
  | 'NEEDS_CORRECT_PERMISSION'
  | 'BAD_STATUS'
  | 'DUPLICATE_ROW'
  | 'NAME_MISMATCH';

/** One entry of `attendance_imports.rows` (D11). */
export interface AttendanceImportHistoryRow {
  /** YYYY-MM-DD */
  date: string;
  sectionId: string;
  roll: number;
  before: AttendanceStatus | null;
  after: AttendanceStatus | null;
  outcome: AttendanceImportRowOutcome;
  recordId: string | null;
  code?: AttendanceImportRowCode;
}

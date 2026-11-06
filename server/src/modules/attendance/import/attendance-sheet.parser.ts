import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import {
  ATTENDANCE_SHEET_MAX_ROWS,
  ATTENDANCE_SHEET_STATUS_CODES,
  AttendanceStatus,
  ImportFileErrorCode,
} from '@biddaloy/shared';
import { ImportFileError } from '../../../common/errors/import-file.error';
import {
  assertXlsxWithinLimits,
  XLSX_TOO_LARGE_MESSAGE,
  XlsxTooLargeError,
} from '../../../common/utils/xlsx-guard.util';

// Cloned from homework/homework-bulk-upload.parser.ts: same ExcelJS .xlsx / .csv reading,
// different column schema (Epic 76 D6). The parser only reads cells; every database
// question (section, roll, date rules) is answered by the service.

export class AttendanceSheetParseError extends ImportFileError {}

type Column = 'date' | 'class' | 'section' | 'roll' | 'name' | 'status';

/** Header text in Bangla or English, compared after trim + lower-case. */
const HEADER_ALIASES: Record<Column, string[]> = {
  date: ['তারিখ', 'date'],
  class: ['শ্রেণি', 'শ্রেণী', 'class'],
  section: ['শাখা', 'section'],
  roll: ['রোল', 'roll'],
  name: ['নাম', 'name'],
  status: ['হাজিরা', 'status'],
};
const REQUIRED: Column[] = ['date', 'class', 'section', 'roll', 'status'];

export interface ParsedSheetRow {
  rowNumber: number;
  /** YYYY-MM-DD, or null when the cell is not a date. */
  date: string | null;
  className: string;
  sectionName: string;
  /** Positive integer, or null when the cell is not one. */
  roll: number | null;
  name: string;
  /** null = blank cell (leave the mark alone). */
  status: AttendanceStatus | null;
  /** The status cell held something that is not a code. */
  badStatus: boolean;
  /** A later row for a (date, class, section, roll) already seen. */
  duplicate: boolean;
}

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';
/** D21: Bangla digits and surrounding spaces are accepted. */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

const STATUS_BY_CODE = new Map<string, AttendanceStatus>();
for (const [status, codes] of Object.entries(ATTENDANCE_SHEET_STATUS_CODES)) {
  for (const code of codes) STATUS_BY_CODE.set(code.toLowerCase(), status as AttendanceStatus);
}

function extension(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i).toLowerCase();
}

const UNREADABLE = 'Could not read file — is it a valid Excel file?';

async function loadWorksheet(buffer: Buffer, filename: string): Promise<ExcelJS.Worksheet> {
  const ext = extension(filename);
  const workbook = new ExcelJS.Workbook();
  if (ext === '.xlsx') {
    try {
      await assertXlsxWithinLimits(buffer);
      await workbook.xlsx.load(buffer as never);
    } catch (e) {
      throw e instanceof XlsxTooLargeError
        ? new AttendanceSheetParseError(ImportFileErrorCode.TOO_LARGE, XLSX_TOO_LARGE_MESSAGE)
        : new AttendanceSheetParseError(ImportFileErrorCode.UNREADABLE, UNREADABLE);
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new AttendanceSheetParseError(ImportFileErrorCode.UNREADABLE, UNREADABLE);
    return sheet;
  }
  if (ext === '.csv') {
    try {
      return await workbook.csv.read(Readable.from(buffer), { map: (d: string) => d });
    } catch {
      throw new AttendanceSheetParseError(
        ImportFileErrorCode.UNREADABLE,
        'Could not read file — is it a valid CSV file?',
      );
    }
  }
  throw new AttendanceSheetParseError(
    ImportFileErrorCode.UNSUPPORTED_TYPE,
    'Unsupported file type — upload .xlsx or .csv',
  );
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const o = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText))
      return o.richText
        .map((p) => p.text)
        .join('')
        .trim();
    if ('result' in o) {
      return o.result instanceof Date
        ? o.result.toISOString().slice(0, 10)
        : String(o.result ?? '').trim();
    }
    if ('text' in o) return String(o.text ?? '').trim();
  }
  return String(value).trim();
}

/** Accepts YYYY-MM-DD (also with `/` or `.`), digits in either script; must be a real day. */
function toIsoDate(raw: string): string | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(normalizeDigits(raw));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt.toISOString().slice(0, 10);
}

export async function parseAttendanceSheet(
  buffer: Buffer,
  filename: string,
): Promise<ParsedSheetRow[]> {
  const sheet = await loadWorksheet(buffer, filename);

  const colIndex = new Map<Column, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, n) => {
    const text = cellText(cell.value).trim().toLowerCase();
    for (const [col, aliases] of Object.entries(HEADER_ALIASES) as [Column, string[]][]) {
      if (aliases.includes(text) && !colIndex.has(col)) colIndex.set(col, n);
    }
  });
  if (REQUIRED.some((c) => !colIndex.has(c))) {
    throw new AttendanceSheetParseError(
      ImportFileErrorCode.MISSING_COLUMNS,
      'Missing required columns — use the downloaded template',
    );
  }
  const read = (row: ExcelJS.Row, col: Column): string => {
    const n = colIndex.get(col);
    return n === undefined ? '' : cellText(row.getCell(n).value);
  };

  const rows: ParsedSheetRow[] = [];
  const seen = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const cells = {
      date: read(row, 'date'),
      className: normalizeDigits(read(row, 'class')),
      sectionName: normalizeDigits(read(row, 'section')),
      roll: normalizeDigits(read(row, 'roll')),
      name: read(row, 'name').trim(),
      status: normalizeDigits(read(row, 'status')),
    };
    if (Object.values(cells).every((v) => v === '')) continue;

    const date = toIsoDate(cells.date);
    const roll = /^\d{1,9}$/.test(cells.roll) && Number(cells.roll) > 0 ? Number(cells.roll) : null;
    const status =
      cells.status === '' ? null : (STATUS_BY_CODE.get(cells.status.toLowerCase()) ?? null);
    const key = `${date}|${cells.className.toLowerCase()}|${cells.sectionName.toLowerCase()}|${roll}`;
    const duplicate = date !== null && roll !== null && seen.has(key);
    seen.add(key);

    rows.push({
      rowNumber,
      date,
      className: cells.className,
      sectionName: cells.sectionName,
      roll,
      name: cells.name,
      status,
      badStatus: cells.status !== '' && status === null,
      duplicate,
    });
    if (rows.length > ATTENDANCE_SHEET_MAX_ROWS) {
      throw new AttendanceSheetParseError(
        ImportFileErrorCode.TOO_MANY_ROWS,
        `File has too many rows (max ${ATTENDANCE_SHEET_MAX_ROWS})`,
      );
    }
  }
  if (rows.length === 0) {
    throw new AttendanceSheetParseError(ImportFileErrorCode.NO_ROWS, 'File contains no data rows');
  }
  return rows;
}

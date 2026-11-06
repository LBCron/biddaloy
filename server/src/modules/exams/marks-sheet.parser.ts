import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import {
  ImportFileErrorCode,
  MarksSheetFileErrorCode,
  MarksSheetRowErrorCode,
} from '@biddaloy/shared';
import { ImportFileError } from '../../common/errors/import-file.error';
import {
  assertXlsxWithinLimits,
  XLSX_TOO_LARGE_MESSAGE,
  XlsxTooLargeError,
} from '../../common/utils/xlsx-guard.util';
import {
  ABSENT_CODES,
  EXEMPT_CODES,
  SHEET_HEADERS,
  SHEET_ID_PREFIX,
  canon,
  unneutralise,
} from './marks-sheet.constants';

// Cloned from homework/homework-bulk-upload.parser.ts: same ExcelJS xlsx/csv
// loading and limits, different schema. Pure: no DB, no request. Every
// message is a fixed sentence; none echoes cell text (Rule 23).

const MAX_DATA_ROWS = 2000;
// Header + legend lines + a few blank rows sit around the data; this only bounds the loop.
// The exact data-row count is checked after the loop. A csv byte cap is the service's job (#3472).
const ROW_SCAN_SLACK = 10;

// Full shape only: a component named `sheet: Written` is still a component.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SHEET_ID_SHAPE = new RegExp(`^${SHEET_ID_PREFIX}${UUID}:${UUID}:${UUID}$`, 'i');

const ABSENT_SET = new Set(ABSENT_CODES.map(canon));
const EXEMPT_SET = new Set(EXEMPT_CODES.map(canon));

/** A whole file the marks import cannot use as a marks sheet (D13). */
export class MarksSheetFileError extends ImportFileError {
  constructor(code: MarksSheetFileErrorCode, message: string) {
    super(code, message);
  }
}

export type RawEntry =
  | { kind: 'blank' }
  | { kind: 'absent' }
  | { kind: 'exempt' }
  | { kind: 'value'; value: string }
  | { kind: 'invalid' };

export interface ParsedSheetRow {
  rowNumber: number;
  studentKey: string;
  roll: string;
  entries: Record<string, RawEntry>;
  /** Set by the parser only for a repeated student key. */
  error?: typeof MarksSheetRowErrorCode.DUPLICATE_ROW;
}

export interface ParsedMarksSheet {
  /** `<exam_id>:<section_id>:<subject_id>` from the hidden header cell; absent on a foreign file. */
  sheetId?: string;
  components: Array<{ name: string; fullMarksHeader: string }>;
  rows: ParsedSheetRow[];
}

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

async function loadWorksheet(buffer: Buffer, filename: string): Promise<ExcelJS.Worksheet> {
  const ext = getExtension(filename);
  const workbook = new ExcelJS.Workbook();

  if (ext === '.xlsx') {
    try {
      await assertXlsxWithinLimits(buffer);
      await workbook.xlsx.load(buffer as never);
    } catch (e) {
      throw e instanceof XlsxTooLargeError
        ? new ImportFileError(ImportFileErrorCode.TOO_LARGE, XLSX_TOO_LARGE_MESSAGE)
        : new ImportFileError(
            ImportFileErrorCode.UNREADABLE,
            'Could not read file — is it a valid Excel file?',
          );
    }
    // The marks tab is first; the "How to fill" tab is never read.
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new ImportFileError(
        ImportFileErrorCode.UNREADABLE,
        'Could not read file — is it a valid Excel file?',
      );
    }
    return worksheet;
  }

  if (ext === '.csv') {
    try {
      return await workbook.csv.read(Readable.from(buffer), { map: (datum: string) => datum });
    } catch {
      throw new ImportFileError(
        ImportFileErrorCode.UNREADABLE,
        'Could not read file — is it a valid CSV file?',
      );
    }
  }

  throw new ImportFileError(
    ImportFileErrorCode.UNSUPPORTED_TYPE,
    'Unsupported file type — upload .xlsx or .csv',
  );
}

/** Bangla digits and the Arabic decimal separator to Latin, for number parsing. */
function toLatinDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)).replace(/٫/g, '.');
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return '';
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(obj.richText))
      return obj.richText
        .map((p) => p.text)
        .join('')
        .trim();
    if ('result' in obj) return String(obj.result ?? '').trim();
    if ('text' in obj) return String(obj.text ?? '').trim();
    return '';
  }
  return String(value).trim();
}

/** A date or an error cell is a bad entry, not an empty one (D3: blank means unchanged). */
function isBadCell(value: ExcelJS.CellValue): boolean {
  if (value instanceof Date) return true;
  if (value && typeof value === 'object') {
    const obj = value as { error?: unknown; result?: unknown };
    if ('error' in obj) return true;
    if ('result' in obj) return isBadCell(obj.result as ExcelJS.CellValue);
  }
  return false;
}

function normaliseEntry(raw: string): RawEntry {
  const text = toLatinDigits(raw.trim());
  if (text === '') return { kind: 'blank' };
  const code = canon(text);
  if (ABSENT_SET.has(code)) return { kind: 'absent' };
  if (EXEMPT_SET.has(code)) return { kind: 'exempt' };
  // Non-negative number, at most 2 decimals (D3).
  if (/^\d+(\.\d{1,2})?$/.test(text)) return { kind: 'value', value: text };
  return { kind: 'invalid' };
}

const norm = (s: string) => s.trim().toLowerCase();
const matches = (header: string, h: { en: string; bn: string }) =>
  norm(header) === norm(h.en) || norm(header) === norm(h.bn);

export async function parseMarksSheet(buffer: Buffer, filename: string): Promise<ParsedMarksSheet> {
  const worksheet = await loadWorksheet(buffer, filename);

  let rollCol = 0;
  let keyCol = 0;
  let sheetId: string | undefined;
  let duplicateComponent = false;
  const componentCols: Array<{ col: number; name: string; header: string }> = [];
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const header = cellToString(cell.value);
    if (SHEET_ID_SHAPE.test(header)) {
      sheetId = header.slice(SHEET_ID_PREFIX.length);
      return;
    }
    if (matches(header, SHEET_HEADERS.roll)) rollCol = col;
    else if (matches(header, SHEET_HEADERS.key)) keyCol = col;
    else if (matches(header, SHEET_HEADERS.name) || matches(header, SHEET_HEADERS.total)) return;
    else {
      const at = header.lastIndexOf(' /');
      if (at > 0) {
        const name = unneutralise(header.slice(0, at).trim());
        if (componentCols.some((c) => c.name === name)) duplicateComponent = true;
        componentCols.push({ col, name, header });
      }
    }
  });
  if (keyCol === 0) {
    throw new MarksSheetFileError(
      MarksSheetFileErrorCode.WRONG_SHEET,
      'This is not a marks sheet — download the sheet from the marks page and fill that one',
    );
  }

  if (duplicateComponent) {
    throw new MarksSheetFileError(
      MarksSheetFileErrorCode.DUPLICATE_COMPONENT,
      'Two columns have the same component name — download a fresh sheet',
    );
  }
  if (worksheet.rowCount > MAX_DATA_ROWS + 1 + ROW_SCAN_SLACK) {
    throw new ImportFileError(
      ImportFileErrorCode.TOO_MANY_ROWS,
      `File has too many rows (max ${MAX_DATA_ROWS})`,
    );
  }

  const rows: ParsedSheetRow[] = [];
  const seen = new Set<string>();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;
    const studentKey = cellToString(row.getCell(keyCol).value);
    // Null prototype so a header like `__proto__` is a plain key, never dropped.
    const entries: Record<string, RawEntry> = Object.create(null);
    for (const c of componentCols) {
      const value = row.getCell(c.col).value;
      entries[c.name] = isBadCell(value)
        ? { kind: 'invalid' }
        : normaliseEntry(cellToString(value));
    }
    const allBlank = Object.values(entries).every((e) => e.kind === 'blank');
    // Empty rows and the legend lines under the table carry no key and no marks.
    if (studentKey === '' && allBlank) continue;

    const parsed: ParsedSheetRow = {
      rowNumber,
      studentKey,
      roll: rollCol ? cellToString(row.getCell(rollCol).value) : '',
      entries,
    };
    if (studentKey !== '' && seen.has(studentKey)) {
      parsed.error = MarksSheetRowErrorCode.DUPLICATE_ROW;
    }
    seen.add(studentKey);
    rows.push(parsed);
  }

  if (rows.length === 0) {
    throw new ImportFileError(ImportFileErrorCode.NO_ROWS, 'File contains no data rows');
  }
  if (rows.length > MAX_DATA_ROWS) {
    throw new ImportFileError(
      ImportFileErrorCode.TOO_MANY_ROWS,
      `File has too many rows (max ${MAX_DATA_ROWS})`,
    );
  }

  return {
    ...(sheetId !== undefined ? { sheetId } : {}),
    components: componentCols.map((c) => ({ name: c.name, fullMarksHeader: c.header })),
    rows,
  };
}

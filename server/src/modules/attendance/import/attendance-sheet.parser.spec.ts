import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { AttendanceStatus, ImportFileErrorCode } from '@biddaloy/shared';
import { ImportFileError } from '../../../common/errors/import-file.error';
import { parseAttendanceSheet } from './attendance-sheet.parser';

const EN = ['Date', 'Class', 'Section', 'Roll', 'Name', 'Status'];
const BN = ['তারিখ', 'শ্রেণি', 'শাখা', 'রোল', 'নাম', 'হাজিরা'];

async function xlsx(rows: (string | number | null)[][], header: string[] = EN): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const row = (status: string | null, roll: string | number = 1) => [
  '2026-03-02',
  'One',
  'A',
  roll,
  'Rahim',
  status,
];

async function expectCode(p: Promise<unknown>, code: ImportFileErrorCode) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(ImportFileError);
  expect((err as ImportFileError).code).toBe(code);
}

describe('parseAttendanceSheet', () => {
  it('reads English headers', async () => {
    const [r] = await parseAttendanceSheet(await xlsx([row('P')]), 'a.xlsx');
    expect(r).toMatchObject({
      rowNumber: 2,
      date: '2026-03-02',
      className: 'One',
      sectionName: 'A',
      roll: 1,
      name: 'Rahim',
      status: AttendanceStatus.PRESENT,
    });
  });

  it('reads Bangla headers, Bangla digits and Bangla codes', async () => {
    const buf = await xlsx([['২০২৬-০৩-০২', 'One', 'A', ' ১২ ', '', 'দে']], BN);
    const [r] = await parseAttendanceSheet(buf, 'a.xlsx');
    expect(r.date).toBe('2026-03-02');
    expect(r.roll).toBe(12);
    expect(r.status).toBe(AttendanceStatus.LATE);
  });

  it('maps every status code, case-insensitively', async () => {
    const codes = ['p', 'উ', 'A', 'অ', 'l', 'দে', 'lv', 'ছু'];
    const rows = codes.map((c, i) => row(c, i + 1));
    const parsed = await parseAttendanceSheet(await xlsx(rows), 'a.xlsx');
    expect(parsed.map((r) => r.status)).toEqual([
      'PRESENT',
      'PRESENT',
      'ABSENT',
      'ABSENT',
      'LATE',
      'LATE',
      'LEAVE',
      'LEAVE',
    ]);
  });

  it('a blank status is null (leave alone); an unknown code is flagged', async () => {
    const parsed = await parseAttendanceSheet(await xlsx([row(null, 1), row('X', 2)]), 'a.xlsx');
    expect(parsed[0]).toMatchObject({ status: null, badStatus: false });
    expect(parsed[1]).toMatchObject({ status: null, badStatus: true });
  });

  it('flags the second row for the same date, class, section and roll as a duplicate', async () => {
    const parsed = await parseAttendanceSheet(await xlsx([row('P'), row('A')]), 'a.xlsx');
    expect(parsed.map((r) => r.duplicate)).toEqual([false, true]);
  });

  // PR #3609 review #6 (regression guard): the section lookup collapses spaces, so the duplicate
  // key must too (`normalizeDigits` does it), or both rows reach the same student and the commit
  // dies on a unique key with no row named.
  it('treats class/section names that differ only by spaces as the same row', async () => {
    const parsed = await parseAttendanceSheet(
      await xlsx([
        ['2026-03-02', 'Class 6', 'A', 1, '', 'P'],
        ['2026-03-02', 'Class  6', ' A ', 1, '', 'A'],
      ]),
      'a.xlsx',
    );
    expect(parsed.map((r) => r.duplicate)).toEqual([false, true]);
  });

  it('a bad date or roll comes back null, not thrown', async () => {
    const parsed = await parseAttendanceSheet(
      await xlsx([['not-a-date', 'One', 'A', 'x', '', 'P']]),
      'a.xlsx',
    );
    expect(parsed[0].date).toBeNull();
    expect(parsed[0].roll).toBeNull();
  });

  it('refuses more than 2000 rows', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => row('P', i + 1));
    await expectCode(
      parseAttendanceSheet(await xlsx(rows), 'a.xlsx'),
      ImportFileErrorCode.TOO_MANY_ROWS,
    );
  });

  it('reads a csv', async () => {
    const csv = Buffer.from('Date,Class,Section,Roll,Name,Status\n2026-03-02,One,A,3,,A\n');
    const [r] = await parseAttendanceSheet(csv, 'a.csv');
    expect(r).toMatchObject({ roll: 3, status: AttendanceStatus.ABSENT });
  });

  it('refuses a non-xlsx body with an xlsx name', async () => {
    await expectCode(
      parseAttendanceSheet(Buffer.from('plain text, not a zip'), 'a.xlsx'),
      ImportFileErrorCode.UNREADABLE,
    );
  });

  it('refuses an unknown extension, a missing column and an empty sheet', async () => {
    await expectCode(
      parseAttendanceSheet(Buffer.from('x'), 'a.pdf'),
      ImportFileErrorCode.UNSUPPORTED_TYPE,
    );
    await expectCode(
      parseAttendanceSheet(await xlsx([], ['Date', 'Class']), 'a.xlsx'),
      ImportFileErrorCode.MISSING_COLUMNS,
    );
    await expectCode(parseAttendanceSheet(await xlsx([]), 'a.xlsx'), ImportFileErrorCode.NO_ROWS);
  });
});

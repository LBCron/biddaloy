import ExcelJS from 'exceljs';
import {
  ImportFileErrorCode,
  MarksSheetFileErrorCode,
  MarksSheetRowErrorCode,
} from '@biddaloy/shared';
import type { GridResponse } from './mark-grid.service';
import { parseMarksSheet } from './marks-sheet.parser';
import { makeFilledSheet } from './marks-sheet.test-helper';

function makeGrid(studentCount = 3): GridResponse {
  const students = Array.from({ length: studentCount }, (_, i) => ({
    id: `st${i + 1}`,
    roll_number: i + 1,
    full_name: `Student ${i + 1}`,
    joined_after_exam: false,
    not_taking: false,
  }));
  const comp = (id: string, name: string, full: string, sequence: number) => ({
    id,
    name,
    kind: 'WRITTEN',
    source: 'MANUAL',
    full_marks: full,
    pass_marks: null,
    sequence,
  });
  return {
    exam_id: 'e',
    section_id: 's',
    subject_id: 'sub',
    state: 'DRAFT',
    submitted_by: null,
    submitted_at: null,
    students,
    components: [comp('c1', 'Written', '75', 1), comp('c2', 'Practical', '25', 2)],
    cells: [],
    derived: {},
  } as unknown as GridResponse;
}

const meta = { examName: 'Mid', sectionName: 'A', subjectName: 'Math', lang: 'en' as const };

/** Fill the Written cell of roll 1 and return what the parser made of it. */
async function parseWritten(cell: string | number) {
  const buf = await makeFilledSheet(makeGrid(), meta, [{ roll: 1, component: 'Written', cell }]);
  const parsed = await parseMarksSheet(buf, 'm.xlsx');
  return parsed.rows[0].entries['Written'];
}

describe('parseMarksSheet', () => {
  it('round trip: one row per student, all entries blank', async () => {
    const buf = await makeFilledSheet(makeGrid(), meta, []);
    const parsed = await parseMarksSheet(buf, 'm.xlsx');
    expect(parsed.rows.map((r) => r.studentKey)).toEqual(['st1', 'st2', 'st3']);
    expect(parsed.rows[0].entries).toEqual({
      Written: { kind: 'blank' },
      Practical: { kind: 'blank' },
    });
    expect(parsed.components).toEqual([
      { name: 'Written', fullMarksHeader: 'Written /75' },
      { name: 'Practical', fullMarksHeader: 'Practical /25' },
    ]);
  });

  it('reads numbers, Bangla digits and 2 decimals as values', async () => {
    expect(await parseWritten(45)).toEqual({ kind: 'value', value: '45' });
    expect(await parseWritten('৪৫')).toEqual({ kind: 'value', value: '45' });
    expect(await parseWritten(7.5)).toEqual({ kind: 'value', value: '7.5' });
    expect(await parseWritten('৭.৫')).toEqual({ kind: 'value', value: '7.5' });
    expect(await parseWritten('45.00')).toEqual({ kind: 'value', value: '45.00' });
  });

  it('marks too many decimals, negatives and junk as invalid, never throws', async () => {
    expect(await parseWritten('45.123')).toEqual({ kind: 'invalid' });
    expect(await parseWritten(45.123)).toEqual({ kind: 'invalid' });
    expect(await parseWritten('-3')).toEqual({ kind: 'invalid' });
    expect(await parseWritten('abc')).toEqual({ kind: 'invalid' });
  });

  it('reads absent codes in either language and case', async () => {
    for (const code of ['a', 'AB', 'অ', 'অনু']) {
      expect(await parseWritten(code)).toEqual({ kind: 'absent' });
    }
  });

  it('reads exempt codes in either language and case', async () => {
    for (const code of ['e', 'EX', 'ছাড়']) {
      expect(await parseWritten(code)).toEqual({ kind: 'exempt' });
    }
  });

  it('parses a Bangla-header sheet', async () => {
    const buf = await makeFilledSheet(makeGrid(), { ...meta, lang: 'bn' }, [
      { roll: 2, component: 'Written', cell: 30 },
    ]);
    const parsed = await parseMarksSheet(buf, 'm.xlsx');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[1].entries['Written']).toEqual({ kind: 'value', value: '30' });
  });

  it('ignores the Total column', async () => {
    const buf = await makeFilledSheet(makeGrid(), meta, []);
    const parsed = await parseMarksSheet(buf, 'm.xlsx');
    expect(Object.keys(parsed.rows[0].entries)).not.toContain('Total');
  });

  it('refuses a sheet with no key column as WRONG_SHEET', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    ws.addRow(['Roll', 'Name', 'Written /75']);
    ws.addRow([1, 'A', 5]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseMarksSheet(buf, 'm.xlsx')).rejects.toMatchObject({
      code: MarksSheetFileErrorCode.WRONG_SHEET,
    });
  });

  it('flags the second row with the same key as DUPLICATE_ROW', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    ws.addRow(['Roll', 'Name', 'Written /75', 'Total', 'Student key']);
    ws.addRow([1, 'A', 5, null, 'k1']);
    ws.addRow([2, 'B', 6, null, 'k1']);
    const parsed = await parseMarksSheet(Buffer.from(await wb.xlsx.writeBuffer()), 'm.xlsx');
    expect(parsed.rows[0].error).toBeUndefined();
    expect(parsed.rows[1].error).toBe(MarksSheetRowErrorCode.DUPLICATE_ROW);
  });

  it('parses a csv with the same headers', async () => {
    const csv = 'Roll,Name,Written /75,Total,Student key\n1,A,45,,k1\n2,B,a,,k2\n';
    const parsed = await parseMarksSheet(Buffer.from(csv), 'm.csv');
    expect(parsed.rows[0].entries['Written']).toEqual({ kind: 'value', value: '45' });
    expect(parsed.rows[1].entries['Written']).toEqual({ kind: 'absent' });
  });

  it('refuses 2001 data rows with TOO_MANY_ROWS', async () => {
    const buf = await makeFilledSheet(makeGrid(2001), meta, [
      { roll: 1, component: 'Written', cell: 1 },
    ]);
    await expect(parseMarksSheet(buf, 'm.xlsx')).rejects.toMatchObject({
      code: ImportFileErrorCode.TOO_MANY_ROWS,
    });
  });

  it('refuses a non-xlsx buffer named .xlsx as UNREADABLE without crashing', async () => {
    await expect(parseMarksSheet(Buffer.from('not a zip'), 'm.xlsx')).rejects.toMatchObject({
      code: ImportFileErrorCode.UNREADABLE,
    });
  });

  it('never puts the cell text in an error message', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['SECRET-CELL', 'Name']);
    await expect(
      parseMarksSheet(Buffer.from(await wb.xlsx.writeBuffer()), 'm.xlsx'),
    ).rejects.toThrow(/^(?!.*SECRET-CELL)/);
  });

  it('reads exempt typed precomposed (U+09DC) or decomposed (U+09A1 U+09BC)', async () => {
    expect(await parseWritten('ছা\u09dc')).toEqual({ kind: 'exempt' });
    expect(await parseWritten('ছা\u09a1\u09bc')).toEqual({ kind: 'exempt' });
  });

  it('turns a date cell into invalid, not blank', async () => {
    expect(await parseWritten(new Date('2026-01-01') as unknown as string)).toEqual({
      kind: 'invalid',
    });
  });

  it('refuses two columns with the same component name', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('x').addRow(['Roll', 'Written /75', 'Written /25', 'Student key']);
    await expect(
      parseMarksSheet(Buffer.from(await wb.xlsx.writeBuffer()), 'm.xlsx'),
    ).rejects.toMatchObject({ code: MarksSheetFileErrorCode.DUPLICATE_COMPONENT });
  });

  it('keeps a __proto__ header as an ordinary entry', async () => {
    const csv = 'Roll,__proto__ /10,Student key\n1,5,k1\n';
    const parsed = await parseMarksSheet(Buffer.from(csv), 'm.csv');
    expect(Object.keys(parsed.rows[0].entries)).toEqual(['__proto__']);
  });

  it('refuses a sheet far over the row cap before reading rows', async () => {
    const lines = Array.from({ length: 2100 }, (_, i) => `${i},1,k${i}`).join('\n');
    const csv = `Roll,Written /75,Student key\n${lines}\n`;
    await expect(parseMarksSheet(Buffer.from(csv), 'm.csv')).rejects.toMatchObject({
      code: ImportFileErrorCode.TOO_MANY_ROWS,
    });
  });

  it('reads a component whose name starts with = back by its real name', async () => {
    const grid = makeGrid();
    grid.components[0].name = '=Written';
    const buf = await makeFilledSheet(grid, meta, [{ roll: 1, component: "'=Written", cell: 9 }]);
    const parsed = await parseMarksSheet(buf, 'm.xlsx');
    expect(parsed.rows[0].entries['=Written']).toEqual({ kind: 'value', value: '9' });
  });
});

import ExcelJS from 'exceljs';
import { buildMarksSheet } from './marks-sheet.builder';
import { howToLines } from './marks-sheet.constants';
import type { GridResponse } from './mark-grid.service';

function makeGrid(): GridResponse {
  const student = (id: string, roll: number, name: string) => ({
    id,
    roll_number: roll,
    full_name: name,
    joined_after_exam: false,
    not_taking: false,
  });
  const comp = (id: string, name: string, source: string, full: string, sequence: number) => ({
    id,
    name,
    kind: 'WRITTEN',
    source,
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
    students: [
      student('st1', 1, 'Ayesha'),
      student('st2', 2, 'Bilal'),
      student('st3', 3, 'Chitra'),
      student('st4', 4, 'Dev'),
    ],
    // Deliberately out of sequence order, with a DERIVED one in the middle.
    components: [
      comp('c2', 'Practical', 'MANUAL', '25', 2),
      comp('cd', 'Grand', 'DERIVED', '100', 3),
      comp('c1', 'Written', 'MANUAL', '75', 1),
    ],
    cells: [
      { student_id: 'st1', component_id: 'c1', value: '60.5', status: 'PRESENT' },
      { student_id: 'st2', component_id: 'c1', value: null, status: 'ABSENT' },
      { student_id: 'st3', component_id: 'c1', value: null, status: 'EXEMPT' },
    ],
    derived: {},
  } as unknown as GridResponse;
}

const meta = {
  examName: 'Mid/Term',
  sectionName: 'A  B',
  subjectName: 'Math\\1',
  lang: 'en' as const,
};

async function reopen(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

describe('buildMarksSheet', () => {
  it('orders components by sequence and skips DERIVED', async () => {
    const { buffer } = await buildMarksSheet(makeGrid(), meta);
    const ws = (await reopen(buffer)).worksheets[0];
    expect(ws.getRow(1).values).toEqual([
      undefined,
      'Roll',
      'Name',
      'Written /75',
      'Practical /25',
      'Total',
      'Student key',
      'sheet:e:s:sub',
    ]);
  });

  it('hides + locks the key column and unlocks component cells', async () => {
    const { buffer } = await buildMarksSheet(makeGrid(), meta);
    const ws = (await reopen(buffer)).worksheets[0];
    expect(ws.getColumn(6).hidden).toBe(true);
    expect(ws.getColumn(7).hidden).toBe(true);
    // Locked is the default, so a missing protection object means locked.
    expect(ws.getCell(2, 6).protection?.locked ?? true).toBe(true);
    expect(ws.getCell(2, 1).protection?.locked ?? true).toBe(true);
    expect(ws.getCell(2, 3).protection?.locked).toBe(false);
    expect(ws.getCell(2, 4).protection?.locked).toBe(false);
  });

  it('pre-fills PRESENT / ABSENT / EXEMPT / missing', async () => {
    const { buffer } = await buildMarksSheet(makeGrid(), meta);
    const ws = (await reopen(buffer)).worksheets[0];
    expect(ws.getCell(2, 3).value).toBe(60.5);
    expect(ws.getCell(3, 3).value).toBe('A');
    expect(ws.getCell(4, 3).value).toBe('E');
    expect(ws.getCell(5, 3).value).toBeNull();
    expect(ws.getCell(2, 6).value).toBe('st1');
  });

  it('Total formula covers exactly the component cells', async () => {
    const { buffer } = await buildMarksSheet(makeGrid(), meta);
    const ws = (await reopen(buffer)).worksheets[0];
    expect((ws.getCell(2, 5).value as { formula: string }).formula).toBe('SUM(C2:D2)');
  });

  it('uses bn headers when lang is bn', async () => {
    const { buffer } = await buildMarksSheet(makeGrid(), { ...meta, lang: 'bn' });
    const ws = (await reopen(buffer)).worksheets[0];
    expect(ws.getCell(1, 1).value).toBe('রোল');
    expect(ws.getCell(1, 5).value).toBe('মোট');
  });

  it('sanitises the filename', async () => {
    const { filename } = await buildMarksSheet(makeGrid(), meta);
    expect(filename).toBe('Mid-Term_A-B_Math-1.xlsx');
  });

  it('re-opens with both tabs and a legend', async () => {
    const { buffer } = await buildMarksSheet(makeGrid(), meta);
    const wb = await reopen(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Marks', 'How to fill']);
    expect(wb.worksheets[0].getCell(7, 1).value).toBe('A = absent');
    expect(wb.worksheets[1].rowCount).toBe(5);
  });

  it('defuses formula triggers in student and component names', async () => {
    const grid = makeGrid();
    grid.students[0].full_name = '=HYPERLINK("x")';
    grid.components[0].name = '@Practical';
    const { buffer } = await buildMarksSheet(grid, meta);
    const ws = (await reopen(buffer)).worksheets[0];
    expect(ws.getCell(2, 2).value).toBe(`'=HYPERLINK("x")`);
    expect(ws.getCell(1, 4).value).toBe("'@Practical /25");
  });

  it('protects the sheet: key hidden, entry cells unlocked, roll and name locked', async () => {
    const { buffer } = await buildMarksSheet(makeGrid(), meta);
    const ws = (await reopen(buffer)).worksheets[0];
    // `sheetProtection` is set by exceljs on load but missing from its typings.
    expect((ws as unknown as { sheetProtection?: object }).sheetProtection).toBeTruthy();
    expect(ws.getColumn(6).hidden).toBe(true);
    expect(ws.getColumn(7).hidden).toBe(true);
    expect(ws.getCell(2, 3).protection?.locked).toBe(false);
    expect(ws.getCell(2, 1).protection?.locked ?? true).toBe(true);
    expect(ws.getCell(2, 2).protection?.locked ?? true).toBe(true);
  });

  it('puts the first how-to line in the first cell of tab 2, in en and bn', async () => {
    for (const lang of ['en', 'bn'] as const) {
      const { buffer } = await buildMarksSheet(makeGrid(), { ...meta, lang });
      const wb = await reopen(buffer);
      expect(wb.worksheets[1].getCell(1, 1).value).toBe(howToLines(lang)[0]);
    }
  });

  it('writes the legend under the table in en and bn', async () => {
    const en = await reopen((await buildMarksSheet(makeGrid(), meta)).buffer);
    expect(en.worksheets[0].getCell(7, 1).value).toBe('A = absent');
    expect(en.worksheets[0].getCell(8, 1).value).toBe('E = exempt');
    const bn = await reopen((await buildMarksSheet(makeGrid(), { ...meta, lang: 'bn' })).buffer);
    expect(bn.worksheets[0].getCell(7, 1).value).toBe('A = অনুপস্থিত');
    expect(bn.worksheets[0].getCell(8, 1).value).toBe('E = অব্যাহতি');
  });
});

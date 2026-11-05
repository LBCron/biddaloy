import ExcelJS from 'exceljs';
import type { GridResponse } from './mark-grid.service';
import {
  HOWTO_TAB,
  LEGEND,
  MARKS_TAB,
  SHEET_HEADERS,
  SHEET_ID_PREFIX,
  SheetLang,
  howToLines,
  neutralise,
} from './marks-sheet.constants';

export interface MarksSheetMeta {
  examName: string;
  sectionName: string;
  subjectName: string;
  lang: SheetLang;
}

const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } } as const;

/** D17: `/`, `\` and whitespace runs become `-`. */
function sanitize(part: string): string {
  return part.replace(/[/\\\s]+/g, '-');
}

/** Pure: no repository, no request. Manual components only (D11). */
export async function buildMarksSheet(
  grid: GridResponse,
  meta: MarksSheetMeta,
): Promise<{ buffer: Buffer; filename: string }> {
  const { lang } = meta;
  const components = grid.components
    .filter((c) => c.source === 'MANUAL')
    .sort((a, b) => a.sequence - b.sequence);

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(MARKS_TAB[lang]);

  const firstComp = 3;
  const lastComp = firstComp + components.length - 1;
  const totalCol = lastComp + 1;
  const keyCol = totalCol + 1;
  const idCol = keyCol + 1;

  ws.addRow([
    SHEET_HEADERS.roll[lang],
    SHEET_HEADERS.name[lang],
    ...components.map((c) => neutralise(`${c.name} /${c.full_marks}`)),
    SHEET_HEADERS.total[lang],
    SHEET_HEADERS.key[lang],
    `${SHEET_ID_PREFIX}${grid.exam_id}:${grid.section_id}:${grid.subject_id}`,
  ]);

  const cellByKey = new Map(grid.cells.map((c) => [`${c.student_id}|${c.component_id}`, c]));
  grid.students.forEach((s, i) => {
    const r = i + 2;
    const compCells = components.map((c) => {
      const cell = cellByKey.get(`${s.id}|${c.id}`);
      if (!cell) return null;
      if (cell.status === 'ABSENT') return 'A';
      if (cell.status === 'EXEMPT') return 'E';
      if (cell.status === 'PRESENT' && cell.value !== null) return Number(cell.value);
      return null;
    });
    // Column letters, not getCell(): getCell would create the row before addRow appends it.
    const first = `${ws.getColumn(firstComp).letter}${r}`;
    const last = `${ws.getColumn(lastComp).letter}${r}`;
    const total = components.length > 0 ? { formula: `SUM(${first}:${last})` } : null;
    ws.addRow([s.roll_number, neutralise(s.full_name), ...compCells, total, neutralise(s.id)]);
  });

  ws.getColumn(keyCol).hidden = true;
  ws.getColumn(idCol).hidden = true;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Cells are locked by default; unlock only the component cells.
  for (let r = 2; r <= grid.students.length + 1; r++) {
    for (let c = firstComp; c <= lastComp; c++) {
      ws.getCell(r, c).protection = { locked: false };
    }
  }
  const header = ws.getRow(1);
  header.font = { bold: true };
  for (let c = 1; c <= idCol; c++) {
    if (c < firstComp || c > lastComp) header.getCell(c).fill = GREY;
  }

  const legendRow = grid.students.length + 3;
  ws.getCell(legendRow, 1).value = LEGEND.absent[lang];
  ws.getCell(legendRow + 1, 1).value = LEGEND.exempt[lang];

  await ws.protect('', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    sort: true,
    autoFilter: true,
  });

  const howto = workbook.addWorksheet(HOWTO_TAB[lang]);
  for (const line of howToLines(lang)) howto.addRow([line]);
  howto.getColumn(1).width = 60;

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const filename = `${[meta.examName, meta.sectionName, meta.subjectName].map(sanitize).join('_')}.xlsx`;
  return { buffer, filename };
}

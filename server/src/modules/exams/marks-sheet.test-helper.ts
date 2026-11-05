import ExcelJS from 'exceljs';
import type { GridResponse } from './mark-grid.service';
import { buildMarksSheet, MarksSheetMeta } from './marks-sheet.builder';

/** One edit: put `cell` into the row with this roll, under the component with this name. */
export interface SheetEdit {
  roll: number;
  component: string;
  cell: string | number | null;
}

/** Fixture generator for specs and e2e (no binary fixtures in the repo): builds the
 * real sheet, re-opens it, applies the edits and returns the new .xlsx buffer. */
export async function makeFilledSheet(
  grid: GridResponse,
  meta: MarksSheetMeta,
  edits: SheetEdit[],
): Promise<Buffer> {
  const { buffer } = await buildMarksSheet(grid, meta);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const ws = wb.worksheets[0];

  const header = ws.getRow(1);
  for (const edit of edits) {
    let col = 0;
    header.eachCell((cell, c) => {
      if (String(cell.value).startsWith(`${edit.component} /`)) col = c;
    });
    let rowNumber = 0;
    ws.eachRow((row, r) => {
      if (r > 1 && row.getCell(1).value === edit.roll) rowNumber = r;
    });
    if (!col || !rowNumber) throw new Error('makeFilledSheet: roll or component not found');
    ws.getCell(rowNumber, col).value = edit.cell;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

import type { Writable } from 'node:stream';
import ExcelJS from 'exceljs';

/** Same rule as `csvCell` in `@biddaloy/shared`: a leading `=`, `+`, `-`, `@`, tab or CR is a formula to Excel. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function guard(cell: unknown): unknown {
  return typeof cell === 'string' && FORMULA_PREFIX.test(cell) ? `'${cell}` : cell;
}

/**
 * Writes one worksheet to `stream` without holding the file in memory:
 * each row is committed as it is added. The header row is bold. Create it,
 * call `writeRows` per chunk, then `finish` once.
 */
export class XlsxStreamWriter {
  private readonly workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private readonly sheet: ExcelJS.Worksheet;
  private readonly finished: Promise<void>;

  constructor(stream: Writable, header: readonly string[], sheetName = 'Report') {
    this.finished = new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve);
      stream.once('error', reject);
    });
    // If exceljs fails mid-write, `finished` rejects before anything awaits it;
    // swallow here so the caller's `finish()` is the single place it surfaces.
    this.finished.catch(() => undefined);
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });
    this.sheet = this.workbook.addWorksheet(sheetName);
    const headerRow = this.sheet.addRow([...header]);
    headerRow.font = { bold: true };
    headerRow.commit();
  }

  writeRows(rows: readonly (readonly unknown[])[]): void {
    for (const row of rows) this.sheet.addRow(row.map(guard)).commit();
  }

  async finish(): Promise<void> {
    this.sheet.commit();
    await this.workbook.commit();
    await this.finished;
  }
}

import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { XlsxStreamWriter } from './xlsx-stream.writer';

describe('XlsxStreamWriter', () => {
  it('prefixes a formula-looking string cell with a quote and leaves the rest alone', async () => {
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (d: Buffer) => chunks.push(d));
    const writer = new XlsxStreamWriter(out, ['name', 'n']);
    writer.writeRows([
      ['=SUM(A1)', 5],
      ['@x', 'plain'],
    ]);
    await writer.finish();

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.concat(chunks) as never);
    const sheet = book.getWorksheet('Report')!;
    expect(sheet.getRow(2).values).toEqual([undefined, "'=SUM(A1)", 5]);
    expect(sheet.getRow(3).values).toEqual([undefined, "'@x", 'plain']);
  });
});

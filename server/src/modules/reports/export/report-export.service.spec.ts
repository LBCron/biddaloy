import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { ExportFormat, ReportRunKind } from '@biddaloy/shared';
import {
  ExportTooLargeError,
  ReportExportService,
  SYNC_EXPORT_MAX_ROWS,
} from './report-export.service';
import { XlsxStreamWriter } from './xlsx-stream.writer';
import type { ReportRunLogService } from './report-run-log.service';

function makeService() {
  const runLog = {
    start: vi.fn().mockResolvedValue({ id: 'run-1' }),
    finish: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  return { service: new ReportExportService(runLog as unknown as ReportRunLogService), runLog };
}

async function* rowsOf(rows: unknown[][]) {
  for (const r of rows) yield r;
}

async function bytesOf(file: { getStream(): NodeJS.ReadableStream }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of file.getStream()) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

const base = {
  tenantId: 'tenant-a',
  userId: 'user-1',
  kind: ReportRunKind.EXPORT,
  header: ['Name', 'Note'],
  filename: 'students',
};

describe('ReportExportService', () => {
  it('keeps Bangla text intact in CSV, with the BOM exactly once across chunks', async () => {
    const { service } = makeService();
    // 1,200 rows = three 500-row chunks, so a BOM bug would show up as a repeat.
    const rows = Array.from({ length: 1200 }, (_, i) => ['রহিম', `নোট ${i}`]);
    const file = await service.export({ ...base, format: ExportFormat.CSV, rows: rowsOf(rows) });

    const text = (await bytesOf(file)).toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.split('﻿')).toHaveLength(2); // one BOM, so two pieces
    expect(text).toContain('"রহিম","নোট 1199"');
    expect(text.trimEnd().split('\r\n')).toHaveLength(1201); // header + 1,200 rows
  });

  it('keeps Bangla text intact in XLSX (read back with exceljs)', async () => {
    const { service } = makeService();
    const file = await service.export({
      ...base,
      format: ExportFormat.XLSX,
      rows: rowsOf([['রহিম', 'ঢাকা']]),
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await bytesOf(file)) as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, 'Name', 'Note']);
    expect(sheet.getRow(2).values).toEqual([undefined, 'রহিম', 'ঢাকা']);
  });

  it('neutralises a formula cell in CSV and in XLSX', async () => {
    const { service } = makeService();
    const rows = [['=cmd|calc', '@SUM(A1)']];

    const csv = await service.export({ ...base, format: ExportFormat.CSV, rows: rowsOf(rows) });
    expect((await bytesOf(csv)).toString('utf8')).toContain(`"'=cmd|calc","'@SUM(A1)"`);

    const xlsx = await service.export({ ...base, format: ExportFormat.XLSX, rows: rowsOf(rows) });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await bytesOf(xlsx)) as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets[0].getRow(2).values).toEqual([undefined, "'=cmd|calc", "'@SUM(A1)"]);
  });

  it('refuses 5,001 rows before writing a run row or any byte', async () => {
    const { service, runLog } = makeService();
    const rows = Array.from({ length: SYNC_EXPORT_MAX_ROWS + 1 }, (_, i) => [`s${i}`, 'x']);

    await expect(
      service.export({ ...base, format: ExportFormat.CSV, rows: rowsOf(rows) }),
    ).rejects.toBeInstanceOf(ExportTooLargeError);
    expect(runLog.start).not.toHaveBeenCalled();
  });

  it('accepts exactly 5,000 rows', async () => {
    const { service } = makeService();
    const rows = Array.from({ length: SYNC_EXPORT_MAX_ROWS }, (_, i) => [`s${i}`, 'x']);
    const file = await service.export({ ...base, format: ExportFormat.CSV, rows: rowsOf(rows) });
    expect((await bytesOf(file)).toString('utf8').trimEnd().split('\r\n')).toHaveLength(5001);
  });

  it('feeds the XLSX writer one chunk at a time, not the whole file', async () => {
    const { service } = makeService();
    const spy = vi.spyOn(XlsxStreamWriter.prototype, 'writeRows');
    const rows = Array.from({ length: 1200 }, (_, i) => [`s${i}`, 'x']);

    await bytesOf(await service.export({ ...base, format: ExportFormat.XLSX, rows: rowsOf(rows) }));

    expect(spy.mock.calls.map(([chunk]) => chunk.length)).toEqual([500, 500, 200]);
    spy.mockRestore();
  });

  it('logs the finished run with its row count once the stream ends', async () => {
    const { service, runLog } = makeService();
    await bytesOf(
      await service.export({ ...base, format: ExportFormat.CSV, rows: rowsOf([['a', 'b']]) }),
    );
    // finish() is chained after the stream, so wait for it rather than a tick.
    await vi.waitFor(() =>
      expect(runLog.finish).toHaveBeenCalledWith(
        'tenant-a',
        'run-1',
        expect.objectContaining({ rowCount: 1 }),
      ),
    );
  });
});

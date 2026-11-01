import { PassThrough } from 'node:stream';
import { Injectable, Logger, PayloadTooLargeException, StreamableFile } from '@nestjs/common';
import { ExportFormat, type ReportRunKind } from '@biddaloy/shared';
import { CsvStreamWriter } from './csv-stream.writer';
import { XlsxStreamWriter } from './xlsx-stream.writer';
import { ReportRunLogService } from './report-run-log.service';

/** D8: more rows than this go to the queue ([8.15.16]), not the response. */
export const SYNC_EXPORT_MAX_ROWS = 5_000;
/** Rows handed to a writer at a time, so memory stays flat however long the export is. */
const CHUNK_ROWS = 500;

const CONTENT_TYPE: Record<ExportFormat, string> = {
  [ExportFormat.CSV]: 'text/csv; charset=utf-8',
  [ExportFormat.XLSX]: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Thrown before any byte is sent, so a caller can switch to the queued path. */
export class ExportTooLargeError extends PayloadTooLargeException {
  readonly code = 'EXPORT_TOO_LARGE';
  constructor() {
    // `rows` is the synchronous cap, so a client can say "over 5,000 rows".
    super({
      message: 'Too many rows to download at once. Narrow the filters, or use the queued export.',
      details: { code: 'EXPORT_TOO_LARGE', rows: SYNC_EXPORT_MAX_ROWS },
    });
  }
}

export interface ExportRequest {
  tenantId: string;
  userId: string | null;
  kind: ReportRunKind;
  format: ExportFormat;
  /** `list` exports name their source here, e.g. `students-list`. */
  sourceKey?: string;
  definitionVersionId?: string | null;
  params?: Record<string, unknown>;
  header: readonly string[];
  rows: AsyncIterable<readonly unknown[]>;
  /** Without extension; the format adds it. */
  filename: string;
}

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);

  constructor(private readonly runLog: ReportRunLogService) {}

  /**
   * Streams `rows` as CSV or XLSX. Reads at most `SYNC_EXPORT_MAX_ROWS + 1`
   * rows up front: one more than the limit proves it is too big and throws
   * `ExportTooLargeError` before the response starts. Otherwise the buffered
   * rows are written in chunks and the run is logged when the stream ends.
   */
  async export(req: ExportRequest): Promise<StreamableFile> {
    const startedAt = Date.now();
    const buffered: (readonly unknown[])[] = [];
    for await (const row of req.rows) {
      buffered.push(row);
      if (buffered.length > SYNC_EXPORT_MAX_ROWS) throw new ExportTooLargeError();
    }

    const run = await this.runLog.start({
      tenantId: req.tenantId,
      userId: req.userId,
      kind: req.kind,
      sourceKey: req.sourceKey ?? null,
      definitionVersionId: req.definitionVersionId ?? null,
      format: req.format,
      params: req.params,
    });

    const out = new PassThrough();
    const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
    // Two failures, two handlers: only a failed write may destroy the stream; a bookkeeping
    // failure after a complete write must not truncate a download that is still being read.
    void this.pump(req, buffered, out).then(
      () =>
        this.runLog
          .finish(req.tenantId, run.id, {
            rowCount: buffered.length,
            durationMs: Date.now() - startedAt,
          })
          .catch((err: unknown) =>
            this.logger.error(`Export ${run.id} finished but was not logged: ${message(err)}`),
          ),
      async (err: unknown) => {
        this.logger.error(`Export ${run.id} failed: ${message(err)}`);
        out.destroy(err instanceof Error ? err : new Error('export failed'));
        await this.runLog
          .fail(req.tenantId, run.id, 'EXPORT_WRITE_FAILED')
          .catch((e: unknown) =>
            this.logger.error(`Export ${run.id} not marked failed: ${message(e)}`),
          );
      },
    );

    const extension = req.format === ExportFormat.XLSX ? 'xlsx' : 'csv';
    return new StreamableFile(out, {
      type: CONTENT_TYPE[req.format],
      disposition: `attachment; filename="${req.filename.replace(/[^\w.-]/g, '_')}.${extension}"`,
    });
  }

  private async pump(
    req: ExportRequest,
    rows: readonly (readonly unknown[])[],
    out: PassThrough,
  ): Promise<void> {
    if (req.format === ExportFormat.XLSX) {
      const writer = new XlsxStreamWriter(out, req.header);
      for (let i = 0; i < rows.length; i += CHUNK_ROWS)
        writer.writeRows(rows.slice(i, i + CHUNK_ROWS));
      await writer.finish();
      return;
    }
    const csv = new CsvStreamWriter();
    csv.pipe(out);
    csv.write([req.header]);
    for (let i = 0; i < rows.length; i += CHUNK_ROWS) csv.write(rows.slice(i, i + CHUNK_ROWS));
    await new Promise<void>((resolve, reject) => {
      out.once('finish', resolve);
      csv.once('error', reject);
      csv.end();
    });
  }
}

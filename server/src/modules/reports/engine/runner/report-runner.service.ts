import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import {
  AggregateFn,
  ReportFieldType,
  ReportRunKind,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { ReportRunLogService } from '../../export/report-run-log.service';
import { ReportDefinitionVersion } from '../../entities/report-definition-version.entity';
import {
  ReportCompiler,
  type CompiledColumn,
  type CompiledReport,
} from '../compiler/report-compiler';
import { visibleCount } from '../security/small-cell';
import type { ReportRunContext } from '../security/role-scope.policy';
import { ReportResultCache } from './report-result.cache';

/** D20: how many rows each mode may return. */
export const PREVIEW_MAX_ROWS = 500;
export const RUN_MAX_ROWS = 10_000;
export const RUN_PAGE_SIZE = 100;
/** D20: how long one query may take, interactive and background. */
export const INTERACTIVE_TIMEOUT_MS = 15_000;
export const JOB_TIMEOUT_MS = 120_000;

/** pg's "query_canceled": the statement timeout fired. */
const QUERY_CANCELED = '57014';

/** D18: a report that is too slow fails whole; it never returns part of its rows. */
export class ReportTimeoutError extends UnprocessableEntityException {
  constructor() {
    super({
      message: 'This report is taking too long. Narrow the filters and try again.',
      details: { code: 'REPORT_TOO_SLOW' },
    });
  }
}

export type RunMode = 'PREVIEW' | 'RUN';

export interface RunRequest {
  ctx: ReportRunContext;
  /** A saved report: its published version. */
  versionId?: string;
  /** An inline definition (the designer's preview). One of the two is required. */
  definition?: ReportDefinitionJson;
  params?: Record<string, unknown>;
  mode: RunMode;
  /** 1-based page of `RUN_PAGE_SIZE` rows; ignored for PREVIEW. */
  page?: number;
  /** Lowers the row cap below the mode's own (a dashboard widget shows 50). It can never raise it. */
  maxRows?: number;
  /**
   * `false` writes no `report_runs` row for a RUN. A tile that refreshes on its own must not
   * inflate the usage numbers (D24). Defaults to true.
   */
  log?: boolean;
}

export interface ReportResultColumn {
  key: string;
  label_en: string;
  label_bn: string;
  type: ReportFieldType;
  kind: 'dimension' | 'measure';
}

export interface ReportRunResult {
  columns: ReportResultColumn[];
  rows: Array<Record<string, unknown>>;
  /** Columns left out because the runner's role may not see them. */
  masked: string[];
  /** True when a count under 5 was hidden from a COMMITTEE member (shown as a null cell). */
  suppressed: boolean;
  /** True when the report has more rows than the mode allows; only the first rows are returned. */
  truncated: boolean;
  total_rows: number;
  page: number;
  page_size: number;
  total_pages: number;
  run_id: string | null;
}

interface CachedSet {
  columns: ReportResultColumn[];
  rows: Array<Record<string, unknown>>;
  masked: string[];
  suppressed: boolean;
  truncated: boolean;
}

const CURSOR_BATCH = 1_000;

const COUNT_FNS = new Set<AggregateFn>([AggregateFn.COUNT, AggregateFn.COUNT_DISTINCT]);

/** One raw database value as JSON-safe output for its column type. */
export function shapeValue(type: ReportFieldType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return type === ReportFieldType.DATE ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  if (
    type === ReportFieldType.NUMBER ||
    type === ReportFieldType.MONEY ||
    type === ReportFieldType.PERCENT
  ) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

/**
 * [8.15.22] Runs a definition safely (Epic 8.15 D8, D17, D18, D20): the compiler builds the
 * query for the runner's role; it executes in a read-only transaction with a statement timeout;
 * rows are capped; the result is cached for five minutes; every RUN leaves a `report_runs` row.
 */
@Injectable()
export class ReportRunnerService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ReportDefinitionVersion)
    private readonly versions: Repository<ReportDefinitionVersion>,
    private readonly compiler: ReportCompiler,
    private readonly cache: ReportResultCache,
    private readonly runLog: ReportRunLogService,
  ) {}

  async run(req: RunRequest): Promise<ReportRunResult> {
    const startedAt = Date.now();
    const { definition, versionId } = await this.resolve(req);
    const modeCap = req.mode === 'PREVIEW' ? PREVIEW_MAX_ROWS : RUN_MAX_ROWS;
    const cap =
      req.maxRows && req.maxRows > 0 ? Math.min(modeCap, Math.trunc(req.maxRows)) : modeCap;
    const params = req.params ?? {};

    // One more than the cap tells us the report is longer than the mode allows.
    const compiled = await this.compiler.compile(definition, params, req.ctx, cap + 1);
    let set: CachedSet;
    try {
      set = await this.resultSet(req, versionId, compiled, cap);
    } catch (error) {
      // D24: a report that was too slow is counted on the usage page. The row carries no data.
      if (error instanceof ReportTimeoutError && req.mode === 'RUN' && req.log !== false) {
        const failed = await this.runLog.start({
          tenantId: req.ctx.tenantId,
          userId: req.ctx.userId,
          kind: ReportRunKind.RUN,
          definitionVersionId: versionId,
          params,
        });
        await this.runLog.fail(req.ctx.tenantId, failed.id, 'REPORT_TOO_SLOW');
      }
      throw error;
    }

    const pageSize = req.mode === 'RUN' ? RUN_PAGE_SIZE : set.rows.length || 1;
    const totalPages = Math.max(1, Math.ceil(set.rows.length / pageSize));
    const page = req.mode === 'RUN' ? Math.min(Math.max(req.page ?? 1, 1), totalPages) : 1;
    const rows =
      req.mode === 'RUN' ? set.rows.slice((page - 1) * pageSize, page * pageSize) : set.rows;

    let runId: string | null = null;
    if (req.mode === 'RUN' && req.log !== false) {
      const run = await this.runLog.start({
        tenantId: req.ctx.tenantId,
        userId: req.ctx.userId,
        kind: ReportRunKind.RUN,
        definitionVersionId: versionId,
        params,
      });
      await this.runLog.finish(req.ctx.tenantId, run.id, {
        rowCount: set.rows.length,
        durationMs: Date.now() - startedAt,
      });
      runId = run.id;
    }

    return {
      ...set,
      rows,
      total_rows: set.rows.length,
      page,
      page_size: pageSize,
      total_pages: totalPages,
      run_id: runId,
    };
  }

  /** The full (capped) result set: from the cache when it has it, else from the database. */
  private async resultSet(
    req: RunRequest,
    versionId: string | null,
    compiled: CompiledReport,
    cap: number,
  ): Promise<CachedSet> {
    const [sql, sqlParams] = compiled.query.getQueryAndParameters();
    // A preview is a draft being edited: never cached.
    const key =
      req.mode === 'RUN'
        ? this.cache.key(req.ctx.tenantId, versionId, sql, sqlParams, req.ctx.role)
        : null;
    if (key) {
      const hit = await this.cache.get<CachedSet>(key);
      if (hit) return hit;
    }

    const raw = await this.withReadOnlyTransaction(INTERACTIVE_TIMEOUT_MS, (runner) =>
      compiled.query.setQueryRunner(runner).getRawMany<Record<string, unknown>>(),
    );
    const truncated = raw.length > cap;
    const set = this.shape(compiled, req.ctx.role, truncated ? raw.slice(0, cap) : raw, truncated);
    if (key) await this.cache.set(key, set);
    return set;
  }

  private shape(
    compiled: CompiledReport,
    role: string,
    raw: Array<Record<string, unknown>>,
    truncated: boolean,
  ): CachedSet {
    const columns = compiled.columns.map(toResultColumn);
    let suppressed = false;
    const rows = raw.map((row) => {
      const out: Record<string, unknown> = {};
      for (const column of compiled.columns) {
        let value = shapeValue(column.type, row[column.key]);
        // D14: a COMMITTEE member never sees a count under 5; the cell is empty, not zero.
        if (
          column.kind === 'measure' &&
          column.fn &&
          COUNT_FNS.has(column.fn) &&
          typeof value === 'number'
        ) {
          const shown = visibleCount(value, role);
          if (shown === null) suppressed = true;
          value = shown;
        }
        out[column.key] = value;
      }
      return out;
    });
    return { columns, rows, masked: compiled.masked, suppressed, truncated };
  }

  /**
   * Runs `work` in a READ ONLY transaction with a statement timeout, then rolls back. A timeout
   * becomes `ReportTimeoutError` and nothing else is returned (D18). Exposed so a spec can prove
   * that a write inside it fails.
   */
  async withReadOnlyTransaction<T>(
    timeoutMs: number,
    work: (runner: QueryRunner) => Promise<T>,
  ): Promise<T> {
    const runner = await this.openReadOnly(timeoutMs);
    try {
      return await work(runner);
    } catch (error) {
      throw asReportError(error);
    } finally {
      await this.close(runner);
    }
  }

  /**
   * Every row of a compiled report, read through a SQL cursor 1,000 rows at a time inside one
   * read-only transaction, so a 200,000-row export never holds the result in memory. The cursor
   * also gives the whole export one consistent snapshot of the data.
   */
  async *cursorRows(
    compiled: CompiledReport,
    timeoutMs: number,
  ): AsyncGenerator<Record<string, unknown>> {
    const runner = await this.openReadOnly(timeoutMs);
    try {
      // The SQL is the compiler's own text; every value in it is a bound parameter.
      const [sql, params] = compiled.query.getQueryAndParameters();
      await runner.query(`DECLARE report_cursor NO SCROLL CURSOR FOR ${sql}`, params);
      for (;;) {
        const batch: Array<Record<string, unknown>> = await runner.query(
          `FETCH FORWARD ${CURSOR_BATCH} FROM report_cursor`,
        );
        for (const row of batch) yield row;
        if (batch.length < CURSOR_BATCH) return;
      }
    } catch (error) {
      throw asReportError(error);
    } finally {
      await this.close(runner);
    }
  }

  private async openReadOnly(timeoutMs: number): Promise<QueryRunner> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction('READ COMMITTED');
      await runner.query('SET TRANSACTION READ ONLY');
      // `timeoutMs` is one of the numeric constants above, never user input.
      await runner.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
      return runner;
    } catch (error) {
      await runner.release();
      throw error;
    }
  }

  /** Nothing was written, so rolling back is the cheapest way to end the transaction. */
  private async close(runner: QueryRunner): Promise<void> {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }

  private async resolve(
    req: RunRequest,
  ): Promise<{ definition: ReportDefinitionJson; versionId: string | null }> {
    if (req.versionId) {
      const version = await this.versions.findOne({
        where: { id: req.versionId, tenant_id: req.ctx.tenantId },
      });
      if (!version) throw new NotFoundException('Report not found');
      return { definition: version.definition, versionId: version.id };
    }
    if (req.definition) return { definition: req.definition, versionId: null };
    throw new NotFoundException('Report not found');
  }
}

function toResultColumn(c: CompiledColumn): ReportResultColumn {
  return { key: c.key, label_en: c.labelEn, label_bn: c.labelBn, type: c.type, kind: c.kind };
}

/** A statement-timeout cancel becomes the 422 the screen understands; anything else is left as it is. */
function asReportError(error: unknown): unknown {
  const code =
    (error as { code?: string }).code ??
    (error as { driverError?: { code?: string } }).driverError?.code;
  return code === QUERY_CANCELED ? new ReportTimeoutError() : error;
}

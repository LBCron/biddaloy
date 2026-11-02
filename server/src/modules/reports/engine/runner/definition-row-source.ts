import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ReportDefinitionJson, UserRole } from '@biddaloy/shared';
import { ReportDefinitionVersion } from '../../entities/report-definition-version.entity';
import { ReportRowSourceRegistry } from '../../export/report-row-sources';
import { ReportCompiler } from '../compiler/report-compiler';
import { JOB_TIMEOUT_MS, ReportRunnerService, shapeValue } from './report-runner.service';

/** Name of the queued-export source for saved reports. */
export const DEFINITION_SOURCE = 'definition';

/** What the export request saves on the run so the job can rebuild the report. */
export interface DefinitionExportQuery extends Record<string, unknown> {
  versionId: string;
  role: UserRole;
  params: Record<string, unknown>;
}

/**
 * [8.15.22] Lets the export queue ([8.15.16]) export a saved report: it rebuilds the query for
 * the role that asked, streams the rows through a read-only transaction with the long (job)
 * timeout, and yields them in column order. The header is the Bangla labels.
 */
@Injectable()
export class DefinitionRowSource implements OnModuleInit {
  constructor(
    @InjectRepository(ReportDefinitionVersion)
    private readonly versions: Repository<ReportDefinitionVersion>,
    private readonly compiler: ReportCompiler,
    private readonly runner: ReportRunnerService,
    private readonly sources: ReportRowSourceRegistry,
  ) {}

  onModuleInit(): void {
    this.sources.register(DEFINITION_SOURCE, {
      header: async (tenantId, userId, query) => {
        const compiled = await this.compile(tenantId, userId, query as DefinitionExportQuery);
        return compiled.columns.map((c) => c.labelBn);
      },
      rows: (tenantId, userId, query) =>
        this.rows(tenantId, userId, query as DefinitionExportQuery),
    });
  }

  private async compile(tenantId: string, userId: string, query: DefinitionExportQuery) {
    const version = await this.versions.findOneOrFail({
      where: { id: query.versionId, tenant_id: tenantId },
    });
    const definition: ReportDefinitionJson = version.definition;
    // The export cap (D20) is enforced by the job; ask the compiler for one row more than it allows.
    return this.compiler.compile(
      definition,
      query.params ?? {},
      { tenantId, userId, role: query.role },
      200_001,
    );
  }

  private async *rows(
    tenantId: string,
    userId: string,
    query: DefinitionExportQuery,
  ): AsyncGenerator<unknown[]> {
    const compiled = await this.compile(tenantId, userId, query);
    for await (const raw of this.runner.cursorRows(compiled, JOB_TIMEOUT_MS)) {
      yield compiled.columns.map((c) => shapeValue(c.type, raw[c.key]));
    }
  }
}

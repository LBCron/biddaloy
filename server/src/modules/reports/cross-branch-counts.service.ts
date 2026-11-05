import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AggregateFn,
  Permission,
  ReportRunKind,
  SchoolStatus,
  roleHasPermission,
  type JwtPayload,
  type UserRole,
} from '@biddaloy/shared';
import { resolveRole } from '../auth/guards/context.guard';
import { TenantStatusService } from '../schools/tenant-status.service';
import { ReportDefinitionsService } from './definitions/report-definitions.service';
import type { BranchCountsResultDto } from './dto/report-engine.dto';
import { ReportDefinition } from './entities/report-definition.entity';
import { ReportDefinitionVersion } from './entities/report-definition-version.entity';
import { ReportRunLogService } from './export/report-run-log.service';
import {
  ReportRunnerService,
  type ReportResultColumn,
} from './engine/runner/report-runner.service';

const COUNT_FNS = new Set<string>([AggregateFn.COUNT, AggregateFn.COUNT_DISTINCT]);

/** One fixed sentence for every reason a report cannot be counted across branches (Rule 23). */
export class NotCountableAcrossBranchesError extends UnprocessableEntityException {
  constructor() {
    super({
      message: 'This report cannot be counted across branches.',
      details: { code: 'REPORT_NOT_BRANCH_COUNTABLE' },
    });
  }
}

/**
 * [#3516, Epic 8.15 D13] The same saved report run in every branch the caller belongs to, with the
 * counts added together. A branch is a school (tenant), so nothing here widens a query: each branch
 * runs through the normal runner as ITS OWN school, with the caller's role IN THAT BRANCH
 * (`resolveRole`, the rule `ContextGuard` uses on `X-Tenant-ID`), so that branch's row scope,
 * field masking and small-count hiding all apply. Branches the caller is not a member of, or that
 * are not active, or where their role may not open reports or the report is hidden from it, are
 * left out without a word: the answer never says another school exists.
 *
 * Counts only, because adding anything else up across schools would mean different things. No
 * questions (class and year ids belong to one school). Hidden counts: a total that has a hidden
 * cell is hidden too, otherwise total minus the visible cells would give the number back.
 */
@Injectable()
export class CrossBranchCountsService {
  constructor(
    private readonly runner: ReportRunnerService,
    private readonly definitions: ReportDefinitionsService,
    private readonly tenantStatus: TenantStatusService,
    private readonly runLog: ReportRunLogService,
    @InjectRepository(ReportDefinition)
    private readonly definitionRepo: Repository<ReportDefinition>,
    @InjectRepository(ReportDefinitionVersion)
    private readonly versions: Repository<ReportDefinitionVersion>,
  ) {}

  async run(args: {
    tenant: { id: string; role: string };
    user: JwtPayload;
    definitionId: string;
  }): Promise<BranchCountsResultDto> {
    const { tenant, user } = args;
    const viewer = { tenantId: tenant.id, userId: user.sub, role: tenant.role };
    // Same rules as a single run: this school's published, role-visible report, else one 404.
    const catalogue = await this.definitions.catalogue(viewer);
    const entry = catalogue.flatMap((f) => f.reports).find((r) => r.id === args.definitionId);
    if (!entry) throw new NotFoundException('Report not found');
    const version = await this.versions.findOne({
      where: { id: entry.version_id, tenant_id: tenant.id },
    });
    const source = await this.definitionRepo.findOne({
      where: { id: args.definitionId, tenant_id: tenant.id },
    });
    if (!version || !source) throw new NotFoundException('Report not found');

    const definition = version.definition;
    const countsOnly =
      definition.dataset.measures.length > 0 &&
      definition.dataset.measures.every((m) => COUNT_FNS.has(String(m.fn))) &&
      definition.parameters.length === 0 &&
      definition.calculated.length === 0;
    if (!countsOnly) throw new NotCountableAcrossBranchesError();

    const platformTenantId = await this.tenantStatus.platformTenantId();
    const branchIds = [...new Set(user.memberships.map((m) => m.tenantId))];
    const results: BranchCountsResultDto['branches'] = [];
    const shapes: string[] = [];
    let columns: ReportResultColumn[] = [];
    for (const branchId of branchIds) {
      const role =
        branchId === tenant.id
          ? (tenant.role as UserRole)
          : (resolveRole(
              user.memberships,
              branchId,
              undefined,
              platformTenantId,
            ) as UserRole | null);
      if (!role || !roleHasPermission(role, Permission.REPORTS_VIEW)) continue;
      if ((await this.tenantStatus.getStatus(branchId)) !== SchoolStatus.ACTIVE) continue;
      if (source.visible_roles.length > 0 && !source.visible_roles.includes(role)) continue;

      // A preview: never cached, never one `report_runs` row per branch. One audit row is written below.
      const result = await this.runner.run({
        ctx: { tenantId: branchId, userId: user.sub, role },
        definition,
        mode: 'PREVIEW',
        log: false,
      });
      if (results.length === 0) columns = result.columns;
      shapes.push(result.columns.map((c) => c.key).join('|'));
      results.push({
        branch_id: branchId,
        branch_name: user.memberships.find((m) => m.tenantId === branchId)?.name ?? '',
        rows: result.rows,
        masked: result.masked,
        suppressed: result.suppressed,
        truncated: result.truncated,
      });
    }

    // D8: every run is audited, in the school the caller asked from.
    const run = await this.runLog.start({
      tenantId: tenant.id,
      userId: user.sub,
      kind: ReportRunKind.RUN,
      definitionVersionId: version.id,
      params: { branches: results.map((b) => b.branch_id) },
    });
    await this.runLog.finish(tenant.id, run.id, {
      rowCount: results.reduce((n, b) => n + b.rows.length, 0),
      durationMs: 0,
    });

    const comparable = new Set(shapes).size <= 1 && !results.some((b) => b.truncated);
    return {
      columns: columns as unknown as BranchCountsResultDto['columns'],
      branches: results,
      totals: comparable ? this.total(columns, results) : [],
      suppressed: results.some((b) => b.suppressed),
      truncated: results.some((b) => b.truncated),
    };
  }

  /** Added row by row on the dimension values; a hidden (null) cell anywhere hides that total. */
  private total(
    columns: ReportResultColumn[],
    branches: BranchCountsResultDto['branches'],
  ): Array<Record<string, unknown>> {
    const dims = columns.filter((c) => c.kind === 'dimension').map((c) => c.key);
    const measures = columns.filter((c) => c.kind === 'measure').map((c) => c.key);
    const merged = new Map<string, Record<string, unknown>>();
    for (const branch of branches) {
      for (const row of branch.rows) {
        const id = JSON.stringify(dims.map((d) => row[d]));
        const into = merged.get(id) ?? Object.fromEntries(dims.map((d) => [d, row[d]]));
        for (const m of measures) {
          // Total minus the visible cells would give a hidden count back, so a null stays null.
          const seen = into[m];
          into[m] = row[m] === null || seen === null ? null : Number(seen ?? 0) + Number(row[m]);
        }
        merged.set(id, into);
      }
    }
    return [...merged.values()];
  }
}

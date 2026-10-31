import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { DashboardWidgetKey, JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { DashboardWidgetRoute } from '../dashboard/widget-permission.decorator';
import { SchoolsService } from '../schools/schools.service';
import { CollectionsReportService } from './collections-report.service';
import { CollectionMonthWidgetDto } from './dto/collection-month-widget.dto';
import { CollectionTodayWidgetDto } from './dto/collection-today-widget.dto';
import { CollectionByMonthWidgetDto } from './dto/collection-by-month-widget.dto';
import { CommitteeFinanceDto } from './dto/committee-finance.dto';
import { ReportWidgetDto } from './delivery/dto/report-delivery.dto';
import { ReportDefinitionsService } from './definitions/report-definitions.service';
import { ReportRunnerService } from './engine/runner/report-runner.service';

/** A report tile shows this many rows at most, and one number per row. */
export const REPORT_WIDGET_MAX_ROWS = 50;

/** `GET /dashboard/widgets/collection-month` (Epic 169 D25/D46). */
@ApiTags('dashboard')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ReportsDashboardController {
  constructor(
    private readonly collectionsReport: CollectionsReportService,
    private readonly schools: SchoolsService,
    private readonly cache: DashboardCacheService,
    private readonly definitions: ReportDefinitionsService,
    private readonly runner: ReportRunnerService,
  ) {}

  /**
   * [8.15.45] `GET /dashboard/widgets/report/:definitionId`: a report the caller may run, as a tile.
   * It runs for the CALLER's role (D5), in RUN mode on the report's default answers, capped at 50 rows,
   * with the dimensions and the FIRST measure only. The runner's five-minute result cache is used
   * (its key carries the tenant and the role). No run is logged: a tile that refreshes on its own
   * must not inflate the usage page. A report the role may not see is a plain 404.
   */
  @Get('dashboard/widgets/report/:definitionId')
  @RequirePermissions(Permission.DASHBOARD_VIEW, Permission.REPORTS_VIEW)
  @ApiOkResponse({ type: ReportWidgetDto })
  async reportWidget(
    @Param('definitionId', ParseUUIDPipe) definitionId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<ReportWidgetDto> {
    const catalogue = await this.definitions.catalogue({
      tenantId: tenant.id,
      userId: user.sub,
      role: tenant.role,
    });
    const entry = catalogue.flatMap((f) => f.reports).find((r) => r.id === definitionId);
    if (!entry) throw new NotFoundException('Report not found');

    const result = await this.runner.run({
      ctx: { tenantId: tenant.id, userId: user.sub, role: tenant.role as UserRole },
      versionId: entry.version_id,
      mode: 'RUN',
      maxRows: REPORT_WIDGET_MAX_ROWS,
      log: false,
    });
    const firstMeasure = result.columns.find((c) => c.kind === 'measure');
    const columns = result.columns.filter((c) => c.kind === 'dimension' || c === firstMeasure);
    return {
      definition_id: entry.id,
      name_en: entry.name_en,
      name_bn: entry.name_bn,
      columns,
      rows: result.rows
        .slice(0, REPORT_WIDGET_MAX_ROWS)
        .map((row) => Object.fromEntries(columns.map((c) => [c.key, row[c.key]]))),
      truncated: result.truncated,
      suppressed: result.suppressed,
    };
  }

  @DashboardWidgetRoute(DashboardWidgetKey.COLLECTION_MONTH)
  @ApiOkResponse({ type: CollectionMonthWidgetDto })
  async collectionMonth(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<CollectionMonthWidgetDto> {
    // The date is read inside the loader, so a cached value is at most 60 s stale.
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.COLLECTION_MONTH,
      'school',
      async () =>
        this.collectionsReport.getCollectionMonthWidget(
          tenant.id,
          await this.schools.todayFor(tenant.id),
        ),
    );
  }

  @DashboardWidgetRoute(DashboardWidgetKey.COLLECTION_TODAY)
  @ApiOkResponse({ type: CollectionTodayWidgetDto })
  async collectionToday(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<CollectionTodayWidgetDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.COLLECTION_TODAY,
      'school',
      async () =>
        this.collectionsReport.getCollectionTodayWidget(
          tenant.id,
          await this.schools.todayFor(tenant.id),
        ),
    );
  }

  /** COMMITTEE gets totals only; gated by COMMITTEE_REPORT_READ, never the collections report. */
  @DashboardWidgetRoute(DashboardWidgetKey.COMMITTEE_FINANCE)
  @ApiOkResponse({ type: CommitteeFinanceDto })
  async committeeFinance(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<CommitteeFinanceDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.COMMITTEE_FINANCE,
      'school',
      async () =>
        this.collectionsReport.getCommitteeFinance(
          tenant.id,
          await this.schools.todayFor(tenant.id),
        ),
    );
  }

  @DashboardWidgetRoute(DashboardWidgetKey.COLLECTION_BY_MONTH)
  @ApiOkResponse({ type: CollectionByMonthWidgetDto })
  async collectionByMonth(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<CollectionByMonthWidgetDto> {
    return this.cache.getOrLoad(
      tenant.id,
      DashboardWidgetKey.COLLECTION_BY_MONTH,
      'school',
      async () =>
        this.collectionsReport.getCollectionByMonthWidget(
          tenant.id,
          await this.schools.todayFor(tenant.id),
        ),
    );
  }
}

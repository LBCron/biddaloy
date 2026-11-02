import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
  Inject,
  ParseUUIDPipe,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/audit-log.dto';
import { AuditLogListResponseDto, AuditLogResponseDto } from './dto/audit-log-response.dto';
import { ExportFormat, Permission, ReportRunKind, RoleScope, roleScope } from '@biddaloy/shared';
import { teacherCanSeeStudent } from '../classes/teacher-scope.service';
import { ReportExportService } from '../reports/export/report-export.service';
import { ReportRowSourceRegistry } from '../reports/export/report-row-sources';
import { WithExportFormat, exportFilters } from '../reports/export/dto/with-export-format';

class ExportAuditLogQueryDto extends WithExportFormat(QueryAuditLogDto) {}

@ApiTags('audit-logs')
@ApiTenantAuth()
@Controller('audit-logs')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AuditController implements OnModuleInit {
  constructor(
    @Inject(AuditService) private readonly auditService: AuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reportExport: ReportExportService,
    private readonly rowSources: ReportRowSourceRegistry,
  ) {}

  /** [8.15.16] A queued export rebuilds this list by name. */
  onModuleInit(): void {
    this.rowSources.register('audit-logs-list', {
      header: () => this.auditService.exportHeader(),
      rows: (tenantId, userId, query) =>
        this.auditService.iterateForExport(query as QueryAuditLogDto, tenantId, userId),
    });
  }

  @Get()
  @RequirePermissions(Permission.AUDIT_LOG_READ)
  @ApiOperation({
    summary:
      "List this tenant's audit trail, newest first — filterable by action, entity type, and date range.",
  })
  @ApiResponse({ status: 200, type: AuditLogListResponseDto })
  async findAll(
    @Query() query: QueryAuditLogDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    const { entityLabels, ...result } = await this.auditService.findAll(query, tenant.id, user.sub);
    return {
      ...result,
      data: result.data.map((log) => ({
        ...AuditLogResponseDto.fromEntity(log),
        entity_label: entityLabels.get(`${log.entity_type}:${log.entity_id}`) ?? null,
      })),
    };
  }

  /** [8.15.11] Every audit row matching the list's filters as CSV/XLSX (who, what, when; never the value snapshots). */
  @Get('export')
  @RequirePermissions(Permission.REPORTS_EXPORT, Permission.AUDIT_LOG_READ)
  exportAuditLogs(
    @Query() query: ExportAuditLogQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    return this.reportExport.export({
      tenantId: tenant.id,
      userId: user.sub,
      kind: ReportRunKind.EXPORT,
      format: query.format ?? ExportFormat.CSV,
      sourceKey: 'audit-logs-list',
      params: exportFilters(query),
      header: this.auditService.exportHeader(),
      rows: this.auditService.iterateForExport(query, tenant.id, user.sub),
      filename: 'audit-logs',
    });
  }

  // Declared before `findAll`'s `@Get()` shares no path segment with it, so
  // ordering doesn't matter for routing — kept below it just to read as
  // "the tenant-wide view, then the narrower one" top to bottom.
  @Get('entity/:entityType/:entityId')
  // [10.4] G6 — per-entity Activity tab; object-scoped, distinct from the
  // tenant-wide AUDIT_LOG_READ above.
  @RequirePermissions(Permission.AUDIT_ENTITY_HISTORY_READ)
  @ApiOperation({
    summary: "List one entity's audit trail (e.g. a single student's activity tab), newest first.",
  })
  @ApiResponse({ status: 200, type: AuditLogListResponseDto })
  async findByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Query() query: QueryAuditLogDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    // [75.6-d] TEACHER: only a Student in a current-year assigned section; AuditModule can't import
    // the scope service (cycle), so this uses the free function. A miss is 404 (D13).
    if (
      roleScope(tenant.role) === RoleScope.ASSIGNED_SECTIONS &&
      !(
        entityType === 'Student' &&
        (await teacherCanSeeStudent(this.dataSource.manager, {
          userId: user.sub,
          tenantId: tenant.id,
          studentId: entityId,
        }))
      )
    ) {
      throw new NotFoundException('Not found');
    }
    const result = await this.auditService.findByEntity(
      entityType,
      entityId,
      query,
      tenant.id,
      user.sub,
    );
    return { ...result, data: result.data.map(AuditLogResponseDto.fromEntity) };
  }
}

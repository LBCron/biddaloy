import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Repository } from 'typeorm';
import {
  ExportFormat,
  JwtPayload,
  Permission,
  ReportRunKind,
  ReportRunStatus,
  UserRole,
  roleHasPermission,
} from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { StorageService } from '../storage/storage.service';
import {
  ExportRunDto,
  QueuedExportDto,
  ReportRunStatusDto,
  RunFeedbackDto,
  RunReportDto,
} from './dto/report-engine.dto';
import { DEFINITION_SOURCE } from './engine/runner/definition-row-source';
import { ReportRunnerService, type ReportRunResult } from './engine/runner/report-runner.service';
import { ReportDefinitionsService } from './definitions/report-definitions.service';
import { ReportRun } from './entities/report-run.entity';
import { ExportTooLargeError, ReportExportService } from './export/report-export.service';
import { ReportExportQueue } from './export/report-export.queue';
import { ReportRowSourceRegistry } from './export/report-row-sources';

type Tenant = { id: string; role: string };

/** The permission each exportable list also needs: the list's own read permission, on top of REPORTS_EXPORT. */
const LIST_SOURCE_PERMISSION: Record<string, Permission> = {
  'students-list': Permission.STUDENT_READ,
  'guardians-list': Permission.GUARDIAN_READ,
  'invoices-list': Permission.INVOICE_READ,
  'dues-list': Permission.FEE_READ,
  'payments-list': Permission.PAYMENT_READ,
  'audit-logs-list': Permission.AUDIT_LOG_READ,
};

/**
 * [8.15.24] Running a report, exporting it (a file now, or queued when it is large) and the run's own
 * status, download and "was this useful?" answer. A run belongs to whoever started it: nobody else
 * can see, download or rate it, and the answer to "is this somebody else's?" is a plain 404.
 */
@ApiTags('reports')
@ApiTenantAuth()
@Controller('reports')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ReportRunsController {
  constructor(
    private readonly runner: ReportRunnerService,
    private readonly definitions: ReportDefinitionsService,
    private readonly exporter: ReportExportService,
    private readonly queue: ReportExportQueue,
    private readonly sources: ReportRowSourceRegistry,
    private readonly storage: StorageService,
    @InjectRepository(ReportRun) private readonly runs: Repository<ReportRun>,
  ) {}

  @Post('run')
  @HttpCode(200)
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({
    summary:
      'Run a saved report (`definitionId`) or preview an unsaved one (`definition`, REPORTS_DESIGN).',
  })
  async run(
    @Body() dto: RunReportDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReportRunResult> {
    const ctx = { tenantId: tenant.id, userId: user.sub, role: tenant.role as UserRole };
    if (dto.definition) {
      // Previewing an unsaved report is a designer's job.
      if (!roleHasPermission(tenant.role, Permission.REPORTS_DESIGN))
        throw new ForbiddenException();
      return this.runner.run({
        ctx,
        definition: dto.definition,
        params: dto.params,
        mode: 'PREVIEW',
      });
    }
    if (!dto.definitionId) throw new NotFoundException('Report not found');
    const versionId = await this.visibleVersion(tenant, user, dto.definitionId);
    return this.runner.run({ ctx, versionId, params: dto.params, mode: 'RUN', page: dto.page });
  }

  @Post('runs/export')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.REPORTS_EXPORT)
  @ApiOperation({
    summary:
      'Export a saved report or a list. Up to 5,000 rows come back as a file; more are queued and answer 202 with the run id.',
  })
  @ApiOkResponse({
    description: 'The file (up to 5,000 rows).',
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiAcceptedResponse({ type: QueuedExportDto, description: 'Queued; poll the run status.' })
  async exportRun(
    @Body() dto: ExportRunDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | QueuedExportDto> {
    const format = dto.format ?? ExportFormat.XLSX;
    const { source, query, filename } = await this.exportTarget(dto, tenant, user);
    const rowSource = this.sources.get(source);
    if (!rowSource) throw new NotFoundException('Nothing to export');

    try {
      return await this.exporter.export({
        tenantId: tenant.id,
        userId: user.sub,
        kind: ReportRunKind.EXPORT,
        format,
        sourceKey: source,
        params: query,
        header: await rowSource.header(tenant.id, user.sub, query),
        rows: rowSource.rows(tenant.id, user.sub, query),
        filename,
      });
    } catch (error) {
      if (!(error instanceof ExportTooLargeError)) throw error;
      // Too big for a response: run it in the background and say where to look.
      const runId = await this.queue.enqueue({
        tenantId: tenant.id,
        userId: user.sub,
        source,
        query,
        format,
      });
      res.status(202);
      return { run_id: runId, status: ReportRunStatus.QUEUED };
    }
  }

  @Get('runs/:id')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOkResponse({ type: ReportRunStatusDto })
  async status(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReportRunStatusDto> {
    const run = await this.ownRun(tenant.id, user.sub, id);
    return {
      id: run.id,
      kind: run.kind,
      status: run.status,
      format: run.format,
      row_count: run.row_count,
      error_code: run.error_code,
      expires_at: run.expires_at?.toISOString() ?? null,
      downloadable: this.isDownloadable(run),
    };
  }

  @Get('runs/:id/download')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  @ApiOperation({ summary: 'The file of your finished queued export, while it has not expired.' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<StreamableFile> {
    const run = await this.ownRun(tenant.id, user.sub, id);
    if (!this.isDownloadable(run)) throw new NotFoundException('This file is not available.');
    const stored = await this.storage.getForTenant(run.storage_key as string, tenant.id);
    const extension = run.format === ExportFormat.XLSX ? 'xlsx' : 'csv';
    return new StreamableFile(stored.body, {
      type: stored.contentType ?? 'application/octet-stream',
      disposition: `attachment; filename="report-${run.id}.${extension}"`,
    });
  }

  @Post('runs/:id/feedback')
  @HttpCode(200)
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'One-tap "was this useful?" for your own run, once.' })
  async feedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunFeedbackDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ ok: true }> {
    const run = await this.ownRun(tenant.id, user.sub, id);
    if (run.feedback_at) throw new ConflictException('You have already answered for this report.');
    await this.runs.update(
      { id: run.id, tenant_id: tenant.id },
      {
        helpful: dto.helpful,
        feedback_comment: dto.comment?.trim() || null,
        feedback_at: new Date(),
      },
    );
    return { ok: true };
  }

  /** The published version of a saved report the caller may run, or 404 (never says "not yours"). */
  private async visibleVersion(
    tenant: Tenant,
    user: JwtPayload,
    definitionId: string,
  ): Promise<string> {
    const catalogue = await this.definitions.catalogue({
      tenantId: tenant.id,
      userId: user.sub,
      role: tenant.role,
    });
    const entry = catalogue.flatMap((f) => f.reports).find((r) => r.id === definitionId);
    if (!entry) throw new NotFoundException('Report not found');
    return entry.version_id;
  }

  private async exportTarget(dto: ExportRunDto, tenant: Tenant, user: JwtPayload) {
    if (dto.definitionId) {
      const versionId = await this.visibleVersion(tenant, user, dto.definitionId);
      return {
        source: DEFINITION_SOURCE,
        query: { versionId, role: tenant.role, params: dto.params ?? {} } as Record<
          string,
          unknown
        >,
        filename: 'report',
      };
    }
    const permission = dto.source ? LIST_SOURCE_PERMISSION[dto.source] : undefined;
    // A list can be exported only by a role that may also read it on screen.
    if (!dto.source || !permission || !roleHasPermission(tenant.role, permission)) {
      throw new NotFoundException('Nothing to export');
    }
    return {
      source: dto.source,
      query: dto.query ?? {},
      filename: dto.source.replace(/-list$/, ''),
    };
  }

  private async ownRun(tenantId: string, userId: string, id: string): Promise<ReportRun> {
    const run = await this.runs.findOne({ where: { id, tenant_id: tenantId, run_by: userId } });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  private isDownloadable(run: ReportRun): boolean {
    return (
      run.status === ReportRunStatus.DONE &&
      run.storage_key !== null &&
      run.expires_at !== null &&
      run.expires_at.getTime() > Date.now()
    );
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  CreateReportScheduleDto,
  CreateReportSnapshotDto,
  ListReportSnapshotsQueryDto,
  ReportScheduleDto,
  ReportSnapshotDto,
  ReportSnapshotPageDto,
  UpdateReportScheduleDto,
} from './delivery/dto/report-delivery.dto';
import { ReportSchedulesService } from './delivery/report-schedules.service';
import { ReportSnapshotsService } from './delivery/report-snapshots.service';
import type { ReportSchedule } from './entities/report-schedule.entity';

type Tenant = { id: string; role: string };

const toScheduleDto = (s: ReportSchedule): ReportScheduleDto => ({
  id: s.id,
  definition_id: s.definition_id,
  frequency: s.frequency,
  day_of_week: s.day_of_week,
  day_of_month: s.day_of_month,
  local_time: s.local_time,
  params: s.params,
  recipient_roles: s.recipient_roles,
  format: s.format,
  active: s.active,
  last_run_id: s.last_run_id,
  created_at: s.created_at.toISOString(),
});

/**
 * [8.15.45] Scheduled email links (REPORTS_DESIGN, ADMIN only, D9) and kept copies of runs (D15).
 * A schedule or snapshot of another school, or one you may not read, is a plain 404. Taking a file
 * out (keeping a copy, downloading it) needs REPORTS_EXPORT, like every other export (D9).
 */
@ApiTags('reports')
@ApiTenantAuth()
@Controller('reports')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ReportDeliveryController {
  constructor(
    private readonly schedules: ReportSchedulesService,
    private readonly snapshots: ReportSnapshotsService,
  ) {}

  @Get('definitions/:id/schedules')
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOkResponse({ type: [ReportScheduleDto] })
  async listSchedules(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
  ): Promise<ReportScheduleDto[]> {
    return (await this.schedules.list(tenant.id, id)).map(toScheduleDto);
  }

  @Post('definitions/:id/schedules')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOperation({ summary: 'Email a link to this report to some roles, daily, weekly or monthly.' })
  @ApiOkResponse({ type: ReportScheduleDto })
  async createSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReportScheduleDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReportScheduleDto> {
    return toScheduleDto(
      await this.schedules.create({ tenantId: tenant.id, userId: user.sub }, id, dto),
    );
  }

  @Patch('definitions/:id/schedules/:scheduleId')
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOkResponse({ type: ReportScheduleDto })
  async updateSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: UpdateReportScheduleDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReportScheduleDto> {
    return toScheduleDto(
      await this.schedules.update({ tenantId: tenant.id, userId: user.sub }, id, scheduleId, dto),
    );
  }

  @Delete('definitions/:id/schedules/:scheduleId')
  @HttpCode(204)
  @RequirePermissions(Permission.REPORTS_DESIGN)
  async removeSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.schedules.remove({ tenantId: tenant.id, userId: user.sub }, id, scheduleId);
  }

  @Post('runs/:id/snapshot')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.REPORTS_EXPORT)
  @ApiOperation({ summary: "Keep today's copy of one of your runs. It never expires." })
  @ApiOkResponse({ type: ReportSnapshotDto })
  freeze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReportSnapshotDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReportSnapshotDto> {
    return this.snapshots.freeze(
      { tenantId: tenant.id, userId: user.sub, role: tenant.role },
      id,
      dto,
    );
  }

  @Get('snapshots')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Kept copies you may download, newest first.' })
  @ApiOkResponse({ type: ReportSnapshotPageDto })
  listSnapshots(
    @Query() query: ListReportSnapshotsQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<ReportSnapshotPageDto> {
    return this.snapshots.list({ tenantId: tenant.id, userId: user.sub, role: tenant.role }, query);
  }

  @Get('snapshots/:id/download')
  @RequirePermissions(Permission.REPORTS_EXPORT)
  @ApiOperation({ summary: 'The kept file. Visibility is checked again on every download.' })
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ): Promise<StreamableFile> {
    return this.snapshots.download(
      { tenantId: tenant.id, userId: user.sub, role: tenant.role },
      id,
    );
  }
}

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  Inject,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseInterceptors,
} from '@nestjs/common';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { CommunicationsService } from './communications.service';
import { BulkReminderService } from './reminders.service';
import { SingleReminderService } from './single-reminder.service';
import {
  SendGuardianMessageDto,
  QueryLastRemindersDto,
  LastReminderDto,
} from './dto/communications.dto';
import {
  SendBulkReminderDto,
  QueryReminderBatchesDto,
  QueryReminderBatchLogsDto,
  QueryCommunicationLogsDto,
  ReminderBatchLogDto,
  MessageLogFilterOptionsDto,
} from './dto/reminders.dto';
import { DeliveryStatusService } from './delivery-status.service';
import { SendSingleReminderDto } from './dto/single-reminder.dto';
import { JwtPayload, Permission, RoleScope, roleScope } from '@biddaloy/shared';
import { FamilyAccessService } from '../students/family-access.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { requestContext } from '../../common/request-context.util';

@ApiTags('communications')
@ApiTenantAuth()
@Controller('communications')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CommunicationsController {
  constructor(
    @Inject(CommunicationsService) private readonly communicationsService: CommunicationsService,
    @Inject(BulkReminderService) private readonly bulkReminderService: BulkReminderService,
    @Inject(SingleReminderService) private readonly singleReminderService: SingleReminderService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
    @Inject(TeacherScopeService) private readonly teacherScope: TeacherScopeService,
    @Inject(DeliveryStatusService) private readonly deliveryStatus: DeliveryStatusService,
  ) {}

  // Distinct segment count from reminder/bulk(/:id) above and reminder/single/:studentId
  // below, so there's no route-ordering ambiguity — declared first to read
  // preview-before-send, matching the issue's "shows preview before sending."
  @Post('reminder/single/:studentId/preview')
  @HttpCode(HttpStatus.OK)
  // [68.1.fix] No @Roles: once TEACHER lost COMMUNICATION_SEND (JOBS-03) the permission alone
  // admits exactly ADMIN/ACCOUNTANT/OFFICE_STAFF, so the role list narrowed nothing (#1357).
  @RequirePermissions(Permission.COMMUNICATION_SEND)
  @ApiOperation({
    summary: 'Render a single-student reminder without sending it, for the sender to review first.',
  })
  previewSingleReminder(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SendSingleReminderDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.singleReminderService.preview(studentId, dto, tenant.id);
  }

  @Post('reminder/single/:studentId')
  @UseInterceptors(IdempotencyInterceptor)
  // [68.1.fix] No @Roles — see the preview route above.
  @RequirePermissions(Permission.COMMUNICATION_SEND)
  @ApiOperation({ summary: 'Send a fee reminder to one student/guardian.' })
  sendSingleReminder(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: SendSingleReminderDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.singleReminderService.sendSingle(
      studentId,
      dto,
      tenant.id,
      user.sub,
      requestContext(request),
    );
  }

  // Declared before the send route below, matching the single-reminder
  // pair above: preview-before-send is the reading order the epic mandates.
  //
  // Same STRICT_RATE_LIMIT as the send route it mirrors. Preview runs the
  // identical resolution work (student + guardian + dues loads for up to
  // 500 students) and hands back every guardian's name, channel and
  // contact address. On the default tier one ACCOUNTANT token could page
  // the tenant's whole guardian directory out through it; the fact that
  // nothing is sent makes it cheaper to abuse, not safer.
  @Post('reminder/bulk/preview')
  @HttpCode(HttpStatus.OK)
  // [10.4] G1 — E tightened off: lacks COMMUNICATION_BULK_SEND.
  @RequirePermissions(Permission.COMMUNICATION_BULK_SEND)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Resolve a bulk reminder without sending it — who would receive what, and who would be skipped and why.',
  })
  previewBulkReminder(
    @Body() dto: SendBulkReminderDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.bulkReminderService.previewBulk(dto, tenant.id, user.sub, requestContext(request));
  }

  // Declared before @Get(':id') — Nest matches in declaration order, and
  // 'reminder' would otherwise be swallowed by the UUID param route and
  // rejected by its ParseUUIDPipe.
  @Post('reminder/bulk')
  @UseInterceptors(IdempotencyInterceptor)
  // [10.4] G1 — E tightened off.
  @RequirePermissions(Permission.COMMUNICATION_BULK_SEND)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Queue fee reminders to every student/guardian matching the given filters.',
  })
  sendBulkReminder(
    @Body() dto: SendBulkReminderDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.bulkReminderService.sendBulk(dto, tenant.id, user.sub, requestContext(request));
  }

  // Declared before @Get(':id') — same reasoning as the POST above:
  // 'reminder' would otherwise be swallowed by the UUID param route.
  @Get('reminder/bulk')
  // [10.4] G1 — E tightened off.
  @RequirePermissions(Permission.COMMUNICATION_BULK_SEND)
  @ApiOperation({
    summary: 'Reminder History — every bulk reminder batch this tenant sent, newest first.',
  })
  findReminderBatches(
    @Query() query: QueryReminderBatchesDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.bulkReminderService.findBatches(query, tenant.id);
  }

  @Get('reminder/bulk/:id/logs')
  // [10.4] G1 — E tightened off.
  @RequirePermissions(Permission.COMMUNICATION_BULK_SEND)
  @ApiOperation({
    summary: "One batch's per-recipient delivery records, for the batch detail page.",
  })
  findReminderBatchLogs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryReminderBatchLogsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.bulkReminderService.findBatchLogs(id, query, tenant.id, tenant.role);
  }

  @Get('reminder/bulk/:id')
  // [10.4] G1 — E tightened off.
  @RequirePermissions(Permission.COMMUNICATION_BULK_SEND)
  @ApiOperation({
    summary: 'Get a bulk reminder batch, including its per-recipient delivery status.',
  })
  findReminderBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.bulkReminderService.findBatch(id, tenant.id);
  }

  // Declared before @Get(':id') — 'logs' would otherwise hit the UUID param route.
  // BULK_SEND, not LOG_READ: teachers hold LOG_READ and this list is tenant-wide (Rule 2).
  @Get('logs')
  @RequirePermissions(Permission.COMMUNICATION_BULK_SEND)
  @ApiOperation({
    summary: 'Message log — every message this tenant sent, newest first, filter by status.',
  })
  findLogs(
    @Query() query: QueryCommunicationLogsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.bulkReminderService.findLogs(query, tenant.id, tenant.role);
  }

  // [97.4.02] D22: the Company and Sent-by filter choices, on the log's own permission, so
  // Accountant and Office staff (no SETTINGS_MANAGE / USER_READ) get them too.
  @Get('logs/filter-options')
  @RequirePermissions(Permission.COMMUNICATION_BULK_SEND)
  @ApiOperation({ summary: 'Message log — the Company and Sent-by filter choices.' })
  @ApiOkResponse({ type: MessageLogFilterOptionsDto })
  findLogFilterOptions(@CurrentTenant() tenant: { id: string; role: string }) {
    return this.bulkReminderService.findLogFilterOptions(tenant.id);
  }

  // [97.4.01] D23/D35: the message log page's permission only. The Idempotency-Key replays a
  // double click instead of asking the vendor twice (Rule 25). The cooldown is per log, so the
  // route also carries STRICT_RATE_LIMIT: many logs in a row cannot flood the vendor.
  @Post('logs/:id/check-status')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @RequirePermissions(Permission.COMMUNICATION_BULK_SEND)
  @ApiOperation({
    summary: 'Ask the company that sent this SMS/message whether it was delivered (once a minute).',
  })
  @ApiOkResponse({ type: ReminderBatchLogDto })
  checkStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.deliveryStatus.checkStatus(id, tenant.id, tenant.role);
  }

  @Post('send')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.COMMUNICATION_SEND)
  @ApiOperation({ summary: 'Send a freeform (non-reminder) message.' })
  send(
    @Body() dto: SendGuardianMessageDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.communicationsService.sendToGuardian(dto, tenant.id, user.sub);
  }

  // Declared before `@Get(':id')` — same reasoning as `reminder/bulk`
  // above: 'last-reminders' would otherwise be swallowed by the UUID
  // param route and rejected by its ParseUUIDPipe.
  @Get('last-reminders')
  // [10.4] G5 — per-student communication history; visible via STUDENT_READ.
  @RequirePermissions(Permission.COMMUNICATION_LOG_READ)
  @ApiOperation({
    summary: "Batch lookup of each student's most recent fee reminder, for [8.10.4]'s dues queue.",
  })
  @ApiOkResponse({ type: LastReminderDto, isArray: true })
  async findLastReminders(
    @Query() query: QueryLastRemindersDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // [75.6-d] TEACHER: keep only students in current-year assigned sections (`null` = unrestricted).
    const scoped = await this.teacherScope.scopedStudentIds({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
    const visible = scoped && new Set(scoped);
    const studentIds = visible
      ? query.student_ids.filter((id) => visible.has(id))
      : query.student_ids;
    return this.communicationsService.findLastReminders(studentIds, tenant.id).then((byStudent) =>
      Array.from(byStudent.entries()).map(([student_id, reminder]) => ({
        student_id,
        ...reminder,
      })),
    );
  }

  // Declared before `@Get(':id')` — same reasoning as `reminder/bulk`
  // above: 'student' would otherwise be swallowed by the UUID param route
  // and rejected by its ParseUUIDPipe.
  @Get('student/:studentId')
  // [10.4] G5 — per-student communication history.
  @RequirePermissions(Permission.COMMUNICATION_LOG_READ)
  @ApiOperation({
    summary: "Get every message sent about a student's guardians, newest first.",
  })
  async findByStudent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (this.isTeacher(tenant.role)) {
      await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    }
    return this.communicationsService.findByStudent(studentId, tenant.id);
  }

  // Declared before `@Get(':id')` — same reasoning as `student/:studentId`
  // above.
  @Get('guardian/:guardianId')
  // [10.4] G5 — per-student communication history.
  @RequirePermissions(Permission.COMMUNICATION_LOG_READ)
  @ApiOperation({
    summary: 'Get every message sent directly to a guardian, newest first.',
  })
  async findByGuardian(
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const caller = { role: tenant.role, userId: user.sub, tenantId: tenant.id };
    const scope = await this.teacherScope.assertCanSeeGuardian({ ...caller, guardianId });
    const scoped = await this.teacherScope.scopedStudentIds({ ...caller, scope });
    return this.communicationsService.findByGuardian(guardianId, tenant.id, scoped ?? undefined);
  }

  @Get(':id')
  // [10.4] G5 — per-student communication history.
  @RequirePermissions(Permission.COMMUNICATION_LOG_READ)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (this.isTeacher(tenant.role)) {
      // D13: every teacher miss reads exactly like a missing log. D36: a guardian-level log (no
      // student) can be about a sibling outside scope, so a teacher never opens one.
      const notFound = new NotFoundException('Communication log not found');
      const owner = await this.communicationsService.findOwner(id, tenant.id);
      if (!owner?.student_id) throw notFound;
      await this.familyAccess
        .assertLinked(tenant.role, user.sub, owner.student_id, tenant.id)
        .catch((e: unknown) => {
          throw e instanceof NotFoundException ? notFound : e;
        });
    }
    return this.communicationsService.findOne(id, tenant.id);
  }

  private isTeacher(role: string): boolean {
    return roleScope(role) === RoleScope.ASSIGNED_SECTIONS;
  }
}

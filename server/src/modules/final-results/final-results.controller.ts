import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApprovalScope, JwtPayload, Permission, UserRole } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { requestContext } from '../../common/request-context.util';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { ResultSmsService } from '../exams/result-sms.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApprovalContext, ApprovalGuard } from '../auth/guards/approval.guard';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  CreateFinalResultBodyDto,
  FinalResultRowsQueryDto,
  ListFinalResultsQueryDto,
  UpdateFinalResultBodyDto,
} from './dto/final-results.dto';
import { FinalResultsService } from './final-results.service';

type Tenant = { id: string; role: string };

const READ_ROLES = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
] as const;

/** [70.2.1] Cross-exam final results. Same guards and shape as `ResultsController`. */
@ApiTags('final-results')
@ApiTenantAuth()
@Controller('final-results')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, ApprovalGuard)
export class FinalResultsController {
  constructor(
    private readonly service: FinalResultsService,
    private readonly smsService: ResultSmsService,
    private readonly teacherScope: TeacherScopeService,
  ) {}

  private requireApproval(request: Request): ApprovalContext {
    const approval = (request as unknown as { approval?: ApprovalContext }).approval;
    if (!approval) {
      throw new InternalServerErrorException(
        'ApprovalGuard did not run before a final result reopen — @RequireApproval guard misconfigured',
      );
    }
    return approval;
  }

  @Get()
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({
    summary: 'One line per class of the year: its final result status, or not set up.',
  })
  list(@Query() query: ListFinalResultsQueryDto, @CurrentTenant() tenant: Tenant) {
    return this.service.list(query.academic_year_id, tenant.id);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({
    summary:
      "Set up a class's final result for a year: switches from last year, equal shares over its published term exams.",
  })
  create(
    @Body() dto: CreateFinalResultBodyDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.create(dto, tenant.id, user.sub, requestContext(request));
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({ summary: 'One final result with its shares, switches and counts.' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: Tenant) {
    return this.service.get(id, tenant.id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({ summary: 'Change the shares and switches. Draft only.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinalResultBodyDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.update(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({ summary: 'Delete a draft final result.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.service.remove(id, tenant.id, user.sub, requestContext(request));
  }

  @Post(':id/build')
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({ summary: "Compute every student's final row (draft or processed -> processed)." })
  build(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.build(id, tenant.id, user.sub, requestContext(request));
  }

  @Post(':id/publish')
  @RequirePermissions(Permission.RESULT_PUBLISH)
  @ApiOperation({ summary: 'Publish a built final result and snapshot attendance.' })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.service.publish(id, tenant.id, user.sub, requestContext(request));
    return { published: true };
  }

  @Post(':id/reopen')
  @RequirePermissions(Permission.RESULT_PUBLISH)
  @RequireApproval(ApprovalScope.RESULTS_REOPEN)
  @ApiOperation({
    summary: 'Reopen a published final result (published -> processed). Step-up approval.',
  })
  async reopen(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const approval = this.requireApproval(request);
    await this.service.reopen(id, tenant.id, user.sub, requestContext(request), approval);
    return { reopened: true };
  }

  @Post(':id/sms')
  @RequirePermissions(Permission.RESULT_PUBLISH)
  @ApiOperation({ summary: "Send every guardian their child's published final result by SMS." })
  sendSms(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    // Exempt from IdempotencyInterceptor like the exam SMS: the unique `reference_key` dedups.
    return this.smsService.sendForFinal(id, tenant.id, user.sub, requestContext(request));
  }

  @Get(':id/rows')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({
    summary: 'One page of student rows (limit up to 100). Teachers see their sections.',
  })
  async rows(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FinalResultRowsQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.teacherScope.sectionScope({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      // Rows show every subject: class coordinators only (83.3.1 D4).
      includeCoordinated: 'classLevel',
    });
    return this.service.rows(id, tenant.id, query, scope);
  }

  @Get(':id/students/:studentId')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({ summary: "One student's final report-card data." })
  async studentCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    const input = {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      includeCoordinated: 'classLevel' as const,
    };
    // A student outside the teacher's sections is a 404, never a 403 (Rule 2).
    if (
      (await this.teacherScope.sectionScope(input)) &&
      !(await this.teacherScope.canSeeStudent({ ...input, studentId }))
    ) {
      throw new NotFoundException('No final result for this student');
    }
    const card = await this.service.studentCard(id, studentId, tenant.id);
    if (!card) throw new NotFoundException('No final result for this student');
    return card;
  }
}

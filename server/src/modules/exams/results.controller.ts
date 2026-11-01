import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Req,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApprovalGuard, ApprovalContext } from '../auth/guards/approval.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { ResultsService } from './results.service';
import { ResultSmsService } from './result-sms.service';
import { ProcessExamDto } from './dto/results.dto';
import { ApprovalScope, Permission, UserRole, JwtPayload, isGuardianRole } from '@biddaloy/shared';
import { FamilyAccessService } from '../students/family-access.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';

@ApiTags('results')
@ApiTenantAuth()
@Controller('exams/:examId/results')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, ApprovalGuard)
export class ResultsController {
  constructor(
    private readonly resultsService: ResultsService,
    private readonly resultSmsService: ResultSmsService,
    private readonly teacherScope: TeacherScopeService,
  ) {}

  private requireApproval(request: Request): ApprovalContext {
    const approval = (request as unknown as { approval?: ApprovalContext }).approval;
    if (!approval) {
      throw new InternalServerErrorException(
        'ApprovalGuard did not run before a result reopen — @RequireApproval guard misconfigured',
      );
    }
    return approval;
  }

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({ summary: "This exam's per-student results, for the results panel." })
  async list(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const rows = await this.resultsService.list(examId, tenant.id);
    const scope = await this.teacherScope.sectionScope({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      // [83.3.1] D4: these rows show every subject, so class coordinators only.
      includeCoordinated: 'classLevel',
    });
    return scope ? rows.filter((r) => r.section_id && scope.includes(r.section_id)) : rows;
  }

  @Get(':studentId')
  @Roles(
    UserRole.ADMIN,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({
    summary: "One student's result, with subject/component breakdown — the report card's data.",
  })
  async getStudentResult(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // D13: a student outside the teacher's current-year sections is a 404, never a 403.
    // [83.3.1] D4 read: class coordinators of the student's class may read the result too. The
    // result carries every subject, so a subject coordinator does not (they read their subject's
    // marks on the grid instead).
    const input = {
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      includeCoordinated: 'classLevel' as const,
    };
    if (
      (await this.teacherScope.sectionScope(input)) &&
      !(await this.teacherScope.canSeeStudent({ ...input, studentId }))
    ) {
      throw new NotFoundException('No result for this student on this exam');
    }
    const detail = await this.resultsService.getStudentResult(examId, studentId, tenant.id);
    if (!detail) {
      throw new NotFoundException('No result for this student on this exam');
    }
    return detail;
  }

  @Post('process')
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({ summary: "Compute and store every enrolled student's result for this exam." })
  process(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: ProcessExamDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.resultsService.process(
      examId,
      tenant.id,
      user.sub,
      dto.force ?? false,
      requestContext(request),
    );
  }

  @Post('publish')
  @RequirePermissions(Permission.RESULT_PUBLISH)
  @ApiOperation({ summary: "Publish a processed exam's results (PROCESSED -> PUBLISHED)." })
  async publish(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.resultsService.publish(examId, tenant.id, user.sub, requestContext(request));
    return { published: true };
  }

  @Post('reopen')
  @RequirePermissions(Permission.RESULT_PUBLISH)
  @RequireApproval(ApprovalScope.RESULTS_REOPEN)
  @ApiOperation({
    summary:
      "Reopen a published exam's results (PUBLISHED -> PROCESSED). Step-up approval required.",
  })
  async reopen(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const approval = this.requireApproval(request);
    await this.resultsService.reopen(
      examId,
      tenant.id,
      user.sub,
      requestContext(request),
      approval,
    );
    return { reopened: true };
  }

  @Post('sms')
  @RequirePermissions(Permission.RESULT_PUBLISH)
  @ApiOperation({ summary: "Send every guardian their child's published result by SMS." })
  sendSms(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.resultSmsService.sendForExam(examId, tenant.id, user.sub, requestContext(request));
  }
}

/**
 * [19.9.1] One student's results across every exam, in one call — the
 * aggregate `ResultsController`'s per-exam routes never provided (they're
 * scoped to one exam at a time). Two callers share this route:
 *
 * - Staff (student detail's Results panel): every exam this student has a
 *   `Result` row for, published or not, each one labelled by the client
 *   from `published` — so staff never mistake an unpublished grade for a
 *   publishable one.
 * - A PARENT/STUDENT (the portal): the SAME route, narrowed two ways —
 *   `FamilyAccessService.assertLinked` (their own linked child only, same
 *   pattern as `fees.controller.ts`'s `findPaymentsByStudent`) and
 *   `publishedOnly: true` passed to the service, so an unpublished exam is
 *   entirely absent from the response, never present-but-flagged (D19).
 *
 * This is why the #19.8.1 `ROLE_NARROWINGS` entries on
 * `GET /exams/:examId/results(/:studentId)` say "not this staff list" —
 * this route is the "19.9.1" they pointed at.
 */
@ApiTags('results')
@ApiTenantAuth()
@Controller('students/:studentId/results')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentResultsController {
  constructor(
    private readonly resultsService: ResultsService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  @Get()
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({
    summary:
      "A student's results across every exam. Staff see every exam including unpublished ones; a PARENT or STUDENT (additionally linkage-checked) sees published exams only.",
  })
  async listForStudent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    return this.resultsService.listForStudent(studentId, tenant.id, isGuardianRole(tenant.role));
  }

  @Get(':examId')
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({
    summary:
      'The report-card data (breakdown + grading legend) for one exam. Same publish/linkage gating as the list above.',
  })
  async getStudentResultCard(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const card = await this.resultsService.getStudentResultCard(
      examId,
      studentId,
      tenant.id,
      isGuardianRole(tenant.role),
    );
    if (!card) {
      throw new NotFoundException('No result for this student on this exam');
    }
    return card;
  }
}

import { Controller, Get, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LOW_ATTENDANCE_FLAG_ROLES, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AttendanceSummaryService } from './attendance-summary.service';
import { AttendanceAccessService } from './attendance-access.service';
import { FamilyAccessService } from '../students/family-access.service';
import {
  AttendanceStreaksDto,
  AttendanceSummaryDto,
  LowAttendanceListResponseDto,
  QueryLowAttendanceDto,
  QueryRegisterMatrixDto,
  QuerySectionSummaryDto,
  QueryStudentDaysDto,
  QueryStudentSummaryDto,
  RegisterMatrixDto,
  SectionSummaryDto,
  SubjectSummaryDto,
  resolveDateRange,
} from './dto/attendance-summary.dto';

/**
 * The five exam-facing read endpoints [9.4] ships. `@Roles(...)` is only
 * the coarse gate; the real object-level checks are
 * `FamilyAccessService.assertLinked` for the two student-scoped routes
 * (PARENT/STUDENT only reach their own linked children) and
 * `AttendanceAccessService.assertCanAccessSection` for the two
 * section-scoped routes (TEACHER only reaches mapped sections) — same
 * pattern as `attendance.controller.ts` and `family-read-api.e2e-spec.ts`.
 */
@ApiTags('attendance')
@ApiTenantAuth()
@Controller('attendance')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AttendanceSummaryController {
  constructor(
    private readonly summaryService: AttendanceSummaryService,
    private readonly attendanceAccessService: AttendanceAccessService,
    private readonly familyAccessService: FamilyAccessService,
  ) {}

  @Get('students/:studentId/summary')
  @RequirePermissions(Permission.ATTENDANCE_READ)
  @ApiOperation({
    summary:
      "One student's attendance percentage and counts over a range — the single source every " +
      'downstream surface (portal, exam eligibility) reads.',
  })
  @ApiOkResponse({ type: AttendanceSummaryDto })
  async getStudentSummary(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: QueryStudentSummaryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    await this.familyAccessService.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const { from, to } = resolveDateRange(query);
    return this.summaryService.getStudentSummary({ tenantId: tenant.id, studentId, from, to });
  }

  @Get('students/:studentId/days')
  @RequirePermissions(Permission.ATTENDANCE_READ)
  @ApiOperation({
    summary: "One student's day-by-day marks for one month — drives the portal month grid.",
  })
  async getStudentDays(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: QueryStudentDaysDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    await this.familyAccessService.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const { from, to } = resolveDateRange({ month: query.month });
    return this.summaryService.getStudentDays({ tenantId: tenant.id, studentId, from, to });
  }

  @Get('sections/:sectionId/summary')
  @Roles(
    UserRole.ADMIN,
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.ATTENDANCE_READ)
  @ApiOperation({
    summary: "A whole section's roster attendance over a range, one row per student.",
  })
  @ApiOkResponse({ type: SectionSummaryDto })
  async getSectionSummary(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Query() query: QuerySectionSummaryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    await this.attendanceAccessService.assertCanAccessSection(
      tenant.role,
      user.sub,
      sectionId,
      tenant.id,
      { includeCoordinated: true }, // [83.3.1] D4 read
    );
    return this.summaryService.getSectionSummary({
      tenantId: tenant.id,
      sectionId,
      from: query.from,
      to: query.to,
    });
  }

  @Get('sections/:sectionId/register-matrix')
  @Roles(
    UserRole.ADMIN,
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.ATTENDANCE_READ)
  @ApiOperation({
    summary:
      "One month's whole register for a section, as a date x student matrix — the printable " +
      'paper-register replacement ([9.10] owns rendering).',
  })
  @ApiOkResponse({ type: RegisterMatrixDto })
  async getSectionRegisterMatrix(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Query() query: QueryRegisterMatrixDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    await this.attendanceAccessService.assertCanAccessSection(
      tenant.role,
      user.sub,
      sectionId,
      tenant.id,
      { includeCoordinated: true }, // [83.3.1] D4 read
    );
    const { from, to } = resolveDateRange({ month: query.month });
    return this.summaryService.getSectionRegisterMatrix({
      tenantId: tenant.id,
      sectionId,
      from,
      to,
    });
  }

  @Get('sections/:sectionId/subject-summary')
  @Roles(
    UserRole.ADMIN,
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.ATTENDANCE_READ)
  @ApiOperation({
    summary:
      'Per student and subject: period classes held and attended over a range. ' +
      '403 ATTENDANCE_PERIOD_DISABLED when period attendance is off.',
  })
  @ApiOkResponse({ type: SubjectSummaryDto })
  async getSectionSubjectSummary(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Query() query: QuerySectionSummaryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    await this.attendanceAccessService.assertCanAccessSection(
      tenant.role,
      user.sub,
      sectionId,
      tenant.id,
      { includeCoordinated: true }, // [83.3.1] D4 read
    );
    return this.summaryService.getSectionSubjectSummary({
      tenantId: tenant.id,
      sectionId,
      from: query.from,
      to: query.to,
    });
  }

  @Get('sections/:sectionId/streaks')
  @Roles(
    UserRole.ADMIN,
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.ATTENDANCE_READ)
  @ApiOperation({
    summary:
      'Students on a current run of 3+ ABSENT, 3+ LATE or 15+ PRESENT day-sessions ' +
      '(LEAVE and unmarked days end a run).',
  })
  @ApiOkResponse({ type: AttendanceStreaksDto })
  async getSectionStreaks(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: { sub: string },
  ) {
    await this.attendanceAccessService.assertCanAccessSection(
      tenant.role,
      user.sub,
      sectionId,
      tenant.id,
      { includeCoordinated: true }, // [83.3.1] D4 read
    );
    return this.summaryService.getSectionStreaks({ tenantId: tenant.id, sectionId });
  }

  @Get('flags/low')
  @Roles(...LOW_ATTENDANCE_FLAG_ROLES)
  @RequirePermissions(Permission.ATTENDANCE_READ)
  @ApiOperation({
    summary:
      'Students below the low-attendance threshold over a range. Students with no data ' +
      '(`attendance_percentage === null`) are excluded, not flagged.',
  })
  @ApiOkResponse({ type: LowAttendanceListResponseDto })
  async getLowAttendanceFlags(
    @Query() query: QueryLowAttendanceDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.summaryService.getLowAttendanceFlags({
      tenantId: tenant.id,
      from: query.from,
      to: query.to,
      thresholdPercent: query.threshold,
      classId: query.class_id,
      sectionId: query.section_id,
      page: query.page,
      limit: query.limit,
    });
  }
}

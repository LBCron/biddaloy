import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Inject,
  ParseUUIDPipe,
  Req,
  NotFoundException,
} from '@nestjs/common';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { requestContext } from '../../common/request-context.util';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import {
  StudentService,
  GuardianService,
  assertCanWriteProfileFields,
  redactHealthNotes,
} from './students.service';
import { StudentBulkUploadService } from './bulk-upload.service';
import { FamilyAccessService } from './family-access.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import {
  CreateStudentDto,
  UpdateStudentDto,
  UpdateStudentRecordsDto,
  QueryStudentDto,
  QueryStudentIdsDto,
  StudentIdsResultDto,
  CreateGuardianDto,
  UpdateGuardianDto,
  UpdateOwnGuardianDto,
  QueryGuardianDto,
  CommitBulkUploadDto,
} from './dto/students.dto';
import { UserRole, JwtPayload, Permission, roleHasPermission } from '@biddaloy/shared';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';

const BULK_UPLOAD_MAX_FILE_SIZE = 5 * 1024 * 1024;

const canReadRecords = (role: string) => roleHasPermission(role, Permission.STUDENT_RECORDS_READ);
const canWriteRecords = (role: string) => roleHasPermission(role, Permission.STUDENT_RECORDS_WRITE);

@ApiTags('students')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentController {
  constructor(
    @Inject(StudentService) private readonly studentService: StudentService,
    @Inject(GuardianService) private readonly guardianService: GuardianService,
    @Inject(StudentBulkUploadService) private readonly bulkUploadService: StudentBulkUploadService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
    @Inject(TeacherScopeService) private readonly teacherScope: TeacherScopeService,
  ) {}

  // --- Student endpoints ---

  @Post('students')
  @UseInterceptors(IdempotencyInterceptor)
  // [10.4] G3 grants AC STUDENT_CREATE (front-office intake); G1 tightens E
  // off (no write surface).
  @RequirePermissions(Permission.STUDENT_CREATE)
  async createStudent(
    @Body() dto: CreateStudentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    assertCanWriteProfileFields(dto, canWriteRecords(tenant.role));
    const student = await this.studentService.create(dto, tenant.id, undefined, {
      userId: user.sub,
      context: requestContext(request),
    });
    return redactHealthNotes(student, canReadRecords(tenant.role));
  }

  // [14.9.1] Split from a single write-on-upload endpoint into validate +
  // commit, staged on `ImportStagingService` (same pattern as the backup
  // workbook import). No shim for the old `POST /students/bulk-upload` —
  // callers must move to the two-step flow.
  @Post('students/bulk-upload/validate')
  @RequirePermissions(Permission.STUDENT_BULK_UPLOAD)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BULK_UPLOAD_MAX_FILE_SIZE } }))
  @ApiOperation({
    summary:
      'Validate a CSV/XLSX spreadsheet of students and their guardians (max 5MB) and stage the accepted rows. Writes nothing.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  validateBulkUploadStudents(
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bulkUploadService.validate(file, tenant.id, user.sub);
  }

  @Post('students/bulk-upload/commit')
  @RequirePermissions(Permission.STUDENT_BULK_UPLOAD)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary: 'Commit a previously validated, staged bulk upload — actually creates the students.',
  })
  commitBulkUploadStudents(
    @Body() dto: CommitBulkUploadDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.bulkUploadService.commit(dto.staging_id, tenant.id, user.sub);
  }

  @Get('students')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.STUDENT_READ)
  async findAllStudents(
    @Query() query: QueryStudentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.teacherScope.sectionScope({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      // [83.3.1] D4 read: coordinators also see the students of their classes.
      includeCoordinated: true,
    });
    const page = await this.studentService.findAll(query, tenant.id, scope);
    return redactHealthNotes(page, canReadRecords(tenant.role));
  }

  /**
   * MUST stay declared above `students/:id` — Nest matches in declaration
   * order, so otherwise `mine` would be captured as a student id and the
   * `ParseUUIDPipe` on that param would answer 400 instead of this route. [5.1]
   */
  @Get('students/mine')
  @Roles(UserRole.PARENT, UserRole.STUDENT)
  @RequirePermissions(Permission.STUDENT_READ)
  @ApiOperation({
    summary:
      "List the students the calling PARENT or STUDENT is linked to. The discovery route for the family portal: without it a parent has no way to learn their own children's IDs.",
  })
  async findMyStudents(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const students = await this.familyAccess.getLinkedStudents(tenant.role, user.sub, tenant.id);
    return redactHealthNotes(students, canReadRecords(tenant.role));
  }

  /**
   * [16.3.3] MUST stay declared above `students/:id` — same reasoning as
   * `students/mine` above: otherwise `ids` would be matched as a student id
   * and the `ParseUUIDPipe` would answer 400.
   */
  @Get('students/ids')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  )
  @RequirePermissions(Permission.STUDENT_READ)
  @ApiOperation({
    summary:
      'All student IDs matching the given filters, unpaginated — backs the audience picker\'s "select all matching" action. Capped; returns 413 when the match count exceeds the cap.',
  })
  @ApiOkResponse({ type: StudentIdsResultDto })
  async findAllStudentIds(
    @Query() query: QueryStudentIdsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<StudentIdsResultDto> {
    const scope = await this.teacherScope.sectionScope({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      // [83.3.1] D4 read: coordinators also see the students of their classes.
      includeCoordinated: true,
    });
    return this.studentService.findAllIds(query, tenant.id, scope);
  }

  @Get('students/:id')
  @RequirePermissions(Permission.STUDENT_READ)
  @ApiOperation({
    summary:
      "Get a single student. A PARENT or STUDENT caller additionally must be linked to this specific student — role alone isn't enough.",
  })
  async findOneStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Object-level authorization for PARENT/STUDENT/TEACHER; a no-op for tenant-wide staff.
    // [5.1] moved the check that used to be inline here into
    // FamilyAccessService so every widened family route shares one copy.
    // Before the lookup (D13): a missing id and someone else's student give the same answer.
    // [83.3.1] D4 read: a coordinator of the student's class sees the student too.
    await this.familyAccess.assertLinked(tenant.role, user.sub, id, tenant.id, {
      includeCoordinated: true,
    });
    const student = await this.studentService.findOne(id, tenant.id);
    return redactHealthNotes(student, canReadRecords(tenant.role));
  }

  @Patch('students/:id')
  // [10.4] G3, G1 — same reasoning as createStudent() above.
  @RequirePermissions(Permission.STUDENT_UPDATE)
  async updateStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    assertCanWriteProfileFields(dto, canWriteRecords(tenant.role));
    const student = await this.studentService.update(
      id,
      dto,
      tenant.id,
      user.sub,
      requestContext(request),
    );
    return redactHealthNotes(student, canReadRecords(tenant.role));
  }

  /**
   * [39.2.4] The Records tab's save. Its own route so an EXECUTIVE, who holds STUDENT_RECORDS_WRITE
   * but not STUDENT_UPDATE, can edit the five profile fields without being handed general student
   * updates. Only those five fields are accepted (`forbidNonWhitelisted`), so it cannot move a
   * student between sections or change a status.
   */
  @Patch('students/:id/records')
  @RequirePermissions(Permission.STUDENT_RECORDS_WRITE)
  async updateStudentRecords(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentRecordsDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const student = await this.studentService.update(
      id,
      dto,
      tenant.id,
      user.sub,
      requestContext(request),
    );
    return redactHealthNotes(student, canReadRecords(tenant.role));
  }

  @Delete('students/:id')
  @RequirePermissions(Permission.STUDENT_DELETE)
  removeStudent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.studentService.remove(id, tenant.id, user.sub, requestContext(request));
  }

  // --- Guardian endpoints ---

  @Post('guardians')
  // [10.4] G3 grants AC GUARDIAN_CREATE; G1 tightens E off.
  @RequirePermissions(Permission.GUARDIAN_CREATE)
  async createGuardian(
    @Body() dto: CreateGuardianDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const guardian = await this.guardianService.create(
      dto,
      tenant.id,
      undefined,
      user.sub,
      requestContext(request),
    );
    return redactHealthNotes(guardian, canReadRecords(tenant.role));
  }

  @Get('guardians')
  // GUARDIAN_READ is staff-only (no PARENT/STUDENT/EXECUTIVE), so the permission alone gates this.
  @RequirePermissions(Permission.GUARDIAN_READ)
  async findAllGuardians(
    @Query() query: QueryGuardianDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.teacherScope.sectionScope({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      // [83.3.1] D4 read: coordinators also see the students of their classes.
      includeCoordinated: true,
    });
    const page = await this.guardianService.findAll(query, tenant.id, scope);
    return redactHealthNotes(page, canReadRecords(tenant.role));
  }

  /**
   * MUST stay declared above `guardians/:id` (PATCH has a bare
   * `@Param('id')`, so `mine` would be captured as an id). [5.4a]
   *
   * PARENT only: STUDENT accounts link through `students.user_id`, not a
   * guardian row, so they get a 403 rather than a guaranteed 404.
   */
  @AuthenticatedOnly()
  @Get('guardians/mine')
  @Roles(UserRole.PARENT)
  @ApiOperation({
    summary:
      "Read the guardian record linked to the calling PARENT's own account. Ownership comes from the JWT, never a path id.",
  })
  async findMyGuardian(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const guardian = await this.guardianService.findOwn(user.sub, tenant.id);
    return redactHealthNotes(guardian, canReadRecords(tenant.role));
  }

  /** See the ordering note on `GET guardians/mine`. */
  @AuthenticatedOnly()
  @Patch('guardians/mine')
  @Roles(UserRole.PARENT)
  @ApiOperation({
    summary:
      "Update the contact details on the calling PARENT's own guardian record. These are the fields fee reminders dial, so a stale number is self-fixable.",
  })
  async updateMyGuardian(
    @Body() dto: UpdateOwnGuardianDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const guardian = await this.guardianService.updateOwn(
      user.sub,
      dto,
      tenant.id,
      requestContext(request),
    );
    return redactHealthNotes(guardian, canReadRecords(tenant.role));
  }

  @Get('guardians/:id')
  @RequirePermissions(Permission.GUARDIAN_READ)
  async findOneGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Before the lookup (D13): a missing id and someone else's guardian give the same 404.
    const scope = await this.teacherScope.assertCanSeeGuardian({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      guardianId: id,
      includeCoordinated: true, // [83.3.1] D4 read
    });
    const guardian = await this.guardianService.findOne(id, tenant.id);
    if (scope) {
      // Only the children the teacher teaches; siblings elsewhere stay hidden.
      guardian.students = (guardian.students ?? []).filter(
        (s) => s.class_section_id && scope.includes(s.class_section_id),
      );
      if (guardian.students.length === 0) {
        throw new NotFoundException('Guardian not found');
      }
    }
    return redactHealthNotes(guardian, canReadRecords(tenant.role));
  }

  @Patch('guardians/:id')
  // [10.4] G3 grants AC GUARDIAN_UPDATE; G1 tightens E off.
  @RequirePermissions(Permission.GUARDIAN_UPDATE)
  async updateGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuardianDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    const guardian = await this.guardianService.update(
      id,
      dto,
      tenant.id,
      user.sub,
      requestContext(request),
    );
    return redactHealthNotes(guardian, canReadRecords(tenant.role));
  }

  @Delete('guardians/:id')
  // [10.4] G15 — new GUARDIAN_DELETE, mirrors STUDENT_DELETE.
  @RequirePermissions(Permission.GUARDIAN_DELETE)
  removeGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.guardianService.remove(id, tenant.id, user.sub, requestContext(request));
  }
}

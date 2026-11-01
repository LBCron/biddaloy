import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Readable } from 'stream';
import { IsNull, Repository } from 'typeorm';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission, toCsvContent } from '@biddaloy/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AnalysisQueryDto } from './dto/analysis.dto';
import {
  AnalysisService,
  DefaultedRow,
  MeritRow,
  OverallPassFailRow,
  SubjectPassFailRow,
} from './analysis.service';
import { Exam } from './entities/exam.entity';

const MERIT_CSV_HEADER = [
  'Roll',
  'Name',
  'Section',
  'Total Marks',
  'GPA',
  'Grade',
  'Position',
  'Section Position',
  'Fail',
];

function meritToCsv(rows: MeritRow[]): string {
  const body = rows.map((r) => [
    r.roll_number,
    r.full_name,
    r.section_name ?? '',
    r.total_marks,
    r.gpa,
    r.grade,
    r.position ?? '',
    r.section_position ?? '',
    r.is_fail ? 'Yes' : 'No',
  ]);
  return toCsvContent([MERIT_CSV_HEADER, ...body]);
}

const DEFAULTED_CSV_HEADER = [
  'Roll',
  'Name',
  'Section',
  'Total Marks',
  'GPA',
  'Grade',
  'Fail',
  'Failed Subjects',
  'Absent Subjects',
];

function defaultedToCsv(rows: DefaultedRow[]): string {
  const body = rows.map((r) => [
    r.roll_number,
    r.full_name,
    r.section_name ?? '',
    r.total_marks,
    r.gpa,
    r.grade,
    r.is_fail ? 'Yes' : 'No',
    r.failed_subjects.map((s) => s.name).join('; '),
    r.absent_subjects.map((s) => s.name).join('; '),
  ]);
  return toCsvContent([DEFAULTED_CSV_HEADER, ...body]);
}

const PASS_FAIL_CSV_HEADER = [
  'Subject',
  'Appeared',
  'Passed',
  'Failed',
  'Absent',
  'Pass %',
  'Highest',
  'Average',
];

function passFailToCsv(subjects: SubjectPassFailRow[], overall: OverallPassFailRow): string {
  const body = [...subjects, overall].map((r) => [
    r.subject_name,
    r.appeared,
    r.passed,
    r.failed,
    r.absent,
    r.pass_pct,
    r.highest ?? '',
    r.average ?? '',
  ]);
  return toCsvContent([PASS_FAIL_CSV_HEADER, ...body]);
}

/**
 * [997] `GET /exams/:examId/analysis/*` — read-only merit/defaulted/
 * pass-fail/components views for a processed exam, each also available as
 * CSV. Every route is gated by `MARK_VIEW` (PermissionsGuard).
 * No writes anywhere in this controller (issue step 7's invariant).
 */
@ApiTags('exams')
@ApiTenantAuth()
@Controller('exams/:examId/analysis')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AnalysisController {
  constructor(
    private readonly analysisService: AnalysisService,
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    private readonly teacherScope: TeacherScopeService,
  ) {}

  /** TEACHER: the current-year assigned sections to restrict to (D2); an out-of-scope
   * `section_id` is a 404 (D13). Other roles: `undefined`, so nothing changes. */
  private async restrict(
    tenant: { id: string; role: string },
    user: JwtPayload,
    sectionId?: string,
  ): Promise<string[] | undefined> {
    const ids = await this.teacherScope.sectionScope({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
      // [83.3.1] D4: these rows show every subject, so class coordinators only.
      includeCoordinated: 'classLevel',
    });
    if (!ids) return undefined;
    if (sectionId && !ids.includes(sectionId)) throw new NotFoundException('Section not found');
    return ids;
  }

  private async examName(examId: string, tenantId: string): Promise<string> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam.name;
  }

  @Get('merit')
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Merit list for an exam, optionally section-scoped.' })
  async getMerit(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.analysisService.getMerit(
      examId,
      tenant.id,
      query.section_id,
      await this.restrict(tenant, user, query.section_id),
    );
  }

  @Get('defaulted')
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Defaulted (failed or absent) students for an exam.' })
  async getDefaulted(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.analysisService.getDefaulted(
      examId,
      tenant.id,
      query.section_id,
      await this.restrict(tenant, user, query.section_id),
    );
  }

  @Get('pass-fail')
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Per-subject pass/fail breakdown for an exam.' })
  async getPassFail(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.analysisService.getPassFail(
      examId,
      tenant.id,
      query.section_id,
      await this.restrict(tenant, user, query.section_id),
    );
  }

  @Get('pass-fail/components')
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Per-subject × component pass/fail breakdown for an exam.' })
  async getPassFailComponents(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.analysisService.getPassFailComponents(
      examId,
      tenant.id,
      query.section_id,
      await this.restrict(tenant, user, query.section_id),
    );
  }

  @Get('merit.csv')
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Merit list as CSV.' })
  async getMeritCsv(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const restrict = await this.restrict(tenant, user, query.section_id);
    const [name, { rows }] = await Promise.all([
      this.examName(examId, tenant.id),
      this.analysisService.getMerit(examId, tenant.id, query.section_id, restrict),
    ]);
    // `res.attachment` (Express, via the `content-disposition` package) emits
    // an ASCII-safe `filename` fallback plus an RFC 5987 `filename*` value
    // and escapes quotes — a raw `name` here would otherwise throw
    // `ERR_INVALID_CHAR` for any Bengali exam name (this app ships a `bn`
    // locale). Must come before the Content-Type header: `attachment()` also
    // sets Content-Type, so the explicit charset header has to win by going
    // second.
    res.attachment(`${name}-merit.csv`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return new StreamableFile(Readable.from(Buffer.from(meritToCsv(rows), 'utf-8')));
  }

  @Get('defaulted.csv')
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Defaulted list as CSV.' })
  async getDefaultedCsv(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const restrict = await this.restrict(tenant, user, query.section_id);
    const [name, { rows }] = await Promise.all([
      this.examName(examId, tenant.id),
      this.analysisService.getDefaulted(examId, tenant.id, query.section_id, restrict),
    ]);
    // See getMeritCsv's comment: attachment() first for the ASCII-safe
    // filename fallback, then the explicit Content-Type.
    res.attachment(`${name}-defaulted.csv`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return new StreamableFile(Readable.from(Buffer.from(defaultedToCsv(rows), 'utf-8')));
  }

  @Get('pass-fail.csv')
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({ summary: 'Per-subject pass/fail breakdown as CSV.' })
  async getPassFailCsv(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: AnalysisQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const restrict = await this.restrict(tenant, user, query.section_id);
    const [name, { subjects, overall }] = await Promise.all([
      this.examName(examId, tenant.id),
      this.analysisService.getPassFail(examId, tenant.id, query.section_id, restrict),
    ]);
    // See getMeritCsv's comment: attachment() first for the ASCII-safe
    // filename fallback, then the explicit Content-Type.
    res.attachment(`${name}-pass-fail.csv`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return new StreamableFile(
      Readable.from(Buffer.from(passFailToCsv(subjects, overall), 'utf-8')),
    );
  }
}

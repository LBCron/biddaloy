import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { FailClosedWithoutRedis } from '../../common/rate-limit/app-throttler.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { MarksService } from './marks.service';
import { MARKS_SHEET_MAX_BYTES, MarksImportService } from './marks-import.service';
import {
  CommitMarksSheetDto,
  MarksSheetCommitResultDto,
  MarksSheetValidateResultDto,
} from './dto/marks-sheet.dto';
import { MarkGridService } from './mark-grid.service';
import { BatchMarksDto, GridQueryDto, GridStateActionDto, QueryProgressDto } from './dto/marks.dto';
import { Permission, UserRole, JwtPayload } from '@biddaloy/shared';

/**
 * `@RequirePermissions(...)` here is only the coarse gate ("a TEACHER may
 * attempt this at all") — `MarksAuthorizationService` is the real,
 * object-level check ("which section-subjects"), matching
 * `attendance.controller.ts`'s same two-layer pattern.
 */
@ApiTags('marks')
@ApiTenantAuth()
@Controller('exams/:examId/marks')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class MarksController {
  constructor(
    private readonly marksService: MarksService,
    private readonly gridService: MarkGridService,
    private readonly importService: MarksImportService,
  ) {}

  @Get()
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({
    summary:
      'Get one section-subject grid: students, components, marks, state, derived attendance.',
  })
  getGrid(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: GridQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.gridService.getGrid(
      examId,
      query.section_id,
      query.subject_id,
      tenant.id,
      tenant.role,
      user.sub,
    );
  }

  @Patch()
  @RequirePermissions(Permission.MARK_ENTER)
  @ApiOperation({ summary: 'Batch-upsert marks for a section-subject grid.' })
  upsertBatch(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: BatchMarksDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.marksService.upsertBatch(
      examId,
      dto,
      tenant.id,
      tenant.role,
      user.sub,
      requestContext(request),
    );
  }

  @Post('submit')
  @RequirePermissions(Permission.MARK_ENTER)
  @ApiOperation({ summary: 'Submit a section-subject grid (DRAFT -> SUBMITTED).' })
  submit(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: GridStateActionDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.gridService.submit(
      examId,
      dto,
      tenant.id,
      tenant.role,
      user.sub,
      requestContext(request),
    );
  }

  @Post('reopen')
  @Roles(UserRole.ADMIN)
  @RequirePermissions(Permission.MARK_ENTER)
  @ApiOperation({ summary: 'Reopen a submitted grid (SUBMITTED -> DRAFT). Admin only.' })
  reopen(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: GridStateActionDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.gridService.reopen(
      examId,
      dto,
      tenant.id,
      tenant.role,
      user.sub,
      requestContext(request),
    );
  }

  @Get('progress')
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({
    summary: 'Grid-submission progress for an exam: counts by state plus the outstanding list.',
  })
  progress(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: QueryProgressDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.gridService.progress(examId, tenant.id, query.state, {
      role: tenant.role,
      userId: user.sub,
    });
  }

  @Get('sheet')
  @RequirePermissions(Permission.MARK_VIEW)
  @ApiOperation({
    summary: 'Download the pre-filled marks sheet (.xlsx) for one section-subject grid.',
  })
  async getSheet(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: GridQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.importService.buildSheet(
      examId,
      query,
      tenant.id,
      tenant.role,
      user.sub,
    );
    // `attachment` first (RFC 5987 filename*), then the explicit Content-Type.
    res.attachment(filename);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    return new StreamableFile(buffer);
  }

  @Post('sheet/validate')
  @RequirePermissions(Permission.MARK_ENTER)
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MARKS_SHEET_MAX_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Read an uploaded marks sheet into a staged diff. Writes nothing.' })
  validateSheet(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: GridQueryDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<MarksSheetValidateResultDto> {
    return this.importService.validateFile(examId, query, file, tenant.id, tenant.role, user.sub);
  }

  @Post('sheet/commit')
  @RequirePermissions(Permission.MARK_ENTER)
  @FailClosedWithoutRedis()
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Write the cells staged by sheet/validate.' })
  commitSheet(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Body() dto: CommitMarksSheetDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<MarksSheetCommitResultDto> {
    return this.importService.commit(
      examId,
      dto,
      tenant.id,
      tenant.role,
      user.sub,
      requestContext(request),
    );
  }
}

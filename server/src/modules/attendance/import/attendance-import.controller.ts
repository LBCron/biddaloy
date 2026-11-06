import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ATTENDANCE_SHEET_MAX_BYTES, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { STRICT_RATE_LIMIT } from '../../../rate-limit';
import { buildContentDisposition } from '../../staff-hr/staff-document.controller';
import { AttendanceImportService, ImportCaller } from './attendance-import.service';
import {
  AttendanceImportDetailDto,
  AttendanceImportListDto,
  CommitAttendanceImportDto,
  CommitAttendanceImportResultDto,
  QueryAttendanceImportsDto,
  TemplateQueryDto,
  ValidateAttendanceImportResultDto,
} from './dto/attendance-import.dto';

type Tenant = { id: string; role: string };

const READ_ROLES = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
];

/** Epic 76 D7/D11: attendance sheet upload. The real object-level gate is per section, in the service. */
@ApiTags('attendance')
@ApiTenantAuth()
@Controller('attendance')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class AttendanceImportController {
  constructor(private readonly service: AttendanceImportService) {}

  private caller(tenant: Tenant, user: { sub: string }, req: Request): ImportCaller {
    return {
      tenantId: tenant.id,
      userId: user.sub,
      role: tenant.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
  }

  @Get('import/template')
  @RequirePermissions(Permission.ATTENDANCE_MARK)
  @ApiOperation({
    summary:
      'Download a pre-filled attendance sheet (.xlsx) for up to 10 sections on one date. Only sections you may write.',
  })
  async template(
    @Query() query: TemplateQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.service.template(
      query.sectionIds,
      query.date,
      this.caller(tenant, user, req),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', buildContentDisposition(fileName));
    res.send(buffer);
  }

  @Post('import/validate')
  @RequirePermissions(Permission.ATTENDANCE_MARK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ATTENDANCE_SHEET_MAX_BYTES } }))
  @ApiOperation({
    summary:
      'Check an attendance sheet (.xlsx / .csv, max 5 MB, 2000 rows) row by row and stage the rows that can be saved. Writes nothing.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOkResponse({ type: ValidateAttendanceImportResultDto })
  validate(
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    return this.service.validate(file, this.caller(tenant, user, req));
  }

  @Post('import/commit')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.ATTENDANCE_MARK)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Save a validated sheet: one register write per (date, section), source IMPORT, never finalizes. All or nothing. Needs an `Idempotency-Key` header.',
  })
  @ApiOkResponse({ type: CommitAttendanceImportResultDto })
  commit(
    @Body() dto: CommitAttendanceImportDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    // Rule 25: a bulk write needs a key. The interceptor checks its shape and replays a repeat.
    if (idempotencyKey === undefined) {
      throw new BadRequestException('Idempotency-Key header is required to save a sheet.');
    }
    return this.service.commit(
      dto.staging_id,
      dto.supersedes_import_id,
      this.caller(tenant, user, req),
    );
  }

  @Get('imports')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ATTENDANCE_READ)
  @ApiOperation({ summary: 'Past sheet uploads, newest first. A teacher sees only their own.' })
  @ApiOkResponse({ type: AttendanceImportListDto })
  list(
    @Query() query: QueryAttendanceImportsDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    return this.service.list(query.page ?? 1, query.limit ?? 20, this.caller(tenant, user, req));
  }

  @Get('imports/:id')
  @Roles(...READ_ROLES)
  @RequirePermissions(Permission.ATTENDANCE_READ)
  @ApiOperation({ summary: 'One upload with every row and the record’s current mark.' })
  @ApiOkResponse({ type: AttendanceImportDetailDto })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: { sub: string },
    @Req() req: Request,
  ) {
    return this.service.detail(id, this.caller(tenant, user, req));
  }
}

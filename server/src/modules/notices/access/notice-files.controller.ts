import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { NOTICE_LIMITS, Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { buildContentDisposition } from '../../staff-hr/staff-document.controller';
import { NoticeFilesService } from './notice-files.service';
import { NoticeFileDto } from './dto/notice-reader.dto';

type Tenant = { id: string; role: UserRole };
type Actor = { sub: string };

@ApiTags('notices')
@ApiTenantAuth()
@Controller('notices')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class NoticeFilesController {
  constructor(private readonly service: NoticeFilesService) {}

  // NOTICE_POST: every role with NOTICE_MANAGE also has it; author-or-manager is checked in the service.
  @Post(':id/files')
  @RequirePermissions(Permission.NOTICE_POST)
  // Rule 25: a double click or a lost reply must not store the files twice. Key check runs first,
  // so a replay never parses the upload.
  @UseInterceptors(
    IdempotencyInterceptor,
    FilesInterceptor('files', NOTICE_LIMITS.filesMax, {
      limits: { fileSize: NOTICE_LIMITS.fileBytesMax },
    }),
  )
  @ApiOperation({ summary: 'Attach up to 3 files (PDF, JPG, PNG, WebP; 5 MB each)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiCreatedResponse({ type: [NoticeFileDto] })
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<NoticeFileDto[]> {
    return this.service.upload(tenant.id, { userId: user.sub, role: tenant.role }, id, files);
  }

  @Get(':id/files/:fileId')
  @RequirePermissions(Permission.NOTICE_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Stream one file (author, manager, or a recipient)' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, object } = await this.service.open(
      tenant.id,
      { userId: user.sub, role: tenant.role },
      id,
      fileId,
    );
    res.setHeader('Content-Type', file.mime_type);
    // same as the public route: uploaded content never runs script
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    res.setHeader(
      'Content-Disposition',
      buildContentDisposition(file.original_name).replace(/^attachment/, 'inline'),
    );
    return new StreamableFile(object.body);
  }

  @Delete(':id/files/:fileId')
  @RequirePermissions(Permission.NOTICE_POST)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a file from a notice' })
  @ApiNoContentResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: Actor,
  ): Promise<void> {
    return this.service.remove(tenant.id, { userId: user.sub, role: tenant.role }, id, fileId);
  }
}

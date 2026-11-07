import {
  CallHandler,
  Controller,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { catchError, throwError } from 'rxjs';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { SITE_MEDIA_MAX_UPLOAD_BYTES, SiteMediaService, mediaRejected } from './site-media.service';
import { SiteMediaDto, SiteMediaListDto, UploadSiteMediaDto } from './dto/site-media.dto';

type Tenant = { id: string };

/** Multer's 413 for a too-big file becomes the same fixed sentence as every other failure (Rule 23). */
@Injectable()
class OversizeAsRejected implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next
      .handle()
      .pipe(
        catchError((e) =>
          throwError(() => (e instanceof PayloadTooLargeException ? mediaRejected() : e)),
        ),
      );
  }
}

/** [40.2.01] Site pictures. WEBSITE_MANAGE on every route. */
@ApiTags('website')
@ApiTenantAuth()
@Controller('website/media')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.WEBSITE_MANAGE)
export class SiteMediaController {
  constructor(private readonly media: SiteMediaService) {}

  @Get()
  @ApiOperation({ summary: 'The school’s site pictures and its storage use.' })
  @ApiOkResponse({ type: SiteMediaListDto })
  list(@CurrentTenant() t: Tenant) {
    return this.media.list(t.id);
  }

  @Post()
  @UseInterceptors(
    IdempotencyInterceptor,
    OversizeAsRejected,
    FileInterceptor('file', { limits: { fileSize: SITE_MEDIA_MAX_UPLOAD_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { slot: { type: 'string' }, file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      'Upload a picture at its slot’s exact size (JPEG/PNG/WebP in, WebP out). 400 site.media_rejected for every failure.',
  })
  @ApiOkResponse({ type: SiteMediaDto })
  upload(
    @Body() dto: UploadSiteMediaDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentTenant() t: Tenant,
  ) {
    if (!file) throw mediaRejected();
    return this.media.upload(t.id, dto.slot, file);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a picture. 409 site.media_in_use while the site shows it.' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() t: Tenant) {
    await this.media.remove(t.id, id);
  }
}

import {
  Body,
  CallHandler,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  NestInterceptor,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { catchError, throwError } from 'rxjs';
import { Permission } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { SITE_MEDIA_MAX_UPLOAD_BYTES, mediaRejected } from '../site-media.service';
import {
  GalleryAlbumDto,
  GalleryPhotoDto,
  ReorderGalleryDto,
  SaveAlbumDto,
  UpdateGalleryPhotoDto,
  UploadGalleryPhotoDto,
} from './dto/gallery.dto';
import { GalleryService } from './gallery.service';

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

/** [40.6.03] Photo gallery admin. WEBSITE_MANAGE (ADMIN only, D16) on every route. */
@ApiTags('website')
@ApiTenantAuth()
@Controller('website/gallery')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.WEBSITE_MANAGE)
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get('albums')
  @ApiOperation({ summary: 'Every album with its photos, in order (at most 20 albums).' })
  @ApiOkResponse({ type: [GalleryAlbumDto] })
  list(@CurrentTenant() t: Tenant) {
    return this.gallery.listAlbums(t.id);
  }

  @Post('albums')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create an album. 400 site.gallery_invalid, site.gallery_limit.' })
  @ApiOkResponse({ type: GalleryAlbumDto })
  create(@Body() dto: SaveAlbumDto, @CurrentTenant() t: Tenant) {
    return this.gallery.createAlbum(t.id, dto.title);
  }

  // Declared before `albums/:id` routes so `order` is never read as an id.
  @Put('albums/order')
  @ApiOperation({ summary: 'Reorder albums: the full id list. 400 site.gallery_invalid.' })
  @ApiOkResponse({ type: [GalleryAlbumDto] })
  reorder(@Body() dto: ReorderGalleryDto, @CurrentTenant() t: Tenant) {
    return this.gallery.reorderAlbums(t.id, dto.ids);
  }

  @Patch('albums/:id')
  @ApiOperation({ summary: 'Rename an album. 404 site.gallery_not_found.' })
  @ApiOkResponse({ type: GalleryAlbumDto })
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveAlbumDto,
    @CurrentTenant() t: Tenant,
  ) {
    return this.gallery.updateAlbum(t.id, id, dto.title);
  }

  @Delete('albums/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete an album and its photos; unused pictures give their bytes back.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() t: Tenant) {
    await this.gallery.deleteAlbum(t.id, id);
  }

  @Post('albums/:id/photos')
  @UseInterceptors(
    IdempotencyInterceptor,
    OversizeAsRejected,
    FileInterceptor('file', { limits: { fileSize: SITE_MEDIA_MAX_UPLOAD_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { caption: { type: 'string' }, file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary:
      'Upload a 1200x800 photo (JPEG/PNG/WebP in, WebP out). 400 site.media_rejected (size, type, quota), site.gallery_limit (60 per album), site.gallery_invalid.',
  })
  @ApiOkResponse({ type: GalleryPhotoDto })
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadGalleryPhotoDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentTenant() t: Tenant,
  ) {
    if (!file) throw mediaRejected();
    return this.gallery.uploadPhoto(t.id, id, file, dto.caption);
  }

  @Put('albums/:id/photos/order')
  @ApiOperation({
    summary: 'Reorder an album’s photos: the full id list. 400 site.gallery_invalid.',
  })
  @ApiOkResponse({ type: GalleryAlbumDto })
  reorderPhotos(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderGalleryDto,
    @CurrentTenant() t: Tenant,
  ) {
    return this.gallery.reorderPhotos(t.id, id, dto.ids);
  }

  @Patch('photos/:id')
  @ApiOperation({ summary: 'Set or clear a photo caption. 404 site.gallery_not_found.' })
  @ApiOkResponse({ type: GalleryPhotoDto })
  caption(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGalleryPhotoDto,
    @CurrentTenant() t: Tenant,
  ) {
    return this.gallery.updatePhoto(t.id, id, dto.caption);
  }

  @Delete('photos/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a photo; an unused picture gives its bytes back.' })
  async removePhoto(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() t: Tenant) {
    await this.gallery.deletePhoto(t.id, id);
  }
}

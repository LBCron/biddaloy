import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { NoticeLinksService } from './notice-links.service';
import { PublicNoticeDto } from './public-notice.dto';
import { PUBLIC_NOTICE_RATE_LIMIT } from '../../../rate-limit';

/** One sentence for every dead link and every missing file (Rule 23). */
export const NOTICE_LINK_NOT_FOUND = 'Notice link not found or no longer active';

/**
 * [53.2.02] Reachable with no auth header and no `X-Tenant-ID`: tenant scope
 * comes from the token row (`NoticeLinksService.resolve`). Same no-guards shape
 * as `PublicInvoiceController`: there is no principal to authenticate, so
 * `AuthGuard`/`ContextGuard`/`RolesGuard`/`PermissionsGuard` do not apply.
 * `ThrottlerGuard` still runs and buckets by IP. Without Redis this route stays
 * open (D29).
 */
@ApiTags('public-notices')
@Controller('public/notices')
export class PublicNoticeController {
  constructor(private readonly links: NoticeLinksService) {}

  @Get(':token')
  @Throttle({ default: PUBLIC_NOTICE_RATE_LIMIT })
  @ApiOperation({
    summary: 'Public view of a notice via a link token. No auth; one 404 for any dead link.',
  })
  @ApiOkResponse({ type: PublicNoticeDto })
  async get(@Param('token') token: string): Promise<PublicNoticeDto> {
    const page = await this.links.getPage(token);
    if (!page) throw new NotFoundException(NOTICE_LINK_NOT_FOUND);
    return page;
  }

  @Get(':token/files/:fileId')
  @Throttle({ default: PUBLIC_NOTICE_RATE_LIMIT })
  @ApiOperation({
    summary: "Stream one of the notice's files inline. 404 for a dead link or a foreign file.",
  })
  async file(
    @Param('token') token: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.links.getFile(token, fileId);
    if (!file) throw new NotFoundException(NOTICE_LINK_NOT_FOUND);
    // A notice can be withdrawn, so never cache; nosniff + sandbox for uploaded content.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    // A storage failure must not leak its message to a public caller (Rules 23, 24).
    return new StreamableFile(file.body).setErrorHandler((_err, r) => {
      if (r.headersSent) return;
      r.statusCode = 404;
      r.send(NOTICE_LINK_NOT_FOUND);
    });
  }

  @Post(':token/opened')
  @HttpCode(204)
  @Throttle({ default: PUBLIC_NOTICE_RATE_LIMIT })
  @ApiOperation({
    summary: 'A personal link marks its recipient seen, once. A public link writes nothing.',
  })
  async opened(@Param('token') token: string): Promise<void> {
    if (!(await this.links.markOpened(token))) throw new NotFoundException(NOTICE_LINK_NOT_FOUND);
  }
}

import { Controller, Get, Headers, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { RateLimitTierOptions } from '../../../rate-limit';
import { buildErrorResponseBody } from '../../../common/filters/error-response';
import { errorPath } from '../../../common/filters/http-exception.filter';
import { resolveRequestId } from '../../../common/request-context.util';
import { HostAnswer, PublicSiteService, siteNotFound } from './public-site.service';

/**
 * The site container reads on behalf of every visitor, so the IP seen here is the container's,
 * not the visitor's. The tier is sized for that: well above the 30/min of per-person public routes.
 */
export const SITE_READ_RATE_LIMIT: RateLimitTierOptions = { limit: 1200, ttl: 60_000 };

/**
 * [40.1.04] Reads for the school-site container: anonymous, no `X-Tenant-ID`; the host name is
 * the only tenant signal. GET only. An unknown host and a switched-off site answer the same 404
 * (`site.not_found`); a renamed subdomain inside its 30 days answers 301 `{ to }` (D34).
 * Redis down: these still answer, the cache just falls through to the database (D42).
 */
@ApiTags('public-site')
@Controller('public/site/by-host/:host')
@Throttle({ default: SITE_READ_RATE_LIMIT })
export class PublicSiteController {
  constructor(private readonly site: PublicSiteService) {}

  // A draft preview must never be indexed or cached (D33); set whenever `?preview=` is present.
  private noIndex(res: Response, preview?: string) {
    if (preview === undefined) return;
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
  }

  private send<T>(res: Response, r: HostAnswer<T>): T | { to: string } {
    if ('redirectTo' in r) {
      res.status(301);
      return { to: r.redirectTo };
    }
    return r.data;
  }

  @Get('manifest')
  @ApiOperation({ summary: 'Theme, nav, announcements and school facts of a published site.' })
  @ApiOkResponse()
  async manifest(
    @Param('host') host: string,
    @Query('preview') preview: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noIndex(res, preview);
    return this.send(res, await this.site.manifest(host, preview));
  }

  @Get('page/:page')
  @ApiOperation({ summary: 'One published page: enabled sections in order.' })
  @ApiOkResponse()
  async page(
    @Param('host') host: string,
    @Param('page') page: string,
    @Query('preview') preview: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.noIndex(res, preview);
    return this.send(res, await this.site.page(host, page, preview));
  }

  @Get('blog/:slug')
  @ApiOperation({
    summary: 'One published blog post by slug: title, excerpt, sanitised html, cover.',
  })
  @ApiOkResponse()
  async blogPost(
    @Param('host') host: string,
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, await this.site.blogPost(host, slug));
  }

  @Get('island/:kind')
  @ApiOperation({
    summary: 'Live list for a client island (notices, events, routine). Cached 60 s.',
  })
  @ApiOkResponse()
  async island(
    @Param('host') host: string,
    @Param('kind') kind: string,
    @Query('classSectionId') classSectionId: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, await this.site.island(host, kind, classSectionId));
  }

  // `key` is `logo` or a media id, so it cannot carry ParseUUIDPipe: the service answers the one 404.
  @Get('media/:key')
  @ApiOperation({ summary: 'The school logo (`logo`) or an uploaded site picture, by media id.' })
  async media(
    @Param('host') host: string,
    @Param('key') key: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Query('preview') preview: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | { to: string } | undefined> {
    this.noIndex(res, preview);
    const r = await this.site.mediaFile(host, key, ifNoneMatch, preview);
    if ('redirectTo' in r) {
      res.status(301);
      return { to: r.redirectTo };
    }
    if ('notModified' in r) {
      res.status(304).setHeader('ETag', r.etag);
      return undefined;
    }
    if (r.etag) res.setHeader('ETag', r.etag);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    res.setHeader('Content-Type', r.contentType);
    // A storage read that fails mid-stream answers the same JSON 404 as every other miss.
    return new StreamableFile(r.body).setErrorHandler(() => {
      if (res.headersSent) return;
      const requestId = resolveRequestId(res.req);
      const body = buildErrorResponseBody(siteNotFound(), {
        path: errorPath(res.req),
        requestId,
        nodeEnv: process.env.NODE_ENV,
      });
      res.removeHeader('ETag');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Request-Id', requestId);
      // end(), not send(): send() would add its own ETag to the error body.
      res.status(404).end(JSON.stringify(body));
    });
  }
}

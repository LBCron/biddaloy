import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Readable } from 'node:stream';
import { SchoolStatus, SiteIslandKind, SitePage } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { StorageService } from '../../storage/storage.service';
import { SchoolSite } from '../entities/school-site.entity';
import { SiteMedia } from '../entities/site-media.entity';
import { SiteCacheService } from './site-cache.service';
import { SiteHostService } from './site-host.service';
import {
  PublicManifest,
  PublicPage,
  buildManifest,
  buildPage,
  withAnnouncementWindow,
} from './page-read-model';
import { NoticesFeed } from './feeds/notices.feed';
import { PreviewTokenService } from '../preview-token.service';

/** One 404 for an unknown host, an off site, a missing page and a missing picture (Rule 23). */
export const siteNotFound = () => new NotFoundException('site.not_found');

export type HostAnswer<T> = { redirectTo: string } | { data: T };

interface LiveSite {
  preview?: true;
  site: SchoolSite;
  published: SiteConfig;
  school: School;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** [40.1.04] The anonymous reads behind `/public/site/by-host/:host/*`. */
@Injectable()
export class PublicSiteService {
  constructor(
    private readonly hosts: SiteHostService,
    private readonly cache: SiteCacheService,
    private readonly storage: StorageService,
    @InjectRepository(School) private readonly schools: Repository<School>,
    @InjectRepository(SiteMedia) private readonly media: Repository<SiteMedia>,
    private readonly notices: NoticesFeed,
    private readonly previews: PreviewTokenService,
  ) {}

  /**
   * Site must be switched on, published, and its school active (not soft-deleted or suspended).
   * Checked before a renamed subdomain's 301 too: an off or suspended site's old address must
   * answer the same 404, never reveal the new one.
   */
  private async live(host: string, preview?: string): Promise<{ redirectTo: string } | LiveSite> {
    const found = await this.hosts.resolve(host);
    if (!found) throw siteNotFound();
    const { site } = found;
    // D33: a valid signed token for THIS host's tenant shows the draft, switched on or not.
    // A bad or expired one is ignored, so it answers exactly what no token would.
    if (
      preview !== undefined &&
      !('redirectTo' in found) &&
      this.previews.verify(preview, site.tenant_id)
    ) {
      const school = await this.schools.findOne({ where: { id: site.tenant_id } });
      if (!school || school.status !== SchoolStatus.ACTIVE) throw siteNotFound();
      return { preview: true, site, published: site.draft, school };
    }
    if (!site.enabled || !site.published) throw siteNotFound();
    const school = await this.schools.findOne({ where: { id: site.tenant_id } });
    if (!school || school.status !== SchoolStatus.ACTIVE) throw siteNotFound();
    if ('redirectTo' in found) return { redirectTo: found.redirectTo };
    return { site, published: site.published, school };
  }

  async manifest(host: string, preview?: string): Promise<HostAnswer<PublicManifest>> {
    const l = await this.live(host, preview);
    if ('redirectTo' in l) return l;
    if (l.preview) {
      return {
        data: withAnnouncementWindow(buildManifest(l.published, true, l.school), new Date()),
      };
    }
    const m = await this.cache.getOrLoad(
      l.site.tenant_id,
      l.site.version,
      // Everything the manifest reads that is not the published config is in the key.
      `manifest:${l.school.updated_at.getTime()}:${l.site.noindex ? 1 : 0}`,
      async () => buildManifest(l.published, l.site.noindex, l.school),
    );
    return { data: withAnnouncementWindow(m, new Date()) };
  }

  async page(host: string, page: string, preview?: string): Promise<HostAnswer<PublicPage>> {
    const l = await this.live(host, preview);
    if ('redirectTo' in l) return l;
    // Only known page names reach a cache key, so a caller cannot grow Redis with made-up keys.
    if (!(Object.values(SitePage) as string[]).includes(page)) throw siteNotFound();
    if (l.preview) {
      const draft = buildPage(l.published, page); // never cached: the draft changes while it is edited
      if (!draft) throw siteNotFound();
      return { data: draft };
    }
    const built = await this.cache.getOrLoad(
      l.site.tenant_id,
      l.site.version,
      `page:${page}`,
      async () => buildPage(l.published, page),
    );
    if (!built) throw siteNotFound();
    return { data: built };
  }

  async island(host: string, kind: string): Promise<HostAnswer<unknown>> {
    const l = await this.live(host);
    if ('redirectTo' in l) return l;
    // ponytail: one feed, so a plain check; a map of feeds when events/results land.
    if (kind !== SiteIslandKind.NOTICES) throw siteNotFound();
    const tenantId = l.site.tenant_id;
    return {
      data: await this.cache.getOrLoadFeed(tenantId, kind, () => this.notices.load(tenantId)),
    };
  }

  /** `key` is `logo` or a `site_media` id. Returns null on `If-None-Match` hit (304). */
  async mediaFile(
    host: string,
    key: string,
    ifNoneMatch?: string,
    preview?: string,
  ): Promise<
    | { redirectTo: string }
    | { notModified: true; etag: string }
    | { body: Readable; contentType: string; etag?: string }
  > {
    const l = await this.live(host, preview);
    if ('redirectTo' in l) return l;
    const tenantId = l.site.tenant_id;

    if (key === 'logo') {
      if (!l.school.logo_key) throw siteNotFound();
      return this.stream(() => this.storage.getForTenant(l.school.logo_key as string, tenantId));
    }
    // Only a picture the published site shows, never any row of the tenant (a removed photo, an
    // unpublished draft's picture). Checked before the row lookup and the 304, so neither tells.
    // ponytail: config-only; the teachers/blog feed tickets add the photo/cover ids they show.
    if (!UUID_RE.test(key) || !JSON.stringify(l.published).includes(`"${key}"`)) {
      throw siteNotFound();
    }
    const row = await this.media.findOne({ where: { id: key, tenant_id: tenantId } });
    if (!row) throw siteNotFound();
    const etag = `"${row.hash}"`;
    if (ifNoneMatch?.split(',').some((t) => t.trim().replace(/^W\//, '') === etag))
      return { notModified: true, etag };
    return this.stream(() => this.storage.getForTenant(row.storage_key, tenantId), etag);
  }

  /** A storage failure never reaches the caller as anything but the one 404 (Rules 23, 24). */
  private async stream(
    read: () => Promise<{ body: Readable; contentType?: string }>,
    etag?: string,
  ) {
    try {
      const o = await read();
      return { body: o.body, contentType: o.contentType ?? 'image/webp', etag };
    } catch {
      throw siteNotFound();
    }
  }
}

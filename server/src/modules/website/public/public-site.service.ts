import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Readable } from 'node:stream';
import { SchoolStatus, SiteIslandKind, SiteMediaSlot, SitePage } from '@biddaloy/shared';
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
  withFeeds,
  withAnnouncementWindow,
} from './page-read-model';
import { FeedRegistry } from './feeds/feed-registry';
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
    private readonly feeds: FeedRegistry,
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

  /**
   * For public writes: the live site's tenant, published config and school. Unknown host, off
   * site, suspended school and a renamed host's old name all throw the one 404 (never a 301:
   * a write must not be sent on to another address).
   */
  async liveForWrite(host: string) {
    const l = await this.live(host);
    if ('redirectTo' in l) throw siteNotFound();
    return { tenantId: l.site.tenant_id, published: l.published, school: l.school };
  }

  async manifest(host: string, preview?: string): Promise<HostAnswer<PublicManifest>> {
    const l = await this.live(host, preview);
    if ('redirectTo' in l) return l;
    if (l.preview) {
      return {
        data: withAnnouncementWindow(
          buildManifest(l.published, true, l.school, !!(await this.siteLogo(l.site.tenant_id))),
          new Date(),
        ),
      };
    }
    // A logo upload or delete does not bump the site version, so the logo is part of the key.
    const logo = await this.siteLogo(l.site.tenant_id);
    const m = await this.cache.getOrLoad(
      l.site.tenant_id,
      l.site.version,
      // Everything the manifest reads that is not the published config is in the key.
      `manifest:${l.school.updated_at.getTime()}:${l.site.noindex ? 1 : 0}:${logo?.id ?? ''}`,
      async () => buildManifest(l.published, l.site.noindex, l.school, !!logo),
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
      return { data: await withFeeds(draft, l.site.tenant_id, this.feeds) };
    }
    const built = await this.cache.getOrLoad(
      l.site.tenant_id,
      l.site.version,
      `page:${page}`,
      async () => buildPage(l.published, page),
    );
    if (!built) throw siteNotFound();
    // The page shell is cached by site version; the live rows are not (a notice ticked public shows
    // within 60 s without a publish), so they are added per request from the 60 s feed cache.
    return { data: await withFeeds(built, l.site.tenant_id, this.feeds) };
  }

  /** The kinds a visitor's browser may fetch live; `enquiry` has its own route. */
  async island(host: string, kind: string, classSectionId?: unknown): Promise<HostAnswer<unknown>> {
    const l = await this.live(host);
    if ('redirectTo' in l) return l;
    const islands: string[] = [
      SiteIslandKind.NOTICES,
      SiteIslandKind.EVENTS,
      SiteIslandKind.ROUTINE,
    ];
    // Results list personal data: read live every time, so a withdrawal shows at once.
    if (kind === SiteIslandKind.RESULTS) {
      return { data: await this.feeds.live('results', l.site.tenant_id) };
    }
    if (!islands.includes(kind) || !this.feeds.has(kind)) throw siteNotFound();
    const tenantId = l.site.tenant_id;
    if (kind !== SiteIslandKind.ROUTINE) return { data: await this.feeds.cached(kind, tenantId) };
    // The section id is visitor input and becomes a Redis key: one UUID string (a repeated param
    // arrives as an array), and a section of THIS school, before anything is cached. So the key
    // space is at most the school's own sections; anything else is the same empty answer.
    if (typeof classSectionId !== 'string' || !UUID_RE.test(classSectionId)) return { data: [] };
    const own: unknown[] = await this.media.manager.query(
      `SELECT 1 FROM class_sections WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      [classSectionId, tenantId],
    );
    if (own.length === 0) return { data: [] };
    return { data: await this.feeds.cached(kind, tenantId, { classSectionId }) };
  }

  /**
   * One published blog post by slug: the list feed holds only the 12 newest. A slug that is not
   * the shape we mint, a draft and a missing post all answer the one 404.
   */
  async blogPost(host: string, slug: string): Promise<HostAnswer<Record<string, unknown>>> {
    const l = await this.live(host);
    if ('redirectTo' in l) return l;
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw siteNotFound();
    const post = await this.feeds.blogPost(l.site.tenant_id, slug);
    if (!post) throw siteNotFound();
    const { title, excerpt, html, cover, publishedAt } = post;
    return { data: { title, excerpt, html, cover, publishedAt } };
  }

  /** The newest logo uploaded in the website screens, or null. Tenant-scoped. */
  private siteLogo(tenantId: string) {
    return this.media.findOne({
      where: { tenant_id: tenantId, slot: SiteMediaSlot.LOGO },
      order: { created_at: 'DESC', id: 'DESC' },
    });
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
      // The logo from the website screens wins; the school profile logo is the fallback.
      const logo = await this.siteLogo(tenantId);
      const logoKey = logo?.storage_key ?? l.school.logo_key;
      if (!logoKey) throw siteNotFound();
      return this.stream(() => this.storage.getForTenant(logoKey, tenantId));
    }
    // Only a picture the published site shows, never any row of the tenant (a removed photo, an
    // unpublished draft's picture). Checked before the row lookup and the 304, so neither tells.
    if (!UUID_RE.test(key)) throw siteNotFound();
    if (
      !JSON.stringify(l.published).includes(`"${key}"`) &&
      !(await this.shownByFeed(tenantId, key))
    ) {
      throw siteNotFound();
    }
    const row = await this.media.findOne({ where: { id: key, tenant_id: tenantId } });
    if (!row) throw siteNotFound();
    const etag = `"${row.hash}"`;
    if (ifNoneMatch?.split(',').some((t) => t.trim().replace(/^W\//, '') === etag))
      return { notModified: true, etag };
    return this.stream(() => this.storage.getForTenant(row.storage_key, tenantId), etag);
  }

  /**
   * A picture a feed shows: the photo of a teacher card that is switched on, or the cover or a
   * picture inside the body of a published post. `key` is a checked UUID, so `position()` is safe.
   */
  private async shownByFeed(tenantId: string, key: string): Promise<boolean> {
    const rows: unknown[] = await this.media.manager.query(
      `SELECT 1 FROM staff_web_profiles
        WHERE tenant_id = $1 AND show_on_website = true AND photo_media_id::text = $2
          AND EXISTS (SELECT 1 FROM users u WHERE u.id = user_id
                       AND u.deleted_at IS NULL AND u.status = 'ACTIVE')
          AND EXISTS (SELECT 1 FROM user_tenants m
                       WHERE m.user_id = staff_web_profiles.user_id AND m.tenant_id = $1
                         AND m.deleted_at IS NULL AND m.role IN ('TEACHER','OFFICE_STAFF'))
       UNION ALL
       SELECT 1 FROM site_posts
        WHERE tenant_id = $1 AND kind = 'POST'
          AND published_at IS NOT NULL AND published_at <= now()
          -- ponytail: substring scan of the body JSON per media request; store body_media_ids on
          -- the post (checkSlate already returns mediaIds) when posts or traffic grow.
          AND (cover_media_id::text = $2 OR position($2 in body::text) > 0)
       LIMIT 1`,
      [tenantId, key],
    );
    return rows.length > 0;
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

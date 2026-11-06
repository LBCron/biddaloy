import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { RESERVED_SUBDOMAINS, SiteTheme } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { THEMES, defaultConfigFor, validateSiteConfig } from '@biddaloy/site-themes';
import type { ThemeManifest } from '@biddaloy/site-themes';
import { School } from '../schools/entities/school.entity';
import { SchoolSite } from './entities/school-site.entity';
import { SiteCacheService } from './public/site-cache.service';
import type { SaveDraftDto, SiteDto } from './dto/site-config.dto';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown) =>
  isObj(v) &&
  ((typeof v.bn === 'string' && v.bn.trim() !== '') ||
    (typeof v.en === 'string' && v.en.trim() !== ''));

/** Fixed error codes. None echoes a submitted value (Rule 23). */
export const siteStale = () => new ConflictException('site.stale');

/** `green-valley-school-1a2b`: a readable slug plus 4 hex so two schools with one name never collide. */
export function slugFor(name: string, rand: () => string = () => randomBytes(2).toString('hex')) {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/, '');
  if (base.length < 3 || RESERVED_SUBDOMAINS.includes(base)) base = 'school';
  return `${base}-${rand()}`;
}

/**
 * Moves a draft to another theme (D25): the new theme's defaults, then every text the school
 * already wrote (non-empty bn or en) is kept; empty ones are refilled from the new defaults.
 * The palette is kept if the new theme has it. Typography takes the new theme's defaults.
 */
export function changeTheme(current: unknown, theme: SiteTheme): SiteConfig {
  const next = defaultConfigFor(theme);
  if (!isObj(current)) return next;
  if (
    typeof current.palette === 'string' &&
    THEMES[theme].palettes.some((p) => p.id === current.palette)
  ) {
    next.palette = current.palette;
  }
  if (isObj(current.announcements)) {
    next.announcements = current.announcements as unknown as SiteConfig['announcements'];
  }
  const oldPages = Array.isArray(current.pages) ? current.pages.filter(isObj) : [];
  for (const page of next.pages) {
    const oldPage = oldPages.find((p) => p.page === page.page);
    if (!oldPage) continue;
    if (typeof oldPage.enabled === 'boolean') page.enabled = oldPage.enabled;
    const oldSections = Array.isArray(oldPage.sections) ? oldPage.sections.filter(isObj) : [];
    for (const section of page.sections) {
      const old = oldSections.find((s) => s.key === section.key);
      if (!old) continue;
      if (typeof old.enabled === 'boolean') section.enabled = old.enabled;
      const oldData = isObj(old.data) ? old.data : {};
      for (const [field, value] of Object.entries(oldData)) {
        // Only fields the new section knows are kept; `images` lists are kept when non-empty.
        const known =
          field in section.data ||
          THEMES[theme].sections
            .find((s) => s.key === section.key)
            ?.fields.some((f) => f.key === field);
        if (!known) continue;
        if (nonEmpty(value) || (Array.isArray(value) && value.length > 0))
          section.data[field] = value;
      }
    }
  }
  return next;
}

export function themeOf(value: unknown): ThemeManifest | null {
  return typeof value === 'string' && (Object.values(SiteTheme) as string[]).includes(value)
    ? THEMES[value as SiteTheme]
    : null;
}

export function toSiteDto(site: SchoolSite): SiteDto {
  return {
    theme: site.theme,
    palette: site.palette,
    enabled: site.enabled,
    noindex: site.noindex,
    subdomain: site.subdomain,
    custom_domain: site.custom_domain,
    custom_domain_status: site.custom_domain_status,
    version: site.version,
    published_at: site.published_at ? site.published_at.toISOString() : null,
    has_published: site.published !== null,
    draft: site.draft as unknown as Obj,
  };
}

/** [40.1.04] The admin side of the school website: one `school_sites` row per tenant. */
@Injectable()
export class SiteConfigService {
  constructor(
    @InjectRepository(SchoolSite) private readonly sites: Repository<SchoolSite>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly cache: SiteCacheService,
  ) {}

  /** The first call creates the row with the Basic theme and bn/en default texts (D25). */
  async get(tenantId: string): Promise<SiteDto> {
    return toSiteDto(await this.ensure(tenantId));
  }

  async saveDraft(tenantId: string, dto: SaveDraftDto): Promise<SiteDto> {
    const site = await this.ensure(tenantId);
    const target = themeOf(dto.config.theme);
    if (!target) throw this.invalid(['theme.unknown']);
    const candidate = target.id === site.theme ? dto.config : changeTheme(dto.config, target.id);
    const checked = validateSiteConfig(candidate, target);
    if (!checked.ok) throw this.invalid(checked.errors);

    const res = await this.sites.update(
      { tenant_id: tenantId, version: dto.version },
      { draft: checked.value as never, theme: target.id, palette: checked.value.palette },
    );
    if (!res.affected) throw siteStale();
    return this.get(tenantId);
  }

  /** Copies the draft to `published` and bumps `version`, only if the caller saw the current version. */
  async publish(tenantId: string, version: number): Promise<SiteDto> {
    await this.ensure(tenantId);
    const res = await this.sites
      .createQueryBuilder()
      .update(SchoolSite)
      .set({
        published: () => 'draft',
        version: () => 'version + 1',
        published_at: () => 'now()',
      })
      .where('tenant_id = :tenantId AND version = :version', { tenantId, version })
      .execute();
    if (!res.affected) throw siteStale();
    await this.cache.invalidate(tenantId);
    return this.get(tenantId);
  }

  async setEnabled(tenantId: string, enabled: boolean): Promise<SiteDto> {
    const site = await this.ensure(tenantId);
    if (enabled && site.published === null) throw new ConflictException('site.not_published');
    await this.sites.update({ tenant_id: tenantId }, { enabled });
    await this.cache.invalidate(tenantId);
    return this.get(tenantId);
  }

  themes(): ThemeManifest[] {
    return Object.values(THEMES);
  }

  private invalid(errors: string[]) {
    return new BadRequestException({ message: 'site.invalid', details: { errors } });
  }

  private async ensure(tenantId: string): Promise<SchoolSite> {
    const found = await this.sites.findOne({ where: { tenant_id: tenantId } });
    if (found) return found;
    const school = await this.schools.findOneOrFail({ where: { id: tenantId } });
    const draft = defaultConfigFor(SiteTheme.BASIC);
    // A concurrent first call or a taken subdomain makes the insert a no-op: re-read, retry a new slug.
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.sites
        .createQueryBuilder()
        .insert()
        .into(SchoolSite)
        .values({
          tenant_id: tenantId,
          subdomain: slugFor(school.name),
          theme: SiteTheme.BASIC,
          palette: draft.palette,
          draft: draft as never,
        })
        .orIgnore()
        .execute();
      const row = await this.sites.findOne({ where: { tenant_id: tenantId } });
      if (row) return row;
    }
    throw new ConflictException('site.unavailable');
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SITE_FEATURED_TEACHERS_MAX, SiteMediaSlot, UserRole } from '@biddaloy/shared';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { SchoolSite } from './entities/school-site.entity';
import { SiteMedia } from './entities/site-media.entity';
import { StaffWebProfile } from './entities/staff-web-profile.entity';
import { SiteCacheService } from './public/site-cache.service';
import type { SaveStaffWebProfileDto, StaffWebProfileDto } from './dto/staff-web-profile.dto';

/** Roles an admin may put on the site. */
export const WEB_PROFILE_ROLES = [UserRole.TEACHER, UserRole.OFFICE_STAFF];
const TEXT_MAX = 1000;

/** One sentence for a bad text, picture or a 9th featured teacher (Rule 23). */
export const profileInvalid = () => new BadRequestException('site.profile_invalid');

/** `{ bn, en }` of strings up to 1000 chars each; null or absent clears it. */
function checkBilingual(v: unknown): Record<string, string> | null {
  if (v === undefined || v === null) return null;
  const t = v as Record<string, unknown>;
  const ok =
    typeof t === 'object' &&
    typeof t.bn === 'string' &&
    typeof t.en === 'string' &&
    t.bn.length <= TEXT_MAX &&
    t.en.length <= TEXT_MAX;
  if (!ok) throw profileInvalid();
  return { bn: t.bn as string, en: t.en as string };
}

/** [40.3.01] The admin writes each teacher's public card (D16, D27). */
@Injectable()
export class StaffWebProfilesService {
  constructor(
    @InjectRepository(StaffWebProfile) private readonly profiles: Repository<StaffWebProfile>,
    @InjectRepository(UserTenant) private readonly members: Repository<UserTenant>,
    @InjectRepository(SiteMedia) private readonly media: Repository<SiteMedia>,
    @InjectRepository(SchoolSite) private readonly sites: Repository<SchoolSite>,
    private readonly cache: SiteCacheService,
  ) {}

  /** Teachers and office staff of this school; a person with no profile row is "not shown". */
  async list(tenantId: string): Promise<StaffWebProfileDto[]> {
    const members = await this.members
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.user', 'u')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.role IN (:...roles)', { roles: WEB_PROFILE_ROLES })
      .andWhere('m.deleted_at IS NULL')
      .andWhere('u.deleted_at IS NULL')
      .orderBy('u.full_name', 'ASC')
      .addOrderBy('u.id', 'ASC')
      .getMany();
    const rows = await this.profiles.find({ where: { tenant_id: tenantId } });
    const byUser = new Map(rows.map((r) => [r.user_id, r]));
    // A person with two roles shows once.
    const seen = new Set<string>();
    const out: StaffWebProfileDto[] = [];
    for (const m of members) {
      if (seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      const p = byUser.get(m.user_id);
      out.push({
        user_id: m.user_id,
        full_name: m.user.full_name,
        role: m.role,
        show_on_website: p?.show_on_website ?? false,
        featured: p?.featured ?? false,
        sort_order: p?.sort_order ?? 0,
        subjects: p?.subjects ?? [],
        bio: p?.bio ?? null,
        credentials: p?.credentials ?? null,
        photo_media_id: p?.photo_media_id ?? null,
      });
    }
    return out;
  }

  async upsert(
    tenantId: string,
    userId: string,
    dto: SaveStaffWebProfileDto,
  ): Promise<StaffWebProfileDto> {
    // Only a current teacher/staff member of THIS school; anyone else is a 404.
    const member = await this.members
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId AND m.user_id = :userId', { tenantId, userId })
      .andWhere('m.role IN (:...roles)', { roles: WEB_PROFILE_ROLES })
      .andWhere('m.deleted_at IS NULL')
      .getOne();
    if (!member) throw new NotFoundException('site.profile_not_found');

    const bio = checkBilingual(dto.bio);
    const credentials = checkBilingual(dto.credentials);
    const subjects = (dto.subjects ?? []).map((s) => s.trim()).filter(Boolean);
    if (dto.photo_media_id) {
      const ok = await this.media.count({
        where: { id: dto.photo_media_id, tenant_id: tenantId, slot: SiteMediaSlot.PERSON },
      });
      if (!ok) throw profileInvalid();
    }
    if (dto.featured) {
      // The cap counts everyone else; this person being featured already is not a 9th.
      const others = await this.profiles
        .createQueryBuilder('p')
        .where('p.tenant_id = :tenantId AND p.featured = true AND p.user_id <> :userId', {
          tenantId,
          userId,
        })
        .getCount();
      if (others >= SITE_FEATURED_TEACHERS_MAX) throw profileInvalid();
    }

    await this.profiles
      .createQueryBuilder()
      .insert()
      .into(StaffWebProfile)
      .values({
        tenant_id: tenantId,
        user_id: userId,
        show_on_website: dto.show_on_website,
        featured: dto.featured,
        sort_order: dto.sort_order ?? 0,
        subjects,
        bio,
        credentials,
        photo_media_id: dto.photo_media_id ?? null,
      })
      .orUpdate(
        [
          'show_on_website',
          'featured',
          'sort_order',
          'subjects',
          'bio',
          'credentials',
          'photo_media_id',
          'updated_at',
        ],
        ['tenant_id', 'user_id'],
      )
      .execute();
    // Pages read teachers through the feed cache: drop it and bump the version.
    await this.sites.update({ tenant_id: tenantId }, { version: () => 'version + 1' });
    await this.cache.invalidate(tenantId);
    return (await this.list(tenantId)).find((p) => p.user_id === userId) as StaffWebProfileDto;
  }
}

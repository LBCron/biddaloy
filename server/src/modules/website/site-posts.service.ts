import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SiteMediaSlot } from '@biddaloy/shared';
import { SchoolSite } from './entities/school-site.entity';
import { SiteMedia } from './entities/site-media.entity';
import { SitePost } from './entities/site-post.entity';
import { SiteCacheService } from './public/site-cache.service';
import { slugFor } from './site-config.service';
import { checkSlate } from './slate-render';
import type { PostDto, PostListDto, SavePostDto } from './dto/site-post.dto';

const TITLE_MAX = 200;

/** One sentence for every way a post body, title or picture is refused (Rule 23). */
export const postInvalid = () => new BadRequestException('site.post_invalid');
const postNotFound = () => new NotFoundException('site.post_not_found');

const toDto = (p: SitePost): PostDto => ({
  id: p.id,
  kind: p.kind,
  slug: p.slug,
  title: p.title,
  cover_media_id: p.cover_media_id,
  body: p.body,
  published_at: p.published_at ? p.published_at.toISOString() : null,
  updated_at: p.updated_at.toISOString(),
});

/** `{ bn, en }` of strings up to 200 chars, at least one filled. Anything else is refused. */
function checkTitle(title: unknown): Record<string, string> {
  const t = title as Record<string, unknown> | null;
  const ok =
    t !== null &&
    typeof t === 'object' &&
    typeof t.bn === 'string' &&
    typeof t.en === 'string' &&
    t.bn.length <= TITLE_MAX &&
    t.en.length <= TITLE_MAX &&
    (t.bn.trim() !== '' || t.en.trim() !== '');
  if (!ok) throw postInvalid();
  return { bn: (t.bn as string).trim(), en: (t.en as string).trim() };
}

/** [40.3.01] Blog posts and pages of the school website: per-tenant CRUD behind WEBSITE_MANAGE (D18). */
@Injectable()
export class SitePostsService {
  constructor(
    @InjectRepository(SitePost) private readonly posts: Repository<SitePost>,
    @InjectRepository(SiteMedia) private readonly media: Repository<SiteMedia>,
    @InjectRepository(SchoolSite) private readonly sites: Repository<SchoolSite>,
    private readonly cache: SiteCacheService,
  ) {}

  async list(tenantId: string, page: number, limit: number): Promise<PostListDto> {
    const [rows, total] = await this.posts.findAndCount({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items: rows.map(toDto), total };
  }

  async get(tenantId: string, id: string): Promise<PostDto> {
    return toDto(await this.find(tenantId, id));
  }

  async create(tenantId: string, dto: SavePostDto): Promise<PostDto> {
    const v = await this.validate(tenantId, dto);
    const base = dto.title.en?.trim() ? dto.title.en : 'post';
    // The slug is the public address: a retry on a taken one, never a reused one.
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await this.posts
        .createQueryBuilder()
        .insert()
        .into(SitePost)
        .values({
          tenant_id: tenantId,
          kind: dto.kind ?? 'POST',
          slug: slugFor(base),
          title: v.title,
          cover_media_id: dto.cover_media_id ?? null,
          body: v.body as never,
        })
        .orIgnore()
        .returning('id')
        .execute();
      const id = (res.raw as { id: string }[])[0]?.id;
      if (id) {
        await this.touch(tenantId);
        return this.get(tenantId, id);
      }
    }
    throw new ConflictException('site.post_slug_taken');
  }

  async update(tenantId: string, id: string, dto: SavePostDto): Promise<PostDto> {
    const post = await this.find(tenantId, id);
    const v = await this.validate(tenantId, dto);
    // Slug and kind stay: links to a post must not break when its title is edited.
    await this.posts.update(
      { id: post.id, tenant_id: tenantId },
      { title: v.title, cover_media_id: dto.cover_media_id ?? null, body: v.body as never },
    );
    await this.touch(tenantId);
    return this.get(tenantId, id);
  }

  async publish(tenantId: string, id: string): Promise<PostDto> {
    const post = await this.find(tenantId, id);
    // Publishing again keeps the first date.
    if (!post.published_at) {
      await this.posts.update({ id, tenant_id: tenantId }, { published_at: () => 'now()' });
    }
    await this.touch(tenantId);
    return this.get(tenantId, id);
  }

  async unpublish(tenantId: string, id: string): Promise<PostDto> {
    await this.find(tenantId, id);
    await this.posts.update({ id, tenant_id: tenantId }, { published_at: null });
    await this.touch(tenantId);
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.find(tenantId, id);
    // A post the site config points at (draft or published) cannot vanish under it.
    const site = await this.sites.findOne({ where: { tenant_id: tenantId } });
    if (site && JSON.stringify([site.draft, site.published]).includes(`"${id}"`)) {
      throw new ConflictException('site.post_in_use');
    }
    await this.posts.delete({ id, tenant_id: tenantId });
    await this.touch(tenantId);
  }

  private async find(tenantId: string, id: string): Promise<SitePost> {
    const post = await this.posts.findOne({ where: { id, tenant_id: tenantId } });
    if (!post) throw postNotFound();
    return post;
  }

  /** Title, body and every picture id checked; pictures must be this school's, in the right slot. */
  private async validate(tenantId: string, dto: SavePostDto) {
    const title = checkTitle(dto.title);
    const body = checkSlate(dto.body);
    if (!body.ok) throw postInvalid();
    await this.assertMedia(
      tenantId,
      dto.cover_media_id ? [dto.cover_media_id] : [],
      SiteMediaSlot.POST_COVER,
    );
    await this.assertMedia(tenantId, [...new Set(body.mediaIds)], SiteMediaSlot.POST_IMAGE);
    return { title, body: dto.body };
  }

  private async assertMedia(tenantId: string, ids: string[], slot: SiteMediaSlot) {
    if (ids.length === 0) return;
    const n = await this.media.count({ where: { id: In(ids), tenant_id: tenantId, slot } });
    if (n !== ids.length) throw postInvalid();
  }

  /** Every write bumps the site version (the content cache key) and drops the 60 s feed keys (D32). */
  private async touch(tenantId: string): Promise<void> {
    await this.sites.update({ tenant_id: tenantId }, { version: () => 'version + 1' });
    await this.cache.invalidate(tenantId);
  }
}

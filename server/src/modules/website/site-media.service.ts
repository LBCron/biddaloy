import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { SITE_MEDIA_QUOTA_BYTES, SITE_MEDIA_SLOT_PX, SiteMediaSlot } from '@biddaloy/shared';
import { StorageService } from '../storage/storage.service';
import { matchesDeclaredType } from '../storage/file-signature';
import { SchoolSite } from './entities/school-site.entity';
import { SiteMedia } from './entities/site-media.entity';
import { SiteConfigService } from './site-config.service';
import type { SiteMediaDto, SiteMediaListDto } from './dto/site-media.dto';

export const SITE_MEDIA_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const WEBP_QUALITY = 82;
const FORMAT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** One sentence for every way an upload fails: bad slot, type, size, quota (Rules 6, 23; D37). */
export const mediaRejected = () => new BadRequestException('site.media_rejected');

const toDto = (m: SiteMedia): SiteMediaDto => ({
  id: m.id,
  slot: m.slot,
  width: m.width,
  height: m.height,
  bytes: m.bytes,
  created_at: m.created_at.toISOString(),
});

/** [40.2.01] Site pictures: exact-size slots in, WebP out, 100 MB per school (D15, D19, D37). */
@Injectable()
export class SiteMediaService {
  constructor(
    @InjectRepository(SiteMedia) private readonly media: Repository<SiteMedia>,
    private readonly storage: StorageService,
    private readonly config: SiteConfigService,
  ) {}

  /** Validates by file signature and `sharp`, never the client's type; returns the WebP bytes. */
  private async prepare(
    slot: unknown,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ out: Buffer; width: number; height: number; slot: SiteMediaSlot }> {
    // Logo is the school profile's, not a site-media slot.
    if (
      typeof slot !== 'string' ||
      slot === SiteMediaSlot.LOGO ||
      !(Object.values(SiteMediaSlot) as string[]).includes(slot)
    ) {
      throw mediaRejected();
    }
    const want = SITE_MEDIA_SLOT_PX[slot as SiteMediaSlot];
    if (file.buffer.length > SITE_MEDIA_MAX_UPLOAD_BYTES) throw mediaRejected();
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      meta = await sharp(file.buffer).metadata();
    } catch {
      throw mediaRejected();
    }
    // SVG (and anything else) has no entry here. Signature must match what sharp found, too.
    const mime = meta.format ? FORMAT_MIME[meta.format] : undefined;
    if (!mime || file.mimetype !== mime || !matchesDeclaredType(file.buffer, mime)) {
      throw mediaRejected();
    }
    const { width, height } = meta;
    if (!width || !height) throw mediaRejected();
    const exact =
      want.maxW === undefined ? width === want.w && height === want.h : width <= want.maxW;
    if (!exact) throw mediaRejected();
    try {
      const out = await sharp(file.buffer).webp({ quality: WEBP_QUALITY }).toBuffer();
      return { out, width, height, slot: slot as SiteMediaSlot };
    } catch {
      throw mediaRejected();
    }
  }

  async upload(
    tenantId: string,
    slot: unknown,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<SiteMediaDto> {
    const p = await this.prepare(slot, file);
    await this.config.get(tenantId); // the site row exists
    const hash = createHash('sha256').update(p.out).digest('hex');
    let putKey: string | null = null;
    try {
      return await this.media.manager.transaction(async (m) => {
        // The row lock makes the quota check and the byte count one step per school.
        const site = await m
          .getRepository(SchoolSite)
          .createQueryBuilder('s')
          .where('s.tenant_id = :tenantId', { tenantId })
          .setLock('pessimistic_write')
          .getOneOrFail();
        const same = await m.findOne(SiteMedia, { where: { tenant_id: tenantId, hash } });
        if (same) return toDto(same);
        if (Number(site.media_bytes_used) + p.out.length > SITE_MEDIA_QUOTA_BYTES) {
          throw mediaRejected();
        }
        // Under `tenants/<id>/` so the storage service's own-prefix check accepts it later.
        const key = `tenants/${tenantId}/site/${hash}.webp`;
        await this.storage.put(key, p.out, 'image/webp');
        putKey = key;
        const row = await m.save(
          m.create(SiteMedia, {
            tenant_id: tenantId,
            slot: p.slot,
            storage_key: key,
            hash,
            width: p.width,
            height: p.height,
            bytes: p.out.length,
          }),
        );
        await m.update(
          SchoolSite,
          { tenant_id: tenantId },
          { media_bytes_used: () => `media_bytes_used + ${p.out.length}` },
        );
        return toDto(row);
      });
    } catch (e) {
      // No row committed, and no row had this hash when we put: the object is ours alone.
      if (putKey) await this.storage.delete(putKey).catch(() => undefined);
      throw e;
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const key = await this.media.manager.transaction(async (m) => {
      const site = await m
        .getRepository(SchoolSite)
        .createQueryBuilder('s')
        .where('s.tenant_id = :tenantId', { tenantId })
        .setLock('pessimistic_write')
        .getOne();
      const row = await m.findOne(SiteMedia, { where: { id, tenant_id: tenantId } });
      if (!site || !row) throw new NotFoundException('site.media_not_found');
      // Rule 27 in spirit: a picture the draft or the published site still shows stays.
      if (JSON.stringify([site.draft, site.published]).includes(`"${id}"`)) {
        throw new ConflictException('site.media_in_use');
      }
      await m.delete(SiteMedia, { id, tenant_id: tenantId });
      await m.update(
        SchoolSite,
        { tenant_id: tenantId },
        { media_bytes_used: () => `GREATEST(media_bytes_used - ${row.bytes}, 0)` },
      );
      return row.storage_key;
    });
    // After commit: a failed delete leaves an unreferenced object, never a dangling row.
    await this.storage.deleteForTenant(key, tenantId).catch(() => undefined);
  }

  async list(tenantId: string): Promise<SiteMediaListDto> {
    const site = await this.config
      .get(tenantId)
      .then(() => this.media.manager.findOneOrFail(SchoolSite, { where: { tenant_id: tenantId } }));
    const rows = await this.media.find({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
    return {
      items: rows.map(toDto),
      usedBytes: Number(site.media_bytes_used),
      quotaBytes: SITE_MEDIA_QUOTA_BYTES,
    };
  }
}

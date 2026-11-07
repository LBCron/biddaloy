import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';
import sharp from 'sharp';
import { SITE_MEDIA_QUOTA_BYTES } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { StorageService } from '../storage/storage.service';
import { SiteMediaService } from './site-media.service';
import { SiteConfigService } from './site-config.service';

class MemoryStorage {
  objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.objects.set(key, body);
  }
  async get(key: string) {
    return { body: Readable.from([this.objects.get(key)]), contentType: 'image/webp' };
  }
  deleteForTenant(key: string, tenantId: string) {
    // The real own-prefix guard over this in-memory store.
    return StorageService.prototype.deleteForTenant.call(this, key, tenantId);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

const person = () =>
  sharp({ create: { width: 400, height: 400, channels: 3, background: '#aa5500' } })
    .png()
    .toBuffer();

/** [40.2.01] Quota and delete guard against a real DB (the row lock and the byte counter). */
describe('SiteMediaService (integration)', () => {
  let moduleRef: TestingModule;
  let ds: DataSource;
  let storage: MemoryStorage;
  let svc: SiteMediaService;

  const setUsed = (n: number) =>
    ds.query(`UPDATE school_sites SET media_bytes_used = $2 WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
      n,
    ]);
  const used = async () =>
    Number(
      (
        await ds.query(`SELECT media_bytes_used FROM school_sites WHERE tenant_id = $1`, [
          SEED_TENANT_ID,
        ])
      )[0].media_bytes_used,
    );
  const upload = async () =>
    svc.upload(SEED_TENANT_ID, 'person', { buffer: await person(), mimetype: 'image/png' });

  beforeAll(async () => {
    storage = new MemoryStorage();
    moduleRef = await createTestModule(
      ALL_ENTITIES,
      [
        SiteMediaService,
        { provide: StorageService, useValue: storage },
        // The site row is inserted by `beforeEach`, so "ensure" is a no-op here.
        { provide: SiteConfigService, useValue: { get: async () => ({}) } },
      ],
      [],
    );
    ds = moduleRef.get(DataSource);
    svc = moduleRef.get(SiteMediaService);
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM site_media WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await ds.query(`DELETE FROM site_media WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft)
       VALUES ($1, 'media-int', 'blue', '{}')`,
      [SEED_TENANT_ID],
    );
    storage.objects.clear();
  });

  it('counts the stored WebP bytes; delete gives them back', async () => {
    const dto = await upload();
    expect(await used()).toBe(dto.bytes);
    await svc.remove(SEED_TENANT_ID, dto.id);
    expect(await used()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it('quota boundary: exactly 100 MB passes, one byte more fails', async () => {
    const n = (await upload()).bytes;
    await ds.query(`DELETE FROM site_media WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await setUsed(SITE_MEDIA_QUOTA_BYTES - n + 1);
    const err = await upload().catch((e) => e);
    expect(err.message).toBe('site.media_rejected');
    expect(
      await ds.query(`SELECT 1 FROM site_media WHERE tenant_id = $1`, [SEED_TENANT_ID]),
    ).toHaveLength(0);

    await setUsed(SITE_MEDIA_QUOTA_BYTES - n);
    await upload();
    expect(await used()).toBe(SITE_MEDIA_QUOTA_BYTES);
  });

  it('delete refuses while the draft or the published site shows the picture', async () => {
    const dto = await upload();
    await ds.query(`UPDATE school_sites SET draft = $2::jsonb WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
      JSON.stringify({ pages: [{ image: dto.id }] }),
    ]);
    const err = await svc.remove(SEED_TENANT_ID, dto.id).catch((e) => e);
    expect(err.message).toBe('site.media_in_use');
    expect(await used()).toBe(dto.bytes);

    await ds.query(
      `UPDATE school_sites SET draft = '{}'::jsonb, published = $2::jsonb WHERE tenant_id = $1`,
      [SEED_TENANT_ID, JSON.stringify({ pages: [{ image: dto.id }] })],
    );
    expect((await svc.remove(SEED_TENANT_ID, dto.id).catch((e) => e)).message).toBe(
      'site.media_in_use',
    );

    await ds.query(`UPDATE school_sites SET published = NULL WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await svc.remove(SEED_TENANT_ID, dto.id);
  });

  it("another school cannot delete this school's picture", async () => {
    const dto = await upload();
    const err = await svc.remove('00000000-0000-4000-8000-0000000000aa', dto.id).catch((e) => e);
    expect(err.message).toBe('site.media_not_found');
    expect(await used()).toBe(dto.bytes);
  });
});

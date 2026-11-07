import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { SITE_MEDIA_QUOTA_BYTES } from '@biddaloy/shared';
import { SiteMediaService } from './site-media.service';
import { SchoolSite } from './entities/school-site.entity';
import { SiteMedia } from './entities/site-media.entity';

const img = (w: number, h: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } })
    [format]()
    .toBuffer();
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function setup(o: { used?: number; existing?: Partial<SiteMedia> | null } = {}) {
  const saved: unknown[] = [];
  const site = { media_bytes_used: String(o.used ?? 0) };
  const qb: Record<string, unknown> = {
    where: () => qb,
    setLock: () => qb,
    getOneOrFail: async () => site,
  };
  const m = {
    getRepository: () => ({ createQueryBuilder: () => qb }),
    findOne: async (e: unknown) => (e === SiteMedia ? (o.existing ?? null) : null),
    create: (_e: unknown, v: object) => ({ ...v, id: 'new-id', created_at: new Date(0) }),
    save: vi.fn(async (r: unknown) => (saved.push(r), r)),
    update: vi.fn(async () => undefined),
  };
  const media = { manager: { transaction: async (cb: (m: unknown) => unknown) => cb(m) } };
  const storage = { put: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
  const config = { get: vi.fn(async () => ({})) };
  const svc = new SiteMediaService(media as never, storage as never, config as never);
  return { svc, storage, saved, m };
}

const rejected = async (p: Promise<unknown>) =>
  expect(await p.catch((e) => e.message)).toBe('site.media_rejected');

describe('SiteMediaService.upload', () => {
  it('turns a 1920x1080 JPEG into WebP in tenant storage', async () => {
    const { svc, storage, saved } = setup();
    const dto = await svc.upload('t1', 'hero', {
      buffer: await img(1920, 1080),
      mimetype: 'image/jpeg',
    });
    expect(dto).toMatchObject({ slot: 'hero', width: 1920, height: 1080 });
    const [key, body, type] = storage.put.mock.calls[0] as unknown as [string, Buffer, string];
    expect(key).toMatch(/^tenants\/t1\/site\/[0-9a-f]{64}\.webp$/);
    expect(type).toBe('image/webp');
    expect((await sharp(body).metadata()).format).toBe('webp');
    expect(saved).toHaveLength(1);
  });

  it('refuses 1919x1080 for hero', async () => {
    const { svc, storage } = setup();
    await rejected(
      svc.upload('t1', 'hero', { buffer: await img(1919, 1080), mimetype: 'image/jpeg' }),
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('post-image accepts any height up to 1200 wide, refuses wider', async () => {
    const { svc } = setup();
    await svc.upload('t1', 'post-image', { buffer: await img(800, 3000), mimetype: 'image/jpeg' });
    await rejected(
      svc.upload('t1', 'post-image', { buffer: await img(1201, 100), mimetype: 'image/jpeg' }),
    );
  });

  it('refuses SVG, a lying mimetype, junk bytes, logo and unknown slots', async () => {
    const { svc, storage } = setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"/>');
    await rejected(svc.upload('t1', 'hero', { buffer: svg, mimetype: 'image/svg+xml' }));
    await rejected(svc.upload('t1', 'hero', { buffer: svg, mimetype: 'image/png' }));
    // A PNG declared as JPEG: the client type is never trusted.
    await rejected(
      svc.upload('t1', 'hero', { buffer: await img(1920, 1080, 'png'), mimetype: 'image/jpeg' }),
    );
    await rejected(
      svc.upload('t1', 'hero', { buffer: Buffer.from('not an image'), mimetype: 'image/jpeg' }),
    );
    await rejected(
      svc.upload('t1', 'logo', { buffer: await img(512, 512), mimetype: 'image/jpeg' }),
    );
    await rejected(
      svc.upload('t1', 'nope', { buffer: await img(1920, 1080), mimetype: 'image/jpeg' }),
    );
    await rejected(
      svc.upload('t1', undefined, { buffer: await img(1920, 1080), mimetype: 'image/jpeg' }),
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('refuses when the WebP size would pass the quota, with the same sentence', async () => {
    const { svc, storage } = setup({ used: SITE_MEDIA_QUOTA_BYTES });
    await rejected(
      svc.upload('t1', 'person', { buffer: await img(400, 400), mimetype: 'image/jpeg' }),
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('the same file twice is one row and one stored object', async () => {
    const buffer = await img(400, 400, 'png');
    const first = setup();
    await first.svc.upload('t1', 'person', { buffer, mimetype: 'image/png' });
    const hash = (first.saved[0] as { hash: string }).hash;
    const second = setup({
      existing: {
        id: 'old-id',
        slot: 'person',
        hash,
        width: 400,
        height: 400,
        bytes: 1,
        created_at: new Date(0),
      },
    });
    const dto = await second.svc.upload('t1', 'person', { buffer, mimetype: 'image/png' });
    expect(dto.id).toBe('old-id');
    expect(second.storage.put).not.toHaveBeenCalled();
    expect(second.saved).toHaveLength(0);
    expect(second.m.update).not.toHaveBeenCalledWith(
      SchoolSite,
      expect.anything(),
      expect.anything(),
    );
  });

  it('deletes the stored object when the row cannot be saved', async () => {
    const { svc, storage, m } = setup();
    m.save.mockRejectedValueOnce(new Error('db down'));
    const err = await svc
      .upload('t1', 'person', { buffer: await img(400, 400), mimetype: 'image/jpeg' })
      .catch((e) => e);
    expect(err.message).toBe('db down');
    const [key] = storage.put.mock.calls[0] as unknown as [string];
    expect(storage.delete).toHaveBeenCalledWith(key);
  });

  it('a quota refusal never touched storage, so nothing is deleted', async () => {
    const { svc, storage } = setup({ used: SITE_MEDIA_QUOTA_BYTES });
    await svc
      .upload('t1', 'person', { buffer: await img(400, 400), mimetype: 'image/jpeg' })
      .catch(() => undefined);
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

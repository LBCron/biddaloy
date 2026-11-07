/**
 * [40.6.02] SiteGallery migration, on a throwaway database: up makes both tables; a photo cannot
 * point at another school's album or picture; album and picture deletes are blocked while a photo
 * uses them; (album, media) is unique; down removes both; up again works.
 */
import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SiteGallery1791900003600 } from '../src/migrations/1791900003600-SiteGallery';
import { assertTestDatabaseUrl, withDbName } from './global-setup';

let admin: DataSource;
let ds: DataSource;
let db: string;

const rnd = () => Math.random().toString(36).slice(2, 12);

async function tableExists(name: string): Promise<boolean> {
  const rows = await ds.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return rows[0].t !== null;
}

async function newSchool(): Promise<string> {
  const rows = await ds.query(`INSERT INTO schools (name, slug) VALUES ('S', $1) RETURNING id`, [
    `s-${rnd()}`,
  ]);
  return rows[0].id;
}

async function newMedia(tenantId: string): Promise<string> {
  const key = rnd();
  const rows = await ds.query(
    `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes) VALUES ($1, 'gallery', $2, $3, 1200, 800, 5) RETURNING id`,
    [tenantId, `k-${key}`, key.padEnd(64, '0')],
  );
  return rows[0].id;
}

async function newAlbum(tenantId: string): Promise<string> {
  const rows = await ds.query(
    `INSERT INTO site_gallery_albums (tenant_id, title) VALUES ($1, '{"bn":"ক","en":"A"}') RETURNING id`,
    [tenantId],
  );
  return rows[0].id;
}

const addPhoto = (tenantId: string, albumId: string, mediaId: string) =>
  ds.query(
    `INSERT INTO site_gallery_photos (tenant_id, album_id, media_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, albumId, mediaId],
  );

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  assertTestDatabaseUrl(url);
  db = `${url.split('/').pop()?.split('?')[0]}_gallerymig`;
  admin = new DataSource({ type: 'postgres', url: withDbName(url, 'postgres') });
  await admin.initialize();
  await admin.query(`DROP DATABASE IF EXISTS "${db}"`);
  await admin.query(`CREATE DATABASE "${db}"`);
  ds = new DataSource({
    type: 'postgres',
    url: withDbName(url, db),
    migrations: [join(__dirname, '..', 'src', 'migrations', '*.{ts,js}')],
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
  });
  await ds.initialize();
  await ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await ds.runMigrations({ transaction: 'each' });
}, 300_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
  if (admin?.isInitialized) {
    await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.destroy();
  }
}, 60_000);

describe('SiteGallery migration', () => {
  it('up: both tables exist', async () => {
    expect(await tableExists('site_gallery_albums')).toBe(true);
    expect(await tableExists('site_gallery_photos')).toBe(true);
  });

  it('blocks deleting an album or a picture while a photo uses it', async () => {
    const t = await newSchool();
    const album = await newAlbum(t);
    const media = await newMedia(t);
    await addPhoto(t, album, media);
    await expect(
      ds.query(`DELETE FROM site_gallery_albums WHERE id = $1`, [album]),
    ).rejects.toThrow(/FK_site_gallery_photos_album_id/);
    await expect(ds.query(`DELETE FROM site_media WHERE id = $1`, [media])).rejects.toThrow(
      /FK_site_gallery_photos_media_id/,
    );
  });

  it("refuses another school's album or picture (tenant-scoped FKs)", async () => {
    const a = await newSchool();
    const b = await newSchool();
    const albumA = await newAlbum(a);
    const mediaA = await newMedia(a);
    const mediaB = await newMedia(b);
    await expect(addPhoto(b, albumA, mediaB)).rejects.toThrow(/FK_site_gallery_photos_album_id/);
    const albumB = await newAlbum(b);
    await expect(addPhoto(b, albumB, mediaA)).rejects.toThrow(/FK_site_gallery_photos_media_id/);
  });

  it('rejects the same picture twice in one album', async () => {
    const t = await newSchool();
    const album = await newAlbum(t);
    const media = await newMedia(t);
    await addPhoto(t, album, media);
    await expect(addPhoto(t, album, media)).rejects.toThrow(/UQ_site_gallery_photos_album_media/);
  });

  it('a hard school delete takes albums and photos along', async () => {
    const t = await newSchool();
    const album = await newAlbum(t);
    await addPhoto(t, album, await newMedia(t));
    await ds.query(`DELETE FROM schools WHERE id = $1`, [t]);
    const left = await ds.query(`SELECT 1 FROM site_gallery_albums WHERE tenant_id = $1`, [t]);
    expect(left).toHaveLength(0);
  });

  it('down removes both tables, up again restores them', async () => {
    const m = new SiteGallery1791900003600();
    const qr = ds.createQueryRunner();
    try {
      await m.down(qr);
      expect(await tableExists('site_gallery_photos')).toBe(false);
      expect(await tableExists('site_gallery_albums')).toBe(false);
      await m.up(qr);
      expect(await tableExists('site_gallery_photos')).toBe(true);
    } finally {
      await qr.release();
    }
  });
});

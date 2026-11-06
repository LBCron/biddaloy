/**
 * [40.1.03] SchoolWebsite migration, on a throwaway database: up creates the five tables,
 * the new columns and the constraints; down removes them and brings `schools.domain` back;
 * up again works.
 */
import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SchoolWebsite1791900003400 } from '../src/migrations/1791900003400-SchoolWebsite';
import { assertTestDatabaseUrl, withDbName } from './global-setup';

const NEW_TABLES = [
  'school_sites',
  'site_media',
  'site_posts',
  'site_enquiries',
  'staff_web_profiles',
];

let admin: DataSource;
let ds: DataSource;
let db: string;

async function tableExists(name: string): Promise<boolean> {
  const rows = await ds.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return rows[0].t !== null;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await ds.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function constraintExists(name: string): Promise<boolean> {
  const rows = await ds.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [name]);
  return rows.length > 0;
}

async function newSchool(): Promise<string> {
  const rows = await ds.query(`INSERT INTO schools (name, slug) VALUES ('S', $1) RETURNING id`, [
    `s-${Math.random().toString(36).slice(2, 10)}`,
  ]);
  return rows[0].id;
}

async function insertSite(tenantId: string, subdomain: string): Promise<void> {
  await ds.query(
    `INSERT INTO school_sites (tenant_id, subdomain, palette, draft) VALUES ($1, $2, 'blue', '{}')`,
    [tenantId, subdomain],
  );
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  assertTestDatabaseUrl(url);
  db = `${url.split('/').pop()?.split('?')[0]}_sitemig`;
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

describe('SchoolWebsite migration', () => {
  it('up: creates tables, columns and drops schools.domain', async () => {
    for (const t of NEW_TABLES) expect(await tableExists(t), t).toBe(true);
    expect(await columnExists('exams', 'website_published_at')).toBe(true);
    expect(await columnExists('exams', 'website_show_names')).toBe(true);
    expect(await columnExists('notices', 'pinned_on_website')).toBe(true);
    expect(await columnExists('schools', 'domain')).toBe(false);
    for (const c of [
      'UQ_school_sites_subdomain',
      'UQ_school_sites_tenant_id',
      'UQ_site_media_tenant_hash',
      'UQ_site_posts_tenant_slug',
      'UQ_staff_web_profiles_tenant_user',
    ]) {
      expect(await constraintExists(c), c).toBe(true);
    }
  });

  it('rejects an invalid subdomain and negative media_bytes_used', async () => {
    const tenant = await newSchool();
    // CHECK: lowercase letters, digits and inner hyphens only
    await expect(insertSite(tenant, 'Bad_Name')).rejects.toThrow(/CHK_school_sites_subdomain/);
    await expect(insertSite(tenant, '-bad')).rejects.toThrow(/CHK_school_sites_subdomain/);
    await expect(
      ds.query(
        `INSERT INTO school_sites (tenant_id, subdomain, palette, draft, media_bytes_used) VALUES ($1, 'ok-name', 'blue', '{}', -1)`,
        [tenant],
      ),
    ).rejects.toThrow(/CHK_school_sites_media_bytes_used/);
    await insertSite(tenant, 'ok-name');
  });

  it('one site per school and unique subdomain', async () => {
    const a = await newSchool();
    const b = await newSchool();
    await insertSite(a, 'dup-one');
    await expect(insertSite(a, 'dup-two')).rejects.toThrow(/UQ_school_sites_tenant_id/);
    await expect(insertSite(b, 'dup-one')).rejects.toThrow(/UQ_school_sites_subdomain/);
  });

  it('checks post kind, media bytes and enquiry length', async () => {
    const t = await newSchool();
    await expect(
      ds.query(
        `INSERT INTO site_posts (tenant_id, kind, slug, title, body) VALUES ($1, 'X', 's', '{}', '{}')`,
        [t],
      ),
    ).rejects.toThrow(/CHK_site_posts_kind/);
    await expect(
      ds.query(
        `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes) VALUES ($1, 'hero', 'k1', $2, 1, 1, 0)`,
        [t, 'a'.repeat(64)],
      ),
    ).rejects.toThrow(/CHK_site_media_bytes/);
    await expect(
      ds.query(
        `INSERT INTO site_enquiries (tenant_id, name, phone, message) VALUES ($1, 'n', 'p', $2)`,
        [t, 'x'.repeat(2001)],
      ),
    ).rejects.toThrow(/CHK_site_enquiries_message_len/);
  });

  it('deleting a media row clears the post cover instead of blocking', async () => {
    const t = await newSchool();
    const media = await ds.query(
      `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes) VALUES ($1, 'hero', 'k2', $2, 1, 1, 5) RETURNING id`,
      [t, 'b'.repeat(64)],
    );
    const post = await ds.query(
      `INSERT INTO site_posts (tenant_id, slug, title, body, cover_media_id) VALUES ($1, 's', '{}', '{}', $2) RETURNING id`,
      [t, media[0].id],
    );
    await ds.query(`DELETE FROM site_media WHERE id = $1`, [media[0].id]);
    const rows = await ds.query(`SELECT cover_media_id FROM site_posts WHERE id = $1`, [
      post[0].id,
    ]);
    expect(rows[0].cover_media_id).toBeNull();
  });

  it('down then up: tables gone, schools.domain back, then recreated', async () => {
    // call this migration directly, so a later migration landing never breaks this test
    const qr = ds.createQueryRunner();
    await new SchoolWebsite1791900003400().down(qr);
    for (const t of NEW_TABLES) expect(await tableExists(t), t).toBe(false);
    expect(await columnExists('schools', 'domain')).toBe(true);
    expect(await columnExists('exams', 'website_published_at')).toBe(false);
    expect(await columnExists('notices', 'pinned_on_website')).toBe(false);

    await new SchoolWebsite1791900003400().up(qr);
    await qr.release();
    for (const t of NEW_TABLES) expect(await tableExists(t), t).toBe(true);
    expect(await columnExists('schools', 'domain')).toBe(false);
  });
});

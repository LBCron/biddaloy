/**
 * [40.1.03] SchoolWebsite migration, on a throwaway database: up creates the five tables,
 * the new columns and the constraints; down removes them and brings `schools.domain` back;
 * up again works. Also: picture FKs are tenant-scoped, custom_domain is lower case only.
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

async function newUser(): Promise<string> {
  const rows = await ds.query(
    `INSERT INTO users (id, email, full_name) VALUES (gen_random_uuid(), $1, 'Site Test') RETURNING id`,
    [`u-${Math.random().toString(36).slice(2, 10)}@site.test`],
  );
  return rows[0].id;
}

async function newMedia(tenantId: string): Promise<string> {
  const key = Math.random().toString(36).slice(2, 12);
  const rows = await ds.query(
    `INSERT INTO site_media (tenant_id, slot, storage_key, hash, width, height, bytes) VALUES ($1, 'hero', $2, $3, 1, 1, 5) RETURNING id`,
    [tenantId, `k-${key}`, key.padEnd(64, '0')],
  );
  return rows[0].id;
}

async function indexExists(name: string): Promise<boolean> {
  const rows = await ds.query(`SELECT to_regclass($1) AS i`, [`public.${name}`]);
  return rows[0].i !== null;
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
      'UQ_site_media_tenant_id',
      'CHK_school_sites_custom_domain_lower',
    ]) {
      expect(await constraintExists(c), c).toBe(true);
    }
    // previous_subdomain's UNIQUE is already an index; the old extra partial index is gone.
    expect(await indexExists('IDX_school_sites_previous_subdomain')).toBe(false);
  });

  it('stores custom_domain in lower case only', async () => {
    const a = await newSchool();
    const b = await newSchool();
    // Mixed case would let "School.com" and "school.com" both pass the UNIQUE.
    await expect(
      ds.query(
        `INSERT INTO school_sites (tenant_id, subdomain, palette, draft, custom_domain) VALUES ($1, 'case-a', 'blue', '{}', 'School.Example.com')`,
        [a],
      ),
    ).rejects.toThrow(/CHK_school_sites_custom_domain_lower/);
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft, custom_domain) VALUES ($1, 'case-b', 'blue', '{}', 'school.example.com')`,
      [b],
    );
  });

  it("refuses another school's picture on a post or a staff card", async () => {
    const owner = await newSchool();
    const other = await newSchool();
    const media = await newMedia(owner);
    const user = await newUser();
    // Tenant isolation in the DB: the composite FK (tenant_id, media_id) has no match.
    await expect(
      ds.query(
        `INSERT INTO site_posts (tenant_id, slug, title, body, cover_media_id) VALUES ($1, 'x', '{}', '{}', $2)`,
        [other, media],
      ),
    ).rejects.toThrow(/FK_site_posts_cover_media_id/);
    await expect(
      ds.query(
        `INSERT INTO staff_web_profiles (tenant_id, user_id, photo_media_id) VALUES ($1, $2, $3)`,
        [other, user, media],
      ),
    ).rejects.toThrow(/FK_staff_web_profiles_photo_media_id/);
    // Same school: accepted.
    await ds.query(
      `INSERT INTO staff_web_profiles (tenant_id, user_id, photo_media_id) VALUES ($1, $2, $3)`,
      [owner, user, media],
    );
  });

  it('deleting a picture clears only the staff photo; deleting the user removes the card', async () => {
    const t = await newSchool();
    const media = await newMedia(t);
    const user = await newUser();
    const card = await ds.query(
      `INSERT INTO staff_web_profiles (tenant_id, user_id, photo_media_id) VALUES ($1, $2, $3) RETURNING id`,
      [t, user, media],
    );
    await ds.query(`DELETE FROM site_media WHERE id = $1`, [media]);
    const rows = await ds.query(
      `SELECT tenant_id, photo_media_id FROM staff_web_profiles WHERE id = $1`,
      [card[0].id],
    );
    // SET NULL ("photo_media_id") leaves tenant_id alone (a plain SET NULL would null both).
    expect(rows[0]).toEqual({ tenant_id: t, photo_media_id: null });

    await ds.query(`DELETE FROM users WHERE id = $1`, [user]);
    const left = await ds.query(`SELECT 1 FROM staff_web_profiles WHERE id = $1`, [card[0].id]);
    expect(left).toHaveLength(0);
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
    const rows = await ds.query(`SELECT tenant_id, cover_media_id FROM site_posts WHERE id = $1`, [
      post[0].id,
    ]);
    // Only the media column is cleared; the row stays in its school.
    expect(rows[0]).toEqual({ tenant_id: t, cover_media_id: null });
  });

  it('down then up: tables gone, schools.domain back, then recreated', async () => {
    // call this migration directly, so a later migration landing never breaks this test
    const qr = ds.createQueryRunner();
    // later migrations (site gallery) hang foreign keys off site_media; this DB is throwaway
    await qr.query('DROP TABLE IF EXISTS site_gallery_photos, site_gallery_albums CASCADE');
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

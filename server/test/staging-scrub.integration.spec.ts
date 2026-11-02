import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ENTITIES } from './all-entities';
import { SEED_TENANT_ID } from './constants';
import { STAGING_SCRUB_COLUMNS, unreviewedColumns } from './staging-scrub-columns';
import { TenantSettingsDto } from '../src/modules/schools/dto/tenant-settings.dto';
import { getSecretPaths } from '../src/modules/schools/settings/secret-paths.util';

/**
 * [Epic 79 / #2793] Staging scrub.
 *
 * (a) Guard: reads the live schema and fails when a column that may hold personal data is not in
 *     the reviewed list (`staging-scrub-columns.ts`), so a new column cannot leak to staging.
 * (b) Runs `scripts/backup/scrub.sql` for real, inside a transaction that is rolled back, and
 *     checks that no original detail survives.
 */

const SCRUB_SQL = join(__dirname, '..', '..', 'scripts', 'backup', 'scrub.sql');
const HASH = '$2b$12$' + 'x'.repeat(53);

let ds: DataSource;

beforeAll(async () => {
  ds = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL, entities: ALL_ENTITIES });
  await ds.initialize();
});
afterAll(async () => {
  await ds?.destroy();
});

describe('staging scrub column guard', () => {
  it('lists every column that may hold personal data', async () => {
    const rows = await ds.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name NOT LIKE 'typeorm\\_%'`,
    );
    const missing = unreviewedColumns(rows).map(
      (c) =>
        `new column ${c} may hold personal data — add it to scrub.sql and staging-scrub-columns.ts`,
    );
    expect(missing).toEqual([]);
  });

  it('flags a new date, number or text column that looks personal', () => {
    const flagged = unreviewedColumns([
      { table_name: 'guardians', column_name: 'guardian_dob', data_type: 'date' },
      { table_name: 'guardians', column_name: 'nid', data_type: 'bigint' },
      { table_name: 'guardians', column_name: 'guardian_phone', data_type: 'character varying' },
      { table_name: 'guardians', column_name: 'extra', data_type: 'jsonb' },
      { table_name: 'guardians', column_name: 'user_id', data_type: 'uuid' },
      { table_name: 'guardians', column_name: 'created_at', data_type: 'timestamp with time zone' },
    ]);
    expect(flagged).toEqual([
      'guardians.guardian_dob',
      'guardians.nid',
      'guardians.guardian_phone',
      'guardians.extra',
    ]);
  });

  it('lists only columns that exist', async () => {
    const rows: { table_name: string; column_name: string }[] = await ds.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const live = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const tables = new Set(rows.map((r) => r.table_name));
    const stale = STAGING_SCRUB_COLUMNS.filter((c) =>
      c.column === '*' ? !tables.has(c.table) : !live.has(`${c.table}.${c.column}`),
    ).map((c) => `${c.table}.${c.column}`);
    expect(stale).toEqual([]);
  });

  it('only a list entry with column * may empty a table', () => {
    const bad = STAGING_SCRUB_COLUMNS.filter(
      (c) => (c.handling === 'delete-row') !== (c.column === '*'),
    );
    expect(bad).toEqual([]);
  });
});

describe('scrub.sql', () => {
  const sfx = randomUUID().slice(0, 8);
  const REAL_EMAIL = `real-${sfx}@school.example`;
  const REAL_PHONE = `+88017${sfx.replace(/\D/g, '1').padEnd(8, '1').slice(0, 8)}`;
  const REAL_NAME = `Realname${sfx}`;
  const SMOKE_SLUG = `smoke-${sfx}`;
  const platformId = randomUUID();
  const smokeId = randomUUID();
  const adminUserId = randomUUID();
  const smokeUserId = randomUUID();
  const parentUserId = randomUUID();
  const SECRET_PATHS = getSecretPaths(TenantSettingsDto as never);
  let qr: QueryRunner;

  const q = (sql: string, params?: unknown[]) => qr.query(sql, params);
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0];

  async function insertSchool(id: string, slug: string, settings: object) {
    await q(
      `INSERT INTO schools (id, name, slug, phone, email, address, settings)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::text, $7::jsonb)`,
      [id, `School ${slug}`, slug, REAL_PHONE, REAL_EMAIL, REAL_NAME, JSON.stringify(settings)],
    );
  }
  async function insertUser(id: string, email: string) {
    await q(
      `INSERT INTO users (id, email, phone, full_name, password_hash)
       VALUES ($1, $2, $3, $4, 'old-hash')`,
      [id, email, `+88018${id.replace(/\D/g, '').padEnd(8, '2').slice(0, 8)}`, REAL_NAME],
    );
  }

  /** The secrets in the shape TenantSettingsDto describes, one value per @Secret() path. */
  function settingsWithAllSecrets() {
    const settings: Record<string, unknown> = {};
    for (const path of SECRET_PATHS) {
      const keys = path.split('.');
      let node = settings;
      for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>;
      node[keys[keys.length - 1]] = `secret-${sfx}`;
    }
    return settings;
  }

  // ---- generic worst-state seeding ----------------------------------------------------------
  // Every table the scrub touches gets 3 rows: each scrubbed column holds a unique sentinel and
  // every other NOT NULL column a dummy, so NOT NULL, CHECK, unique-index and trigger problems
  // in scrub.sql show up here and not on the first real night. Foreign keys are dropped in
  // the transaction (rolled back with it); the scrub never touches key columns.
  type Col = {
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    character_maximum_length: number | null;
  };
  const sentinels: { table: string; column: string; value: string; kind: 'text' | 'date' }[] = [];
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const hex = (n: number) =>
    (randomUUID() + randomUUID() + randomUUID()).replace(/-/g, '').slice(0, n);

  async function enumLabels(udt: string): Promise<string[]> {
    const rows = await q(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder`,
      [udt],
    );
    return rows.map((r: { enumlabel: string }) => r.enumlabel);
  }

  async function seedRows(table: string, fixed: Record<string, string> = {}) {
    const cols: Col[] = await q(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    const listed = new Set(
      STAGING_SCRUB_COLUMNS.filter(
        (c) => c.table === table && ['fake', 'null'].includes(c.handling),
      ).map((c) => c.column),
    );
    // A column limited by CHECK (col IN ('A', 'B')) gets its first allowed value.
    const defs: string[] = (
      await q(
        `SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c WHERE c.contype = 'c' AND c.conrelid = $1::regclass`,
        [`"${table}"`],
      )
    ).map((r: { d: string }) => r.d);
    const firstAllowed = (col: string) => {
      for (const d of defs) {
        const m = new RegExp(`\\(?"?${col}"?\\)?(?:::[a-z ]+)? = ANY[^\\[]*\\['([^']+)'`).exec(d);
        if (m) return m[1];
      }
      return null;
    };
    for (let i = 0; i < 3; i++) {
      const names: string[] = [];
      const values: string[] = [];
      for (const c of cols) {
        const isListed = listed.has(c.column_name);
        const needed = c.is_nullable === 'NO' && c.column_default === null;
        if (c.column_name in fixed) {
          names.push(c.column_name);
          values.push(fixed[c.column_name]);
          continue;
        }
        if (!isListed && !needed) continue;
        const max = Math.min(c.character_maximum_length ?? 12, 12);
        let v: string;
        let cast: string = c.data_type;
        if (c.data_type === 'uuid') v = lit(randomUUID());
        else if (['character varying', 'text', 'character'].includes(c.data_type)) {
          const len = c.data_type === 'character' ? (c.character_maximum_length ?? 1) : max;
          const word = hex(len).padEnd(len, 'a');
          const allowed = firstAllowed(c.column_name);
          const marked = allowed ?? (isListed && len >= 8 ? `ZZ${word.slice(2)}` : word);
          v = lit(marked);
          if (c.data_type === 'character') cast = `character(${len})`;
          if (!allowed && isListed && len >= 8)
            sentinels.push({ table, column: c.column_name, value: marked, kind: 'text' });
        } else if (
          ['integer', 'smallint', 'bigint', 'numeric', 'double precision', 'real'].includes(
            c.data_type,
          )
        )
          v = String(i + 1);
        else if (c.data_type === 'boolean') v = 'false';
        else if (c.data_type === 'date') {
          const d = `${2001 + i * 2}-03-10`; // 2 years apart: a shift of at most 180 days cannot land on another
          v = lit(d);
          if (isListed) sentinels.push({ table, column: c.column_name, value: d, kind: 'date' });
        } else if (c.data_type.startsWith('timestamp')) v = lit(`2026-01-01T00:00:0${i}Z`);
        else if (c.data_type.startsWith('time')) v = lit('08:00:00');
        else if (c.data_type === 'jsonb' || c.data_type === 'json') {
          const mark = `ZZ${hex(8)}`;
          // The keys the attention rules write a student name into (homework-not-submitted.rule.ts).
          v = lit(
            JSON.stringify({
              studentName: mark,
              headline_en: `${mark} has not submitted the homework`,
              headline_bn: `${mark} বাড়ির কাজ জমা দেয়নি`,
            }),
          );
          if (isListed) sentinels.push({ table, column: c.column_name, value: mark, kind: 'text' });
        } else if (c.data_type === 'ARRAY') {
          v = lit('{}');
          cast = `${c.udt_name.replace(/^_/, '')}[]`;
        } else if (c.data_type === 'USER-DEFINED') {
          v = lit((await enumLabels(c.udt_name))[0]);
          cast = `"${c.udt_name}"`;
        } else throw new Error(`seedRows: no dummy for ${table}.${c.column_name} (${c.data_type})`);
        names.push(c.column_name);
        values.push(`${v}::${cast}`);
      }
      const insert = `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${values.join(', ')})`;
      await q(insert).catch((err) => {
        throw new Error(`seeding ${table}: ${(err as Error).message} :: ${insert.slice(0, 600)}`);
      });
    }
  }

  async function seedWorstState() {
    const notDraft = (await enumLabels('invoices_status_enum')).find((l) => l !== 'DRAFT');
    expect(notDraft, 'an invoice status other than DRAFT').toBeDefined();
    const snapshot = JSON.stringify({
      issuer: { name: 'Real School', phone: REAL_PHONE, captured_at: '2026-01-01' },
      students: [{ id: randomUUID(), full_name: REAL_NAME }],
      payment: { reference: 'REF-1', received_by_name: REAL_NAME },
    });
    // Columns whose value matters for a constraint or trigger.
    const fixed: Record<string, Record<string, string>> = {
      // An issued invoice (a credit note carries notes) is frozen by trg_enforce_invoice_immutability.
      invoices: {
        status: `${lit(notDraft as string)}::"invoices_status_enum"`,
        snapshot: `${lit(snapshot)}::jsonb`,
      },
      promotion_entries: { is_override: 'true' },
      applications: {
        applicant_user_id: lit(randomUUID()) + '::uuid',
        subject_student_id: lit(randomUUID()) + '::uuid',
      },
      staff_incidents: { withdrawn_at: `'2026-01-02T00:00:00Z'::timestamptz` },
      communication_logs: { status: `'QUEUED'::"communication_logs_status_enum"` },
      // CHK_notice_recipients_target: a STAFF row needs a user
      notice_recipients: { user_id: lit(randomUUID()) + '::uuid' },
    };
    const tables = [
      ...new Set(
        STAGING_SCRUB_COLUMNS.filter((c) => c.handling !== 'kept-public').map((c) => c.table),
      ),
    ];
    // The dummy rows have no parents. Dropping the foreign keys is transactional DDL: it is rolled
    // back with everything else, and it keeps Postgres from re-checking a key on every UPDATE of a
    // row this transaction inserted (real rows are old, so it would not do that on staging).
    for (const t of tables) {
      const fks = await q(
        `SELECT conname FROM pg_constraint WHERE contype = 'f' AND conrelid = $1::regclass`,
        [`"${t}"`],
      );
      for (const { conname } of fks) await q(`ALTER TABLE "${t}" DROP CONSTRAINT "${conname}"`);
    }
    for (const t of tables) await seedRows(t, fixed[t] ?? {});
  }

  async function prepare() {
    qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction(); // never committed: the test database is left as it was
    await insertSchool(platformId, `platform-${sfx}`, {});
    await insertSchool(smokeId, SMOKE_SLUG, {});
    await insertSchool(randomUUID(), `real-school-${sfx}`, settingsWithAllSecrets());
    await insertUser(adminUserId, `admin-${sfx}@platform.example`);
    await insertUser(smokeUserId, `smoke-${sfx}@school.example`);
    await insertUser(parentUserId, REAL_EMAIL);
    // ids are random UUIDs made above, so they are safe to inline (a bound $2 trips a type check here)
    await q(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ('${adminUserId}', '${platformId}', 'SUPER_ADMIN')`,
    );
    await q(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ('${smokeUserId}', '${smokeId}', 'ADMIN')`,
    );
    await q(
      `INSERT INTO guardians (tenant_id, full_name, relationship, phone, email, alternate_phone, address, occupation)
       VALUES ($1, $2, 'FATHER', $3, $4, $3, $5, $6)`,
      [SEED_TENANT_ID, REAL_NAME, REAL_PHONE, REAL_EMAIL, REAL_NAME, REAL_NAME],
    );
    await q(
      `INSERT INTO communication_logs (tenant_id, medium, message_body, recipient_address, recipient_name, status)
       VALUES ($1, 'SMS', $2, $3, $4, 'QUEUED'), ($1, 'SMS', $2, $3, $4, 'SENT')`,
      [SEED_TENANT_ID, `hello ${REAL_NAME}`, REAL_PHONE, REAL_NAME],
    );
    await q(
      `INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, 'k', 'a')`,
      [SEED_TENANT_ID, parentUserId, `https://push.example/${sfx}`],
    );
    await seedWorstState();
    const scrub = readFileSync(SCRUB_SQL, 'utf8')
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .replace(/:'staging_password_hash'/g, `'${HASH}'`)
      .replace(/:'smoke_slug'/g, `'${SMOKE_SLUG}'`)
      .replace(/:'platform_tenant_id'/g, `'${platformId}'`);
    await q(scrub);
  }

  const checks: [string, () => Promise<void>][] = [];
  checks.push([
    'keeps only super admin and smoke school emails',
    async () => {
      const rows = await q(`SELECT id FROM users WHERE email NOT LIKE '%@staging.invalid'`);
      expect(rows.map((r: { id: string }) => r.id).sort()).toEqual(
        [adminUserId, smokeUserId].sort(),
      );
    },
  ]);

  checks.push([
    'leaves no original email, phone or name in users, guardians or schools',
    async () => {
      const hits = await one(
        `SELECT (SELECT count(*) FROM users WHERE id <> $4 AND (phone = $1 OR full_name = $2 OR email = $3))::int
            + (SELECT count(*) FROM guardians WHERE phone = $1 OR alternate_phone = $1 OR email = $3
                 OR full_name = $2 OR address = $2 OR occupation = $2)::int
            + (SELECT count(*) FROM schools WHERE id <> $5 AND (phone = $1 OR email = $3 OR address = $2))::int AS n`,
        [REAL_PHONE, REAL_NAME, REAL_EMAIL, smokeUserId, platformId],
      );
      expect(hits.n).toBe(0);
    },
  ]);

  checks.push([
    'gives every user the staging password hash',
    async () => {
      const bad = await one(
        `SELECT count(*)::int AS n FROM users WHERE password_hash IS DISTINCT FROM $1`,
        [HASH],
      );
      expect(bad.n).toBe(0);
    },
  ]);

  checks.push([
    'removes every @Secret() path from every school settings',
    async () => {
      expect(SECRET_PATHS.length).toBeGreaterThan(0);
      for (const path of SECRET_PATHS) {
        const row = await one(
          `SELECT count(*)::int AS n FROM schools WHERE settings #> $1::text[] IS NOT NULL`,
          [`{${path.split('.').join(',')}}`],
        );
        expect(row.n, path).toBe(0);
      }
    },
  ]);

  checks.push([
    'cancels queued messages and blanks every message',
    async () => {
      const row = await one(
        `SELECT count(*) FILTER (WHERE status = 'QUEUED')::int AS queued,
              count(*) FILTER (WHERE message_body <> '[scrubbed]' OR recipient_address <> 'scrubbed')::int AS leaked
       FROM communication_logs`,
      );
      expect(row).toEqual({ queued: 0, leaked: 0 });
    },
  ]);

  checks.push([
    'empties token, session and device tables',
    async () => {
      for (const t of [
        'refresh_tokens',
        'auth_tokens',
        'calendar_feed_tokens',
        'invoice_share_tokens',
        'push_subscriptions',
        'attendance_devices',
        'user_identities',
      ]) {
        const row = await one(`SELECT count(*)::int AS n FROM ${t}`);
        expect(row.n, t).toBe(0);
      }
    },
  ]);

  checks.push([
    'leaves none of the seeded sentinel values in any scrubbed column',
    async () => {
      expect(sentinels.length).toBeGreaterThan(50);
      const leaks: string[] = [];
      for (const sv of sentinels) {
        const row =
          sv.kind === 'text'
            ? await one(
                `SELECT count(*)::int AS n FROM "${sv.table}" WHERE strpos("${sv.column}"::text, $1) > 0`,
                [sv.value],
              )
            : await one(
                `SELECT count(*)::int AS n FROM "${sv.table}" WHERE "${sv.column}"::text = $1`,
                [sv.value],
              );
        if (row.n !== 0) leaks.push(`${sv.table}.${sv.column}`);
      }
      expect([...new Set(leaks)]).toEqual([]);
    },
  ]);

  checks.push([
    'keeps alert headlines as a placeholder, without the student name',
    async () => {
      const leaks = await one(
        `SELECT count(*)::int AS n FROM alerts WHERE params ? 'studentName'
           OR coalesce(params->>'headline_en', '[scrubbed]') <> '[scrubbed]'
           OR coalesce(params->>'headline_bn', '[scrubbed]') <> '[scrubbed]'`,
      );
      expect(leaks.n).toBe(0);
      // The seeded rows had headlines: the title key is still there, as a placeholder.
      const kept = await one(
        `SELECT count(*)::int AS n FROM alerts WHERE params->>'headline_en' = '[scrubbed]'`,
      );
      expect(kept.n).toBeGreaterThan(0);
    },
  ]);

  checks.push([
    'empties every delete-row table',
    async () => {
      for (const c of STAGING_SCRUB_COLUMNS.filter((x) => x.handling === 'delete-row')) {
        const row = await one(`SELECT count(*)::int AS n FROM "${c.table}"`);
        expect(row.n, c.table).toBe(0);
      }
    },
  ]);

  checks.push([
    'writes unique fake phones in the Bangladesh mobile shape',
    async () => {
      const dup = await q(
        `SELECT phone FROM users WHERE phone IS NOT NULL GROUP BY phone HAVING count(*) > 1`,
      );
      expect(dup).toEqual([]);
      const bad = await one(
        `SELECT count(*)::int AS n FROM users
         WHERE phone IS NOT NULL AND phone !~ '^[+]?880?1[3-9][0-9]{8}$' AND id <> $1`,
        [smokeUserId],
      );
      expect(bad.n).toBe(0);
    },
  ]);

  checks.push([
    'keeps the append-only triggers enabled',
    async () => {
      const rows = await q(
        `SELECT tgname FROM pg_trigger WHERE tgenabled = 'D' AND NOT tgisinternal`,
      );
      expect(rows).toEqual([]);
    },
  ]);

  // One test: the whole thing runs in a single transaction that is rolled back. A transaction
  // held open across tests would block the TRUNCATE in the shared beforeEach hook (test/setup.ts).
  it('scrubs production-shaped data (rolled back)', async () => {
    try {
      await prepare();
      for (const [name, check] of checks) {
        try {
          await check();
        } catch (err) {
          throw new Error(`${name}: ${(err as Error).message}`);
        }
      }
    } finally {
      await qr?.rollbackTransaction();
      await qr?.release();
    }
  });
});

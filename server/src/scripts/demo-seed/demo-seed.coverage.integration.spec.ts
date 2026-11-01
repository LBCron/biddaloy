import 'ts-node/register/transpile-only';
import { createHash } from 'crypto';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../../../test/all-entities';
import { DEMO_CARDS } from '../../modules/demo/demo-accounts';
import type { DemoSlice } from './context';
import { validate } from './validator';

/**
 * [58.1.05] Demo-seed coverage guard. Seeds a fresh, migrated database and checks that every
 * entity is either filled by a slice, owed by a named ticket (`owedBy`) or exempt (`EXEMPT` in
 * slices.ts). Every message names the entity and the fix. Needs Postgres + Redis:
 * `yarn test-env run -- ...`.
 */
const BUDGET_MS = 90_000; // D39
const MAIN = { scale: 0.05, years: 2, anchor: '2026-10-10' };
// years: 2 so the pair also runs the PromotionsService.commit path (years 1 never reaches it).
const SMALL = { scale: 0.02, years: 2, anchor: '2026-10-10' };
const TENANTS = `SELECT id FROM schools WHERE slug LIKE 'bmsc-%'`;

const entityNames = ALL_ENTITIES.map((e) => (e as { name: string }).name);
const baseUrl = new URL(process.env.DATABASE_URL!);
const baseDb = baseUrl.pathname.slice(1);
const urlFor = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};

async function admin<T>(fn: (ds: DataSource) => Promise<T>): Promise<T> {
  const ds = new DataSource({ type: 'postgres', url: urlFor('postgres') });
  await ds.initialize();
  try {
    return await fn(ds);
  } finally {
    await ds.destroy();
  }
}

const dropDb = (db: string) =>
  admin(async (a) => {
    await a.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [
      db,
    ]);
    await a.query(`DROP DATABASE IF EXISTS "${db}"`);
  });

async function freshMigratedDb(db: string): Promise<void> {
  await dropDb(db);
  await admin((a) => a.query(`CREATE DATABASE "${db}"`));
  const m = new DataSource({
    type: 'postgres',
    url: urlFor(db),
    migrations: [join(__dirname, '..', '..', 'migrations', '*.{ts,js}')],
    migrationsTableName: 'typeorm_migrations',
  });
  await m.initialize();
  // The initial migration calls uuid_generate_v4(); the Docker image creates the extension.
  await m.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await m.runMigrations({ transaction: 'each' });
  await m.destroy();
}

interface Table {
  name: string;
  table: string;
  tenantScoped: boolean;
  cols: string[];
}

/** Only demo data counts: the migrated `default-school` row and any platform rows are not ours. */
const scope = (t: Table) =>
  t.table === 'schools'
    ? ` WHERE slug LIKE 'bmsc-%'`
    : t.tenantScoped
      ? ` WHERE tenant_id IN (${TENANTS})`
      : '';

/** Rows per entity (demo data only: bmsc-* tenants). */
async function countRows(ds: DataSource, tables: Table[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM "${t.table}"${scope(t)}`);
    out[t.name] = Number(n);
  }
  return out;
}

/**
 * Columns a real service stamps with the real clock while the seed runs ("today" comes from the real
 * services). Only these lose their whole timestamp (date too: a run straddling Dhaka midnight changes
 * the date); every other column must match in full, so a stray `Date.now()` in a slice still fails determinism.
 */
const CLOCK_COLS: Record<string, string[]> = {
  payments: ['payment_date'],
  invoices: ['issued_date', 'due_date'],
  invoice_share_tokens: ['expires_at'],
  applications: ['decided_at'], // today's decisions go through ApplicationDecisionsService
  alerts: ['raised_at', 'last_evaluated_at', 'expires_at'], // manual alerts only, see CLOCK_ONLY_WHEN
  alert_recipients: ['pushed_at'], // delivery stamps it with the real clock, after the seed returns
};

/** First day of the month before the anchor's: the live (real-service) money starts here. */
const LIVE_FROM = (() => {
  const [y, m] = SMALL.anchor.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
})();
/** Payments the real allocation service wrote: they pay last month's or this month's bills. */
const LIVE_PAYMENT = `SELECT pa.payment_id FROM payment_allocations pa
  JOIN student_fees sf ON sf.id = pa.student_fee_id WHERE sf.period_start >= '${LIVE_FROM}'`;

/**
 * Row filter for a table's CLOCK_COLS: only the rows a real service wrote lose their clock columns.
 * Every bulk row derives from the anchor and must match in full. No filter reads a column it strips,
 * so a stray `new Date()` in a bulk path's clock column still changes the fingerprint.
 * - alerts: manual alerts only (rule and history alerts derive from the anchor).
 * - payments, invoices: the live payments (bills from last month on); 10 years of bulk history stay exact.
 * - applications: today's requests, created by the service (bulk history is created before the anchor).
 */
const CLOCK_ONLY_WHEN: Record<string, string> = {
  alerts: `source = 'MANUAL'`,
  payments: `id IN (${LIVE_PAYMENT})`,
  invoices: `payment_id IN (${LIVE_PAYMENT})`,
  applications: `created_at >= '${SMALL.anchor}'`,
};

/** Counts plus an md5 of business columns per table; ids, timestamps and hashes are left out. */
async function fingerprint(ds: DataSource, tables: Table[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of tables) {
    const cols = t.cols.filter(
      (c) =>
        !/^(id|created_at|updated_at|deleted_at|published_at)$|_id$|hash|token|secret|salt/.test(c),
    );
    // Strip uuids (tenant ids sit inside storage keys and `_by` columns) and ISO clock times inside
    // jsonb (the preset apply stamps `appliedAt`, invoice snapshots `captured_at`); the CLOCK_COLS also
    // lose the Postgres space form. Everything else must match byte for byte.
    const uuid = (c: string) =>
      `regexp_replace("${c}"::text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'U', 'g')`;
    const iso = (e: string) =>
      `regexp_replace(${e}, 'T[0-9]{2}:[0-9]{2}:[0-9]{2}[0-9.]*(Z|[+-][0-9:]+)?', 'T', 'g')`;
    const whole = (e: string) =>
      `regexp_replace(${e}, '[0-9]{4}-[0-9]{2}-[0-9]{2}([ T][0-9]{2}:[0-9]{2}:[0-9]{2}[0-9.]*(Z|[+-][0-9:]+)?)?', 'T', 'g')`;
    // Settings secrets are AES-GCM envelopes `gcmv1:<iv>:<tag>:<ct>` with a random IV (EncryptionService),
    // so their text differs every run even for the same secret: each envelope becomes `E`.
    const sealed = (c: string) =>
      `regexp_replace(${uuid(c)}, 'gcmv1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+', 'E', 'g')`;
    const row =
      cols
        .map((c) => {
          const plain = iso(sealed(c));
          if (!CLOCK_COLS[t.table]?.includes(c)) return plain;
          const stripped = whole(sealed(c));
          const when = CLOCK_ONLY_WHEN[t.table];
          return when ? `CASE WHEN ${when} THEN ${stripped} ELSE ${plain} END` : stripped;
        })
        .join(', ') || `''`;
    const [{ h, n }] = await ds.query(
      `SELECT count(*)::int AS n,
              md5(COALESCE(string_agg(r, E'\\n' ORDER BY r), '')) AS h
         FROM (SELECT concat_ws('|', ${row}) AS r FROM "${t.table}"${scope(t)}) x`,
    );
    out[t.name] = `${n}:${h}`;
  }
  return out;
}

/** Open alerts each demo login sees: the attention engine's sweeps derive them (58.3.09). */
async function openAlertsByCard(ds: DataSource): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const c of DEMO_CARDS) {
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM alert_recipients r
         JOIN alerts a ON a.id = r.alert_id AND a.status = 'ACTIVE'
         JOIN users u ON u.id = r.user_id
        WHERE u.email = $1 AND r.state = 'OPEN'`,
      [c.email],
    );
    out[c.key] = Number(n);
  }
  return out;
}

describe('demo seed coverage', () => {
  // biddaloy_demo* so runDemoSeed's own DB-name guard passes. A hash of the base name keeps runs
  // apart and the name under Postgres's 63-char limit (longer names truncate into one database).
  const tag = createHash('sha1').update(baseDb).digest('hex').slice(0, 12);
  const dbs = ['main', 'a', 'b'].map((x) => `biddaloy_demo_cov_${tag}_${x}`);
  const savedUrl = process.env.DATABASE_URL;
  let closeMain: () => Promise<void> = async () => {};
  let slices: DemoSlice[] = [];
  let exempt: Record<string, string> = {};
  let rows: Record<string, number> = {};
  let elapsed = 0;
  let violations: Awaited<ReturnType<typeof validate>> = [];
  let fpA: Record<string, string> = {};
  let fpB: Record<string, string> = {};
  let openAlerts: Record<string, number> = {};

  /** Seeds `db` from a freshly loaded module graph (the app caches DATABASE_URL on first load). */
  async function seedInto(db: string, args: typeof MAIN, keepOpen: boolean) {
    await freshMigratedDb(db);
    process.env.DATABASE_URL = urlFor(db);
    vi.resetModules();
    const { runDemoSeed } = await import('./index');
    const slicesMod = await import('./slices');
    const t0 = Date.now();
    const run = await runDemoSeed(args, 'Demo@12345');
    const ms = Date.now() - t0;
    const tables: Table[] = ALL_ENTITIES.map((e) => {
      const meta = run.ds.entityMetadatas.find((m) => m.name === (e as { name: string }).name)!;
      return {
        name: meta.name,
        table: meta.tableName,
        tenantScoped: meta.columns.some((c) => c.databaseName === 'tenant_id'),
        cols: meta.columns.map((c) => c.databaseName),
      };
    });
    const exemptNames = Object.keys(slicesMod.EXEMPT);
    const result = {
      ds: run.ds,
      tables,
      slices: slicesMod.SLICES,
      exempt: slicesMod.EXEMPT,
      ms,
      fp: await fingerprint(
        run.ds,
        tables.filter((t) => !exemptNames.includes(t.name)),
      ),
      counts: keepOpen ? await countRows(run.ds, tables) : {},
      violations: keepOpen ? await validate(run.ds) : [],
      openAlerts: keepOpen ? await openAlertsByCard(run.ds) : {},
    };
    if (keepOpen) closeMain = () => run.app.close();
    else await run.app.close();
    return result;
  }

  beforeAll(async () => {
    const main = await seedInto(dbs[0], MAIN, true);
    ({ slices, exempt, elapsed, violations } = {
      slices: main.slices,
      exempt: main.exempt,
      elapsed: main.ms,
      violations: main.violations,
    });
    rows = main.counts;
    openAlerts = main.openAlerts;
    fpA = (await seedInto(dbs[1], SMALL, false)).fp;
    fpB = (await seedInto(dbs[2], SMALL, false)).fp;
  }, 600_000);

  afterAll(async () => {
    await closeMain();
    process.env.DATABASE_URL = savedUrl;
    for (const db of dbs) await dropDb(db);
  }, 60_000);

  const fix = "Add it to a slice's covers or to EXEMPT (slices.ts) with a reason.";
  const coveredBy = (name: string) => slices.filter((s) => s.covers.some((c) => c.name === name));

  it('(a) every entity is in a slice covers or exempt', () => {
    const bad = entityNames.filter((n) => !coveredBy(n).length && !Object.hasOwn(exempt, n));
    expect(bad.map((n) => `${n} is in no slice's covers and not exempt. ${fix}`)).toEqual([]);
  });

  it('(b) no entity is covered by two slices', () => {
    const bad = entityNames.filter((n) => coveredBy(n).length > 1);
    expect(
      bad.map(
        (n) =>
          `${n} is covered by ${coveredBy(n)
            .map((s) => s.name)
            .join(' and ')}. Keep one.`,
      ),
    ).toEqual([]);
  });

  it('(c) a finished slice leaves no covered entity empty', () => {
    const bad = slices
      .filter((s) => !s.owedBy)
      .flatMap((s) => s.covers.filter((c) => rows[c.name] === 0).map((c) => ({ s, c })));
    expect(
      bad.map(
        ({ s, c }) =>
          `${c.name} has 0 rows but slice "${s.name}" has no owedBy. Seed it in slices/${s.name}.ts or set owedBy.`,
      ),
    ).toEqual([]);
  });

  it('(d) a slice that still has owedBy covers only empty entities', () => {
    const bad = slices
      .filter((s) => s.owedBy)
      .flatMap((s) => s.covers.filter((c) => rows[c.name] > 0).map((c) => ({ s, c })));
    expect(
      bad.map(
        ({ s, c }) =>
          `${c.name} already has rows but slice "${s.name}" still has owedBy "${s.owedBy}". Delete owedBy in slices/${s.name}.ts.`,
      ),
    ).toEqual([]);
  });

  it('(e) every exemption names a real, uncovered entity', () => {
    const bad = Object.keys(exempt).flatMap((n) => [
      ...(entityNames.includes(n) ? [] : [`EXEMPT has unknown entity ${n}. Remove it.`]),
      ...(coveredBy(n).length ? [`${n} is exempt but also in a covers. Remove one.`] : []),
    ]);
    const noReason = Object.entries(exempt)
      .filter(([, why]) => typeof why !== 'string' || !why.trim())
      .map(([n]) => `EXEMPT entry ${n} has no reason. Say why it is exempt.`);
    expect([...bad, ...noReason]).toEqual([]);
  });

  it('(f) the small run stays inside the 90 s budget', () => {
    expect(elapsed, 'seed run ms').toBeLessThan(BUDGET_MS);
  });

  it('same inputs give the same data', () => {
    expect(fpB).toEqual(fpA);
  });

  it('every demo login opens the app to at least 3 open alerts', () => {
    expect(
      Object.entries(openAlerts).filter(([, n]) => n < 3),
      'card key and its open alert count',
    ).toEqual([]);
  });

  it('every invariant holds on the seeded data', () => {
    expect(violations).toEqual([]);
  });
});

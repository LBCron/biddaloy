import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';

/**
 * [D17 guard 1, #2212] A table that belongs to one school (it has a
 * `tenant_id` column) may not carry a platform-wide unique key. Otherwise one
 * school blocks, or steals, another school's value.
 *
 * A unique key is tenant-safe when (a) its columns include `tenant_id`
 * (for an expression index, its key expression mentions `tenant_id`; a
 * `WHERE tenant_id IS NOT NULL` tail does not count), or (b) one
 * of its columns is a single-column FK to a table that itself has `tenant_id`
 * (e.g. `marks.exam_id`: an exam belongs to one school). A FK to `users` does
 * not count: `users` has no `tenant_id`. A composite FK that includes this
 * table's own `tenant_id` (`(tenant_id, parent_id) -> parent(tenant_id, id)`)
 * counts too: it pins the child to the parent's school.
 *
 * Limits:
 * - `users.email` / `users.phone` are global on purpose (one login per
 *   person, D12). `users` has no `tenant_id`, so this guard never sees it.
 * - A school table without its own `tenant_id` column is not checked.
 *   (`invoices` was one until #2214 gave it `tenant_id` and a
 *   `(tenant_id, invoice_number)` unique; the guard covers it now.)
 *
 * Runs against the already-migrated worker DB (no `synchronize`/`dropSchema`).
 */

/** Key = `table(col1,col2)`. Each entry has a reason and the ticket that removes it. */
const ALLOW_LIST: Record<string, { reason: string; removedBy: string }> = {
  'auth_tokens(token_hash)': {
    reason: 'global on purpose: random secret hash, looked up before the school is known',
    removedBy: 'permanent',
  },
  'attendance_devices(token_hash)': {
    reason: 'global on purpose: random secret hash, looked up before the school is known',
    removedBy: 'permanent',
  },
  'invoice_share_tokens(token_hash)': {
    reason: 'global on purpose: random secret hash, public link lookup',
    removedBy: 'permanent',
  },
  'print_job_items(verify_token_hash)': {
    reason: 'global on purpose: random secret hash, public QR verify lookup',
    removedBy: 'permanent',
  },
  'calendar_feed_tokens(token_hash)': {
    reason: 'global on purpose: random secret hash, ICS feed lookup',
    removedBy: 'permanent',
  },
  // resolve() looks the token up before it knows the school; a 256-bit token cannot collide
  'notices(public_token_hash)': {
    reason: 'global on purpose: random secret hash, public notice link lookup',
    removedBy: 'permanent',
  },
  'notice_recipients(link_token_hash)': {
    reason: 'global on purpose: random secret hash, personal notice link lookup',
    removedBy: 'permanent',
  },
};

/**
 * The key part of an index definition: the balanced `( ... )` right after
 * `USING <method>`. Drops `INCLUDE (...)` and `WHERE ...`, so a partial index
 * `UNIQUE (registration_number) WHERE tenant_id IS NOT NULL` does not count
 * `tenant_id` as a key column.
 */
function keyPart(indexdef: string): string {
  const start = indexdef.indexOf('(', indexdef.search(/\bUSING\s+\w+\s*\(/));
  let depth = 0;
  for (let i = start; i < indexdef.length; i++) {
    if (indexdef[i] === '(') depth++;
    else if (indexdef[i] === ')' && --depth === 0) return indexdef.slice(start + 1, i);
  }
  throw new Error(`cannot parse index definition: ${indexdef}`);
}

interface UniqueKey {
  table: string;
  index: string;
  columns: string[];
  tenantSafe: boolean;
  key: string;
}

const KEYS_SQL = `
  SELECT t.relname AS "table", i.relname AS "index",
         pg_get_indexdef(ix.indexrelid) AS indexdef,
         COALESCE((SELECT array_agg(a.attname::text ORDER BY k.ord)
                   FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                   WHERE k.attnum > 0 AND k.ord <= ix.indnkeyatts), '{}') AS columns,
         EXISTS (
           SELECT 1 FROM pg_constraint c
           WHERE c.conrelid = t.oid AND c.contype = 'f'
             AND c.conkey && ARRAY(SELECT k.attnum FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                                   WHERE k.ord <= ix.indnkeyatts)::int2[]
             AND (cardinality(c.conkey) = 1
                  OR EXISTS (SELECT 1 FROM pg_attribute tc WHERE tc.attrelid = t.oid
                             AND tc.attname = 'tenant_id' AND tc.attnum = ANY (c.conkey)))
             AND EXISTS (SELECT 1 FROM pg_attribute ta
                         WHERE ta.attrelid = c.confrelid AND ta.attname = 'tenant_id'
                           AND NOT ta.attisdropped)
         ) AS has_tenant_fk
  FROM pg_index ix
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public' AND ix.indisunique AND NOT ix.indisprimary
    AND EXISTS (SELECT 1 FROM pg_attribute ta
                WHERE ta.attrelid = t.oid AND ta.attname = 'tenant_id' AND NOT ta.attisdropped)
  ORDER BY t.relname, i.relname`;

describe('tenant unique keys (integration)', () => {
  let dataSource: DataSource;
  let keys: UniqueKey[];

  beforeAll(async () => {
    const module = await createTestModule([...ALL_ENTITIES], []);
    dataSource = module.get(DataSource);
    const rows: {
      table: string;
      index: string;
      indexdef: string;
      columns: string[];
      has_tenant_fk: boolean;
    }[] = await dataSource.query(KEYS_SQL);
    keys = rows.map((r) => {
      const part = keyPart(r.indexdef);
      // Expression index: the key text itself names it, so two expression
      // indexes on one table do not collapse to one allow-list key.
      const isExpression = part.includes('(');
      return {
        table: r.table,
        index: r.index,
        columns: r.columns,
        tenantSafe:
          r.columns.includes('tenant_id') || /\btenant_id\b/.test(part) || r.has_tenant_fk,
        key: `${r.table}(${isExpression ? part : r.columns.join(',')})`,
      };
    });
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('finds unique keys on tenant tables (not vacuous)', () => {
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((k) => k.tenantSafe)).toBe(true);
  });

  it('every unique key on a table with tenant_id is tenant-safe or allow-listed', async () => {
    // Cross-check: every unique constraint (contype 'u') on a tenant table is in `keys`.
    const constraints: { index: string }[] = await dataSource.query(
      `SELECT c.conname AS "index" FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND c.contype = 'u'
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = t.oid
                     AND a.attname = 'tenant_id' AND NOT a.attisdropped)`,
    );
    const seen = new Set(keys.map((k) => k.index));
    expect(constraints.filter((c) => !seen.has(c.index)).map((c) => c.index)).toEqual([]);

    const offenders = keys
      .filter((k) => !k.tenantSafe && !(k.key in ALLOW_LIST))
      .map(
        (k) =>
          `${k.table}(${k.columns.join(', ')}) index ${k.index}: add \`tenant_id\` to this ` +
          `unique key, or add \`${k.key}\` to the allow-list in ` +
          `\`server/test/tenant-unique-keys.integration.spec.ts\` with a reason`,
      );
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('has no stale allow-list entry', () => {
    const flagged = new Set(keys.filter((k) => !k.tenantSafe).map((k) => k.key));
    const stale = Object.keys(ALLOW_LIST)
      .filter((k) => !flagged.has(k))
      .map((k) => `delete \`${k}\` from the allow-list: it was fixed`);
    expect(stale, stale.join('\n')).toEqual([]);
  });
});

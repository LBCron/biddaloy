import type { EntityManager } from 'typeorm';
import { formatDateOnly, formatDateTime, fromCell } from '../../codec/cell-format';
import { optionalKeyOf } from '../../codec/tab-spec';
import type {
  ColumnSpec,
  ColumnType,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * [28.1.3] Shared shape for Epic 28.0's ten tables (ACR, incidents, surveys):
 * a tenant-scoped entity with required FKs to other tabs plus plain scalar
 * fields. Same contract as `teacher-assignments.tab.ts`, built from a field
 * list instead of hand-written ten times.
 *
 * An entity's own `keyOf` cannot reach a parent's natural key by itself, so
 * `load` asks each parent tab for its rows and stamps the parent's key text
 * onto every loaded entity (`student-notes.tab.ts` does the same for its
 * author); `keyOf` reads it back. Cost: one extra parent query per ref.
 */
export interface RefSpec {
  key: string; // column key, e.g. `user` (must differ from `fk`)
  fk: string; // entity FK property, e.g. `user_id`
  tab: TabSpec<any, any>; // the referenced tab
  label: { en: string; bn: string };
  /** A nullable FK: a blank cell means null, and an unresolvable parent exports blank. */
  optional?: boolean;
}

export interface FieldSpec {
  key: string; // column key AND entity property
  type: Exclude<ColumnType, 'uuid' | 'ref' | 'ref-list'>;
  required?: boolean;
  enumValues?: readonly string[];
  label: { en: string; bn: string };
}

export interface RefChildTabOptions<E> {
  name: string;
  entityClass: new () => E;
  refs: readonly RefSpec[];
  fields: readonly FieldSpec[];
  naturalKey: readonly string[];
  /** Entity columns deliberately left out of the workbook (say why in a comment at the call site). */
  excluded?: readonly string[];
  /** Default true. False for an append-only table: a restore must never delete its rows. */
  deleteByAbsence?: boolean;
  /** Drops rows from the export. Runs before refs are stamped, so a dropped row's parent is never needed. */
  filterRows?: (rows: E[], tenantId: string, m: EntityManager) => Promise<E[]>;
  /** Cross-field check on a parsed row; return `{ column, message }` to reject it. Fixed text, never the cell value. */
  checkRow?: (row: Record<string, unknown>) => { column: string; message: string } | null;
}

type Rec = Record<string, unknown>;
const STAMP = '__refKeys';

/** Normalises a scalar the way a cell round-trips it, so entity and row compare equal. */
function norm(type: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (type === 'date') return formatDateOnly(v);
  if (type === 'datetime') return formatDateTime(v);
  if (type === 'json') return JSON.stringify(v, (_k, x) => sortKeys(x));
  return String(v);
}

/** JSON.stringify replacer: emits object keys sorted, so jsonb's key order never shows as a diff. */
function sortKeys(x: unknown): unknown {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return x;
  return Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function createRefChildTab<E extends { id: string }>(
  opts: RefChildTabOptions<E>,
): TabSpec<E, Rec> {
  const {
    name,
    entityClass,
    refs,
    fields,
    naturalKey,
    deleteByAbsence = true,
    filterRows,
    checkRow,
    excluded = [],
  } = opts;
  const typeOf = new Map(fields.map((f) => [f.key, f.type as string]));

  const columns: readonly ColumnSpec[] = [
    { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
    ...refs.map((r) => ({
      key: r.key,
      type: 'ref' as const,
      ref: r.tab.name,
      required: !r.optional,
      label: r.label,
    })),
    ...fields.map((f) => ({ ...f })),
  ];

  return {
    name,
    entity: entityClass,
    excluded: [...refs.map((r) => r.fk), ...excluded], // exported instead as the matching ref column
    dependsOn: [...new Set(refs.map((r) => r.tab.name))],
    columns,
    naturalKey,
    deleteByAbsence,

    async load(tenantId: string, m: EntityManager): Promise<E[]> {
      let rows = await m.find(entityClass, { where: { tenant_id: tenantId } as never });
      if (filterRows) rows = await filterRows(rows, tenantId, m);
      for (const r of refs) {
        const parents: any[] = await r.tab.load(tenantId, m);
        const keyById = new Map(parents.map((p) => [p.id as string, r.tab.keyOf(p)]));
        for (const row of rows as unknown as Rec[]) {
          const stamp = (row[STAMP] ??= {}) as Rec;
          stamp[r.key] = keyById.get(row[r.fk] as string) ?? '';
        }
      }
      // An unresolvable ref is usually a SUPER_ADMIN-only author (created_by /
      // assessed_by / reported_by): `usersTab.load` leaves platform users out.
      // Skipping the row silently would lose data from the backup, so fail loudly.
      for (const row of rows as unknown as Rec[]) {
        for (const r of refs) {
          if (r.optional) continue;
          if ((row[STAMP] as Rec)[r.key] === '') {
            throw new Error(
              `Workbook export: tab "${name}" row ${String(row.id)} has a "${r.key}" (${r.fk}) that is not exportable (is it a platform SUPER_ADMIN user, or a missing parent?).`,
            );
          }
        }
      }
      return rows;
    },

    toRow(entity: E, ctx: ExportContext): Rec {
      const e = entity as unknown as Rec;
      const out: Rec = { id: e.id };
      for (const r of refs) {
        const id = e[r.fk] as string | null;
        out[r.key] = r.optional
          ? id
            ? optionalKeyOf(ctx, r.tab.name, id)
            : null
          : ctx.keyOf(r.tab.name, id as string);
      }
      for (const f of fields) out[f.key] = e[f.key];
      return out;
    },

    fromRow(
      cells: Record<string, string>,
      rowNo: number,
      ctx: ImportContext,
    ): { row: Rec } | { errors: RowError[] } {
      const errors: RowError[] = [];
      const values: Rec = {};
      for (const column of columns) {
        const result = fromCell(column, cells[column.key] ?? '', name, rowNo);
        if ('error' in result) errors.push(result.error);
        else values[column.key] = result.value;
      }
      if (errors.length > 0) return { errors };

      const out: Rec = { id: values.id };
      for (const r of refs) {
        const key = (values[r.key] as string | null) ?? '';
        if (r.optional && key === '') {
          out[r.fk] = null;
          out[`${r.key}_key`] = '';
          continue;
        }
        const id = ctx.ref(r.tab.name, key);
        if (!id) {
          errors.push({
            tab: name,
            row: rowNo,
            column: r.key,
            message: `Column "${r.key}": no ${r.tab.name} row with the key "${key}" was found.`,
            severity: 'error',
            value: key,
          });
        }
        out[r.fk] = id;
        out[`${r.key}_key`] = key;
      }
      if (errors.length > 0) return { errors };
      for (const f of fields) out[f.key] = values[f.key] ?? null;
      const bad = checkRow?.(out);
      if (bad) return { errors: [{ tab: name, row: rowNo, severity: 'error', ...bad }] };
      return { row: out };
    },

    keyOf(x: Rec | E): string {
      const isEntity = x instanceof entityClass;
      const rec = x as Rec;
      return naturalKey
        .map((k) => {
          const r = refs.find((ref) => ref.key === k);
          if (!r) return norm(typeOf.get(k) ?? 'string', rec[k]);
          return isEntity
            ? (((rec[STAMP] as Rec | undefined)?.[k] as string) ?? '')
            : (rec[`${k}_key`] as string);
        })
        .join('|');
    },

    diffFields(row: Rec, existing: E): string[] {
      const e = existing as unknown as Rec;
      return [
        ...refs.filter((r) => row[r.fk] !== e[r.fk]).map((r) => r.key),
        ...fields
          .filter((f) => norm(f.type, row[f.key]) !== norm(f.type, e[f.key]))
          .map((f) => f.key),
      ];
    },

    async upsert(row: Rec, existing: E | null, tenantId: string, m: EntityManager): Promise<E> {
      const e = (existing ?? new entityClass()) as unknown as Rec;
      e.tenant_id = tenantId;
      for (const r of refs) e[r.fk] = row[r.fk];
      for (const f of fields) {
        const v = row[f.key] ?? null;
        e[f.key] = f.type === 'datetime' && v !== null ? new Date(v as string) : v;
      }
      return (m.save as (target: unknown, entity: unknown) => Promise<E>)(entityClass, e);
    },

    async remove(entity: E, m: EntityManager): Promise<void> {
      await m.remove(entityClass, entity as never);
    },
  };
}

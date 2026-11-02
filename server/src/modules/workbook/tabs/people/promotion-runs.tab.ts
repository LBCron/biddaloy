import { FinalResult } from '../../../final-results/entities/final-result.entity';
import type { EntityManager } from 'typeorm';
import { PromotionRunStatus, PlacementAlgorithm } from '@biddaloy/shared';
import { PromotionRun } from '../../../promotions/entities/promotion-run.entity';
import { fromCell } from '../../codec/cell-format';
import { optionalKeyOf } from '../../codec/tab-spec';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `promotion_runs` tab: one end-of-year promotion attempt for a source
 * class — `PromotionRun` (788, D12/D16).
 *
 * `exam_ids` (a `uuid[]` on the entity) is exported via the codec's built-in
 * `ref-list` type — `';'`-joined natural keys of the referenced `exams` tab,
 * parsed back the same way on restore, same pattern as `calendar-events.tab
 * .ts`'s `classes` column. A plain comma-joined string was tried first, but
 * an exam name containing a comma (a realistic free-text value) would split
 * into fragments that never resolve back to a real exam.
 *
 * `target_class_id` is nullable (a `null` run graduates the source class out
 * of the school rather than promoting it forward) — exported as an optional
 * ref, an empty cell meaning `null`, same pattern as `enrollments.tab.ts`'s
 * `section`.
 */
export interface PromotionRunRow {
  id: string;
  source_class_id: string;
  source_academic_year_id: string;
  target_academic_year_id: string;
  target_class_id: string | null;
  exam_ids: string[];
  final_result_id: string | null;
  algorithm: PlacementAlgorithm;
  status: PromotionRunStatus;
  refreshed_at: string;
  committed_at: string | null;
  committed_by_user_id: string | null;
  approved_by_user_id: string | null;
  override_count: number;
  /** Null when the export could not name the creator (departed / SUPER_ADMIN). */
  created_by_user_id: string | null;
  // Referenced tabs' own natural-key text, kept beside the resolved ids so
  // `keyOf` builds the same string for a row as for an entity.
  source_class_key: string;
  source_academic_year_key: string;
  target_academic_year_key: string;
  target_class_key: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'source_class',
    type: 'ref',
    ref: 'classes',
    required: true,
    label: { en: 'Source class', bn: 'উৎস শ্রেণী' },
  },
  {
    key: 'source_academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Source academic year', bn: 'উৎস শিক্ষাবর্ষ' },
  },
  {
    key: 'target_academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Target academic year', bn: 'লক্ষ্য শিক্ষাবর্ষ' },
  },
  {
    // Optional: `null` graduates the source class out of the school (D13).
    key: 'target_class',
    type: 'ref',
    ref: 'classes',
    label: { en: 'Target class', bn: 'লক্ষ্য শ্রেণী' },
  },
  {
    key: 'exams',
    type: 'ref-list',
    ref: 'exams',
    // Empty for a run that takes a final result as its merit source (70.3.3).
    label: { en: 'Exams', bn: 'পরীক্ষা' },
  },
  {
    // Plain id, not a ref: the `final_results` tab ships with #3422. Until then a restore
    // needs the final to still exist in the school (checked in `upsert`).
    key: 'final_result_id',
    type: 'uuid',
    label: { en: 'Final result ID', bn: 'চূড়ান্ত ফলাফলের আইডি' },
  },
  {
    key: 'algorithm',
    type: 'enum',
    enumValues: Object.values(PlacementAlgorithm),
    required: true,
    label: { en: 'Algorithm', bn: 'অ্যালগরিদম' },
  },
  {
    key: 'status',
    type: 'enum',
    enumValues: Object.values(PromotionRunStatus),
    required: true,
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  {
    key: 'refreshed_at',
    type: 'datetime',
    required: true,
    label: { en: 'Refreshed at', bn: 'সতেজ করার সময়' },
  },
  {
    key: 'committed_at',
    type: 'datetime',
    label: { en: 'Committed at', bn: 'নিশ্চিতকরণের সময়' },
  },
  {
    key: 'committed_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Committed by', bn: 'নিশ্চিতকারী' },
  },
  {
    key: 'approved_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Approved by', bn: 'অনুমোদনকারী' },
  },
  {
    key: 'override_count',
    type: 'int',
    required: true,
    label: { en: 'Override count', bn: 'ওভাররাইড সংখ্যা' },
  },
  {
    key: 'created_by',
    type: 'ref',
    ref: 'users',
    // Not required: a departed / SUPER_ADMIN creator exports blank (see `upsert`).
    label: { en: 'Created by', bn: 'তৈরিকারী' },
  },
];

/**
 * `PromotionRun` columns deliberately left out of the workbook. The
 * completeness gate (`registry.completeness.spec.ts`) fails if a new
 * `PromotionRun` column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'source_class_id', // exported instead as the `source_class` ref column
  'source_academic_year_id', // exported instead as the `source_academic_year` ref column
  'target_academic_year_id', // exported instead as the `target_academic_year` ref column
  'target_class_id', // exported instead as the `target_class` ref column
  'exam_ids', // exported instead as the `exams` ref-list column
  'committed_by_user_id', // exported instead as the `committed_by` ref column (users)
  'approved_by_user_id', // exported instead as the `approved_by` ref column (users)
  'created_by_user_id', // exported instead as the `created_by` ref column (users)
];

export const promotionRunsTab: TabSpec<PromotionRun, PromotionRunRow> = {
  name: 'promotion_runs',
  entity: PromotionRun,
  excluded,
  dependsOn: ['classes', 'academic_years', 'exams', 'users'],
  columns,
  // The natural composite (source_class, target_academic_year) is only
  // DB-unique for status='COMMITTED' (a partial unique index) — two DRAFT
  // runs, or a DRAFT alongside a COMMITTED run, for the same class+target
  // year would collide on that key and corrupt restore. `id` is always
  // unique regardless of status, so `keyOf` below uses it directly.
  naturalKey: ['id'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<PromotionRun[]> {
    return m.find(PromotionRun, { where: { tenant_id: tenantId } });
  },

  toRow(entity: PromotionRun, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      source_class: ctx.keyOf('classes', entity.source_class_id),
      source_academic_year: ctx.keyOf('academic_years', entity.source_academic_year_id),
      target_academic_year: ctx.keyOf('academic_years', entity.target_academic_year_id),
      target_class: entity.target_class_id ? ctx.keyOf('classes', entity.target_class_id) : null,
      final_result_id: entity.final_result_id,
      exams: entity.exam_ids.map((examId) => ctx.keyOf('exams', examId)),
      algorithm: entity.algorithm,
      status: entity.status,
      refreshed_at: entity.refreshed_at,
      committed_at: entity.committed_at,
      // Nullable: a departed or SUPER_ADMIN user is not in the users tab -> null.
      committed_by: entity.committed_by_user_id
        ? optionalKeyOf(ctx, 'users', entity.committed_by_user_id)
        : null,
      approved_by: entity.approved_by_user_id
        ? optionalKeyOf(ctx, 'users', entity.approved_by_user_id)
        : null,
      override_count: entity.override_count,
      // Lenient too: a strict lookup would fail the whole export over one run.
      created_by: optionalKeyOf(ctx, 'users', entity.created_by_user_id),
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: PromotionRunRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'promotion_runs', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const sourceClassKey = values.source_class as string;
    const sourceClassId = sourceClassKey ? ctx.ref('classes', sourceClassKey) : undefined;
    if (sourceClassKey && !sourceClassId) {
      errors.push({
        tab: 'promotion_runs',
        row: rowNo,
        column: 'source_class',
        message: `Column "source_class": no class named "${sourceClassKey}" was found.`,
        severity: 'error',
        value: sourceClassKey,
      });
    }

    const sourceYearKey = values.source_academic_year as string;
    const sourceYearId = sourceYearKey ? ctx.ref('academic_years', sourceYearKey) : undefined;
    if (sourceYearKey && !sourceYearId) {
      errors.push({
        tab: 'promotion_runs',
        row: rowNo,
        column: 'source_academic_year',
        message: `Column "source_academic_year": no academic year named "${sourceYearKey}" was found.`,
        severity: 'error',
        value: sourceYearKey,
      });
    }

    const targetYearKey = values.target_academic_year as string;
    const targetYearId = targetYearKey ? ctx.ref('academic_years', targetYearKey) : undefined;
    if (targetYearKey && !targetYearId) {
      errors.push({
        tab: 'promotion_runs',
        row: rowNo,
        column: 'target_academic_year',
        message: `Column "target_academic_year": no academic year named "${targetYearKey}" was found.`,
        severity: 'error',
        value: targetYearKey,
      });
    }

    // `target_class` is the only optional ref: an empty cell means
    // `target_class_id: null` (this run graduates the class out, D13).
    const targetClassKey = (values.target_class as string | null) ?? '';
    let targetClassId: string | null = null;
    if (targetClassKey) {
      const resolved = ctx.ref('classes', targetClassKey);
      if (!resolved) {
        errors.push({
          tab: 'promotion_runs',
          row: rowNo,
          column: 'target_class',
          message: `Column "target_class": no class named "${targetClassKey}" was found.`,
          severity: 'error',
          value: targetClassKey,
        });
      } else {
        targetClassId = resolved;
      }
    }

    // `fromCell` already rejects a wholly-empty cell for this required
    // column (cell-format.ts's required-check runs before any split). A
    // cell of just ';' isn't empty by that check, but still splits to an
    // empty list — catch that case explicitly, since a promotion run with
    // no exams to decide on is meaningless.
    const examKeys = (values.exams as string[]) ?? [];
    const finalResultId = (values.final_result_id as string | null) ?? null;
    // Exactly one merit source: the exam list or a final result (70.3.3).
    if ((examKeys.length === 0) === (finalResultId === null)) {
      errors.push({
        tab: 'promotion_runs',
        row: rowNo,
        column: 'exams',
        message: 'Column "exams" or "final_result_id": give exactly one of them.',
        severity: 'error',
        value: '',
      });
    }
    const examIds: string[] = [];
    for (const examKey of examKeys) {
      const resolved = ctx.ref('exams', examKey);
      if (!resolved) {
        errors.push({
          tab: 'promotion_runs',
          row: rowNo,
          column: 'exams',
          message: `Column "exams": no exam "${examKey}" was found.`,
          severity: 'error',
          value: examKeys.join(';'),
        });
        continue;
      }
      examIds.push(resolved);
    }

    const userId = (column: string): string | null => {
      const key = (values[column] as string | null) ?? '';
      if (!key) return null;
      const resolved = ctx.ref('users', key);
      if (!resolved) {
        errors.push({
          tab: 'promotion_runs',
          row: rowNo,
          column,
          message: `Column "${column}": no user "${key}" was found.`,
          severity: 'error',
          value: key,
        });
      }
      return resolved ?? null;
    };
    const committedById = userId('committed_by');
    const approvedById = userId('approved_by');
    const createdById = userId('created_by');

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        source_class_id: sourceClassId as string,
        source_academic_year_id: sourceYearId as string,
        target_academic_year_id: targetYearId as string,
        target_class_id: targetClassId,
        exam_ids: examIds,
        final_result_id: finalResultId,
        algorithm: values.algorithm as PlacementAlgorithm,
        status: values.status as PromotionRunStatus,
        refreshed_at: values.refreshed_at as string,
        committed_at: (values.committed_at as string | null) ?? null,
        committed_by_user_id: committedById,
        approved_by_user_id: approvedById,
        override_count: values.override_count as number,
        created_by_user_id: createdById,
        source_class_key: sourceClassKey,
        source_academic_year_key: sourceYearKey,
        target_academic_year_key: targetYearKey,
        target_class_key: targetClassKey ? targetClassKey : null,
      },
    };
  },

  keyOf(x: PromotionRunRow | PromotionRun): string {
    return x.id;
  },

  diffFields(row: PromotionRunRow, existing: PromotionRun): string[] {
    const changed: string[] = [];
    if (row.source_class_id !== existing.source_class_id) changed.push('source_class');
    if (row.source_academic_year_id !== existing.source_academic_year_id) {
      changed.push('source_academic_year');
    }
    if (row.target_academic_year_id !== existing.target_academic_year_id) {
      changed.push('target_academic_year');
    }
    if ((row.target_class_id ?? null) !== (existing.target_class_id ?? null)) {
      changed.push('target_class');
    }
    const rowExamIds = [...row.exam_ids].sort().join(',');
    const existingExamIds = [...(existing.exam_ids ?? [])].sort().join(',');
    if (rowExamIds !== existingExamIds) changed.push('exams');
    if ((row.final_result_id ?? null) !== (existing.final_result_id ?? null)) {
      changed.push('final_result_id');
    }
    if (row.algorithm !== existing.algorithm) changed.push('algorithm');
    if (row.status !== existing.status) changed.push('status');
    if (new Date(existing.refreshed_at).toISOString() !== row.refreshed_at) {
      changed.push('refreshed_at');
    }
    const rowCommittedAt = row.committed_at;
    const existingCommittedAt = existing.committed_at ? existing.committed_at.toISOString() : null;
    if (rowCommittedAt !== existingCommittedAt) changed.push('committed_at');
    // null = the export could not name the user (departed / SUPER_ADMIN): keep existing.
    if (
      row.committed_by_user_id !== null &&
      row.committed_by_user_id !== existing.committed_by_user_id
    ) {
      changed.push('committed_by');
    }
    if (
      row.approved_by_user_id !== null &&
      row.approved_by_user_id !== existing.approved_by_user_id
    ) {
      changed.push('approved_by');
    }
    if (row.override_count !== existing.override_count) changed.push('override_count');
    if (row.created_by_user_id !== null && row.created_by_user_id !== existing.created_by_user_id) {
      changed.push('created_by');
    }
    return changed;
  },

  async upsert(
    row: PromotionRunRow,
    existing: PromotionRun | null,
    tenantId: string,
    m: EntityManager,
    actorUserId?: string | null,
  ): Promise<PromotionRun> {
    const run = existing ?? new PromotionRun();
    // `keyOf` is `id` (see its docstring) — a fresh insert on restore must
    // reuse the workbook's own id, because `promotion_entries` exports its
    // `run` column as this raw uuid; keeping the id stable across restore
    // is what lets that export round-trip back to the same row.
    if (!existing) {
      // `existing` comes from a tenant-scoped `load()`, so a row already
      // owned by ANOTHER tenant also resolves `existing === null` here.
      // Guard against that before reusing `row.id`, or `m.save()` below
      // would UPDATE the other tenant's row (TypeORM saves an entity with
      // a set primary key by upsert-on-PK, no tenant filter) — same
      // cross-tenant takeover hazard as `students.tab.ts`.
      const holder = await m.findOne(PromotionRun, {
        where: { id: row.id },
        withDeleted: true,
      });
      if (holder && holder.tenant_id !== tenantId) {
        throw new Error(
          `Promotion run "${row.id}" already exists in tenant "${holder.tenant_id}" ` +
            `and cannot be restored into tenant "${tenantId}".`,
        );
      }
      run.id = row.id;
    }

    run.tenant_id = tenantId;
    run.source_class_id = row.source_class_id;
    run.source_academic_year_id = row.source_academic_year_id;
    run.target_academic_year_id = row.target_academic_year_id;
    run.target_class_id = row.target_class_id;
    run.exam_ids = row.exam_ids;
    if (row.final_result_id) {
      // Tenant-scoped: a foreign tenant's final id must not be adopted (FK alone would accept it).
      const final = await m.findOne(FinalResult, {
        where: { id: row.final_result_id, tenant_id: tenantId },
      });
      if (!final) {
        throw new Error(
          `Promotion run "${row.id}": its final result does not exist in this school.`,
        );
      }
    }
    run.final_result_id = row.final_result_id;
    run.algorithm = row.algorithm;
    run.status = row.status;
    run.refreshed_at = new Date(row.refreshed_at);
    run.committed_at = row.committed_at ? new Date(row.committed_at) : null;
    run.committed_by_user_id = row.committed_by_user_id ?? existing?.committed_by_user_id ?? null;
    run.approved_by_user_id = row.approved_by_user_id ?? existing?.approved_by_user_id ?? null;
    run.override_count = row.override_count;
    // NOT NULL column: a new run whose creator the export could not name is
    // attributed to the admin running the restore.
    const createdBy = row.created_by_user_id ?? existing?.created_by_user_id ?? actorUserId;
    if (!createdBy) {
      throw new Error(`Promotion run "${row.id}" has no "created_by" and no restoring user.`);
    }
    run.created_by_user_id = createdBy;

    return m.save(PromotionRun, run);
  },

  async remove(entity: PromotionRun, m: EntityManager): Promise<void> {
    // Hard delete: the entity has no `deleted_at` — drafts (and, on
    // restore, any run absent from the workbook) are discarded outright
    // (D24), matching `enrollments.tab.ts`'s reasoning for its own
    // hard-deleted entity.
    await m.remove(PromotionRun, entity);
  },
};

import type { EntityManager } from 'typeorm';
import { Exam } from '../../../exams/entities/exam.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { classesTab } from '../academics/classes.tab';

/**
 * The `exams` tab: one exam sitting for one class in one academic year
 * (19.2.1's `Exam` entity), following `classes.tab.ts`'s column-spec style.
 *
 * `academic_term` is excluded (see `excluded` below) — `AcademicTerm` has no
 * workbook tab yet (tracked in #856), so there is no tab to resolve a ref
 * against; a restore simply leaves `academic_term_id` null, same as any
 * other optional relation with no tab.
 */

export interface ExamRow {
  id: string;
  name: string;
  academic_year_id: string;
  academic_year_key: string;
  class_id: string;
  class_key: string;
  kind: string;
  status: string;
  published_at: string | null;
  mark_entry_deadline: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
  {
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
  {
    key: 'class',
    type: 'ref',
    ref: 'classes',
    required: true,
    label: { en: 'Class', bn: 'শ্রেণী' },
  },
  {
    key: 'kind',
    type: 'enum',
    enumValues: ['TERM', 'MONTHLY', 'MODEL', 'OTHER'],
    required: true,
    label: { en: 'Kind', bn: 'ধরন' },
  },
  {
    key: 'status',
    type: 'enum',
    enumValues: ['DRAFT', 'PROCESSED', 'PUBLISHED'],
    required: true,
    label: { en: 'Status', bn: 'অবস্থা' },
  },
  { key: 'published_at', type: 'datetime', label: { en: 'Published at', bn: 'প্রকাশের সময়' } },
  {
    key: 'mark_entry_deadline',
    type: 'date',
    label: { en: 'Mark entry deadline', bn: 'মার্ক এন্ট্রির শেষ দিন' },
  },
];

const excluded: readonly string[] = [
  'academic_year_id', // exported instead as the `academic_year` ref column
  'class_id', // exported instead as the `class` ref column
  // No workbook tab for academic terms yet (tracked in #856) — a restore
  // leaves this optional relation null, same as any other ref with no tab.
  'academic_term_id',
  // [40.1.03] Epic 40 website columns; #3621 (40.1.08) turns them into tab columns.
  'website_published_at',
  'website_show_names',
];

const MAX_LENGTHS: Record<string, number> = {
  name: 200,
};

export const examsTab: TabSpec<Exam, ExamRow> = {
  name: 'exams',
  entity: Exam,
  excluded,
  dependsOn: ['academic_years', 'classes'],
  columns,
  naturalKey: ['name', 'academic_year', 'class'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Exam[]> {
    // `class.academic_year` is loaded too: `keyOf` delegates to
    // `classesTab.keyOf(x.class)`, which reads the class's own
    // `academic_year.name` — without it that segment silently comes back
    // empty, and the key this tab's own entities hash to (used to build
    // the cross-tab ref index other tabs' `exam` columns resolve against)
    // would then disagree with the `class` cell `toRow` writes via
    // `ctx.keyOf('classes', ...)`, which resolves correctly against the
    // separately-loaded `classes` tab.
    return m.find(Exam, {
      where: { tenant_id: tenantId },
      relations: ['academic_year', 'class', 'class.academic_year'],
    });
  },

  toRow(entity: Exam, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      academic_year: ctx.keyOf('academic_years', entity.academic_year_id),
      class: ctx.keyOf('classes', entity.class_id),
      kind: entity.kind,
      status: entity.status,
      published_at: entity.published_at,
      mark_entry_deadline: entity.mark_entry_deadline,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ExamRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'exams', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'exams',
          row: rowNo,
          column: column.key,
          message: `Column "${column.key}": is longer than the ${limit} characters allowed.`,
          severity: 'error',
          value: raw,
        });
        continue;
      }

      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    let academicYearId: string | undefined;
    const academicYearKey = values.academic_year as string;
    if (academicYearKey) {
      academicYearId = ctx.ref('academic_years', academicYearKey);
      if (!academicYearId) {
        errors.push({
          tab: 'exams',
          row: rowNo,
          column: 'academic_year',
          message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
          severity: 'error',
          value: academicYearKey,
        });
      }
    }

    let classId: string | undefined;
    const classKey = values.class as string;
    if (classKey) {
      classId = ctx.ref('classes', classKey);
      if (!classId) {
        errors.push({
          tab: 'exams',
          row: rowNo,
          column: 'class',
          message: `Column "class": no class named "${classKey}" was found.`,
          severity: 'error',
          value: classKey,
        });
      }
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        academic_year_id: academicYearId as string,
        academic_year_key: academicYearKey,
        class_id: classId as string,
        class_key: classKey,
        kind: values.kind as string,
        status: values.status as string,
        published_at: (values.published_at as string | null) ?? null,
        mark_entry_deadline: (values.mark_entry_deadline as string | null) ?? null,
      },
    };
  },

  keyOf(x: ExamRow | Exam): string {
    const yearKey = x instanceof Exam ? (x.academic_year?.name ?? '') : x.academic_year_key;
    const classKey = x instanceof Exam ? (x.class ? classesTab.keyOf(x.class) : '') : x.class_key;
    return `${x.name}|${yearKey}|${classKey}`;
  },

  diffFields(row: ExamRow, existing: Exam): string[] {
    const changed: string[] = [];
    if (row.name !== existing.name) changed.push('name');
    if (row.academic_year_id !== existing.academic_year_id) changed.push('academic_year');
    if (row.class_id !== existing.class_id) changed.push('class');
    if (row.kind !== existing.kind) changed.push('kind');
    if (row.status !== existing.status) changed.push('status');
    const rowPublished = row.published_at ?? null;
    const existingPublished = existing.published_at ? existing.published_at.toISOString() : null;
    if (rowPublished !== existingPublished) changed.push('published_at');
    if ((row.mark_entry_deadline ?? null) !== (existing.mark_entry_deadline ?? null))
      changed.push('mark_entry_deadline');
    return changed;
  },

  async upsert(
    row: ExamRow,
    existing: Exam | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Exam> {
    const exam = existing ?? new Exam();
    exam.tenant_id = tenantId;
    exam.name = row.name;
    exam.academic_year_id = row.academic_year_id;
    exam.class_id = row.class_id;
    exam.kind = row.kind as Exam['kind'];
    exam.status = row.status as Exam['status'];
    exam.published_at = row.published_at ? new Date(row.published_at) : null;
    exam.mark_entry_deadline = row.mark_entry_deadline ?? null;

    return m.save(Exam, exam);
  },

  async remove(entity: Exam, m: EntityManager): Promise<void> {
    await m.softRemove(Exam, entity);
  },
};

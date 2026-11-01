import type { EntityManager } from 'typeorm';
import { CoordinatorAssignment } from '../../../academics/entities/coordinator-assignment.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { optionalKeyOf } from '../../codec/tab-spec';
import { teachersTab } from './teachers.tab';
import { classesTab, subjectsTab } from '../academics';
import { nullableActor, stampActorKeys } from '../actor-keys';

/**
 * [83.2.3] The `coordinator_assignments` tab: which teacher coordinates which class, optionally
 * for one subject (Epic 83 D2). Keyed like `teacher-assignments.tab.ts`, but by class, not
 * section (D3): natural key `(teacher, class, subject)`, the same triple the DB makes unique
 * (`UQ_coordinator_assignment`, NULLS NOT DISTINCT — a blank subject is one more value).
 *
 * `assigned_by` is an optional actor (D30): an assigner who has left the school exports as a
 * blank cell and is kept on restore (`actor-keys.ts`, #2687). `created_at` is not a column: the
 * DB stamps it on insert and a restore never rewrites it.
 */
export interface CoordinatorAssignmentRow {
  id: string;
  teacher_id: string;
  class_id: string;
  subject_id: string | null;
  assigned_by_user_id: string | null;
  teacher_key: string;
  class_key: string;
  subject_key: string;
}

const TAB = 'coordinator_assignments';

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'teacher',
    type: 'ref',
    ref: 'teachers',
    required: true,
    label: { en: 'Teacher', bn: 'শিক্ষক' },
  },
  {
    key: 'class',
    type: 'ref',
    ref: 'classes',
    required: true,
    label: { en: 'Class', bn: 'শ্রেণি' },
  },
  {
    // Blank = class coordinator (every subject); set = subject coordinator.
    key: 'subject',
    type: 'ref',
    ref: 'subjects',
    label: { en: 'Subject', bn: 'বিষয়' },
  },
  {
    key: 'assigned_by',
    type: 'ref',
    ref: 'users',
    label: { en: 'Assigned by', bn: 'যিনি দিয়েছেন' },
  },
];

const excluded: readonly string[] = [
  'teacher_id', // exported instead as the `teacher` ref column
  'class_id', // exported instead as the `class` ref column
  'subject_id', // exported instead as the optional `subject` ref column
  'assigned_by_user_id', // exported instead as the optional `assigned_by` ref column
  'created_at', // stamped by the DB on insert; a restore keeps the stored value
];

type Loaded = CoordinatorAssignment & { assigned_by_key?: string };

export const coordinatorAssignmentsTab: TabSpec<CoordinatorAssignment, CoordinatorAssignmentRow> = {
  name: TAB,
  entity: CoordinatorAssignment,
  excluded,
  dependsOn: ['teachers', 'classes', 'subjects', 'users'],
  columns,
  naturalKey: ['teacher', 'class', 'subject'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<CoordinatorAssignment[]> {
    // `keyOf` needs the teacher, the class with its year (the class key embeds the year name)
    // and the subject.
    const all = await m.find(CoordinatorAssignment, {
      where: { tenant_id: tenantId },
      relations: ['teacher', 'teacher.user', 'class', 'class.academic_year', 'subject'],
    });
    // A soft-deleted teacher, class or subject is absent from its own tab, so its rows could
    // not be keyed; they are not live coordinators either (the scope SQL skips them).
    const rows = all.filter((r) => r.teacher && r.class && (!r.subject_id || r.subject));
    return stampActorKeys(tenantId, rows, 'assigned_by_user_id', 'assigned_by_key', m);
  },

  toRow(entity: CoordinatorAssignment, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      teacher: ctx.keyOf('teachers', entity.teacher_id),
      class: ctx.keyOf('classes', entity.class_id),
      subject: entity.subject_id ? ctx.keyOf('subjects', entity.subject_id) : null,
      assigned_by: entity.assigned_by_user_id
        ? optionalKeyOf(ctx, 'users', entity.assigned_by_user_id)
        : null,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: CoordinatorAssignmentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};
    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', TAB, rowNo);
      if ('error' in result) errors.push(result.error);
      else values[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    // One fixed sentence per column; the key text goes in `value`, never the message.
    const fail = (column: string, message: string, value: string) =>
      errors.push({ tab: TAB, row: rowNo, column, message, severity: 'error', value });

    const teacherKey = values.teacher as string;
    const teacherId = ctx.ref('teachers', teacherKey);
    if (!teacherId) fail('teacher', 'Column "teacher": no such teacher was found.', teacherKey);

    const classKey = values.class as string;
    const classId = ctx.ref('classes', classKey);
    if (!classId) fail('class', 'Column "class": no such class was found.', classKey);

    const subjectKey = (values.subject as string | null) ?? '';
    let subjectId: string | null = null;
    if (subjectKey) {
      subjectId = ctx.ref('subjects', subjectKey) ?? null;
      if (!subjectId) fail('subject', 'Column "subject": no such subject was found.', subjectKey);
    }

    const userKey = (values.assigned_by as string | null) ?? '';
    let userId: string | null = null;
    if (userKey) {
      userId = ctx.ref('users', userKey) ?? null;
      if (!userId) fail('assigned_by', 'Column "assigned_by": no such user was found.', userKey);
    }

    if (errors.length > 0) return { errors };
    return {
      row: {
        id: values.id as string,
        teacher_id: teacherId as string,
        class_id: classId as string,
        subject_id: subjectId,
        assigned_by_user_id: userId,
        teacher_key: teacherKey,
        class_key: classKey,
        subject_key: subjectKey,
      },
    };
  },

  keyOf(x: CoordinatorAssignmentRow | CoordinatorAssignment): string {
    if (x instanceof CoordinatorAssignment) {
      const teacherKey = x.teacher ? teachersTab.keyOf(x.teacher) : '';
      const classKey = x.class ? classesTab.keyOf(x.class) : '';
      const subjectKey = x.subject ? subjectsTab.keyOf(x.subject) : '';
      return `${teacherKey}|${classKey}|${subjectKey}`;
    }
    return `${x.teacher_key}|${x.class_key}|${x.subject_key}`;
  },

  diffFields(row: CoordinatorAssignmentRow, existing: CoordinatorAssignment): string[] {
    // teacher / class / subject are the natural key, so only the assigner can differ.
    const stored = existing.assigned_by_user_id ?? null;
    const next = nullableActor(
      row.assigned_by_user_id,
      existing as Loaded,
      'assigned_by_user_id',
      'assigned_by_key',
    );
    return next !== stored ? ['assigned_by'] : [];
  },

  async upsert(
    row: CoordinatorAssignmentRow,
    existing: CoordinatorAssignment | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<CoordinatorAssignment> {
    const assignment = existing ?? new CoordinatorAssignment();
    // Loaded relations would win over the plain `*_id` columns on save (see
    // teacher-assignments.tab.ts); drop them so the ids below are what is written.
    Object.assign(assignment, {
      teacher: undefined,
      class: undefined,
      subject: undefined,
      assigned_by: undefined,
    });
    assignment.tenant_id = tenantId;
    assignment.teacher_id = row.teacher_id;
    assignment.class_id = row.class_id;
    assignment.subject_id = row.subject_id;
    assignment.assigned_by_user_id = nullableActor(
      row.assigned_by_user_id,
      existing as Loaded | null,
      'assigned_by_user_id',
      'assigned_by_key',
    );
    return m.save(CoordinatorAssignment, assignment);
  },

  async remove(entity: CoordinatorAssignment, m: EntityManager): Promise<void> {
    // Hard delete: an assignment is not a record (D15) and has no `deleted_at`.
    await m.remove(CoordinatorAssignment, entity);
  },
};

import { FieldSensitivity, ReportFieldType, ReportSubjectArea } from '@biddaloy/shared';
import { AggregateFn } from '@biddaloy/shared';
import type { FieldDef, MeasureDef, SubjectAreaDef } from '../registry/registry.types';

/**
 * Fixture areas for the compiler specs. They are NOT the production areas (those are
 * filled in [8.15.20] / [8.15.21]); they exercise every shape the compiler must handle:
 * left joins, a chain of joins, and a root with no `tenant_id` of its own.
 */
const field = (
  key: string,
  type: ReportFieldType,
  sql: string,
  entity: string,
  extra: Partial<FieldDef> = {},
): FieldDef => ({
  key,
  labelEn: key,
  labelBn: key,
  type,
  sql,
  entity,
  filterable: true,
  groupable: true,
  sortable: true,
  sensitivity: FieldSensitivity.PUBLIC,
  ...extra,
});

const measure = (
  key: string,
  fn: AggregateFn,
  sql: string,
  entity: string,
  type: ReportFieldType = ReportFieldType.NUMBER,
  sensitivity: FieldSensitivity = FieldSensitivity.PUBLIC,
): MeasureDef => ({ key, labelEn: key, labelBn: key, fn, sql, type, entity, sensitivity });

const section = {
  alias: 'cs',
  table: 'class_sections',
  tenantColumn: 'tenant_id',
  softDeleteColumn: 'deleted_at',
} as const;
const klass = {
  alias: 'c',
  table: 'classes',
  tenantColumn: 'tenant_id',
  softDeleteColumn: 'deleted_at',
} as const;
const guardian = { alias: 'g', table: 'guardians', tenantColumn: 'tenant_id' } as const;
const students = {
  alias: 's',
  table: 'students',
  tenantColumn: 'tenant_id',
  softDeleteColumn: 'deleted_at',
} as const;

export const TEST_STUDENTS_AREA: SubjectAreaDef = {
  key: ReportSubjectArea.STUDENTS,
  root: students,
  scope: { sectionSql: 's.class_section_id', alias: 's' },
  joins: [
    { from: 's', to: section, on: 's.class_section_id = cs.id', kind: 'left' },
    { from: 'cs', to: klass, on: 'cs.class_id = c.id', kind: 'left' },
    { from: 's', to: guardian, on: 'g.id = s.primary_guardian_id', kind: 'left' },
  ],
  fields: [
    field('name', ReportFieldType.TEXT, 's.full_name', 's', {
      sensitivity: FieldSensitivity.PERSONAL,
    }),
    field('gender', ReportFieldType.ENUM, 's.gender', 's', { enumValues: ['MALE', 'FEMALE'] }),
    field('birth_date', ReportFieldType.DATE, 's.date_of_birth', 's'),
    field('active', ReportFieldType.BOOLEAN, 's.is_active', 's'),
    field('section', ReportFieldType.TEXT, 'cs.section_name', 'cs'),
    field('class', ReportFieldType.TEXT, 'c.name', 'c'),
    field('guardian_phone', ReportFieldType.TEXT, 'g.phone', 'g', {
      sensitivity: FieldSensitivity.CONTACT,
      groupable: false,
      sortable: false,
    }),
    field('roll', ReportFieldType.NUMBER, 's.roll_number', 's'),
    field('secret', ReportFieldType.TEXT, 's.secret', 's', {
      filterable: false,
      sensitivity: FieldSensitivity.SENSITIVE,
    }),
  ],
  measures: [
    measure('students', AggregateFn.COUNT, '*', 's'),
    measure('classes', AggregateFn.COUNT_DISTINCT, 'c.id', 'c'),
    measure('total_roll', AggregateFn.SUM, 's.roll_number', 's'),
  ],
};

/** A root with no `tenant_id`, scoped through its inner-joined student (like `student_fees`). */
export const TEST_FEES_AREA: SubjectAreaDef = {
  key: ReportSubjectArea.FEES,
  root: {
    alias: 'sf',
    table: 'student_fees',
    tenantColumn: null,
    tenantVia: 's',
    softDeleteColumn: 'deleted_at',
  },
  joins: [{ from: 'sf', to: students, on: 'sf.student_id = s.id', kind: 'inner' }],
  fields: [
    field('student', ReportFieldType.TEXT, 's.full_name', 's'),
    field('status', ReportFieldType.ENUM, 'sf.status', 'sf', {
      enumValues: ['PENDING', 'PAID'],
    }),
    field('due_date', ReportFieldType.DATE, 'sf.due_date', 'sf'),
    field('amount', ReportFieldType.MONEY, 'sf.total_amount', 'sf', {
      sensitivity: FieldSensitivity.FINANCIAL,
    }),
  ],
  measures: [
    measure(
      'billed',
      AggregateFn.SUM,
      'sf.total_amount',
      'sf',
      ReportFieldType.MONEY,
      FieldSensitivity.FINANCIAL,
    ),
    measure('bills', AggregateFn.COUNT, '*', 'sf'),
  ],
};

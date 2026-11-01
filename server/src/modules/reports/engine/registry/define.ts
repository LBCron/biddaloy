import { FieldSensitivity, type AggregateFn, type ReportFieldType } from '@biddaloy/shared';
import type { EntityDef, FieldDef, MeasureDef } from './registry.types';

/**
 * Short constructors for area files. A field is filterable, groupable and sortable unless it says
 * otherwise; sensitivity defaults to PUBLIC, so every sensitive field has to be marked on purpose.
 */
export function field(
  key: string,
  type: ReportFieldType,
  sql: string,
  entity: string,
  labels: { en: string; bn: string },
  extra: Partial<FieldDef> = {},
): FieldDef {
  return {
    key,
    labelEn: labels.en,
    labelBn: labels.bn,
    type,
    sql,
    entity,
    filterable: true,
    groupable: true,
    sortable: true,
    sensitivity: FieldSensitivity.PUBLIC,
    ...extra,
  };
}

export function measure(
  key: string,
  fn: AggregateFn,
  sql: string,
  entity: string,
  type: ReportFieldType,
  labels: { en: string; bn: string },
  sensitivity: FieldSensitivity = FieldSensitivity.PUBLIC,
): MeasureDef {
  return { key, labelEn: labels.en, labelBn: labels.bn, fn, sql, type, entity, sensitivity };
}

/** The tables the areas share, so one table has one alias and one soft-delete rule everywhere. */
export const students: EntityDef = {
  alias: 's',
  table: 'students',
  tenantColumn: 'tenant_id',
  softDeleteColumn: 'deleted_at',
};
export const sections: EntityDef = {
  alias: 'cs',
  table: 'class_sections',
  tenantColumn: 'tenant_id',
  softDeleteColumn: 'deleted_at',
};
export const classes: EntityDef = {
  alias: 'c',
  table: 'classes',
  tenantColumn: 'tenant_id',
  softDeleteColumn: 'deleted_at',
};
export const guardians: EntityDef = {
  alias: 'g',
  table: 'guardians',
  tenantColumn: 'tenant_id',
  softDeleteColumn: 'deleted_at',
};

/** The school's own calendar day, so "today" and a payment's date follow Asia/Dhaka, not the server. */
export const SCHOOL_TODAY_SQL = "(NOW() AT TIME ZONE 'Asia/Dhaka')::date";

/** A student's main guardian: the primary contact, else the earliest added. At most one row per student. */
export const PRIMARY_GUARDIAN_ON = `g.id = (
  SELECT g2.id FROM student_guardians sg2
  JOIN guardians g2 ON g2.id = sg2.guardian_id AND g2.tenant_id = s.tenant_id AND g2.deleted_at IS NULL
  WHERE sg2.student_id = s.id
  ORDER BY g2.is_primary_contact DESC, g2.created_at, g2.id
  LIMIT 1)`;

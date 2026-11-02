import type {
  AggregateFn,
  FieldSensitivity,
  ReportFieldType,
  ReportSubjectArea,
} from '@biddaloy/shared';

/**
 * [8.15.14] The semantic layer (Epic 8.15 D2, D19). It lives only on the server
 * because it holds SQL fragments; `GET /reports/meta` sends clients labels and
 * types, never `sql`, `on` or table names.
 *
 * Every `sql` / `on` string uses table ALIASES only (`s.full_name`, `sf.student_id = s.id`),
 * never a value. Values always reach the database as bound parameters.
 */

/** One table the compiler may select from. */
export interface EntityDef {
  /** Short alias used in every `sql` / `on` string of the area. */
  alias: string;
  table: string;
  /**
   * The column holding the school id, or `null` for a table that has none. A table without one
   * MUST name `tenantVia`: a root (`student_fees`) is scoped through an always-joined table that
   * has `tenant_id`; a joined lookup (`users`) is reached only from a scoped row, so `tenantVia`
   * is the alias it joins from.
   */
  tenantColumn: 'tenant_id' | null;
  /**
   * For `tenantColumn: null`: the alias of an always-joined entity that does have
   * `tenant_id`. The compiler joins it (inner) and filters on it, so this table's
   * rows are still school-scoped.
   */
  tenantVia?: string;
  /** Set when rows are soft-deleted; the compiler adds `alias.<col> IS NULL`. */
  softDeleteColumn?: 'deleted_at';
}

/** `from` is an alias already in the query; `to` is the table being added. */
export interface JoinDef {
  from: string;
  to: EntityDef;
  /** Aliases only, e.g. `sf.student_id = s.id`. */
  on: string;
  kind: 'inner' | 'left';
}

export interface FieldDef {
  key: string;
  labelEn: string;
  labelBn: string;
  type: ReportFieldType;
  /** A column or expression over aliases, e.g. `s.full_name`. */
  sql: string;
  /** Alias of the entity this field reads from (the root or a joined one). */
  entity: string;
  filterable: boolean;
  groupable: boolean;
  sortable: boolean;
  sensitivity: FieldSensitivity;
  /** ENUM fields: the allowed values, so a filter can be checked. */
  enumValues?: readonly string[];
  /** A calculated field ([8.15.36]); its `sql` was compiled from an expression. */
  calculated?: boolean;
  /** Every entity alias the SQL reads, when more than `entity` (calculated fields only). */
  entities?: readonly string[];
}

export interface MeasureDef {
  key: string;
  labelEn: string;
  labelBn: string;
  fn: AggregateFn;
  /** The expression aggregated, e.g. `sf.total_amount`; `*` for a plain row count. */
  sql: string;
  type: ReportFieldType;
  entity: string;
  /** What the number reveals; a money total is FINANCIAL, a head count PUBLIC. */
  sensitivity: FieldSensitivity;
  /** Every entity alias the SQL reads, when more than `entity` (a measure over a calculated field). */
  entities?: readonly string[];
}

/** How a TEACHER's view of an area is narrowed to the sections they teach (D5). */
export interface AreaScopeDef {
  /** The row's class-section id, e.g. `e.section_id`. */
  sectionSql: string;
  /** Alias of the entity that expression reads, so the compiler joins it. */
  alias: string;
}

export interface SubjectAreaDef {
  key: ReportSubjectArea;
  root: EntityDef;
  joins: readonly JoinDef[];
  fields: readonly FieldDef[];
  measures: readonly MeasureDef[];
  /** Absent when rows have no section (staff): a TEACHER cannot run reports on such an area. */
  scope?: AreaScopeDef;
  /**
   * Predicates (aliases only) that are always part of the area, because they define what one row
   * of it IS: e.g. payments counts a payment only when it succeeded or is part of a reversal,
   * exactly as the collections report does. A definition filter can narrow further, never widen.
   */
  baseWhere?: readonly string[];
}

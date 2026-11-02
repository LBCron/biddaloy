/**
 * Epic 8.15 reporting-engine enums. Const-object + type pattern (not TS `enum`),
 * matching `print.ts`. Stored as varchar so a later epic can add a value without
 * a migration.
 */

export const ReportLayoutType = {
  TABLE: 'TABLE',
  GROUPED: 'GROUPED',
  CROSSTAB: 'CROSSTAB',
  CHART: 'CHART',
} as const;
export type ReportLayoutType = (typeof ReportLayoutType)[keyof typeof ReportLayoutType];

export const ReportFieldType = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  MONEY: 'MONEY',
  PERCENT: 'PERCENT',
  DATE: 'DATE',
  ENUM: 'ENUM',
  BOOLEAN: 'BOOLEAN',
} as const;
export type ReportFieldType = (typeof ReportFieldType)[keyof typeof ReportFieldType];

/** What a field exposes; each level maps to a required permission (D5, ADR 40). */
export const FieldSensitivity = {
  PUBLIC: 'PUBLIC',
  PERSONAL: 'PERSONAL',
  CONTACT: 'CONTACT',
  FINANCIAL: 'FINANCIAL',
  SENSITIVE: 'SENSITIVE',
} as const;
export type FieldSensitivity = (typeof FieldSensitivity)[keyof typeof FieldSensitivity];

export const ReportParamType = {
  ACADEMIC_YEAR: 'ACADEMIC_YEAR',
  CLASS: 'CLASS',
  SECTION: 'SECTION',
  DATE: 'DATE',
  DATE_RANGE: 'DATE_RANGE',
  ENUM: 'ENUM',
  TEXT: 'TEXT',
} as const;
export type ReportParamType = (typeof ReportParamType)[keyof typeof ReportParamType];

export const FilterOp = {
  EQ: 'EQ',
  NEQ: 'NEQ',
  IN: 'IN',
  NOT_IN: 'NOT_IN',
  GT: 'GT',
  GTE: 'GTE',
  LT: 'LT',
  LTE: 'LTE',
  BETWEEN: 'BETWEEN',
  CONTAINS: 'CONTAINS',
  IS_NULL: 'IS_NULL',
  NOT_NULL: 'NOT_NULL',
} as const;
export type FilterOp = (typeof FilterOp)[keyof typeof FilterOp];

export const AggregateFn = {
  COUNT: 'COUNT',
  COUNT_DISTINCT: 'COUNT_DISTINCT',
  SUM: 'SUM',
  AVG: 'AVG',
  MIN: 'MIN',
  MAX: 'MAX',
} as const;
export type AggregateFn = (typeof AggregateFn)[keyof typeof AggregateFn];

export const ExportFormat = { CSV: 'CSV', XLSX: 'XLSX' } as const;
export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

export const ReportRunStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;
export type ReportRunStatus = (typeof ReportRunStatus)[keyof typeof ReportRunStatus];

export const ReportRunKind = {
  PREVIEW: 'PREVIEW',
  RUN: 'RUN',
  EXPORT: 'EXPORT',
  SCHEDULED: 'SCHEDULED',
  SNAPSHOT: 'SNAPSHOT',
} as const;
export type ReportRunKind = (typeof ReportRunKind)[keyof typeof ReportRunKind];

export const ReportDefinitionStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ReportDefinitionStatus =
  (typeof ReportDefinitionStatus)[keyof typeof ReportDefinitionStatus];

export const ReportScheduleFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;
export type ReportScheduleFrequency =
  (typeof ReportScheduleFrequency)[keyof typeof ReportScheduleFrequency];

export const ReportSubjectArea = {
  STUDENTS: 'STUDENTS',
  STAFF: 'STAFF',
  PUBLIC_EXAMS: 'PUBLIC_EXAMS',
  FEES: 'FEES',
  PAYMENTS: 'PAYMENTS',
  ATTENDANCE: 'ATTENDANCE',
} as const;
export type ReportSubjectArea = (typeof ReportSubjectArea)[keyof typeof ReportSubjectArea];

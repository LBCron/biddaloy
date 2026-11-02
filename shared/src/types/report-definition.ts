import type {
  AggregateFn,
  FilterOp,
  ReportLayoutType,
  ReportParamType,
  ReportSubjectArea,
} from '../enums/reports';

/**
 * [8.15.8] The JSON a tenant stores as a report (D3, D4). Plain data only: field
 * keys point into the server-side registry (D19), so no SQL and no expression
 * other than the whitelisted language of [8.15.36] ever lives here.
 */
export const REPORT_DEFINITION_SCHEMA_VERSION = 1;

export interface ReportParameter {
  /** Name referenced by filters as `{ param: key }`. */
  key: string;
  type: ReportParamType;
  label_en: string;
  label_bn: string;
  required: boolean;
  /** Default used when the report auto-runs on open (D22). */
  default?: string | number | boolean | null | { from: string; to: string };
  /** ENUM parameters only. */
  options?: Array<{ value: string; label_en: string; label_bn: string }>;
  /** CLASS → SECTION style cascade: the parameter this one depends on. */
  depends_on?: string;
}

export type ReportFilterValue =
  string | number | boolean | null | Array<string | number> | { param: string };

export interface ReportFilter {
  field: string;
  op: FilterOp;
  value?: ReportFilterValue;
}

export interface ReportDimension {
  field: string;
  /** Optional date bucketing for DATE fields. */
  bucket?: 'day' | 'week' | 'month' | 'year';
}

export interface ReportMeasure {
  field: string;
  fn: AggregateFn;
  /** Column heading override; falls back to the registry label. */
  alias?: string;
}

export interface ReportSort {
  field: string;
  dir: 'asc' | 'desc';
}

export interface ReportDataset {
  dimensions: ReportDimension[];
  measures: ReportMeasure[];
  filters: ReportFilter[];
  sort: ReportSort[];
  /** Capped by the runner (D20); this is only the author's wish. */
  limit?: number;
}

export interface ReportLayout {
  type: ReportLayoutType;
  /** GROUPED: dimension fields to group by, outermost first. */
  group_by?: string[];
  /** GROUPED: show a subtotal row per group. */
  subtotals?: boolean;
  /** CROSSTAB: row and column dimension fields, plus the measure shown in cells. */
  rows?: string[];
  columns?: string[];
  cell_measure?: string;
  /** CHART. */
  chart?: { kind: 'bar' | 'line' | 'pie'; x: string; y: string[] };
  /** Show a grand-total row. */
  totals?: boolean;
}

export interface ReportPage {
  title_en: string;
  title_bn: string;
  orientation: 'portrait' | 'landscape';
  show_photo?: boolean;
  footer?: string;
}

export interface ReportDrill {
  /** Field whose cell links onward. */
  field: string;
  /** Target report `key` or a coded screen route. */
  target: { report: string } | { route: string };
  /** Target parameter → source field. */
  pass: Record<string, string>;
}

export interface ReportCalculatedField {
  key: string;
  label_en: string;
  label_bn: string;
  /** Whitelisted expression language ([8.15.36]). */
  expression: string;
}

export interface ReportFormatRule {
  field: string;
  when: ReportFilter;
  style: { tone: 'good' | 'warn' | 'bad' | 'muted' };
}

export interface ReportDefinitionJson {
  schema: typeof REPORT_DEFINITION_SCHEMA_VERSION;
  subjectArea: ReportSubjectArea;
  parameters: ReportParameter[];
  dataset: ReportDataset;
  layout: ReportLayout;
  page: ReportPage;
  drill: ReportDrill[];
  calculated: ReportCalculatedField[];
  format: ReportFormatRule[];
}

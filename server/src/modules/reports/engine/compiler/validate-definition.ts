import {
  FilterOp,
  REPORT_DEFINITION_SCHEMA_VERSION,
  ReportFieldType,
  type ReportDefinitionJson,
  type ReportFilter,
  type ReportSort,
} from '@biddaloy/shared';
import type { FieldDef, MeasureDef, SubjectAreaDef } from '../registry/registry.types';
import { ReportCompileError } from './compiler.errors';

const NUMERIC = new Set<ReportFieldType>([
  ReportFieldType.NUMBER,
  ReportFieldType.MONEY,
  ReportFieldType.PERCENT,
]);

const COMPARE = [FilterOp.GT, FilterOp.GTE, FilterOp.LT, FilterOp.LTE, FilterOp.BETWEEN];
const EQUALITY = [FilterOp.EQ, FilterOp.NEQ, FilterOp.IN, FilterOp.NOT_IN];
const NULLS = [FilterOp.IS_NULL, FilterOp.NOT_NULL];

/** Which conditions make sense for which field type. */
export const OPS_BY_TYPE: Record<ReportFieldType, readonly FilterOp[]> = {
  [ReportFieldType.TEXT]: [...EQUALITY, FilterOp.CONTAINS, ...NULLS],
  [ReportFieldType.NUMBER]: [...EQUALITY, ...COMPARE, ...NULLS],
  [ReportFieldType.MONEY]: [...EQUALITY, ...COMPARE, ...NULLS],
  [ReportFieldType.PERCENT]: [...EQUALITY, ...COMPARE, ...NULLS],
  [ReportFieldType.DATE]: [FilterOp.EQ, FilterOp.NEQ, ...COMPARE, ...NULLS],
  [ReportFieldType.ENUM]: [...EQUALITY, ...NULLS],
  [ReportFieldType.BOOLEAN]: [FilterOp.EQ, FilterOp.NEQ, ...NULLS],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 200;
const MAX_LIST = 200;

export type Scalar = string | number | boolean;

/** A filter whose parameter references are replaced by the values the runner supplied. */
export interface ResolvedFilter {
  field: FieldDef;
  op: FilterOp;
  /** `[]` for IS_NULL / NOT_NULL, one for a single comparison, two for BETWEEN, any number for IN / NOT_IN. */
  values: Scalar[];
}

export interface ValidatedDefinition {
  dimensions: Array<{ field: FieldDef; bucket?: 'day' | 'week' | 'month' | 'year' }>;
  measures: Array<{ measure: MeasureDef; alias: string }>;
  filters: ResolvedFilter[];
  sorts: Array<{ key: string; dir: 'asc' | 'desc'; field?: FieldDef }>;
  limit: number | undefined;
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** Checks one value against the field's type. Throws BAD_VALUE without echoing it. */
function checkValue(field: FieldDef, value: unknown, path: string): Scalar {
  if (!isScalar(value)) throw new ReportCompileError('BAD_VALUE', path);
  const bad = () => new ReportCompileError('BAD_VALUE', path);
  if (NUMERIC.has(field.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw bad();
  } else if (field.type === ReportFieldType.BOOLEAN) {
    if (typeof value !== 'boolean') throw bad();
  } else if (field.type === ReportFieldType.DATE) {
    if (typeof value !== 'string' || !ISO_DATE.test(value)) throw bad();
  } else {
    if (typeof value !== 'string' || value.length > MAX_TEXT) throw bad();
    if (
      field.type === ReportFieldType.ENUM &&
      field.enumValues &&
      !field.enumValues.includes(value)
    ) {
      throw bad();
    }
  }
  return value;
}

/** A `{ from, to }` pair or a two-item list, for BETWEEN. */
function asRange(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && 'from' in raw && 'to' in raw) {
    const { from, to } = raw as { from: unknown; to: unknown };
    return [from, to];
  }
  return undefined;
}

/**
 * Turns a filter into checked values. A `{ param }` value is looked up in `values`
 * (or the parameter's default). Returns `null` when the filter points at an optional
 * parameter nobody answered: that filter simply does not apply.
 */
function resolveFilter(
  filter: ReportFilter,
  field: FieldDef,
  definition: ReportDefinitionJson,
  values: Record<string, unknown>,
  path: string,
): ResolvedFilter | null {
  const allowed = OPS_BY_TYPE[field.type];
  if (!allowed.includes(filter.op)) throw new ReportCompileError('BAD_OP', path);
  if (filter.op === FilterOp.IS_NULL || filter.op === FilterOp.NOT_NULL) {
    return { field, op: filter.op, values: [] };
  }

  let raw: unknown = filter.value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'param' in raw) {
    const key = (raw as { param: string }).param;
    const parameter = definition.parameters.find((p) => p.key === key);
    if (!parameter) throw new ReportCompileError('UNKNOWN_PARAM', path);
    raw = values[key] ?? parameter.default ?? undefined;
    if (raw === undefined || raw === null || raw === '') {
      if (parameter.required) throw new ReportCompileError('MISSING_PARAM', path);
      return null;
    }
  }

  if (filter.op === FilterOp.BETWEEN) {
    const range = asRange(raw);
    if (!range || range.length !== 2) throw new ReportCompileError('BAD_VALUE', path);
    return { field, op: filter.op, values: range.map((v) => checkValue(field, v, path)) };
  }
  if (filter.op === FilterOp.IN || filter.op === FilterOp.NOT_IN) {
    if (!Array.isArray(raw) || raw.length > MAX_LIST)
      throw new ReportCompileError('BAD_VALUE', path);
    return { field, op: filter.op, values: raw.map((v) => checkValue(field, v, path)) };
  }
  return { field, op: filter.op, values: [checkValue(field, raw, path)] };
}

function sortTarget(
  sort: ReportSort,
  area: SubjectAreaDef,
  selected: Set<string>,
  path: string,
): { key: string; dir: 'asc' | 'desc'; field?: FieldDef } {
  if (sort.dir !== 'asc' && sort.dir !== 'desc') throw new ReportCompileError('BAD_VALUE', path);
  const field = area.fields.find((f) => f.key === sort.field);
  const measure = area.measures.find((m) => m.key === sort.field);
  if (!field && !measure) throw new ReportCompileError('UNKNOWN_FIELD', path);
  if (field && !field.sortable) throw new ReportCompileError('NOT_SORTABLE', path);
  // A measure can only be sorted when it is on the report.
  if (measure && !selected.has(measure.key)) throw new ReportCompileError('NOT_SORTABLE', path);
  return { key: sort.field, dir: sort.dir, field };
}

/**
 * Checks a definition against the area it names and the answers the runner gave.
 * Every key must exist in the registry; no string from the definition ever reaches
 * SQL except through the registry's own fragments.
 */
export function validateDefinition(
  definition: ReportDefinitionJson,
  area: SubjectAreaDef | undefined,
  values: Record<string, unknown>,
): ValidatedDefinition {
  if (definition.schema !== REPORT_DEFINITION_SCHEMA_VERSION) {
    throw new ReportCompileError('UNSUPPORTED_SCHEMA', 'schema');
  }
  if (!area) throw new ReportCompileError('UNKNOWN_AREA', 'subjectArea');

  const { dataset } = definition;
  const dimensions = dataset.dimensions.map((d, i) => {
    const path = `dataset.dimensions[${i}]`;
    const field = area.fields.find((f) => f.key === d.field);
    if (!field) throw new ReportCompileError('UNKNOWN_FIELD', path);
    if (!field.groupable && dataset.measures.length > 0) {
      throw new ReportCompileError('NOT_GROUPABLE', path);
    }
    const bucket = d.bucket;
    if (bucket !== undefined) {
      if (
        field.type !== ReportFieldType.DATE ||
        !['day', 'week', 'month', 'year'].includes(bucket)
      ) {
        throw new ReportCompileError('BAD_VALUE', path);
      }
    }
    return { field, bucket };
  });

  const measures = dataset.measures.map((m, i) => {
    const measure = area.measures.find((x) => x.key === m.field);
    if (!measure) throw new ReportCompileError('UNKNOWN_MEASURE', `dataset.measures[${i}]`);
    return { measure, alias: measure.key };
  });

  if (dimensions.length === 0 && measures.length === 0) {
    throw new ReportCompileError('NOTHING_TO_SHOW', 'dataset');
  }

  const filters: ResolvedFilter[] = [];
  dataset.filters.forEach((filter, i) => {
    const path = `dataset.filters[${i}]`;
    const field = area.fields.find((f) => f.key === filter.field);
    if (!field) throw new ReportCompileError('UNKNOWN_FIELD', path);
    if (!field.filterable) throw new ReportCompileError('NOT_FILTERABLE', path);
    const resolved = resolveFilter(filter, field, definition, values, path);
    if (resolved) filters.push(resolved);
  });

  // Required parameters must be answered even if no filter uses them.
  for (const parameter of definition.parameters) {
    const answer = values[parameter.key] ?? parameter.default;
    if (parameter.required && (answer === undefined || answer === null || answer === '')) {
      throw new ReportCompileError('MISSING_PARAM', `parameters.${parameter.key}`);
    }
  }

  const selected = new Set<string>([
    ...dimensions.map((d) => d.field.key),
    ...measures.map((m) => m.alias),
  ]);
  const sorts = dataset.sort.map((s, i) => {
    const target = sortTarget(s, area, selected, `dataset.sort[${i}]`);
    // Only an output column can be sorted: the builder skips any other, and a grouped query has no such column.
    if (target.field && !selected.has(target.key)) {
      throw new ReportCompileError('NOT_SORTABLE', `dataset.sort[${i}]`);
    }
    return target;
  });

  const limit =
    typeof dataset.limit === 'number' && Number.isInteger(dataset.limit) && dataset.limit > 0
      ? dataset.limit
      : undefined;

  return { dimensions, measures, filters, sorts, limit };
}

import type { DataSource, SelectQueryBuilder } from 'typeorm';
import { AggregateFn, FilterOp } from '@biddaloy/shared';
import { normalizeSearchTerm } from '../../../../common/utils/normalize-search-term.util';
import type { EntityDef, JoinDef, SubjectAreaDef } from '../registry/registry.types';
import type { ScopeClause } from '../security/role-scope.policy';
import type { ResolvedFilter, ValidatedDefinition } from './validate-definition';

export interface BuildInput {
  area: SubjectAreaDef;
  joins: readonly JoinDef[];
  tenantId: string;
  validated: ValidatedDefinition;
  /** Dimension and measure keys the runner may see; others are left out of the SELECT (D5). */
  visible: ReadonlySet<string>;
  scope: readonly ScopeClause[];
  /** The caller's hard cap (D20). The definition's own `limit` can only lower it. */
  maxRows: number;
  /** Sort keys whose field is not shown: ordered by the field's own SQL (only when rows are not grouped). */
  unselectedSorts?: ReadonlySet<string>;
  /** Bound values of calculated-field literals (`c0`, `c1`, ...). */
  extraParams?: Record<string, unknown>;
}

const DATE_BUCKETS = { day: 'day', week: 'week', month: 'month', year: 'year' } as const;

/** `s.deleted_at IS NULL`, or nothing when the table does not soft-delete. */
const aliveClause = (e: EntityDef): string[] =>
  e.softDeleteColumn ? [`${e.alias}.${e.softDeleteColumn} IS NULL`] : [];

/** The predicate that keeps one table inside the school; a table without `tenant_id` is covered through its via alias. */
const tenantClause = (e: EntityDef): string[] =>
  e.tenantColumn ? [`${e.alias}.${e.tenantColumn} = :tenantId`] : [];

function aggregateSql(fn: AggregateFn, sql: string): string {
  switch (fn) {
    case AggregateFn.COUNT:
      return sql === '*' ? 'COUNT(*)' : `COUNT(${sql})`;
    case AggregateFn.COUNT_DISTINCT:
      return `COUNT(DISTINCT ${sql})`;
    case AggregateFn.SUM:
      return `SUM(${sql})`;
    case AggregateFn.AVG:
      return `AVG(${sql})`;
    case AggregateFn.MIN:
      return `MIN(${sql})`;
    case AggregateFn.MAX:
      return `MAX(${sql})`;
  }
}

/** One filter as SQL with named parameters; the counter keeps every name unique. */
function filterSql(
  filter: ResolvedFilter,
  next: () => string,
  params: Record<string, unknown>,
): string {
  const { sql } = filter.field;
  const bind = (value: unknown): string => {
    const name = next();
    params[name] = value;
    return `:${name}`;
  };
  switch (filter.op) {
    case FilterOp.IS_NULL:
      return `${sql} IS NULL`;
    case FilterOp.NOT_NULL:
      return `${sql} IS NOT NULL`;
    case FilterOp.EQ:
      return `${sql} = ${bind(filter.values[0])}`;
    case FilterOp.NEQ:
      return `${sql} <> ${bind(filter.values[0])}`;
    case FilterOp.GT:
      return `${sql} > ${bind(filter.values[0])}`;
    case FilterOp.GTE:
      return `${sql} >= ${bind(filter.values[0])}`;
    case FilterOp.LT:
      return `${sql} < ${bind(filter.values[0])}`;
    case FilterOp.LTE:
      return `${sql} <= ${bind(filter.values[0])}`;
    case FilterOp.BETWEEN:
      return `${sql} BETWEEN ${bind(filter.values[0])} AND ${bind(filter.values[1])}`;
    case FilterOp.IN:
      // An empty list matches nothing; NOT IN an empty list matches everything.
      return filter.values.length === 0
        ? '1 = 0'
        : `${sql} IN (${filter.values.map(bind).join(', ')})`;
    case FilterOp.NOT_IN:
      return filter.values.length === 0
        ? '1 = 1'
        : `${sql} NOT IN (${filter.values.map(bind).join(', ')})`;
    case FilterOp.CONTAINS: {
      // The LIKE metacharacters are escaped by the shared helper (Security Rule 4).
      const term = normalizeSearchTerm(String(filter.values[0]));
      return term === null ? '1 = 1' : `${sql} ILIKE ${bind(`%${term}%`)}`;
    }
  }
}

/**
 * Builds the query with TypeORM's builder: no value is ever concatenated into SQL
 * (they are all named parameters) and the only SQL text comes from the registry.
 * Every table in the query is school-scoped (D6): the root in WHERE, each joined table
 * inside its own ON so a LEFT JOIN stays a left join.
 */
export function buildQuery(dataSource: DataSource, input: BuildInput): SelectQueryBuilder<object> {
  const { area, joins, tenantId, validated, visible, scope, maxRows } = input;
  const qb = dataSource.createQueryBuilder().select([]).from(area.root.table, area.root.alias);
  // Explicit predicates below replace TypeORM's automatic soft-delete handling.
  qb.withDeleted();

  for (const join of joins) {
    const condition = [join.on, ...tenantClause(join.to), ...aliveClause(join.to)].join(' AND ');
    if (join.kind === 'inner') qb.innerJoin(join.to.table, join.to.alias, condition);
    else qb.leftJoin(join.to.table, join.to.alias, condition);
  }

  const groupBy: string[] = [];
  for (const { field, bucket } of validated.dimensions) {
    if (!visible.has(field.key)) continue;
    const expr = bucket ? `date_trunc('${DATE_BUCKETS[bucket]}', ${field.sql})::date` : field.sql;
    qb.addSelect(expr, field.key);
    groupBy.push(expr);
  }
  for (const { measure, alias } of validated.measures) {
    if (!visible.has(alias)) continue;
    qb.addSelect(aggregateSql(measure.fn, measure.sql), alias);
  }
  if (validated.measures.some((m) => visible.has(m.alias))) {
    for (const expr of groupBy) qb.addGroupBy(expr);
  }

  const wheres = [...tenantClause(area.root), ...aliveClause(area.root), ...(area.baseWhere ?? [])];
  const params: Record<string, unknown> = { ...input.extraParams, tenantId };
  let counter = 0;
  const next = () => `p${counter++}`;
  for (const filter of validated.filters) wheres.push(filterSql(filter, next, params));
  for (const clause of scope) {
    wheres.push(clause.sql);
    Object.assign(params, clause.params);
  }
  wheres.forEach((w, i) => (i === 0 ? qb.where(w) : qb.andWhere(w)));
  qb.setParameters(params);

  for (const sort of validated.sorts) {
    if (input.unselectedSorts?.has(sort.key) && sort.field) {
      // The registry's own SQL for the field, never text from the definition.
      qb.addOrderBy(sort.field.sql, sort.dir === 'asc' ? 'ASC' : 'DESC');
      continue;
    }
    if (!visible.has(sort.key)) continue;
    // A selected column is sorted by its output name, which is a registry key (letters, digits, underscore).
    qb.addOrderBy(`"${sort.key}"`, sort.dir === 'asc' ? 'ASC' : 'DESC');
  }

  qb.limit(Math.min(validated.limit ?? maxRows, maxRows));
  return qb;
}

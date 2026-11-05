import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type SelectQueryBuilder } from 'typeorm';
import {
  type AggregateFn,
  type ReportDefinitionJson,
  ReportFieldType,
  UserRole,
} from '@biddaloy/shared';
import { ExpressionError } from '../expressions/expression.parser';
import { compileExpression } from '../expressions/expression.compiler';
import type { ValueType } from '../expressions/expression.functions';
import { ReportRegistry } from '../registry/registry';
import type { FieldDef, SubjectAreaDef } from '../registry/registry.types';
import {
  COMMITTEE_EXTRA_FIELDS,
  type ReportRunContext,
  RoleScopePolicy,
  type ScopeClause,
} from '../security/role-scope.policy';
import { ReportCompileError } from './compiler.errors';
import { entitiesInQuery, planJoins } from './join-planner';
import { buildQuery } from './sql-builder';
import { validateDefinition } from './validate-definition';

export interface CompiledColumn {
  key: string;
  labelEn: string;
  labelBn: string;
  type: ReportFieldType;
  kind: 'dimension' | 'measure';
  /** Measures only: how it is aggregated (the runner hides small COUNTs from COMMITTEE). */
  fn?: AggregateFn;
}

export interface CompiledReport {
  /** The school the query was built for; the runner names it to the database for RLS (D6). */
  tenantId: string;
  /** Not yet executed. The runner ([8.15.22]) runs it in a read-only transaction. */
  query: SelectQueryBuilder<object>;
  columns: CompiledColumn[];
  /** Keys left out because the runner's role may not see them (D5). */
  masked: string[];
  /** Aliases in the query, root first: what the tenant-leak test walks. */
  aliases: string[];
}

const TO_VALUE_TYPE: Record<ReportFieldType, ValueType> = {
  [ReportFieldType.TEXT]: 'TEXT',
  [ReportFieldType.NUMBER]: 'NUMBER',
  [ReportFieldType.MONEY]: 'MONEY',
  [ReportFieldType.PERCENT]: 'PERCENT',
  [ReportFieldType.DATE]: 'DATE',
  [ReportFieldType.ENUM]: 'TEXT',
  [ReportFieldType.BOOLEAN]: 'BOOLEAN',
};
const FROM_VALUE_TYPE: Record<ValueType, ReportFieldType> = {
  TEXT: ReportFieldType.TEXT,
  NUMBER: ReportFieldType.NUMBER,
  MONEY: ReportFieldType.MONEY,
  PERCENT: ReportFieldType.PERCENT,
  DATE: ReportFieldType.DATE,
  BOOLEAN: ReportFieldType.BOOLEAN,
  NULL: ReportFieldType.TEXT,
};

/**
 * [8.15.36] The area plus the report's calculated fields, each compiled from its expression into an
 * ordinary field (so it can be shown, split by, filtered and sorted) with the sensitivity of the most
 * sensitive field it reads. Literals become bound parameters, returned in `params`.
 */
export function withCalculated(
  area: SubjectAreaDef,
  calculated: ReportDefinitionJson['calculated'],
): { area: SubjectAreaDef; params: Record<string, unknown> } {
  if (!calculated || calculated.length === 0) return { area, params: {} };
  const params: Record<string, unknown> = {};
  let counter = 0;
  const taken = new Set([...area.fields.map((f) => f.key), ...area.measures.map((m) => m.key)]);
  const added: FieldDef[] = [];
  calculated.forEach((calc, i) => {
    const path = `calculated[${i}]`;
    if (
      !/^[a-z][a-z0-9_]*$/.test(calc.key) ||
      taken.has(calc.key) ||
      COMMITTEE_EXTRA_FIELDS.has(calc.key)
    ) {
      throw new ReportCompileError('BAD_CALCULATION', path);
    }
    try {
      const compiled = compileExpression(
        calc.expression,
        (key) => {
          const f = area.fields.find((x) => x.key === key);
          return f
            ? {
                sql: f.sql,
                type: TO_VALUE_TYPE[f.type],
                sensitivity: f.sensitivity,
                entity: f.entity,
              }
            : undefined;
        },
        () => `c${counter++}`,
        params,
      );
      taken.add(calc.key);
      added.push({
        key: calc.key,
        labelEn: calc.label_en,
        labelBn: calc.label_bn,
        type: FROM_VALUE_TYPE[compiled.type],
        sql: compiled.sql,
        entity: compiled.entities[0] ?? area.root.alias,
        entities: compiled.entities,
        filterable: true,
        groupable: true,
        sortable: true,
        sensitivity: compiled.sensitivity,
        calculated: true,
      });
    } catch (error) {
      if (error instanceof ExpressionError) throw new ReportCompileError('BAD_CALCULATION', path);
      throw error;
    }
  });
  return { area: { ...area, fields: [...area.fields, ...added] }, params };
}

/**
 * [8.15.15] The only author of report SQL (D4). Definition + the runner's answers +
 * who is running it in; a parameterised, school-scoped query builder out.
 */
@Injectable()
export class ReportCompiler {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: ReportRegistry,
    private readonly policy: RoleScopePolicy,
  ) {}

  /** The entry point: asks the policy which rows the runner may see, then builds the query. */
  async compile(
    definition: ReportDefinitionJson,
    values: Record<string, unknown>,
    ctx: ReportRunContext,
    maxRows: number,
  ): Promise<CompiledReport> {
    const area = this.registry.area(definition.subjectArea);
    // Validate first so a malformed definition is reported as such before any access check.
    if (!area) throw new ReportCompileError('UNKNOWN_AREA', 'subjectArea');
    validateDefinition(definition, withCalculated(area, definition.calculated).area, values);
    const scope = await this.policy.scopeFor(ctx, area);
    return this.compileWithScope(definition, values, ctx, maxRows, scope);
  }

  /** Builds the query for a given row scope. Synchronous and pure, so specs can drive it directly. */
  compileWithScope(
    definition: ReportDefinitionJson,
    values: Record<string, unknown>,
    ctx: ReportRunContext,
    maxRows: number,
    scope: readonly ScopeClause[],
  ): CompiledReport {
    const registered = this.registry.area(definition.subjectArea);
    if (!registered) throw new ReportCompileError('UNKNOWN_AREA', 'subjectArea');
    const { area, params: calculatedParams } = withCalculated(registered, definition.calculated);
    const validated = validateDefinition(definition, area, values);

    // D5: the runner's permissions decide what is shown, never the author's.
    const masked: string[] = [];
    const visible = new Set<string>();
    for (const { field } of validated.dimensions) {
      if (this.policy.fieldAllowed(ctx, field)) visible.add(field.key);
      else masked.push(field.key);
    }
    for (const { measure, alias } of validated.measures) {
      if (this.policy.fieldAllowed(ctx, measure)) visible.add(alias);
      else masked.push(alias);
    }
    // A filter on a field the runner may not see would leak it through the row set; refuse, never drop it.
    for (const { field } of validated.filters) {
      if (!this.policy.fieldAllowed(ctx, field)) {
        throw new ReportCompileError('NOT_FILTERABLE', `dataset.filters.${field.key}`);
      }
    }
    if (visible.size === 0) throw new ReportCompileError('NOTHING_TO_SHOW', 'dataset');
    // COMMITTEE sees counts only: a dimension-only report would list people-level rows.
    if (ctx.role === UserRole.COMMITTEE && !validated.measures.some((m) => visible.has(m.alias))) {
      throw new ReportCompileError('NOTHING_TO_SHOW', 'dataset');
    }

    const referenced = new Set<string>();
    const addEntities = (def: { entity: string; entities?: readonly string[] }) => {
      for (const alias of def.entities && def.entities.length > 0 ? def.entities : [def.entity]) {
        referenced.add(alias);
      }
    };
    for (const { field } of validated.dimensions) if (visible.has(field.key)) addEntities(field);
    for (const { measure, alias } of validated.measures)
      if (visible.has(alias)) addEntities(measure);
    for (const filter of validated.filters) addEntities(filter.field);
    // A field can order the rows without being shown, if the role may see it and rows are not grouped.
    const selected = new Set([
      ...validated.dimensions.map((d) => d.field.key),
      ...validated.measures.map((m) => m.alias),
    ]);
    const unselectedSorts = new Set(
      validated.sorts
        .filter((s) => s.field && !selected.has(s.key) && this.policy.fieldAllowed(ctx, s.field))
        .map((s) => s.key),
    );
    for (const sort of validated.sorts) {
      if (sort.field && (visible.has(sort.key) || unselectedSorts.has(sort.key)))
        addEntities(sort.field);
    }
    for (const clause of scope) for (const alias of clause.aliases ?? []) referenced.add(alias);

    const joins = planJoins(area, referenced);
    const query = buildQuery(this.dataSource, {
      area,
      joins,
      tenantId: ctx.tenantId,
      validated,
      visible,
      scope,
      maxRows,
      extraParams: calculatedParams,
      unselectedSorts,
    });

    const columns: CompiledColumn[] = [
      ...validated.dimensions
        .filter((d) => visible.has(d.field.key))
        .map(({ field }) => ({
          key: field.key,
          labelEn: field.labelEn,
          labelBn: field.labelBn,
          type: field.type,
          kind: 'dimension' as const,
        })),
      ...validated.measures
        .filter((m) => visible.has(m.alias))
        .map(({ measure }) => ({
          key: measure.key,
          labelEn: measure.labelEn,
          labelBn: measure.labelBn,
          type: measure.type,
          kind: 'measure' as const,
          fn: measure.fn,
        })),
    ];

    return {
      tenantId: ctx.tenantId,
      query,
      columns,
      masked,
      aliases: entitiesInQuery(area, joins).map((e) => e.alias),
    };
  }
}

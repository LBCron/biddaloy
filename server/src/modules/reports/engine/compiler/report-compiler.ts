import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type SelectQueryBuilder } from 'typeorm';
import type { ReportDefinitionJson, ReportFieldType } from '@biddaloy/shared';
import { ReportRegistry } from '../registry/registry';
import { type ReportRunContext, RoleScopePolicy } from '../security/role-scope.policy';
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
}

export interface CompiledReport {
  /** Not yet executed. The runner ([8.15.22]) runs it in a read-only transaction. */
  query: SelectQueryBuilder<object>;
  columns: CompiledColumn[];
  /** Keys left out because the runner's role may not see them (D5). */
  masked: string[];
  /** Aliases in the query, root first: what the tenant-leak test walks. */
  aliases: string[];
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

  compile(
    definition: ReportDefinitionJson,
    values: Record<string, unknown>,
    ctx: ReportRunContext,
    maxRows: number,
  ): CompiledReport {
    const area = this.registry.area(definition.subjectArea);
    const validated = validateDefinition(definition, area, values);
    if (!area) throw new ReportCompileError('UNKNOWN_AREA', 'subjectArea');

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

    const scope = this.policy.scopeFor(ctx);
    const referenced = new Set<string>();
    for (const { field } of validated.dimensions)
      if (visible.has(field.key)) referenced.add(field.entity);
    for (const { measure, alias } of validated.measures)
      if (visible.has(alias)) referenced.add(measure.entity);
    for (const filter of validated.filters) referenced.add(filter.field.entity);
    for (const sort of validated.sorts)
      if (sort.field && visible.has(sort.key)) referenced.add(sort.field.entity);
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
        })),
    ];

    return {
      query,
      columns,
      masked,
      aliases: entitiesInQuery(area, joins).map((e) => e.alias),
    };
  }
}

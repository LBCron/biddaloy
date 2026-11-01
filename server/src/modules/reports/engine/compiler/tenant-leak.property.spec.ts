import fc from 'fast-check';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import {
  AggregateFn,
  FilterOp,
  ReportFieldType,
  ReportLayoutType,
  UserRole,
  type ReportDefinitionJson,
  type ReportFilter,
} from '@biddaloy/shared';
import type { TeacherScopeService } from '../../../classes/teacher-scope.service';
import { ALL_AREAS } from '../registry/areas';
import { ReportRegistry } from '../registry/registry';
import type { FieldDef, SubjectAreaDef } from '../registry/registry.types';
import { RoleScopePolicy } from '../security/role-scope.policy';
import { ReportCompiler } from './report-compiler';
import { TEST_FEES_AREA, TEST_STUDENTS_AREA } from './test-areas';
import { OPS_BY_TYPE } from './validate-definition';

/**
 * D6, the invariant this engine stands on: every table in a generated query is filtered
 * by `tenant_id`. fast-check builds random VALID definitions over every area (the real
 * ones from the registry, which fill in with [8.15.20] / [8.15.21], plus fixtures that
 * cover left joins and a root without its own `tenant_id`), compiles each one, and walks
 * the builder's own alias list and conditions, not the SQL text.
 */
const TENANT = '22222222-2222-4222-8222-222222222222';
const MARKER = 'zzq';
const NUM_RUNS = 500;

const dataSource = new DataSource({ type: 'postgres' });

const valueFor = (field: FieldDef): fc.Arbitrary<string | number | boolean> => {
  switch (field.type) {
    case ReportFieldType.NUMBER:
    case ReportFieldType.MONEY:
    case ReportFieldType.PERCENT:
      return fc.integer({ min: 0, max: 100_000 });
    case ReportFieldType.DATE:
      return fc
        .date({ min: new Date('2020-01-01'), max: new Date('2030-01-01'), noInvalidDate: true })
        .map((d) => d.toISOString().slice(0, 10));
    case ReportFieldType.BOOLEAN:
      return fc.boolean();
    case ReportFieldType.ENUM:
      return fc.constantFrom(...(field.enumValues ?? ['X']));
    default:
      return fc.stringMatching(/^[a-z0-9]{1,12}$/).map((s) => `${MARKER}${s}`);
  }
};

const filterFor = (field: FieldDef): fc.Arbitrary<ReportFilter> =>
  fc.constantFrom(...OPS_BY_TYPE[field.type]).chain((op): fc.Arbitrary<ReportFilter> => {
    const value = valueFor(field);
    if (op === FilterOp.IS_NULL || op === FilterOp.NOT_NULL) {
      return fc.constant({ field: field.key, op });
    }
    if (op === FilterOp.BETWEEN) {
      return fc.tuple(value, value).map((v) => ({ field: field.key, op, value: v as never }));
    }
    if (op === FilterOp.IN || op === FilterOp.NOT_IN) {
      return fc
        .array(value, { maxLength: 3 })
        .map((v) => ({ field: field.key, op, value: v as never }));
    }
    return value.map((v) => ({ field: field.key, op, value: v }));
  });

function definitionFor(area: SubjectAreaDef): fc.Arbitrary<ReportDefinitionJson> {
  const filterable = area.fields.filter((f) => f.filterable);
  return fc
    .record({
      measures: fc.subarray([...area.measures]),
      dims: fc.subarray([...area.fields]),
      filters:
        filterable.length === 0
          ? fc.constant([])
          : fc.array(fc.constantFrom(...filterable).chain(filterFor), { maxLength: 4 }),
      limit: fc.option(fc.integer({ min: 1, max: 100_000 }), { nil: undefined }),
      sortFlags: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
    })
    .map(({ measures, dims, filters, limit, sortFlags }) => {
      // With a measure, only groupable fields may be split by (the compiler refuses the rest).
      const dimensions = (measures.length > 0 ? dims.filter((d) => d.groupable) : dims).map(
        (d) => ({
          field: d.key,
        }),
      );
      const sortable = [
        ...dims
          .filter((d) => d.sortable && dimensions.some((x) => x.field === d.key))
          .map((d) => d.key),
        ...measures.map((m) => m.key),
      ];
      const sort = sortable
        .filter((_, i) => sortFlags[i % sortFlags.length])
        .map((field, i) => ({ field, dir: (i % 2 ? 'asc' : 'desc') as 'asc' | 'desc' }));
      return {
        schema: 1 as const,
        subjectArea: area.key,
        parameters: [],
        dataset: {
          dimensions,
          measures: measures.map((m) => ({ field: m.key, fn: AggregateFn.COUNT })),
          filters,
          sort,
          limit,
        },
        layout: { type: ReportLayoutType.TABLE },
        page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' as const },
        drill: [],
        calculated: [],
        format: [],
      };
    })
    .filter((d) => d.dataset.dimensions.length + d.dataset.measures.length > 0);
}

interface Join {
  alias: { name: string };
  condition?: string;
  direction: string;
}
interface Where {
  condition: string;
}

/** The aliases and conditions as the builder holds them (not parsed out of SQL). */
function inspect(query: object) {
  const map = (
    query as {
      expressionMap: { mainAlias?: { name: string }; joinAttributes: Join[]; wheres: Where[] };
    }
  ).expressionMap;
  return {
    root: map.mainAlias?.name as string,
    joins: new Map(map.joinAttributes.map((j) => [j.alias.name, j])),
    wheres: map.wheres.map((w) => w.condition),
  };
}

const AREAS = [...ALL_AREAS.filter((a) => a.fields.length > 0), TEST_STUDENTS_AREA, TEST_FEES_AREA];

describe('tenant-leak property (D6)', () => {
  it('runs over at least one fixture area and every real area that has fields', () => {
    expect(AREAS.length).toBeGreaterThanOrEqual(2);
  });

  for (const area of AREAS) {
    it(`every table in a generated ${area.key} query is filtered by tenant`, () => {
      const registry = new ReportRegistry([area]);
      const compiler = new ReportCompiler(
        dataSource,
        registry,
        new RoleScopePolicy({ sectionScope: async () => null } as unknown as TeacherScopeService),
      );
      const entities = new Map([
        [area.root.alias, area.root],
        ...area.joins.map((j) => [j.to.alias, j.to] as const),
      ]);

      fc.assert(
        fc.property(definitionFor(area), (definition) => {
          const compiled = compiler.compileWithScope(
            definition,
            {},
            { tenantId: TENANT, userId: 'u', role: UserRole.ADMIN },
            500,
            [],
          );
          const { root, joins, wheres } = inspect(compiled.query);

          expect(root).toBe(area.root.alias);
          expect(compiled.aliases[0]).toBe(area.root.alias);
          for (const alias of compiled.aliases) {
            const entity = entities.get(alias);
            if (!entity) throw new Error(`unknown alias ${alias}`);
            const predicate = `${alias}.tenant_id = :tenantId`;
            if (alias === root && entity.tenantColumn === 'tenant_id') {
              expect(wheres.some((w) => w.includes(predicate))).toBe(true);
            } else if (alias === root) {
              // No tenant_id of its own: the via table is in the query, inner-joined, and filtered.
              const via = joins.get(entity.tenantVia as string);
              expect(via?.direction).toBe('INNER');
              expect(via?.condition).toContain(`${entity.tenantVia}.tenant_id = :tenantId`);
            } else if (entity.tenantColumn === null) {
              // A lookup without tenant_id (users) is only reachable from its school-scoped parent.
              expect(compiled.aliases).toContain(entity.tenantVia);
            } else {
              expect(joins.get(alias)?.condition).toContain(predicate);
            }
            if (entity.softDeleteColumn) {
              const alive = `${alias}.${entity.softDeleteColumn} IS NULL`;
              const where = alias === root ? wheres.join(' ') : (joins.get(alias)?.condition ?? '');
              expect(where).toContain(alive);
            }
          }

          // The tenant is a bound parameter, and no author-supplied value is in the SQL text.
          const [sql, params] = compiled.query.getQueryAndParameters();
          expect(params).toContain(TENANT);
          expect(sql).not.toContain(MARKER);
          expect(sql).not.toContain(TENANT);
        }),
        { numRuns: NUM_RUNS },
      );
    }, 120_000);
  }
});

import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';
import {
  FilterOp,
  AggregateFn,
  ReportLayoutType,
  ReportSubjectArea,
  UserRole,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { ReportRegistry } from '../registry/registry';
import type { FieldDef } from '../registry/registry.types';
import {
  type ReportRunContext,
  RoleScopePolicy,
  type ScopeClause,
} from '../security/role-scope.policy';
import type { TeacherScopeService } from '../../../classes/teacher-scope.service';
import { ReportCompileError } from './compiler.errors';
import { ReportCompiler } from './report-compiler';
import { TEST_FEES_AREA, TEST_STUDENTS_AREA } from './test-areas';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ctx: ReportRunContext = { tenantId: TENANT, userId: 'u1', role: UserRole.ADMIN };

// A DataSource that is never connected: the builder only needs the driver to quote names.
const dataSource = new DataSource({ type: 'postgres' });

/** A teacher-scope service that is never asked: these specs drive `compileWithScope` directly. */
const noTeacherScope = { sectionScope: async () => null } as unknown as TeacherScopeService;

function makeCompiler(policy = new RoleScopePolicy(noTeacherScope)) {
  const registry = new ReportRegistry([TEST_STUDENTS_AREA, TEST_FEES_AREA]);
  return new ReportCompiler(dataSource, registry, policy);
}

const definition = (
  over: Partial<ReportDefinitionJson['dataset']> = {},
  extra: Partial<ReportDefinitionJson> = {},
): ReportDefinitionJson => ({
  schema: 1,
  subjectArea: ReportSubjectArea.STUDENTS,
  parameters: [],
  dataset: { dimensions: [], measures: [], filters: [], sort: [], ...over },
  layout: { type: ReportLayoutType.TABLE },
  page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
  drill: [],
  calculated: [],
  format: [],
  ...extra,
});

const sqlOf = (
  def: ReportDefinitionJson,
  values = {},
  maxRows = 500,
  c = makeCompiler(),
  scope: ScopeClause[] = [],
) => {
  const compiled = c.compileWithScope(def, values, ctx, maxRows, scope);
  const [sql, params] = compiled.query.getQueryAndParameters();
  return { sql, params, compiled };
};

describe('ReportCompiler', () => {
  describe('SQL shape (snapshots)', () => {
    it('a plain list', () => {
      const { sql } = sqlOf(
        definition({
          dimensions: [{ field: 'name' }, { field: 'class' }],
          sort: [{ field: 'name', dir: 'asc' }],
        }),
      );
      expect(sql).toMatchSnapshot();
    });

    it('a grouped count with a filter', () => {
      const { sql, params } = sqlOf(
        definition({
          dimensions: [{ field: 'class' }, { field: 'gender' }],
          measures: [{ field: 'students', fn: AggregateFn.COUNT }],
          filters: [{ field: 'gender', op: FilterOp.EQ, value: 'FEMALE' }],
          sort: [{ field: 'students', dir: 'desc' }],
        }),
      );
      expect(sql).toMatchSnapshot();
      expect(params).toContain('FEMALE');
    });

    it('a crosstab dataset: class by gender with a bucketed date', () => {
      const { sql } = sqlOf(
        definition({
          dimensions: [
            { field: 'class' },
            { field: 'gender' },
            { field: 'birth_date', bucket: 'year' },
          ],
          measures: [{ field: 'students', fn: AggregateFn.COUNT }],
        }),
        {},
      );
      expect(sql).toMatchSnapshot();
    });

    it('a root without tenant_id is scoped through its joined student', () => {
      const { sql } = sqlOf(
        definition(
          {
            dimensions: [{ field: 'status' }],
            measures: [{ field: 'billed', fn: AggregateFn.SUM }],
          },
          { subjectArea: ReportSubjectArea.FEES },
        ),
      );
      expect(sql).toMatchSnapshot();
      expect(sql).toContain('s.tenant_id =');
    });
  });

  describe('tenant scope on every table', () => {
    it('puts the tenant in each LEFT JOIN condition, so a left join stays a left join', () => {
      const { sql } = sqlOf(
        definition({ dimensions: [{ field: 'name' }, { field: 'section' }, { field: 'class' }] }),
      );
      expect(sql).toMatch(/LEFT JOIN "class_sections" "cs" ON .*cs\.tenant_id = \$\d+/);
      expect(sql).toMatch(/LEFT JOIN "classes" "c" ON .*c\.tenant_id = \$\d+/);
      expect(sql).toMatch(/WHERE s\.tenant_id = \$\d+/);
    });

    it('adds the soft-delete predicate only for tables that soft-delete', () => {
      const { sql } = sqlOf(
        definition({ dimensions: [{ field: 'name' }, { field: 'guardian_phone' }] }),
      );
      expect(sql).toContain('s.deleted_at IS NULL');
      expect(sql).not.toContain('g.deleted_at');
    });

    it('joins only the tables the report needs', () => {
      const { sql, compiled } = sqlOf(definition({ dimensions: [{ field: 'name' }] }));
      expect(sql).not.toContain('JOIN');
      expect(compiled.aliases).toEqual(['s']);
    });

    it('joins the whole chain when only the far table is used', () => {
      const { compiled } = sqlOf(definition({ dimensions: [{ field: 'class' }] }));
      expect(compiled.aliases).toEqual(['s', 'cs', 'c']);
    });
  });

  describe('parameters', () => {
    it('never puts a value into the SQL text', () => {
      const marker = 'zzq9-marker-value';
      const { sql, params } = sqlOf(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [
            { field: 'name', op: FilterOp.CONTAINS, value: marker },
            { field: 'class', op: FilterOp.IN, value: ['alpha-zzq9', 'beta-zzq9'] },
            { field: 'roll', op: FilterOp.BETWEEN, value: [4242, 9191] },
          ],
        }),
      );
      expect(sql).not.toContain('zzq9');
      expect(sql).not.toContain('4242');
      expect(params).toEqual(
        expect.arrayContaining([TENANT, `%${marker}%`, 'alpha-zzq9', 'beta-zzq9', 4242, 9191]),
      );
    });

    it('escapes LIKE wildcards in a CONTAINS value', () => {
      const { params } = sqlOf(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'name', op: FilterOp.CONTAINS, value: '50%_off' }],
        }),
      );
      expect(params).toContain('%50\\%\\_off%');
    });

    it('answers a {param} filter from the values the runner gave', () => {
      const def = definition(
        {
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'class', op: FilterOp.EQ, value: { param: 'cls' } }],
        },
        {
          parameters: [{ key: 'cls', type: 'CLASS', label_en: 'C', label_bn: 'C', required: true }],
        },
      );
      const { params } = sqlOf(def, { cls: 'Six' });
      expect(params).toContain('Six');
    });

    it('uses the parameter default when nothing was answered', () => {
      const def = definition(
        {
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'class', op: FilterOp.EQ, value: { param: 'cls' } }],
        },
        {
          parameters: [
            {
              key: 'cls',
              type: 'CLASS',
              label_en: 'C',
              label_bn: 'C',
              required: true,
              default: 'Seven',
            },
          ],
        },
      );
      expect(sqlOf(def).params).toContain('Seven');
    });

    it('drops a filter on an optional parameter nobody answered', () => {
      const def = definition(
        {
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'class', op: FilterOp.EQ, value: { param: 'cls' } }],
        },
        {
          parameters: [
            { key: 'cls', type: 'CLASS', label_en: 'C', label_bn: 'C', required: false },
          ],
        },
      );
      expect(sqlOf(def).sql).not.toContain('c.name');
    });

    it('a required parameter with no answer is MISSING_PARAM', () => {
      const def = definition(
        {
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'class', op: FilterOp.EQ, value: { param: 'cls' } }],
        },
        {
          parameters: [{ key: 'cls', type: 'CLASS', label_en: 'C', label_bn: 'C', required: true }],
        },
      );
      expect(() => sqlOf(def)).toThrowError(expect.objectContaining({ code: 'MISSING_PARAM' }));
    });

    it('a date-range parameter feeds BETWEEN', () => {
      const def = definition(
        {
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'birth_date', op: FilterOp.BETWEEN, value: { param: 'range' } }],
        },
        {
          parameters: [
            { key: 'range', type: 'DATE_RANGE', label_en: 'R', label_bn: 'R', required: true },
          ],
        },
      );
      const { params } = sqlOf(def, { range: { from: '2026-01-01', to: '2026-01-31' } });
      expect(params).toEqual(expect.arrayContaining(['2026-01-01', '2026-01-31']));
    });

    it('an empty IN list matches nothing, an empty NOT IN matches everything', () => {
      const none = sqlOf(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'class', op: FilterOp.IN, value: [] }],
        }),
      );
      expect(none.sql).toContain('1 = 0');
      const all = sqlOf(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'class', op: FilterOp.NOT_IN, value: [] }],
        }),
      );
      expect(all.sql).toContain('1 = 1');
    });
  });

  describe('a definition that is wrong is refused, with a fixed message', () => {
    const refuse = (def: ReportDefinitionJson, code: string, values = {}) => {
      let error: unknown;
      try {
        sqlOf(def, values);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ReportCompileError);
      expect((error as ReportCompileError).code).toBe(code);
      return error as ReportCompileError;
    };

    it('an unknown field, without echoing the name', () => {
      const error = refuse(
        definition({ dimensions: [{ field: "x'; DROP TABLE students;--" }] }),
        'UNKNOWN_FIELD',
      );
      expect(error.message).not.toContain('DROP');
      expect(error.path).toBe('dataset.dimensions[0]');
    });

    it('an unknown measure', () => {
      refuse(definition({ measures: [{ field: 'nope', fn: AggregateFn.SUM }] }), 'UNKNOWN_MEASURE');
    });

    it('an unknown subject area', () => {
      refuse(
        definition({ dimensions: [{ field: 'name' }] }, { subjectArea: ReportSubjectArea.STAFF }),
        'UNKNOWN_AREA',
      );
    });

    it('a schema version it does not know', () => {
      refuse(
        { ...definition({ dimensions: [{ field: 'name' }] }), schema: 2 as never },
        'UNSUPPORTED_SCHEMA',
      );
    });

    it('a filter condition that does not fit the field type', () => {
      refuse(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'name', op: FilterOp.GT, value: 'a' }],
        }),
        'BAD_OP',
      );
    });

    it('a value of the wrong type, an enum value outside the list, a malformed date', () => {
      refuse(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'roll', op: FilterOp.EQ, value: 'five' }],
        }),
        'BAD_VALUE',
      );
      refuse(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'gender', op: FilterOp.EQ, value: 'OTHER' }],
        }),
        'BAD_VALUE',
      );
      refuse(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'birth_date', op: FilterOp.EQ, value: '12/05/2026' }],
        }),
        'BAD_VALUE',
      );
    });

    it('a field that may not be filtered, grouped or sorted', () => {
      refuse(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'secret', op: FilterOp.EQ, value: 'x' }],
        }),
        'NOT_FILTERABLE',
      );
      refuse(
        definition({
          dimensions: [{ field: 'guardian_phone' }],
          measures: [{ field: 'students', fn: AggregateFn.COUNT }],
        }),
        'NOT_GROUPABLE',
      );
      refuse(
        definition({
          dimensions: [{ field: 'name' }],
          sort: [{ field: 'guardian_phone', dir: 'asc' }],
        }),
        'NOT_SORTABLE',
      );
    });

    it('a {param} the definition does not declare', () => {
      refuse(
        definition({
          dimensions: [{ field: 'name' }],
          filters: [{ field: 'class', op: FilterOp.EQ, value: { param: 'ghost' } }],
        }),
        'UNKNOWN_PARAM',
      );
    });

    it('nothing to show', () => {
      refuse(definition(), 'NOTHING_TO_SHOW');
    });

    it('a dataset with a missing array is a coded error, not a TypeError', () => {
      const bad = definition();
      (bad.dataset as unknown as Record<string, unknown>).dimensions = undefined;
      refuse(bad, 'BAD_VALUE');
      refuse(
        { ...definition(), dataset: undefined } as unknown as ReportDefinitionJson,
        'BAD_VALUE',
      );
    });
  });

  describe('calculated fields (8.15.36)', () => {
    const calc = (key: string, expression: string) => ({
      key,
      label_en: key,
      label_bn: key,
      expression,
    });
    const withCalc = (
      calculated: ReportDefinitionJson['calculated'],
      dataset: Partial<ReportDefinitionJson['dataset']>,
    ) => definition(dataset, { calculated });

    it('a calculated field can be shown, with its literals bound and its reads joined', () => {
      const { sql, params } = sqlOf(
        withCalc([calc('class_roll', "concat([class], '-', [roll])")], {
          dimensions: [{ field: 'class_roll' }],
        }),
      );
      expect(sql).toContain('CONCAT(');
      expect(sql).toContain('LEFT JOIN "classes" "c"'); // [class] lives on a joined table
      expect(sql).not.toContain("'-'");
      expect(params).toContain('-');
    });

    it('can be added up, and filtered on', () => {
      const { sql, params } = sqlOf(
        withCalc([calc('bonus', '[roll] + 10')], {
          measures: [{ field: 'bonus', fn: AggregateFn.SUM }],
          filters: [{ field: 'bonus', op: FilterOp.GT, value: 100 }],
        }),
      );
      expect(sql).toMatch(/SUM\(\(\(s\.roll_number\) \+ \(\$\d+\)::numeric\)\) AS "bonus"/);
      expect(params).toEqual(expect.arrayContaining([10, 100]));
    });

    it('is as sensitive as what it reads: a role that cannot see the field cannot see the calculation', async () => {
      class HideSensitive extends RoleScopePolicy {
        override fieldAllowed(_c: ReportRunContext, def: { sensitivity: string }) {
          return def.sensitivity !== 'CONTACT';
        }
      }
      const compiler = new ReportCompiler(
        dataSource,
        new ReportRegistry([TEST_STUDENTS_AREA]),
        new HideSensitive(noTeacherScope),
      );
      const compiled = compiler.compileWithScope(
        withCalc([calc('phone_note', "concat([guardian_phone], 'x')")], {
          dimensions: [{ field: 'name' }, { field: 'phone_note' }],
        }),
        {},
        ctx,
        500,
        [],
      );
      expect(compiled.masked).toEqual(['phone_note']);
    });

    it('a calculation that does not work is refused with a fixed message and its place', () => {
      for (const expression of ['[nothing] + 1', "[roll] + 'a'", 'lower([name])', '1 +']) {
        let error: unknown;
        try {
          sqlOf(withCalc([calc('bad', expression)], { dimensions: [{ field: 'name' }] }));
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(ReportCompileError);
        expect((error as ReportCompileError).code).toBe('BAD_CALCULATION');
        expect((error as ReportCompileError).path).toBe('calculated[0]');
        expect((error as ReportCompileError).message).not.toContain(expression);
      }
    });

    it('cannot reuse the key of an existing field or be written in capitals', () => {
      for (const key of ['name', 'students', 'Bad Key']) {
        expect(() =>
          sqlOf(withCalc([calc(key, '1 + 1')], { dimensions: [{ field: 'name' }] })),
        ).toThrowError(expect.objectContaining({ code: 'BAD_CALCULATION' }));
      }
    });
  });

  describe('row limit', () => {
    it('is the caller cap when the definition asks for more', () => {
      const { sql, params } = sqlOf(
        definition({ dimensions: [{ field: 'name' }], limit: 99999 }),
        {},
        500,
      );
      expect(sql).toMatch(/LIMIT 500$/);
      expect(params).toEqual([TENANT]);
    });

    it('is the definition limit when it is lower', () => {
      const { sql } = sqlOf(definition({ dimensions: [{ field: 'name' }], limit: 20 }), {}, 500);
      expect(sql).toMatch(/LIMIT 20$/);
    });
  });

  describe("the runner's permissions decide what is shown (D5)", () => {
    class HideSensitive extends RoleScopePolicy {
      override fieldAllowed(_c: ReportRunContext, field: FieldDef) {
        return field.sensitivity !== 'CONTACT';
      }
    }

    it('drops a hidden column from the SELECT and reports it as masked', () => {
      const { sql, compiled } = sqlOf(
        definition({ dimensions: [{ field: 'name' }, { field: 'guardian_phone' }] }),
        {},
        500,
        makeCompiler(new HideSensitive(noTeacherScope)),
      );
      expect(sql).not.toContain('g.phone');
      expect(compiled.masked).toEqual(['guardian_phone']);
      expect(compiled.columns.map((c) => c.key)).toEqual(['name']);
    });

    it('refuses a filter on a field the runner may not see, instead of dropping it', () => {
      expect(() =>
        sqlOf(
          definition({
            dimensions: [{ field: 'name' }],
            filters: [{ field: 'guardian_phone', op: FilterOp.CONTAINS, value: '0171' }],
          }),
          {},
          500,
          makeCompiler(new HideSensitive(noTeacherScope)),
        ),
      ).toThrowError(expect.objectContaining({ code: 'NOT_FILTERABLE' }));
    });

    it('hides a measure by its own sensitivity, whatever its SQL expression is', () => {
      class HideFinancial extends RoleScopePolicy {
        override fieldAllowed(_c: ReportRunContext, f: Pick<FieldDef, 'sensitivity'>) {
          return f.sensitivity !== 'FINANCIAL';
        }
      }
      const { compiled } = sqlOf(
        definition(
          {
            dimensions: [{ field: 'student' }],
            measures: [
              { field: 'billed', fn: AggregateFn.SUM },
              { field: 'bills', fn: AggregateFn.COUNT },
            ],
          },
          { subjectArea: ReportSubjectArea.FEES },
        ),
        {},
        500,
        makeCompiler(new HideFinancial(noTeacherScope)),
      );
      expect(compiled.masked).toEqual(['billed']);
    });

    it('refuses a sort on a field the list does not show', () => {
      expect(() =>
        sqlOf(
          definition({ dimensions: [{ field: 'name' }], sort: [{ field: 'roll', dir: 'asc' }] }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'NOT_SORTABLE' }));
    });

    it('refuses a report where every column is hidden', () => {
      expect(() =>
        sqlOf(
          definition({ dimensions: [{ field: 'guardian_phone' }] }),
          {},
          500,
          makeCompiler(new HideSensitive(noTeacherScope)),
        ),
      ).toThrowError(expect.objectContaining({ code: 'NOTHING_TO_SHOW' }));
    });

    it('COMMITTEE gets nothing from a report with no count measure', () => {
      const committee = { ...ctx, role: UserRole.COMMITTEE };
      expect(() =>
        makeCompiler().compileWithScope(
          definition({ dimensions: [{ field: 'class' }] }),
          {},
          committee,
          500,
          [],
        ),
      ).toThrowError(expect.objectContaining({ code: 'NOTHING_TO_SHOW' }));
    });

    it('adds a row-scope clause, with its own parameters, and joins what it reads', () => {
      const scope = [
        {
          sql: 'cs.id IN (:...scopeSections)',
          params: { scopeSections: ['sec-1'] },
          aliases: ['cs'],
        },
      ];
      const { sql, params } = sqlOf(
        definition({ dimensions: [{ field: 'name' }] }),
        {},
        500,
        makeCompiler(),
        scope,
      );
      expect(sql).toContain('cs.id IN ($');
      expect(sql).toContain('LEFT JOIN "class_sections" "cs"');
      expect(params).toContain('sec-1');
    });
  });
});

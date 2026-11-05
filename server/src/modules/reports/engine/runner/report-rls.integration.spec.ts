import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ReportLayoutType,
  UserRole,
  type ReportDefinitionJson,
  type ReportSubjectArea,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import { ALL_ENTITIES } from '@test/all-entities';
import { TeacherScopeService } from '../../../classes/teacher-scope.service';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { AuditService } from '../../../audit/audit.service';
import { ReportRunLogService } from '../../export/report-run-log.service';
import { ReportRowSourceRegistry } from '../../export/report-row-sources';
import { ReportCompiler } from '../compiler/report-compiler';
import { ALL_AREAS } from '../registry/areas';
import { ReportRegistry } from '../registry/registry';
import { RoleScopePolicy } from '../security/role-scope.policy';
import { ReportResultCache } from './report-result.cache';
import {
  REPORT_DB_ROLE,
  REPORT_TENANT_SETTING,
  ReportRunnerService,
} from './report-runner.service';

/**
 * [#3521, D6] The second tenant wall. It is proved on its own (raw SQL with no tenant predicate
 * still sees one school), and the registry is held to it: a table an area reads without the grant
 * and the policy fails here, so a new area cannot skip it.
 */
describe('report_reader row-level security (integration)', () => {
  let ds: DataSource;
  let runner: ReportRunnerService;
  let compiler: ReportCompiler;
  let fx: ReportAreaFixture;
  let a: string;
  let b: string;

  /** Runs `sql` inside a transaction as the report role, with `tenant` named (or nothing named). */
  async function asReportRole<T = Array<Record<string, string>>>(
    sql: string,
    tenant: string | null,
  ): Promise<T> {
    const q = ds.createQueryRunner();
    await q.connect();
    try {
      await q.startTransaction();
      if (tenant) await q.query('SELECT set_config($1, $2, true)', [REPORT_TENANT_SETTING, tenant]);
      await q.query(`SET LOCAL ROLE ${REPORT_DB_ROLE}`);
      return (await q.query(sql)) as T;
    } finally {
      if (q.isTransactionActive) await q.rollbackTransaction().catch(() => undefined);
      await q.release();
    }
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      AuditService,
      ReportRunLogService,
      ReportRegistry,
      RoleScopePolicy,
      ReportCompiler,
      ReportResultCache,
      ReportRunnerService,
      ReportRowSourceRegistry,
      { provide: TeacherScopeService, useValue: { sectionScope: async () => null } },
      { provide: TENANT_STATUS_REDIS, useValue: { get: async () => null, set: async () => 'OK' } },
    ]);
    ds = module.get(DataSource);
    runner = module.get(ReportRunnerService);
    compiler = module.get(ReportCompiler);
    fx = new ReportAreaFixture(ds);
  });

  beforeEach(async () => {
    a = await fx.school();
    b = await fx.school();
    for (const [tenant, n] of [
      [a, 2],
      [b, 3],
    ] as const) {
      const year = await fx.year(tenant);
      const klass = await fx.klass(tenant, year, 'Six', 6);
      for (let i = 0; i < n; i++) {
        const student = await fx.student(tenant, year, klass, { name: `S${i}` });
        await fx.bill(tenant, year, klass.classId, student, {
          total: 100,
          status: 'OVERDUE',
          dueDate: '2026-02-01',
        });
      }
    }
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  it('raw SQL with no WHERE sees only the named school, on a table with tenant_id', async () => {
    const [onlyA] = await asReportRole('SELECT count(*)::int AS n FROM students', a);
    const [onlyB] = await asReportRole('SELECT count(*)::int AS n FROM students', b);
    expect([onlyA.n, onlyB.n]).toEqual([2, 3]);
  });

  it('a table with no tenant_id of its own is walled through the student', async () => {
    const [feesA] = await asReportRole('SELECT count(*)::int AS n FROM student_fees', a);
    expect(feesA.n).toBe(2);
  });

  it('no school named, or an empty one, sees nothing and never errors', async () => {
    const [none] = await asReportRole('SELECT count(*)::int AS n FROM students', null);
    expect(none.n).toBe(0);
    const [empty] = await asReportRole('SELECT count(*)::int AS n FROM students', '');
    expect(empty.n).toBe(0);
  });

  it('the role is read-only and cannot read a table no area uses', async () => {
    await expect(asReportRole('DELETE FROM students', a)).rejects.toThrow();
    await expect(asReportRole('SELECT 1 FROM refresh_tokens LIMIT 1', a)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('every table an area reads has the grant, and a tenant policy where it can have one', async () => {
    const tables = new Map<string, { column: boolean }>();
    const rx = /(?:FROM|JOIN)\s+([a-z_]+)/g;
    for (const area of ALL_AREAS) {
      for (const e of [area.root, ...area.joins.map((j) => j.to)]) {
        tables.set(e.table, { column: e.tenantColumn === null && e.table === 'users' });
      }
      for (const text of [
        ...area.joins.map((j) => j.on),
        ...[...area.fields, ...area.measures].map((f) => f.sql),
      ]) {
        for (const m of text.matchAll(rx)) tables.set(m[1], { column: false });
      }
    }
    expect(tables.size).toBeGreaterThan(20);
    for (const [table, { column }] of tables) {
      const [row] = await ds.query(
        `SELECT has_table_privilege($1, $2, 'SELECT') AS whole,
                has_any_column_privilege($1, $2, 'SELECT') AS col,
                (SELECT relrowsecurity FROM pg_class WHERE oid = $2::regclass) AS rls,
                (SELECT count(*)::int FROM pg_policies
                  WHERE tablename = $3 AND policyname = 'report_tenant' AND roles = '{report_reader}') AS policies`,
        [REPORT_DB_ROLE, `public.${table}`, table],
      );
      if (column) {
        // `users` is global: column grant only, no row policy possible.
        expect(row.col, `${table} column grant`).toBe(true);
      } else {
        expect(row.whole, `${table} SELECT grant`).toBe(true);
        expect(row.rls, `${table} RLS enabled`).toBe(true);
        expect(row.policies, `${table} policy`).toBe(1);
      }
    }
  });

  it('every area runs end to end under the role: all fields as a list, all measures as counts', async () => {
    const definition = (
      area: ReportSubjectArea,
      dataset: Partial<ReportDefinitionJson['dataset']>,
    ): ReportDefinitionJson => ({
      schema: 1,
      subjectArea: area,
      parameters: [],
      dataset: { dimensions: [], measures: [], filters: [], sort: [], ...dataset },
      layout: { type: ReportLayoutType.TABLE },
      page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
      drill: [],
      calculated: [],
      format: [],
    });
    for (const area of ALL_AREAS) {
      const fields = definition(area.key, {
        dimensions: area.fields.map((f) => ({ field: f.key })),
      });
      const measures = definition(area.key, {
        measures: area.measures.map((m) => ({ field: m.key, fn: m.fn })),
      });
      for (const def of [fields, measures]) {
        const ctx = { tenantId: a, userId: 'u1', role: UserRole.ADMIN };
        const result = await runner.run({ ctx, definition: def, mode: 'PREVIEW' });
        expect(Array.isArray(result.rows), area.key).toBe(true);
        // The cursor path (exports, schedules) uses the same role.
        const compiled = await compiler.compile(def, {}, ctx, 50);
        const rows: unknown[] = [];
        for await (const row of runner.cursorRows(compiled, 10_000)) rows.push(row);
        expect(rows.length, area.key).toBe(result.rows.length);
      }
    }
  }, 120_000);

  it('a student count by the runner for school A equals the rows school A owns', async () => {
    const ctx = { tenantId: a, userId: 'u1', role: UserRole.ADMIN };
    const def: ReportDefinitionJson = {
      schema: 1,
      subjectArea: 'STUDENTS' as ReportSubjectArea,
      parameters: [],
      dataset: {
        dimensions: [{ field: 'name' }],
        measures: [],
        filters: [],
        sort: [{ field: 'name', dir: 'asc' }],
      },
      layout: { type: ReportLayoutType.TABLE },
      page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
      drill: [],
      calculated: [],
      format: [],
    };
    const result = await runner.run({ ctx, definition: def, mode: 'PREVIEW' });
    expect(result.rows).toHaveLength(2);
  });
});

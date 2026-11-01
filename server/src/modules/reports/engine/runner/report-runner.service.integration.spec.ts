import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AggregateFn,
  ReportDefinitionStatus,
  ReportLayoutType,
  ReportRunKind,
  ReportSubjectArea,
  UserRole,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { createTestModule } from '@test/helpers/module.helper';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../../audit/audit.service';
import { TeacherScopeService } from '../../../classes/teacher-scope.service';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { ReportDefinition } from '../../entities/report-definition.entity';
import { ReportDefinitionVersion } from '../../entities/report-definition-version.entity';
import { ReportRun } from '../../entities/report-run.entity';
import { ReportRowSourceRegistry } from '../../export/report-row-sources';
import { ReportRunLogService } from '../../export/report-run-log.service';
import { ReportCompiler } from '../compiler/report-compiler';
import { ReportRegistry } from '../registry/registry';
import { RoleScopePolicy } from '../security/role-scope.policy';
import { DEFINITION_SOURCE, DefinitionRowSource } from './definition-row-source';
import { ReportResultCache } from './report-result.cache';
import {
  PREVIEW_MAX_ROWS,
  RUN_PAGE_SIZE,
  ReportRunnerService,
  ReportTimeoutError,
} from './report-runner.service';

/**
 * [8.15.22] The runner against the real database. Business rules proved here: a report that is too
 * slow fails whole (never part of its rows), a report can never write, the result is cached for the
 * same query and role only, Redis down never stops a report, and COMMITTEE never sees a count under 5.
 */
describe('ReportRunnerService (integration)', () => {
  let ds: DataSource;
  let runner: ReportRunnerService;
  let compiler: ReportCompiler;
  let cache: ReportResultCache;
  let sources: ReportRowSourceRegistry;
  let fx: ReportAreaFixture;
  let tenantId: string;
  let year: string;
  let six: { classId: string; sectionId: string };

  /** An in-memory stand-in for Redis that can be switched off. */
  const store = new Map<string, string>();
  const redis = {
    down: false,
    get: vi.fn(async (key: string) => {
      if (redis.down) throw new Error('redis down');
      return store.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: string) => {
      if (redis.down) throw new Error('redis down');
      store.set(key, value);
      return 'OK';
    }),
  };

  const namesReport = (
    over: Partial<ReportDefinitionJson['dataset']> = {},
  ): ReportDefinitionJson => ({
    schema: 1,
    subjectArea: ReportSubjectArea.STUDENTS,
    parameters: [],
    dataset: {
      dimensions: [{ field: 'name' }],
      measures: [],
      filters: [],
      sort: [{ field: 'name', dir: 'asc' }],
      ...over,
    },
    layout: { type: ReportLayoutType.TABLE },
    page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
    drill: [],
    calculated: [],
    format: [],
  });
  const ctx = (role: UserRole = UserRole.ADMIN) => ({ tenantId, userId: SEED_ADMIN_USER_ID, role });

  async function manyStudents(n: number) {
    for (let i = 0; i < n; i++) {
      await fx.student(tenantId, year, six, { name: `Student ${String(i).padStart(4, '0')}` });
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
      { provide: TENANT_STATUS_REDIS, useValue: redis },
    ]);
    ds = module.get(DataSource);
    runner = module.get(ReportRunnerService);
    compiler = module.get(ReportCompiler);
    cache = module.get(ReportResultCache);
    sources = module.get(ReportRowSourceRegistry);
    fx = new ReportAreaFixture(ds);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    store.clear();
    redis.down = false;
    vi.clearAllMocks();
    tenantId = await fx.school();
    year = await fx.year(tenantId);
    six = await fx.klass(tenantId, year, 'Six', 6);
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  describe('caps and paging (D20)', () => {
    it('a RUN is paged 100 rows at a time and each page is a slice of the same result', async () => {
      await manyStudents(250);
      const first = await runner.run({
        ctx: ctx(),
        definition: namesReport(),
        mode: 'RUN',
        page: 1,
      });
      const last = await runner.run({
        ctx: ctx(),
        definition: namesReport(),
        mode: 'RUN',
        page: 3,
      });

      expect(RUN_PAGE_SIZE).toBe(100);
      expect(first).toMatchObject({ total_rows: 250, total_pages: 3, page: 1, truncated: false });
      expect(first.rows).toHaveLength(100);
      expect(first.rows[0]).toEqual({ name: 'Student 0000' });
      expect(last.rows).toHaveLength(50);
      expect(last.rows[49]).toEqual({ name: 'Student 0249' });
    }, 60_000);

    it('a PREVIEW stops at 500 rows and says it was cut short', async () => {
      await manyStudents(PREVIEW_MAX_ROWS + 10);
      const result = await runner.run({ ctx: ctx(), definition: namesReport(), mode: 'PREVIEW' });
      expect(result.rows).toHaveLength(PREVIEW_MAX_ROWS);
      expect(result.truncated).toBe(true);
    }, 120_000);

    it('a report shorter than the cap is not marked truncated', async () => {
      await manyStudents(3);
      const result = await runner.run({ ctx: ctx(), definition: namesReport(), mode: 'PREVIEW' });
      expect(result).toMatchObject({ truncated: false, total_rows: 3 });
    });
  });

  describe('guard rails', () => {
    it('a statement that runs past the timeout fails with REPORT_TOO_SLOW and returns no rows (D18)', async () => {
      let rows: unknown;
      await expect(
        runner.withReadOnlyTransaction(100, async (r) => {
          rows = await r.query('SELECT pg_sleep(3)');
          return rows;
        }),
      ).rejects.toBeInstanceOf(ReportTimeoutError);
      expect(rows).toBeUndefined();
    });

    it('answers a slow report with a 422 and the code the screen reads', async () => {
      const error = await runner
        .withReadOnlyTransaction(100, (r) => r.query('SELECT pg_sleep(3)'))
        .catch((e: ReportTimeoutError) => e);
      expect((error as ReportTimeoutError).getStatus()).toBe(422);
      expect((error as ReportTimeoutError).getResponse()).toMatchObject({
        details: { code: 'REPORT_TOO_SLOW' },
      });
    });

    it('can never write: an UPDATE inside the runner’s transaction fails and changes nothing', async () => {
      await fx.student(tenantId, year, six, { name: 'Untouched' });
      await expect(
        runner.withReadOnlyTransaction(1000, (r) =>
          r.query(`UPDATE students SET full_name = 'Hacked' WHERE tenant_id = $1`, [tenantId]),
        ),
      ).rejects.toThrow(/read-only transaction/);
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM students WHERE tenant_id = $1 AND full_name = 'Untouched'`,
        [tenantId],
      );
      expect(n).toBe(1);
    });

    it('refuses a saved report that belongs to another school', async () => {
      await expect(
        runner.run({ ctx: ctx(), versionId: '00000000-0000-4000-8000-0000000000aa', mode: 'RUN' }),
      ).rejects.toThrow('Report not found');
    });
  });

  describe('cache (D17)', () => {
    it('a second identical RUN is answered from the cache and skips the database', async () => {
      await manyStudents(5);
      const spy = vi.spyOn(runner, 'withReadOnlyTransaction');
      const first = await runner.run({ ctx: ctx(), definition: namesReport(), mode: 'RUN' });
      const second = await runner.run({ ctx: ctx(), definition: namesReport(), mode: 'RUN' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(second.rows).toEqual(first.rows);
      // Each RUN is still logged, cached or not.
      const runs = await ds
        .getRepository(ReportRun)
        .countBy({ tenant_id: tenantId, kind: ReportRunKind.RUN });
      expect(runs).toBe(2);
    });

    it('a PREVIEW is never cached', async () => {
      await manyStudents(2);
      await runner.run({ ctx: ctx(), definition: namesReport(), mode: 'PREVIEW' });
      await runner.run({ ctx: ctx(), definition: namesReport(), mode: 'PREVIEW' });
      expect(redis.set).not.toHaveBeenCalled();
      expect(await ds.getRepository(ReportRun).countBy({ tenant_id: tenantId })).toBe(0);
    });

    it('does not share an entry between roles or between schools', async () => {
      const compiled = async (role: UserRole, tenant = tenantId) =>
        compiler.compile(namesReport(), {}, { tenantId: tenant, userId: 'u1', role }, 501);
      const key = async (role: UserRole, tenant = tenantId) => {
        const [sql, params] = (await compiled(role, tenant)).query.getQueryAndParameters();
        return cache.key(tenant, null, sql, params, role);
      };
      expect(await key(UserRole.ADMIN)).not.toBe(await key(UserRole.ACCOUNTANT));
      expect(await key(UserRole.ADMIN)).not.toBe(await key(UserRole.ADMIN, await fx.school()));
    });

    it('with Redis down the report still runs, uncached', async () => {
      await manyStudents(3);
      redis.down = true;
      const result = await runner.run({ ctx: ctx(), definition: namesReport(), mode: 'RUN' });
      expect(result.total_rows).toBe(3);
    });
  });

  describe('who sees what', () => {
    it('hides a count under 5 from COMMITTEE, flags it, and leaves other roles alone', async () => {
      await manyStudents(3);
      const seven = await fx.klass(tenantId, year, 'Seven', 7);
      for (let i = 0; i < 6; i++) await fx.student(tenantId, year, seven, {});
      const report = namesReport({
        dimensions: [{ field: 'class' }],
        measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
        sort: [{ field: 'class', dir: 'asc' }],
      });

      const committee = await runner.run({
        ctx: ctx(UserRole.COMMITTEE),
        definition: report,
        mode: 'RUN',
      });
      expect(committee.rows).toEqual([
        { class: 'Seven', students: 6 },
        { class: 'Six', students: null },
      ]);
      expect(committee.suppressed).toBe(true);

      const admin = await runner.run({ ctx: ctx(), definition: report, mode: 'RUN' });
      expect(admin.rows).toEqual([
        { class: 'Seven', students: 6 },
        { class: 'Six', students: 3 },
      ]);
      expect(admin.suppressed).toBe(false);
    });

    it('reports which columns were left out for the runner’s role', async () => {
      await fx.student(tenantId, year, six, {});
      const result = await runner.run({
        ctx: ctx(UserRole.ACCOUNTANT),
        definition: namesReport({ dimensions: [{ field: 'name' }, { field: 'religion' }] }),
        mode: 'PREVIEW',
      });
      expect(result.masked).toEqual(['religion']);
      expect(result.columns.map((c) => c.key)).toEqual(['name']);
    });
  });

  describe('saved reports and queued exports', () => {
    async function publish(definition: ReportDefinitionJson): Promise<string> {
      const saved = await ds.getRepository(ReportDefinition).save(
        ds.getRepository(ReportDefinition).create({
          tenant_id: tenantId,
          key: `r-${Date.now()}`,
          name_en: 'R',
          name_bn: 'আর',
          status: ReportDefinitionStatus.PUBLISHED,
          visible_roles: [],
        }),
      );
      const version = await ds.getRepository(ReportDefinitionVersion).save(
        ds.getRepository(ReportDefinitionVersion).create({
          tenant_id: tenantId,
          definition_id: saved.id,
          version: 1,
          definition,
          schema_version: 1,
        }),
      );
      return version.id;
    }

    it('runs a saved report by its published version and records the version on the run', async () => {
      await manyStudents(2);
      const versionId = await publish(namesReport());
      const result = await runner.run({ ctx: ctx(), versionId, mode: 'RUN' });
      expect(result.total_rows).toBe(2);
      const run = await ds
        .getRepository(ReportRun)
        .findOneByOrFail({ id: result.run_id as string });
      expect(run.definition_version_id).toBe(versionId);
    });

    it('a tile run (maxRows, log false) is capped, never raised, and leaves no run row', async () => {
      await manyStudents(5);
      const versionId = await publish(namesReport());
      const tile = await runner.run({ ctx: ctx(), versionId, mode: 'RUN', maxRows: 3, log: false });
      expect(tile).toMatchObject({ total_rows: 3, truncated: true, run_id: null });
      // A cap above the mode's own is ignored.
      const big = await runner.run({ ctx: ctx(), versionId, mode: 'PREVIEW', maxRows: 1_000_000 });
      expect(big.rows).toHaveLength(5);
      expect(await ds.getRepository(ReportRun).countBy({ tenant_id: tenantId })).toBe(0);
    });

    it('a RUN that is too slow leaves a failed run row with REPORT_TOO_SLOW and no data (D24)', async () => {
      await manyStudents(1);
      const versionId = await publish(namesReport());
      const slow = vi
        .spyOn(runner as unknown as { resultSet: () => Promise<unknown> }, 'resultSet')
        .mockRejectedValueOnce(new ReportTimeoutError());
      await expect(runner.run({ ctx: ctx(), versionId, mode: 'RUN' })).rejects.toBeInstanceOf(
        ReportTimeoutError,
      );
      slow.mockRestore();
      const [row] = await ds.getRepository(ReportRun).findBy({ tenant_id: tenantId });
      expect(row).toMatchObject({ status: 'FAILED', error_code: 'REPORT_TOO_SLOW' });
      expect(row.row_count).toBe(0);
    });

    it('the queued-export source for a saved report gives the Bangla header and every row', async () => {
      await manyStudents(4);
      const versionId = await publish(namesReport());
      const source = new DefinitionRowSource(
        ds.getRepository(ReportDefinitionVersion),
        compiler,
        runner,
        sources,
      );
      source.onModuleInit();

      const registered = sources.get(DEFINITION_SOURCE);
      const query = { versionId, role: UserRole.ADMIN, params: {} };
      expect(await registered?.header(tenantId, 'u1', query)).toEqual(['শিক্ষার্থীর নাম']);
      const rows: unknown[][] = [];
      for await (const row of registered!.rows(tenantId, 'u1', query)) rows.push(row);
      expect(rows).toEqual([
        ['Student 0000'],
        ['Student 0001'],
        ['Student 0002'],
        ['Student 0003'],
      ]);
    });
  });
});

import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AggregateFn,
  ReportDefinitionStatus,
  ReportLayoutType,
  ReportSubjectArea,
  SchoolStatus,
  UserRole,
  type JwtPayload,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { createTestModule } from '@test/helpers/module.helper';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../audit/audit.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { ReportDefinition } from './entities/report-definition.entity';
import { ReportDefinitionVersion } from './entities/report-definition-version.entity';
import { ReportRun } from './entities/report-run.entity';
import { ReportCompiler } from './engine/compiler/report-compiler';
import { ReportRegistry } from './engine/registry/registry';
import { ReportResultCache } from './engine/runner/report-result.cache';
import { ReportRunnerService } from './engine/runner/report-runner.service';
import { RoleScopePolicy } from './engine/security/role-scope.policy';
import { ReportRowSourceRegistry } from './export/report-row-sources';
import { ReportRunLogService } from './export/report-run-log.service';
import {
  CrossBranchCountsService,
  NotCountableAcrossBranchesError,
} from './cross-branch-counts.service';

/**
 * [#3516, D13] Counts across the branches a person belongs to. Proved against the real database:
 * the total is the sum of what each branch shows its own caller, another school is never read,
 * a branch the caller may not run reports in is left out, a hidden small count stays hidden in the
 * total, and the run is audited in the school it was asked from.
 */
describe('CrossBranchCountsService (integration)', () => {
  let ds: DataSource;
  let runner: ReportRunnerService;
  let runLog: ReportRunLogService;
  let fx: ReportAreaFixture;
  let a: string;
  let b: string;
  let stranger: string;
  let statuses: Record<string, SchoolStatus>;
  let teacherScoped: Set<string>;
  let catalogueIds: string[];
  let definition: ReportDefinitionJson;
  let visibleRoles: string[];
  let VERSION_ID: string;

  const countReport = (over: Partial<ReportDefinitionJson> = {}): ReportDefinitionJson => ({
    schema: 1,
    subjectArea: ReportSubjectArea.STUDENTS,
    parameters: [],
    dataset: {
      dimensions: [],
      measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
      filters: [],
      sort: [],
    },
    layout: { type: ReportLayoutType.TABLE },
    page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
    drill: [],
    calculated: [],
    format: [],
    ...over,
  });

  const service = () =>
    new CrossBranchCountsService(
      runner,
      {
        catalogue: async () => [
          {
            folder: null,
            reports: catalogueIds.map((id) => ({ id, version_id: VERSION_ID })),
          },
        ],
      } as never,
      {
        platformTenantId: async () => undefined,
        getStatus: async (id: string) => statuses[id] ?? SchoolStatus.ACTIVE,
      } as never,
      runLog,
      { findOne: async () => ({ visible_roles: visibleRoles }) } as never,
      { findOne: async () => ({ id: VERSION_ID, definition }) } as never,
    );

  const user = (memberships: Array<{ tenantId: string; role: UserRole }>): JwtPayload =>
    ({ sub: SEED_ADMIN_USER_ID, email: null, phone: null, memberships }) as unknown as JwtPayload;

  const call = (
    from: string,
    memberships: Array<{ tenantId: string; role: UserRole }>,
    role: UserRole = UserRole.ADMIN,
    definitionId = 'd1',
  ) =>
    service().run({
      tenant: { id: from, role },
      user: user(memberships),
      definitionId,
    });

  async function students(tenant: string, n: number) {
    const year = await fx.year(tenant);
    const klass = await fx.klass(tenant, year, 'Six', 6);
    for (let i = 0; i < n; i++) await fx.student(tenant, year, klass, { name: `S${i}` });
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
      {
        provide: TeacherScopeService,
        useValue: {
          sectionScope: async (c: { role: string; tenantId: string }) =>
            c.role === UserRole.TEACHER && teacherScoped.has(c.tenantId) ? [] : null,
        },
      },
      {
        provide: TENANT_STATUS_REDIS,
        useValue: { get: async () => null, set: async () => 'OK' },
      },
    ]);
    ds = module.get(DataSource);
    runner = module.get(ReportRunnerService);
    runLog = module.get(ReportRunLogService);
    fx = new ReportAreaFixture(ds);
  });

  beforeEach(async () => {
    statuses = {};
    teacherScoped = new Set();
    catalogueIds = ['d1'];
    visibleRoles = [];
    definition = countReport();
    a = await fx.school();
    b = await fx.school();
    stranger = await fx.school();
    await students(a, 6);
    await students(b, 7);
    await students(stranger, 9);
    // The audit row points at a real version of this school's report.
    const saved = await ds.getRepository(ReportDefinition).save(
      ds.getRepository(ReportDefinition).create({
        tenant_id: a,
        key: 'r-branch',
        name_en: 'R',
        name_bn: 'আর',
        status: ReportDefinitionStatus.PUBLISHED,
        visible_roles: [],
      }),
    );
    VERSION_ID = (
      await ds.getRepository(ReportDefinitionVersion).save(
        ds.getRepository(ReportDefinitionVersion).create({
          tenant_id: a,
          definition_id: saved.id,
          version: 1,
          definition,
          schema_version: 1,
        }),
      )
    ).id;
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  const both = () => [
    { tenantId: a, role: UserRole.ADMIN },
    { tenantId: b, role: UserRole.ADMIN },
  ];

  it('adds the branches the caller belongs to, and never reads a school they are not in', async () => {
    const result = await call(a, both());
    expect(result.branches.map((x) => [x.branch_id, Number(x.rows[0].students)])).toEqual([
      [a, 6],
      [b, 7],
    ]);
    expect(result.totals).toEqual([{ students: 13 }]); // not 22: the stranger school is not counted
  });

  it('groups by a dimension and adds row by row', async () => {
    definition = countReport({
      dataset: {
        dimensions: [{ field: 'class' }],
        measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
        filters: [],
        sort: [],
      },
    });
    const result = await call(a, both());
    expect(result.totals).toEqual([{ class: 'Six', students: 13 }]);
  });

  it('leaves out a suspended branch and a branch where the role may not open reports', async () => {
    statuses[b] = SchoolStatus.SUSPENDED;
    expect((await call(a, both())).branches.map((x) => x.branch_id)).toEqual([a]);
    statuses = {};
    const parentInB = [
      { tenantId: a, role: UserRole.ADMIN },
      { tenantId: b, role: UserRole.PARENT },
    ];
    expect((await call(a, parentInB)).branches.map((x) => x.branch_id)).toEqual([a]);
  });

  it('leaves out a branch where the report is hidden from the caller’s role there', async () => {
    visibleRoles = [UserRole.ADMIN];
    const accountantInB = [
      { tenantId: a, role: UserRole.ADMIN },
      { tenantId: b, role: UserRole.ACCOUNTANT },
    ];
    expect((await call(a, accountantInB)).branches.map((x) => x.branch_id)).toEqual([a]);
  });

  it('applies each branch’s own row scope: a teacher with no section there adds nothing', async () => {
    teacherScoped.add(b);
    const teacher = [
      { tenantId: a, role: UserRole.TEACHER },
      { tenantId: b, role: UserRole.TEACHER },
    ];
    const result = await call(a, teacher, UserRole.TEACHER);
    expect(result.totals).toEqual([{ students: 6 }]);
  });

  it('a count hidden from a committee member in one branch hides the total', async () => {
    const small = await fx.school();
    await students(small, 3); // under 5: a committee member sees an empty cell
    const committee = [
      { tenantId: b, role: UserRole.COMMITTEE },
      { tenantId: small, role: UserRole.COMMITTEE },
    ];
    const result = await call(b, committee, UserRole.COMMITTEE);
    expect(result.suppressed).toBe(true);
    expect(result.totals).toEqual([{ students: null }]);
  });

  it('refuses a report that is not counts only, or that asks questions', async () => {
    definition = countReport({
      dataset: {
        dimensions: [],
        measures: [{ field: 'students', fn: AggregateFn.MAX }],
        filters: [],
        sort: [],
      },
    });
    await expect(call(a, both())).rejects.toBeInstanceOf(NotCountableAcrossBranchesError);
    definition = countReport({
      parameters: [{ key: 'year', type: 'ACADEMIC_YEAR', label_en: 'Y', label_bn: 'Y' } as never],
    });
    await expect(call(a, both())).rejects.toBeInstanceOf(NotCountableAcrossBranchesError);
  });

  it('answers one 404 for a report that is not in this school’s catalogue', async () => {
    catalogueIds = [];
    await expect(call(a, both())).rejects.toThrow('Report not found');
  });

  it('writes one audit row, in the school it was asked from', async () => {
    await call(a, both());
    const rows = await ds.getRepository(ReportRun).find();
    expect(rows.map((r) => r.tenant_id)).toEqual([a]);
  });
});

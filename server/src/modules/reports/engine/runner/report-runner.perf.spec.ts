import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AggregateFn,
  FilterOp,
  ReportLayoutType,
  ReportSubjectArea,
  UserRole,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { seedLoadSchool } from '../../../../scripts/load/seed-load-10k';
import { AuditService } from '../../../audit/audit.service';
import { TeacherScopeService } from '../../../classes/teacher-scope.service';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { ReportRowSourceRegistry } from '../../export/report-row-sources';
import { ReportRunLogService } from '../../export/report-run-log.service';
import { SYSTEM_REPORTS } from '../../system/system-reports';
import { ReportCompiler } from '../compiler/report-compiler';
import { ReportRegistry } from '../registry/registry';
import { RoleScopePolicy } from '../security/role-scope.policy';
import { ReportResultCache } from './report-result.cache';
import { RUN_MAX_ROWS, ReportRunnerService } from './report-runner.service';

/**
 * [8.15.48] Load test of the reports: a 3,000-student school, the five ready reports and three
 * designer-shaped reports, each run many times through the real runner. The target is p95 < 2 s.
 *
 * Nightly only. `describe.skipIf` keeps it out of every normal run (the file name matches the
 * unit and integration patterns, so the flag is the gate):
 *
 *   REPORT_PERF=1 REPORT_PERF_OUT=/tmp/report-perf bash -c 'cd server && npx vitest run report-runner.perf'
 *
 * With `REPORT_PERF_OUT` set it also writes `<name>.plan.txt` (EXPLAIN ANALYZE, BUFFERS) and
 * `summary.md` there. Doc: docs/architecture/33-reporting-load-test.md.
 *
 * The school is seeded with the load-test seed, among other schools of 1,000 students: an index
 * that starts with `tenant_id` only pays off when the school is a part of the table, never all of it.
 */
const ENABLED = process.env.REPORT_PERF === '1';
const RUNS = Number(process.env.REPORT_PERF_RUNS ?? 30);
const TARGET_STUDENTS = 3_000;
const NOISE_SCHOOLS = Number(process.env.REPORT_PERF_NOISE_SCHOOLS ?? 12);
const NOISE_STUDENTS = 1_000;
const P95_LIMIT_MS = 2_000;
const OUT = process.env.REPORT_PERF_OUT;

interface Case {
  name: string;
  area: ReportSubjectArea;
  def: () => ReportDefinitionJson;
  /** The answers to the report's questions, given the school's current year name. */
  values?: (yearName: string) => Record<string, unknown>;
}

const page = { title_en: 'T', title_bn: 'T', orientation: 'portrait' as const };
const designer = (
  subjectArea: ReportSubjectArea,
  dataset: ReportDefinitionJson['dataset'],
): ReportDefinitionJson => ({
  schema: 1,
  subjectArea,
  parameters: [],
  dataset,
  layout: { type: ReportLayoutType.TABLE },
  page,
  drill: [],
  calculated: [],
  format: [],
});

const CASES: Case[] = [
  ...SYSTEM_REPORTS.map((r): Case => ({
    name: r.key,
    area: r.definition.subjectArea,
    def: () => r.definition,
    // The BANBEIS count asks for the year (by its name); the others run with no choice made.
    values: (yearName) => (r.key === 'student-count-banbeis' ? { academic_year: yearName } : {}),
  })),
  {
    name: 'designer-students-by-class-gender',
    area: ReportSubjectArea.STUDENTS,
    def: () =>
      designer(ReportSubjectArea.STUDENTS, {
        dimensions: [{ field: 'class' }, { field: 'gender' }],
        measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
        filters: [{ field: 'status', op: FilterOp.EQ, value: 'ACTIVE' }],
        sort: [{ field: 'class', dir: 'asc' }],
      }),
  },
  {
    name: 'designer-dues-by-class-section',
    area: ReportSubjectArea.FEES,
    def: () =>
      designer(ReportSubjectArea.FEES, {
        dimensions: [{ field: 'class' }, { field: 'section' }],
        measures: [{ field: 'outstanding', fn: AggregateFn.SUM }],
        filters: [{ field: 'status', op: FilterOp.IN, value: ['PENDING', 'PARTIALLY_PAID'] }],
        sort: [
          { field: 'class', dir: 'asc' },
          { field: 'section', dir: 'asc' },
        ],
      }),
  },
  {
    name: 'designer-payments-by-day-method',
    area: ReportSubjectArea.PAYMENTS,
    def: () =>
      designer(ReportSubjectArea.PAYMENTS, {
        dimensions: [{ field: 'payment_date' }, { field: 'method' }],
        measures: [{ field: 'net', fn: AggregateFn.SUM }],
        filters: [],
        sort: [{ field: 'payment_date', dir: 'desc' }],
      }),
  },
];

/** Nearest-rank percentile of a list of milliseconds. */
export function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

describe.skipIf(!ENABLED)('report runner load test (3,000 students)', () => {
  let ds: DataSource;
  let runner: ReportRunnerService;
  let compiler: ReportCompiler;

  // No Redis: every run reads the database. A cached answer would measure nothing.
  const noCache = { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') };

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
      { provide: TENANT_STATUS_REDIS, useValue: noCache },
    ]);
    ds = module.get(DataSource);
    runner = module.get(ReportRunnerService);
    compiler = module.get(ReportCompiler);
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
  });

  /** One school by the load seed, then renamed so the seed can run again for the next one. */
  async function seedSchool(n: number, students: number): Promise<string> {
    const r = await seedLoadSchool(ds, {
      students,
      password: 'perf-test-pass1',
      today: new Date().toISOString().slice(0, 10),
    });
    if (r.status !== 'seeded') throw new Error('seed refused');
    await ds.query(`UPDATE schools SET slug = $1 WHERE id = $2`, [`perf-school-${n}`, r.tenantId]);
    await ds.query(
      `UPDATE users SET email = 'p' || $1::text || '-' || email WHERE email LIKE '%@biddaloy.test' AND email NOT LIKE 'p%-%'`,
      [n],
    );
    return r.tenantId;
  }

  /** What the load seed leaves empty and these reports read: gender, religion, public exams, designations. */
  async function topUp(tenantId: string): Promise<void> {
    await ds.query(
      `UPDATE students SET gender = CASE WHEN abs(hashtext(id::text)) % 100 < 52 THEN 'MALE' ELSE 'FEMALE' END,
              religion = CASE WHEN abs(hashtext(id::text)) % 100 < 85 THEN 'ISLAM' ELSE 'HINDUISM' END
        WHERE tenant_id = $1`,
      [tenantId],
    );
    await ds.query(
      `INSERT INTO student_public_exams (tenant_id, student_id, exam_type, board, roll_no, registration_no, gpa, passing_year)
       SELECT tenant_id, id, (ARRAY['PSC','JSC','SSC'])[1 + abs(hashtext(id::text)) % 3]::student_public_exams_exam_type_enum,
              'Dhaka', 'R' || registration_number, registration_number,
              CASE WHEN abs(hashtext(id::text)) % 10 = 0 THEN NULL ELSE 2 + (abs(hashtext(id::text)) % 300) / 100.0 END,
              2020 + abs(hashtext(id::text)) % 6
         FROM students WHERE tenant_id = $1 AND abs(hashtext(id::text)) % 3 = 0`,
      [tenantId],
    );
    await ds.query(
      `INSERT INTO designations (tenant_id, title_en, title_bn, is_teaching)
       VALUES ($1, 'Assistant Teacher', 'সহকারী শিক্ষক', true), ($1, 'Office Assistant', 'অফিস সহায়ক', false)`,
      [tenantId],
    );
    await ds.query(
      `INSERT INTO staff_designation_history (tenant_id, user_id, designation_id, effective_date, status)
       SELECT sp.tenant_id, sp.user_id,
              (SELECT d.id FROM designations d WHERE d.tenant_id = sp.tenant_id
                ORDER BY d.title_en LIMIT 1 OFFSET abs(hashtext(sp.id::text)) % 2),
              '2020-01-01', 'REGULAR'
         FROM staff_profiles sp WHERE sp.tenant_id = $1`,
      [tenantId],
    );
  }

  it(`every report runs under ${P95_LIMIT_MS} ms at p95`, async () => {
    const started = Date.now();
    let tenantId = '';
    const sizes = [
      ...Array(Math.floor(NOISE_SCHOOLS / 2)).fill(NOISE_STUDENTS),
      TARGET_STUDENTS,
      ...Array(Math.ceil(NOISE_SCHOOLS / 2)).fill(NOISE_STUDENTS),
    ] as number[];
    for (let i = 0; i < sizes.length; i++) {
      const id = await seedSchool(i, sizes[i]);
      await topUp(id);
      if (sizes[i] === TARGET_STUDENTS) tenantId = id;
    }
    await ds.query('VACUUM ANALYZE');
    const [{ c: students }] = await ds.query(
      `SELECT count(*)::int c FROM students WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(students).toBe(TARGET_STUDENTS);
    const [{ c: allStudents }] = await ds.query(`SELECT count(*)::int c FROM students`);
    const [{ name: yearName }] = await ds.query(
      `SELECT name FROM academic_years WHERE tenant_id = $1 AND is_current`,
      [tenantId],
    );
    console.log(
      `perf seed: ${((Date.now() - started) / 1000).toFixed(0)} s, ${students} of ${allStudents} students`,
    );
    if (OUT) mkdirSync(OUT, { recursive: true });

    const ctx = { tenantId, userId: 'perf', role: UserRole.ADMIN };
    const rows: string[] = [
      '| report | rows | p50 ms | p95 ms | max ms | result |',
      '| --- | ---: | ---: | ---: | ---: | --- |',
    ];
    const slow: string[] = [];

    for (const c of CASES) {
      const definition = c.def();
      const values = c.values?.(yearName) ?? {};

      if (OUT) {
        // The statement production runs: the compiler's own SQL, in a read-only transaction.
        const compiled = await compiler.compile(definition, values, ctx, RUN_MAX_ROWS + 1);
        const [sql, params] = compiled.query.getQueryAndParameters();
        const plan: Array<Record<string, string>> = await runner.withReadOnlyTransaction(
          15_000,
          (q) => q.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params),
        );
        writeFileSync(
          join(OUT, `${c.name}.plan.txt`),
          `${sql}\n-- params: ${JSON.stringify(params)}\n\n${plan.map((r) => r['QUERY PLAN']).join('\n')}\n`,
        );
      }

      // Two warm-up runs (plan and page cache), then RUNS timed runs of the whole runner path.
      const request = { ctx, definition, params: values, mode: 'RUN' as const, log: false };
      await runner.run(request);
      await runner.run(request);
      const ms: number[] = [];
      let total = 0;
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now();
        const result = await runner.run(request);
        ms.push(performance.now() - t0);
        total = result.total_rows;
      }
      const p95 = percentile(ms, 95);
      const ok = p95 < P95_LIMIT_MS;
      if (!ok) slow.push(`${c.name} p95 ${p95.toFixed(0)} ms`);
      rows.push(
        `| ${c.name} | ${total} | ${percentile(ms, 50).toFixed(0)} | ${p95.toFixed(0)} | ${Math.max(...ms).toFixed(0)} | ${ok ? 'PASS' : 'FAIL'} |`,
      );
    }

    const summary = rows.join('\n');
    console.log(`\n${summary}\n`);
    if (OUT) writeFileSync(join(OUT, 'summary.md'), `${summary}\n`);
    expect(slow).toEqual([]);
  }, 900_000);
});

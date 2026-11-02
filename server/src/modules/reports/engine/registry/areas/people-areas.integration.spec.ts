import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FilterOp,
  ReportLayoutType,
  ReportSubjectArea,
  UserRole,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import { ALL_ENTITIES } from '@test/all-entities';
import type { TeacherScopeService } from '../../../../classes/teacher-scope.service';
import { ReportCompiler } from '../../compiler/report-compiler';
import { RoleScopePolicy } from '../../security/role-scope.policy';
import { ReportRegistry } from '../registry';
import { ALL_AREAS } from './index';

/**
 * [8.15.20] The people areas against the real database: the fields run as written, a count equals a
 * hand-written count, and the runner's role decides what is shown. The last test runs EVERY field
 * and measure of EVERY area once, so a typo in any SQL fragment fails here, not in front of a user.
 */
describe('report areas: students, staff, public exams (integration)', () => {
  let ds: DataSource;
  let fx: ReportAreaFixture;
  let tenantId: string;
  let sectionsOfTeacher: string[] | null = null;
  let classSix: { classId: string; sectionId: string };
  let classSeven: { classId: string; sectionId: string };

  const compiler = () =>
    new ReportCompiler(
      ds,
      new ReportRegistry(),
      new RoleScopePolicy({
        sectionScope: async () => sectionsOfTeacher,
      } as unknown as TeacherScopeService),
    );

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

  const run = async (def: ReportDefinitionJson, role: UserRole) => {
    const compiled = await compiler().compile(def, {}, { tenantId, userId: 'u1', role }, 500);
    return { compiled, rows: await compiled.query.getRawMany<Record<string, unknown>>() };
  };

  beforeAll(async () => {
    ds = (await createTestModule(ALL_ENTITIES, [])).get(DataSource);
    fx = new ReportAreaFixture(ds);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    sectionsOfTeacher = null;
    tenantId = await fx.school();
    const year = await fx.year(tenantId);
    classSix = await fx.klass(tenantId, year, 'Six', 6);
    classSeven = await fx.klass(tenantId, year, 'Seven', 7);
    for (let i = 0; i < 3; i++) await fx.student(tenantId, year, classSix, { gender: 'MALE' });
    for (let i = 0; i < 2; i++) await fx.student(tenantId, year, classSix, { gender: 'FEMALE' });
    for (let i = 0; i < 4; i++) await fx.student(tenantId, year, classSeven, { gender: 'FEMALE' });
    await fx.student(tenantId, year, classSeven, { gender: 'MALE', status: 'TRANSFERRED' });
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  it('class × gender counts equal a hand-written SQL count', async () => {
    const { rows } = await run(
      definition(ReportSubjectArea.STUDENTS, {
        dimensions: [{ field: 'class' }, { field: 'gender' }],
        measures: [{ field: 'students', fn: 'COUNT_DISTINCT' as never }],
        sort: [
          { field: 'class', dir: 'asc' },
          { field: 'gender', dir: 'asc' },
        ],
      }),
      UserRole.ADMIN,
    );
    const hand: Array<{ class: string; gender: string; n: string }> = await ds.query(
      `SELECT c.name AS class, s.gender, COUNT(*)::text AS n
         FROM enrollments e JOIN students s ON s.id = e.student_id JOIN classes c ON c.id = e.class_id
        WHERE e.tenant_id = $1 GROUP BY c.name, s.gender ORDER BY c.name, s.gender`,
      [tenantId],
    );
    expect(rows.map((r) => [r.class, r.gender, Number(r.students)])).toEqual(
      hand.map((h) => [h.class, h.gender, Number(h.n)]),
    );
  });

  it('a status filter narrows to active enrolments', async () => {
    const { rows } = await run(
      definition(ReportSubjectArea.STUDENTS, {
        measures: [{ field: 'students', fn: 'COUNT_DISTINCT' as never }],
        filters: [{ field: 'status', op: FilterOp.EQ, value: 'ACTIVE' }],
      }),
      UserRole.ADMIN,
    );
    expect(Number(rows[0].students)).toBe(3 + 2 + 4); // the transferred student is left out
  });

  it('shows one row per student with the main guardian, and hides the phone from a role without GUARDIAN_READ', async () => {
    const [{ id: studentId }] = await ds.query(
      `SELECT s.id FROM students s WHERE s.tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    await fx.guardian(tenantId, studentId, {
      name: 'Second',
      phone: '01700000002',
      primary: false,
    });
    await fx.guardian(tenantId, studentId, { name: 'Main', phone: '01700000001', primary: true });

    const def = definition(ReportSubjectArea.STUDENTS, {
      dimensions: [{ field: 'name' }, { field: 'guardian_name' }, { field: 'guardian_phone' }],
    });
    const admin = await run(def, UserRole.ADMIN);
    expect(admin.rows).toHaveLength(10); // one row per enrolment: two guardians do not double a student
    expect(admin.rows.filter((r) => r.guardian_name === 'Main')).toHaveLength(1);
    expect(admin.rows.find((r) => r.guardian_name === 'Main')?.guardian_phone).toBe('01700000001');

    // An EXECUTIVE has no GUARDIAN_READ, so neither guardian column is shown.
    const executive = await run(def, UserRole.EXECUTIVE);
    expect(executive.compiled.masked.sort()).toEqual(['guardian_name', 'guardian_phone']);
    expect(Object.keys(executive.rows[0])).toEqual(['name']);
  });

  it('a TEACHER sees only the students of their sections', async () => {
    sectionsOfTeacher = [classSix.sectionId];
    const { rows } = await run(
      definition(ReportSubjectArea.STUDENTS, {
        dimensions: [{ field: 'class' }],
        measures: [{ field: 'students', fn: 'COUNT_DISTINCT' as never }],
      }),
      UserRole.TEACHER,
    );
    expect(rows.map((r) => [r.class, Number(r.students)])).toEqual([['Six', 5]]);
  });

  it('religion is shown to ADMIN only', async () => {
    const def = definition(ReportSubjectArea.STUDENTS, {
      dimensions: [{ field: 'class' }, { field: 'religion' }],
    });
    expect((await run(def, UserRole.ADMIN)).compiled.masked).toEqual([]);
    expect((await run(def, UserRole.ACCOUNTANT)).compiled.masked).toEqual(['religion']);
  });

  it('public exams: passed counts a GPA above 0, in the student’s class', async () => {
    const [{ id: a }, { id: b }, { id: c }] = await ds.query(
      `SELECT s.id FROM students s WHERE s.tenant_id = $1 ORDER BY s.created_at LIMIT 3`,
      [tenantId],
    );
    await fx.publicExam(tenantId, a, { exam: 'JSC', year: 2025, gpa: 4.5 });
    await fx.publicExam(tenantId, b, { exam: 'JSC', year: 2025, gpa: 0 });
    await fx.publicExam(tenantId, c, { exam: 'JSC', year: 2025, gpa: null });

    const { rows } = await run(
      definition(ReportSubjectArea.PUBLIC_EXAMS, {
        dimensions: [{ field: 'exam' }],
        measures: [
          { field: 'exams', fn: 'COUNT' as never },
          { field: 'passed', fn: 'COUNT' as never },
        ],
      }),
      UserRole.ADMIN,
    );
    expect(rows.map((r) => [r.exam, Number(r.exams), Number(r.passed)])).toEqual([['JSC', 3, 1]]);
  });

  it('staff: one row per profile with the open designation, and closed to a TEACHER', async () => {
    const [{ id: userId }] = await ds.query(
      `INSERT INTO users (email, full_name, password_hash) VALUES ($1, 'Rahim', 'x') RETURNING id`,
      [`staff-${Date.now()}@example.test`],
    );
    await ds.query(
      `INSERT INTO staff_profiles (user_id, tenant_id, employee_id) VALUES ($1, $2, 'E-1')`,
      [userId, tenantId],
    );
    const [{ id: designationId }] = await ds.query(
      `INSERT INTO designations (tenant_id, title_en, title_bn, is_teaching) VALUES ($1, 'Teacher', 'শিক্ষক', true) RETURNING id`,
      [tenantId],
    );
    await ds.query(
      `INSERT INTO staff_designation_history (tenant_id, user_id, designation_id, effective_date, status)
       VALUES ($1, $2, $3, '2026-01-01', 'REGULAR')`,
      [tenantId, userId, designationId],
    );

    const def = definition(ReportSubjectArea.STAFF, {
      dimensions: [{ field: 'name' }, { field: 'designation_bn' }, { field: 'staff_type' }],
    });
    const { rows } = await run(def, UserRole.ADMIN);
    expect(rows).toEqual([{ name: 'Rahim', designation_bn: 'শিক্ষক', staff_type: 'TEACHING' }]);

    sectionsOfTeacher = [classSix.sectionId];
    await expect(run(def, UserRole.TEACHER)).rejects.toThrow('You cannot run this report.');
  });

  it('calculated fields run on the database: text built from fields, a total, a percentage and a day count', async () => {
    const calculated = (key: string, expression: string) => ({
      key,
      label_en: key,
      label_bn: key,
      expression,
    });
    const def = definition(ReportSubjectArea.STUDENTS, {
      dimensions: [{ field: 'class' }, { field: 'label' }],
      sort: [{ field: 'label', dir: 'asc' }],
      filters: [{ field: 'class', op: FilterOp.EQ, value: 'Seven' }],
    });
    def.calculated = [
      calculated('label', "concat([class], ' / ', [gender])"),
      calculated('same_day', 'days_between([birth_date], [birth_date])'),
      calculated('girls_pct', "pct(if([gender] = 'FEMALE', 1, 0), 1)"),
    ];
    const { rows } = await run(def, UserRole.ADMIN);
    // Seven has 4 girls and 1 transferred boy; only the active enrolment-status filter is absent here.
    expect(rows.map((r) => r.label)).toEqual([
      'Seven / FEMALE',
      'Seven / FEMALE',
      'Seven / FEMALE',
      'Seven / FEMALE',
      'Seven / MALE',
    ]);

    const total = definition(ReportSubjectArea.STUDENTS, {
      measures: [
        { field: 'girls_pct', fn: 'AVG' as never },
        { field: 'same_day', fn: 'MAX' as never },
      ],
      filters: [{ field: 'class', op: FilterOp.EQ, value: 'Seven' }],
    });
    total.calculated = def.calculated;
    const [row] = (await run(total, UserRole.ADMIN)).rows;
    expect(Number(row.girls_pct)).toBeCloseTo(80, 5); // 4 of 5 are girls
    expect(row.same_day).toBeNull(); // no birth dates were recorded: a day count of nothing is nothing
  });

  it('every field and every measure of every area runs against the database', async () => {
    const registry = new ReportRegistry();
    for (const area of ALL_AREAS) {
      for (const field of registry.area(area.key)?.fields ?? []) {
        await run(
          definition(area.key, { dimensions: [{ field: field.key }], limit: 5 }),
          UserRole.ADMIN,
        );
      }
      for (const measure of area.measures) {
        await run(
          definition(area.key, { measures: [{ field: measure.key, fn: measure.fn }] }),
          UserRole.ADMIN,
        );
      }
      // Every measure together, split by the first field that can be split by.
      const splitBy = area.fields.find((f) => f.groupable);
      if (splitBy) {
        await run(
          definition(area.key, {
            dimensions: [{ field: splitBy.key }],
            measures: area.measures.map((m) => ({ field: m.key, fn: m.fn })),
          }),
          UserRole.ADMIN,
        );
      }
    }
  }, 120_000);
});

import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AggregateFn,
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

/**
 * [#3523] Final results, programs and applications against the real database: the numbers equal a
 * hand-written count, a TEACHER sees only their sections, a role without the screen's permission
 * is refused, tenant data never crosses, and an unpublished result or a letter never shows.
 */
describe('report areas: final results, programs, applications (integration)', () => {
  let ds: DataSource;
  let fx: ReportAreaFixture;
  let tenantId: string;
  let year: string;
  let six: { classId: string; sectionId: string };
  let seven: { classId: string; sectionId: string };
  let a: string;
  let b: string;
  let c: string;
  let teacherSections: string[] | null = null;

  const compiler = () =>
    new ReportCompiler(
      ds,
      new ReportRegistry(),
      new RoleScopePolicy({
        sectionScope: async () => teacherSections,
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

  const run = async (def: ReportDefinitionJson, role = UserRole.ADMIN, tenant = tenantId) => {
    const compiled = await compiler().compile(
      def,
      {},
      { tenantId: tenant, userId: 'u1', role },
      500,
    );
    return { compiled, rows: await compiled.query.getRawMany<Record<string, unknown>>() };
  };

  beforeAll(async () => {
    ds = (await createTestModule(ALL_ENTITIES, [])).get(DataSource);
    fx = new ReportAreaFixture(ds);
  });

  beforeEach(async () => {
    teacherSections = null;
    tenantId = await fx.school();
    year = await fx.year(tenantId);
    six = await fx.klass(tenantId, year, 'Six', 6);
    seven = await fx.klass(tenantId, year, 'Seven', 7);
    a = await fx.student(tenantId, year, six, { name: 'A' });
    b = await fx.student(tenantId, year, six, { name: 'B' });
    c = await fx.student(tenantId, year, seven, { name: 'C' });
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  describe('final results', () => {
    beforeEach(async () => {
      const fin = await fx.finalResult(tenantId, year, six.classId);
      await fx.finalResultRow(tenantId, fin, a, six.sectionId, { gpa: 5, grade: 'A+', total: 900 });
      await fx.finalResultRow(tenantId, fin, b, six.sectionId, {
        gpa: 0,
        grade: 'F',
        total: 120,
        fail: true,
      });
      const finSeven = await fx.finalResult(tenantId, year, seven.classId);
      await fx.finalResultRow(tenantId, finSeven, c, seven.sectionId, {
        gpa: 4,
        grade: 'A',
        total: 700,
      });
    });

    it('counts, failures and average GPA equal a hand-written query', async () => {
      const { rows } = await run(
        definition(ReportSubjectArea.FINAL_RESULTS, {
          dimensions: [{ field: 'class' }],
          measures: [
            { field: 'students', fn: AggregateFn.COUNT_DISTINCT },
            { field: 'failed', fn: AggregateFn.COUNT },
            { field: 'average_gpa', fn: AggregateFn.AVG },
          ],
          sort: [{ field: 'class', dir: 'asc' }],
        }),
      );
      const hand: Array<{ n: string; f: string; g: string }> = await ds.query(
        `SELECT COUNT(*)::text n, COUNT(*) FILTER (WHERE r.is_fail)::text f, AVG(r.gpa)::text g
           FROM final_result_rows r JOIN final_results fr ON fr.id = r.final_result_id
           JOIN classes c ON c.id = fr.class_id
          WHERE r.tenant_id = $1 GROUP BY c.name ORDER BY c.name`,
        [tenantId],
      );
      expect(
        rows.map((r) => [Number(r.students), Number(r.failed), Number(r.average_gpa)]),
      ).toEqual(hand.map((h) => [Number(h.n), Number(h.f), Number(h.g)]));
    });

    it('never shows a result that is not published', async () => {
      // A reopened result clears `published_at` on its rows.
      await ds.query(
        `UPDATE final_result_rows SET published_at = NULL WHERE tenant_id = $1 AND student_id = $2`,
        [tenantId, a],
      );
      const { rows } = await run(
        definition(ReportSubjectArea.FINAL_RESULTS, {
          measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
        }),
      );
      expect(Number(rows[0].students)).toBe(2);
    });

    it('a TEACHER sees only their sections', async () => {
      teacherSections = [six.sectionId];
      const def = definition(ReportSubjectArea.FINAL_RESULTS, {
        dimensions: [{ field: 'class' }, { field: 'gpa' }],
      });
      const { rows } = await run(def, UserRole.TEACHER);
      expect(new Set(rows.map((r) => r.class))).toEqual(new Set(['Six']));
      // COMMITTEE and ACCOUNTANT hold no RESULT_READ: the area is closed to them, not just masked.
      await expect(run(def, UserRole.COMMITTEE)).rejects.toThrow('You cannot run this report.');
      await expect(run(def, UserRole.ACCOUNTANT)).rejects.toThrow('You cannot run this report.');
    });

    it('is refused to a role without RESULT_READ', async () => {
      await expect(
        run(
          definition(ReportSubjectArea.FINAL_RESULTS, {
            measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
          }),
          UserRole.COMMITTEE,
        ),
      ).rejects.toThrow('You cannot run this report.');
    });

    it('does not cross tenants', async () => {
      const other = await fx.school();
      const { rows } = await run(
        definition(ReportSubjectArea.FINAL_RESULTS, {
          measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
        }),
        UserRole.ADMIN,
        other,
      );
      expect(Number(rows[0].students)).toBe(0);
    });
  });

  describe('programs', () => {
    beforeEach(async () => {
      await fx.program(tenantId, 'Hifz', [
        { studentId: a },
        { studentId: b, status: 'WITHDRAWN' },
        { studentId: c },
      ]);
      await fx.program(tenantId, 'Scouts', [{ studentId: a }]);
    });

    it('enrolments by program equal a hand-written count', async () => {
      const { rows } = await run(
        definition(ReportSubjectArea.PROGRAMS, {
          dimensions: [{ field: 'program' }],
          measures: [{ field: 'enrolments', fn: AggregateFn.COUNT }],
          sort: [{ field: 'program', dir: 'asc' }],
        }),
      );
      expect(rows.map((r) => [r.program, Number(r.enrolments)])).toEqual([
        ['Hifz', 3],
        ['Scouts', 1],
      ]);
    });

    it('a TEACHER sees only students of their sections', async () => {
      teacherSections = [six.sectionId];
      const { rows } = await run(
        definition(ReportSubjectArea.PROGRAMS, {
          dimensions: [{ field: 'program' }],
          measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
          sort: [{ field: 'program', dir: 'asc' }],
        }),
        UserRole.TEACHER,
      );
      expect(rows.map((r) => [r.program, Number(r.students)])).toEqual([
        ['Hifz', 2],
        ['Scouts', 1],
      ]);
    });

    it('does not cross tenants', async () => {
      const other = await fx.school();
      const { rows } = await run(
        definition(ReportSubjectArea.PROGRAMS, {
          measures: [{ field: 'enrolments', fn: AggregateFn.COUNT }],
        }),
        UserRole.ADMIN,
        other,
      );
      expect(Number(rows[0].enrolments)).toBe(0);
    });
  });

  describe('applications', () => {
    beforeEach(async () => {
      await fx.application(tenantId, 1, { studentId: a, type: 'STUDENT_LEAVE', status: 'PENDING' });
      await fx.application(tenantId, 2, {
        studentId: b,
        type: 'STUDENT_LEAVE',
        status: 'APPROVED',
      });
      await fx.application(tenantId, 3, { studentId: c, type: 'FEE_WAIVER', status: 'PENDING' });
    });

    it('by type and status equals a hand-written count; no field exposes the letter', async () => {
      const def = definition(ReportSubjectArea.APPLICATIONS, {
        dimensions: [{ field: 'type' }, { field: 'status' }],
        measures: [{ field: 'applications', fn: AggregateFn.COUNT }],
        sort: [
          { field: 'type', dir: 'asc' },
          { field: 'status', dir: 'asc' },
        ],
      });
      const { rows } = await run(def);
      expect(rows.map((r) => [r.type, r.status, Number(r.applications)])).toEqual([
        ['STUDENT_LEAVE', 'PENDING', 1],
        ['STUDENT_LEAVE', 'APPROVED', 1],
        ['FEE_WAIVER', 'PENDING', 1],
      ]);
      const area = new ReportRegistry()
        .areas()
        .find((x) => x.key === ReportSubjectArea.APPLICATIONS);
      const sql = JSON.stringify(area);
      expect(sql).not.toMatch(/letter_text|payload/);
    });

    it('only APPLICATION_MANAGE roles may run it (a TEACHER is refused)', async () => {
      teacherSections = [seven.sectionId];
      const def = definition(ReportSubjectArea.APPLICATIONS, {
        measures: [{ field: 'applications', fn: AggregateFn.COUNT }],
      });
      // TEACHER holds no APPLICATION_MANAGE, so the area is closed to them outright.
      await expect(run(def, UserRole.TEACHER)).rejects.toThrow('You cannot run this report.');
      await expect(run(def, UserRole.ACCOUNTANT)).rejects.toThrow('You cannot run this report.');
      teacherSections = null;
      const { rows } = await run(def, UserRole.ADMIN);
      expect(Number(rows[0].applications)).toBe(3);
    });

    it('does not cross tenants', async () => {
      const other = await fx.school();
      const { rows } = await run(
        definition(ReportSubjectArea.APPLICATIONS, {
          measures: [{ field: 'applications', fn: AggregateFn.COUNT }],
        }),
        UserRole.ADMIN,
        other,
      );
      expect(Number(rows[0].applications)).toBe(0);
    });
  });
});

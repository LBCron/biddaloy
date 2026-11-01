import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FieldSensitivity, ReportDefinitionStatus, UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import { ALL_ENTITIES } from '@test/all-entities';
import type { TeacherScopeService } from '../../classes/teacher-scope.service';
import { FeeDuesService } from '../../fees/fee-dues.service';
import { StudentFee } from '../../fees/entities/student-fee.entity';
import { Student } from '../../students/entities/student.entity';
import { ReportCompiler } from '../engine/compiler/report-compiler';
import { validateDefinition } from '../engine/compiler/validate-definition';
import { ReportRegistry } from '../engine/registry/registry';
import { RoleScopePolicy } from '../engine/security/role-scope.policy';
import { ReportDefinitionVersion } from '../entities/report-definition-version.entity';
import { ReportDefinition } from '../entities/report-definition.entity';
import { seedSystemReports } from './system-reports.seeder';
import { SYSTEM_REPORTS } from './system-reports';

/**
 * [8.15.32] The five ready reports: they are valid against the real registry, every school gets them
 * once, a school's own copy is never overwritten, and each one runs with no choice made and gives the
 * answer the school's own screens give.
 */
describe('system reports (integration)', () => {
  let ds: DataSource;
  let fx: ReportAreaFixture;
  let tenantId: string;
  let year: string;
  let six: { classId: string; sectionId: string };

  const registry = new ReportRegistry();
  const compiler = () =>
    new ReportCompiler(
      ds,
      registry,
      new RoleScopePolicy({ sectionScope: async () => null } as unknown as TeacherScopeService),
    );

  const run = async (key: string, values: Record<string, unknown> = {}, role = UserRole.ADMIN) => {
    const report = SYSTEM_REPORTS.find((r) => r.key === key)!;
    const compiled = await compiler().compile(
      report.definition,
      values,
      { tenantId, userId: 'u', role },
      500,
    );
    return { compiled, rows: await compiled.query.getRawMany<Record<string, unknown>>() };
  };

  beforeAll(async () => {
    ds = (await createTestModule(ALL_ENTITIES, [])).get(DataSource);
    fx = new ReportAreaFixture(ds);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    tenantId = await fx.school();
    year = await fx.year(tenantId, '2026');
    six = await fx.klass(tenantId, year, 'Six', 6);
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  describe('the definitions', () => {
    it.each(SYSTEM_REPORTS.map((r) => [r.key, r] as const))(
      '%s is valid against the registry',
      (_key, report) => {
        const area = registry.area(report.definition.subjectArea);
        expect(() => validateDefinition(report.definition, area)).not.toThrow();
      },
    );

    it('every report has a Bangla and English name and a plain one-line description', () => {
      for (const r of SYSTEM_REPORTS) {
        expect(
          [r.nameEn, r.nameBn, r.descriptionEn, r.descriptionBn].every((t) => t.length > 0),
        ).toBe(true);
        expect(r.key).toMatch(/^[a-z0-9][a-z0-9-]{1,78}$/);
      }
      expect(new Set(SYSTEM_REPORTS.map((r) => r.key)).size).toBe(SYSTEM_REPORTS.length);
    });

    it('each report only asks for something it can default: a required question has no hidden gap', () => {
      // Required questions are answered by the screen with the current year; optional ones simply drop out.
      for (const r of SYSTEM_REPORTS) {
        for (const p of r.definition.parameters) {
          if (p.required) expect(p.type).toBe('ACADEMIC_YEAR');
        }
      }
    });

    it('no report reads a more sensitive field than its audience may see by design', () => {
      // A COMMITTEE member only ever sees the BANBEIS count, whose fields are public or religion.
      const banbeis = SYSTEM_REPORTS.find((r) => r.key === 'student-count-banbeis')!;
      expect(banbeis.visibleRoles).toContain(UserRole.COMMITTEE);
      const area = registry.area(banbeis.definition.subjectArea)!;
      const used = banbeis.definition.dataset.dimensions.map((d) =>
        area.fields.find((f) => f.key === d.field)!,
      );
      for (const f of used) {
        expect(f.sensitivity === FieldSensitivity.PUBLIC || f.key === 'religion').toBe(true);
      }
    });
  });

  describe('the seeder', () => {
    const count = () => ds.getRepository(ReportDefinition).countBy({ tenant_id: tenantId });

    it('gives a school the five reports as published version 1, and a second run adds nothing', async () => {
      expect(await ds.transaction((m) => seedSystemReports(m, tenantId, null))).toBe(5);
      expect(await ds.transaction((m) => seedSystemReports(m, tenantId, null))).toBe(0);
      expect(await count()).toBe(5);

      const defs = await ds
        .getRepository(ReportDefinition)
        .find({ where: { tenant_id: tenantId } });
      for (const d of defs) {
        expect(d.status).toBe(ReportDefinitionStatus.PUBLISHED);
        expect(d.system_template_key).toBe(d.key);
        const versions = await ds
          .getRepository(ReportDefinitionVersion)
          .findBy({ definition_id: d.id });
        expect(versions.map((v) => v.version)).toEqual([1]);
        expect(d.current_version_id).toBe(versions[0].id);
      }
      expect(defs.find((d) => d.key === 'student-count-banbeis')?.visible_roles).toContain(
        UserRole.COMMITTEE,
      );
    });

    it('never overwrites a copy the school changed, and never recreates one it archived', async () => {
      await ds.transaction((m) => seedSystemReports(m, tenantId, null));
      const mine = await ds
        .getRepository(ReportDefinition)
        .findOneByOrFail({ tenant_id: tenantId, key: 'student-list' });
      await ds
        .getRepository(ReportDefinition)
        .update({ id: mine.id }, { name_en: 'My student list' });
      const archived = await ds
        .getRepository(ReportDefinition)
        .findOneByOrFail({ tenant_id: tenantId, key: 'public-exam-results' });
      await ds
        .getRepository(ReportDefinition)
        .update({ id: archived.id }, { status: ReportDefinitionStatus.ARCHIVED });

      await ds.transaction((m) => seedSystemReports(m, tenantId, null));

      expect(
        (await ds.getRepository(ReportDefinition).findOneByOrFail({ id: mine.id })).name_en,
      ).toBe('My student list');
      expect(await count()).toBe(5);
      expect(
        (await ds.getRepository(ReportDefinition).findOneByOrFail({ id: archived.id })).status,
      ).toBe(ReportDefinitionStatus.ARCHIVED);
    });

    it('seeds each school on its own', async () => {
      const other = await fx.school();
      await ds.transaction((m) => seedSystemReports(m, tenantId, null));
      expect(await ds.getRepository(ReportDefinition).countBy({ tenant_id: other })).toBe(0);
    });
  });

  describe('each report runs and gives the answer the screens give', () => {
    it('the BANBEIS count totals the active enrolments, by class, gender and religion', async () => {
      for (let i = 0; i < 4; i++)
        await fx.student(tenantId, year, six, { gender: 'MALE', religion: 'ISLAM' });
      for (let i = 0; i < 3; i++)
        await fx.student(tenantId, year, six, { gender: 'FEMALE', religion: 'HINDU' });
      await fx.student(tenantId, year, six, { status: 'TRANSFERRED' });
      const seven = await fx.klass(tenantId, year, 'Seven', 7);
      await fx.student(tenantId, year, seven, { gender: 'FEMALE', religion: 'ISLAM' });

      const { rows } = await run('student-count-banbeis', { academic_year: '2026' });
      expect(rows.map((r) => [r.class, r.gender, r.religion, Number(r.students)])).toEqual([
        ['Six', 'FEMALE', 'HINDU', 3],
        ['Six', 'MALE', 'ISLAM', 4],
        ['Seven', 'FEMALE', 'ISLAM', 1],
      ]);
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM enrollments WHERE tenant_id = $1 AND enrollment_status = 'ACTIVE'`,
        [tenantId],
      );
      expect(rows.reduce((sum, r) => sum + Number(r.students), 0)).toBe(n);
    });

    it('the student list runs with no choice made, in school order, and narrows when asked', async () => {
      await fx.student(tenantId, year, six, { name: 'Boy', gender: 'MALE' });
      const seven = await fx.klass(tenantId, year, 'Seven', 7);
      await fx.student(tenantId, year, seven, { name: 'Girl', gender: 'FEMALE' });

      const all = await run('student-list');
      expect(all.rows.map((r) => r.name)).toEqual(['Boy', 'Girl']); // class Six before Seven
      const girls = await run('student-list', { gender: 'FEMALE' });
      expect(girls.rows.map((r) => r.name)).toEqual(['Girl']);
    });

    it('the defaulters list covers the same students the dues list shows, with the guardian phone', async () => {
      const a = await fx.student(tenantId, year, six, { name: 'A' });
      const b = await fx.student(tenantId, year, six, { name: 'B' });
      await fx.guardian(tenantId, a, { name: 'Dad', phone: '01711111111', primary: true });
      await fx.bill(tenantId, year, six.classId, a, {
        total: 1000,
        status: 'OVERDUE',
        dueDate: '2026-01-01',
      });
      await fx.bill(tenantId, year, six.classId, b, {
        total: 800,
        paid: 800,
        status: 'PAID',
        dueDate: '2026-01-01',
      });

      const { rows } = await run('defaulters-guardian-contact');
      const dues = await new FeeDuesService(
        ds.getRepository(StudentFee),
        ds.getRepository(Student),
      ).getDues({}, tenantId);
      expect(rows.map((r) => r.name).sort()).toEqual(dues.data.map((d) => d.full_name).sort());
      expect(rows[0]).toMatchObject({ name: 'A', guardian_phone: '01711111111' });
      expect(rows.reduce((s, r) => s + Number(r.outstanding), 0)).toBe(dues.total_due_sum);
    });

    it('the staff and public exam reports run on a school with no data', async () => {
      expect((await run('staff-by-type-gender')).rows).toEqual([]);
      expect((await run('public-exam-results')).rows).toEqual([]);
    });
  });
});

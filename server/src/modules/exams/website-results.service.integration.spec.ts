import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { EnrollmentStatus, ExamKind, ExamStatus } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { AuditService } from '../audit/audit.service';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { WebsiteResultsService } from './website-results.service';

const CTX = { ip: null, userAgent: null };
const audits: Record<string, unknown>[] = [];

/** [40.5.01] The website results read model and publish switch against a real database. */
describe('WebsiteResultsService (integration)', () => {
  let ds: DataSource;
  let svc: WebsiteResultsService;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      WebsiteResultsService,
      {
        provide: AuditService,
        useValue: { record: async (e: Record<string, unknown>) => audits.push(e) },
      },
    ]);
    ds = module.get(DataSource);
    svc = module.get(WebsiteResultsService);
  }, 60_000);

  afterAll(async () => {
    await ds?.destroy();
  });

  /** One school with a site row, one class, one section and a scale; truncation runs per `it`. */
  async function school() {
    const tenant = randomUUID();
    const tag = tenant.slice(0, 8);
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [tenant, `WR ${tag}`, `wr-${tag}`],
    );
    await ds.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft) VALUES ($1,$2,'green','{}'::jsonb)`,
      [tenant, `wr-${tag}`],
    );
    const year = await ds.getRepository(AcademicYear).save({
      name: 'Y',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: tenant,
    } as AcademicYear);
    const cls = await ds
      .getRepository(Class)
      .save({ name: 'Six', academic_year_id: year.id, tenant_id: tenant } as Class);
    const section = await ds
      .getRepository(ClassSection)
      .save({ section_name: 'A', class_id: cls.id, tenant_id: tenant } as ClassSection);
    const scale = await ds.getRepository(GradingScale).save({
      tenant_id: tenant,
      academic_year_id: year.id,
      class_id: null,
      name: 'S',
      revision: 1,
    } as GradingScale);
    const subject = await ds
      .getRepository(Subject)
      .save({ name_en: 'Math', name_bn: 'গণিত', code: `M${tag}`, tenant_id: tenant } as Subject);
    return { tenant, year, cls, section, scale, subject };
  }
  type S = Awaited<ReturnType<typeof school>>;

  const exam = (s: S, status: ExamStatus, extra: Partial<Exam> = {}) =>
    ds.getRepository(Exam).save({
      tenant_id: s.tenant,
      academic_year_id: s.year.id,
      class_id: s.cls.id,
      name: 'Term 1',
      kind: ExamKind.TERM,
      status,
      ...extra,
    } as Exam);

  /** A student with a result (and one subject row) on the exam. */
  async function pupil(s: S, e: Exam, roll: number, o: { name?: string; fail?: boolean } = {}) {
    const st = await ds.getRepository(Student).save({
      full_name: o.name ?? `Pupil ${roll}`,
      registration_number: `R-${randomUUID()}`,
      roll_number: roll,
      class_section_id: s.section.id,
      tenant_id: s.tenant,
      date_of_birth: new Date('2012-01-01'),
      gender: 'MALE',
      enrollment_status: EnrollmentStatus.ACTIVE,
      preferred_communication: 'SMS',
    } as Student);
    const r = await ds.getRepository(Result).save({
      tenant_id: s.tenant,
      exam_id: e.id,
      student_id: st.id,
      total_marks: '80',
      gpa: o.fail ? '0.00' : '5.00',
      grade: o.fail ? 'F' : 'A+',
      position: roll,
      section_id: s.section.id,
      is_fail: !!o.fail,
      grading_scale_id: s.scale.id,
    } as Result);
    await ds.getRepository(ResultSubject).save({
      tenant_id: s.tenant,
      result_id: r.id,
      subject_id: s.subject.id,
      obtained: '80',
      grade: 'A+',
      gpa: '5.00',
      is_fail: false,
      is_fourth_subject: false,
    } as ResultSubject);
    return { st, r };
  }

  const q = (s: S, e: Exam, extra: { roll?: number; page?: number } = {}) =>
    svc.query(s.tenant, { examId: e.id, classSectionId: s.section.id, page: 1, ...extra });
  const version = async (tenant: string) =>
    (await ds.query(`SELECT version FROM school_sites WHERE tenant_id = $1`, [tenant]))[0]
      .version as number;

  it('publish: only a PUBLISHED exam; bumps the site version once and audits', async () => {
    const s = await school();
    for (const status of [ExamStatus.DRAFT, ExamStatus.PROCESSED]) {
      const e = await exam(s, status);
      await expect(svc.publish(e.id, s.tenant, SEED_ADMIN_USER_ID, CTX)).rejects.toThrow(
        'Only an exam with published results can go on the website.',
      );
    }
    const e = await exam(s, ExamStatus.PUBLISHED);
    const v0 = await version(s.tenant);
    audits.length = 0;
    await svc.publish(e.id, s.tenant, SEED_ADMIN_USER_ID, CTX);
    expect(await version(s.tenant)).toBe(v0 + 1);
    expect(audits).toHaveLength(1);
    // Again: nothing changes, no second bump.
    await svc.publish(e.id, s.tenant, SEED_ADMIN_USER_ID, CTX);
    expect(await version(s.tenant)).toBe(v0 + 1);
  });

  it('another school cannot publish, withdraw or switch names of this exam (404)', async () => {
    const a = await school();
    const b = await school();
    const e = await exam(a, ExamStatus.PUBLISHED);
    await expect(svc.publish(e.id, b.tenant, SEED_ADMIN_USER_ID, CTX)).rejects.toThrow(
      'Exam not found',
    );
    await expect(svc.unpublish(e.id, b.tenant, SEED_ADMIN_USER_ID, CTX)).rejects.toThrow(
      'Exam not found',
    );
    await expect(svc.setShowNames(e.id, b.tenant, SEED_ADMIN_USER_ID, CTX, false)).rejects.toThrow(
      'Exam not found',
    );
  });

  it('an exam that is not on the website answers the one 404, same as a missing one', async () => {
    const s = await school();
    const e = await exam(s, ExamStatus.PUBLISHED); // published, but never put on the website
    await pupil(s, e, 1);
    await expect(q(s, e)).rejects.toThrow('results.not_found');
    await expect(q(s, { id: randomUUID() } as Exam)).rejects.toThrow('results.not_found');
    expect(await svc.listPublished(s.tenant)).toEqual([]);
  });

  it('query: rows by roll, names shown, one roll narrows to one row, fail is not passed', async () => {
    const s = await school();
    const e = await exam(s, ExamStatus.PUBLISHED, { website_published_at: new Date() });
    await pupil(s, e, 3, { name: 'Third' });
    await pupil(s, e, 1, { name: 'First', fail: true });
    await pupil(s, e, 2, { name: 'Second' });
    const all = await q(s, e);
    expect(all.rows.map((r) => [r.roll, r.name, r.passed])).toEqual([
      [1, 'First', false],
      [2, 'Second', true],
      [3, 'Third', true],
    ]);
    expect(all.total).toBe(3);
    const one = await q(s, e, { roll: 2 });
    expect(one.rows.map((r) => r.roll)).toEqual([2]);
    // No student id and no contact field ever appears in a row.
    expect(Object.keys(all.rows[0]).sort()).toEqual([
      'gpa',
      'grade',
      'id',
      'name',
      'passed',
      'roll',
    ]);
  });

  it('names off: the name is null on every row', async () => {
    const s = await school();
    const e = await exam(s, ExamStatus.PUBLISHED, {
      website_published_at: new Date(),
      website_show_names: false,
    });
    await pupil(s, e, 1, { name: 'Hidden' });
    const page = await q(s, e);
    expect(page.showNames).toBe(false);
    expect(page.rows.map((r) => r.name)).toEqual([null]);
    expect(JSON.stringify(page)).not.toContain('Hidden');
  });

  it('setShowNames flips the switch and bumps the version', async () => {
    const s = await school();
    const e = await exam(s, ExamStatus.PUBLISHED, { website_published_at: new Date() });
    await pupil(s, e, 1, { name: 'Shown' });
    const v0 = await version(s.tenant);
    await svc.setShowNames(e.id, s.tenant, SEED_ADMIN_USER_ID, CTX, false);
    expect(await version(s.tenant)).toBe(v0 + 1);
    expect((await q(s, e)).rows[0].name).toBeNull();
  });

  it('pages at 100 rows', async () => {
    const s = await school();
    const e = await exam(s, ExamStatus.PUBLISHED, { website_published_at: new Date() });
    for (let roll = 1; roll <= 101; roll++) await pupil(s, e, roll);
    const p1 = await q(s, e);
    const p2 = await q(s, e, { page: 2 });
    expect([p1.rows.length, p2.rows.length, p1.total]).toEqual([100, 1, 101]);
    expect(p2.rows[0].roll).toBe(101);
  }, 60_000);

  it('a deleted student is not listed', async () => {
    const s = await school();
    const e = await exam(s, ExamStatus.PUBLISHED, { website_published_at: new Date() });
    const { st } = await pupil(s, e, 1);
    await pupil(s, e, 2);
    await ds.getRepository(Student).softDelete(st.id);
    expect((await q(s, e)).rows.map((r) => r.roll)).toEqual([2]);
  });

  it('unpublish hides the exam at once, bumps the version; reopening the exam hides it too', async () => {
    const s = await school();
    const e = await exam(s, ExamStatus.PUBLISHED);
    await pupil(s, e, 1);
    await svc.publish(e.id, s.tenant, SEED_ADMIN_USER_ID, CTX);
    expect((await q(s, e)).rows).toHaveLength(1);
    expect(await svc.listPublished(s.tenant)).toHaveLength(1);
    const v0 = await version(s.tenant);
    await svc.unpublish(e.id, s.tenant, SEED_ADMIN_USER_ID, CTX);
    expect(await version(s.tenant)).toBe(v0 + 1);
    await expect(q(s, e)).rejects.toThrow('results.not_found');
    expect(await svc.listPublished(s.tenant)).toEqual([]);

    await svc.publish(e.id, s.tenant, SEED_ADMIN_USER_ID, CTX);
    await ds.getRepository(Exam).update(e.id, { status: ExamStatus.PROCESSED }); // reopen
    await expect(q(s, e)).rejects.toThrow('results.not_found');
  });

  it('a soft-deleted exam is gone from the public read', async () => {
    const s = await school();
    const e = await exam(s, ExamStatus.PUBLISHED, { website_published_at: new Date() });
    await pupil(s, e, 1);
    await ds.getRepository(Exam).softDelete(e.id);
    await expect(q(s, e)).rejects.toThrow('results.not_found');
    expect(await svc.listPublished(s.tenant)).toEqual([]);
  });

  it("another school's exam is invisible: query, detail and the list", async () => {
    const a = await school();
    const b = await school();
    const e = await exam(a, ExamStatus.PUBLISHED, { website_published_at: new Date() });
    const { r } = await pupil(a, e, 1);
    await expect(
      svc.query(b.tenant, { examId: e.id, classSectionId: a.section.id, page: 1 }),
    ).rejects.toThrow('results.not_found');
    await expect(svc.detail(b.tenant, e.id, r.id)).rejects.toThrow('results.not_found');
    expect(await svc.listPublished(b.tenant)).toEqual([]);
    expect(await svc.listPublished(a.tenant)).toHaveLength(1);
  });

  it('detail: per-subject marks only; a result id of another exam is the same 404', async () => {
    const s = await school();
    const e = await exam(s, ExamStatus.PUBLISHED, { website_published_at: new Date() });
    const other = await exam(s, ExamStatus.PUBLISHED, { website_published_at: new Date() });
    const { r } = await pupil(s, e, 1, { name: 'Private Name' });
    const d = await svc.detail(s.tenant, e.id, r.id);
    expect(d.subjects).toEqual([
      { name: { en: 'Math', bn: 'গণিত' }, obtained: 80, grade: 'A+', gpa: 5, passed: true },
    ]);
    expect(JSON.stringify(d)).not.toContain('Private Name');
    await expect(svc.detail(s.tenant, other.id, r.id)).rejects.toThrow('results.not_found');
  });

  it('listPublished: exams with their sections, newest first, unpublished left out', async () => {
    const s = await school();
    const on = await exam(s, ExamStatus.PUBLISHED, {
      website_published_at: new Date(),
      name: 'On',
    });
    await exam(s, ExamStatus.PUBLISHED, { name: 'Off' });
    await pupil(s, on, 1);
    const list = await svc.listPublished(s.tenant);
    expect(list).toEqual([
      {
        id: on.id,
        name: 'On',
        showNames: true,
        sections: [{ id: s.section.id, className: 'Six', sectionName: 'A' }],
      },
    ]);
  });
});

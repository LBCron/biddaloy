import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  MarkStatus,
} from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { AuditService } from '../audit/audit.service';
import { AttendanceComponentService } from './attendance-component.service';
import { MarkGridService } from './mark-grid.service';
import { MarksAuthorizationService } from './marks-authorization.util';
import { ResultsService } from './results.service';
import { WebsiteResultsService } from './website-results.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { GradingBand } from '../grading/entities/grading-band.entity';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'parity-secret';

/**
 * [40.5.01] The website table must show what the staff panel shows. Results come from the real
 * `ResultsService.process`, then `WebsiteResultsService.query` is compared with
 * `ResultsService.list` for the same exam and section.
 *
 * Known divergences, by design:
 * - A soft-deleted student is dropped on the website; the staff list still carries the row.
 * - Both read the student's CURRENT `students.roll_number`.
 * - The website table is ordered by roll, the staff list by position.
 */
describe('WebsiteResultsService parity with ResultsService.list (integration)', () => {
  let ds: DataSource;
  let results: ResultsService;
  let site: WebsiteResultsService;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      ResultsService,
      MarkGridService,
      WebsiteResultsService,
      {
        provide: AttendanceComponentService,
        useValue: { computeForSection: async () => ({ reason: null, valuesByStudent: new Map() }) },
      },
      {
        provide: AuditService,
        useValue: { record: async () => undefined, recordApproved: async () => undefined },
      },
      {
        provide: MarksAuthorizationService,
        useValue: { assertCanRead: async () => undefined, assertCanWrite: async () => undefined },
      },
    ]);
    ds = module.get(DataSource);
    results = module.get(ResultsService);
    site = module.get(WebsiteResultsService);
  }, 60_000);

  afterAll(async () => {
    await ds?.destroy();
  });

  it('rows equal the staff list row for row (roll, gpa, grade, passed)', async () => {
    const tenant = randomUUID();
    const tag = tenant.slice(0, 8);
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
      [tenant, `Parity ${tag}`, `parity-${tag}`],
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
    const subject = await ds
      .getRepository(Subject)
      .save({ name_en: 'Math', code: `M${tag}`, tenant_id: tenant } as Subject);
    await ds.getRepository(ClassSubject).save({
      class_id: cls.id,
      subject_id: subject.id,
      academic_year_id: year.id,
      is_optional: false,
      is_graded_only: false,
      tenant_id: tenant,
    } as ClassSubject);
    const scale = await ds.getRepository(GradingScale).save({
      tenant_id: tenant,
      academic_year_id: year.id,
      class_id: null,
      name: 'NCTB',
      revision: 1,
    } as GradingScale);
    await ds.getRepository(GradingBand).save([
      {
        tenant_id: tenant,
        scale_id: scale.id,
        percent_from: 80,
        percent_to: 100,
        grade: 'A+',
        gpa: '5.00',
        is_fail: false,
        sequence: 1,
      },
      {
        tenant_id: tenant,
        scale_id: scale.id,
        percent_from: 33,
        percent_to: 79,
        grade: 'B',
        gpa: '3.00',
        is_fail: false,
        sequence: 2,
      },
      {
        tenant_id: tenant,
        scale_id: scale.id,
        percent_from: 0,
        percent_to: 32,
        grade: 'F',
        gpa: '0.00',
        is_fail: true,
        sequence: 3,
      },
    ] as GradingBand[]);
    const exam = await ds.getRepository(Exam).save({
      tenant_id: tenant,
      academic_year_id: year.id,
      class_id: cls.id,
      name: 'Term 1',
      kind: ExamKind.TERM,
      status: ExamStatus.DRAFT,
    } as Exam);
    const component = await ds.getRepository(ExamComponent).save({
      tenant_id: tenant,
      exam_id: exam.id,
      subject_id: subject.id,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      source: ExamComponentSource.MANUAL,
      full_marks: '100',
      sequence: 1,
    } as ExamComponent);

    // Five pupils: top, middle, failing, rolls out of order, and one who is deleted afterwards.
    const marks = [
      { roll: 4, v: '92' },
      { roll: 1, v: '55' },
      { roll: 3, v: '20' },
      { roll: 2, v: '81' },
      { roll: 5, v: '70' },
    ];
    const students: Student[] = [];
    for (const m of marks) {
      const st = await ds.getRepository(Student).save({
        full_name: `Pupil ${m.roll}`,
        registration_number: `R-${randomUUID()}`,
        roll_number: m.roll,
        class_section_id: section.id,
        tenant_id: tenant,
        date_of_birth: new Date('2012-01-01'),
        gender: 'MALE',
        enrollment_status: EnrollmentStatus.ACTIVE,
        preferred_communication: 'SMS',
      } as Student);
      students.push(st);
      await ds.getRepository(Enrollment).save({
        student_id: st.id,
        class_id: cls.id,
        section_id: section.id,
        academic_year_id: year.id,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: tenant,
      } as Enrollment);
      await ds.getRepository(Mark).save({
        tenant_id: tenant,
        exam_id: exam.id,
        student_id: st.id,
        subject_id: subject.id,
        component_id: component.id,
        value: m.v,
        status: MarkStatus.PRESENT,
      } as Mark);
    }

    await results.process(exam.id, tenant, randomUUID(), true);
    await ds.getRepository(Exam).update(exam.id, {
      status: ExamStatus.PUBLISHED,
      website_published_at: new Date(),
    });
    // Roll changes after processing: both sides read the CURRENT roll.
    await ds.getRepository(Student).update(students[1].id, { roll_number: 9 });

    const staff = (await results.list(exam.id, tenant))
      .filter((r) => r.section_id === section.id)
      .map((r) => ({ roll: r.roll_number, gpa: r.gpa, grade: r.grade, passed: !r.is_fail }))
      .sort((a, b) => a.roll - b.roll);
    const web = (
      await site.query(tenant, { examId: exam.id, classSectionId: section.id, page: 1 })
    ).rows.map((r) => ({ roll: r.roll, gpa: r.gpa, grade: r.grade, passed: r.passed }));

    expect(staff).toHaveLength(5);
    expect(web).toEqual(staff);
    expect(web.map((r) => r.grade).sort()).toEqual(['A+', 'A+', 'B', 'B', 'F']);

    // Divergence: a deleted student leaves the website table, not the staff list.
    await ds.getRepository(Student).softDelete(students[2].id);
    const after = (
      await site.query(tenant, { examId: exam.id, classSectionId: section.id, page: 1 })
    ).rows;
    expect(after).toHaveLength(4);
    expect(after.some((r) => r.roll === 3)).toBe(false);
  }, 60_000);
});

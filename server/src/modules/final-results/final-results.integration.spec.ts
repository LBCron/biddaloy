import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, IsNull } from 'typeorm';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  FinalResultMode,
  FinalResultRounding,
  FinalResultStatus,
} from '@biddaloy/shared';
import { ConflictException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { mapKnownError } from '../../common/filters/known-errors';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { FinalResultsService } from './final-results.service';
import { FinalResult } from './entities/final-result.entity';
import { FinalResultRow } from './entities/final-result-row.entity';
import { FinalResultSubject } from './entities/final-result-subject.entity';
import { FinalResultWeight } from './entities/final-result-weight.entity';
import { Exam } from '../exams/entities/exam.entity';
import { ExamComponent } from '../exams/entities/exam-component.entity';
import { Result } from '../exams/entities/result.entity';
import { ResultSubject } from '../exams/entities/result-subject.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { GradingBand } from '../grading/entities/grading-band.entity';
import { AuditService } from '../audit/audit.service';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';

/**
 * [70.2.1] FinalResultsService on a real database: build a 30/70 final over two published exams,
 * absent-exam rows, publish (attendance snapshot) and reopen, and the create pre-fill.
 *
 * Hand computation (WEIGHTED 30/70, both exams out of 100, WHOLE rounding):
 *   S1 90 and 90  -> 0.3*90 + 0.7*90  = 90
 *   S2 80 and 80  -> 80
 *   S3 80 and 80  -> 80   (ties S2 on GPA and total: both position 2, next is 4)
 *   S4 70 and 70  -> 70   (position 4)
 *   S5 no exam-1 result, 100 in exam 2 -> 0.3*0 + 0.7*100 = 70 (absent counts 0, D2)
 */

const TENANT_ID = SEED_TENANT_ID;
const YEAR_ID = '00000000-0000-4000-8000-0000000e0001';
const CLASS_ID = '00000000-0000-4000-8000-0000000e0011';
const SECTION_ID = '00000000-0000-4000-8000-0000000e0021';
const SUBJECT_ID = '00000000-0000-4000-8000-0000000e0031';
const PREV_YEAR_ID = '00000000-0000-4000-8000-0000000e0002';
const PREV_CLASS_ID = '00000000-0000-4000-8000-0000000e0012';

describe('FinalResultsService (integration)', () => {
  let service: FinalResultsService;
  let ds: DataSource;
  let scale: GradingScale;
  let seq = 0;

  beforeAll(async () => {
    const audit = { record: async () => undefined, recordApproved: async () => undefined };
    // 200 working days, 180 present, for whoever is asked about.
    const attendance = {
      getSummariesForStudents: async ({ studentIds }: { studentIds: string[] }) =>
        new Map(
          studentIds.map((id) => [
            id,
            {
              working_days: 200,
              present_days: 180,
              late_days: 0,
              policy: { late_counts_as_present: false },
            },
          ]),
        ),
    };
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        FinalResultsService,
        { provide: AuditService, useValue: audit },
        { provide: AttendanceSummaryService, useValue: attendance },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    service = module.get(FinalResultsService);
    ds = module.get(DataSource);

    // Reference rows survive the global per-test truncation; the rest is re-seeded below.
    await ds.getRepository(School).save({
      id: TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: TENANT_ID,
    });
    await ds.getRepository(AcademicYear).save({
      id: YEAR_ID,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: TENANT_ID,
    });
    // Last year, with a same-named class: the source of the create pre-fill's switches.
    await ds.getRepository(AcademicYear).save({
      id: PREV_YEAR_ID,
      name: '2025',
      start_date: new Date('2025-01-01'),
      end_date: new Date('2025-12-31'),
      is_current: false,
      tenant_id: TENANT_ID,
    });
    await ds.getRepository(Class).save({
      id: PREV_CLASS_ID,
      name: 'class eight',
      academic_year_id: PREV_YEAR_ID,
      tenant_id: TENANT_ID,
    });
    await ds.getRepository(Class).save({
      id: CLASS_ID,
      name: 'Class Eight',
      academic_year_id: YEAR_ID,
      tenant_id: TENANT_ID,
    });
    await ds.getRepository(ClassSection).save({
      id: SECTION_ID,
      section_name: 'A',
      class_id: CLASS_ID,
      tenant_id: TENANT_ID,
    });
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.getRepository(Subject).save({
      id: SUBJECT_ID,
      name_en: 'Mathematics',
      code: 'MATH',
      tenant_id: TENANT_ID,
    });
    await ds.getRepository(ClassSubject).save({
      class_id: CLASS_ID,
      subject_id: SUBJECT_ID,
      academic_year_id: YEAR_ID,
      is_optional: false,
      is_graded_only: false,
      tenant_id: TENANT_ID,
    });
    scale = await ds.getRepository(GradingScale).save({
      tenant_id: TENANT_ID,
      academic_year_id: YEAR_ID,
      class_id: null,
      name: 'NCTB',
      revision: 3,
    });
    await ds.getRepository(GradingBand).save([
      {
        tenant_id: TENANT_ID,
        scale_id: scale.id,
        percent_from: 33,
        percent_to: 100,
        grade: 'A+',
        gpa: '5.00',
        is_fail: false,
        sequence: 1,
      },
      {
        tenant_id: TENANT_ID,
        scale_id: scale.id,
        percent_from: 0,
        percent_to: 32,
        grade: 'F',
        gpa: '0.00',
        is_fail: true,
        sequence: 2,
      },
    ]);
  });

  /** A student with an ACTIVE enrollment in the class-year: the final's cohort (D25). */
  async function student(
    roll: number,
    status: EnrollmentStatus = EnrollmentStatus.ACTIVE,
  ): Promise<Student> {
    seq += 1;
    const s = await ds.getRepository(Student).save({
      full_name: `Student ${roll}`,
      registration_number: `REG-FR-${seq}`,
      roll_number: roll,
      class_section_id: SECTION_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2012-01-01'),
      gender: 'MALE',
      enrollment_status: status,
      preferred_communication: 'SMS',
    } as Partial<Student>);
    await ds.getRepository(Enrollment).save({
      tenant_id: TENANT_ID,
      student_id: s.id,
      class_id: CLASS_ID,
      section_id: SECTION_ID,
      academic_year_id: YEAR_ID,
      enrollment_status: status,
    } as Partial<Enrollment>);
    return s;
  }

  /** A published exam with one 100-mark component and a stored result per entry. */
  async function publishedExam(
    name: string,
    kind: ExamKind,
    scores: Array<[Student, number]>,
    status: ExamStatus = ExamStatus.PUBLISHED,
  ): Promise<Exam> {
    const exam = await ds.getRepository(Exam).save({
      tenant_id: TENANT_ID,
      academic_year_id: YEAR_ID,
      class_id: CLASS_ID,
      name,
      kind,
      status,
      published_at: status === ExamStatus.PUBLISHED ? new Date() : null,
    } as Partial<Exam>);
    await ds.getRepository(ExamComponent).save({
      tenant_id: TENANT_ID,
      exam_id: exam.id,
      subject_id: SUBJECT_ID,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      source: ExamComponentSource.MANUAL,
      full_marks: '100',
      sequence: 1,
    } as Partial<ExamComponent>);
    for (const [s, score] of scores) {
      const result = await ds.getRepository(Result).save({
        tenant_id: TENANT_ID,
        exam_id: exam.id,
        student_id: s.id,
        total_marks: score.toFixed(2),
        gpa: '5.00',
        grade: 'A+',
        section_id: SECTION_ID,
        is_fail: false,
        grading_scale_id: scale.id,
        grading_scale_revision: 1,
        rule_version: 'nctb-v3',
        computed_at: new Date(),
      } as Partial<Result>);
      await ds.getRepository(ResultSubject).save({
        tenant_id: TENANT_ID,
        result_id: result.id,
        subject_id: SUBJECT_ID,
        obtained: score.toFixed(2),
        grade: 'A+',
        gpa: '5.00',
        is_fail: false,
        is_fourth_subject: false,
      } as Partial<ResultSubject>);
    }
    return exam;
  }

  async function finalWith(
    shares: Array<[Exam, string]>,
    over: Partial<FinalResult> = {},
  ): Promise<FinalResult> {
    const final = await ds.getRepository(FinalResult).save({
      tenant_id: TENANT_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
      ...over,
    } as Partial<FinalResult>);
    await ds.getRepository(FinalResultWeight).save(
      shares.map(([e, pct]) => ({
        tenant_id: TENANT_ID,
        final_result_id: final.id,
        exam_id: e.id,
        subject_id: null,
        share_percent: pct,
      })),
    );
    return final;
  }

  async function fiveStudentsTwoExams() {
    const [s1, s2, s3, s4, s5] = [
      await student(1),
      await student(2),
      await student(3),
      await student(4),
      await student(5),
    ];
    const e1 = await publishedExam('First Term', ExamKind.TERM, [
      [s1, 90],
      [s2, 80],
      [s3, 80],
      [s4, 70],
    ]); // s5 sat nothing in exam 1
    const e2 = await publishedExam('Second Term', ExamKind.TERM, [
      [s1, 90],
      [s2, 80],
      [s3, 80],
      [s4, 70],
      [s5, 100],
    ]);
    return { s: [s1, s2, s3, s4, s5], e1, e2 };
  }

  it('builds a 30/70 final: totals, grades, positions 1,2,2,4, pinned scale revision', async () => {
    const { s, e1, e2 } = await fiveStudentsTwoExams();
    const final = await finalWith([
      [e1, '30.00'],
      [e2, '70.00'],
    ]);

    const out = await service.build(final.id, TENANT_ID, 'user-1');
    expect(out.processed).toBe(5);

    const rows = await ds
      .getRepository(FinalResultRow)
      .find({ where: { final_result_id: final.id, deleted_at: IsNull() } });
    const by = new Map(rows.map((r) => [r.student_id, r]));
    expect(by.get(s[0].id)).toMatchObject({ total_marks: '90.00', position: 1, grade: 'A+' });
    expect(by.get(s[1].id)).toMatchObject({ total_marks: '80.00', position: 2 });
    expect(by.get(s[2].id)).toMatchObject({ total_marks: '80.00', position: 2 });
    expect(by.get(s[3].id)).toMatchObject({ total_marks: '70.00', position: 4 });
    // Pinned to the exact scale revision and rule version that produced the row.
    for (const r of rows) {
      expect(r.grading_scale_id).toBe(scale.id);
      expect(r.grading_scale_revision).toBe(3);
      expect(r.rule_version).toBe('final-1');
      expect(r.published_at).toBeNull();
    }
    const subjects = await ds.getRepository(FinalResultSubject).find({
      where: { final_result_row_id: by.get(s[0].id)!.id },
    });
    expect(subjects).toHaveLength(1);
    expect(subjects[0].obtained).toBe('90.00');

    const after = await ds.getRepository(FinalResult).findOneByOrFail({ id: final.id });
    expect(after.status).toBe(FinalResultStatus.PROCESSED);
  });

  it('a student with no result in an exam counts 0 for its share and is flagged absent', async () => {
    const { s, e1, e2 } = await fiveStudentsTwoExams();
    const final = await finalWith([
      [e1, '30.00'],
      [e2, '70.00'],
    ]);
    await service.build(final.id, TENANT_ID, 'user-1');

    const page = await service.rows(final.id, TENANT_ID, {}, null);
    const row = page.data.find((r) => r.student.id === s[4].id)!;
    // 0.3 * 0 (absent in exam 1) + 0.7 * 100 = 70. Dropping the row would have given 100.
    expect(row.total_marks).toBe(70);
    expect(row.per_exam.find((p) => p.exam_id === e1.id)).toMatchObject({
      total_marks: null,
      absent: true,
    });
    expect(row.per_exam.find((p) => p.exam_id === e2.id)).toMatchObject({
      total_marks: 100,
      absent: false,
    });
  });

  it('rebuilding replaces the rows instead of piling up duplicates', async () => {
    const { e1, e2 } = await fiveStudentsTwoExams();
    const final = await finalWith([
      [e1, '30.00'],
      [e2, '70.00'],
    ]);
    await service.build(final.id, TENANT_ID, 'user-1');
    await service.build(final.id, TENANT_ID, 'user-1');
    const live = await ds
      .getRepository(FinalResultRow)
      .count({ where: { final_result_id: final.id, deleted_at: IsNull() } });
    expect(live).toBe(5);
  });

  it('the cohort is the ACTIVE enrollments (D25): a leaver is out, a student with no result is in', async () => {
    const s1 = await student(1);
    // Left mid-year: has a result in the exam, but is not in the final.
    const leaver = await student(2, EnrollmentStatus.TRANSFERRED);
    // Enrolled but sat nothing: still in the final, every share counts 0 (D2).
    const noShow = await student(3);
    const e1 = await publishedExam('First Term', ExamKind.TERM, [
      [s1, 90],
      [leaver, 95],
    ]);
    const final = await finalWith([[e1, '100.00']]);
    await service.build(final.id, TENANT_ID, 'user-1');
    const rows = await ds
      .getRepository(FinalResultRow)
      .find({ where: { final_result_id: final.id, deleted_at: IsNull() } });
    expect(rows.map((r) => r.student_id).sort()).toEqual([s1.id, noShow.id].sort());
    const absent = rows.find((r) => r.student_id === noShow.id)!;
    expect(Number(absent.total_marks)).toBe(0);
    expect(absent.section_id).toBe(SECTION_ID);
  });

  it('publish is refused when a source exam was republished after the build', async () => {
    const s1 = await student(1);
    const e1 = await publishedExam('First Term', ExamKind.TERM, [[s1, 90]]);
    const final = await finalWith([[e1, '100.00']]);
    await service.build(final.id, TENANT_ID, 'user-1');
    // Reopened, corrected and published again after the build: the rows are stale.
    await ds
      .getRepository(Exam)
      .update({ id: e1.id }, { published_at: new Date(Date.now() + 60_000) });
    await expect(service.publish(final.id, TENANT_ID, 'user-1')).rejects.toMatchObject({
      response: { details: { code: 'FINAL_STALE' } },
    });
    // A rebuild picks the new numbers up, then publish goes through.
    await ds.getRepository(Exam).update({ id: e1.id }, { published_at: new Date() });
    await service.build(final.id, TENANT_ID, 'user-1');
    await service.publish(final.id, TENANT_ID, 'user-1');
  });

  it('editing a built result drops its rows; deleting it soft-deletes rows and subjects', async () => {
    const s1 = await student(1);
    const e1 = await publishedExam('First Term', ExamKind.TERM, [[s1, 90]]);
    const final = await finalWith([[e1, '100.00']]);
    await service.build(final.id, TENANT_ID, 'user-1');
    const liveRows = () =>
      ds
        .getRepository(FinalResultRow)
        .count({ where: { final_result_id: final.id, deleted_at: IsNull() } });
    expect(await liveRows()).toBe(1);

    // Back to DRAFT: the old rows were computed under the old settings, so none stay readable.
    const edited = await service.update(
      final.id,
      { rounding: 'TWO_DECIMALS' } as never,
      TENANT_ID,
      'user-1',
    );
    expect(edited.status).toBe(FinalResultStatus.DRAFT);
    expect(edited.counts.students).toBe(0);
    expect(await liveRows()).toBe(0);

    // A built (unpublished) result can be deleted, and takes its rows with it.
    await service.build(final.id, TENANT_ID, 'user-1');
    const [row] = await ds
      .getRepository(FinalResultRow)
      .find({ where: { final_result_id: final.id, deleted_at: IsNull() } });
    await service.remove(final.id, TENANT_ID, 'user-1');
    expect(await liveRows()).toBe(0);
    const liveSubjects = await ds
      .getRepository(FinalResultSubject)
      .count({ where: { final_result_row_id: row.id, deleted_at: IsNull() } });
    expect(liveSubjects).toBe(0);
  });

  it('best-of cannot count more exams than the result has', async () => {
    const s1 = await student(1);
    const e1 = await publishedExam('First Term', ExamKind.TERM, [[s1, 90]]);
    const final = await finalWith([[e1, '100.00']]);
    await expect(
      service.update(final.id, { mode: 'BEST_OF', best_of_count: 2 } as never, TENANT_ID, 'user-1'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("a teacher's section scope narrows list and get (Rule 2)", async () => {
    const s1 = await student(1);
    const e1 = await publishedExam('First Term', ExamKind.TERM, [[s1, 90]]);
    const final = await finalWith([[e1, '100.00']]);
    // Assigned to this class's section: sees it.
    expect(await service.list(YEAR_ID, TENANT_ID, [SECTION_ID])).toHaveLength(1);
    await expect(service.get(final.id, TENANT_ID, [SECTION_ID])).resolves.toMatchObject({
      id: final.id,
    });
    // No assignment: empty list, and the final itself is a 404 (never a 403).
    expect(await service.list(YEAR_ID, TENANT_ID, [])).toEqual([]);
    await expect(service.get(final.id, TENANT_ID, [])).rejects.toMatchObject({ status: 404 });
  });

  it('is refused while a source exam is not published', async () => {
    const s1 = await student(1);
    const e1 = await publishedExam('First Term', ExamKind.TERM, [[s1, 90]]);
    const e2 = await publishedExam('Second Term', ExamKind.TERM, [[s1, 90]], ExamStatus.PROCESSED);
    const final = await finalWith([
      [e1, '50.00'],
      [e2, '50.00'],
    ]);
    await expect(service.build(final.id, TENANT_ID, 'user-1')).rejects.toMatchObject({
      response: { details: { code: 'FINAL_SOURCE_UNPUBLISHED' } },
    });
  });

  it('publish snapshots attendance on every row; reopen clears published_at', async () => {
    const { e1, e2 } = await fiveStudentsTwoExams();
    const final = await finalWith([
      [e1, '30.00'],
      [e2, '70.00'],
    ]);
    await service.build(final.id, TENANT_ID, 'user-1');
    await service.publish(final.id, TENANT_ID, 'user-1');

    const published = await ds.getRepository(FinalResult).findOneByOrFail({ id: final.id });
    expect(published.status).toBe(FinalResultStatus.PUBLISHED);
    expect(published.published_at).not.toBeNull();
    const rows = await ds
      .getRepository(FinalResultRow)
      .find({ where: { final_result_id: final.id, deleted_at: IsNull() } });
    for (const r of rows) {
      expect(r.published_at).not.toBeNull();
      expect(r.working_days).toBe(200);
      expect(r.present_days).toBe(180);
    }

    // Published results cannot be rebuilt or edited until reopened.
    await expect(service.build(final.id, TENANT_ID, 'user-1')).rejects.toMatchObject({
      response: { details: { code: 'FINAL_PUBLISHED' } },
    });
    await expect(
      service.update(final.id, { rounding: 'TWO_DECIMALS' } as never, TENANT_ID, 'user-1'),
    ).rejects.toMatchObject({ response: { details: { code: 'FINAL_NOT_DRAFT' } } });

    await service.reopen(final.id, TENANT_ID, 'user-1');
    const reopened = await ds.getRepository(FinalResult).findOneByOrFail({ id: final.id });
    expect(reopened.status).toBe(FinalResultStatus.PROCESSED);
    expect(reopened.published_at).toBeNull();
    const reopenedRows = await ds
      .getRepository(FinalResultRow)
      .find({ where: { final_result_id: final.id, deleted_at: IsNull() } });
    expect(reopenedRows.every((r) => r.published_at === null)).toBe(true);
  });

  it('create pre-fills equal shares over the published TERM exams only', async () => {
    const s1 = await student(1);
    const t1 = await publishedExam('Term 1', ExamKind.TERM, [[s1, 90]]);
    const t2 = await publishedExam('Term 2', ExamKind.TERM, [[s1, 90]]);
    // Not a term exam, and a term exam that is not published: neither is pre-filled.
    await publishedExam('Monthly', ExamKind.MONTHLY, [[s1, 90]]);
    await publishedExam('Term 3', ExamKind.TERM, [], ExamStatus.PROCESSED);

    const summary = await service.create(
      { class_id: CLASS_ID, academic_year_id: YEAR_ID },
      TENANT_ID,
      'user-1',
    );
    expect(summary.status).toBe(FinalResultStatus.DRAFT);
    expect(summary.weights.map((w) => w.exam_id).sort()).toEqual([t1.id, t2.id].sort());
    expect(summary.weights.every((w) => w.share_percent === 50 && w.subject_id === null)).toBe(
      true,
    );

    // One final result per class and year.
    await expect(
      service.create({ class_id: CLASS_ID, academic_year_id: YEAR_ID }, TENANT_ID, 'user-1'),
    ).rejects.toMatchObject({ response: { details: { code: 'FINAL_ALREADY_EXISTS' } } });

    // The list shows the class with its status.
    const list = await service.list(YEAR_ID, TENANT_ID);
    expect(list).toEqual([
      expect.objectContaining({ final_result_id: summary.id, status: FinalResultStatus.DRAFT }),
    ]);
  });

  it('a create that loses the race to another create is FINAL_ALREADY_EXISTS, not the generic duplicate', async () => {
    // Deterministic hold: an open transaction already inserted this class-year's final. The
    // service's count cannot see it (not committed), so its insert waits on the unique index.
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    let creating: Promise<unknown> | undefined;
    try {
      try {
        await qr.manager.getRepository(FinalResult).save({
          tenant_id: TENANT_ID,
          class_id: CLASS_ID,
          academic_year_id: YEAR_ID,
        });
        creating = service.create(
          { class_id: CLASS_ID, academic_year_id: YEAR_ID },
          TENANT_ID,
          'user-1',
        );
        creating.catch(() => undefined);
        await expect
          .poll(
            async () =>
              (
                await ds.query(
                  `SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'
                      AND pid <> pg_backend_pid() AND query ILIKE '%INSERT INTO "final_results"%'`,
                )
              ).length,
            { timeout: 15000, interval: 25 },
          )
          .toBeGreaterThan(0);
      } finally {
        await qr.commitTransaction();
      }
    } finally {
      await qr.release();
    }
    const err = await creating!.then(
      () => null,
      (e: unknown) => e,
    );
    // The filter maps the unique violation through known-errors.ts (Rule 24).
    const mapped = mapKnownError(err) ?? (err as ConflictException);
    expect(mapped.getStatus()).toBe(409);
    expect(mapped.getResponse()).toMatchObject({ details: { code: 'FINAL_ALREADY_EXISTS' } });
  });

  it("create copies last year's switches from the same-named class", async () => {
    await ds.getRepository(FinalResult).save({
      tenant_id: TENANT_ID,
      class_id: PREV_CLASS_ID,
      academic_year_id: PREV_YEAR_ID,
      mode: FinalResultMode.BEST_OF,
      best_of_count: 2,
      rounding: FinalResultRounding.TWO_DECIMALS,
      fail_if_any_exam_fails: true,
    } as Partial<FinalResult>);

    const summary = await service.create(
      { class_id: CLASS_ID, academic_year_id: YEAR_ID },
      TENANT_ID,
      'user-1',
    );
    expect(summary).toMatchObject({
      mode: 'BEST_OF',
      best_of_count: 2,
      rounding: 'TWO_DECIMALS',
      fail_if_any_exam_fails: true,
      weights: [],
    });
  });

  it('update replaces the shares as a set and refuses an exam of another class', async () => {
    const s1 = await student(1);
    const t1 = await publishedExam('Term 1', ExamKind.TERM, [[s1, 90]]);
    const t2 = await publishedExam('Term 2', ExamKind.TERM, [[s1, 90]]);
    const final = await finalWith([[t1, '100.00']]);

    const updated = await service.update(
      final.id,
      {
        weights: [
          { exam_id: t1.id, share_percent: 40 },
          { exam_id: t2.id, share_percent: 60 },
        ],
      },
      TENANT_ID,
      'user-1',
    );
    expect(updated.weights).toHaveLength(2);

    await expect(
      service.update(
        final.id,
        { weights: [{ exam_id: '00000000-0000-4000-8000-00000000ffff', share_percent: 100 }] },
        TENANT_ID,
        'user-1',
      ),
    ).rejects.toThrow('Every exam must belong to this class and year.');
    // The refused edit changed nothing.
    expect((await service.get(final.id, TENANT_ID)).weights).toHaveLength(2);
  });

  it('refuses another tenant and unknown ids with 404', async () => {
    const { e1, e2 } = await fiveStudentsTwoExams();
    const final = await finalWith([
      [e1, '30.00'],
      [e2, '70.00'],
    ]);
    // Tenant isolation: the same id under another tenant does not exist.
    await expect(service.get(final.id, '00000000-0000-4000-8000-00000000aaaa')).rejects.toThrow(
      'Final result not found',
    );
  });
});

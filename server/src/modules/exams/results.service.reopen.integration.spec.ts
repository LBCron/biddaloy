import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, IsNull } from 'typeorm';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  FinalResultStatus,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { FinalResultsService } from '../final-results/final-results.service';
import { FinalResult } from '../final-results/entities/final-result.entity';
import { FinalResultRow } from '../final-results/entities/final-result-row.entity';
import { FinalResultWeight } from '../final-results/entities/final-result-weight.entity';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
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
import { AttendanceComponentService } from './attendance-component.service';
import { MarkGridService } from './mark-grid.service';
import { ResultsService } from './results.service';
import { ExamResultRecomputer } from './result-recomputer.service';
import { MarksAuthorizationService } from './marks-authorization.util';

/**
 * [#3409] Recompute <-> reopen coupling on a real database (also covers
 * ExamResultRecomputer's final-result handling, which needs the same fixtures).
 *  - reopening a source exam is refused (409 FINAL_PUBLISHED) while a PUBLISHED final counts it;
 *  - reopening one under a PROCESSED final sends that final back to DRAFT (rows gone, audited);
 *  - a grading-scale edit rebuilds a PROCESSED final pinned to the scale, and is refused
 *    (SCALE_IN_PUBLISHED_RESULTS) while a PUBLISHED final uses it.
 *
 * The exams' own results pin `oldScale` (another year's scale), so only the FINAL is pinned to
 * `scale` and the recomputer reaches the final through its rows, not through an exam.
 */

const TENANT_ID = SEED_TENANT_ID;
const YEAR_ID = '00000000-0000-4000-8000-0000000f0001';
const OLD_YEAR_ID = '00000000-0000-4000-8000-0000000f0002';
const CLASS_ID = '00000000-0000-4000-8000-0000000f0011';
const SECTION_ID = '00000000-0000-4000-8000-0000000f0021';
const SUBJECT_ID = '00000000-0000-4000-8000-0000000f0031';

describe('reopen + scale recompute coupling with final results (integration)', () => {
  let ds: DataSource;
  let results: ResultsService;
  let finals: FinalResultsService;
  let recomputer: ExamResultRecomputer;
  let scale: GradingScale;
  let oldScale: GradingScale;
  let seq = 0;
  const auditCalls: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    const audit = {
      record: async (entry: Record<string, unknown>) => {
        auditCalls.push(entry);
      },
      recordApproved: async () => undefined,
    };
    const attendance = {
      getSummariesForStudents: async () => new Map(),
      computeForSection: async () => ({ reason: null, valuesByStudent: new Map() }),
    };
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ResultsService,
        FinalResultsService,
        ExamResultRecomputer,
        MarkGridService,
        {
          provide: MarksAuthorizationService,
          useValue: { assertCanRead: async () => undefined, assertCanWrite: async () => undefined },
        },
        { provide: AuditService, useValue: audit },
        { provide: AttendanceSummaryService, useValue: attendance },
        { provide: AttendanceComponentService, useValue: attendance },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    results = module.get(ResultsService);
    finals = module.get(FinalResultsService);
    recomputer = module.get(ExamResultRecomputer);
    ds = module.get(DataSource);

    await ds.getRepository(School).save({
      id: TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: TENANT_ID,
    });
    for (const [id, name, y] of [
      [YEAR_ID, '2026', 2026],
      [OLD_YEAR_ID, '2025', 2025],
    ] as const) {
      await ds.getRepository(AcademicYear).save({
        id,
        name,
        start_date: new Date(`${y}-01-01`),
        end_date: new Date(`${y}-12-31`),
        is_current: y === 2026,
        tenant_id: TENANT_ID,
      });
    }
    await ds.getRepository(Class).save({
      id: CLASS_ID,
      name: 'Class Nine',
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
    auditCalls.length = 0;
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
      revision: 1,
    });
    await ds
      .getRepository(GradingBand)
      .save([
        band(scale.id, 33, 100, 'A+', '5.00', false, 1),
        band(scale.id, 0, 32, 'F', '0.00', true, 2),
      ]);
    oldScale = await ds.getRepository(GradingScale).save({
      tenant_id: TENANT_ID,
      academic_year_id: OLD_YEAR_ID,
      class_id: null,
      name: 'Old',
      revision: 1,
    });
  });

  function band(
    scaleId: string,
    from: number,
    to: number,
    grade: string,
    gpa: string,
    isFail: boolean,
    sequence: number,
  ) {
    return {
      tenant_id: TENANT_ID,
      scale_id: scaleId,
      percent_from: from,
      percent_to: to,
      grade,
      gpa,
      is_fail: isFail,
      sequence,
    };
  }

  async function student(roll: number): Promise<Student> {
    seq += 1;
    const s = await ds.getRepository(Student).save({
      full_name: `Student ${roll}`,
      registration_number: `REG-RC-${seq}`,
      roll_number: roll,
      class_section_id: SECTION_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2012-01-01'),
      gender: 'MALE',
      enrollment_status: EnrollmentStatus.ACTIVE,
      preferred_communication: 'SMS',
    } as Partial<Student>);
    await ds.getRepository(Enrollment).save({
      tenant_id: TENANT_ID,
      student_id: s.id,
      class_id: CLASS_ID,
      section_id: SECTION_ID,
      academic_year_id: YEAR_ID,
      enrollment_status: EnrollmentStatus.ACTIVE,
    } as Partial<Enrollment>);
    return s;
  }

  /** A PUBLISHED exam, one 100-mark component, one result of 90 for the student. */
  async function publishedExam(name: string, s: Student): Promise<Exam> {
    const exam = await ds.getRepository(Exam).save({
      tenant_id: TENANT_ID,
      academic_year_id: YEAR_ID,
      class_id: CLASS_ID,
      name,
      kind: ExamKind.TERM,
      status: ExamStatus.PUBLISHED,
      published_at: new Date(),
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
    const result = await ds.getRepository(Result).save({
      tenant_id: TENANT_ID,
      exam_id: exam.id,
      student_id: s.id,
      total_marks: '90.00',
      gpa: '5.00',
      grade: 'A+',
      section_id: SECTION_ID,
      is_fail: false,
      grading_scale_id: oldScale.id,
      grading_scale_revision: 1,
      rule_version: 'nctb-v3',
      computed_at: new Date(),
    } as Partial<Result>);
    await ds.getRepository(ResultSubject).save({
      tenant_id: TENANT_ID,
      result_id: result.id,
      subject_id: SUBJECT_ID,
      obtained: '90.00',
      grade: 'A+',
      gpa: '5.00',
      is_fail: false,
      is_fourth_subject: false,
    } as Partial<ResultSubject>);
    return exam;
  }

  /** A final over one exam (100%), built so it is PROCESSED with rows pinned to `scale`. */
  async function processedFinal(exam: Exam): Promise<FinalResult> {
    const final = await ds.getRepository(FinalResult).save({
      tenant_id: TENANT_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
    } as Partial<FinalResult>);
    await ds.getRepository(FinalResultWeight).save({
      tenant_id: TENANT_ID,
      final_result_id: final.id,
      exam_id: exam.id,
      subject_id: null,
      share_percent: '100.00',
    });
    await finals.build(final.id, TENANT_ID, null as unknown as string);
    return final;
  }

  const liveRows = (finalId: string) =>
    ds
      .getRepository(FinalResultRow)
      .find({ where: { final_result_id: finalId, deleted_at: IsNull() } });
  const finalStatus = async (id: string) =>
    (await ds.getRepository(FinalResult).findOneByOrFail({ id })).status;
  const examStatus = async (id: string) =>
    (await ds.getRepository(Exam).findOneByOrFail({ id })).status;

  // ---- reopen -------------------------------------------------------------------------------

  it('refuses to reopen an exam a PUBLISHED final counts: 409, nothing changes', async () => {
    const exam = await publishedExam('Term 1', await student(1));
    const final = await processedFinal(exam);
    await finals.publish(final.id, TENANT_ID, 'user-1');

    await expect(results.reopen(exam.id, TENANT_ID, 'user-1')).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'FINAL_PUBLISHED' } },
    });

    expect(await examStatus(exam.id)).toBe(ExamStatus.PUBLISHED);
    expect(await finalStatus(final.id)).toBe(FinalResultStatus.PUBLISHED);
    expect(await liveRows(final.id)).toHaveLength(1);
  });

  it('reopening an exam under a PROCESSED final sends the final back to DRAFT and audits it', async () => {
    const exam = await publishedExam('Term 1', await student(1));
    const final = await processedFinal(exam);
    expect(await liveRows(final.id)).toHaveLength(1);
    auditCalls.length = 0;

    await results.reopen(exam.id, TENANT_ID, 'user-1');

    expect(await examStatus(exam.id)).toBe(ExamStatus.PROCESSED);
    expect(await finalStatus(final.id)).toBe(FinalResultStatus.DRAFT);
    // Rows are soft-deleted, not left behind to disagree with the reopened exam.
    expect(await liveRows(final.id)).toHaveLength(0);
    const demote = auditCalls.find((a) => a.entity_type === 'FinalResult');
    expect(demote).toMatchObject({
      entity_id: final.id,
      new_values: { status: FinalResultStatus.DRAFT, exam_id: exam.id },
    });
  });

  it('reopens an exam no final counts exactly as before', async () => {
    const exam = await publishedExam('Term 1', await student(1));
    await results.reopen(exam.id, TENANT_ID, 'user-1');
    expect(await examStatus(exam.id)).toBe(ExamStatus.PROCESSED);
  });

  it('does not touch a final of another tenant that counts a same-id exam', async () => {
    // Tenant isolation: the lookup is keyed on tenant_id, a foreign tenant sees no finals.
    const exam = await publishedExam('Term 1', await student(1));
    const final = await processedFinal(exam);
    await expect(
      results.reopen(exam.id, '00000000-0000-4000-8000-00000000dead', 'user-1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(await finalStatus(final.id)).toBe(FinalResultStatus.PROCESSED);
  });

  // ---- scale recompute ----------------------------------------------------------------------

  it('a scale edit rebuilds a PROCESSED final pinned to it; it stays PROCESSED', async () => {
    const exam = await publishedExam('Term 1', await student(1));
    const final = await processedFinal(exam);
    expect((await liveRows(final.id))[0]).toMatchObject({ gpa: '5.00' });
    expect(await recomputer.countAffected(TENANT_ID, scale.id)).toBe(1);

    // The band edit: A+ is now worth 4.00 (the real flow also bumps the revision).
    await ds
      .getRepository(GradingBand)
      .update({ scale_id: scale.id, grade: 'A+' }, { gpa: '4.00' });
    await ds.getRepository(GradingScale).update({ id: scale.id }, { revision: 2 });
    const n = await ds.transaction((m) => recomputer.recompute(TENANT_ID, scale.id, m));

    expect(n).toBe(1);
    const [row] = await liveRows(final.id);
    expect(row).toMatchObject({ gpa: '4.00', grading_scale_revision: 2, published_at: null });
    expect(await finalStatus(final.id)).toBe(FinalResultStatus.PROCESSED);
  });

  it('a scale edit is refused while a PUBLISHED final uses the scale', async () => {
    const exam = await publishedExam('Term 1', await student(1));
    const final = await processedFinal(exam);
    await finals.publish(final.id, TENANT_ID, 'user-1');

    expect(await recomputer.findPublishedExams(TENANT_ID, scale.id)).toEqual([
      { id: final.id, name: 'Class Nine' },
    ]);
    await expect(
      ds.transaction((m) => recomputer.recompute(TENANT_ID, scale.id, m)),
    ).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'SCALE_IN_PUBLISHED_RESULTS' } },
    });
    expect((await liveRows(final.id))[0]).toMatchObject({ gpa: '5.00' });
  });
});

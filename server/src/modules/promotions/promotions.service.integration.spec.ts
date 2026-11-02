import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { FinalResult } from '../final-results/entities/final-result.entity';
import { FinalResultRow } from '../final-results/entities/final-result-row.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PromotionsService } from './promotions.service';
import { PromotionRun } from './entities/promotion-run.entity';
import { PromotionEntry } from './entities/promotion-entry.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Result } from '../exams/entities/result.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { School } from '../schools/entities/school.entity';
import { EnrollmentService } from '../enrollments/enrollments.service';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { StudentLifecycleService } from '../students/student-lifecycle.service';
import { StudentLifecycleEvent } from '../students/entities/student-lifecycle-event.entity';
import { ApprovalService } from '../auth/guards/approval.guard';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import {
  EnrollmentStatus,
  ExamStatus,
  ExamKind,
  PromotionOutcome,
  PromotionRunStatus,
  PlacementAlgorithm,
  StudentLifecycleEventType,
  FinalResultStatus,
} from '@biddaloy/shared';

const SOURCE_YEAR_ID = '00000000-0000-4000-8000-000000010001';
const TARGET_YEAR_ID = '00000000-0000-4000-8000-000000010002';
const SOURCE_CLASS_ID = '00000000-0000-4000-8000-000000010010';
const SOURCE_SECTION_ID = '00000000-0000-4000-8000-000000010011';
const TARGET_CLASS_ID = '00000000-0000-4000-8000-000000010020';
const TARGET_SECTION_ID = '00000000-0000-4000-8000-000000010021';
// D20 retain classes: resolveTarget() requires a same-grade class to exist
// in the target year for ANY run on that source grade (any entry could end
// up RETAIN via override), so every source grade used below needs one.
const RETAIN_CLASS_ID = '00000000-0000-4000-8000-000000010040';
const RETAIN_SECTION_ID = '00000000-0000-4000-8000-000000010041';
// `created_by_user_id` etc. are plain uuid columns (no FK on promotion_runs
// itself), but `audit_logs.performed_by_user_id` DOES have an FK to
// `users(id)` — so commit()'s audit rows need a real user row to reference.
const ADMIN_USER_ID = '00000000-0000-4000-8000-000000010050';

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM promotion_entries');
  await ds.query('DELETE FROM promotion_runs');
  await ds.query('DELETE FROM results');
  await ds.query('DELETE FROM exams');
  await ds.query('DELETE FROM grading_scales');
  await ds.query('DELETE FROM enrollments');
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');
  await ds.query('DELETE FROM users WHERE id = $1', [ADMIN_USER_ID]);

  await ds.query(`INSERT INTO users (id, full_name) VALUES ($1, 'Test Admin')`, [ADMIN_USER_ID]);

  const schoolRepo = ds.getRepository(School);
  const ayRepo = ds.getRepository(AcademicYear);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);

  await schoolRepo.save(
    schoolRepo.create({
      id: SEED_TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: SOURCE_YEAR_ID,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: TARGET_YEAR_ID,
      name: '2027',
      start_date: new Date('2027-01-01'),
      end_date: new Date('2027-12-31'),
      is_current: false,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: SOURCE_CLASS_ID,
      name: 'Class Five',
      numeric_grade: 5,
      academic_year_id: SOURCE_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SOURCE_SECTION_ID,
      section_name: 'A',
      class_id: SOURCE_CLASS_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: TARGET_CLASS_ID,
      name: 'Class Six',
      numeric_grade: 6,
      academic_year_id: TARGET_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: TARGET_SECTION_ID,
      section_name: 'A',
      class_id: TARGET_CLASS_ID,
      capacity: null,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  // Grade 5 (== SOURCE_CLASS_ID's grade) in the target year, so D20's
  // retain-class check doesn't block every run on the source class.
  await classRepo.save(
    classRepo.create({
      id: RETAIN_CLASS_ID,
      name: 'Class Five (retained)',
      numeric_grade: 5,
      academic_year_id: TARGET_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: RETAIN_SECTION_ID,
      section_name: 'A',
      class_id: RETAIN_CLASS_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
}

describe('PromotionsService (integration)', () => {
  let service: PromotionsService;
  let dataSource: DataSource;
  let studentRepo: Repository<Student>;
  let enrollmentRepo: Repository<Enrollment>;
  let runRepo: Repository<PromotionRun>;
  let entryRepo: Repository<PromotionEntry>;
  let examRepo: Repository<Exam>;
  let resultRepo: Repository<Result>;
  let gradingScaleRepo: Repository<GradingScale>;
  const TENANT_ID = SEED_TENANT_ID;
  let examId: string;
  let gradingScaleId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        PromotionsService,
        EnrollmentService,
        AuditService,
        StudentLifecycleService,
        {
          provide: ApprovalService,
          useValue: { consume: vi.fn().mockResolvedValue({ approverId: ADMIN_USER_ID }) },
        },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );

    service = module.get(PromotionsService);
    dataSource = module.get(DataSource);
    studentRepo = module.get(getRepositoryToken(Student));
    enrollmentRepo = module.get(getRepositoryToken(Enrollment));
    runRepo = module.get(getRepositoryToken(PromotionRun));
    entryRepo = module.get(getRepositoryToken(PromotionEntry));
    examRepo = module.get(getRepositoryToken(Exam));
    resultRepo = module.get(getRepositoryToken(Result));
    gradingScaleRepo = module.get(getRepositoryToken(GradingScale));

    await seedReferenceData(dataSource);
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM promotion_entries');
    await dataSource.query('DELETE FROM promotion_runs');
    await dataSource.query('DELETE FROM final_result_rows');
    await dataSource.query('DELETE FROM final_results');
    await dataSource.query('DELETE FROM results');
    await dataSource.query('DELETE FROM exams');
    await dataSource.query('DELETE FROM grading_scales');
    await dataSource.query('DELETE FROM student_lifecycle_events');
    await dataSource.query('DELETE FROM student_subject_choices');
    await dataSource.query('DELETE FROM class_subjects');
    await dataSource.query('DELETE FROM subjects');
    await dataSource.query('DELETE FROM enrollments');
    await dataSource.query('DELETE FROM student_guardians');
    await dataSource.query('DELETE FROM students');

    const scale = await gradingScaleRepo.save(
      gradingScaleRepo.create({
        academic_year_id: SOURCE_YEAR_ID,
        class_id: null,
        name: 'Default',
        revision: 1,
        tenant_id: TENANT_ID,
      }),
    );
    gradingScaleId = scale.id;

    const exam = await examRepo.save(
      examRepo.create({
        tenant_id: TENANT_ID,
        academic_year_id: SOURCE_YEAR_ID,
        class_id: SOURCE_CLASS_ID,
        name: 'Final Exam',
        kind: ExamKind.TERM,
        status: ExamStatus.PUBLISHED,
      }),
    );
    examId = exam.id;
  });

  async function buildStudent(overrides: Partial<Student> = {}): Promise<Student> {
    return studentRepo.save(
      studentRepo.create({
        full_name: 'Test Student',
        registration_number: `REG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        roll_number: 1,
        class_section_id: SOURCE_SECTION_ID,
        tenant_id: TENANT_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        preferred_communication: 'SMS',
        ...overrides,
      }),
    );
  }

  async function enrollActive(studentId: string): Promise<Enrollment> {
    return enrollmentRepo.save(
      enrollmentRepo.create({
        student_id: studentId,
        class_id: SOURCE_CLASS_ID,
        section_id: SOURCE_SECTION_ID,
        academic_year_id: SOURCE_YEAR_ID,
        tenant_id: TENANT_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
      }),
    );
  }

  async function addResult(
    studentId: string,
    opts: { isFail: boolean; gpa: number; total: number; computedAt?: Date },
  ) {
    return resultRepo.save(
      resultRepo.create({
        tenant_id: TENANT_ID,
        exam_id: examId,
        student_id: studentId,
        total_marks: opts.total.toFixed(2),
        gpa: opts.gpa.toFixed(2),
        grade: opts.isFail ? 'F' : 'A',
        is_fail: opts.isFail,
        grading_scale_id: gradingScaleId,
        grading_scale_revision: 1,
        rule_version: 'v1',
        computed_at: opts.computedAt ?? new Date(),
      }),
    );
  }

  describe('create', () => {
    it('suggests RETAIN for a student missing a result on one of the selected exams (D6)', async () => {
      const passing = await buildStudent({ registration_number: 'REG-A', roll_number: 1 });
      await enrollActive(passing.id);
      await addResult(passing.id, { isFail: false, gpa: 4.5, total: 400 });

      const missing = await buildStudent({ registration_number: 'REG-B', roll_number: 2 });
      await enrollActive(missing.id);
      // No result for `missing` — a missing result counts as failed.

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      const entries = await entryRepo.find({ where: { run_id: run.id } });
      const passingEntry = entries.find((e) => e.student_id === passing.id);
      const missingEntry = entries.find((e) => e.student_id === missing.id);
      expect(passingEntry?.suggested_outcome).toBe(PromotionOutcome.PROMOTE);
      expect(missingEntry?.suggested_outcome).toBe(PromotionOutcome.RETAIN);
      expect(missingEntry?.passed_all).toBe(false);
    });
  });

  describe('merit source: a final result [70.3.3]', () => {
    async function makeFinal(status: FinalResultStatus) {
      return dataSource.getRepository(FinalResult).save({
        tenant_id: TENANT_ID,
        class_id: SOURCE_CLASS_ID,
        academic_year_id: SOURCE_YEAR_ID,
        status,
      });
    }
    async function addFinalRow(finalId: string, studentId: string, gpa: string, total: string) {
      return dataSource.getRepository(FinalResultRow).save({
        tenant_id: TENANT_ID,
        final_result_id: finalId,
        student_id: studentId,
        total_marks: total,
        gpa,
        grade: 'A',
        is_fail: false,
        grading_scale_id: gradingScaleId,
        grading_scale_revision: 1,
        rule_version: 'v1',
        computed_at: new Date(),
      });
    }
    const create = (extra: object) =>
      service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          algorithm: PlacementAlgorithm.BLOCK,
          ...extra,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

    it("ranks by the final's rows, not by the exams' plain mean, and stores final_result_id", async () => {
      const a = await buildStudent({ registration_number: 'REG-FA', roll_number: 1 });
      const b = await buildStudent({ registration_number: 'REG-FB', roll_number: 2 });
      await enrollActive(a.id);
      await enrollActive(b.id);
      // Exam plain mean says A first; the weighted final says B first.
      await addResult(a.id, { isFail: false, gpa: 5, total: 500 });
      await addResult(b.id, { isFail: false, gpa: 3, total: 300 });
      const final = await makeFinal(FinalResultStatus.PUBLISHED);
      await addFinalRow(final.id, a.id, '3.50', '350.00');
      await addFinalRow(final.id, b.id, '4.50', '450.00');

      const run = await create({ final_result_id: final.id });
      expect(run.final_result_id).toBe(final.id);
      expect(run.exam_ids).toEqual([]);
      const entries = await entryRepo.find({ where: { run_id: run.id } });
      expect(entries.find((e) => e.student_id === b.id)?.merit_rank).toBe(1);
      expect(entries.find((e) => e.student_id === a.id)?.merit_rank).toBe(2);

      // The exam_ids path is unchanged: plain mean, A first, no final stored.
      const examRun = await create({ exam_ids: [examId] });
      expect(examRun.final_result_id).toBeNull();
      const examEntries = await entryRepo.find({ where: { run_id: examRun.id } });
      expect(examEntries.find((e) => e.student_id === a.id)?.merit_rank).toBe(1);
    });

    it('refuses a final that is not PUBLISHED (422) and creates no run', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      const draft = await makeFinal(FinalResultStatus.DRAFT);
      await expect(create({ final_result_id: draft.id })).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(await runRepo.count()).toBe(0);
    });

    it("refuses another school's or another class's final (422)", async () => {
      const otherClassFinal = await dataSource.getRepository(FinalResult).save({
        tenant_id: TENANT_ID,
        class_id: TARGET_CLASS_ID,
        academic_year_id: SOURCE_YEAR_ID,
        status: FinalResultStatus.PUBLISHED,
      });
      await expect(create({ final_result_id: otherClassFinal.id })).rejects.toThrow(
        UnprocessableEntityException,
      );
      // Same id read as another tenant: not found, same sentence.
      const own = await makeFinal(FinalResultStatus.PUBLISHED);
      await expect(
        service.create(
          {
            source_class_id: SOURCE_CLASS_ID,
            target_academic_year_id: TARGET_YEAR_ID,
            algorithm: PlacementAlgorithm.BLOCK,
            final_result_id: own.id,
          },
          '00000000-0000-4000-8000-0000000000ff',
          ADMIN_USER_ID,
        ),
      ).rejects.toThrow();
    });

    it('refuses both sources, and neither (422)', async () => {
      const final = await makeFinal(FinalResultStatus.PUBLISHED);
      await expect(create({ final_result_id: final.id, exam_ids: [examId] })).rejects.toThrow(
        UnprocessableEntityException,
      );
      await expect(create({})).rejects.toThrow(UnprocessableEntityException);
    });

    it('commit refuses with 409 when the final was recomputed after the last refresh', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      const final = await makeFinal(FinalResultStatus.PUBLISHED);
      await addFinalRow(final.id, student.id, '4.00', '400.00');
      const run = await create({ final_result_id: final.id });
      await dataSource
        .getRepository(FinalResultRow)
        .update({ final_result_id: final.id }, { computed_at: new Date(Date.now() + 60_000) });
      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow(ConflictException);
    });

    it('commit refuses with 409 when a row was dropped from the final after the last refresh', async () => {
      const a = await buildStudent({ registration_number: 'REG-DA', roll_number: 1 });
      const b = await buildStudent({ registration_number: 'REG-DB', roll_number: 2 });
      await enrollActive(a.id);
      await enrollActive(b.id);
      const final = await makeFinal(FinalResultStatus.PUBLISHED);
      await addFinalRow(final.id, a.id, '4.00', '400.00');
      const bRow = await addFinalRow(final.id, b.id, '3.00', '300.00');
      const run = await create({ final_result_id: final.id });
      // A rebuild that leaves B out soft-deletes B's row and writes no new one.
      await dataSource
        .getRepository(FinalResultRow)
        .update({ id: bRow.id }, { deleted_at: new Date(Date.now() + 60_000) });
      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toMatchObject({ response: { details: { code: 'STALE_RESULTS' } } });
    });

    it('commits when a cohort student never had a row in the final (joined after the build)', async () => {
      // Regression: a row-count check called this "stale" forever; refresh could never clear it.
      const a = await buildStudent({ registration_number: 'REG-NA', roll_number: 1 });
      const late = await buildStudent({ registration_number: 'REG-NL', roll_number: 2 });
      await enrollActive(a.id);
      await enrollActive(late.id);
      const final = await makeFinal(FinalResultStatus.PUBLISHED);
      await addFinalRow(final.id, a.id, '4.00', '400.00');
      const run = await create({ final_result_id: final.id });
      const lateEntry = (await entryRepo.find({ where: { run_id: run.id } })).find(
        (e) => e.student_id === late.id,
      );
      // No row counts as not passed: ranked last, suggested RETAIN.
      expect(lateEntry?.suggested_outcome).toBe(PromotionOutcome.RETAIN);
      expect(lateEntry?.merit_rank).toBe(2);

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });
      const committed = await runRepo.findOneOrFail({ where: { id: run.id } });
      expect(committed.status).toBe(PromotionRunStatus.COMMITTED);
    });

    it('refuses a hard delete of a final that a run uses (FK, NO ACTION)', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      const final = await makeFinal(FinalResultStatus.PUBLISHED);
      await addFinalRow(final.id, student.id, '4.00', '400.00');
      await create({ final_result_id: final.id });
      await expect(
        dataSource.query('DELETE FROM final_results WHERE id = $1', [final.id]),
      ).rejects.toThrow();
    });
  });

  describe('target year must start later [2614]', () => {
    const dto = (target_academic_year_id: string) => ({
      source_class_id: SOURCE_CLASS_ID,
      target_academic_year_id,
      exam_ids: [examId],
      algorithm: PlacementAlgorithm.BLOCK,
    });

    it('refuses the source year as the target (422 TARGET_YEAR_NOT_LATER) and creates no run', async () => {
      await expect(
        service.create(dto(SOURCE_YEAR_ID), TENANT_ID, ADMIN_USER_ID),
      ).rejects.toMatchObject({ response: { details: { code: 'TARGET_YEAR_NOT_LATER' } } });
      expect(await runRepo.count()).toBe(0);
    });

    it('refuses a year that starts before the source year', async () => {
      const earlier = await dataSource.getRepository(AcademicYear).save({
        name: '2025',
        start_date: new Date('2025-01-01'),
        end_date: new Date('2025-12-31'),
        tenant_id: TENANT_ID,
      });
      await expect(service.create(dto(earlier.id), TENANT_ID, ADMIN_USER_ID)).rejects.toMatchObject(
        { response: { details: { code: 'TARGET_YEAR_NOT_LATER' } } },
      );
    });

    it('answers 404 for a target year that does not exist', async () => {
      await expect(
        service.create(dto('00000000-0000-4000-8000-0000000000ff'), TENANT_ID, ADMIN_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts the later year', async () => {
      const run = await service.create(dto(TARGET_YEAR_ID), TENANT_ID, ADMIN_USER_ID);
      expect(run.status).toBe(PromotionRunStatus.DRAFT);
    });

    it('commit re-checks: a target year edited to start earlier promotes nobody', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });
      const run = await service.create(dto(TARGET_YEAR_ID), TENANT_ID, ADMIN_USER_ID);

      await dataSource.query(`UPDATE academic_years SET start_date = '2025-06-01' WHERE id = $1`, [
        TARGET_YEAR_ID,
      ]);
      try {
        await expect(
          service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
        ).rejects.toMatchObject({ response: { details: { code: 'TARGET_YEAR_NOT_LATER' } } });
      } finally {
        await dataSource.query(
          `UPDATE academic_years SET start_date = '2027-01-01' WHERE id = $1`,
          [TARGET_YEAR_ID],
        );
      }
      expect(await enrollmentRepo.count({ where: { academic_year_id: TARGET_YEAR_ID } })).toBe(0);
      expect((await runRepo.findOneByOrFail({ id: run.id })).status).toBe(PromotionRunStatus.DRAFT);
    });

    it("commit checks against the run's recorded source year, not the class's current year", async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });
      const run = await service.create(dto(TARGET_YEAR_ID), TENANT_ID, ADMIN_USER_ID);
      const earlier = await dataSource.getRepository(AcademicYear).save({
        name: '2024',
        start_date: new Date('2024-01-01'),
        end_date: new Date('2024-12-31'),
        tenant_id: TENANT_ID,
      });

      // Class moved to an older year (e.g. a workbook restore) and target edited to start
      // between that year and the recorded source year (2026-01-01).
      await dataSource.query(`UPDATE classes SET academic_year_id = $1 WHERE id = $2`, [
        earlier.id,
        SOURCE_CLASS_ID,
      ]);
      await dataSource.query(`UPDATE academic_years SET start_date = '2025-06-01' WHERE id = $1`, [
        TARGET_YEAR_ID,
      ]);
      try {
        await expect(
          service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
        ).rejects.toMatchObject({ response: { details: { code: 'TARGET_YEAR_NOT_LATER' } } });
      } finally {
        await dataSource.query(`UPDATE classes SET academic_year_id = $1 WHERE id = $2`, [
          SOURCE_YEAR_ID,
          SOURCE_CLASS_ID,
        ]);
        await dataSource.query(
          `UPDATE academic_years SET start_date = '2027-01-01' WHERE id = $1`,
          [TARGET_YEAR_ID],
        );
      }
      expect(await enrollmentRepo.count({ where: { academic_year_id: TARGET_YEAR_ID } })).toBe(0);
    });
  });

  describe('patchEntries', () => {
    it('throws 422 when overriding without a note', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await expect(
        service.patchEntries(
          run.id,
          [{ student_id: student.id, final_outcome: PromotionOutcome.RETAIN }],
          TENANT_ID,
          ADMIN_USER_ID,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('refresh', () => {
    it('keeps an overridden final_outcome and note after refresh (D24)', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.patchEntries(
        run.id,
        [
          {
            student_id: student.id,
            final_outcome: PromotionOutcome.RETAIN,
            override_note: 'Manual hold',
          },
        ],
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.refresh(run.id, TENANT_ID);

      const entry = await entryRepo.findOne({ where: { run_id: run.id, student_id: student.id } });
      expect(entry?.final_outcome).toBe(PromotionOutcome.RETAIN);
      expect(entry?.override_note).toBe('Manual hold');
      expect(entry?.is_override).toBe(true);
    });

    const createDraft = () =>
      service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

    async function passingStudent(roll: number): Promise<Student> {
      const s = await buildStudent({ registration_number: `REG-R${roll}`, roll_number: roll });
      await enrollActive(s.id);
      await addResult(s.id, { isFail: false, gpa: 4.0, total: 400 });
      return s;
    }

    // LIFE-06: a leaver used to block commit with COHORT_CHANGED forever.
    it('drops a departed student, keeps the override, and commit then succeeds (LIFE-06)', async () => {
      const a = await passingStudent(1);
      await passingStudent(2);
      const c = await passingStudent(3);
      const run = await createDraft();
      await service.patchEntries(
        run.id,
        [
          {
            student_id: a.id,
            final_outcome: PromotionOutcome.RETAIN,
            override_note: 'Manual hold',
          },
        ],
        TENANT_ID,
        ADMIN_USER_ID,
      );
      // Same effect as StudentLifecycleService.leave on the source enrollment.
      await enrollmentRepo.update(
        { student_id: c.id, tenant_id: TENANT_ID },
        { enrollment_status: EnrollmentStatus.TRANSFERRED },
      );

      await service.refresh(run.id, TENANT_ID);

      const entries = await entryRepo.find({ where: { run_id: run.id } });
      expect(entries.map((e) => e.student_id)).not.toContain(c.id);
      expect(entries).toHaveLength(2);
      const aEntry = entries.find((e) => e.student_id === a.id);
      expect(aEntry?.final_outcome).toBe(PromotionOutcome.RETAIN);
      expect(aEntry?.override_note).toBe('Manual hold');

      // The run's override_count stays correct after the removal.
      expect((await runRepo.findOneOrFail({ where: { id: run.id } })).override_count).toBe(1);

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });
      const committed = await runRepo.findOneOrFail({ where: { id: run.id } });
      expect(committed.status).toBe(PromotionRunStatus.COMMITTED);
    });

    it('LIFE-17: commit writes one PromotionRun audit row with override_count and approver', async () => {
      const a = await passingStudent(1);
      await passingStudent(2);
      const run = await createDraft();
      await service.patchEntries(
        run.id,
        [{ student_id: a.id, final_outcome: PromotionOutcome.RETAIN, override_note: 'hold' }],
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      const rows = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_type: 'PromotionRun', entity_id: run.id, tenant_id: TENANT_ID } });
      expect(rows).toHaveLength(1);
      expect(rows[0].performed_by_user_id).toBe(ADMIN_USER_ID);
      const committed = await runRepo.findOneOrFail({ where: { id: run.id } });
      expect(rows[0].new_values).toMatchObject({
        event: 'PROMOTION_COMMITTED',
        promoted_count: 1,
        override_count: 1,
        approved_by_user_id: committed.approved_by_user_id,
      });
    });

    it('override_count drops when the removed entry was the overridden one', async () => {
      const a = await passingStudent(1);
      await passingStudent(2);
      const run = await createDraft();
      await service.patchEntries(
        run.id,
        [{ student_id: a.id, final_outcome: PromotionOutcome.RETAIN, override_note: 'hold' }],
        TENANT_ID,
        ADMIN_USER_ID,
      );
      await enrollmentRepo.update(
        { student_id: a.id, tenant_id: TENANT_ID },
        { enrollment_status: EnrollmentStatus.TRANSFERRED },
      );

      await service.refresh(run.id, TENANT_ID, ADMIN_USER_ID);

      expect((await runRepo.findOneOrFail({ where: { id: run.id } })).override_count).toBe(0);
      // [#2268] The vanished override stays answerable: one audit row names it and the refresher.
      const rows = await dataSource
        .getRepository(AuditLog)
        .find({ where: { entity_type: 'PromotionRun', entity_id: run.id, tenant_id: TENANT_ID } });
      expect(rows).toHaveLength(1);
      expect(rows[0].performed_by_user_id).toBe(ADMIN_USER_ID);
      expect(rows[0].new_values).toMatchObject({
        event: 'PROMOTION_REFRESHED',
        removed_student_ids: [a.id],
        removed_overrides: [
          { student_id: a.id, final_outcome: PromotionOutcome.RETAIN, override_note: 'hold' },
        ],
      });
    });

    it('commit refuses with COHORT_CHANGED when a student joined after the last refresh', async () => {
      await passingStudent(1);
      const run = await createDraft();
      await passingStudent(2); // joined after create, no refresh yet

      const err = await service
        .commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} })
        .catch((e) => e);
      expect(err.getResponse?.().details?.code).toBe('COHORT_CHANGED');

      await service.refresh(run.id, TENANT_ID);
      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });
    });

    it('a student readmitted into the source class after create gets an entry with a suggested outcome', async () => {
      await passingStudent(1);
      const run = await createDraft();
      const joiner = await passingStudent(2);

      await service.refresh(run.id, TENANT_ID);

      const entry = await entryRepo.findOne({
        where: { run_id: run.id, student_id: joiner.id },
      });
      expect(entry?.suggested_outcome).toBe(PromotionOutcome.PROMOTE);
      expect(entry?.final_outcome).toBe(PromotionOutcome.PROMOTE);
      expect(entry?.is_override).toBe(false);
      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });
    });

    it('never touches an overridden entry outcome, note or group', async () => {
      const a = await passingStudent(1);
      const run = await createDraft();
      await service.patchEntries(
        run.id,
        [
          {
            student_id: a.id,
            final_outcome: PromotionOutcome.RETAIN,
            override_note: 'keep me',
            group_name: 'Science',
          },
        ],
        TENANT_ID,
        ADMIN_USER_ID,
      );
      await passingStudent(2); // joiner forces a non-trivial refresh

      await service.refresh(run.id, TENANT_ID);

      const entry = await entryRepo.findOneOrFail({
        where: { run_id: run.id, student_id: a.id },
      });
      expect(entry.final_outcome).toBe(PromotionOutcome.RETAIN);
      expect(entry.override_note).toBe('keep me');
      expect(entry.group_name).toBe('Science');
    });
  });

  describe('commit', () => {
    // LIFE-02: a soft-deleted student whose enrollment is still ACTIVE (old data)
    // must not become a run entry, or the commit fails with "Student not found".
    it('ignores a soft-deleted student with an ACTIVE enrollment and still commits', async () => {
      const live = await buildStudent();
      await enrollActive(live.id);
      await addResult(live.id, { isFail: false, gpa: 4.0, total: 400 });
      const gone = await buildStudent({ roll_number: 2 });
      await enrollActive(gone.id);
      await addResult(gone.id, { isFail: false, gpa: 4.0, total: 400 });
      await studentRepo.softDelete({ id: gone.id, tenant_id: TENANT_ID });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );
      const entries = await entryRepo.find({ where: { run_id: run.id } });
      expect(entries.map((e) => e.student_id)).toEqual([live.id]);

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });
      const committed = await runRepo.findOne({ where: { id: run.id } });
      expect(committed?.status).toBe(PromotionRunStatus.COMMITTED);
    });

    it('creates enrollments with no overrides, and findCurrentByStudent returns the target year', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      const committedRun = await runRepo.findOne({ where: { id: run.id } });
      expect(committedRun?.status).toBe(PromotionRunStatus.COMMITTED);

      const current = await enrollmentRepo.findOne({
        where: {
          student_id: student.id,
          academic_year_id: TARGET_YEAR_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(current).not.toBeNull();
      expect(current?.class_id).toBe(TARGET_CLASS_ID);
    });

    it('refuses a GRADUATE entry saved on a normal run and changes no student (#2925)', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });
      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );
      // A draft written before patchEntries refused GRADUATE on a normal run.
      await entryRepo.update(
        { run_id: run.id, student_id: student.id },
        { final_outcome: PromotionOutcome.GRADUATE },
      );

      const err = await service
        .commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} })
        .catch((e) => e);
      expect(err.getResponse?.().details?.code).toBe('GRADUATE_ONLY_IN_GRADUATION_RUN');
      const after = await studentRepo.findOneOrFail({ where: { id: student.id } });
      expect(after.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      expect((await runRepo.findOneOrFail({ where: { id: run.id } })).status).toBe(
        PromotionRunStatus.DRAFT,
      );
    });

    it('renumbers a pre-existing occupant of the target section to n+1 (D19)', async () => {
      const occupant = await buildStudent({
        registration_number: 'REG-OCC',
        class_section_id: TARGET_SECTION_ID,
        roll_number: 1,
      });
      await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: occupant.id,
          class_id: TARGET_CLASS_ID,
          section_id: TARGET_SECTION_ID,
          academic_year_id: TARGET_YEAR_ID,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        }),
      );

      const promoted = await buildStudent({ registration_number: 'REG-PROMOTED' });
      await enrollActive(promoted.id);
      await addResult(promoted.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      const renumberedOccupant = await studentRepo.findOne({ where: { id: occupant.id } });
      expect(renumberedOccupant?.roll_number).toBe(2); // n=1 promoted student, occupant pushed to 2
    });

    it('rolls back fully if one enrollment insert fails', async () => {
      const s1 = await buildStudent({ registration_number: 'REG-1', roll_number: 1 });
      await enrollActive(s1.id);
      await addResult(s1.id, { isFail: false, gpa: 4.0, total: 400 });

      const s2 = await buildStudent({ registration_number: 'REG-2', roll_number: 2 });
      await enrollActive(s2.id);
      await addResult(s2.id, { isFail: false, gpa: 3.5, total: 380 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      // Force EnrollmentService.createInTransaction to fail for s2 by
      // giving it a pre-existing ACTIVE enrollment in the target year —
      // the service's own duplicate-active check throws ConflictException.
      await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: s2.id,
          class_id: TARGET_CLASS_ID,
          section_id: TARGET_SECTION_ID,
          academic_year_id: TARGET_YEAR_ID,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        }),
      );

      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow();

      const stillDraft = await runRepo.findOne({ where: { id: run.id } });
      expect(stillDraft?.status).toBe(PromotionRunStatus.DRAFT);

      // s1's enrollment must not have been created either — the whole
      // commit is one transaction.
      const s1Enrollments = await enrollmentRepo.find({
        where: { student_id: s1.id, academic_year_id: TARGET_YEAR_ID },
      });
      expect(s1Enrollments).toHaveLength(0);
    });

    it('refuses commit with 409 when a selected exam has a result newer than refreshed_at (stale results)', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      // Simulate a recompute after the run's refreshed_at snapshot: the
      // `(exam_id, student_id)` result is unique, so a reprocess updates
      // the existing row's computed_at rather than inserting a new one.
      await resultRepo.update(
        { exam_id: examId, student_id: student.id },
        { gpa: '4.20', total_marks: '410.00', computed_at: new Date(Date.now() + 60_000) },
      );

      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow(ConflictException);
    });

    it('a second commit attempt on an already-COMMITTED run returns 409', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow(ConflictException);
    });

    // Whole-class graduation fixture: a grade-12 class, one student with an ACTIVE
    // source-year enrollment and a passing result, and a built (uncommitted) run.
    async function buildGraduationRun(opts: { failing?: boolean } = {}) {
      // A class with no numeric_grade + 1 match and numeric_grade set →
      // resolveTarget graduates the whole run (target_class_id = null).
      const gradClassId = '00000000-0000-4000-8000-000000010030';
      const gradSectionId = '00000000-0000-4000-8000-000000010031';
      const classRepo = dataSource.getRepository(Class);
      const sectionRepo = dataSource.getRepository(ClassSection);
      await classRepo.save(
        classRepo.create({
          id: gradClassId,
          name: 'Class Twelve',
          numeric_grade: 12,
          academic_year_id: SOURCE_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await sectionRepo.save(
        sectionRepo.create({
          id: gradSectionId,
          section_name: 'A',
          class_id: gradClassId,
          tenant_id: TENANT_ID,
        }),
      );
      // No retain class on purpose: nobody is retained, so none is needed (#2924).

      const gradExam = await examRepo.save(
        examRepo.create({
          tenant_id: TENANT_ID,
          academic_year_id: SOURCE_YEAR_ID,
          class_id: gradClassId,
          name: 'Final Exam (Grad)',
          kind: ExamKind.TERM,
          status: ExamStatus.PUBLISHED,
        }),
      );

      const student = await buildStudent({
        registration_number: 'REG-GRAD',
        class_section_id: gradSectionId,
      });
      const enrollment = await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: student.id,
          class_id: gradClassId,
          section_id: gradSectionId,
          academic_year_id: SOURCE_YEAR_ID,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        }),
      );
      await resultRepo.save(
        resultRepo.create({
          tenant_id: TENANT_ID,
          exam_id: gradExam.id,
          student_id: student.id,
          total_marks: '450.00',
          gpa: '5.00',
          grade: 'A+',
          is_fail: opts.failing ?? false,
          grading_scale_id: gradingScaleId,
          grading_scale_revision: 1,
          rule_version: 'v1',
          computed_at: new Date(),
        }),
      );

      const run = await service.create(
        {
          source_class_id: gradClassId,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [gradExam.id],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );
      return { run, student, enrollment };
    }

    it('sets GRADUATED on both the enrollment and the student for a whole-class graduation run (D18)', async () => {
      const { run, student, enrollment } = await buildGraduationRun();

      const entry = await entryRepo.findOne({ where: { run_id: run.id, student_id: student.id } });
      expect(entry?.suggested_outcome).toBe(PromotionOutcome.GRADUATE);

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      const graduatedStudent = await studentRepo.findOne({ where: { id: student.id } });
      expect(graduatedStudent?.enrollment_status).toBe(EnrollmentStatus.GRADUATED);
      const graduatedEnrollment = await enrollmentRepo.findOne({ where: { id: enrollment.id } });
      expect(graduatedEnrollment?.enrollment_status).toBe(EnrollmentStatus.GRADUATED);

      // Exactly one GRADUATED lifecycle event, tied to the source enrollment/year (#1187).
      const events = await dataSource
        .getRepository(StudentLifecycleEvent)
        .find({ where: { student_id: student.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        tenant_id: TENANT_ID,
        enrollment_id: enrollment.id,
        academic_year_id: SOURCE_YEAR_ID,
        event_type: StudentLifecycleEventType.GRADUATED,
        reason: 'promotion: graduated',
        recorded_by_user_id: ADMIN_USER_ID,
      });

      // Replay: second commit 409s and adds no second event.
      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow(ConflictException);
      expect(
        await dataSource
          .getRepository(StudentLifecycleEvent)
          .count({ where: { student_id: student.id } }),
      ).toBe(1);
    });

    it('refuses create with RETAIN_CLASS_MISSING when a failing student would be retained, and leaves no run row (#2924)', async () => {
      await expect(buildGraduationRun({ failing: true })).rejects.toMatchObject({
        response: { details: { code: 'RETAIN_CLASS_MISSING' } },
      });
      expect(await dataSource.getRepository(PromotionRun).count()).toBe(0);
    });

    it('carries no choice-group pick for a whole-class graduation run (D45)', async () => {
      const { run, student } = await buildGraduationRun();
      const gradClassId = '00000000-0000-4000-8000-000000010030';
      const [{ id: subjectId }] = await dataSource.query(
        `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'ISL', 'ISL') RETURNING id`,
        [TENANT_ID],
      );
      const [{ id: csId }] = await dataSource.query(
        `INSERT INTO class_subjects (tenant_id, class_id, subject_id, academic_year_id, choice_group)
         VALUES ($1, $2, $3, $4, 'Religion') RETURNING id`,
        [TENANT_ID, gradClassId, subjectId, SOURCE_YEAR_ID],
      );
      await dataSource.query(
        `INSERT INTO student_subject_choices (tenant_id, student_id, class_subject_id, academic_year_id, is_fourth, choice_group)
         VALUES ($1, $2, $3, $4, false, 'Religion')`,
        [TENANT_ID, student.id, csId, SOURCE_YEAR_ID],
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      const rows = await dataSource.query(
        `SELECT academic_year_id FROM student_subject_choices WHERE student_id = $1`,
        [student.id],
      );
      expect(rows).toEqual([{ academic_year_id: SOURCE_YEAR_ID }]);
    });

    it('rolls back the GRADUATED event and both status writes if the commit fails after the event insert', async () => {
      const { run, student, enrollment } = await buildGraduationRun();
      const lifecycle = (service as unknown as { studentLifecycleService: StudentLifecycleService })
        .studentLifecycleService;
      const realRecordEvent = lifecycle.recordEvent.bind(lifecycle);
      // Let the event row really be inserted inside the transaction, then fail.
      const spy = vi
        .spyOn(lifecycle, 'recordEvent')
        .mockImplementationOnce(async (manager, input) => {
          await realRecordEvent(manager, input);
          throw new Error('boom after event insert');
        });

      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow();
      spy.mockRestore();

      // Everything the commit wrote is undone together: no event, statuses still ACTIVE.
      expect(
        await dataSource
          .getRepository(StudentLifecycleEvent)
          .count({ where: { student_id: student.id } }),
      ).toBe(0);
      const studentAfter = await studentRepo.findOne({ where: { id: student.id } });
      expect(studentAfter?.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      const enrollmentAfter = await enrollmentRepo.findOne({ where: { id: enrollment.id } });
      expect(enrollmentAfter?.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it('promoted (non-graduate) students get no lifecycle event', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });
      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );
      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });
      expect(
        await dataSource
          .getRepository(StudentLifecycleEvent)
          .count({ where: { student_id: student.id } }),
      ).toBe(0);
    });

    it('a student who left after the run was built aborts the commit: no event, no status write', async () => {
      // A GRADUATE-outcome student, so "no event" is a meaningful assertion.
      const { run, student, enrollment } = await buildGraduationRun();
      await enrollmentRepo.update(
        { id: enrollment.id },
        { enrollment_status: EnrollmentStatus.TRANSFERRED },
      );

      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow(ConflictException);
      expect(
        await dataSource
          .getRepository(StudentLifecycleEvent)
          .count({ where: { student_id: student.id } }),
      ).toBe(0);
      const after = await enrollmentRepo.findOne({ where: { id: enrollment.id } });
      expect(after?.enrollment_status).toBe(EnrollmentStatus.TRANSFERRED);
    });

    it('leaves an already-committed run and its results intact after a source exam is reprocessed (with #994)', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );
      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      // Reprocessing the source exam after commit (e.g. a mark correction)
      // must not touch the already-committed run or its entries. Same
      // unique-index reasoning as the stale-results test above: update in
      // place, don't insert a second row.
      await resultRepo.update(
        { exam_id: examId, student_id: student.id },
        { gpa: '4.50', total_marks: '420.00', computed_at: new Date(Date.now() + 5000) },
      );

      const committedRun = await runRepo.findOne({ where: { id: run.id } });
      const entry = await entryRepo.findOne({ where: { run_id: run.id, student_id: student.id } });
      expect(committedRun?.status).toBe(PromotionRunStatus.COMMITTED);
      expect(entry?.final_outcome).toBe(PromotionOutcome.PROMOTE);
    });
  });

  describe('CONDITIONAL (SENSE-13)', () => {
    async function conditionalCommitted() {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: true, gpa: 0, total: 100 });
      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );
      await service.patchEntries(
        run.id,
        [
          {
            student_id: student.id,
            final_outcome: PromotionOutcome.CONDITIONAL,
            override_note: 'Re-test by March',
          },
        ],
        TENANT_ID,
        ADMIN_USER_ID,
      );
      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });
      return { student, run };
    }

    it('commit moves a CONDITIONAL student into the target class with a new ACTIVE enrollment and roll number', async () => {
      const { student, run } = await conditionalCommitted();

      const enrollment = await enrollmentRepo.findOneOrFail({
        where: {
          student_id: student.id,
          academic_year_id: TARGET_YEAR_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(enrollment.class_id).toBe(TARGET_CLASS_ID);
      const entry = await entryRepo.findOneOrFail({
        where: { run_id: run.id, student_id: student.id },
      });
      expect(entry.target_enrollment_id).toBe(enrollment.id);
      expect(entry.new_roll_number).not.toBeNull();
      const inRetain = await enrollmentRepo.count({
        where: { student_id: student.id, class_id: RETAIN_CLASS_ID },
      });
      expect(inRetain).toBe(0);
    });

    it('findStudentOverrides returns the CONDITIONAL entry with its note', async () => {
      const { student } = await conditionalCommitted();

      const rows = await service.findStudentOverrides(student.id, TENANT_ID);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        final_outcome: 'CONDITIONAL',
        override_note: 'Re-test by March',
      });
    });
  });

  describe('commit — choice-group carry-forward (D45)', () => {
    const TENANT_B = '00000000-0000-4000-8000-0000000b0001';

    async function subject(tenant: string, code: string): Promise<string> {
      const [r] = await dataSource.query(
        `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, $2, $2) RETURNING id`,
        [tenant, code],
      );
      return r.id;
    }
    async function classSubject(
      classId: string,
      yearId: string,
      subjectId: string,
      group: string | null,
      tenant = TENANT_ID,
      deleted = false,
    ): Promise<string> {
      const [r] = await dataSource.query(
        `INSERT INTO class_subjects (tenant_id, class_id, subject_id, academic_year_id, choice_group, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenant, classId, subjectId, yearId, group, deleted ? new Date() : null],
      );
      return r.id;
    }
    // choice_group is insert:false in the entity and trigger-owned in real DBs;
    // synchronize:true has no triggers, so it is seeded explicitly here.
    async function pick(
      studentId: string,
      csId: string,
      yearId: string,
      group: string | null,
      isFourth = false,
      tenant = TENANT_ID,
    ) {
      await dataSource.query(
        `INSERT INTO student_subject_choices (tenant_id, student_id, class_subject_id, academic_year_id, is_fourth, choice_group)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenant, studentId, csId, yearId, isFourth, group],
      );
    }
    async function picks(studentId: string) {
      return dataSource.query(
        `SELECT class_subject_id, academic_year_id, is_fourth, choice_group
         FROM student_subject_choices WHERE student_id = $1 AND academic_year_id = $2`,
        [studentId, TARGET_YEAR_ID],
      );
    }
    // fail=true → suggested (and final) outcome RETAIN into RETAIN_CLASS_ID.
    async function promote(fail = false) {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: fail, gpa: fail ? 0 : 4.0, total: fail ? 100 : 400 });
      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );
      return { student, run };
    }
    const commit = (id: string) =>
      service.commit(id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

    it('carries picks for a CONDITIONAL student onto the target class subject', async () => {
      const islam = await subject(TENANT_ID, 'ISL');
      const oldCs = await classSubject(SOURCE_CLASS_ID, SOURCE_YEAR_ID, islam, 'Religion');
      const newCs = await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, islam, 'Religion');
      const { student, run } = await promote(true);
      await pick(student.id, oldCs, SOURCE_YEAR_ID, 'Religion');
      await service.patchEntries(
        run.id,
        [
          {
            student_id: student.id,
            final_outcome: PromotionOutcome.CONDITIONAL,
            override_note: 'Re-test by March',
          },
        ],
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await commit(run.id);

      expect((await picks(student.id)).map((p: any) => p.class_subject_id)).toEqual([newCs]);
    });

    it('carries a same-named group pick into the target year', async () => {
      const islam = await subject(TENANT_ID, 'ISL');
      const oldCs = await classSubject(SOURCE_CLASS_ID, SOURCE_YEAR_ID, islam, 'Religion');
      const newCs = await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, islam, 'Religion');
      const { student, run } = await promote();
      await pick(student.id, oldCs, SOURCE_YEAR_ID, 'Religion');

      await commit(run.id);

      expect(await picks(student.id)).toEqual([
        {
          class_subject_id: newCs,
          academic_year_id: TARGET_YEAR_ID,
          is_fourth: false,
          choice_group: 'Religion',
        },
      ]);
    });

    it("carries a RETAIN student's picks into the retain class, one per group", async () => {
      const islam = await subject(TENANT_ID, 'ISL');
      const bio = await subject(TENANT_ID, 'BIO');
      const oldIsl = await classSubject(SOURCE_CLASS_ID, SOURCE_YEAR_ID, islam, 'Religion');
      const oldBio = await classSubject(SOURCE_CLASS_ID, SOURCE_YEAR_ID, bio, 'Elective');
      const newIsl = await classSubject(RETAIN_CLASS_ID, TARGET_YEAR_ID, islam, 'Religion');
      const newBio = await classSubject(RETAIN_CLASS_ID, TARGET_YEAR_ID, bio, 'Elective');
      const { student, run } = await promote(true);
      await pick(student.id, oldIsl, SOURCE_YEAR_ID, 'Religion');
      await pick(student.id, oldBio, SOURCE_YEAR_ID, 'Elective');

      await commit(run.id);

      const ids = (await picks(student.id)).map((p: any) => p.class_subject_id).sort();
      expect(ids).toEqual([newIsl, newBio].sort());
    });

    it('gives no pick when the target offers the subject in a differently-named group or no group', async () => {
      const islam = await subject(TENANT_ID, 'ISL');
      const hindu = await subject(TENANT_ID, 'HIN');
      const oldCs = await classSubject(SOURCE_CLASS_ID, SOURCE_YEAR_ID, islam, 'Religion');
      await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, islam, null);
      await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, hindu, 'Faith');
      const { student, run } = await promote();
      await pick(student.id, oldCs, SOURCE_YEAR_ID, 'Religion');

      await commit(run.id);

      expect(await picks(student.id)).toEqual([]);
    });

    it('does not copy a fourth-subject pick', async () => {
      const bio = await subject(TENANT_ID, 'BIO');
      const oldCs = await classSubject(SOURCE_CLASS_ID, SOURCE_YEAR_ID, bio, null);
      await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, bio, null);
      const { student, run } = await promote();
      await pick(student.id, oldCs, SOURCE_YEAR_ID, null, true);

      await commit(run.id);

      expect(await picks(student.id)).toEqual([]);
    });

    it('does not give picks to a detached (soft-deleted) new class subject (D49)', async () => {
      const islam = await subject(TENANT_ID, 'ISL');
      const oldCs = await classSubject(SOURCE_CLASS_ID, SOURCE_YEAR_ID, islam, 'Religion');
      await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, islam, 'Religion', TENANT_ID, true);
      const { student, run } = await promote();
      await pick(student.id, oldCs, SOURCE_YEAR_ID, 'Religion');

      await commit(run.id);

      expect(await picks(student.id)).toEqual([]);
    });

    it('still carries a pick whose OLD class subject is soft-deleted', async () => {
      const islam = await subject(TENANT_ID, 'ISL');
      const oldCs = await classSubject(
        SOURCE_CLASS_ID,
        SOURCE_YEAR_ID,
        islam,
        'Religion',
        TENANT_ID,
        true,
      );
      const newCs = await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, islam, 'Religion');
      const { student, run } = await promote();
      await pick(student.id, oldCs, SOURCE_YEAR_ID, 'Religion');

      await commit(run.id);

      expect((await picks(student.id)).map((p: any) => p.class_subject_id)).toEqual([newCs]);
    });

    it('leaves an existing target-year pick untouched (ON CONFLICT DO NOTHING)', async () => {
      const islam = await subject(TENANT_ID, 'ISL');
      const hindu = await subject(TENANT_ID, 'HIN');
      const oldCs = await classSubject(SOURCE_CLASS_ID, SOURCE_YEAR_ID, islam, 'Religion');
      await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, islam, 'Religion');
      const hinduNew = await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, hindu, 'Religion');
      const { student, run } = await promote();
      await pick(student.id, oldCs, SOURCE_YEAR_ID, 'Religion');
      await pick(student.id, hinduNew, TARGET_YEAR_ID, 'Religion'); // already picked in the group

      await commit(run.id);

      expect((await picks(student.id)).map((p: any) => p.class_subject_id)).toEqual([hinduNew]);
    });

    it("leaves another tenant's picks untouched and never crosses tenants", async () => {
      await dataSource.query(
        `INSERT INTO schools (id, name, slug) VALUES ($1, 'B', 'carry-school-b')
         ON CONFLICT DO NOTHING`,
        [TENANT_B],
      );
      const islam = await subject(TENANT_ID, 'ISL');
      const islamB = await subject(TENANT_B, 'ISL');
      const oldCs = await classSubject(SOURCE_CLASS_ID, SOURCE_YEAR_ID, islam, 'Religion');
      await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, islam, 'Religion');
      // Tenant B offers the same subject-name in the target class: must never receive a pick.
      const oldCsB = await classSubject(
        SOURCE_CLASS_ID,
        SOURCE_YEAR_ID,
        islamB,
        'Religion',
        TENANT_B,
      );
      await classSubject(TARGET_CLASS_ID, TARGET_YEAR_ID, islamB, 'Religion', TENANT_B);
      const { student, run } = await promote();
      await pick(student.id, oldCs, SOURCE_YEAR_ID, 'Religion');
      const studentB = await buildStudent({
        tenant_id: TENANT_B,
        registration_number: 'REG-B1',
        roll_number: 9,
      });
      await pick(studentB.id, oldCsB, SOURCE_YEAR_ID, 'Religion', false, TENANT_B);

      await commit(run.id);

      const b = await dataSource.query(
        `SELECT academic_year_id FROM student_subject_choices WHERE tenant_id = $1`,
        [TENANT_B],
      );
      expect(b).toEqual([{ academic_year_id: SOURCE_YEAR_ID }]);
      expect(await picks(student.id)).toHaveLength(1);
    });

    afterEach(async () => {
      await dataSource.query('DELETE FROM student_subject_choices');
      await dataSource.query('DELETE FROM class_subjects');
      await dataSource.query('DELETE FROM subjects');
      await dataSource.query(`DELETE FROM students WHERE tenant_id = $1`, [TENANT_B]);
      await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    });
  });

  describe('remove', () => {
    // B6 — remove() must not delete a run that committed between the read
    // and the delete: the delete's own WHERE now carries status = DRAFT,
    // so a run that's already COMMITTED by the time remove() reaches the
    // delete leaves zero rows affected and throws instead of destroying
    // the committed run's audit trail.
    it('refuses to delete a run that is COMMITTED, and leaves its entries intact', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} });

      // remove()'s own initial findOne read sees the (now-stale) DRAFT
      // status it was called with is irrelevant here — commit() already
      // flipped the row to COMMITTED before remove() is even invoked, so
      // this exercises the same "status changed under us" path the DELETE
      // WHERE guards against.
      await expect(service.remove(run.id, TENANT_ID)).rejects.toThrow(ConflictException);

      const stillThere = await runRepo.findOne({ where: { id: run.id } });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.status).toBe(PromotionRunStatus.COMMITTED);
      const entries = await entryRepo.find({ where: { run_id: run.id } });
      expect(entries.length).toBeGreaterThan(0);
    });

    it('deletes a DRAFT run', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await service.remove(run.id, TENANT_ID);

      const gone = await runRepo.findOne({ where: { id: run.id } });
      expect(gone).toBeNull();
    });
  });

  describe('findRetainClass (M1 — null-grade source)', () => {
    // A null numeric_grade has no identity signal to match a retain class
    // on: an IsNull() lookup would previously wildcard-match ANY other
    // null-grade class in the target year (e.g. retaining Playgroup into
    // Nursery). commit()'s RETAIN path must instead refuse with
    // RETAIN_CLASS_MISSING rather than guess.
    it('does not wildcard-match an unrelated null-grade class as the retain class on commit', async () => {
      const classRepo = dataSource.getRepository(Class);
      const sectionRepo = dataSource.getRepository(ClassSection);

      // Source: a null-grade class (e.g. "Playgroup") with an explicit
      // target class chosen (so resolveTarget's create-time PICK_TARGET_CLASS
      // guard doesn't block before we even get to commit).
      const playgroupId = '00000000-0000-4000-8000-000000010060';
      const playgroupSectionId = '00000000-0000-4000-8000-000000010061';
      await classRepo.save(
        classRepo.create({
          id: playgroupId,
          name: 'Playgroup',
          numeric_grade: null,
          academic_year_id: SOURCE_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await sectionRepo.save(
        sectionRepo.create({
          id: playgroupSectionId,
          section_name: 'A',
          class_id: playgroupId,
          tenant_id: TENANT_ID,
        }),
      );

      // An unrelated null-grade class in the target year that must NOT be
      // picked as the retain class (e.g. "Nursery").
      const nurseryId = '00000000-0000-4000-8000-000000010062';
      const nurserySectionId = '00000000-0000-4000-8000-000000010063';
      await classRepo.save(
        classRepo.create({
          id: nurseryId,
          name: 'Nursery',
          numeric_grade: null,
          academic_year_id: TARGET_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await sectionRepo.save(
        sectionRepo.create({
          id: nurserySectionId,
          section_name: 'A',
          class_id: nurseryId,
          tenant_id: TENANT_ID,
        }),
      );

      // The chosen (explicit) target class for a promoted playgroup student.
      const targetForPlaygroupId = '00000000-0000-4000-8000-000000010064';
      const targetForPlaygroupSectionId = '00000000-0000-4000-8000-000000010065';
      await classRepo.save(
        classRepo.create({
          id: targetForPlaygroupId,
          name: 'Playgroup Next Year',
          numeric_grade: null,
          academic_year_id: TARGET_YEAR_ID,
          tenant_id: TENANT_ID,
        }),
      );
      await sectionRepo.save(
        sectionRepo.create({
          id: targetForPlaygroupSectionId,
          section_name: 'A',
          class_id: targetForPlaygroupId,
          tenant_id: TENANT_ID,
        }),
      );

      const playgroupExam = await examRepo.save(
        examRepo.create({
          tenant_id: TENANT_ID,
          academic_year_id: SOURCE_YEAR_ID,
          class_id: playgroupId,
          name: 'Playgroup Assessment',
          kind: ExamKind.TERM,
          status: ExamStatus.PUBLISHED,
        }),
      );

      const student = await buildStudent({
        registration_number: 'REG-PG',
        class_section_id: playgroupSectionId,
      });
      await enrollmentRepo.save(
        enrollmentRepo.create({
          student_id: student.id,
          class_id: playgroupId,
          section_id: playgroupSectionId,
          academic_year_id: SOURCE_YEAR_ID,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        }),
      );
      // Fails the exam → suggested_outcome RETAIN — this is the path that
      // exercises findRetainClass() inside commit().
      await resultRepo.save(
        resultRepo.create({
          tenant_id: TENANT_ID,
          exam_id: playgroupExam.id,
          student_id: student.id,
          total_marks: '100.00',
          gpa: '1.00',
          grade: 'F',
          is_fail: true,
          grading_scale_id: gradingScaleId,
          grading_scale_revision: 1,
          rule_version: 'v1',
          computed_at: new Date(),
        }),
      );

      // A null-grade class can never have a retain class, so create still
      // goes ahead (staff may override RETAIN to PROMOTE); only the create
      // check for graded classes moved in #2924.
      const run = await service.create(
        {
          source_class_id: playgroupId,
          target_academic_year_id: TARGET_YEAR_ID,
          target_class_id: targetForPlaygroupId,
          exam_ids: [playgroupExam.id],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      const entry = await entryRepo.findOne({ where: { run_id: run.id, student_id: student.id } });
      expect(entry?.suggested_outcome).toBe(PromotionOutcome.RETAIN);

      // commit() must refuse — not silently retain the student into the
      // unrelated Nursery class.
      await expect(
        service.commit(run.id, TENANT_ID, ADMIN_USER_ID, 'ADMIN', { headers: {} }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Confirm the student was never enrolled into Nursery.
      const wrongEnrollment = await enrollmentRepo.findOne({
        where: { student_id: student.id, class_id: nurseryId },
      });
      expect(wrongEnrollment).toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it('never returns a run belonging to another tenant', async () => {
      const student = await buildStudent();
      await enrollActive(student.id);
      await addResult(student.id, { isFail: false, gpa: 4.0, total: 400 });

      const run = await service.create(
        {
          source_class_id: SOURCE_CLASS_ID,
          target_academic_year_id: TARGET_YEAR_ID,
          exam_ids: [examId],
          algorithm: PlacementAlgorithm.BLOCK,
        },
        TENANT_ID,
        ADMIN_USER_ID,
      );

      await expect(
        service.findOne(run.id, '00000000-0000-4000-8000-000000099999'),
      ).rejects.toThrow();
    });
  });
});

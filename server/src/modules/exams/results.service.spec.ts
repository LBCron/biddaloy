import { describe, it, expect, vi } from 'vitest';

// The cohort query has its own integration coverage (results.service.integration.spec.ts);
// here it just hands back whatever the test put in `enrollmentRepo.find`.
vi.mock('./exam-cohort', async (orig) => ({
  // the pure "who sits this subject" rule stays real
  sitsSubject: (await orig<typeof import('./exam-cohort')>()).sitsSubject,
  loadExamCohort: async (manager: { find: () => Promise<unknown[]> }) => ({
    members: await manager.find(),
    studentsWithResult: new Set<string>(),
  }),
}));
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Brackets } from 'typeorm';
import { ResultsService, findMissingPicks, findUnassignedStreams } from './results.service';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { Mark } from './entities/mark.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { GradingBand } from '../grading/entities/grading-band.entity';
import { Subject } from '../academics/entities/subject.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { ProgramEnrollment } from '../programs/entities/program-enrollment.entity';
import { ProgramMilestone } from '../programs/entities/program-milestone.entity';
import { MilestoneAchievement } from '../programs/entities/milestone-achievement.entity';
import { AttendanceComponentService } from './attendance-component.service';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
import { ReportCardNote } from '../report-card-notes/entities/report-card-note.entity';
import { MarkGridService } from './mark-grid.service';
import { AuditService } from '../audit/audit.service';
import { ExamComponentKind, ExamComponentSource, ExamStatus, MarkStatus } from '@biddaloy/shared';

function fakeQueryBuilder(result: { many?: unknown[] }) {
  const qb: any = {
    innerJoinAndSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(result.many ?? []),
  };
  return qb;
}

const TENANT_ID = 'tenant-1';
const EXAM_ID = 'exam-1';
const CLASS_ID = 'class-1';
const YEAR_ID = 'year-1';
const SECTION_ID = 'section-1';
const SUBJECT_ID = 'subject-1';
const SCALE_ID = 'scale-1';
const COMPONENT_ID = 'comp-1';

const NCTB_BAND_ROWS = [
  { percent_from: 80, percent_to: 100, grade: 'A+', gpa: '5.00', is_fail: false },
  { percent_from: 70, percent_to: 79, grade: 'A', gpa: '4.00', is_fail: false },
  { percent_from: 33, percent_to: 69, grade: 'B', gpa: '3.00', is_fail: false },
  { percent_from: 0, percent_to: 32, grade: 'F', gpa: '0.00', is_fail: true },
];

function makeRepos(overrides: Record<string, any> = {}) {
  const exam = {
    id: EXAM_ID,
    tenant_id: TENANT_ID,
    class_id: CLASS_ID,
    academic_year_id: YEAR_ID,
    academic_term_id: null,
    status: ExamStatus.DRAFT,
    ...overrides.exam,
  };

  const examRepo: any = {
    findOne: vi.fn(async () => exam),
    find: vi.fn(async () => overrides.exams ?? [exam]),
    manager: {
      transaction: vi.fn(async (cb: any) =>
        cb({
          // computeAll now reads through this manager ([68.2.06]), so the
          // read repos are served here too; `find` feeds loadExamCohort's mock.
          find: (...args: any[]) => enrollmentRepo.find(...args),
          // reopen() asks which finals count the exam: none here.
          query: async () => [],
          getRepository: (entity: any) => {
            if (entity === Exam) return examRepo;
            if (entity === Result) return resultRepo;
            if (entity === ResultSubject) return resultSubjectRepo;
            if (entity === Mark) return markRepo;
            if (entity === ExamComponent) return componentRepo;
            if (entity === ClassSubject) return classSubjectRepo;
            if (entity === Student) return studentRepo;
            if (entity === StudentSubjectChoice) return choiceRepo;
            if (entity === GradingScale) return scaleRepo;
            if (entity === GradingBand) return bandRepo;
            return { update: vi.fn(async () => undefined) };
          },
        }),
      ),
      getRepository: (entity: any) => (entity === Exam ? examRepo : resultRepo),
      // [70.4.1] The card reads the report-card note and the exam's term / year range here.
      findOne: vi.fn(async (entity: any) => {
        if (entity === ReportCardNote) return overrides.note ?? null;
        return { start_date: '2026-01-01', end_date: '2099-12-31' };
      }),
    },
    update: vi.fn(async () => undefined),
  };

  const resultRepo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: `result-${Math.random()}`, ...v })),
    find: vi.fn(async () => overrides.existingResults ?? []),
    findOne: vi.fn(async () => overrides.resultForStudent ?? null),
    softDelete: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    manager: {
      transaction: vi.fn(async (cb: any) =>
        cb({
          getRepository: (entity: any) => {
            if (entity === Result) return resultRepo;
            if (entity === ResultSubject) return resultSubjectRepo;
            if (entity === Exam) return examRepo;
            return {};
          },
        }),
      ),
    },
  };
  examRepo.manager.getRepository = (entity: any) => (entity === Exam ? examRepo : resultRepo);

  const resultSubjectRepo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: `rs-${Math.random()}`, ...v })),
    find: vi.fn(async () => overrides.resultSubjects ?? []),
    softDelete: vi.fn(async () => undefined),
  };

  const sectionRepo: any = {
    find: vi.fn(async () => overrides.sections ?? [{ id: SECTION_ID, class_id: CLASS_ID }]),
  };
  const studentRepo: any = {
    find: vi.fn(
      async () =>
        overrides.students ?? [
          { id: 'stu-1', class_section_id: SECTION_ID, roll_number: 1, full_name: 'Student One' },
          { id: 'stu-2', class_section_id: SECTION_ID, roll_number: 2, full_name: 'Student Two' },
        ],
    ),
    findOne: vi.fn(
      async () =>
        (overrides.students ?? [
          { id: 'stu-1', class_section_id: SECTION_ID, roll_number: 1, full_name: 'Student One' },
        ])[0],
    ),
  };
  // D17: computeAll's cohort comes from Enrollment (tenant_id,
  // academic_year_id, class_id, ACTIVE), not from studentRepo directly.
  const enrollmentRepo: any = {
    find: vi.fn(
      async () =>
        overrides.enrollments ?? [
          { student_id: 'stu-1', section_id: SECTION_ID },
          { student_id: 'stu-2', section_id: SECTION_ID },
        ],
    ),
  };
  enrollmentRepo.manager = { find: enrollmentRepo.find };
  const classSubjectRepo: any = {
    find: vi.fn(
      async () =>
        overrides.classSubjects ?? [
          {
            id: 'cs-1',
            class_id: CLASS_ID,
            subject_id: SUBJECT_ID,
            academic_year_id: YEAR_ID,
            is_optional: false,
            is_graded_only: false,
          },
        ],
    ),
  };
  const choiceRepo: any = { find: vi.fn(async () => overrides.choices ?? []) };
  const componentRepo: any = {
    find: vi.fn(
      async () =>
        overrides.components ?? [
          {
            id: COMPONENT_ID,
            exam_id: EXAM_ID,
            subject_id: SUBJECT_ID,
            name: 'Written',
            kind: ExamComponentKind.WRITTEN,
            source: ExamComponentSource.MANUAL,
            full_marks: '100',
          },
        ],
    ),
  };
  const markRepo: any = { find: vi.fn(async () => overrides.marks ?? []) };
  const scaleRepo: any = {
    find: vi.fn(
      async () =>
        overrides.scales ?? [
          {
            id: SCALE_ID,
            tenant_id: TENANT_ID,
            academic_year_id: YEAR_ID,
            class_id: null,
            revision: 1,
          },
        ],
    ),
  };
  const bandRepo: any = { find: vi.fn(async () => overrides.bands ?? NCTB_BAND_ROWS) };
  const subjectRepo: any = {
    find: vi.fn(async () => overrides.subjects ?? [{ id: SUBJECT_ID, name_en: 'Mathematics' }]),
    findOne: vi.fn(
      async () => (overrides.subjects ?? [{ id: SUBJECT_ID, name_en: 'Mathematics' }])[0],
    ),
  };

  const schoolRepo: any = {
    findOne: vi.fn(
      async () =>
        overrides.school ??
        ({
          id: TENANT_ID,
          name: 'Test School',
          name_bn: null,
          address: null,
          phone: null,
          email: null,
          registration_id: null,
          logo_key: null,
        } as any),
    ),
  };

  const academicYearRepo: any = {
    findOne: vi.fn(
      async () =>
        overrides.academicYear ?? {
          id: YEAR_ID,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
        },
    ),
  };
  const programEnrollmentQb = fakeQueryBuilder({ many: overrides.programEnrollments ?? [] });
  const programEnrollmentRepo: any = {
    createQueryBuilder: vi.fn(() => programEnrollmentQb),
  };
  const programMilestoneRepo: any = {
    count: vi.fn(
      async ({ where }: any) => (overrides.milestoneCounts ?? {})[where.program_id] ?? 0,
    ),
  };
  const achievedCounts = overrides.achievedCounts ?? {};
  const latestAchievements = overrides.latestAchievements ?? {};
  // [34.2.4 yearEnd cutoff] `getReportCardPrograms` now reads these via
  // `createQueryBuilder` (an `achieved_on <= yearEnd` filter, not
  // expressible through `repo.count`/`findOne`'s plain `where`) — each
  // `createQueryBuilder()` call gets its own closure so `getCount()`/
  // `getOne()` resolve against whichever `enrollment_id` that particular
  // query was built for.
  const milestoneAchievementRepo: any = {
    createQueryBuilder: vi.fn(() => {
      let enrollmentId: string | undefined;
      const qb: any = {
        innerJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn((_cond: string, params?: Record<string, unknown>) => {
          if (params && 'enrollmentId' in params) enrollmentId = params.enrollmentId as string;
          return qb;
        }),
        orderBy: vi.fn().mockReturnThis(),
        getCount: vi.fn(async () => achievedCounts[enrollmentId ?? ''] ?? 0),
        getOne: vi.fn(async () => latestAchievements[enrollmentId ?? ''] ?? null),
      };
      return qb;
    }),
  };

  const attendanceComponentService = {
    computeForSection: vi.fn(async () => ({ reason: null, valuesByStudent: new Map() })),
  };
  const gridService = {
    progress: vi.fn(async () => ({ counts: {}, outstanding: overrides.outstanding ?? [] })),
  };
  const auditService = { record: vi.fn(async () => undefined) };
  const attendanceSummary = {
    getSummariesForStudents: vi.fn(async () => overrides.attendanceSummaries ?? new Map()),
  };

  return {
    attendanceSummary,
    exam,
    examRepo,
    resultRepo,
    resultSubjectRepo,
    sectionRepo,
    studentRepo,
    enrollmentRepo,
    classSubjectRepo,
    choiceRepo,
    componentRepo,
    markRepo,
    scaleRepo,
    bandRepo,
    subjectRepo,
    schoolRepo,
    academicYearRepo,
    programEnrollmentRepo,
    programEnrollmentQb,
    programMilestoneRepo,
    milestoneAchievementRepo,
    attendanceComponentService,
    gridService,
    auditService,
  };
}

async function buildService(overrides: Record<string, any> = {}) {
  const repos = makeRepos(overrides);

  const moduleRef = await Test.createTestingModule({
    providers: [
      ResultsService,
      { provide: getRepositoryToken(Exam), useValue: repos.examRepo },
      { provide: getRepositoryToken(Result), useValue: repos.resultRepo },
      { provide: getRepositoryToken(ResultSubject), useValue: repos.resultSubjectRepo },
      { provide: getRepositoryToken(Mark), useValue: repos.markRepo },
      { provide: getRepositoryToken(ExamComponent), useValue: repos.componentRepo },
      { provide: getRepositoryToken(ClassSubject), useValue: repos.classSubjectRepo },
      { provide: getRepositoryToken(Student), useValue: repos.studentRepo },
      { provide: getRepositoryToken(Enrollment), useValue: repos.enrollmentRepo },
      { provide: getRepositoryToken(StudentSubjectChoice), useValue: repos.choiceRepo },
      { provide: getRepositoryToken(GradingScale), useValue: repos.scaleRepo },
      { provide: getRepositoryToken(GradingBand), useValue: repos.bandRepo },
      { provide: getRepositoryToken(Subject), useValue: repos.subjectRepo },
      { provide: getRepositoryToken(School), useValue: repos.schoolRepo },
      { provide: getRepositoryToken(AcademicYear), useValue: repos.academicYearRepo },
      { provide: getRepositoryToken(ProgramEnrollment), useValue: repos.programEnrollmentRepo },
      { provide: getRepositoryToken(ProgramMilestone), useValue: repos.programMilestoneRepo },
      {
        provide: getRepositoryToken(MilestoneAchievement),
        useValue: repos.milestoneAchievementRepo,
      },
      { provide: AttendanceComponentService, useValue: repos.attendanceComponentService },
      { provide: AttendanceSummaryService, useValue: repos.attendanceSummary },
      { provide: MarkGridService, useValue: repos.gridService },
      { provide: AuditService, useValue: repos.auditService },
    ],
  }).compile();

  return { service: moduleRef.get(ResultsService), ...repos };
}

describe('ResultsService.process', () => {
  it('refuses to process while any grid is not SUBMITTED', async () => {
    const { service } = await buildService({
      outstanding: [
        { section_id: SECTION_ID, subject_id: SUBJECT_ID, section_name: 'A', state: 'DRAFT' },
      ],
    });

    await expect(service.process(EXAM_ID, TENANT_ID, 'user-1')).rejects.toThrow(ConflictException);
  });

  it('names blank cells too, with code GRIDS_OUTSTANDING (a SUBMITTED grid can still be outstanding)', async () => {
    const { service } = await buildService({
      outstanding: [
        { section_id: SECTION_ID, subject_id: SUBJECT_ID, section_name: 'A', state: 'SUBMITTED' },
      ],
    });

    const err = await service.process(EXAM_ID, TENANT_ID, 'user-1').catch((e) => e);
    expect(err.getResponse().message).toContain('blank cells');
    expect(err.getResponse().details.code).toBe('GRIDS_OUTSTANDING');
  });

  it("computes and stores every enrolled student's result, moving the exam to PROCESSED", async () => {
    const { service, resultRepo, resultSubjectRepo, examRepo, markRepo } = await buildService({
      marks: [
        {
          student_id: 'stu-1',
          component_id: COMPONENT_ID,
          value: '85.00',
          status: MarkStatus.PRESENT,
        },
        {
          student_id: 'stu-2',
          component_id: COMPONENT_ID,
          value: '40.00',
          status: MarkStatus.PRESENT,
        },
      ],
    });

    const result = await service.process(EXAM_ID, TENANT_ID, 'user-1');

    expect(result.processed).toBe(2);
    expect(resultRepo.save).toHaveBeenCalledTimes(2);
    expect(resultSubjectRepo.save).toHaveBeenCalledTimes(2);
    expect(examRepo.manager.getRepository(Exam).update).toHaveBeenCalledWith(
      { id: EXAM_ID, tenant_id: TENANT_ID },
      { status: ExamStatus.PROCESSED },
    );
    // stu-1 at 85% (A+) outranks stu-2 at 40% (B) — position ties aren't
    // exercised here (see the dedicated rankByMerit unit tests), just that
    // process() actually calls through to real grading.
    expect(markRepo.find).toHaveBeenCalled();
  });

  it('section_position restarts at 1 per section, section_id taken from Enrollment (D2)', async () => {
    const SECTION_B_ID = 'section-2';
    const { service, resultRepo } = await buildService({
      students: [
        { id: 'stu-1', class_section_id: SECTION_ID, roll_number: 1, full_name: 'Student One' },
        { id: 'stu-2', class_section_id: SECTION_ID, roll_number: 2, full_name: 'Student Two' },
        // class_section_id deliberately WRONG (set to section-1) so this
        // test actually proves section_id is read from Enrollment, not
        // from Student.class_section_id — if the code read the wrong
        // field, stu-3 would land in section-1 instead of section-2.
        { id: 'stu-3', class_section_id: SECTION_ID, roll_number: 1, full_name: 'Student Three' },
      ],
      enrollments: [
        { student_id: 'stu-1', section_id: SECTION_ID },
        { student_id: 'stu-2', section_id: SECTION_ID },
        { student_id: 'stu-3', section_id: SECTION_B_ID },
      ],
      marks: [
        {
          student_id: 'stu-1',
          component_id: COMPONENT_ID,
          value: '85.00',
          status: MarkStatus.PRESENT,
        },
        {
          student_id: 'stu-2',
          component_id: COMPONENT_ID,
          value: '40.00',
          status: MarkStatus.PRESENT,
        },
        {
          student_id: 'stu-3',
          component_id: COMPONENT_ID,
          value: '90.00',
          status: MarkStatus.PRESENT,
        },
      ],
    });

    await service.process(EXAM_ID, TENANT_ID, 'user-1');

    const saved = resultRepo.save.mock.calls.map((c: any) => c[0]);
    const byStudent = new Map(saved.map((s: any) => [s.student_id, s]));

    // stu-3 is alone in section-2 -> section_position 1, section_id set.
    expect(byStudent.get('stu-3').section_id).toBe(SECTION_B_ID);
    expect(byStudent.get('stu-3').section_position).toBe(1);
    // stu-1 outranks stu-2 within section-1 -> restarts at 1 too.
    expect(byStudent.get('stu-1').section_id).toBe(SECTION_ID);
    expect(byStudent.get('stu-1').section_position).toBe(1);
    expect(byStudent.get('stu-2').section_id).toBe(SECTION_ID);
    expect(byStudent.get('stu-2').section_position).toBe(2);
  });

  it('a forced process is audited with forced: true', async () => {
    const { service, auditService } = await buildService({
      outstanding: [
        { section_id: SECTION_ID, subject_id: SUBJECT_ID, section_name: 'A', state: 'DRAFT' },
      ],
      marks: [],
    });

    await service.process(EXAM_ID, TENANT_ID, 'user-1', true);

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        new_values: expect.objectContaining({ forced: true }),
      }),
      expect.anything(),
    );
  });

  it('refuses to process an already-published exam', async () => {
    const { service } = await buildService({ exam: { status: ExamStatus.PUBLISHED } });

    await expect(service.process(EXAM_ID, TENANT_ID, 'user-1')).rejects.toThrow(ConflictException);
  });
});

describe('ResultsService.recomputeProcessedExam (D18 step 6)', () => {
  // Production callers (marks, band edits) recompute inside their own write
  // transaction; the mocked examRepo.manager.transaction stands in for it.
  const recomputeInTx = (service: ResultsService) =>
    (service as any).examRepo.manager.transaction((m: any) =>
      service.recomputeProcessedExam(m, EXAM_ID, TENANT_ID, 'user-1'),
    );

  it('recomputes when the exam is PROCESSED', async () => {
    const { service, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
      marks: [
        {
          student_id: 'stu-1',
          component_id: COMPONENT_ID,
          value: '85.00',
          status: MarkStatus.PRESENT,
        },
      ],
    });

    await recomputeInTx(service);

    expect(resultRepo.save).toHaveBeenCalled();
  });

  it('is a no-op once PUBLISHED — marks are frozen', async () => {
    const { service, resultRepo } = await buildService({ exam: { status: ExamStatus.PUBLISHED } });

    await recomputeInTx(service);

    expect(resultRepo.save).not.toHaveBeenCalled();
  });

  it('removes a live row of a student outside the recomputed cohort, so no stale position is republished (pr-fix #945, #2215)', async () => {
    const { service, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
      existingResults: [
        { id: 'result-stu-1', student_id: 'stu-1' },
        // Not in the cohort (e.g. a late joiner auto-failed before #2215).
        { id: 'result-other', student_id: 'stu-other' },
      ],
    });

    await recomputeInTx(service);

    // Looked up by exam, not by the recomputed students — the out-of-cohort
    // row is removed too, instead of surviving with its old position.
    expect(resultRepo.find).toHaveBeenCalledWith({
      where: { exam_id: EXAM_ID, tenant_id: TENANT_ID, deleted_at: expect.anything() },
    });
    expect(resultRepo.softDelete).toHaveBeenCalledWith({
      id: expect.objectContaining({ value: ['result-stu-1', 'result-other'] }),
      tenant_id: TENANT_ID,
    });
    const saved = resultRepo.save.mock.calls.map((c: any[]) => c[0].student_id);
    expect(saved).toEqual(['stu-1', 'stu-2']);
  });

  it('a cohort member who has since left (non-ACTIVE enrollment) gets a fresh row, not a dropped one', async () => {
    const { service, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
      // The cohort keeps stu-1 although their enrollment is TRANSFERRED.
      enrollments: [
        { student_id: 'stu-1', section_id: SECTION_ID, enrollment_status: 'TRANSFERRED' },
        { student_id: 'stu-2', section_id: SECTION_ID },
      ],
      existingResults: [{ id: 'result-stu-1', student_id: 'stu-1' }],
    });

    await recomputeInTx(service);

    const saved = resultRepo.save.mock.calls.map((c: any[]) => c[0].student_id);
    expect(saved).toContain('stu-1');
  });

  it('re-checks status under the exam lock — a publish that landed first makes it a no-op (pr-fix #945)', async () => {
    const { service, examRepo, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
    });
    // The locked read (inside the transaction) sees the publish that
    // committed while this request was on its way in.
    examRepo.findOne = vi.fn(async () => ({
      id: EXAM_ID,
      tenant_id: TENANT_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
      status: ExamStatus.PUBLISHED,
    }));

    await recomputeInTx(service);

    expect(examRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(resultRepo.softDelete).not.toHaveBeenCalled();
    expect(resultRepo.save).not.toHaveBeenCalled();
  });

  it('is a no-op while still DRAFT — nothing computed yet', async () => {
    const { service, resultRepo } = await buildService({ exam: { status: ExamStatus.DRAFT } });

    await recomputeInTx(service);

    expect(resultRepo.save).not.toHaveBeenCalled();
  });
});

describe('ResultsService.publish / reopen', () => {
  it('publish moves PROCESSED -> PUBLISHED and stamps published_at', async () => {
    const { service, examRepo, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
    });

    await service.publish(EXAM_ID, TENANT_ID, 'admin-1');

    expect(examRepo.manager.getRepository(Exam).update).toHaveBeenCalledWith(
      { id: EXAM_ID, tenant_id: TENANT_ID },
      expect.objectContaining({ status: ExamStatus.PUBLISHED }),
    );
    expect(resultRepo.update).toHaveBeenCalledWith(
      { exam_id: EXAM_ID, tenant_id: TENANT_ID },
      expect.objectContaining({ published_at: expect.any(Date) }),
    );
  });

  it('publish re-checks status under the exam lock, refusing if it changed since the first read (pr-fix #945)', async () => {
    const { service, examRepo, resultRepo } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
    });
    const base = {
      id: EXAM_ID,
      tenant_id: TENANT_ID,
      class_id: CLASS_ID,
      academic_year_id: YEAR_ID,
    };
    examRepo.findOne = vi
      .fn()
      .mockResolvedValueOnce({ ...base, status: ExamStatus.PROCESSED }) // unlocked pre-check
      .mockResolvedValueOnce({ ...base, status: ExamStatus.PUBLISHED }); // locked re-read

    await expect(service.publish(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(ConflictException);
    expect(resultRepo.update).not.toHaveBeenCalled();
  });

  it('refuses to publish an exam that is not PROCESSED', async () => {
    const { service } = await buildService({ exam: { status: ExamStatus.DRAFT } });

    await expect(service.publish(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(ConflictException);
  });

  it('reopen moves PUBLISHED -> PROCESSED and audits before/after', async () => {
    const { service, examRepo, auditService } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
    });

    await service.reopen(EXAM_ID, TENANT_ID, 'admin-1');

    expect(examRepo.manager.getRepository(Exam).update).toHaveBeenCalledWith(
      { id: EXAM_ID, tenant_id: TENANT_ID },
      { status: ExamStatus.PROCESSED, published_at: null },
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        old_values: { status: ExamStatus.PUBLISHED },
        new_values: { status: ExamStatus.PROCESSED },
      }),
      expect.anything(),
    );
  });

  it('refuses to reopen an exam that is not published', async () => {
    const { service } = await buildService({ exam: { status: ExamStatus.PROCESSED } });

    await expect(service.reopen(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(ConflictException);
  });
});

describe('ResultsService.list', () => {
  it('returns rows sorted by position, with student names attached', async () => {
    const { service } = await buildService({
      existingResults: [
        {
          id: 'result-1',
          student_id: 'stu-2',
          total_marks: '150.00',
          gpa: '4.00',
          grade: 'A',
          position: 2,
          section_id: SECTION_ID,
          section_position: 2,
          is_fail: false,
        },
        {
          id: 'result-2',
          student_id: 'stu-1',
          total_marks: '180.00',
          gpa: '5.00',
          grade: 'A+',
          position: 1,
          section_id: SECTION_ID,
          section_position: 1,
          is_fail: false,
        },
      ],
    });

    const rows = await service.list(EXAM_ID, TENANT_ID);

    expect(rows.map((r) => r.student_id)).toEqual(['stu-1', 'stu-2']);
    expect(rows[0].full_name).toBe('Student One');
    // Acceptance: list() exposes both section_id and section_position.
    expect(rows[0].section_id).toBe(SECTION_ID);
    expect(rows[0].section_position).toBe(1);
    expect(rows[1].section_id).toBe(SECTION_ID);
    expect(rows[1].section_position).toBe(2);
  });

  it('returns an empty array when nothing has been processed yet', async () => {
    const { service } = await buildService({ existingResults: [] });
    expect(await service.list(EXAM_ID, TENANT_ID)).toEqual([]);
  });
});

describe('ResultsService.getStudentResult', () => {
  it('returns null when the student has no result for this exam', async () => {
    const { service } = await buildService({ resultForStudent: null });
    expect(await service.getStudentResult(EXAM_ID, 'stu-1', TENANT_ID)).toBeNull();
  });

  it('attaches subject names and per-component marks to the breakdown', async () => {
    const { service } = await buildService({
      resultForStudent: {
        id: 'result-1',
        student_id: 'stu-1',
        total_marks: '85.00',
        gpa: '5.00',
        grade: 'A+',
        position: 1,
        is_fail: false,
        grading_scale_id: SCALE_ID,
      },
      resultSubjects: [
        {
          subject_id: SUBJECT_ID,
          obtained: '85.00',
          grade: 'A+',
          gpa: '5.00',
          is_fail: false,
          is_fourth_subject: false,
        },
      ],
      marks: [
        { student_id: 'stu-1', component_id: COMPONENT_ID, value: '85.00', status: 'PRESENT' },
      ],
    });

    const detail = await service.getStudentResult(EXAM_ID, 'stu-1', TENANT_ID);

    expect(detail?.subjects[0].subject_name).toBe('Mathematics');
    expect(detail?.subjects[0].components).toEqual([
      { name: expect.any(String), full_marks: 100, obtained: 85 },
    ]);
  });
});

describe('ResultsService.listForStudent (19.9.1)', () => {
  const PUBLISHED_EXAM = {
    id: 'exam-pub',
    tenant_id: TENANT_ID,
    name: 'First Term',
    kind: 'TERM',
  };
  const UNPUBLISHED_EXAM = {
    id: 'exam-unpub',
    tenant_id: TENANT_ID,
    name: 'Monthly Test',
    kind: 'MONTHLY',
  };
  const publishedResult = {
    id: 'result-pub',
    exam_id: PUBLISHED_EXAM.id,
    student_id: 'stu-1',
    total_marks: '90.00',
    gpa: '5.00',
    grade: 'A+',
    position: 1,
    is_fail: false,
    published_at: new Date('2026-01-10'),
    computed_at: new Date('2026-01-05'),
  };
  const unpublishedResult = {
    id: 'result-unpub',
    exam_id: UNPUBLISHED_EXAM.id,
    student_id: 'stu-1',
    total_marks: '70.00',
    gpa: '3.00',
    grade: 'B',
    position: 2,
    is_fail: false,
    published_at: null,
    computed_at: new Date('2026-02-01'),
  };

  it('publishedOnly=true (the portal) never returns an unpublished exam', async () => {
    const { service } = await buildService({
      existingResults: [publishedResult],
      exams: [PUBLISHED_EXAM],
    });

    const rows = await service.listForStudent('stu-1', TENANT_ID, true);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exam_id: PUBLISHED_EXAM.id, published: true });
  });

  it('publishedOnly=false (staff) returns every exam, unpublished ones labelled', async () => {
    const { service } = await buildService({
      existingResults: [publishedResult, unpublishedResult],
      exams: [PUBLISHED_EXAM, UNPUBLISHED_EXAM],
    });

    const rows = await service.listForStudent('stu-1', TENANT_ID, false);

    expect(rows).toHaveLength(2);
    // Newest first: the unpublished exam's computed_at is later than the
    // published exam's published_at.
    expect(rows[0]).toMatchObject({ exam_id: UNPUBLISHED_EXAM.id, published: false });
    expect(rows[1]).toMatchObject({ exam_id: PUBLISHED_EXAM.id, published: true });
  });

  it('returns an empty array when the student has no results at all', async () => {
    const { service } = await buildService({ existingResults: [] });
    expect(await service.listForStudent('stu-1', TENANT_ID, true)).toEqual([]);
  });
});

describe('ResultsService.getStudentResultCard (19.9.1)', () => {
  const RESULT_FOR_CARD = {
    id: 'result-1',
    student_id: 'stu-1',
    total_marks: '85.00',
    gpa: '5.00',
    grade: 'A+',
    position: 1,
    is_fail: false,
    grading_scale_id: SCALE_ID,
  };

  it('publishedOnly=true returns null for a PROCESSED (not yet published) exam', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
      resultForStudent: RESULT_FOR_CARD,
    });

    expect(await service.getStudentResultCard(EXAM_ID, 'stu-1', TENANT_ID, true)).toBeNull();
  });

  it('publishedOnly=true returns the card, with the legend, for a PUBLISHED exam', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PUBLISHED, name: 'First Term Exam' },
      resultForStudent: RESULT_FOR_CARD,
    });

    const card = await service.getStudentResultCard(EXAM_ID, 'stu-1', TENANT_ID, true);

    expect(card?.exam_name).toBe('First Term Exam');
    expect(card?.legend.length).toBeGreaterThan(0);
  });

  it('publishedOnly=false (staff) returns the card even for an unpublished exam', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PROCESSED, name: 'Monthly Test' },
      resultForStudent: RESULT_FOR_CARD,
    });

    const card = await service.getStudentResultCard(EXAM_ID, 'stu-1', TENANT_ID, false);

    expect(card?.exam_name).toBe('Monthly Test');
  });

  it('returns null when the student has no result for this exam', async () => {
    const { service } = await buildService({ resultForStudent: null });
    expect(await service.getStudentResultCard(EXAM_ID, 'stu-1', TENANT_ID, false)).toBeNull();
  });
});

describe('ResultsService.getStudentResultCard — programs (34.2.4, D1, D22)', () => {
  const RESULT_FOR_CARD = {
    id: 'result-1',
    student_id: 'stu-1',
    total_marks: '85.00',
    gpa: '5.00',
    grade: 'A+',
    position: 1,
    is_fail: false,
    grading_scale_id: SCALE_ID,
  };
  const CARD_ARGS = [EXAM_ID, 'stu-1', TENANT_ID, false] as const;

  it('returns an empty array when the student has no qualifying enrollment', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
      resultForStudent: RESULT_FOR_CARD,
      programEnrollments: [],
    });

    const card = await service.getStudentResultCard(...CARD_ARGS);
    expect(card?.programs).toEqual([]);
  });

  // `show_on_report_card = true` and the ACTIVE/COMPLETED-in-year window
  // are enforced in the SQL `WHERE`, so an opted-out program or an
  // out-of-window COMPLETED one never reaches `getMany()` at all — this
  // test asserts the query actually carries those filter values.
  it('the query passes the tenant/student/status/academic-year-window filter values', async () => {
    const { service, programEnrollmentQb } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
      resultForStudent: RESULT_FOR_CARD,
      academicYear: { id: YEAR_ID, start_date: '2026-01-01', end_date: '2026-12-31' },
      programEnrollments: [],
    });

    await service.getStudentResultCard(...CARD_ARGS);

    expect(programEnrollmentQb.where).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tenantId: TENANT_ID }),
    );
    const topLevelParams = programEnrollmentQb.andWhere.mock.calls
      .map((c: any) => c[1])
      .filter(Boolean);
    expect(Object.assign({}, ...topLevelParams)).toMatchObject({ studentId: 'stu-1' });
    expect(programEnrollmentQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('show_on_report_card = true'),
    );

    // The ACTIVE/COMPLETED-in-year condition is wrapped in a `Brackets` —
    // its factory only runs when a real QueryBuilder processes the WHERE
    // clause, so it's invoked here with a stub to inspect the params it
    // built, the same way `new Brackets(...)` is applied to a real qb.
    const bracketsArg = programEnrollmentQb.andWhere.mock.calls
      .map((c: any) => c[0])
      .find((arg: any) => arg instanceof Brackets) as Brackets;
    expect(bracketsArg).toBeDefined();
    const bracketQb: any = { where: vi.fn().mockReturnThis(), orWhere: vi.fn().mockReturnThis() };
    (bracketsArg as any).whereFactory(bracketQb);
    const bracketParams = [...bracketQb.where.mock.calls, ...bracketQb.orWhere.mock.calls].map(
      (c: any) => c[1],
    );
    expect(Object.assign({}, ...bracketParams)).toMatchObject({
      active: 'ACTIVE',
      completed: 'COMPLETED',
      yearStart: '2026-01-01',
      yearEnd: '2026-12-31',
    });
  });

  it('an ACTIVE enrollment renders achieved/total counts and the latest achievement', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
      resultForStudent: RESULT_FOR_CARD,
      programEnrollments: [
        {
          id: 'enr-1',
          program_id: 'prog-1',
          program: { id: 'prog-1', name: 'Hifz Circle' },
          status: 'ACTIVE',
          ended_on: null,
        },
      ],
      milestoneCounts: { 'prog-1': 30 },
      achievedCounts: { 'enr-1': 7 },
      latestAchievements: {
        'enr-1': {
          achieved_on: '2026-03-01',
          score: '92.50',
          grade: 'A',
          milestone: { name: 'Juz 5' },
        },
      },
    });

    const card = await service.getStudentResultCard(...CARD_ARGS);

    expect(card?.programs).toEqual([
      {
        program_name: 'Hifz Circle',
        achieved_count: 7,
        milestone_total: 30,
        latest: { milestone_name: 'Juz 5', achieved_on: '2026-03-01', score: 92.5, grade: 'A' },
      },
    ]);
  });

  it('a COMPLETED enrollment (already inside the academic year per the SQL filter) is aggregated the same way as ACTIVE', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
      resultForStudent: RESULT_FOR_CARD,
      programEnrollments: [
        {
          id: 'enr-2',
          program_id: 'prog-2',
          program: { id: 'prog-2', name: 'Scouting' },
          status: 'COMPLETED',
          ended_on: '2026-06-01',
        },
      ],
      milestoneCounts: { 'prog-2': 10 },
      achievedCounts: { 'enr-2': 10 },
    });

    const card = await service.getStudentResultCard(...CARD_ARGS);
    expect(card?.programs).toEqual([
      { program_name: 'Scouting', achieved_count: 10, milestone_total: 10, latest: null },
    ]);
  });

  it('a zero-milestone program renders 0 / 0 with latest: null', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
      resultForStudent: RESULT_FOR_CARD,
      programEnrollments: [
        {
          id: 'enr-3',
          program_id: 'prog-3',
          program: { id: 'prog-3', name: 'New Program' },
          status: 'ACTIVE',
          ended_on: null,
        },
      ],
    });

    const card = await service.getStudentResultCard(...CARD_ARGS);
    expect(card?.programs).toEqual([
      { program_name: 'New Program', achieved_count: 0, milestone_total: 0, latest: null },
    ]);
  });
});

describe('findMissingPicks', () => {
  const cs = (id: string, subject_id: string, choice_group: string | null) =>
    ({ id, subject_id, choice_group }) as any;
  const st = (id: string) => ({ id, full_name: `N-${id}`, roll_number: 1 }) as any;
  const classSubjects = [cs('c1', 's1', 'REL'), cs('c2', 's2', 'REL'), cs('c3', 's3', null)];

  it('ignores a group with no components in the exam', () => {
    expect(findMissingPicks([st('a')], classSubjects, new Map([['s3', []]]), new Map())).toEqual(
      [],
    );
  });

  it('reports a student without a pick once, with name and group', () => {
    const comps = new Map([
      ['s1', []],
      ['s2', []],
    ]);
    const picks = new Map([['a:c2', {}]]);
    expect(findMissingPicks([st('a'), st('b')], classSubjects, comps, picks)).toEqual([
      { student_id: 'b', full_name: 'N-b', roll_number: 1, choice_group: 'REL' },
    ]);
  });
});

describe('findUnassignedStreams', () => {
  const cs = (subject_id: string, group_name: string | null) =>
    ({ id: `c-${subject_id}`, subject_id, group_name }) as any;
  const st = (id: string) => ({ id, full_name: `N-${id}`, roll_number: 1 }) as any;
  const classSubjects = [cs('s1', null), cs('s2', 'Science')];

  it('ignores a group subject with no components in the exam', () => {
    expect(
      findUnassignedStreams([st('a')], classSubjects, new Map([['s1', []]]), new Map()),
    ).toEqual([]);
  });

  it('ignores a class with no group-only subjects', () => {
    expect(
      findUnassignedStreams(
        [st('a')],
        [cs('s1', null)],
        new Map([['s1', []]]),
        new Map([['a', null]]),
      ),
    ).toEqual([]);
  });

  it('reports students with no section group (or no section), once each', () => {
    const comps = new Map([['s2', []]]);
    const groups = new Map<string, string | null>([
      ['a', null],
      ['b', 'Science'],
    ]);
    expect(
      findUnassignedStreams([st('a'), st('b'), st('c')], classSubjects, comps, groups),
    ).toEqual([
      { student_id: 'a', full_name: 'N-a', roll_number: 1 },
      { student_id: 'c', full_name: 'N-c', roll_number: 1 },
    ]);
  });
});

describe('ResultsService.process (stream subjects, 35.1.14)', () => {
  const baseCs = { class_id: CLASS_ID, academic_year_id: YEAR_ID, is_optional: false };
  const comp = (id: string, subject_id: string) => ({
    id,
    exam_id: EXAM_ID,
    subject_id,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100',
  });
  const stu = { id: 'stu-1', class_section_id: SECTION_ID, roll_number: 1, full_name: 'Sci' };
  const present = (component_id: string, value: string) => ({
    student_id: 'stu-1',
    component_id,
    value,
    status: MarkStatus.PRESENT,
  });

  it('a Science student gets no Humanities subject and no false F', async () => {
    const { service, resultSubjectRepo, resultRepo } = await buildService({
      students: [stu],
      enrollments: [
        { student_id: 'stu-1', section_id: SECTION_ID, section: { group_name: 'Science' } },
      ],
      classSubjects: [
        { ...baseCs, id: 'cs-ban', subject_id: 'ban', group_name: null },
        { ...baseCs, id: 'cs-phy', subject_id: 'phy', group_name: 'Science' },
        { ...baseCs, id: 'cs-eco', subject_id: 'eco', group_name: 'Humanities' },
      ],
      components: [comp('c-ban', 'ban'), comp('c-phy', 'phy'), comp('c-eco', 'eco')],
      marks: [present('c-ban', '80'), present('c-phy', '70')],
    });
    await service.process(EXAM_ID, TENANT_ID, 'u1');
    const ids = resultSubjectRepo.save.mock.calls.map((c: any) => c[0].subject_id).sort();
    expect(ids).toEqual(['ban', 'phy']);
    expect(resultRepo.save.mock.calls[0][0].is_fail).toBe(false);
  });

  it("a student whose stream matches no examined subject has nothing countable: grade '-', not F", async () => {
    const { service, resultSubjectRepo, resultRepo } = await buildService({
      students: [stu],
      enrollments: [
        { student_id: 'stu-1', section_id: SECTION_ID, section: { group_name: 'Arts' } },
      ],
      classSubjects: [{ ...baseCs, id: 'cs-eco', subject_id: 'eco', group_name: 'Humanities' }],
      components: [comp('c-eco', 'eco')],
      marks: [],
    });
    await service.process(EXAM_ID, TENANT_ID, 'u1');
    expect(resultSubjectRepo.save).not.toHaveBeenCalled();
    expect(resultRepo.save.mock.calls[0][0]).toMatchObject({ grade: '-', is_fail: false });
  });
});

describe('ResultsService.getStudentResultCard — attendance, remark, conduct (70.4.1)', () => {
  const RESULT = {
    id: 'result-1',
    student_id: 'stu-1',
    total_marks: '85.00',
    gpa: '5.00',
    grade: 'A+',
    position: 1,
    is_fail: false,
    grading_scale_id: SCALE_ID,
  };
  const summary = (o: Record<string, unknown> = {}) => ({
    working_days: 100,
    present_days: 80,
    late_days: 5,
    policy: { late_counts_as_present: true },
    ...o,
  });

  it('carries attendance (late counts per policy), remark and conduct for a published exam', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
      resultForStudent: RESULT,
      attendanceSummaries: new Map([['stu-1', summary()]]),
      note: { remark: 'Good progress', conduct: { discipline: 'A', sports: 'B' } },
    });
    const card = await service.getStudentResultCard(EXAM_ID, 'stu-1', TENANT_ID, true);
    expect(card?.attendance).toEqual({ working_days: 100, present_days: 85 });
    expect(card?.remark).toBe('Good progress');
    // Every configured item is listed; an ungraded one is null, not dropped.
    expect(card?.conduct.find((c) => c.key === 'discipline')?.grade).toBe('A');
    expect(card?.conduct.find((c) => c.key === 'neatness')?.grade).toBeNull();
  });

  it('is null / empty when nothing was entered', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
      resultForStudent: RESULT,
    });
    const card = await service.getStudentResultCard(EXAM_ID, 'stu-1', TENANT_ID, true);
    expect(card).toMatchObject({ attendance: null, remark: null, conduct: [] });
  });

  it('does not read attendance for an exam that is not published', async () => {
    const { service, attendanceSummary } = await buildService({
      exam: { status: ExamStatus.PROCESSED },
      resultForStudent: RESULT,
      attendanceSummaries: new Map([['stu-1', summary()]]),
    });
    const card = await service.getStudentResultCard(EXAM_ID, 'stu-1', TENANT_ID, false);
    expect(card?.attendance).toBeNull();
    expect(attendanceSummary.getSummariesForStudents).not.toHaveBeenCalled();
  });

  it('caps present days at the working days', async () => {
    const { service } = await buildService({
      exam: { status: ExamStatus.PUBLISHED },
      resultForStudent: RESULT,
      attendanceSummaries: new Map([['stu-1', summary({ present_days: 98, late_days: 9 })]]),
    });
    const card = await service.getStudentResultCard(EXAM_ID, 'stu-1', TENANT_ID, true);
    expect(card?.attendance).toEqual({ working_days: 100, present_days: 100 });
  });
});

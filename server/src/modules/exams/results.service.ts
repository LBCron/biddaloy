import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, IsNull, In, Not, Brackets } from 'typeorm';
import {
  AuditAction,
  ExamComponentSource,
  ExamStatus,
  MarkStatus,
  ProgramEnrollmentStatus,
} from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { Mark } from './entities/mark.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { ProgramEnrollment } from '../programs/entities/program-enrollment.entity';
import { ProgramMilestone } from '../programs/entities/program-milestone.entity';
import { MilestoneAchievement } from '../programs/entities/milestone-achievement.entity';
import { buildIssuerSnapshot, type IssuerSnapshot } from '../schools/profile/issuer-snapshot';
import { buildLogoUrl } from '../schools/profile/logo-key';
import { GradingBand } from '../grading/entities/grading-band.entity';
import { resolveScale, gradeFor, gradeForGpa } from '../grading/scale-lookup';
import {
  computeSubjectTotal,
  gradeSubjectTotal,
  combineSubjects,
  rankByMerit,
  Band,
  ComponentInput,
  SubjectResult,
} from './result-rules';
import { loadExamCohort, sitsSubject } from './exam-cohort';
import { lockExam } from './exam-lock';
import { AttendanceComponentService } from './attendance-component.service';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { todayInSchoolTz } from '../../common/time';
import {
  attendanceFrom,
  loadCardNotes,
  type CardAttendance,
  type CardConduct,
} from './report-card-extras';
import { MarkGridService } from './mark-grid.service';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';
import { ModuleRef } from '@nestjs/core';
import { AuditService } from '../audit/audit.service';
import { FinalResultsService } from '../final-results/final-results.service';
import { RequestContext } from '../../common/request-context.util';
import type { ApprovalContext } from '../auth/guards/approval.guard';

/** The rule engine's own version — stamped on every `Result` row (D19) so
 * a later change to `result-rules.ts` can be told apart from an
 * old computation without touching the row's other fields. Bump this
 * whenever `computeSubjectTotal`/`combineSubjects`'s actual arithmetic
 * changes, not for a comment or a refactor. */
export const RULE_VERSION = 'nctb-v3';

/** [ACAD-05] The one 409 for "results are published, reopen first". */
export function examPublished(): ConflictException {
  return new ConflictException({
    message: "This exam's results are published. Reopen the results first.",
    details: { code: 'EXAM_PUBLISHED' },
  });
}

/** [34.2.4] One opted-in (D22) program row on a student's report card. */
export interface ReportCardProgramRow {
  program_name: string;
  achieved_count: number;
  milestone_total: number;
  latest: {
    milestone_name: string;
    achieved_on: string;
    score: number | null;
    grade: string | null;
  } | null;
}

interface ComputedStudentResult {
  student_id: string;
  section_id: string | null;
  total_marks: number;
  gpa: number;
  grade: string;
  is_fail: boolean;
  subjects: Array<{
    subject_id: string;
    obtained: number;
    full_marks: number;
    grade: string;
    gpa: number | null;
    is_fail: boolean;
    is_fourth_subject: boolean;
  }>;
}

export interface MissingChoicePick {
  student_id: string;
  full_name: string;
  roll_number: number | null;
  choice_group: string;
}

/** Choice groups tested in this exam (some member has components) where a
 * student holds no pick. A pick row exists only for the member taken. */
export function findMissingPicks(
  students: Student[],
  classSubjects: ClassSubject[],
  componentsBySubject: Map<string, unknown[]>,
  choiceByStudentAndSubject: Map<string, unknown>,
): MissingChoicePick[] {
  const groups = new Map<string, ClassSubject[]>();
  for (const cs of classSubjects) {
    if (!cs.choice_group) continue;
    groups.set(cs.choice_group, [...(groups.get(cs.choice_group) ?? []), cs]);
  }
  const missing: MissingChoicePick[] = [];
  for (const [group, members] of groups) {
    if (!members.some((m) => componentsBySubject.has(m.subject_id))) continue;
    for (const s of students) {
      if (!members.some((m) => choiceByStudentAndSubject.has(`${s.id}:${m.id}`))) {
        missing.push({
          student_id: s.id,
          full_name: s.full_name,
          roll_number: s.roll_number ?? null,
          choice_group: group,
        });
      }
    }
  }
  return missing;
}

export interface UnassignedStudent {
  student_id: string;
  full_name: string;
  roll_number: number | null;
}

/** Students whose section has no stream (or no section) while this exam
 * tests a group-only subject (`class_subjects.group_name` set). One entry
 * per student. A student whose stream matches nothing examined is fine. */
export function findUnassignedStreams(
  students: Student[],
  classSubjects: ClassSubject[],
  componentsBySubject: Map<string, unknown[]>,
  groupByStudent: Map<string, string | null>,
): UnassignedStudent[] {
  const tested = classSubjects.some(
    (cs) => Boolean(cs.group_name) && componentsBySubject.has(cs.subject_id),
  );
  if (!tested) return [];
  return students
    .filter((s) => !groupByStudent.get(s.id))
    .map((s) => ({
      student_id: s.id,
      full_name: s.full_name,
      roll_number: s.roll_number ?? null,
    }));
}

@Injectable()
export class ResultsService {
  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(Result)
    private readonly resultRepo: Repository<Result>,
    @InjectRepository(ResultSubject)
    private readonly resultSubjectRepo: Repository<ResultSubject>,
    @InjectRepository(Mark)
    private readonly markRepo: Repository<Mark>,
    @InjectRepository(ExamComponent)
    private readonly componentRepo: Repository<ExamComponent>,
    @InjectRepository(ClassSubject)
    private readonly classSubjectRepo: Repository<ClassSubject>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(StudentSubjectChoice)
    private readonly choiceRepo: Repository<StudentSubjectChoice>,
    @InjectRepository(GradingScale)
    private readonly scaleRepo: Repository<GradingScale>,
    @InjectRepository(GradingBand)
    private readonly bandRepo: Repository<GradingBand>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(ProgramEnrollment)
    private readonly programEnrollmentRepo: Repository<ProgramEnrollment>,
    @InjectRepository(ProgramMilestone)
    private readonly programMilestoneRepo: Repository<ProgramMilestone>,
    @InjectRepository(MilestoneAchievement)
    private readonly milestoneAchievementRepo: Repository<MilestoneAchievement>,
    private readonly attendanceComponentService: AttendanceComponentService,
    private readonly gridService: MarkGridService,
    private readonly auditService: AuditService,
    // Lazy lookup of FinalResultsService: FinalResultsModule imports ExamsModule,
    // so a constructor inject would be a module cycle.
    private readonly moduleRef: ModuleRef,
  ) {}

  private async findExam(examId: string, tenantId: string): Promise<Exam> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) {
      throw new NotFoundException('Exam not found');
    }
    return exam;
  }

  private toRuleBand(band: GradingBand): Band {
    return {
      percent_from: band.percent_from,
      percent_to: band.percent_to,
      grade: band.grade,
      gpa: band.gpa === null ? null : Number(band.gpa),
      is_fail: band.is_fail,
    };
  }

  /**
   * Computes every enrolled student's result for one exam. Pure data
   * assembly + `result-rules.ts` — the only side effect here is the
   * `AttendanceComponentService` calls for `DERIVED` components, which
   * are themselves read-only. Callers (`process`, `recomputeProcessedExam`)
   * decide what to do with the output.
   */
  private async computeAll(
    manager: EntityManager,
    exam: Exam,
    tenantId: string,
  ): Promise<{
    rows: ComputedStudentResult[];
    missingPicks: MissingChoicePick[];
    unassignedStreams: UnassignedStudent[];
  }> {
    const scales = await manager.getRepository(GradingScale).find({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
    });
    const scale = resolveScale(scales, exam.academic_year_id, exam.class_id);
    if (!scale) {
      throw new ConflictException(
        "No grading scale found for this exam's academic year (or class).",
      );
    }
    const bandRows = await manager.getRepository(GradingBand).find({
      where: { scale_id: scale.id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const bands = bandRows.map((b) => this.toRuleBand(b));

    // Cohort = the students who sat the exam (see `loadExamCohort`).
    const { members: enrollments, studentsWithResult } = await loadExamCohort(
      manager,
      exam,
      tenantId,
    );
    const studentRows =
      enrollments.length === 0
        ? []
        : await manager.getRepository(Student).find({
            where: { id: In(enrollments.map((e) => e.student_id)), tenant_id: tenantId },
            withDeleted: true,
          });
    // A deleted student keeps a result they already have; never gets a new one.
    const students = studentRows.filter((s) => !s.deleted_at || studentsWithResult.has(s.id));
    const sectionByStudent = new Map(enrollments.map((e) => [e.student_id, e.section_id]));
    const groupByStudent = new Map<string, string | null>(
      enrollments.map((e) => [e.student_id, e.section?.group_name ?? null]),
    );

    const classSubjects = await manager.getRepository(ClassSubject).find({
      where: {
        class_id: exam.class_id,
        academic_year_id: exam.academic_year_id,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });

    const choices =
      students.length === 0
        ? []
        : await manager.getRepository(StudentSubjectChoice).find({
            where: {
              student_id: In(students.map((s) => s.id)),
              academic_year_id: exam.academic_year_id,
              tenant_id: tenantId,
            },
          });
    const choiceByStudentAndSubject = new Map(
      choices.map((c) => [`${c.student_id}:${c.class_subject_id}`, c]),
    );

    const components = await manager.getRepository(ExamComponent).find({
      where: { exam_id: exam.id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const componentsBySubject = new Map<string, ExamComponent[]>();
    for (const c of components) {
      componentsBySubject.set(c.subject_id, [...(componentsBySubject.get(c.subject_id) ?? []), c]);
    }

    const marks = await manager
      .getRepository(Mark)
      .find({ where: { exam_id: exam.id, tenant_id: tenantId } });
    const markByKey = new Map(marks.map((m) => [`${m.student_id}:${m.component_id}`, m]));

    // DERIVED components are computed once per (section, component) —
    // never per student — and cached; `AttendanceComponentService`
    // already does the per-student work internally.
    const derivedCache = new Map<string, Map<string, string | null>>();
    async function derivedValuesFor(
      self: ResultsService,
      sectionId: string,
      component: ExamComponent,
    ): Promise<Map<string, string | null>> {
      const key = `${sectionId}:${component.id}`;
      const cached = derivedCache.get(key);
      if (cached) return cached;
      const result = await self.attendanceComponentService.computeForSection({
        examId: exam.id,
        sectionId,
        fullMarks: component.full_marks,
        tenantId,
      });
      derivedCache.set(key, result.valuesByStudent);
      return result.valuesByStudent;
    }

    // Choice groups tested in this exam where a student has no pick (D44).
    const missingPicks = findMissingPicks(
      students,
      classSubjects,
      componentsBySubject,
      choiceByStudentAndSubject,
    );

    // Stream subjects tested in this exam where a student's section has no stream.
    const unassignedStreams = findUnassignedStreams(
      students,
      classSubjects,
      componentsBySubject,
      groupByStudent,
    );

    const computed: ComputedStudentResult[] = [];
    for (const student of students) {
      const subjectResults: SubjectResult[] = [];
      const subjectDisplay: ComputedStudentResult['subjects'] = [];

      for (const classSubject of classSubjects) {
        // Stream subjects only for their stream; optional / choice-group
        // subjects only for students who picked THIS one (non-takers' marks
        // are never read). Shared with the mark grid's blank-cell check.
        if (
          !sitsSubject(
            classSubject,
            groupByStudent.get(student.id) ?? null,
            choiceByStudentAndSubject.has(`${student.id}:${classSubject.id}`),
          )
        ) {
          continue;
        }
        const isFourth =
          classSubject.is_optional &&
          (choiceByStudentAndSubject.get(`${student.id}:${classSubject.id}`)?.is_fourth ?? false);

        const subjectComponents = componentsBySubject.get(classSubject.subject_id) ?? [];
        const inputs: ComponentInput[] = [];
        for (const component of subjectComponents) {
          if (component.source === ExamComponentSource.DERIVED) {
            const values = await derivedValuesFor(
              this,
              sectionByStudent.get(student.id)!,
              component,
            );
            const value = values.get(student.id) ?? null;
            // D11: unmeasurable (no term, or no attendance marked at
            // all) drops the component the same way EXEMPT does —
            // never a silent zero folded into the subject total.
            inputs.push({
              full_marks: Number(component.full_marks),
              value: value === null ? null : Number(value),
              status: value === null ? MarkStatus.EXEMPT : MarkStatus.PRESENT,
              pass_marks: component.pass_marks === null ? null : Number(component.pass_marks),
            });
            continue;
          }
          const mark = markByKey.get(`${student.id}:${component.id}`);
          // A component with no Mark row at all (never entered) is
          // treated as ABSENT, not silently dropped — `process()`
          // refuses to run while any grid is still DRAFT (issue step 4),
          // so this should only ever fire when forced past that guard.
          // A PRESENT row with no value (a cleared cell) is ABSENT too —
          // a blank is never a silent 0 (ACAD-04).
          const blank = !mark || (mark.status === MarkStatus.PRESENT && mark.value === null);
          inputs.push({
            full_marks: Number(component.full_marks),
            value: blank || mark.value === null ? null : Number(mark.value),
            status: blank ? MarkStatus.ABSENT : mark.status,
            pass_marks: component.pass_marks === null ? null : Number(component.pass_marks),
          });
        }

        const total = computeSubjectTotal(inputs);
        const graded = gradeSubjectTotal(total, (percent) => gradeFor(bands, percent));
        subjectResults.push({
          subject_id: classSubject.subject_id,
          obtained: total.obtained,
          full_marks: total.full_marks,
          is_countable: !classSubject.is_graded_only,
          is_fourth_subject: isFourth,
          ...graded,
        });
        subjectDisplay.push({
          subject_id: classSubject.subject_id,
          obtained: total.obtained,
          full_marks: total.full_marks,
          grade: graded.grade,
          gpa: graded.gpa,
          is_fail: graded.is_fail,
          is_fourth_subject: isFourth,
        });
      }

      const overall = combineSubjects(subjectResults, (gpa) => gradeForGpa(bands, gpa));
      computed.push({
        student_id: student.id,
        section_id: sectionByStudent.get(student.id) ?? null,
        total_marks: overall.total_marks,
        gpa: overall.gpa,
        grade: overall.grade,
        is_fail: overall.is_fail,
        subjects: subjectDisplay,
      });
    }

    // Class position (D2/D18): merit rank across the whole class.
    const positions = rankByMerit(
      computed.map((c) => ({
        student_id: c.student_id,
        gpa: c.gpa,
        total_marks: c.total_marks,
        is_fail: c.is_fail,
      })),
    );

    // Section position: merit rank within each section separately —
    // `sectionByStudent` (sourced from Enrollment) groups the same
    // `computed` rows by the section each student is actually enrolled
    // in, so a student's section rank never leaks across sections.
    const bySection = new Map<string, ComputedStudentResult[]>();
    for (const c of computed) {
      if (c.section_id === null) continue;
      bySection.set(c.section_id, [...(bySection.get(c.section_id) ?? []), c]);
    }
    const sectionPositions = new Map<string, number | null>();
    for (const sectionStudents of bySection.values()) {
      const ranked = rankByMerit(
        sectionStudents.map((c) => ({
          student_id: c.student_id,
          gpa: c.gpa,
          total_marks: c.total_marks,
          is_fail: c.is_fail,
        })),
      );
      for (const [studentId, position] of ranked) {
        sectionPositions.set(studentId, position);
      }
    }

    const rows = computed.map(
      (c) =>
        ({
          ...c,
          position: positions.get(c.student_id) ?? null,
          section_position: sectionPositions.get(c.student_id) ?? null,
        }) as any,
    );
    return { rows, missingPicks, unassignedStreams };
  }

  /** Soft-deletes every live result of the exam, then inserts `computed`.
   * `computed` is the whole cohort (`loadExamCohort`): a student who left
   * but sat the exam is in it and gets a fresh row. A row of anyone left
   * out on purpose (late joiner, no marks) is removed, so no stale
   * position survives to be republished. */
  private async replaceResults(
    manager: EntityManager,
    exam: Exam,
    computed: ComputedStudentResult[],
    scaleId: string,
    scaleRevision: number,
    tenantId: string,
  ): Promise<void> {
    const resultRepo = manager.getRepository(Result);
    const resultSubjectRepo = manager.getRepository(ResultSubject);

    const existing = await resultRepo.find({
      where: { exam_id: exam.id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (existing.length > 0) {
      await resultSubjectRepo.softDelete({
        result_id: In(existing.map((r) => r.id)),
        tenant_id: tenantId,
      });
      await resultRepo.softDelete({ id: In(existing.map((r) => r.id)), tenant_id: tenantId });
    }

    const now = new Date();
    for (const c of computed as Array<
      ComputedStudentResult & { position: number | null; section_position: number | null }
    >) {
      const result = await resultRepo.save(
        resultRepo.create({
          exam_id: exam.id,
          student_id: c.student_id,
          total_marks: c.total_marks.toFixed(2),
          gpa: c.gpa.toFixed(2),
          grade: c.grade,
          position: c.position,
          section_id: c.section_id,
          section_position: c.section_position,
          is_fail: c.is_fail,
          grading_scale_id: scaleId,
          grading_scale_revision: scaleRevision,
          rule_version: RULE_VERSION,
          computed_at: now,
          published_at: null,
          tenant_id: tenantId,
        }),
      );

      for (const s of c.subjects) {
        await resultSubjectRepo.save(
          resultSubjectRepo.create({
            result_id: result.id,
            subject_id: s.subject_id,
            obtained: s.obtained.toFixed(2),
            grade: s.grade,
            gpa: (s.gpa ?? 0).toFixed(2), // stored as 0.00 placeholder; excluded from the average regardless (see result-rules.ts)
            is_fail: s.is_fail,
            is_fourth_subject: s.is_fourth_subject,
            tenant_id: tenantId,
          }),
        );
      }
    }
  }

  /** Issue step 4: computes and stores every enrolled student's result,
   * moving the exam DRAFT/PROCESSED -> PROCESSED. Refuses while any grid
   * is still short of SUBMITTED unless `force` is set, in which case the
   * override is itself audited (`forced: true` on the same record). */
  async process(
    examId: string,
    tenantId: string,
    userId: string,
    force = false,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<{ processed: number }> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status === ExamStatus.PUBLISHED) {
      throw new ConflictException(
        'This exam is already published — reopen it (step-up approval) before reprocessing.',
      );
    }

    if (!force) {
      const { outstanding } = await this.gridService.progress(examId, tenantId, undefined, null);
      if (outstanding.length > 0) {
        throw new ConflictException({
          message:
            `Cannot process exam: ${outstanding.length} grid(s) are not submitted or still have blank cells. ` +
            'Pass force=true to override — the override is audited.',
          details: { code: 'GRIDS_OUTSTANDING', outstanding: outstanding.slice(0, 50) },
        });
      }
    }

    const scales = await this.scaleRepo.find({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
    });
    const scale = resolveScale(scales, exam.academic_year_id, exam.class_id);
    if (!scale) {
      throw new ConflictException("No grading scale found for this exam's academic year.");
    }

    const computed = await this.examRepo.manager.transaction(async (manager) => {
      // Re-checked under the exam lock: a publish that committed since the
      // check above must win, not be overwritten by unpublished rows.
      const locked = await lockExam(manager, examId, tenantId);
      if (locked.status === ExamStatus.PUBLISHED) {
        throw new ConflictException(
          'This exam is already published — reopen it (step-up approval) before reprocessing.',
        );
      }
      // Computed after the lock: mark writes hold it FOR SHARE, so none
      // can commit between this read and the write below.
      const { rows, missingPicks, unassignedStreams } = await this.computeAll(
        manager,
        locked,
        tenantId,
      );
      // D44: not bypassable by `force` — a missing pick means an unknowable
      // result, not a draft-grid shortcut. recomputeProcessedExam ignores it.
      // Payload under `details`: the global error filter forwards only
      // `message` + `details` to the client (error-response.ts).
      if (missingPicks.length > 0) {
        throw new ConflictException({
          message: `${missingPicks.length} student(s) have not picked a subject in a choice group.`,
          details: {
            code: 'CHOICE_GROUP_UNPICKED',
            total: missingPicks.length,
            missing: missingPicks.slice(0, 50),
          },
        });
      }
      // [35.1.14] same rule for streams; thrown second so choice-group wins when both fire.
      if (unassignedStreams.length > 0) {
        throw new ConflictException({
          message: `${unassignedStreams.length} student(s) are in a section with no group, but this class has group-specific subjects.`,
          details: {
            code: 'STREAM_UNASSIGNED',
            total: unassignedStreams.length,
            missing: unassignedStreams.slice(0, 50),
          },
        });
      }
      await this.replaceResults(manager, locked, rows, scale.id, scale.revision, tenantId);

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Exam',
          entity_id: examId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { status: locked.status },
          new_values: { status: ExamStatus.PROCESSED, student_count: rows.length, forced: force },
        },
        manager,
      );
      await manager
        .getRepository(Exam)
        .update({ id: examId, tenant_id: tenantId }, { status: ExamStatus.PROCESSED });
      return rows;
    });
    return { processed: computed.length };
  }

  /** Issue step 6: a mark change while the exam is PROCESSED (not yet
   * PUBLISHED) invalidates and recomputes the class's results; a no-op once
   * PUBLISHED (marks are frozen, a change requires `reopen()`). [pr-fix #945]
   * Always the whole class, since one student's change can shift another's
   * `position`. */
  /**
   * Rewrites every result of a PROCESSED exam inside the caller's
   * transaction (`manager`) — so a mark write or a scale edit and its
   * recompute commit together or not at all (ACAD-08, ACAD-02). Returns
   * the number of result rows written; 0 when the exam is not PROCESSED.
   * A missing grading scale throws 409 `NO_GRADING_SCALE`, never a skip.
   */
  async recomputeProcessedExam(
    manager: EntityManager,
    examId: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<number> {
    // Status re-checked under the exam lock, not before it — otherwise a
    // publish committing in between would have its published rows
    // replaced by unpublished ones. Concurrent recomputes queue here too
    // instead of racing on the active (exam_id, student_id) index.
    const exam = await lockExam(manager, examId, tenantId);
    if (exam.status !== ExamStatus.PROCESSED) return 0;

    const scales = await manager.getRepository(GradingScale).find({
      where: { tenant_id: tenantId, deleted_at: IsNull() },
    });
    const scale = resolveScale(scales, exam.academic_year_id, exam.class_id);
    if (!scale) {
      throw new ConflictException({
        message: "No grading scale found for this exam's academic year (or class).",
        details: { code: 'NO_GRADING_SCALE' },
      });
    }

    // Rewrite every student's row, not just the batch's — a mark change
    // for one student can shift another's `position` (D18) even though
    // that other student's own marks never changed.
    const { rows: computed } = await this.computeAll(manager, exam, tenantId);
    await this.replaceResults(manager, exam, computed, scale.id, scale.revision, tenantId);

    await this.auditService.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'Result',
        entity_id: exam.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: context.ip,
        user_agent: context.userAgent,
        old_values: null,
        new_values: { recomputed_students: computed.map((c) => c.student_id) },
      },
      manager,
    );
    return computed.length;
  }

  /** Issue step 7: PROCESSED -> PUBLISHED, stamping `published_at` on
   * the exam and every result row. */
  async publish(
    examId: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status !== ExamStatus.PROCESSED) {
      throw new ConflictException(
        `This exam must be PROCESSED before it can be published (current: ${exam.status}).`,
      );
    }

    await this.examRepo.manager.transaction(async (manager) => {
      const locked = await lockExam(manager, examId, tenantId);
      if (locked.status !== ExamStatus.PROCESSED) {
        throw new ConflictException(
          `This exam must be PROCESSED before it can be published (current: ${locked.status}).`,
        );
      }
      const now = new Date();
      await manager
        .getRepository(Exam)
        .update(
          { id: examId, tenant_id: tenantId },
          { status: ExamStatus.PUBLISHED, published_at: now },
        );
      await manager
        .getRepository(Result)
        .update({ exam_id: examId, tenant_id: tenantId }, { published_at: now });

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Exam',
          entity_id: examId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { status: ExamStatus.PROCESSED },
          new_values: { status: ExamStatus.PUBLISHED },
        },
        manager,
      );
    });

    for (const ruleKey of ['results.published', 'exams.results_unpublished'] as const) {
      emitRecheck(attentionEvents, { tenantId, ruleKey, actorUserId: userId });
    }
  }

  /** Issue step 7: PUBLISHED -> PROCESSED, behind `@RequireApproval`
   * (`RESULTS_REOPEN`) at the controller — this method assumes the
   * approval already happened and just does the write + audit. */
  async reopen(
    examId: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
    approval?: ApprovalContext,
  ): Promise<void> {
    const exam = await this.findExam(examId, tenantId);
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new ConflictException(`This exam is not published (current: ${exam.status}).`);
    }

    await this.examRepo.manager.transaction(async (manager) => {
      // Finals that count this exam. Locked (inside demoteToDraft) BEFORE the exam, the same
      // order build/publish use, so a reopen cannot deadlock with them. A PUBLISHED final
      // refuses the reopen (409, same sentence as the final's own guards); a PROCESSED one
      // goes back to DRAFT because its rows would no longer match the exam (D24).
      const handled = new Set<string>();
      const demoteFinalsCountingExam = async () => {
        const finals: Array<{ id: string }> = await manager.query(
          `SELECT DISTINCT f.id
             FROM final_results f
             JOIN final_result_weights w ON w.final_result_id = f.id AND w.tenant_id = $1
            WHERE f.tenant_id = $1 AND f.deleted_at IS NULL AND w.exam_id = $2
            ORDER BY f.id`,
          [tenantId, examId],
        );
        const late = finals.filter((f) => !handled.has(f.id));
        if (late.length === 0) return;
        const finalsService = this.moduleRef.get(FinalResultsService, { strict: false });
        for (const f of late) {
          await finalsService.demoteToDraft(manager, f.id, tenantId, userId, context, examId);
          handled.add(f.id);
        }
      };
      await demoteFinalsCountingExam();
      const locked = await lockExam(manager, examId, tenantId);
      if (locked.status !== ExamStatus.PUBLISHED) {
        throw new ConflictException(`This exam is not published (current: ${locked.status}).`);
      }
      // Read again under the exam lock: a final built between the first read and the lock
      // (it took the exam FOR SHARE and committed) was not in the first list. No final can be
      // built or published on this exam after this point, so this list is complete.
      // ponytail: a late final is locked exam-then-final; if its own publish holds it and waits
      // on this exam, Postgres aborts one side (40P01, whole transaction rolled back). Rare.
      await demoteFinalsCountingExam();
      await manager
        .getRepository(Exam)
        .update(
          { id: examId, tenant_id: tenantId },
          { status: ExamStatus.PROCESSED, published_at: null },
        );
      await manager
        .getRepository(Result)
        .update({ exam_id: examId, tenant_id: tenantId }, { published_at: null });

      if (approval) {
        await this.auditService.recordApproved(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Exam',
            entity_id: examId,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            approved_by_user_id: approval.approverId,
            approval_scope: approval.scope,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: { status: ExamStatus.PUBLISHED },
            new_values: { status: ExamStatus.PROCESSED },
          },
          manager,
        );
        return;
      }
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Exam',
          entity_id: examId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { status: ExamStatus.PUBLISHED },
          new_values: { status: ExamStatus.PROCESSED },
        },
        manager,
      );
    });

    // Withdrawn results: resolve the families' "results are out" and raise the staff's "not published".
    for (const ruleKey of ['results.published', 'exams.results_unpublished'] as const) {
      emitRecheck(attentionEvents, { tenantId, ruleKey, actorUserId: userId });
    }
  }

  /** [19.8.1] The results panel's per-student rows — not in the plan's own
   * `## Files` list, but nothing upstream of this ticket ever added a read
   * path for `results`/`result_subjects` (`process`/`publish`/`reopen`/`sms`
   * are all write-only), so the panel has nothing to fetch without it.
   * Reported as a plan divergence. Ordered by `position` (nulls last) so a
   * fresh page load already reads top-to-bottom. */
  async list(
    examId: string,
    tenantId: string,
  ): Promise<
    Array<{
      student_id: string;
      roll_number: number;
      full_name: string;
      total_marks: number;
      gpa: number;
      grade: string;
      position: number | null;
      section_id: string | null;
      section_position: number | null;
      is_fail: boolean;
    }>
  > {
    const results = await this.resultRepo.find({
      where: { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (results.length === 0) return [];
    const students = await this.studentRepo.find({
      where: { id: In(results.map((r) => r.student_id)), tenant_id: tenantId },
    });
    const studentById = new Map(students.map((s) => [s.id, s]));

    return results
      .map((r) => {
        const student = studentById.get(r.student_id);
        return {
          student_id: r.student_id,
          roll_number: student?.roll_number ?? 0,
          full_name: student?.full_name ?? '',
          total_marks: Number(r.total_marks),
          gpa: Number(r.gpa),
          grade: r.grade,
          position: r.position,
          section_id: r.section_id,
          section_position: r.section_position,
          is_fail: r.is_fail,
        };
      })
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  }

  /** [19.8.1] One student's result for the report card — the subject
   * breakdown plus each subject's component contributions (`obtained`
   * marks a `ResultSubject` row never stores per-component, so those come
   * from `Mark`/`ExamComponent` directly, same sources `computeAll` reads
   * from). The grading scale's legend is fetched separately by the client
   * (`useGradingScale(result.grading_scale_id)`) — no need to duplicate it
   * here. */
  async getStudentResult(
    examId: string,
    studentId: string,
    tenantId: string,
  ): Promise<{
    student: { id: string; full_name: string; roll_number: number };
    result: {
      total_marks: number;
      gpa: number;
      grade: string;
      position: number | null;
      is_fail: boolean;
      grading_scale_id: string;
    };
    subjects: Array<{
      subject_id: string;
      subject_name: string;
      obtained: number;
      grade: string;
      gpa: number;
      is_fail: boolean;
      is_fourth_subject: boolean;
      components: Array<{ name: string; full_marks: number; obtained: number | null }>;
    }>;
  } | null> {
    const result = await this.resultRepo.findOne({
      where: { exam_id: examId, student_id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!result) return null;

    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId },
    });
    const resultSubjects = await this.resultSubjectRepo.find({
      where: { result_id: result.id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const subjectIds = resultSubjects.map((s) => s.subject_id);
    const subjects =
      subjectIds.length === 0
        ? []
        : await this.subjectRepo.find({ where: { id: In(subjectIds), tenant_id: tenantId } });
    const subjectNameById = new Map(subjects.map((s) => [s.id, s.name_en]));

    // No subjects means no components; `In([])` would fail, so skip the query.
    const components = !subjectIds.length
      ? []
      : await this.componentRepo.find({
          where: {
            exam_id: examId,
            subject_id: In(subjectIds),
            tenant_id: tenantId,
            deleted_at: IsNull(),
          },
        });
    const marks = await this.markRepo.find({
      where: { exam_id: examId, student_id: studentId, tenant_id: tenantId },
    });
    const markByComponent = new Map(marks.map((m) => [m.component_id, m]));

    return {
      student: {
        id: studentId,
        full_name: student?.full_name ?? '',
        roll_number: student?.roll_number ?? 0,
      },
      result: {
        total_marks: Number(result.total_marks),
        gpa: Number(result.gpa),
        grade: result.grade,
        position: result.position,
        is_fail: result.is_fail,
        grading_scale_id: result.grading_scale_id,
      },
      subjects: resultSubjects.map((rs) => ({
        subject_id: rs.subject_id,
        subject_name: subjectNameById.get(rs.subject_id) ?? '',
        obtained: Number(rs.obtained),
        grade: rs.grade,
        gpa: Number(rs.gpa),
        is_fail: rs.is_fail,
        is_fourth_subject: rs.is_fourth_subject,
        components: components
          .filter((c) => c.subject_id === rs.subject_id)
          .map((c) => {
            const mark = markByComponent.get(c.id);
            return {
              name: c.name,
              full_marks: Number(c.full_marks),
              obtained: mark && mark.value !== null ? Number(mark.value) : null,
            };
          }),
      })),
    };
  }

  /** [19.9.1] The report-card data for one student/exam, for the family
   * portal (`StudentResultsController`) — `getStudentResult` plus the exam
   * name, the grading scale's legend, and the school's own identity
   * (`IssuerSnapshot`, live — not frozen — since a result has none of its
   * own the way an invoice/payment does), none of which `getStudentResult`
   * provides (staff already has `GET /grading/scales/:id` and `GET
   * /schools/me/profile`; a PARENT/STUDENT has neither, both ADMIN-only,
   * so this route bakes both in rather than requiring calls it could never
   * make).
   *
   * `publishedOnly` mirrors `listForStudent`'s gate: a PARENT/STUDENT
   * caller passes `true` and gets `null` for an unpublished (or
   * nonexistent) exam's result — same "absent, not greyed" contract
   * (D19) as the list. Staff pass `false`.
   */
  async getStudentResultCard(
    examId: string,
    studentId: string,
    tenantId: string,
    publishedOnly: boolean,
  ): Promise<{
    exam_name: string;
    student: { full_name: string; roll_number: number };
    result: {
      total_marks: number;
      gpa: number;
      grade: string;
      position: number | null;
      is_fail: boolean;
    };
    subjects: Array<{
      subject_name: string;
      obtained: number;
      grade: string;
      gpa: number;
      is_fail: boolean;
      is_fourth_subject: boolean;
      components: Array<{ name: string; full_marks: number; obtained: number | null }>;
    }>;
    legend: Array<{ grade: string; gpa: number | null; comment: string | null }>;
    programs: ReportCardProgramRow[];
    /** Live over the exam's term (D9/D27); per-exam cards are not snapshotted. Null: not published or no data. */
    attendance: CardAttendance | null;
    remark: string | null;
    conduct: CardConduct;
    issuer: IssuerSnapshot;
    logo_url: string | null;
  } | null> {
    const detail = await this.getStudentResult(examId, studentId, tenantId);
    if (!detail) return null;

    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) return null;
    if (publishedOnly && exam.status !== ExamStatus.PUBLISHED) return null;

    const bandRows = await this.bandRepo.find({
      where: {
        scale_id: detail.result.grading_scale_id,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
      order: { sequence: 'ASC' },
    });
    const school = await this.schoolRepo.findOne({ where: { id: tenantId } });
    if (!school) return null;

    const programs = await this.getReportCardPrograms(exam, studentId, tenantId);
    const [attendance, notes] = await Promise.all([
      this.examAttendance(exam, studentId, tenantId),
      loadCardNotes(
        this.examRepo.manager,
        tenantId,
        studentId,
        { exam_id: examId },
        school.settings,
      ),
    ]);

    return {
      exam_name: exam.name,
      student: detail.student,
      result: detail.result,
      subjects: detail.subjects,
      legend: bandRows.map((b) => ({
        grade: b.grade,
        gpa: b.gpa === null ? null : Number(b.gpa),
        comment: b.comment,
      })),
      programs,
      attendance,
      remark: notes.remark,
      conduct: notes.conduct,
      issuer: buildIssuerSnapshot(school),
      logo_url: buildLogoUrl(school.id, school.logo_key),
    };
  }

  /**
   * Attendance printed on a PUBLISHED exam's card: the exam's term range, or with no term the
   * year start to the exam's last sitting (year end when it has none) (D9), capped at today, from
   * `AttendanceSummaryService` as is (D27).
   */
  private async examAttendance(
    exam: Exam,
    studentId: string,
    tenantId: string,
  ): Promise<CardAttendance | null> {
    if (exam.status !== ExamStatus.PUBLISHED) return null;
    const manager = this.examRepo.manager;
    const range = exam.academic_term_id
      ? // A term deleted after the exam still bounds that exam's attendance.
        await manager.findOne(AcademicTerm, {
          where: { id: exam.academic_term_id, tenant_id: tenantId },
          withDeleted: true,
        })
      : await manager.findOne(AcademicYear, {
          where: { id: exam.academic_year_id, tenant_id: tenantId },
        });
    if (!range) return null;
    const from = String(range.start_date).slice(0, 10);
    let end = String(range.end_date).slice(0, 10);
    if (!exam.academic_term_id) {
      const [last] = await manager.query(
        `SELECT to_char(MAX(date), 'YYYY-MM-DD') AS d FROM exam_schedules
          WHERE tenant_id = $1 AND exam_id = $2 AND deleted_at IS NULL`,
        [tenantId, exam.id],
      );
      if (last?.d) end = last.d;
    }
    const to = [end, todayInSchoolTz()].sort()[0];
    if (from > to) return null;
    // Lazy like FinalResultsService: only a published card needs it.
    const attendanceSummary = this.moduleRef.get(AttendanceSummaryService, { strict: false });
    const summaries = await attendanceSummary.getSummariesForStudents({
      tenantId,
      studentIds: [studentId],
      classId: exam.class_id,
      from,
      to,
    });
    return attendanceFrom(summaries.get(studentId));
  }

  /** [34.2.4] Opted-in (`show_on_report_card`, D22) programs to print
   * alongside the exam subjects — read-only reuse of the exam's academic
   * year dates only, no coupling into the exam pipeline (D1). An
   * enrollment counts when it's still `ACTIVE`, or was `COMPLETED` inside
   * the exam's academic year (a student who finished the program earlier
   * in the same year should still see it on that year's report card).
   * Milestone/achievement counting follows `ProgramsService
   * .findMilestonesWithAchievementCounts`'s pattern (#1063), just
   * narrowed to one student's enrollment instead of every enrollment in
   * the program.
   */
  private async getReportCardPrograms(
    exam: Exam,
    studentId: string,
    tenantId: string,
  ): Promise<ReportCardProgramRow[]> {
    const academicYear = await this.academicYearRepo.findOne({
      where: { id: exam.academic_year_id },
    });
    if (!academicYear) return [];

    const enrollments = await this.programEnrollmentRepo
      .createQueryBuilder('pe')
      .innerJoinAndSelect('pe.program', 'program')
      .where('pe.tenant_id = :tenantId', { tenantId })
      .andWhere('pe.student_id = :studentId', { studentId })
      .andWhere('program.show_on_report_card = true')
      .andWhere(
        new Brackets((qb) => {
          // ACTIVE also needs `started_on <= yearEnd` — otherwise a
          // student who enrolled *after* this exam's academic year ended
          // (but is still ACTIVE today) would show up on a report card for
          // a year they hadn't joined the program in yet.
          qb.where('pe.status = :active AND pe.started_on <= :yearEnd', {
            active: ProgramEnrollmentStatus.ACTIVE,
            yearEnd: academicYear.end_date,
          }).orWhere('pe.status = :completed AND pe.ended_on BETWEEN :yearStart AND :yearEnd', {
            completed: ProgramEnrollmentStatus.COMPLETED,
            yearStart: academicYear.start_date,
            yearEnd: academicYear.end_date,
          });
        }),
      )
      .getMany();
    if (enrollments.length === 0) return [];

    return Promise.all(
      enrollments.map(async (enrollment) => {
        // Same `yearEnd` cutoff on the achievement rows themselves — an
        // achievement recorded after this academic year ended (e.g. the
        // student is still active and progressing today) shouldn't inflate
        // *this* year's report card count or "latest" milestone.
        const [milestoneTotal, achievedCount, latestAchievement] = await Promise.all([
          this.programMilestoneRepo.count({
            where: { tenant_id: tenantId, program_id: enrollment.program_id },
          }),
          this.milestoneAchievementRepo
            .createQueryBuilder('ma')
            .where('ma.tenant_id = :tenantId', { tenantId })
            .andWhere('ma.enrollment_id = :enrollmentId', { enrollmentId: enrollment.id })
            .andWhere('ma.achieved_on <= :yearEnd', { yearEnd: academicYear.end_date })
            .getCount(),
          this.milestoneAchievementRepo
            .createQueryBuilder('ma')
            .innerJoinAndSelect('ma.milestone', 'milestone')
            .where('ma.tenant_id = :tenantId', { tenantId })
            .andWhere('ma.enrollment_id = :enrollmentId', { enrollmentId: enrollment.id })
            .andWhere('ma.achieved_on <= :yearEnd', { yearEnd: academicYear.end_date })
            .orderBy('ma.achieved_on', 'DESC')
            .getOne(),
        ]);

        return {
          program_name: enrollment.program.name,
          achieved_count: achievedCount,
          milestone_total: milestoneTotal,
          latest: latestAchievement
            ? {
                milestone_name: latestAchievement.milestone.name,
                achieved_on: latestAchievement.achieved_on,
                score: latestAchievement.score === null ? null : Number(latestAchievement.score),
                grade: latestAchievement.grade,
              }
            : null,
        };
      }),
    );
  }

  /** [19.9.1] Every exam this student has a `Result` row for, newest first
   * (`Exam.published_at` for a published exam, falling back to
   * `computed_at` for a processed-but-unpublished one a staff caller is
   * viewing). `publishedOnly` is the ONE gate between this and the family
   * portal: a guardian/student caller must never see an unpublished exam
   * in the list at all — not greyed out, absent (D19) — so it is filtered
   * here, server-side, rather than trusted to the client. Staff (the
   * results panel on student detail) pass `publishedOnly: false` and get
   * every exam including unpublished ones, so the panel can label each
   * one itself. */
  async listForStudent(
    studentId: string,
    tenantId: string,
    publishedOnly: boolean,
  ): Promise<
    Array<{
      exam_id: string;
      exam_name: string;
      exam_kind: string;
      published: boolean;
      total_marks: number;
      gpa: number;
      grade: string;
      position: number | null;
      is_fail: boolean;
    }>
  > {
    const where: Record<string, unknown> = {
      student_id: studentId,
      tenant_id: tenantId,
      deleted_at: IsNull(),
    };
    if (publishedOnly) {
      where.published_at = Not(IsNull());
    }
    const results = await this.resultRepo.find({ where: where as never });
    if (results.length === 0) return [];

    const exams = await this.examRepo.find({
      where: { id: In(results.map((r) => r.exam_id)), tenant_id: tenantId, deleted_at: IsNull() },
    });
    const examById = new Map(exams.map((e) => [e.id, e]));

    return results
      .map((r) => {
        const exam = examById.get(r.exam_id);
        return {
          exam_id: r.exam_id,
          exam_name: exam?.name ?? '',
          exam_kind: exam?.kind ?? '',
          published: r.published_at !== null,
          total_marks: Number(r.total_marks),
          gpa: Number(r.gpa),
          grade: r.grade,
          position: r.position,
          is_fail: r.is_fail,
          _sortDate: (r.published_at ?? r.computed_at).getTime(),
        };
      })
      .sort((a, b) => b._sortDate - a._sortDate)
      .map(({ _sortDate: _drop, ...row }) => row);
  }
}

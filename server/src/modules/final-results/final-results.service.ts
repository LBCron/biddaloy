import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  AuditAction,
  EnrollmentStatus,
  ExamKind,
  ExamStatus,
  FinalResultMode,
  FinalResultRounding,
  FinalResultStatus,
  MarkStatus,
  type FinalResultRowView,
  type FinalResultStudentCard,
  type FinalResultSummary,
} from '@biddaloy/shared';
import { toPaisa } from '../../common/constants/money';
import { RequestContext } from '../../common/request-context.util';
import { todayInSchoolTz } from '../../common/time';
import {
  finalAlreadyExists,
  finalStale,
  finalNoExams,
  finalNotDraft,
  finalNotProcessed,
  finalNotPublished,
  finalPublished,
  finalSharesNotHundred,
  finalSourceUnpublished,
} from '../../common/filters/known-errors';
import { AuditService } from '../audit/audit.service';
import { ApprovalContext } from '../auth/guards/approval.guard';
import { AttendanceSummaryService } from '../attendance/attendance-summary.service';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Exam } from '../exams/entities/exam.entity';
import { ExamComponent } from '../exams/entities/exam-component.entity';
import { Mark } from '../exams/entities/mark.entity';
import { Result } from '../exams/entities/result.entity';
import { ResultSubject } from '../exams/entities/result-subject.entity';
import { sitsSubject } from '../exams/exam-cohort';
import { lockExam } from '../exams/results.service';
import {
  combineSubjects,
  gradeSubjectTotal,
  rankByMerit,
  type Band,
  type SubjectResult,
} from '../exams/result-rules';
import { GradingBand } from '../grading/entities/grading-band.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { gradeFor, gradeForGpa, resolveScale } from '../grading/scale-lookup';
import { School } from '../schools/entities/school.entity';
import { buildIssuerSnapshot } from '../schools/profile/issuer-snapshot';
import { buildLogoUrl } from '../schools/profile/logo-key';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Student } from '../students/entities/student.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { FinalResult } from './entities/final-result.entity';
import { FinalResultRow } from './entities/final-result-row.entity';
import { FinalResultSubject } from './entities/final-result-subject.entity';
import { FinalResultWeight } from './entities/final-result-weight.entity';
import {
  combineStudent,
  FINAL_RULE_VERSION,
  SharesNotHundred,
  type ExamSubjectMark,
  type FinalSettings,
} from './final-result-rules';
import type { FinalResultRowsQueryDto, UpdateFinalResultBodyDto } from './dto/final-results.dto';

export type FinalResultListItem = {
  class: { id: string; name: string };
  final_result_id: string | null;
  /** 'NOT_SET_UP' = this class has no final result yet. */
  status: FinalResultStatus | 'NOT_SET_UP';
  published_at: string | null;
};

const iso = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/** Equal shares in whole hundredths that sum to exactly 100.00 (33.34 / 33.33 / 33.33). */
export function equalShares(count: number): number[] {
  if (count === 0) return [];
  const base = Math.floor(10_000 / count);
  const extra = 10_000 - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

/**
 * [70.2.1] Cross-exam final result of one class for one year (Epic 70). Same lifecycle as
 * `ResultsService`: DRAFT -> build -> PROCESSED -> publish -> PUBLISHED -> reopen (approval) ->
 * PROCESSED. The maths is `final-result-rules.ts`; this class loads the published exams' own
 * results, hands each student's marks to the rules, and stores rows pinned to the scale.
 *
 * A student's mark in an exam comes from that exam's own published `Result` rows (one source
 * of truth), not from raw marks. A student with no `Result` in an exam that has the subject gets
 * an explicit `obtained: null` row: absent counts 0 (D2), never a dropped row (D22 would
 * renormalise it away and inflate the mark).
 */
@Injectable()
export class FinalResultsService {
  constructor(
    @InjectRepository(FinalResult) private readonly repo: Repository<FinalResult>,
    private readonly auditService: AuditService,
    private readonly attendanceSummary: AttendanceSummaryService,
  ) {}

  private get manager(): EntityManager {
    return this.repo.manager;
  }

  // ---- reads ------------------------------------------------------------------------------

  /**
   * One row per class of the year, "NOT_SET_UP" where no final result exists. `sectionScope` (a
   * teacher's sections, Rule 2) keeps only the classes those sections belong to; null = all.
   */
  async list(
    academicYearId: string,
    tenantId: string,
    sectionScope: string[] | null = null,
  ): Promise<FinalResultListItem[]> {
    const year = await this.manager.findOne(AcademicYear, {
      where: { id: academicYearId, tenant_id: tenantId },
    });
    if (!year) throw new NotFoundException('Academic year not found');
    const [classes, finals] = await Promise.all([
      this.manager.find(Class, {
        where: { academic_year_id: academicYearId, tenant_id: tenantId, deleted_at: IsNull() },
        order: { name: 'ASC' },
      }),
      this.repo.find({
        where: { academic_year_id: academicYearId, tenant_id: tenantId, deleted_at: IsNull() },
      }),
    ]);
    const byClass = new Map(finals.map((f) => [f.class_id, f]));
    const visible = await this.scopedClassIds(sectionScope, tenantId);
    return classes
      .filter((c) => !visible || visible.has(c.id))
      .map((c) => {
        const f = byClass.get(c.id);
        return {
          class: { id: c.id, name: c.name },
          final_result_id: f?.id ?? null,
          status: f?.status ?? 'NOT_SET_UP',
          published_at: f?.published_at?.toISOString() ?? null,
        };
      });
  }

  /** The classes a teacher's sections belong to; null = no filter (not a teacher). */
  private async scopedClassIds(
    sectionScope: string[] | null,
    tenantId: string,
  ): Promise<Set<string> | null> {
    if (!sectionScope) return null;
    if (sectionScope.length === 0) return new Set();
    const sections = await this.manager.find(ClassSection, {
      where: { id: In(sectionScope), tenant_id: tenantId },
      select: { id: true, class_id: true },
    });
    return new Set(sections.map((s) => s.class_id));
  }

  private async find(id: string, tenantId: string): Promise<FinalResult> {
    const final = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!final) throw new NotFoundException('Final result not found');
    return final;
  }

  /** `sectionScope` as in `list`: a final of a class outside the teacher's sections is a 404. */
  async get(
    id: string,
    tenantId: string,
    sectionScope: string[] | null = null,
  ): Promise<FinalResultSummary> {
    const final = await this.find(id, tenantId);
    const visible = await this.scopedClassIds(sectionScope, tenantId);
    if (visible && !visible.has(final.class_id)) {
      throw new NotFoundException('Final result not found');
    }
    return this.summary(final, tenantId);
  }

  private async summary(final: FinalResult, tenantId: string): Promise<FinalResultSummary> {
    const [cls, year, weights, rows] = await Promise.all([
      this.manager.findOne(Class, { where: { id: final.class_id, tenant_id: tenantId } }),
      this.manager.findOne(AcademicYear, {
        where: { id: final.academic_year_id, tenant_id: tenantId },
      }),
      this.manager.find(FinalResultWeight, {
        where: { final_result_id: final.id, tenant_id: tenantId },
        // One save writes the whole set with one timestamp: id keeps the order stable.
        order: { created_at: 'ASC', id: 'ASC' },
      }),
      this.manager
        .getRepository(FinalResultRow)
        .createQueryBuilder('r')
        .select('COUNT(*)::int', 'students')
        .addSelect('(COUNT(*) FILTER (WHERE r.is_fail))::int', 'failed')
        .where('r.final_result_id = :id AND r.tenant_id = :tenantId AND r.deleted_at IS NULL', {
          id: final.id,
          tenantId,
        })
        .getRawOne<{ students: number; failed: number }>(),
    ]);
    return {
      id: final.id,
      class: { id: final.class_id, name: cls?.name ?? '' },
      academic_year: { id: final.academic_year_id, name: year?.name ?? '' },
      status: final.status,
      mode: final.mode,
      best_of_count: final.best_of_count,
      rounding: final.rounding,
      fail_if_any_exam_fails: final.fail_if_any_exam_fails,
      weights: weights.map((w) => ({
        exam_id: w.exam_id,
        subject_id: w.subject_id,
        share_percent: Number(w.share_percent),
      })),
      published_at: final.published_at?.toISOString() ?? null,
      counts: { students: rows?.students ?? 0, failed: rows?.failed ?? 0 },
    };
  }

  /**
   * One page of stored rows. `sectionScope` (a teacher's sections) narrows the page; null = all.
   * `per_exam` shows each source exam's own total, or `absent` when the student has no result there.
   */
  async rows(
    id: string,
    tenantId: string,
    query: FinalResultRowsQueryDto,
    sectionScope: string[] | null,
  ): Promise<{ data: FinalResultRowView[]; total: number; limit: number; offset: number }> {
    await this.find(id, tenantId);
    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;
    const qb = this.manager
      .getRepository(FinalResultRow)
      .createQueryBuilder('r')
      .where('r.final_result_id = :id AND r.tenant_id = :tenantId AND r.deleted_at IS NULL', {
        id,
        tenantId,
      });
    if (query.section_id) qb.andWhere('r.section_id = :sectionId', { sectionId: query.section_id });
    if (sectionScope) {
      if (sectionScope.length === 0) return { data: [], total: 0, limit, offset };
      qb.andWhere('r.section_id IN (:...scope)', { scope: sectionScope });
    }
    const [rows, total] = await qb
      .orderBy('r.position', 'ASC', 'NULLS LAST')
      .addOrderBy('r.total_marks', 'DESC')
      .addOrderBy('r.id', 'ASC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    const studentIds = rows.map((r) => r.student_id);
    const [students, perExam] = await Promise.all([
      studentIds.length
        ? this.manager.find(Student, {
            where: { id: In(studentIds), tenant_id: tenantId },
            withDeleted: true,
          })
        : [],
      this.perExamTotals(id, tenantId, studentIds),
    ]);
    const studentById = new Map(students.map((s) => [s.id, s]));
    return {
      data: rows.map((r) => {
        const s = studentById.get(r.student_id);
        return {
          student: {
            id: r.student_id,
            full_name: s?.full_name ?? '',
            roll_number: s?.roll_number ?? 0,
          },
          total_marks: Number(r.total_marks),
          gpa: Number(r.gpa),
          grade: r.grade,
          position: r.position,
          section_position: r.section_position,
          is_fail: r.is_fail,
          working_days: r.working_days,
          present_days: r.present_days,
          per_exam: perExam.get(r.student_id) ?? [],
        };
      }),
      total,
      limit,
      offset,
    };
  }

  private async perExamTotals(
    finalId: string,
    tenantId: string,
    studentIds: string[],
  ): Promise<Map<string, FinalResultRowView['per_exam']>> {
    const out = new Map<string, FinalResultRowView['per_exam']>();
    if (studentIds.length === 0) return out;
    const weights = await this.manager.find(FinalResultWeight, {
      where: { final_result_id: finalId, tenant_id: tenantId },
    });
    const examIds = [...new Set(weights.map((w) => w.exam_id))].sort();
    const results = examIds.length
      ? await this.manager.find(Result, {
          where: {
            exam_id: In(examIds),
            student_id: In(studentIds),
            tenant_id: tenantId,
            deleted_at: IsNull(),
          },
        })
      : [];
    const byKey = new Map(results.map((r) => [`${r.exam_id}:${r.student_id}`, r]));
    for (const sid of studentIds) {
      out.set(
        sid,
        examIds.map((examId) => {
          const r = byKey.get(`${examId}:${sid}`);
          return { exam_id: examId, total_marks: r ? Number(r.total_marks) : null, absent: !r };
        }),
      );
    }
    return out;
  }

  /** The report-card data of one student. Null when the student has no row. */
  async studentCard(
    id: string,
    studentId: string,
    tenantId: string,
  ): Promise<FinalResultStudentCard | null> {
    const final = await this.find(id, tenantId);
    const row = await this.manager.findOne(FinalResultRow, {
      where: {
        final_result_id: id,
        student_id: studentId,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });
    if (!row) return null;
    const weights = await this.manager.find(FinalResultWeight, {
      where: { final_result_id: id, tenant_id: tenantId },
    });
    const examIds = [...new Set(weights.map((w) => w.exam_id))].sort();
    const [student, year, school, exams, subjectRows, bands, examResults] = await Promise.all([
      this.manager.findOne(Student, { where: { id: studentId, tenant_id: tenantId } }),
      this.manager.findOne(AcademicYear, {
        where: { id: final.academic_year_id, tenant_id: tenantId },
      }),
      this.manager.findOne(School, { where: { id: tenantId } }),
      examIds.length
        ? this.manager.find(Exam, { where: { id: In(examIds), tenant_id: tenantId } })
        : [],
      this.manager.find(FinalResultSubject, {
        where: { final_result_row_id: row.id, tenant_id: tenantId, deleted_at: IsNull() },
      }),
      this.manager.find(GradingBand, {
        where: { scale_id: row.grading_scale_id, tenant_id: tenantId, deleted_at: IsNull() },
        order: { sequence: 'ASC' },
      }),
      examIds.length
        ? this.manager.find(Result, {
            where: {
              exam_id: In(examIds),
              student_id: studentId,
              tenant_id: tenantId,
              deleted_at: IsNull(),
            },
          })
        : [],
    ]);
    if (!school) return null;
    const resultSubjects = examResults.length
      ? await this.manager.find(ResultSubject, {
          where: {
            result_id: In(examResults.map((r) => r.id)),
            tenant_id: tenantId,
            deleted_at: IsNull(),
          },
        })
      : [];
    const subjects = subjectRows.length
      ? await this.manager.find(Subject, {
          where: { id: In(subjectRows.map((s) => s.subject_id)), tenant_id: tenantId },
          withDeleted: true,
        })
      : [];
    const nameBySubject = new Map(subjects.map((s) => [s.id, s.name_en]));
    const resultByExam = new Map(examResults.map((r) => [r.exam_id, r]));
    const examName = new Map(exams.map((e) => [e.id, e.name]));
    return {
      final_result_id: id,
      academic_year_name: year?.name ?? '',
      student: { full_name: student?.full_name ?? '', roll_number: student?.roll_number ?? 0 },
      final: {
        total_marks: Number(row.total_marks),
        gpa: Number(row.gpa),
        grade: row.grade,
        position: row.position,
        is_fail: row.is_fail,
      },
      exams: examIds.map((examId) => {
        const r = resultByExam.get(examId);
        return {
          exam_id: examId,
          exam_name: examName.get(examId) ?? '',
          total_marks: r ? Number(r.total_marks) : null,
          gpa: r ? Number(r.gpa) : null,
        };
      }),
      subjects: subjectRows.map((s) => ({
        subject_name: nameBySubject.get(s.subject_id) ?? '',
        obtained: Number(s.obtained),
        grade: s.grade,
        gpa: Number(s.gpa),
        is_fail: s.is_fail,
        is_fourth_subject: s.is_fourth_subject,
        per_exam: examIds.map((examId) => {
          const r = resultByExam.get(examId);
          const rs = r
            ? resultSubjects.find((x) => x.result_id === r.id && x.subject_id === s.subject_id)
            : undefined;
          return { exam_id: examId, obtained: rs ? Number(rs.obtained) : null };
        }),
      })),
      legend: bands.map((b) => ({
        grade: b.grade,
        gpa: b.gpa === null ? null : Number(b.gpa),
        comment: b.comment,
      })),
      attendance: { working_days: row.working_days, present_days: row.present_days },
      // Remarks and conduct belong to the report-card-notes tickets.
      remark: null,
      conduct: [],
      issuer: buildIssuerSnapshot(school) as unknown as Record<string, unknown>,
      logo_url: buildLogoUrl(school.id, school.logo_key),
    };
  }

  // ---- create / edit / delete -------------------------------------------------------------

  /**
   * New DRAFT for (class, year). Switches copy last year's final of the same-named class; shares
   * start equal over this year's PUBLISHED TERM exams of the class (D3, D17).
   */
  async create(
    dto: { class_id: string; academic_year_id: string },
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<FinalResultSummary> {
    const cls = await this.manager.findOne(Class, {
      where: { id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) throw new NotFoundException('Class not found');
    if (cls.academic_year_id !== dto.academic_year_id) {
      throw new BadRequestException('This class does not belong to that academic year.');
    }
    const year = await this.manager.findOne(AcademicYear, {
      where: { id: dto.academic_year_id, tenant_id: tenantId },
    });
    if (!year) throw new NotFoundException('Academic year not found');

    const id = await this.manager.transaction(async (manager) => {
      const existing = await manager.getRepository(FinalResult).count({
        where: {
          class_id: cls.id,
          academic_year_id: year.id,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
      // Two creates at once both pass this count; the unique index then refuses the second, and
      // known-errors.ts maps that to the same 409.
      if (existing > 0) throw finalAlreadyExists();
      const switches = await this.lastYearSwitches(manager, cls, year, tenantId);
      const exams = await manager.getRepository(Exam).find({
        where: {
          class_id: cls.id,
          academic_year_id: year.id,
          tenant_id: tenantId,
          kind: ExamKind.TERM,
          status: ExamStatus.PUBLISHED,
          deleted_at: IsNull(),
        },
        order: { created_at: 'ASC', id: 'ASC' },
      });
      const repo = manager.getRepository(FinalResult);
      const saved = await repo.save(
        repo.create({
          tenant_id: tenantId,
          class_id: cls.id,
          academic_year_id: year.id,
          ...switches,
        }),
      );
      const shares = equalShares(exams.length);
      if (exams.length > 0) {
        await manager.getRepository(FinalResultWeight).save(
          exams.map((e, i) =>
            manager.getRepository(FinalResultWeight).create({
              tenant_id: tenantId,
              final_result_id: saved.id,
              exam_id: e.id,
              subject_id: null,
              share_percent: shares[i].toFixed(2),
            }),
          ),
        );
      }
      await this.audit(manager, AuditAction.CREATE, saved.id, tenantId, userId, context, null, {
        class_id: cls.id,
        academic_year_id: year.id,
        exam_count: exams.length,
      });
      return saved.id;
    });
    return this.get(id, tenantId);
  }

  private async lastYearSwitches(
    manager: EntityManager,
    cls: Class,
    year: AcademicYear,
    tenantId: string,
  ): Promise<{
    mode: FinalResultMode;
    best_of_count: number | null;
    rounding: FinalResultRounding;
    fail_if_any_exam_fails: boolean;
  }> {
    const defaults = {
      mode: FinalResultMode.WEIGHTED,
      best_of_count: null,
      rounding: FinalResultRounding.WHOLE,
      fail_if_any_exam_fails: false,
    };
    const prevYear = await manager
      .getRepository(AcademicYear)
      .createQueryBuilder('y')
      .where('y.tenant_id = :tenantId AND y.start_date < :start AND y.deleted_at IS NULL', {
        tenantId,
        start: iso(year.start_date),
      })
      .orderBy('y.start_date', 'DESC')
      .getOne();
    if (!prevYear) return defaults;
    const prevClass = await manager
      .getRepository(Class)
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId AND c.academic_year_id = :yearId AND c.deleted_at IS NULL', {
        tenantId,
        yearId: prevYear.id,
      })
      .andWhere('lower(c.name) = lower(:name)', { name: cls.name })
      .andWhere('c.shift IS NOT DISTINCT FROM CAST(:shift AS varchar)', { shift: cls.shift })
      .getOne();
    if (!prevClass) return defaults;
    const prev = await manager.getRepository(FinalResult).findOne({
      where: { class_id: prevClass.id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!prev) return defaults;
    return {
      mode: prev.mode,
      best_of_count: prev.best_of_count,
      rounding: prev.rounding,
      fail_if_any_exam_fails: prev.fail_if_any_exam_fails,
    };
  }

  /** Switches + weights, DRAFT only. `weights`, when sent, replaces the whole set. */
  async update(
    id: string,
    dto: UpdateFinalResultBodyDto,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<FinalResultSummary> {
    await this.find(id, tenantId);
    await this.manager.transaction(async (manager) => {
      const final = await this.lock(manager, id, tenantId);
      // A built (PROCESSED) result can still be edited: it drops back to DRAFT and must be rebuilt.
      if (final.status === FinalResultStatus.PUBLISHED) throw finalNotDraft();

      const mode = dto.mode ?? final.mode;
      const bestOf =
        mode === FinalResultMode.BEST_OF ? (dto.best_of_count ?? final.best_of_count) : null;
      if (mode === FinalResultMode.BEST_OF && bestOf === null) {
        throw new BadRequestException('Choose how many exams count for best-of.');
      }
      if (dto.weights) await this.assertWeightsBelong(manager, final, dto.weights, tenantId);
      if (mode === FinalResultMode.BEST_OF && bestOf !== null) {
        const examCount = dto.weights
          ? new Set(dto.weights.map((w) => w.exam_id)).size
          : ((
              await manager
                .getRepository(FinalResultWeight)
                .createQueryBuilder('w')
                .select('COUNT(DISTINCT w.exam_id)::int', 'n')
                .where('w.final_result_id = :id AND w.tenant_id = :tenantId', { id, tenantId })
                .getRawOne<{ n: number }>()
            )?.n ?? 0);
        if (bestOf > examCount) {
          throw new BadRequestException('Best-of cannot count more exams than this result has.');
        }
      }

      const before = { mode: final.mode, best_of_count: final.best_of_count };
      await manager.getRepository(FinalResult).update(
        { id, tenant_id: tenantId },
        {
          status: FinalResultStatus.DRAFT,
          mode,
          best_of_count: bestOf,
          rounding: dto.rounding ?? final.rounding,
          fail_if_any_exam_fails: dto.fail_if_any_exam_fails ?? final.fail_if_any_exam_fails,
        },
      );
      // Built rows were computed under the old settings: a draft has none (rebuild makes new ones).
      if (final.status === FinalResultStatus.PROCESSED) await this.dropRows(manager, id, tenantId);
      if (dto.weights) {
        const weightRepo = manager.getRepository(FinalResultWeight);
        await weightRepo.delete({ final_result_id: id, tenant_id: tenantId });
        if (dto.weights.length > 0) {
          await weightRepo.save(
            dto.weights.map((w) =>
              weightRepo.create({
                tenant_id: tenantId,
                final_result_id: id,
                exam_id: w.exam_id,
                subject_id: w.subject_id ?? null,
                share_percent: w.share_percent.toFixed(2),
              }),
            ),
          );
        }
      }
      await this.audit(manager, AuditAction.UPDATE, id, tenantId, userId, context, before, {
        mode,
        best_of_count: bestOf,
        weights_replaced: Boolean(dto.weights),
      });
    });
    return this.get(id, tenantId);
  }

  /** Every weighted exam is a live exam of this class and year, and no (exam, subject) repeats. */
  private async assertWeightsBelong(
    manager: EntityManager,
    final: FinalResult,
    weights: Array<{ exam_id: string; subject_id?: string | null }>,
    tenantId: string,
  ): Promise<void> {
    const keys = new Set(weights.map((w) => `${w.exam_id}:${w.subject_id ?? ''}`));
    if (keys.size !== weights.length) {
      throw new BadRequestException('Each exam can have only one share per subject.');
    }
    const examIds = [...new Set(weights.map((w) => w.exam_id))];
    if (examIds.length > 0) {
      const n = await manager.getRepository(Exam).count({
        where: {
          id: In(examIds),
          tenant_id: tenantId,
          class_id: final.class_id,
          academic_year_id: final.academic_year_id,
          deleted_at: IsNull(),
        },
      });
      if (n !== examIds.length) {
        throw new BadRequestException('Every exam must belong to this class and year.');
      }
    }
    const subjectIds = [
      ...new Set(weights.map((w) => w.subject_id).filter((s): s is string => !!s)),
    ];
    if (subjectIds.length > 0) {
      const n = await manager
        .getRepository(Subject)
        .count({ where: { id: In(subjectIds), tenant_id: tenantId, deleted_at: IsNull() } });
      if (n !== subjectIds.length) throw new BadRequestException('Unknown subject in the shares.');
    }
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    await this.find(id, tenantId);
    await this.manager.transaction(async (manager) => {
      const final = await this.lock(manager, id, tenantId);
      // Only a published result is protected; a built one is still unseen work in progress.
      if (final.status === FinalResultStatus.PUBLISHED) throw finalNotDraft();
      await this.dropRows(manager, id, tenantId);
      await manager
        .getRepository(FinalResultWeight)
        .delete({ final_result_id: id, tenant_id: tenantId });
      await manager.getRepository(FinalResult).softDelete({ id, tenant_id: tenantId });
      await this.audit(
        manager,
        AuditAction.DELETE,
        id,
        tenantId,
        userId,
        context,
        { status: final.status },
        null,
      );
    });
  }

  // ---- build ------------------------------------------------------------------------------

  /** DRAFT/PROCESSED -> PROCESSED: compute and store every student's final row. */
  async build(
    id: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<{ processed: number }> {
    await this.find(id, tenantId);
    const processed = await this.manager.transaction(async (manager) => {
      const final = await this.lock(manager, id, tenantId);
      if (final.status === FinalResultStatus.PUBLISHED) throw finalPublished();

      const weights = await manager
        .getRepository(FinalResultWeight)
        .find({ where: { final_result_id: id, tenant_id: tenantId } });
      const examIds = [...new Set(weights.map((w) => w.exam_id))].sort();
      if (examIds.length === 0) throw finalNoExams();
      const exams = await this.lockPublishedSources(manager, examIds, final, tenantId);

      const settings: FinalSettings = {
        mode: final.mode,
        best_of_count: final.best_of_count,
        rounding: final.rounding,
        fail_if_any_exam_fails: final.fail_if_any_exam_fails,
        weights: weights.map((w) => ({
          exam_id: w.exam_id,
          subject_id: w.subject_id,
          share_percent: w.share_percent,
        })),
      };
      if (final.mode === FinalResultMode.WEIGHTED) this.assertSharesBalanced(settings);

      const scales = await manager
        .getRepository(GradingScale)
        .find({ where: { tenant_id: tenantId, deleted_at: IsNull() } });
      const scale = resolveScale(scales, final.academic_year_id, final.class_id);
      if (!scale) {
        throw new ConflictException({
          message: "No grading scale found for this final result's academic year (or class).",
          details: { code: 'NO_GRADING_SCALE' },
        });
      }
      const bandRows = await manager
        .getRepository(GradingBand)
        .find({ where: { scale_id: scale.id, tenant_id: tenantId, deleted_at: IsNull() } });
      const bands: Band[] = bandRows.map((b) => ({
        percent_from: b.percent_from,
        percent_to: b.percent_to,
        grade: b.grade,
        gpa: b.gpa === null ? null : Number(b.gpa),
        is_fail: b.is_fail,
      }));

      let computed;
      try {
        computed = await this.computeAll(manager, final, exams, settings, bands, tenantId);
      } catch (err) {
        if (err instanceof SharesNotHundred) throw finalSharesNotHundred();
        throw err;
      }
      await this.replaceRows(manager, final, computed, scale, tenantId);

      await manager
        .getRepository(FinalResult)
        .update({ id, tenant_id: tenantId }, { status: FinalResultStatus.PROCESSED });
      await this.audit(
        manager,
        AuditAction.UPDATE,
        id,
        tenantId,
        userId,
        context,
        { status: final.status },
        { status: FinalResultStatus.PROCESSED, student_count: computed.length },
      );
      return computed.length;
    });
    return { processed };
  }

  /** Locks the source exams (read lock, id order) and refuses any that is not PUBLISHED. */
  private async lockPublishedSources(
    manager: EntityManager,
    examIds: string[],
    final: FinalResult,
    tenantId: string,
  ): Promise<Exam[]> {
    const exams: Exam[] = [];
    for (const examId of examIds) {
      let exam: Exam;
      try {
        exam = await lockExam(manager, examId, tenantId, 'pessimistic_read');
      } catch (err) {
        if (err instanceof NotFoundException) throw finalSourceUnpublished();
        throw err;
      }
      if (
        exam.status !== ExamStatus.PUBLISHED ||
        exam.class_id !== final.class_id ||
        exam.academic_year_id !== final.academic_year_id
      ) {
        throw finalSourceUnpublished();
      }
      exams.push(exam);
    }
    return exams;
  }

  /** Whole-exam shares and each subject's own shares must each add up to exactly 100.00. */
  private assertSharesBalanced(settings: FinalSettings): void {
    const groups = new Map<string, number>();
    for (const w of settings.weights) {
      const key = w.subject_id ?? '';
      groups.set(key, (groups.get(key) ?? 0) + toPaisa(w.share_percent));
    }
    for (const total of groups.values()) if (total !== 10_000) throw finalSharesNotHundred();
  }

  private async computeAll(
    manager: EntityManager,
    final: FinalResult,
    exams: Exam[],
    settings: FinalSettings,
    bands: Band[],
    tenantId: string,
  ) {
    const examIds = exams.map((e) => e.id);
    const results = await manager
      .getRepository(Result)
      .find({ where: { exam_id: In(examIds), tenant_id: tenantId, deleted_at: IsNull() } });
    const resultSubjects = results.length
      ? await manager.getRepository(ResultSubject).find({
          where: {
            result_id: In(results.map((r) => r.id)),
            tenant_id: tenantId,
            deleted_at: IsNull(),
          },
        })
      : [];
    const components = await manager
      .getRepository(ExamComponent)
      .find({ where: { exam_id: In(examIds), tenant_id: tenantId, deleted_at: IsNull() } });
    const exemptMarks = await manager.getRepository(Mark).find({
      where: { exam_id: In(examIds), tenant_id: tenantId, status: MarkStatus.EXEMPT },
    });

    // Full marks of a subject in an exam = its components' full marks; a student's EXEMPT
    // components leave it (as `computeSubjectTotal` drops them).
    const fullBySubject = new Map<string, number>(); // exam:subject
    const componentById = new Map(components.map((c) => [c.id, c]));
    const examSubjects = new Map<string, Set<string>>();
    for (const c of components) {
      const k = `${c.exam_id}:${c.subject_id}`;
      fullBySubject.set(k, (fullBySubject.get(k) ?? 0) + Number(c.full_marks));
      (examSubjects.get(c.exam_id) ?? examSubjects.set(c.exam_id, new Set()).get(c.exam_id)!).add(
        c.subject_id,
      );
    }
    const exemptFull = new Map<string, number>(); // exam:student:subject
    for (const m of exemptMarks) {
      const c = componentById.get(m.component_id);
      if (!c) continue;
      const k = `${m.exam_id}:${m.student_id}:${c.subject_id}`;
      exemptFull.set(k, (exemptFull.get(k) ?? 0) + Number(c.full_marks));
    }
    const fullFor = (examId: string, subjectId: string, studentId: string): number =>
      Math.max(
        0,
        (fullBySubject.get(`${examId}:${subjectId}`) ?? 0) -
          (exemptFull.get(`${examId}:${studentId}:${subjectId}`) ?? 0),
      );

    const resultByKey = new Map(results.map((r) => [`${r.exam_id}:${r.student_id}`, r]));
    const subjectsByResult = new Map<string, ResultSubject[]>();
    for (const rs of resultSubjects) {
      (
        subjectsByResult.get(rs.result_id) ??
        subjectsByResult.set(rs.result_id, []).get(rs.result_id)!
      ).push(rs);
    }

    // D25: the cohort is the class-year's ACTIVE enrollments at build time, in their enrolled
    // section. A leaver is out even with exam results; a student with no result in any exam is in,
    // with every share at 0 (D2). One ACTIVE enrollment per student and year (unique index).
    const enrollments = await manager.getRepository(Enrollment).find({
      where: {
        tenant_id: tenantId,
        academic_year_id: final.academic_year_id,
        class_id: final.class_id,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
    });
    const sectionOf = new Map(enrollments.map((e) => [e.student_id, e.section_id]));
    const studentIds = [...sectionOf.keys()];
    const students = studentIds.length
      ? await manager
          .getRepository(Student)
          .find({ where: { id: In(studentIds), tenant_id: tenantId } })
      : [];

    const classSubjects = await manager.getRepository(ClassSubject).find({
      where: {
        class_id: final.class_id,
        academic_year_id: final.academic_year_id,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });
    const csBySubject = new Map(classSubjects.map((cs) => [cs.subject_id, cs]));
    const choices = students.length
      ? await manager.getRepository(StudentSubjectChoice).find({
          where: {
            student_id: In(students.map((s) => s.id)),
            academic_year_id: final.academic_year_id,
            tenant_id: tenantId,
          },
        })
      : [];
    const choiceByKey = new Map(choices.map((c) => [`${c.student_id}:${c.class_subject_id}`, c]));

    const sectionIds = [...new Set([...sectionOf.values()].filter((v): v is string => !!v))];
    const sections = sectionIds.length
      ? await manager
          .getRepository(ClassSection)
          .find({ where: { id: In(sectionIds), tenant_id: tenantId } })
      : [];
    const groupBySection = new Map(sections.map((s) => [s.id, s.group_name ?? null]));

    const computed = students.map((student) => {
      const section_id = sectionOf.get(student.id) ?? null;
      const group = section_id ? (groupBySection.get(section_id) ?? null) : null;
      const marks: ExamSubjectMark[] = [];
      for (const exam of exams) {
        const res = resultByKey.get(`${exam.id}:${student.id}`);
        if (res) {
          for (const rs of subjectsByResult.get(res.id) ?? []) {
            // ABS with 0 = every component absent: no mark (null), not a real 0.
            const absent = rs.grade === 'ABS' && Number(rs.obtained) === 0;
            marks.push({
              exam_id: exam.id,
              subject_id: rs.subject_id,
              obtained: absent ? null : Number(rs.obtained),
              full_marks: fullFor(exam.id, rs.subject_id, student.id),
              is_fail: rs.is_fail,
            });
          }
          continue;
        }
        // No result in this exam: the student did not sit it. Every subject the exam has (that
        // the student takes) gets an explicit null row, so it counts 0 and never drops out (D2).
        for (const subjectId of examSubjects.get(exam.id) ?? []) {
          const cs = csBySubject.get(subjectId);
          if (cs && !sitsSubject(cs, group, choiceByKey.has(`${student.id}:${cs.id}`))) continue;
          marks.push({
            exam_id: exam.id,
            subject_id: subjectId,
            obtained: null,
            full_marks: fullFor(exam.id, subjectId, student.id),
            is_fail: true,
          });
        }
      }

      const subjects = combineStudent(marks, settings).map((total) => {
        const graded = gradeSubjectTotal(total, (percent) => gradeFor(bands, percent));
        const cs = csBySubject.get(total.subject_id);
        const isFourth = Boolean(
          cs?.is_optional && choiceByKey.get(`${student.id}:${cs.id}`)?.is_fourth,
        );
        const result: SubjectResult = {
          subject_id: total.subject_id,
          obtained: total.obtained,
          full_marks: total.full_marks,
          is_countable: !cs?.is_graded_only,
          is_fourth_subject: isFourth,
          ...graded,
        };
        return result;
      });
      const overall = combineSubjects(subjects, (gpa) => gradeForGpa(bands, gpa));
      return { student_id: student.id, section_id, subjects, overall };
    });

    const positions = rankByMerit(
      computed.map((c) => ({
        student_id: c.student_id,
        gpa: c.overall.gpa,
        total_marks: c.overall.total_marks,
        is_fail: c.overall.is_fail,
      })),
    );
    const sectionPositions = new Map<string, number | null>();
    const bySection = new Map<string, typeof computed>();
    for (const c of computed) {
      if (!c.section_id) continue;
      (bySection.get(c.section_id) ?? bySection.set(c.section_id, []).get(c.section_id)!).push(c);
    }
    for (const list of bySection.values()) {
      const ranked = rankByMerit(
        list.map((c) => ({
          student_id: c.student_id,
          gpa: c.overall.gpa,
          total_marks: c.overall.total_marks,
          is_fail: c.overall.is_fail,
        })),
      );
      for (const [sid, pos] of ranked) sectionPositions.set(sid, pos);
    }
    return computed.map((c) => ({
      ...c,
      position: positions.get(c.student_id) ?? null,
      section_position: sectionPositions.get(c.student_id) ?? null,
    }));
  }

  /** Soft-deletes the live rows, then inserts the new set (a rebuild leaves no stale position). */
  private async replaceRows(
    manager: EntityManager,
    final: FinalResult,
    computed: Awaited<ReturnType<FinalResultsService['computeAll']>>,
    scale: GradingScale,
    tenantId: string,
  ): Promise<void> {
    const rowRepo = manager.getRepository(FinalResultRow);
    const subjectRepo = manager.getRepository(FinalResultSubject);
    await this.dropRows(manager, final.id, tenantId);
    const now = new Date();
    const savedRows = await rowRepo.save(
      computed.map((c) =>
        rowRepo.create({
          tenant_id: tenantId,
          final_result_id: final.id,
          student_id: c.student_id,
          total_marks: c.overall.total_marks.toFixed(2),
          gpa: c.overall.gpa.toFixed(2),
          grade: c.overall.grade,
          position: c.position,
          section_id: c.section_id,
          section_position: c.section_position,
          is_fail: c.overall.is_fail,
          grading_scale_id: scale.id,
          grading_scale_revision: scale.revision,
          rule_version: FINAL_RULE_VERSION,
          computed_at: now,
          published_at: null,
        }),
      ),
    );
    // `save` returns the rows in input order, so index i is computed[i].
    const subjectRows = computed.flatMap((c, i) =>
      c.subjects.map((s) =>
        subjectRepo.create({
          tenant_id: tenantId,
          final_result_row_id: savedRows[i].id,
          subject_id: s.subject_id,
          obtained: s.obtained.toFixed(2),
          grade: s.grade,
          gpa: (s.gpa ?? 0).toFixed(2),
          is_fail: s.is_fail,
          is_fourth_subject: s.is_fourth_subject,
        }),
      ),
    );
    if (subjectRows.length > 0) await subjectRepo.save(subjectRows, { chunk: 500 });
  }

  /** Soft-deletes the live rows (and their subjects) of one final result. */
  private async dropRows(manager: EntityManager, finalId: string, tenantId: string): Promise<void> {
    const rowRepo = manager.getRepository(FinalResultRow);
    const existing = await rowRepo.find({
      where: { final_result_id: finalId, tenant_id: tenantId, deleted_at: IsNull() },
      select: { id: true },
    });
    if (existing.length === 0) return;
    const ids = existing.map((r) => r.id);
    await manager
      .getRepository(FinalResultSubject)
      .softDelete({ final_result_row_id: In(ids), tenant_id: tenantId });
    await rowRepo.softDelete({ id: In(ids), tenant_id: tenantId });
  }

  // ---- publish / reopen -------------------------------------------------------------------

  /** PROCESSED -> PUBLISHED. Snapshots each row's attendance (working / present days). */
  async publish(
    id: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const final = await this.find(id, tenantId);
    if (final.status === FinalResultStatus.PUBLISHED) throw finalPublished();
    if (final.status !== FinalResultStatus.PROCESSED) throw finalNotProcessed();

    await this.manager.transaction(async (manager) => {
      const locked = await this.lock(manager, id, tenantId);
      if (locked.status === FinalResultStatus.PUBLISHED) throw finalPublished();
      if (locked.status !== FinalResultStatus.PROCESSED) throw finalNotProcessed();

      // A source exam reopened after the build would publish numbers nobody can reproduce.
      const weights = await manager
        .getRepository(FinalResultWeight)
        .find({ where: { final_result_id: id, tenant_id: tenantId } });
      const sources = await this.lockPublishedSources(
        manager,
        [...new Set(weights.map((w) => w.exam_id))].sort(),
        locked,
        tenantId,
      );

      const rowRepo = manager.getRepository(FinalResultRow);
      const rows = await rowRepo.find({
        where: { final_result_id: id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      // Reopened, corrected and republished since the build: the rows hold the old numbers.
      const builtAt = Math.min(...rows.map((r) => r.computed_at.getTime()));
      if (sources.some((e) => (e.published_at?.getTime() ?? 0) > builtAt)) throw finalStale();
      const year = await manager
        .getRepository(AcademicYear)
        .findOneOrFail({ where: { id: locked.academic_year_id, tenant_id: tenantId } });
      const from = iso(year.start_date);
      // Only days that have happened count, so a mid-year publish does not invent absences.
      const to = [iso(year.end_date), todayInSchoolTz()].sort()[0];
      const summaries =
        rows.length > 0 && from <= to
          ? await this.attendanceSummary.getSummariesForStudents({
              tenantId,
              studentIds: rows.map((r) => r.student_id),
              classId: locked.class_id,
              from,
              to,
            })
          : new Map();

      const now = new Date();
      const snapshot = rows.map((row) => {
        const s = summaries.get(row.student_id);
        const working = s ? s.working_days : null;
        const present =
          s && working !== null
            ? Math.min(
                working,
                s.present_days + (s.policy.late_counts_as_present ? s.late_days : 0),
              )
            : null;
        return { id: row.id, working, present };
      });
      // One statement for the whole class instead of one round trip per row.
      if (snapshot.length > 0) {
        await manager.query(
          `UPDATE final_result_rows AS r
              SET published_at = $1, updated_at = $1, working_days = v.working,
                  present_days = v.present
             FROM unnest($2::uuid[], $3::int[], $4::int[]) AS v(id, working, present)
            WHERE r.id = v.id AND r.tenant_id = $5`,
          [
            now,
            snapshot.map((x) => x.id),
            snapshot.map((x) => x.working),
            snapshot.map((x) => x.present),
            tenantId,
          ],
        );
      }
      await manager
        .getRepository(FinalResult)
        .update(
          { id, tenant_id: tenantId },
          { status: FinalResultStatus.PUBLISHED, published_at: now },
        );
      await this.audit(
        manager,
        AuditAction.UPDATE,
        id,
        tenantId,
        userId,
        context,
        { status: FinalResultStatus.PROCESSED },
        { status: FinalResultStatus.PUBLISHED },
      );
    });
  }

  /** PUBLISHED -> PROCESSED, behind `@RequireApproval(RESULTS_REOPEN)`; clears `published_at`. */
  async reopen(
    id: string,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
    approval?: ApprovalContext,
  ): Promise<void> {
    const final = await this.find(id, tenantId);
    if (final.status !== FinalResultStatus.PUBLISHED) throw finalNotPublished();
    await this.manager.transaction(async (manager) => {
      const locked = await this.lock(manager, id, tenantId);
      if (locked.status !== FinalResultStatus.PUBLISHED) throw finalNotPublished();
      await manager
        .getRepository(FinalResult)
        .update(
          { id, tenant_id: tenantId },
          { status: FinalResultStatus.PROCESSED, published_at: null },
        );
      await manager
        .getRepository(FinalResultRow)
        .update({ final_result_id: id, tenant_id: tenantId }, { published_at: null });
      const entry = {
        action: AuditAction.UPDATE,
        entity_type: 'FinalResult' as const,
        entity_id: id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: context.ip,
        user_agent: context.userAgent,
        old_values: { status: FinalResultStatus.PUBLISHED },
        new_values: { status: FinalResultStatus.PROCESSED },
      };
      if (approval) {
        await this.auditService.recordApproved(
          { ...entry, approved_by_user_id: approval.approverId, approval_scope: approval.scope },
          manager,
        );
      } else {
        await this.auditService.record(entry, manager);
      }
    });
  }

  // ---- helpers ----------------------------------------------------------------------------

  /** The row under `FOR UPDATE`: build, publish, edit and delete cannot act on a stale status. */
  private async lock(manager: EntityManager, id: string, tenantId: string): Promise<FinalResult> {
    const final = await manager.getRepository(FinalResult).findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!final) throw new NotFoundException('Final result not found');
    return final;
  }

  private audit(
    manager: EntityManager,
    action: AuditAction,
    id: string,
    tenantId: string,
    userId: string,
    context: RequestContext,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
  ) {
    return this.auditService.record(
      {
        action,
        entity_type: 'FinalResult' as const,
        entity_id: id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: context.ip,
        user_agent: context.userAgent,
        old_values: oldValues,
        new_values: newValues,
      },
      manager,
    );
  }
}

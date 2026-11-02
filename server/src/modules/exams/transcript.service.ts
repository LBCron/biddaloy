import { Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  AuditAction,
  ExamStatus,
  FinalResultStatus,
  type FinalResultStudentCard,
} from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { ResultsService } from './results.service';
import { School } from '../schools/entities/school.entity';
import { FinalResult } from '../final-results/entities/final-result.entity';
import { FinalResultWeight } from '../final-results/entities/final-result-weight.entity';
// Looked up lazily through ModuleRef: FinalResultsModule imports ExamsModule (as ResultsService).
import { FinalResultsService } from '../final-results/final-results.service';
import { loadCardNotes } from './report-card-extras';
import { DocumentPrintDto } from './dto/transcript.dto';

type ReportCard = NonNullable<Awaited<ReturnType<ResultsService['getStudentResultCard']>>>;

export interface Transcript {
  student: {
    id: string;
    full_name: string;
    roll_number: number;
    class_name: string;
    section_name: string | null;
  };
  academic_year: { id: string; name: string };
  exams: ReportCard[];
  /** The year's PUBLISHED final result of this student; null when there is none. */
  final: FinalCard | null;
}

/** Final card plus each counted exam's whole-exam share (null = only per-subject shares). */
export type FinalCard = FinalResultStudentCard & {
  exam_shares: Array<{ exam_id: string; share_percent: number | null }>;
};

/**
 * [48.2.10] Yearly transcript (one student, every exam of a year) and the
 * audit trail for code-rendered per-student documents (D25/D26). Marks come
 * from `ResultsService.getStudentResultCard`; nothing is recomputed here.
 */
@Injectable()
export class TranscriptService {
  constructor(
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment) private readonly enrollmentRepo: Repository<Enrollment>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(Exam) private readonly examRepo: Repository<Exam>,
    @InjectRepository(ExamSchedule) private readonly scheduleRepo: Repository<ExamSchedule>,
    private readonly resultsService: ResultsService,
    private readonly auditService: AuditService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async getTranscript(
    tenantId: string,
    studentId: string,
    yearId: string,
    publishedOnly: boolean,
  ): Promise<Transcript> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const year = await this.yearRepo.findOne({
      where: { id: yearId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    // Any enrollment status: a student who left still has a valid transcript.
    const enrollment = student
      ? await this.enrollmentRepo.findOne({
          where: { student_id: studentId, academic_year_id: yearId, tenant_id: tenantId },
          relations: { class: true, section: true },
          order: { enrolled_at: 'DESC' },
        })
      : null;
    if (!student || !year || !enrollment) {
      throw new NotFoundException('No enrollment for this student in that year');
    }

    const exams = await this.examRepo.find({
      where: {
        tenant_id: tenantId,
        academic_year_id: yearId,
        class_id: enrollment.class_id,
        deleted_at: IsNull(),
        status: publishedOnly
          ? ExamStatus.PUBLISHED
          : In([ExamStatus.PUBLISHED, ExamStatus.PROCESSED]),
      },
    });

    // First sitting date per exam; unscheduled exams sort last.
    const firstSitting = new Map<string, string>();
    if (exams.length) {
      const rows = await this.scheduleRepo
        .createQueryBuilder('s')
        .select('s.exam_id', 'exam_id')
        .addSelect("to_char(MIN(s.date), 'YYYY-MM-DD')", 'first')
        .where('s.tenant_id = :tenantId AND s.exam_id IN (:...ids)', {
          tenantId,
          ids: exams.map((e) => e.id),
        })
        .groupBy('s.exam_id')
        .getRawMany<{ exam_id: string; first: string }>();
      for (const r of rows) firstSitting.set(r.exam_id, r.first);
    }
    const sittingOf = (e: Exam) => firstSitting.get(e.id) ?? '9999-12-31';
    exams.sort(
      (a, b) =>
        sittingOf(a).localeCompare(sittingOf(b)) || a.created_at.getTime() - b.created_at.getTime(),
    );

    // One round: a class has a handful of exams a year, so the fan-out stays small.
    const cards = (
      await Promise.all(
        exams.map((exam) =>
          this.resultsService.getStudentResultCard(exam.id, studentId, tenantId, publishedOnly),
        ),
      )
    ).filter((c): c is ReportCard => !!c);

    return {
      student: {
        id: student.id,
        full_name: student.full_name,
        roll_number: student.roll_number,
        class_name: enrollment.class.name,
        section_name: enrollment.section?.section_name ?? null,
      },
      academic_year: { id: year.id, name: year.name },
      exams: cards,
      // The transcript's final column is published-only for everyone (D9): staff preview a
      // PROCESSED final through `getFinalResultCard`.
      final: await this.finalCardOf(tenantId, studentId, enrollment.class_id, yearId, true),
    };
  }

  /**
   * The final card alone (D20): same shape as the transcript's `final`. `publishedOnly` (families)
   * hides a PROCESSED final; staff see PROCESSED too. 404 when the year has no visible final or the
   * student has no row in it.
   */
  async getFinalResultCard(
    tenantId: string,
    studentId: string,
    yearId: string,
    publishedOnly: boolean,
  ): Promise<FinalCard> {
    // Same gate as the transcript: a deleted student or year has no card.
    const [student, year] = await Promise.all([
      this.studentRepo.findOne({
        where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
      }),
      this.yearRepo.findOne({ where: { id: yearId, tenant_id: tenantId, deleted_at: IsNull() } }),
    ]);
    const enrollment =
      student && year
        ? await this.enrollmentRepo.findOne({
            where: { student_id: studentId, academic_year_id: yearId, tenant_id: tenantId },
            order: { enrolled_at: 'DESC' },
          })
        : null;
    const card = enrollment
      ? await this.finalCardOf(tenantId, studentId, enrollment.class_id, yearId, publishedOnly)
      : null;
    if (!card) throw new NotFoundException('No final result for this student in that year');
    return card;
  }

  private async finalCardOf(
    tenantId: string,
    studentId: string,
    classId: string,
    yearId: string,
    publishedOnly: boolean,
  ): Promise<FinalCard | null> {
    const manager = this.examRepo.manager;
    const final = await manager.findOne(FinalResult, {
      where: {
        tenant_id: tenantId,
        class_id: classId,
        academic_year_id: yearId,
        deleted_at: IsNull(),
        status: publishedOnly
          ? FinalResultStatus.PUBLISHED
          : In([FinalResultStatus.PUBLISHED, FinalResultStatus.PROCESSED]),
      },
    });
    if (!final) return null;
    const finals = this.moduleRef.get(FinalResultsService, { strict: false });
    const card = await finals.studentCard(final.id, studentId, tenantId);
    if (!card) return null;
    const [school, weights, sittingOrder] = await Promise.all([
      manager.findOne(School, { where: { id: tenantId } }),
      manager.find(FinalResultWeight, {
        where: { final_result_id: final.id, tenant_id: tenantId },
      }),
      // `studentCard` orders exams by id; print them in sitting order like the transcript's exams
      // and the final tabulation (unscheduled last, then created).
      manager.query(
        `SELECT e.id FROM exams e
           LEFT JOIN exam_schedules es ON es.exam_id = e.id AND es.tenant_id = e.tenant_id
            AND es.deleted_at IS NULL
          WHERE e.tenant_id = $1 AND e.id = ANY($2::uuid[])
          GROUP BY e.id, e.created_at
          ORDER BY MIN(es.date) NULLS LAST, e.created_at, e.id`,
        [tenantId, card.exams.map((e) => e.exam_id)],
      ) as Promise<Array<{ id: string }>>,
    ]);
    const rank = new Map(sittingOrder.map((r, i) => [r.id, i]));
    const bySitting = <T extends { exam_id: string }>(xs: T[]) =>
      [...xs].sort((a, b) => (rank.get(a.exam_id) ?? 1e9) - (rank.get(b.exam_id) ?? 1e9));
    const exams = bySitting(card.exams);
    // `studentCard` leaves remark/conduct empty; the notes live in report_card_notes.
    const notes = await loadCardNotes(
      manager,
      tenantId,
      studentId,
      { final_result_id: final.id },
      school?.settings ?? null,
    );
    return {
      ...card,
      exams,
      subjects: card.subjects.map((sub) => ({ ...sub, per_exam: bySitting(sub.per_exam) })),
      remark: notes.remark,
      conduct: notes.conduct,
      exam_shares: exams.map((e) => {
        const whole = weights.find((w) => w.exam_id === e.exam_id && w.subject_id === null);
        return { exam_id: e.exam_id, share_percent: whole ? Number(whole.share_percent) : null };
      }),
    };
  }

  /** Writes one audit row; 404 (no row) when the target does not exist for this student. */
  async logDocumentPrint(
    tenantId: string,
    userId: string,
    studentId: string,
    dto: DocumentPrintDto,
    publishedOnly: boolean,
  ): Promise<void> {
    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!student) throw new NotFoundException('Student not found');

    let target: Record<string, string>;
    if (dto.document === 'REPORT_CARD') {
      const card = await this.resultsService.getStudentResultCard(
        dto.exam_id!,
        studentId,
        tenantId,
        publishedOnly,
      );
      if (!card) throw new NotFoundException('No result for this student on that exam');
      target = { exam_id: dto.exam_id! };
    } else if (dto.document === 'FINAL_REPORT_CARD') {
      // Same gate as the card route: a family cannot log (or see) a final that is not published.
      const card = await this.getFinalResultCard(
        tenantId,
        studentId,
        dto.academic_year_id!,
        publishedOnly,
      );
      target = { academic_year_id: dto.academic_year_id!, final_result_id: card.final_result_id };
    } else {
      const enrolled = await this.enrollmentRepo.exists({
        where: {
          student_id: studentId,
          academic_year_id: dto.academic_year_id!,
          tenant_id: tenantId,
        },
      });
      if (!enrolled) {
        throw new NotFoundException('No enrollment for this student in that year');
      }
      target = { academic_year_id: dto.academic_year_id! };
    }

    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'StudentDocumentPrint',
      entity_id: studentId,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      new_values: { document: dto.document, ...target },
    });
  }
}

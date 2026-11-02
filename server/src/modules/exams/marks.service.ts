import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, QueryFailedError } from 'typeorm';
import {
  AuditAction,
  EnrollmentStatus,
  ExamComponentSource,
  ExamStatus,
  MarkGridState,
  MarkStatus,
} from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { Mark } from './entities/mark.entity';

interface MarkAuditCell {
  student_id: string;
  component_id: string;
  value: string | number | null;
  status: Mark['status'];
}
import { ExamComponent } from './entities/exam-component.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { BatchMarksDto } from './dto/marks.dto';
import { MarksAuthorizationService } from './marks-authorization.util';
import { ResultsService } from './results.service';
import { lockExam } from './exam-lock';
import { lockGrid } from './mark-grid.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

/** Postgres unique-violation code — same pattern as exams.service.ts's
 * own `isUniqueViolation`. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION;
}

export interface SavedMarkCell {
  student_id: string;
  component_id: string;
  value: string | null;
  status: MarkStatus;
  saved_at: Date;
}

/**
 * [19.4.1] D19 — batched, idempotent mark upsert keyed on
 * `[exam_id, student_id, component_id]`. Last write wins per cell. Writes
 * take the grid's row lock (`lockGrid`) so they can't interleave with a
 * submit or with another write to the same cell.
 */
@Injectable()
export class MarksService {
  constructor(
    @InjectRepository(Mark)
    private readonly repo: Repository<Mark>,
    @InjectRepository(ExamComponent)
    private readonly componentRepo: Repository<ExamComponent>,
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Enrollment)
    private readonly enrollmentRepo: Repository<Enrollment>,
    private readonly authz: MarksAuthorizationService,
    private readonly resultsService: ResultsService,
    private readonly auditService: AuditService,
  ) {}

  async upsertBatch(
    examId: string,
    dto: BatchMarksDto,
    tenantId: string,
    role: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<{ cells: SavedMarkCell[] }> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) {
      throw new NotFoundException('Exam not found');
    }
    if (exam.status === ExamStatus.PUBLISHED) {
      throw new ConflictException(
        'This exam is already published — its marks can no longer be edited.',
      );
    }

    await this.authz.assertCanWrite({
      role,
      userId,
      tenantId,
      sectionId: dto.section_id,
      subjectId: dto.subject_id,
    });

    // IDOR guard: every component must belong to this exam, this subject,
    // and this tenant — filtering by all three in one query means a
    // component_id from another subject/exam/tenant simply won't be found,
    // caught by the size check below rather than trusted blindly.
    const componentIds = [...new Set(dto.cells.map((c) => c.component_id))];
    const components = await this.componentRepo.find({
      where: {
        id: In(componentIds),
        exam_id: examId,
        subject_id: dto.subject_id,
        tenant_id: tenantId,
        deleted_at: IsNull(),
      },
    });
    const componentById = new Map(components.map((c) => [c.id, c]));
    if (componentById.size !== componentIds.length) {
      throw new BadRequestException('One or more components were not found for this exam-subject.');
    }

    // IDOR guard: every student must hold an ACTIVE enrollment for this
    // exam's own (academic_year_id, class_id) with section_id = this grid's
    // section — a Mark row has no FK back to a section, so nothing else
    // stops a cell from naming a student who was never on this grid. D17:
    // this checks `Enrollment`, not `Student.class_section_id` — the
    // latter is the student's CURRENT placement and drifts away from an
    // old exam's year/class after promotion.
    const studentIds = [...new Set(dto.cells.map((c) => c.student_id))];
    const enrolledCount = await this.enrollmentRepo.count({
      where: {
        student_id: In(studentIds),
        tenant_id: tenantId,
        academic_year_id: exam.academic_year_id,
        class_id: exam.class_id,
        section_id: dto.section_id,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
    });
    if (enrolledCount !== studentIds.length) {
      throw new BadRequestException('One or more students are not enrolled in this section.');
    }

    const seenCells = new Set<string>();
    for (const cell of dto.cells) {
      // One cell twice in a batch would make the diff and the audit row
      // describe a state the grid never had; reject before any write.
      const key = `${cell.student_id}:${cell.component_id}`;
      if (seenCells.has(key)) {
        throw new BadRequestException('A batch cannot hold the same student and component twice.');
      }
      seenCells.add(key);
      const component = componentById.get(cell.component_id)!;
      if (component.source === ExamComponentSource.DERIVED) {
        throw new BadRequestException(
          `Component "${component.name}" is derived and cannot be entered directly.`,
        );
      }
      if (cell.status !== MarkStatus.PRESENT && cell.value != null) {
        throw new BadRequestException('value must be null unless status = PRESENT (D10).');
      }
      // The column is numeric(6,2): round once here so the comparison, the
      // write and the audit row all see the value the database will hold.
      if (cell.value != null) cell.value = Number(cell.value).toFixed(2);
      if (cell.value != null && Number(cell.value) > Number(component.full_marks)) {
        throw new BadRequestException(
          `value ${cell.value} exceeds full_marks (${component.full_marks}) for component "${component.name}".`,
        );
      }
    }

    try {
      await this.writeCells(examId, dto, tenantId, userId, context, exam.status);
    } catch (err) {
      // The grid lock serializes every write to a cell, so this only
      // fires in an edge the lock can't see (e.g. the student was moved
      // to another section mid-request). Postgres has already aborted the
      // transaction at this point — retrying inside it would just fail
      // again — so surface a clean 409 the client's autosave can retry.
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'These marks were just changed by another request — please retry.',
        );
      }
      throw err;
    }

    // Re-fetched after commit, not assembled from request input, so the
    // returned `saved_at` is the real server timestamp (D13's save-state
    // UI needs this to be trustworthy, not an echo of what the client sent).
    const saved = await this.repo.find({
      where: { exam_id: examId, subject_id: dto.subject_id, tenant_id: tenantId },
    });
    const savedByKey = new Map(saved.map((m) => [`${m.student_id}:${m.component_id}`, m]));

    return {
      cells: dto.cells.map((cell) => {
        const row = savedByKey.get(`${cell.student_id}:${cell.component_id}`)!;
        return {
          student_id: row.student_id,
          component_id: row.component_id,
          value: row.value,
          status: row.status,
          saved_at: row.updated_at,
        };
      }),
    };
  }

  /** The grid-state check and every cell write, in one transaction behind
   * the grid's row lock (see `lockGrid`) — a submit can't commit between
   * the SUBMITTED check and the writes, and concurrent writers of the
   * same cell queue up instead of racing on the unique index. */
  private async writeCells(
    examId: string,
    dto: BatchMarksDto,
    tenantId: string,
    userId: string,
    context: RequestContext,
    seenStatus: ExamStatus,
  ): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      // Exam first, then grid — the one lock order every path uses. FOR
      // SHARE lets autosaves on different grids run side by side while
      // still blocking a publish/process/recompute (FOR UPDATE) until this
      // commits, so marks can't change after publication.
      // [ACAD-08] A PROCESSED exam recomputes its results in this same
      // transaction, so it takes the exclusive lock (FOR UPDATE) the
      // recompute needs; every other status keeps the shared one.
      const wantsRecompute = seenStatus === ExamStatus.PROCESSED;
      const exam = await lockExam(
        manager,
        examId,
        tenantId,
        wantsRecompute ? 'pessimistic_write' : 'pessimistic_read',
      );
      // A process committed between the unlocked read and this lock: we
      // hold only a shared lock, so we cannot recompute. The autosave
      // retries on 409.
      if (exam.status === ExamStatus.PROCESSED && !wantsRecompute) {
        throw new ConflictException('Results were just processed — please retry.');
      }
      if (exam.status === ExamStatus.PUBLISHED) {
        throw new ConflictException(
          'This exam is already published — its marks can no longer be edited.',
        );
      }
      const grid = await lockGrid(manager, {
        tenantId,
        examId,
        sectionId: dto.section_id,
        subjectId: dto.subject_id,
      });
      if (grid.state === MarkGridState.SUBMITTED) {
        throw new ConflictException(
          `This grid was submitted (by user "${grid.submitted_by}" at ${grid.submitted_at?.toISOString()}) — reopen it before entering more marks.`,
        );
      }

      const repo = manager.getRepository(Mark);
      // [ACAD-07] Per-cell diff for the audit row: old value only for cells
      // that really changed; unchanged cells are skipped.
      const oldCells: MarkAuditCell[] = [];
      const newCells: MarkAuditCell[] = [];
      for (const cell of dto.cells) {
        const existing = await repo.findOne({
          where: {
            exam_id: examId,
            student_id: cell.student_id,
            component_id: cell.component_id,
            tenant_id: tenantId,
          },
        });
        const newValue = cell.value ?? null;
        if (existing) {
          if (
            (existing.value === null ? null : Number(existing.value)) !==
              (newValue === null ? null : Number(newValue)) ||
            existing.status !== cell.status
          ) {
            oldCells.push({
              student_id: cell.student_id,
              component_id: cell.component_id,
              value: existing.value,
              status: existing.status,
            });
            newCells.push({
              student_id: cell.student_id,
              component_id: cell.component_id,
              value: newValue,
              status: cell.status,
            });
          }
          await repo.update(
            { id: existing.id },
            { value: cell.value ?? null, status: cell.status, entered_by: userId },
          );
        } else {
          newCells.push({
            student_id: cell.student_id,
            component_id: cell.component_id,
            value: newValue,
            status: cell.status,
          });
          await repo.save(
            repo.create({
              exam_id: examId,
              student_id: cell.student_id,
              subject_id: dto.subject_id,
              component_id: cell.component_id,
              value: cell.value ?? null,
              status: cell.status,
              entered_by: userId,
              tenant_id: tenantId,
            }),
          );
        }
      }

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Mark',
          entity_id: examId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: oldCells.length ? { cells: oldCells } : null,
          new_values: {
            section_id: dto.section_id,
            subject_id: dto.subject_id,
            cell_count: dto.cells.length,
            cells: newCells,
          },
        },
        manager,
      );

      // [19.5.1] D18 step 6 / [ACAD-08] — a mark change while PROCESSED
      // rewrites the results in the SAME transaction: both commit or
      // neither does, and a missing grading scale is a 409 that rolls the
      // mark back, never a silent skip. `computeAll` ranks the whole class
      // either way, so it runs once per batch.
      if (exam.status === ExamStatus.PROCESSED) {
        await this.resultsService.recomputeProcessedExam(
          manager,
          examId,
          tenantId,
          userId,
          context,
        );
      }
    });
  }
}

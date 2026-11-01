import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  HomeworkAssignmentStatus,
  HomeworkGradingMode,
  HomeworkSubmissionStatus,
} from '@biddaloy/shared';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkSubmission } from './entities/homework-submission.entity';
import { HomeworkAccessService } from './homework-access.service';
import { Student } from '../students/entities/student.entity';
import { FamilyAccessService } from '../students/family-access.service';
import { StorageService } from '../storage/storage.service';
import { tenantObjectKey } from '../storage/storage-key';
import { matchesDeclaredType } from '../storage/file-signature';
import {
  GradeSubmissionsDto,
  HomeworkSubmissionRosterRowDto,
  UpdateHomeworkSubmissionDto,
} from './dto/homework-submission.dto';
import { SchoolsService } from '../schools/schools.service';
import { localToday } from '../attendance/attendance-policy.util';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';

interface CallerContext {
  role: string;
  userId: string;
  tenantId: string;
}

/** D27 — file cap shared by teacher-attachment and student-submission
 * uploads. Only this side (submissions) is implemented here. */
export const HOMEWORK_SUBMISSION_MAX_FILES = 10;
export const HOMEWORK_SUBMISSION_MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface SubmissionAttachment {
  key: string;
  filename: string;
  mimetype: string;
  size: number;
}

/** #3172: PARTIAL is a PARTIAL-mode outcome, so TICK and MARKS homework may not be set to
 * PARTIAL (the grid only sends DONE or NOT_SUBMITTED for them). Fixed text, no echo. */
function assertStatusFitsMode(
  mode: HomeworkGradingMode,
  status: HomeworkSubmissionStatus | undefined,
): void {
  if (status === HomeworkSubmissionStatus.PARTIAL && mode !== HomeworkGradingMode.PARTIAL) {
    throw new BadRequestException(
      'Partial can only be set when the homework grading mode is PARTIAL',
    );
  }
}

/**
 * [22.3.2] Student/guardian submission upload + teacher grade/override.
 *
 * `FamilyAccessService.assertLinked` is the single "does this caller own
 * this student" check (D26) — the same one `GET /students/mine` and the
 * attendance-summary routes use, so a PARENT/STUDENT can never submit for a
 * child they aren't linked to, and the check is tenant-scoped by
 * construction.
 */
@Injectable()
export class HomeworkSubmissionService {
  constructor(
    @InjectRepository(Homework)
    private readonly homeworkRepo: Repository<Homework>,
    @InjectRepository(HomeworkAssignment)
    private readonly assignmentRepo: Repository<HomeworkAssignment>,
    @InjectRepository(HomeworkSubmission)
    private readonly submissionRepo: Repository<HomeworkSubmission>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly access: HomeworkAccessService,
    private readonly familyAccess: FamilyAccessService,
    private readonly storage: StorageService,
    private readonly schoolsService: SchoolsService,
  ) {}

  private async loadAssignment(
    assignmentId: string,
    tenantId: string,
  ): Promise<HomeworkAssignment> {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenant_id: tenantId },
    });
    if (!assignment) {
      throw new NotFoundException('Homework assignment not found');
    }
    return assignment;
  }

  /** Validates that `studentId` is actually within the scope this
   * assignment targets — a single-student assignment must match exactly, a
   * section assignment must contain the student. Otherwise a linked
   * guardian could submit against an assignment that was never sent to
   * their child. */
  private async assertStudentInScope(
    assignment: HomeworkAssignment,
    studentId: string,
  ): Promise<void> {
    if (assignment.student_id) {
      if (assignment.student_id !== studentId) {
        throw new ForbiddenException('This assignment was not sent to this student');
      }
      return;
    }

    const student = await this.studentRepo.findOne({
      where: { id: studentId, tenant_id: assignment.tenant_id },
    });
    if (!student || student.class_section_id !== assignment.section_id) {
      throw new ForbiddenException('This assignment was not sent to this student');
    }
  }

  private validateFiles(files: Express.Multer.File[]): void {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }
    if (files.length > HOMEWORK_SUBMISSION_MAX_FILES) {
      throw new BadRequestException(`At most ${HOMEWORK_SUBMISSION_MAX_FILES} files are allowed`);
    }
    for (const file of files) {
      if (file.size > HOMEWORK_SUBMISSION_MAX_FILE_SIZE) {
        throw new BadRequestException(
          `Each file must be at most ${HOMEWORK_SUBMISSION_MAX_FILE_SIZE / (1024 * 1024)}MB`,
        );
      }
      if (!ALLOWED_MIME_TO_EXT[file.mimetype]) {
        throw new BadRequestException('Files must be PDF, JPG, PNG or WebP');
      }
      // The mimetype is client-sent; the leading bytes are not.
      if (!matchesDeclaredType(file.buffer, file.mimetype)) {
        throw new BadRequestException('File content does not match its declared type');
      }
    }
  }

  /**
   * `POST /homework-assignments/:id/submissions`. Same route handles the
   * first upload and every resubmission — resubmission replaces the whole
   * `attachments` array, both gated on `now() <= due_date`.
   */
  async upload(
    assignmentId: string,
    studentId: string,
    files: Express.Multer.File[],
    ctx: CallerContext,
  ): Promise<HomeworkSubmission> {
    const assignment = await this.loadAssignment(assignmentId, ctx.tenantId);

    await this.familyAccess.assertLinked(ctx.role, ctx.userId, studentId, ctx.tenantId);
    await this.assertStudentInScope(assignment, studentId);

    if (assignment.status !== HomeworkAssignmentStatus.ACTIVE) {
      throw new BadRequestException('This assignment is no longer active');
    }

    // due_date is a DATE column (no time-of-day) — the cutoff is evaluated
    // in the tenant's own timezone (same as HomeworkDefaulterScheduler and
    // HomeworkAnalyticsService), not the server's, so a submission near
    // midnight isn't accepted or rejected based on where the server happens
    // to run.
    const settings = await this.schoolsService.getResolvedSettings(ctx.tenantId);
    const timezone = settings.region?.timezone ?? 'UTC';
    if (localToday(timezone) > assignment.due_date) {
      throw new BadRequestException('The due date for this assignment has passed');
    }

    this.validateFiles(files);

    const attachments: SubmissionAttachment[] = [];
    for (const file of files) {
      const ext = ALLOWED_MIME_TO_EXT[file.mimetype];
      const key = tenantObjectKey(ctx.tenantId, 'homework-submissions', ext);
      await this.storage.put(key, file.buffer, file.mimetype);
      attachments.push({
        key,
        filename: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      });
    }

    // Insert-if-absent, then read the row FOR UPDATE, in one transaction (same shape as grade()):
    // a teacher's bulk grade may create this row at any moment, and a find-then-create here
    // would lose that race on the unique (assignment_id, student_id) index.
    let previousKeys: string[] = [];
    let saved: HomeworkSubmission;
    try {
      saved = await this.submissionRepo.manager.transaction(async (m) => {
        await m
          .createQueryBuilder()
          .insert()
          .into(HomeworkSubmission)
          .values({ tenant_id: ctx.tenantId, assignment_id: assignmentId, student_id: studentId })
          .orIgnore()
          .execute();
        const submission = await m.findOneOrFail(HomeworkSubmission, {
          where: { assignment_id: assignmentId, student_id: studentId, tenant_id: ctx.tenantId },
          lock: { mode: 'pessimistic_write' },
        });

        // Resubmission replaces the array — the old objects are never referenced
        // again, so they'd otherwise stay in storage forever. Keep their keys to
        // delete once the new row is safely saved.
        previousKeys = (submission.attachments as SubmissionAttachment[]).map((a) => a.key);

        submission.attachments = attachments;
        // D9: teacher override (PARTIAL/DONE) always wins — an upload never
        // resets a status the teacher already set. A brand-new row (or one
        // still NOT_SUBMITTED) flips to SUBMITTED; PARTIAL/DONE stay put.
        if (
          submission.status !== HomeworkSubmissionStatus.PARTIAL &&
          submission.status !== HomeworkSubmissionStatus.DONE
        ) {
          submission.status = HomeworkSubmissionStatus.SUBMITTED;
        }
        return m.save(submission);
      });
    } catch (err) {
      // The objects just uploaded in this call are orphaned.
      await Promise.allSettled(
        attachments.map((a) => this.storage.deleteForTenant(a.key, ctx.tenantId)),
      );
      throw err;
    }
    // Best-effort: a delete failure here must never mask a successful save.
    await Promise.allSettled(
      previousKeys.map((key) => this.storage.deleteForTenant(key, ctx.tenantId)),
    );
    // A late (after-school) upload clears the "not submitted" alert at once.
    emitRecheck(attentionEvents, {
      tenantId: ctx.tenantId,
      ruleKey: 'homework.not_submitted',
      actorUserId: ctx.userId,
    });
    return saved;
  }

  /** `PATCH /homework-submissions/:id` — teacher grade/override. */
  async update(
    submissionId: string,
    dto: UpdateHomeworkSubmissionDto,
    ctx: CallerContext,
  ): Promise<HomeworkSubmission> {
    // Rule 23: every miss (unknown id, other tenant, out-of-scope teacher) is one text.
    const miss = () => new NotFoundException('Homework submission not found');
    const submission = await this.submissionRepo.findOne({
      where: { id: submissionId, tenant_id: ctx.tenantId },
    });
    if (!submission) throw miss();
    const { homework } = await this.loadForGrading(submission.assignment_id, ctx).catch(
      (e: unknown) => {
        throw e instanceof NotFoundException ? miss() : e;
      },
    );

    if (dto.marks !== undefined && homework.grading_mode !== HomeworkGradingMode.MARKS) {
      throw new BadRequestException(
        'Marks can only be set when the homework grading mode is MARKS',
      );
    }
    assertStatusFitsMode(homework.grading_mode, dto.status);

    if (dto.status !== undefined) {
      submission.status = dto.status;
    }
    if (dto.marks !== undefined) {
      submission.marks = dto.marks;
    }

    const saved = await this.submissionRepo.save(submission);
    if (dto.status !== undefined) {
      emitRecheck(attentionEvents, {
        tenantId: ctx.tenantId,
        ruleKey: 'homework.not_submitted',
        actorUserId: ctx.userId,
      });
    }
    return saved;
  }

  /** Loads an assignment + its homework and applies the Rule 2 scope. Every miss is one text
   * (Rule 23): a teacher cannot tell "other section" from "no such id". 403s pass through. */
  private async loadForGrading(
    assignmentId: string,
    ctx: CallerContext,
  ): Promise<{ assignment: HomeworkAssignment; homework: Homework }> {
    const miss = () => new NotFoundException('Homework assignment not found');
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenant_id: ctx.tenantId },
    });
    if (!assignment) throw miss();
    const homework = await this.homeworkRepo.findOne({
      where: { id: assignment.homework_id, tenant_id: ctx.tenantId },
    });
    if (!homework) throw miss();
    try {
      if (assignment.section_id) {
        await this.access.assertCanManageSection(
          ctx.role,
          ctx.userId,
          assignment.section_id,
          homework.subject_id,
          ctx.tenantId,
        );
      } else {
        await this.access.assertCanManageStudent(
          ctx.role,
          ctx.userId,
          assignment.student_id as string,
          homework.subject_id,
          ctx.tenantId,
        );
      }
    } catch (e) {
      throw e instanceof NotFoundException ? miss() : e;
    }
    return { assignment, homework };
  }

  /**
   * D5 roster: every existing submission row is always listed (a student who moved still shows
   * their work; `dashboard-reconciliation` counts these rows). On top of that, with no row yet:
   * a section row adds live ACTIVE students of that section, a student row adds that student.
   * A SUPERSEDED assignment adds nobody (the new row owns the roster).
   */
  private async roster(
    assignment: HomeworkAssignment,
    tenantId: string,
  ): Promise<HomeworkSubmissionRosterRowDto[]> {
    const rows: HomeworkSubmissionRosterRowDto[] = await this.submissionRepo.manager.query(
      `SELECT st.id AS student_id, st.full_name AS student_name, st.roll_number,
              hs.id AS submission_id,
              COALESCE(hs.status::text, 'NOT_SUBMITTED') AS status,
              hs.marks,
              COALESCE(jsonb_array_length(hs.attachments), 0)::int AS attachment_count
         FROM students st
         LEFT JOIN homework_submissions hs
                ON hs.assignment_id = $2 AND hs.student_id = st.id AND hs.tenant_id = $1
        WHERE st.tenant_id = $1
          AND ( hs.id IS NOT NULL
                OR ( $3::text <> 'SUPERSEDED'
                     AND st.deleted_at IS NULL
                     AND st.enrollment_status = 'ACTIVE'
                     AND (st.class_section_id = $4::uuid OR st.id = $5::uuid) ) )
        ORDER BY st.roll_number ASC, st.full_name ASC, st.id ASC`,
      [tenantId, assignment.id, assignment.status, assignment.section_id, assignment.student_id],
    );
    return rows;
  }

  /** `GET /homework-assignments/:id/submissions` — teacher check-work view (#2899). */
  async findAllForAssignment(
    assignmentId: string,
    ctx: CallerContext,
  ): Promise<HomeworkSubmissionRosterRowDto[]> {
    const { assignment } = await this.loadForGrading(assignmentId, ctx);
    return this.roster(assignment, ctx.tenantId);
  }

  /**
   * `PATCH /homework-assignments/:id/submissions` — grade many students in one transaction,
   * creating the row for a student who never uploaded. All checks run before any write; each
   * text is fixed and echoes nothing (Rule 23). No idempotency key (Rule 25 exception): the
   * unique (assignment_id, student_id) index stops a second row and the route sets values.
   */
  async grade(
    assignmentId: string,
    dto: GradeSubmissionsDto,
    ctx: CallerContext,
  ): Promise<HomeworkSubmissionRosterRowDto[]> {
    const { assignment, homework } = await this.loadForGrading(assignmentId, ctx);
    const ids = dto.items.map((i) => i.student_id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Each student can appear only once');
    }
    if (dto.items.some((i) => i.status === undefined && i.marks === undefined)) {
      throw new BadRequestException('Nothing to change');
    }
    if (
      homework.grading_mode !== HomeworkGradingMode.MARKS &&
      dto.items.some((i) => i.marks !== undefined)
    ) {
      throw new BadRequestException(
        'Marks can only be set when the homework grading mode is MARKS',
      );
    }
    for (const item of dto.items) assertStatusFitsMode(homework.grading_mode, item.status);
    const onList = new Set((await this.roster(assignment, ctx.tenantId)).map((r) => r.student_id));
    if (ids.some((id) => !onList.has(id))) {
      throw new BadRequestException('A student in this list is not on this homework');
    }

    await this.submissionRepo.manager.transaction(async (m) => {
      await m
        .createQueryBuilder()
        .insert()
        .into(HomeworkSubmission)
        // Sorted: two Saves inserting the same students in different orders would deadlock.
        .values(
          [...ids].sort().map((student_id) => ({
            tenant_id: ctx.tenantId,
            assignment_id: assignment.id,
            student_id,
          })),
        )
        .orIgnore()
        .execute();
      const rows = await m.find(HomeworkSubmission, {
        where: { tenant_id: ctx.tenantId, assignment_id: assignment.id, student_id: In(ids) },
        lock: { mode: 'pessimistic_write' },
      });
      const byStudent = new Map(rows.map((r) => [r.student_id, r]));
      for (const item of dto.items) {
        const row = byStudent.get(item.student_id);
        if (!row) continue;
        if (item.status !== undefined) {
          row.status =
            item.status === HomeworkSubmissionStatus.NOT_SUBMITTED
              ? (row.attachments as unknown[]).length > 0
                ? HomeworkSubmissionStatus.SUBMITTED
                : HomeworkSubmissionStatus.NOT_SUBMITTED
              : item.status;
        }
        if (item.marks !== undefined) row.marks = item.marks;
      }
      await m.save(rows);
    });
    for (const ruleKey of ['homework.not_submitted', 'homework.to_grade'] as const) {
      emitRecheck(attentionEvents, { tenantId: ctx.tenantId, ruleKey, actorUserId: ctx.userId });
    }
    return this.roster(assignment, ctx.tenantId);
  }
}

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { HomeworkAssignmentStatus } from '@biddaloy/shared';
import { Homework } from './entities/homework.entity';
import { HomeworkAssignment } from './entities/homework-assignment.entity';
import { HomeworkAccessService } from './homework-access.service';
import { teacherAssignments, type TeacherAssignmentRow } from '../classes/teacher-scope.service';
import { HomeworkNoticeService } from './homework-notice.service';
import { homeworkTargetTaken } from '../../common/filters/known-errors';
import { HomeworkToCheckDto } from './dto/homework-dashboard.dto';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';
import {
  AssignHomeworkDto,
  CreateHomeworkDto,
  FamilyHomeworkListDto,
  HomeworkAssignmentListItemDto,
  QueryHomeworkDto,
  UpdateHomeworkAssignmentDto,
} from './dto/homework.dto';

interface CallerContext {
  role: string;
  userId: string;
  tenantId: string;
}

/**
 * [22.3.1] Homework CRUD + assign/reassign. `HomeworkAccessService` is the
 * object-level gate on every mutating call — `@RequirePermissions` on the
 * controller is only the coarse "may attempt this at all" gate.
 */
@Injectable()
export class HomeworkService {
  private readonly logger = new Logger(HomeworkService.name);

  constructor(
    @InjectRepository(Homework)
    private readonly homeworkRepo: Repository<Homework>,
    @InjectRepository(HomeworkAssignment)
    private readonly assignmentRepo: Repository<HomeworkAssignment>,
    private readonly access: HomeworkAccessService,
    private readonly notice: HomeworkNoticeService,
  ) {}

  /** Shared by assign/reassign/updateAssignment — the section-or-student
   * access check, dispatched on whichever target the row actually has. */
  private async assertCanManageTarget(
    target: { section_id?: string | null; student_id?: string | null },
    homework: Homework,
    ctx: CallerContext,
  ): Promise<void> {
    if (target.section_id) {
      await this.access.assertCanManageSection(
        ctx.role,
        ctx.userId,
        target.section_id,
        homework.subject_id,
        ctx.tenantId,
      );
    } else {
      await this.access.assertCanManageStudent(
        ctx.role,
        ctx.userId,
        target.student_id as string,
        homework.subject_id,
        ctx.tenantId,
      );
    }
  }

  /** #3172: one ACTIVE row per (homework, target). The partial unique indexes
   * (IDX_homework_assignments_active_section / _student) are the race backstop; this check gives
   * the caller a fixed 409 text first. `exceptId` is the row being reassigned or reactivated. */
  private async assertNoLiveRow(
    homeworkId: string,
    target: { section_id?: string | null; student_id?: string | null },
    tenantId: string,
    exceptId?: string,
  ): Promise<void> {
    const live = await this.assignmentRepo.exists({
      where: {
        tenant_id: tenantId,
        homework_id: homeworkId,
        status: HomeworkAssignmentStatus.ACTIVE,
        ...(target.section_id
          ? { section_id: target.section_id }
          : { student_id: target.student_id as string }),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    if (live) throw homeworkTargetTaken();
  }

  /** Shared by assign + reassign: exactly-one-target shape (D24), due_date
   * on/after assigned_date, object-level access, and the target actually
   * belongs to this homework's class (a rollup keys on homework.class_id,
   * so a target from a different class would silently corrupt it). */
  private async assertValidNewTarget(
    dto: AssignHomeworkDto,
    homework: Homework,
    ctx: CallerContext,
  ): Promise<void> {
    if (!!dto.section_id === !!dto.student_id) {
      throw new BadRequestException('Assign exactly one of section_id or student_id');
    }
    if (new Date(dto.due_date) < new Date(dto.assigned_date)) {
      throw new BadRequestException('due_date must be on or after assigned_date');
    }
    await this.assertCanManageTarget(dto, homework, ctx);
    await this.access.assertTargetInClass(
      dto.section_id,
      dto.student_id,
      homework.class_id,
      ctx.tenantId,
    );
  }

  async create(dto: CreateHomeworkDto, ctx: CallerContext): Promise<Homework> {
    // class_id/subject_id must belong to this tenant before any access
    // check runs against them — assertCanManageClass short-circuits without
    // a lookup for tenant-scope roles (`hasTenantScope`), so an ADMIN could otherwise create
    // homework pointing at another tenant's class/subject id.
    await this.access.assertClassAndSubjectInTenant(dto.class_id, dto.subject_id, ctx.tenantId);
    // Creation is scoped to a class/subject, not a section/student yet, so
    // the access check here is the class-teacher-or-tenant-role variant:
    // reuse assertCanManageSection with a null section check via the class's
    // own sections would over-fetch — instead a TEACHER must have SOME
    // TeacherClassSection row for this class_id/subject_id pair.
    await this.access.assertCanManageClass(
      ctx.role,
      ctx.userId,
      dto.class_id,
      dto.subject_id,
      ctx.tenantId,
    );

    const homework = this.homeworkRepo.create({
      subject_id: dto.subject_id,
      class_id: dto.class_id,
      title: dto.title,
      description: dto.description ?? null,
      grading_mode: dto.grading_mode,
      attachments: dto.attachments ?? [],
      tenant_id: ctx.tenantId,
    });
    return this.homeworkRepo.save(homework);
  }

  /**
   * [8.10.7.4.14] One child's ACTIVE homework due `today` or later. The controller has already
   * run `FamilyAccessService.assertLinked`; this one query is still tenant-filtered on every
   * table and joins the student by id + tenant + not-deleted, so an unknown/deleted student is empty.
   */
  async findForStudent(
    tenantId: string,
    studentId: string,
    today: string,
  ): Promise<FamilyHomeworkListDto> {
    const rows = await this.assignmentRepo
      .createQueryBuilder('ha')
      .innerJoin('homework', 'h', 'h.id = ha.homework_id AND h.tenant_id = :tenantId')
      .innerJoin('subjects', 'sub', 'sub.id = h.subject_id AND sub.tenant_id = :tenantId')
      .innerJoin(
        'students',
        'st',
        'st.id = :studentId AND st.tenant_id = :tenantId AND st.deleted_at IS NULL',
      )
      .select('ha.id', 'assignment_id')
      .addSelect('h.title', 'title')
      .addSelect('h.description', 'description')
      .addSelect('sub.name_en', 'subject_name_en')
      .addSelect('sub.name_bn', 'subject_name_bn')
      // to_char: the pg driver turns raw `date` columns into JS Dates (shifted by the server TZ).
      .addSelect(`to_char(ha.assigned_date, 'YYYY-MM-DD')`, 'assigned_date')
      .addSelect(`to_char(ha.due_date, 'YYYY-MM-DD')`, 'due_date')
      .where('ha.tenant_id = :tenantId', { tenantId })
      .andWhere('ha.status = :status', { status: HomeworkAssignmentStatus.ACTIVE })
      .andWhere('ha.assigned_date <= :today AND ha.due_date >= :today', { today })
      .andWhere('(ha.section_id = st.class_section_id OR ha.student_id = st.id)')
      .orderBy('ha.due_date', 'ASC')
      .addOrderBy('ha.assigned_date', 'ASC')
      .addOrderBy('ha.id', 'ASC')
      .limit(50)
      .setParameter('studentId', studentId)
      .getRawMany<FamilyHomeworkListDto['items'][number]>();
    return { today, items: rows };
  }

  async findAll(query: QueryHomeworkDto, ctx: CallerContext): Promise<Homework[]> {
    const qb = this.homeworkRepo
      .createQueryBuilder('h')
      .where('h.tenant_id = :tenantId', { tenantId: ctx.tenantId });

    if (query.class_id) {
      qb.andWhere('h.class_id = :classId', { classId: query.class_id });
    }
    if (query.subject_id) {
      qb.andWhere('h.subject_id = :subjectId', { subjectId: query.subject_id });
    }
    if (query.section_id || query.status) {
      qb.innerJoin('homework_assignments', 'ha', 'ha.homework_id = h.id');
      if (query.section_id) {
        qb.andWhere('ha.section_id = :sectionId', { sectionId: query.section_id });
      }
      if (query.status) {
        qb.andWhere('ha.status = :status', { status: query.status });
      }
    }

    // Same object-level gate as mutations: tenant-wide managers see everything in the
    // tenant; anyone else only what `applyTeacherScope` lets through. No rows = nothing.
    if (!this.access.canManageTenantWide(ctx.role) && !(await this.applyTeacherScope(qb, ctx))) {
      return [];
    }

    return qb.orderBy('h.created_at', 'DESC').getMany();
  }

  /**
   * [8.10.7.3.04] Teacher card "homework to check": SUBMITTED rows waiting in the caller's
   * (section, subject) scope. Scope = `teacherAssignments` (the one teacher join, Epic 75 D2):
   * a row with no subject (class teacher) covers every subject of its section, a subject row
   * only that subject. One grouped query; totals are summed in TS, then the top 5 are kept.
   */
  async submissionsToCheck(ctx: CallerContext): Promise<HomeworkToCheckDto> {
    const rows = await teacherAssignments(this.homeworkRepo.manager, ctx);
    if (rows.length === 0) return { total_submitted: 0, assignment_count: 0, items: [] };
    const groups: {
      assignment_id: string;
      homework_id: string;
      title: string;
      class_name: string;
      section_name: string;
      subject_name_en: string;
      subject_name_bn: string | null;
      due_date: string;
      submitted_count: string;
    }[] = await this.homeworkRepo.manager.query(
      `WITH scope(section_id, subject_id) AS (SELECT * FROM unnest($2::uuid[], $3::uuid[]))
       SELECT ha.id AS assignment_id, h.id AS homework_id, h.title,
              c.name AS class_name, cs.section_name,
              sub.name_en AS subject_name_en, sub.name_bn AS subject_name_bn,
              ha.due_date::text AS due_date, COUNT(*) AS submitted_count
         FROM homework_submissions hs
         JOIN homework_assignments ha ON ha.id = hs.assignment_id AND ha.tenant_id = $1
         JOIN homework h ON h.id = ha.homework_id AND h.tenant_id = $1
         LEFT JOIN students st ON st.id = ha.student_id AND st.tenant_id = $1
         JOIN class_sections cs ON cs.id = COALESCE(ha.section_id, st.class_section_id) AND cs.tenant_id = $1
         JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
         JOIN subjects sub ON sub.id = h.subject_id AND sub.tenant_id = $1
        WHERE hs.tenant_id = $1 AND hs.status = 'SUBMITTED' AND ha.status = 'ACTIVE'
          AND EXISTS (SELECT 1 FROM scope sc WHERE sc.section_id = cs.id
                        AND (sc.subject_id IS NULL OR sc.subject_id = h.subject_id))
        GROUP BY ha.id, h.id, h.title, c.name, cs.section_name, sub.name_en, sub.name_bn, ha.due_date
        ORDER BY submitted_count DESC, ha.due_date ASC, ha.id ASC`,
      [ctx.tenantId, rows.map((r) => r.section_id), rows.map((r) => r.subject_id)],
    );
    const counted = groups.map((g) => ({ ...g, submitted_count: Number(g.submitted_count) }));
    return {
      total_submitted: counted.reduce((n, g) => n + g.submitted_count, 0),
      assignment_count: counted.length,
      items: counted.slice(0, 5),
    };
  }

  /**
   * [86.1/#2861] Narrows `qb` (alias `h`) to what a non-manager may see, or returns false
   * when they have no current-year assignment (caller shows nothing). A homework is visible
   * if (A) it has an assignment in one of their sections (a homeroom row covers any subject,
   * a subject row only that subject), or (B) it has no assignment yet and sits in their
   * class/subject scope, so a just-created homework stays visible to the teacher who will
   * assign it. Shared by the list and `findOne` so both answer the same (Rule 2).
   */
  private async applyTeacherScope(
    qb: SelectQueryBuilder<Homework>,
    ctx: CallerContext,
    scopeRows?: TeacherAssignmentRow[],
  ): Promise<boolean> {
    const rows = scopeRows ?? (await this.teacherScopeRows(ctx));
    if (rows.length === 0) return false;
    const homeroomClassIds = [
      ...new Set(rows.filter((r) => r.subject_id === null).map((r) => r.class_id)),
    ];
    qb.andWhere(
      new Brackets((w) => {
        // A: assigned in one of my sections (section from the row, else the student's).
        w.where(
          `EXISTS (
             SELECT 1 FROM homework_assignments hax
             LEFT JOIN students stx ON stx.id = hax.student_id AND stx.tenant_id = :scopeTenant
             JOIN unnest(CAST(:scopeSections AS uuid[]), CAST(:scopeSubjects AS uuid[]))
                  AS sc(section_id, subject_id)
               ON sc.section_id = COALESCE(hax.section_id, stx.class_section_id)
            WHERE hax.homework_id = h.id AND hax.tenant_id = :scopeTenant
              AND (sc.subject_id IS NULL OR sc.subject_id = h.subject_id))`,
          {
            scopeTenant: ctx.tenantId,
            scopeSections: rows.map((r) => r.section_id),
            scopeSubjects: rows.map((r) => r.subject_id),
          },
        );
        // B: not assigned yet AND in my class/subject scope.
        w.orWhere(
          new Brackets((u) => {
            u.where(
              `NOT EXISTS (SELECT 1 FROM homework_assignments han
                WHERE han.homework_id = h.id AND han.tenant_id = :scopeTenant)`,
            );
            u.andWhere(
              new Brackets((c) => {
                // `1 = 0` keeps the OR chain valid when there is no homeroom row.
                if (homeroomClassIds.length)
                  c.where('h.class_id IN (:...homeroomClassIds)', { homeroomClassIds });
                else c.where('1 = 0');
                // One term per distinct (class, subject), skipping homeroom-covered classes.
                const subjectTerms = new Map(
                  rows
                    .filter((r) => r.subject_id !== null && !homeroomClassIds.includes(r.class_id))
                    .map((r) => [`${r.class_id}:${r.subject_id}`, r] as const),
                );
                [...subjectTerms.values()].forEach((r, i) =>
                  c.orWhere(`(h.class_id = :c${i} AND h.subject_id = :s${i})`, {
                    [`c${i}`]: r.class_id,
                    [`s${i}`]: r.subject_id,
                  }),
                );
              }),
            );
          }),
        );
      }),
    );
    return true;
  }

  /** The caller's current-year section duties (`teacherAssignments`, the one teacher join). */
  private teacherScopeRows(ctx: CallerContext): Promise<TeacherAssignmentRow[]> {
    return teacherAssignments(this.homeworkRepo.manager, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    });
  }

  /** `scopeRows`: a caller that already read the teacher's duties passes them in, so one
   * request does not run the same join twice (#3173). */
  async findOne(
    id: string,
    ctx: CallerContext,
    scopeRows?: TeacherAssignmentRow[],
  ): Promise<Homework> {
    const homework = await this.homeworkRepo.findOne({
      where: { id, tenant_id: ctx.tenantId },
    });
    if (!homework) {
      throw new NotFoundException('Homework not found');
    }
    // D13: a teacher outside the class gets the same 404 as a missing homework.
    await this.access
      .assertCanManageClass(
        ctx.role,
        ctx.userId,
        homework.class_id,
        homework.subject_id,
        ctx.tenantId,
      )
      .catch((e: unknown) => {
        throw e instanceof NotFoundException ? new NotFoundException('Homework not found') : e;
      });
    // Rule 2: what the list hides (homework assigned only to another section) is 404 here too.
    if (!this.access.canManageTenantWide(ctx.role)) {
      const scoped = this.homeworkRepo
        .createQueryBuilder('h')
        .where('h.id = :id AND h.tenant_id = :tenantId', { id, tenantId: ctx.tenantId });
      if (!(await this.applyTeacherScope(scoped, ctx, scopeRows)) || !(await scoped.getExists())) {
        throw new NotFoundException('Homework not found');
      }
    }
    return homework;
  }

  /**
   * Every assignment row of one homework, with its target as names. `findOne` is the
   * 404/tenant/scope gate. A teacher sees only rows passing the same section + subject
   * rule as `assertCanManageSection`, so every listed row can be reassigned.
   */
  async findAssignments(
    homeworkId: string,
    ctx: CallerContext,
  ): Promise<HomeworkAssignmentListItemDto[]> {
    // A teacher's duties are read once and shared with the `findOne` gate (#3173).
    const teacherRows = this.access.canManageTenantWide(ctx.role)
      ? undefined
      : await this.teacherScopeRows(ctx);
    const homework = await this.findOne(homeworkId, ctx, teacherRows);
    const qb = this.assignmentRepo
      .createQueryBuilder('ha')
      .leftJoin(
        'students',
        'st',
        'st.id = ha.student_id AND st.tenant_id = :tenantId AND st.deleted_at IS NULL',
      )
      .innerJoin(
        'class_sections',
        'cs',
        'cs.id = COALESCE(ha.section_id, st.class_section_id) AND cs.tenant_id = :tenantId AND cs.deleted_at IS NULL',
      )
      .select([
        'ha.id AS id',
        'ha.homework_id AS homework_id',
        'ha.section_id AS section_id',
        'ha.student_id AS student_id',
        'ha.status AS status',
        'cs.id AS target_section_id',
        'cs.section_name AS section_name',
        'st.full_name AS student_name',
      ])
      // Raw `date` columns would come back as shifted JS Dates; see findForStudent.
      .addSelect("to_char(ha.assigned_date, 'YYYY-MM-DD')", 'assigned_date')
      .addSelect("to_char(ha.due_date, 'YYYY-MM-DD')", 'due_date')
      .where('ha.homework_id = :homeworkId AND ha.tenant_id = :tenantId', {
        homeworkId: homework.id,
        tenantId: ctx.tenantId,
      });
    if (teacherRows) {
      const rows = teacherRows;
      if (rows.length === 0) return [];
      qb.andWhere(
        `EXISTS (SELECT 1 FROM unnest(CAST(:scopeSections AS uuid[]), CAST(:scopeSubjects AS uuid[]))
                   AS sc(section_id, subject_id)
                 WHERE sc.section_id = cs.id
                   AND (sc.subject_id IS NULL OR sc.subject_id = :hwSubject))`,
        {
          scopeSections: rows.map((r) => r.section_id),
          scopeSubjects: rows.map((r) => r.subject_id),
          hwSubject: homework.subject_id,
        },
      );
    }
    return qb
      .orderBy("CASE ha.status WHEN 'ACTIVE' THEN 0 WHEN 'DEACTIVATED' THEN 1 ELSE 2 END", 'ASC')
      .addOrderBy('ha.due_date', 'DESC')
      .addOrderBy('ha.created_at', 'DESC')
      .addOrderBy('ha.id', 'ASC')
      .limit(100)
      .getRawMany<HomeworkAssignmentListItemDto>();
  }

  async assign(
    homeworkId: string,
    dto: AssignHomeworkDto,
    ctx: CallerContext,
  ): Promise<HomeworkAssignment> {
    const homework = await this.findOne(homeworkId, ctx);

    await this.assertValidNewTarget(dto, homework, ctx);
    await this.assertNoLiveRow(homework.id, dto, ctx.tenantId);

    const assignment = this.assignmentRepo.create({
      homework_id: homework.id,
      section_id: dto.section_id ?? null,
      student_id: dto.student_id ?? null,
      assigned_date: dto.assigned_date,
      due_date: dto.due_date,
      status: HomeworkAssignmentStatus.ACTIVE,
      tenant_id: ctx.tenantId,
    });
    const saved = await this.assignmentRepo.save(assignment);

    await this.tryNotice(saved.id, () => this.notice.notifyAssignment(saved, homework));

    return saved;
  }

  /** [22.3.3] Fire-and-forget would risk a silently-lost notice on a transient error with no
   * caller to see it; awaiting keeps it on the request but must never turn a successful write
   * into a 500 just because a guardian's CommunicationLog insert failed. HomeworkNoticeService
   * already logs per guardian; this catches a failure *before* that (e.g. loading target
   * students). The assignment is the source of truth and is never rolled back for a notice. */
  private async tryNotice(assignmentId: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (err) {
      this.logger.warn(
        `Failed to send homework notice for assignment ${assignmentId}: ${(err as Error).message}`,
      );
    }
  }

  /** D20 — reassignment always creates a new row rather than mutating the
   * old one. The old row is marked SUPERSEDED (shared/src/enums/homework.ts),
   * not left ACTIVE, so it stops showing up as a live assignment. */
  async reassign(
    assignmentId: string,
    dto: AssignHomeworkDto,
    ctx: CallerContext,
  ): Promise<HomeworkAssignment> {
    // Rule 23: unknown id, other tenant and out-of-scope all answer one text; the superseded 400
    // is only reachable by a caller who may manage the row (same order as updateAssignment).
    const miss = () => new NotFoundException('Homework assignment not found');
    const old = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenant_id: ctx.tenantId },
    });
    if (!old) throw miss();
    let homework: Homework;
    try {
      homework = await this.findOne(old.homework_id, ctx);
      // The caller must be able to manage the OLD target too, not just the
      // new one — otherwise any teacher on the tenant could reassign (and so
      // supersede) another teacher's assignment by naming their own section
      // as the new target.
      await this.assertCanManageTarget(old, homework, ctx);
    } catch (e) {
      throw e instanceof NotFoundException ? miss() : e;
    }
    if (old.status === HomeworkAssignmentStatus.SUPERSEDED) {
      throw new BadRequestException('This assignment has already been reassigned');
    }
    // A withdrawn row is brought back with Reactivate, never silently revived by a new ACTIVE row.
    if (old.status === HomeworkAssignmentStatus.DEACTIVATED) {
      throw new BadRequestException('Reactivate this assignment before reassigning it');
    }
    await this.assertValidNewTarget(dto, homework, ctx);
    await this.assertNoLiveRow(old.homework_id, dto, ctx.tenantId, old.id);

    // Both writes in one transaction, and the old row's supersede is a
    // conditional UPDATE (not a save() of the already-fetched entity): a
    // crash between the two writes must never leave the homework with two
    // live ACTIVE rows, and two concurrent reassign calls (or a reassign racing a
    // deactivate) for the same assignmentId must not both pass the earlier status
    // checks — whichever loses the race gets 0 affected rows here and aborts instead.
    const created = await this.assignmentRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(HomeworkAssignment);
      const result = await repo.update(
        { id: old.id, tenant_id: ctx.tenantId, status: HomeworkAssignmentStatus.ACTIVE },
        { status: HomeworkAssignmentStatus.SUPERSEDED },
      );
      if (!result.affected) {
        throw new BadRequestException('This assignment has changed. Reload and try again.');
      }
      return repo.save(
        repo.create({
          homework_id: old.homework_id,
          section_id: dto.section_id ?? null,
          student_id: dto.student_id ?? null,
          assigned_date: dto.assigned_date,
          due_date: dto.due_date,
          status: HomeworkAssignmentStatus.ACTIVE,
          tenant_id: ctx.tenantId,
        }),
      );
    });

    // #3172: families hear about it. Another target: the new one gets the assigned notice and
    // the old one is told it was withdrawn. Same target: only a moved due date is news.
    const sameTarget =
      old.section_id === created.section_id && old.student_id === created.student_id;
    if (!sameTarget) {
      await this.tryNotice(created.id, () => this.notice.notifyAssignment(created, homework));
      await this.tryNotice(old.id, () =>
        this.notice.notifyChange(old, homework, 'WITHDRAWN', created),
      );
    } else if (old.due_date.slice(0, 10) !== created.due_date.slice(0, 10)) {
      await this.tryNotice(created.id, () =>
        this.notice.notifyChange(created, homework, 'DUE_CHANGED'),
      );
    }
    return created;
  }

  /** `PATCH /homework-assignments/:id`: status and/or due date, in place (#2900). Every miss
   * (unknown id, homework or target out of the teacher's scope) is one 404 text (Rule 23). */
  async updateAssignment(
    assignmentId: string,
    dto: UpdateHomeworkAssignmentDto,
    ctx: CallerContext,
  ): Promise<HomeworkAssignment> {
    if (dto.status === undefined && dto.due_date === undefined) {
      throw new BadRequestException('Nothing to change');
    }
    const miss = () => new NotFoundException('Homework assignment not found');
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId, tenant_id: ctx.tenantId },
    });
    if (!assignment) throw miss();
    let homework: Homework;
    try {
      homework = await this.findOne(assignment.homework_id, ctx);
      await this.assertCanManageTarget(assignment, homework, ctx);
    } catch (e) {
      throw e instanceof NotFoundException ? miss() : e;
    }

    if (assignment.status === HomeworkAssignmentStatus.SUPERSEDED) {
      throw new BadRequestException('A superseded assignment cannot be changed');
    }
    if (dto.due_date !== undefined && dto.due_date < assignment.assigned_date) {
      throw new BadRequestException('due_date must be on or after assigned_date');
    }
    // Reactivating must not leave two live rows for one target.
    if (
      dto.status === HomeworkAssignmentStatus.ACTIVE &&
      assignment.status !== HomeworkAssignmentStatus.ACTIVE
    ) {
      await this.assertNoLiveRow(assignment.homework_id, assignment, ctx.tenantId, assignment.id);
    }
    const patch: Pick<Partial<HomeworkAssignment>, 'due_date' | 'status'> = {
      ...(dto.due_date !== undefined ? { due_date: dto.due_date } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    };
    // Conditional on the status read above: a reassign, or a second PATCH (two tabs, a double
    // click), that got there first wins and this one changes nothing and tells no one
    // (0 rows = lost race).
    const result = await this.assignmentRepo.update(
      { id: assignment.id, tenant_id: ctx.tenantId, status: assignment.status },
      patch,
    );
    if (!result.affected) {
      throw new BadRequestException('This assignment has changed. Reload and try again.');
    }
    // The not-submitted alert keys on status + due_date: a deactivate or date move clears it now.
    emitRecheck(attentionEvents, {
      tenantId: ctx.tenantId,
      ruleKey: 'homework.not_submitted',
      actorUserId: ctx.userId,
    });
    // #3172: tell families about a real change only. Deactivating withdraws the homework;
    // reactivating puts it back (they were told it no longer needed submitting), with its due
    // date; a moved due date on a live row is news. A repeated PATCH that changes nothing sends
    // nothing, and one change sends one notice.
    const updated = Object.assign({}, assignment, patch);
    const deactivated =
      updated.status === HomeworkAssignmentStatus.DEACTIVATED &&
      assignment.status !== HomeworkAssignmentStatus.DEACTIVATED;
    const reactivated =
      updated.status === HomeworkAssignmentStatus.ACTIVE &&
      assignment.status === HomeworkAssignmentStatus.DEACTIVATED;
    const dueMoved = updated.due_date.slice(0, 10) !== assignment.due_date.slice(0, 10);
    const kind = deactivated
      ? 'WITHDRAWN'
      : reactivated
        ? 'REACTIVATED'
        : dueMoved && updated.status === HomeworkAssignmentStatus.ACTIVE
          ? 'DUE_CHANGED'
          : null;
    if (kind) {
      await this.tryNotice(assignment.id, () => this.notice.notifyChange(updated, homework, kind));
    }
    return Object.assign(assignment, patch);
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  EntityManager,
  In,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  AuditAction,
  Permission,
  TeacherAssignmentType,
  roleHasPermission,
} from '@biddaloy/shared';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { Student } from '../students/entities/student.entity';
import { sectionRosterIdsBySection, sectionRosterStudentIds } from '../enrollments/section-roster';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { AttendanceAccessService } from './attendance-access.service';
import { AuditService, RecordAuditEntryInput } from '../audit/audit.service';
import { QueryAuditLogDto } from '../audit/dto/audit-log.dto';
import { AuditLogResponseDto } from '../audit/dto/audit-log-response.dto';
import { SchoolsService } from '../schools/schools.service';
import {
  daysBetween,
  isWeeklyOff,
  localToday,
  policyForShift,
  resolveAttendancePolicy,
} from './attendance-policy.util';
import {
  CorrectRecordDto,
  MatrixSaveResponseDto,
  PeriodDto,
  PutRegisterDto,
  PutRegisterMatrixDto,
  RegisterResponseDto,
} from './dto/attendance.dto';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { AbsenceNoticeService } from './absence-notice.service';
import { ArrivalNoticeService } from './arrival-notice.service';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MIN_REASON_LENGTH = 3;

function isReasonTooShort(reason: string | undefined): boolean {
  return !reason || reason.trim().length < MIN_REASON_LENGTH;
}

interface RegisterCounts {
  present: number;
  absent: number;
  late: number;
  leave: number;
}

function emptyCounts(): RegisterCounts {
  return { present: 0, absent: 0, late: 0, leave: 0 };
}

function tallyStatus(counts: RegisterCounts, status: AttendanceStatus): void {
  if (status === AttendanceStatus.PRESENT) counts.present += 1;
  else if (status === AttendanceStatus.ABSENT) counts.absent += 1;
  else if (status === AttendanceStatus.LATE) counts.late += 1;
  else if (status === AttendanceStatus.LEAVE) counts.leave += 1;
}

/**
 * The write side of attendance — read a section's register for a day,
 * submit the whole register in one idempotent call, correct a single mark
 * with a mandatory reason, and read that mark's change history. Summaries
 * and reports are [9.4]'s concern, not this service's.
 *
 * Every route delegates object-level access to `AttendanceAccessService`
 * first — `@Roles(...)` on the controller only says "this role may attempt
 * this endpoint", never "this section".
 *
 * `AttendanceRecord` has no persisted `correction_count`/`corrected_at`
 * column — [9.2]'s entity doesn't have one, and adding one here would be a
 * schema change to an already-merged ticket for a value that's cheaply
 * derivable instead. `correction_count` in every response is therefore a
 * COUNT of `UPDATE` `audit_logs` rows for that record, computed with one
 * grouped query per register read (see `getCorrectionCounts`) rather than
 * N+1. `GET /records/:id/history` remains the source of truth for *when*
 * and *why* each correction happened.
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectRepository(AttendanceSession)
    private readonly sessionRepo: Repository<AttendanceSession>,
    @InjectRepository(AttendanceRecord)
    private readonly recordRepo: Repository<AttendanceRecord>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    @InjectRepository(Teacher)
    private readonly teacherRepo: Repository<Teacher>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly attendanceAccessService: AttendanceAccessService,
    private readonly auditService: AuditService,
    private readonly schoolsService: SchoolsService,
    private readonly schoolCalendarService: SchoolCalendarService,
    private readonly absenceNoticeService: AbsenceNoticeService,
    private readonly arrivalNoticeService: ArrivalNoticeService,
  ) {}

  // ---------------------------------------------------------------------
  // GET /attendance/my-sections
  // ---------------------------------------------------------------------

  async listMySections(params: { role: string; userId: string; tenantId: string; date?: string }) {
    const { role, userId, tenantId } = params;

    // `date` defaults to the tenant's local today (not the server's UTC
    // day) when the caller doesn't supply one — this is the teacher's
    // landing screen, so "today" must mean the school's today.
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const tenantToday = localToday(settings.region?.timezone ?? 'UTC');
    const date = params.date ?? tenantToday;
    // Same rule and status as `writeRegisterDay`: a tenant that allows future
    // dates (leave marked ahead) may also list them.
    if (date > tenantToday && !resolveAttendancePolicy(settings).allowFutureDates) {
      throw new UnprocessableEntityException({
        message: 'Cannot list attendance for a future date',
        details: { code: 'ATTENDANCE_FUTURE_DATE' },
      });
    }

    const sections = await this.attendanceAccessService.listMarkableSections(
      role,
      userId,
      tenantId,
    );
    if (sections.length === 0) return [];

    const sectionIds = sections.map((s) => s.id);

    // One grouped query for every section's roster size, not one per section.
    // ponytail: a back-dated leaver's saved mark is counted as marked but not in
    // student_count, so unmarked can read 1 low; count the union per session if it matters.
    const rosters = await sectionRosterIdsBySection(this.dataSource.manager, tenantId, sectionIds, {
      onRollOn: date,
    });

    // One query for every section's session on this date, not one per section.
    // Whole-day registers only: a period register on the same date must not
    // overwrite the day register in the per-section map below.
    const sessions = await this.sessionRepo.find({
      where: { tenant_id: tenantId, section_id: In(sectionIds), date, period_no: IsNull() },
    });
    const sessionBySectionId = new Map(sessions.map((s) => [s.section_id, s]));
    const sessionIds = sessions.map((s) => s.id);

    const countsBySessionId = new Map<string, RegisterCounts>();
    if (sessionIds.length > 0) {
      const rows = await this.recordRepo
        .createQueryBuilder('r')
        .select('r.session_id', 'session_id')
        .addSelect('r.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('r.tenant_id = :tenantId', { tenantId })
        .andWhere('r.session_id IN (:...sessionIds)', { sessionIds })
        .groupBy('r.session_id')
        .addGroupBy('r.status')
        .getRawMany<{ session_id: string; status: AttendanceStatus; count: string }>();

      for (const row of rows) {
        const entry = countsBySessionId.get(row.session_id) ?? emptyCounts();
        const n = Number(row.count);
        if (row.status === AttendanceStatus.PRESENT) entry.present += n;
        else if (row.status === AttendanceStatus.ABSENT) entry.absent += n;
        else if (row.status === AttendanceStatus.LATE) entry.late += n;
        else if (row.status === AttendanceStatus.LEAVE) entry.leave += n;
        countsBySessionId.set(row.session_id, entry);
      }
    }

    // One grouped query for every section's class teacher (never per section).
    // Only CLASS_TEACHER rows count: assistants and subject teachers are not
    // the class teacher. If a section somehow has two, the first by name wins.
    const classTeacherRows = await this.dataSource
      .getRepository(TeacherClassSection)
      .createQueryBuilder('tcs')
      .innerJoin('tcs.teacher', 'teacher')
      .innerJoin('teacher.user', 'user')
      .select('tcs.section_id', 'section_id')
      .addSelect('user.full_name', 'full_name')
      .where('tcs.tenant_id = :tenantId', { tenantId })
      .andWhere('tcs.section_id IN (:...sectionIds)', { sectionIds })
      .andWhere('tcs.assignment_type = :type', { type: TeacherAssignmentType.CLASS_TEACHER })
      .orderBy('user.full_name', 'ASC')
      .getRawMany<{ section_id: string; full_name: string }>();
    const classTeacherBySectionId = new Map<string, string>();
    for (const row of classTeacherRows) {
      if (!classTeacherBySectionId.has(row.section_id)) {
        classTeacherBySectionId.set(row.section_id, row.full_name);
      }
    }

    // Working-day check once per distinct class (a holiday can be class-scoped).
    const classIds = [...new Set(sections.map((s) => s.class_id))];
    const workingByClassId = new Map<string, boolean>();
    for (const classId of classIds) {
      workingByClassId.set(
        classId,
        !(await this.schoolCalendarService.isNonWorkingDay({ tenantId, date, classId })),
      );
    }

    return sections.map((section) => {
      const session = sessionBySectionId.get(section.id);
      const studentCount = rosters.get(section.id)?.length ?? 0;
      const className = (section as ClassSection & { class?: { name: string } }).class?.name ?? '';

      let today = null;
      if (session) {
        const counts = countsBySessionId.get(session.id) ?? emptyCounts();
        const marked = counts.present + counts.absent + counts.late + counts.leave;
        today = {
          state: session.state,
          present: counts.present,
          absent: counts.absent,
          late: counts.late,
          leave: counts.leave,
          unmarked: Math.max(studentCount - marked, 0),
          marked_at: session.marked_at ? session.marked_at.toISOString() : null,
        };
      }

      return {
        section_id: section.id,
        section_name: section.section_name,
        class_id: section.class_id,
        class_name: className,
        student_count: studentCount,
        class_teacher_name: classTeacherBySectionId.get(section.id) ?? null,
        is_working_day: workingByClassId.get(section.class_id) ?? true,
        today,
      };
    });
  }

  // ---------------------------------------------------------------------
  // GET /attendance/sections/:sectionId/register
  // ---------------------------------------------------------------------

  async getRegister(params: {
    sectionId: string;
    date: string;
    periodNo: number | null;
    tenantId: string;
    role: string;
    userId: string;
  }): Promise<RegisterResponseDto> {
    const { sectionId, date, periodNo, tenantId, role, userId } = params;
    // [83.3.1] D4 read: a coordinator opens the register of their classes read-only.
    await this.assertRegisterAccess(role, userId, sectionId, tenantId, date, periodNo, {
      includeCoordinated: true,
    });
    return this.loadRegister(this.dataSource.manager, {
      sectionId,
      date,
      periodNo,
      tenantId,
      role,
    });
  }

  // ---------------------------------------------------------------------
  // PUT /attendance/sections/:sectionId/register
  // ---------------------------------------------------------------------

  async putRegister(params: {
    sectionId: string;
    tenantId: string;
    role: string;
    userId: string;
    dto: PutRegisterDto;
    ip: string | null;
    userAgent: string | null;
  }): Promise<RegisterResponseDto> {
    const { sectionId, tenantId, role, userId, dto, ip, userAgent } = params;

    const periodNo = dto.period_no ?? null;

    // 1. Object-level access (and the period switch, for a period register).
    await this.assertRegisterAccess(role, userId, sectionId, tenantId, dto.date, periodNo);

    // 3. Date sanity.
    if (!DATE_ONLY.test(dto.date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    // 8 (part). Duplicate student_id is a 400 (malformed request), checked
    // before anything transactional.
    const studentIds = dto.entries.map((e) => e.student_id);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('entries contains a duplicate student_id');
    }

    // Wrapped rather than left to propagate as a 500: when no session exists
    // yet, two concurrent PUTs both pass the pessimistic-lock lookup with a
    // null result, then race to insert — the loser hits `UQ_att_session`.
    // That's a version conflict in spirit, not a server error, so it's
    // mapped to the same 409 the version check above already returns.
    let result: RegisterResponseDto;
    try {
      result = await this.dataSource.transaction((manager) =>
        this.writeRegisterDay(
          manager,
          { sectionId, tenantId, role, userId, ip, userAgent, matrix: false },
          dto,
        ),
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException({
          message: 'This register was just created by another request',
          details: { code: 'ATTENDANCE_SESSION_RACE' },
        });
      }
      throw err;
    }

    // [9.8] Auto-absent guardian notification: only for a teacher-initiated
    // `finalize: true` on a whole-day (period_no null) register, and only
    // when the tenant has opted in. Runs after the write transaction has
    // committed — a notification failure must never roll back the
    // register submission that triggered it, so it is awaited (for a
    // deterministic response/test story) but its own failure is swallowed,
    // not surfaced to the caller.
    if (
      dto.finalize &&
      periodNo === null &&
      result.session.state === AttendanceSessionState.FINALIZED
    ) {
      // Settings are read once for both notices; a failed read skips both (fail open).
      const settings = await this.schoolsService.getResolvedSettings(tenantId).catch((err) => {
        this.logger.warn(`Notice settings unavailable for section ${sectionId}: ${String(err)}`);
        return null;
      });
      try {
        if (settings && resolveAttendancePolicy(settings).autoAbsentNotification.enabled) {
          await this.absenceNoticeService.sendAbsenceNotices({
            tenantId,
            sectionId,
            date: dto.date,
            initiatedByUserId: userId,
          });
        }
      } catch (err) {
        this.logger.warn(
          `Auto-absent notification failed for section ${sectionId} on ${dto.date}: ${String(err)}`,
        );
      }
      // [84.3.1 / D11, D26] Arrival notices for the PRESENT/LATE students of a finalized
      // whole-day register. Own try/catch: a failure here never undoes the register. Teacher time
      // is "now" (the service ignores non-arrived statuses; the DB unique key dedupes a device send).
      try {
        if (settings?.attendance?.arrivalNotice?.enabled === true) {
          const now = new Date();
          await this.arrivalNoticeService.sendArrivalNotices({
            tenantId,
            date: dto.date,
            // The saved register is already in `result`: no second query.
            students: result.students.flatMap((r) =>
              r.status ? [{ studentId: r.student_id, status: r.status, occurredAt: now }] : [],
            ),
            takenBy: { kind: 'TEACHER', userId },
          });
        }
      } catch (err) {
        this.logger.warn(
          `Arrival notice failed for section ${sectionId} on ${dto.date}: ${String(err)}`,
        );
      }
    }

    // Only a FINALIZED register changes attendance.not_taken; a draft save
    // must not trigger a recheck that would stamp this user on other alerts.
    if (result.session.state === AttendanceSessionState.FINALIZED) {
      emitRecheck(attentionEvents, {
        tenantId,
        ruleKey: 'attendance.not_taken',
        actorUserId: userId,
      });
    }
    return result;
  }

  /**
   * An approved student leave's effect on the whole-day registers: LEAVE for
   * every working day of the student's class in `[from, to]`. Runs inside the
   * caller's transaction and never opens one. Not a teacher edit, so no
   * future-date / correction-window / FINALIZED checks and no absence notice.
   * PRESENT / LATE marks are never overwritten; ABSENT becomes LEAVE (audited).
   */
  async markLeaveRange(
    manager: EntityManager,
    input: {
      tenantId: string;
      studentId: string;
      from: string;
      to: string;
      actorUserId: string;
      applicationId: string;
    },
  ): Promise<{ dates: string[] }> {
    const { tenantId, studentId, from, to, actorUserId, applicationId } = input;
    const student = await manager
      .getRepository(Student)
      .findOne({ where: { id: studentId, tenant_id: tenantId } });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    // ponytail: the student's section NOW, for every date. A backdated leave (D21) that spans a
    // section change lands in the new section's register; resolve the section per date from
    // `enrollments` if that case shows up.
    const section = await manager
      .getRepository(ClassSection)
      .findOne({ where: { id: student.class_section_id, tenant_id: tenantId } });
    if (!section) {
      throw new NotFoundException('Class section not found');
    }
    const { dates } = await this.schoolCalendarService.getWorkingDays({
      tenantId,
      from,
      to,
      classId: section.class_id,
    });

    const sessionRepo = manager.getRepository(AttendanceSession);
    const recordRepo = manager.getRepository(AttendanceRecord);
    for (const date of dates) {
      // INSERT .. ON CONFLICT DO NOTHING: a unique violation would abort the
      // caller's transaction, so a racing creator must not raise one.
      await manager
        .createQueryBuilder()
        .insert()
        .into(AttendanceSession)
        .values({
          tenant_id: tenantId,
          section_id: section.id,
          date,
          period_no: null,
          subject_id: null,
          source: AttendanceSource.SYSTEM,
          state: AttendanceSessionState.DRAFT,
        })
        .orIgnore()
        .execute();
      const session = await sessionRepo.findOneOrFail({
        where: { tenant_id: tenantId, section_id: section.id, date, period_no: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });

      const existing = await recordRepo.findOne({
        where: { session_id: session.id, student_id: studentId, tenant_id: tenantId },
      });
      let changed = false;
      if (!existing) {
        const created = await recordRepo.save(
          recordRepo.create({
            tenant_id: tenantId,
            session_id: session.id,
            student_id: studentId,
            date: session.date,
            status: AttendanceStatus.LEAVE,
            minutes_late: null,
            remarks: null,
            source: AttendanceSource.SYSTEM,
            recorded_by_user_id: actorUserId,
          }),
        );
        await this.auditService.record(
          {
            action: AuditAction.CREATE,
            entity_type: 'AttendanceRecord',
            entity_id: created.id,
            tenant_id: tenantId,
            performed_by_user_id: actorUserId,
            old_values: null,
            new_values: { status: AttendanceStatus.LEAVE, application_id: applicationId },
          },
          manager,
        );
        changed = true;
      } else if (existing.status === AttendanceStatus.ABSENT) {
        existing.status = AttendanceStatus.LEAVE;
        existing.source = AttendanceSource.SYSTEM;
        existing.recorded_by_user_id = actorUserId;
        await recordRepo.save(existing);
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'AttendanceRecord',
            entity_id: existing.id,
            tenant_id: tenantId,
            performed_by_user_id: actorUserId,
            old_values: { status: AttendanceStatus.ABSENT },
            new_values: { status: AttendanceStatus.LEAVE, application_id: applicationId },
          },
          manager,
        );
        changed = true;
      }
      if (changed) {
        await sessionRepo.increment({ id: session.id, tenant_id: tenantId }, 'version', 1);
      }
    }
    return { dates };
  }

  /**
   * A cancelled leave takes its future SYSTEM LEAVE marks back out (D31).
   * Past days and TEACHER-source marks stay. Caller's transaction.
   */
  async revertLeaveRange(
    manager: EntityManager,
    input: {
      tenantId: string;
      studentId: string;
      from: string;
      to: string;
      actorUserId: string;
      applicationId: string;
    },
  ): Promise<{ dates: string[] }> {
    const { tenantId, studentId, from, to, actorUserId, applicationId } = input;
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const today = localToday(settings.region?.timezone ?? 'UTC');
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const start = [from, tomorrow.toISOString().slice(0, 10)].sort()[1];
    if (start > to) {
      return { dates: [] };
    }
    const sessionRepo = manager.getRepository(AttendanceSession);
    const recordRepo = manager.getRepository(AttendanceRecord);
    const found = await recordRepo.find({
      where: {
        tenant_id: tenantId,
        student_id: studentId,
        date: Between(start, to),
        status: AttendanceStatus.LEAVE,
        source: AttendanceSource.SYSTEM,
      },
    });
    // Lock only this student's own whole-day sessions, in id order (no tenant-wide lock).
    const sessions = found.length
      ? await sessionRepo.find({
          where: {
            tenant_id: tenantId,
            period_no: IsNull(),
            id: In([...new Set(found.map((r) => r.session_id))]),
          },
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        })
      : [];
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const records = found.filter((r) => sessionById.has(r.session_id));
    const dates: string[] = [];
    for (const record of records) {
      const session = sessionById.get(record.session_id)!;
      await recordRepo.delete({ id: record.id, tenant_id: tenantId });
      await sessionRepo.increment({ id: session.id, tenant_id: tenantId }, 'version', 1);
      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'AttendanceRecord',
          entity_id: record.id,
          tenant_id: tenantId,
          performed_by_user_id: actorUserId,
          old_values: { status: AttendanceStatus.LEAVE },
          new_values: { application_id: applicationId },
        },
        manager,
      );
      dates.push(session.date);
    }
    return { dates: dates.sort() };
  }

  /**
   * The write of one section-day, run inside the caller's transaction: the
   * idempotency / future-date / non-working-day / window / finalized / version
   * / roster checks, then the session, records and audit rows. Shared by
   * `putRegister` (one day) and `putRegisterMatrix` (many days, one
   * transaction). `ctx.matrix` only changes how an entry without
   * `minutes_late` / `remarks` is treated: the matrix has no such fields, so it
   * keeps what is stored instead of wiping it.
   */
  private async writeRegisterDay(
    manager: EntityManager,
    ctx: {
      sectionId: string;
      tenantId: string;
      role: string;
      userId: string;
      ip: string | null;
      userAgent: string | null;
      matrix: boolean;
    },
    dto: PutRegisterDto,
  ): Promise<RegisterResponseDto> {
    const { sectionId, tenantId, role, userId, ip, userAgent } = ctx;
    const periodNo = dto.period_no ?? null;
    const studentIds = dto.entries.map((e) => e.student_id);
    const sessionRepo = manager.getRepository(AttendanceSession);
    const recordRepo = manager.getRepository(AttendanceRecord);

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);
    const timezone = settings.region?.timezone ?? 'UTC';
    const today = localToday(timezone);

    // Pessimistic lock: two concurrent PUTs for the same session must serialize,
    // not both read the same version and race to overwrite each other.
    let session = await sessionRepo.findOne({
      where: {
        tenant_id: tenantId,
        section_id: sectionId,
        date: dto.date,
        period_no: periodNo === null ? IsNull() : periodNo,
      },
      lock: { mode: 'pessimistic_write' },
    });

    // A NEW period register must be one the routine schedules that day; its
    // subject is snapshotted onto the session now (D21). An existing one is
    // never re-checked: a slot cancelled or a routine unpublished later must
    // not lock a teacher (or a queued offline replay) out of their own draft.
    let periodSubjectId: string | null = null;
    if (!session && periodNo !== null) {
      const period = (
        await this.attendanceAccessService.resolvePeriods(tenantId, sectionId, dto.date)
      ).find((p) => p.period_no === periodNo);
      if (!period) {
        throw new BadRequestException({
          message: 'That period is not scheduled for this section on this date',
          details: { code: 'ATTENDANCE_PERIOD_NOT_SCHEDULED' },
        });
      }
      periodSubjectId = period.subject_id;
    }

    // 2. Idempotency — checked before the version check, so a replay of an
    // already-accepted write reads as a 200, never as a conflict.
    // The matrix checks its own replay over all its days (`putRegisterMatrix`),
    // so a per-day early return here would silently skip a day.
    if (!ctx.matrix && session && session.last_client_request_id === dto.client_request_id) {
      return this.loadRegister(manager, {
        sectionId,
        date: dto.date,
        periodNo,
        tenantId,
        role,
      });
    }

    // 4. Future date.
    if (dto.date > today) {
      if (!policy.allowFutureDates) {
        throw new UnprocessableEntityException({
          message: 'Cannot mark attendance for a future date',
          details: { code: 'ATTENDANCE_FUTURE_DATE' },
        });
      }
      const hasNonLeaveEntry = dto.entries.some((e) => e.status !== AttendanceStatus.LEAVE);
      if (hasNonLeaveEntry) {
        throw new UnprocessableEntityException({
          message: 'Only LEAVE may be marked for a future date',
          details: { code: 'ATTENDANCE_FUTURE_NOT_LEAVE' },
        });
      }
    }

    // 5. Non-working day, per the shared calendar service.
    const hasCorrect = roleHasPermission(role, Permission.ATTENDANCE_CORRECT);
    // Class-scoped holidays block only that class (#1585), so look up the
    // section's class — tenant-filtered, the access gate already passed. Fails
    // closed: no row must never fall back to the tenant-wide check.
    const sectionRow = await manager
      .getRepository(ClassSection)
      .findOne({ where: { id: sectionId, tenant_id: tenantId } });
    if (!sectionRow) {
      throw new NotFoundException('Class section not found');
    }

    // 5a. The date must fall inside the section's academic year. Formatted in SQL: the pg
    // driver would hand back a timezone-shifted JS Date for a raw `date` column.
    const year = await manager
      .getRepository(AcademicYear)
      .createQueryBuilder('y')
      .innerJoin(Class, 'c', 'c.academic_year_id = y.id')
      .where('c.id = :classId', { classId: sectionRow.class_id })
      .andWhere('y.tenant_id = :tenantId', { tenantId })
      .select([
        "to_char(y.start_date, 'YYYY-MM-DD') AS start_date",
        "to_char(y.end_date, 'YYYY-MM-DD') AS end_date",
      ])
      .getRawOne<{ start_date: string; end_date: string }>();
    // `academic_year_id` is NOT NULL, so no row means the year is another tenant's.
    // Same text as the section miss above: one operation, one not-found answer.
    if (!year) {
      throw new NotFoundException('Class section not found');
    }
    if (dto.date < year.start_date || dto.date > year.end_date) {
      throw new UnprocessableEntityException({
        message: 'The date is outside the academic year',
        details: { code: 'ATTENDANCE_OUTSIDE_ACADEMIC_YEAR' },
      });
    }
    const nonWorkingDay = await this.schoolCalendarService.isNonWorkingDay({
      tenantId,
      date: dto.date,
      classId: sectionRow.class_id,
    });
    if (nonWorkingDay && !(dto.force_non_working_day === true && hasCorrect)) {
      throw new UnprocessableEntityException({
        message: 'Cannot mark attendance on a non-working day',
        details: { code: 'ATTENDANCE_NON_WORKING_DAY' },
      });
    }

    // 6. Correction window — only applies when correcting an *existing*
    // register; the first-ever submission for a day is never "outside
    // the window".
    const age = daysBetween(dto.date, today);
    if (session && age > policy.correctionWindowDays) {
      if (!hasCorrect) {
        throw new ForbiddenException({
          message: 'This register is outside the correction window',
          details: { code: 'ATTENDANCE_WINDOW_CLOSED' },
        });
      }
      if (isReasonTooShort(dto.reason)) {
        throw new UnprocessableEntityException({
          message: `A reason of at least ${MIN_REASON_LENGTH} characters is required to correct this register`,
          details: { code: 'ATTENDANCE_REASON_REQUIRED' },
        });
      }
    }

    // 6a. Finalized registers are locked against routine edits. Only a
    // caller holding ATTENDANCE_CORRECT may reopen one, and only with a
    // reason — otherwise a same-section caller could silently overwrite a
    // finalized register just by matching its base_version.
    if (session && session.state === AttendanceSessionState.FINALIZED) {
      if (!hasCorrect) {
        throw new ForbiddenException({
          message: 'This register has been finalized',
          details: { code: 'ATTENDANCE_FINALIZED' },
        });
      }
      if (isReasonTooShort(dto.reason)) {
        throw new UnprocessableEntityException({
          message: `A reason of at least ${MIN_REASON_LENGTH} characters is required to edit a finalized register`,
          details: { code: 'ATTENDANCE_REASON_REQUIRED' },
        });
      }
    }

    // 7. Version — a mismatch carries the full current register, which is
    // the payload [8.12.5]'s conflict dialog renders.
    const currentVersion = session?.version ?? 0;
    if (dto.base_version !== currentVersion) {
      const currentRegister = await this.loadRegister(manager, {
        sectionId,
        date: dto.date,
        periodNo,
        tenantId,
        role,
      });
      throw new ConflictException({
        message: 'This register has changed since you last loaded it',
        details: {
          code: 'ATTENDANCE_VERSION_CONFLICT',
          current_version: currentVersion,
          register: currentRegister,
        },
      });
    }

    // 8. Roster membership.
    const uniqueStudentIds = [...new Set(studentIds)];
    // Enrollment roster, not `Student.class_section_id`: a promoted student
    // still belongs to the old section's past registers (LIFE-08).
    const rosterIds = await this.registerRosterIds(
      manager,
      tenantId,
      sectionId,
      dto.date,
      session?.id ?? null,
    );
    const unknownStudentIds = uniqueStudentIds.filter((id) => !rosterIds.has(id));
    if (unknownStudentIds.length > 0) {
      throw new UnprocessableEntityException({
        message: 'One or more students are not enrolled in this section',
        details: { code: 'ATTENDANCE_UNKNOWN_STUDENTS', student_ids: unknownStudentIds },
      });
    }

    // --- Write ---------------------------------------------------------
    const isNewSession = !session;
    if (!session) {
      // `state`'s DB default only applies when the column is omitted from
      // the INSERT — set it explicitly so the in-memory entity (and this
      // request's audit/response payload) isn't left with `undefined`
      // rather than the row's real value.
      session = sessionRepo.create({
        tenant_id: tenantId,
        section_id: sectionId,
        date: dto.date,
        period_no: periodNo,
        // Snapshot, never updated afterwards (D21).
        subject_id: periodSubjectId,
        source: AttendanceSource.TEACHER,
        state: AttendanceSessionState.DRAFT,
      });
    }
    session.state = dto.finalize ? AttendanceSessionState.FINALIZED : session.state;
    session.marked_by_user_id = userId;
    session.marked_at = new Date();
    session.last_client_request_id = dto.client_request_id;
    if (dto.finalize) {
      session.finalized_at = new Date();
    }
    session = await sessionRepo.save(session);

    const existingRecords = await recordRepo.find({
      where: { session_id: session.id, tenant_id: tenantId },
    });
    const existingByStudentId = new Map(existingRecords.map((r) => [r.student_id, r]));

    const recordAudits: RecordAuditEntryInput[] = [];
    const counts = emptyCounts();

    for (const entry of dto.entries) {
      tallyStatus(counts, entry.status);
      const existing = existingByStudentId.get(entry.student_id);
      // The matrix sends only a status, so it keeps what is stored: a mark that
      // stays LATE keeps its minutes, anything else clears them; remarks stay.
      const keptMinutes = existing?.status === AttendanceStatus.LATE ? existing.minutes_late : null;
      const minutesLate =
        entry.status === AttendanceStatus.LATE
          ? (entry.minutes_late ?? (ctx.matrix ? keptMinutes : null))
          : null;
      const remarks = entry.remarks ?? (ctx.matrix ? (existing?.remarks ?? null) : null);

      if (!existing) {
        const created = await recordRepo.save(
          recordRepo.create({
            tenant_id: tenantId,
            session_id: session.id,
            student_id: entry.student_id,
            date: session.date,
            status: entry.status,
            minutes_late: minutesLate,
            remarks,
            source: AttendanceSource.TEACHER,
            recorded_by_user_id: userId,
          }),
        );
        recordAudits.push({
          action: AuditAction.CREATE,
          entity_type: 'AttendanceRecord',
          entity_id: created.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: ip,
          user_agent: userAgent,
          old_values: null,
          new_values: {
            status: created.status,
            minutes_late: created.minutes_late,
            remarks: created.remarks,
          },
        });
        continue;
      }

      const changed =
        existing.status !== entry.status ||
        existing.minutes_late !== minutesLate ||
        existing.remarks !== remarks;
      // Unchanged records get no audit row — a register submitted twice
      // with the same marks must not produce a wall of audit noise.
      if (!changed) continue;

      const oldValues = {
        status: existing.status,
        minutes_late: existing.minutes_late,
        remarks: existing.remarks,
      };
      existing.status = entry.status;
      existing.minutes_late = minutesLate;
      existing.remarks = remarks;
      existing.recorded_by_user_id = userId;
      await recordRepo.save(existing);

      recordAudits.push({
        action: AuditAction.UPDATE,
        entity_type: 'AttendanceRecord',
        entity_id: existing.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: ip,
        user_agent: userAgent,
        old_values: oldValues,
        new_values: {
          status: existing.status,
          minutes_late: existing.minutes_late,
          remarks: existing.remarks,
          reason: dto.reason ?? null,
        },
      });
    }

    await this.auditService.record(
      {
        action: isNewSession ? AuditAction.CREATE : AuditAction.UPDATE,
        entity_type: 'AttendanceSession',
        entity_id: session.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: ip,
        user_agent: userAgent,
        old_values: null,
        new_values: {
          date: session.date,
          period_no: session.period_no,
          state: session.state,
          version: session.version,
          counts,
        },
      },
      manager,
    );

    for (const entry of recordAudits) {
      await this.auditService.record(entry, manager);
    }

    return this.loadRegister(manager, { sectionId, date: dto.date, periodNo, tenantId, role });
  }

  // ---------------------------------------------------------------------
  // PUT /attendance/sections/:sectionId/register-matrix
  // ---------------------------------------------------------------------

  /**
   * Many days of one section's whole-day register in ONE transaction — every
   * day is checked before any is written, and any failure rejects them all.
   * Each day is then written by the same `writeRegisterDay` as `putRegister`.
   * Never touches period registers, never queues a guardian notification.
   * `ponytail:` per-day writes, all in one transaction: one save + one audit
   * insert per changed record, plus `loadRegister` (~8 queries) per day — a
   * 26-day month for 60 students is ~3.5k queries. Batch the inserts and
   * reads if a month save is ever measurably slow.
   */
  async putRegisterMatrix(params: {
    sectionId: string;
    tenantId: string;
    role: string;
    userId: string;
    dto: PutRegisterMatrixDto;
    ip: string | null;
    userAgent: string | null;
  }): Promise<MatrixSaveResponseDto> {
    const { sectionId, tenantId, role, userId, dto, ip, userAgent } = params;
    const section = await this.attendanceAccessService.assertCanAccessSection(
      role,
      userId,
      sectionId,
      tenantId,
    );

    const dates = dto.days.map((d) => d.date);
    if (new Set(dates).size !== dates.length) {
      throw new BadRequestException('days contains a duplicate date');
    }
    if (new Set(dates.map((d) => d.slice(0, 7))).size !== 1) {
      throw new BadRequestException('All days must be in the same calendar month');
    }
    for (const day of dto.days) {
      const ids = day.entries.map((e) => e.student_id);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException(`entries for ${day.date} contain a duplicate student_id`);
      }
    }

    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const settings = await this.schoolsService.getResolvedSettings(tenantId);
        const policy = resolveAttendancePolicy(settings);
        const today = localToday(settings.region?.timezone ?? 'UTC');
        const hasCorrect = roleHasPermission(role, Permission.ATTENDANCE_CORRECT);

        // Lock the existing day sessions so two matrix saves serialize.
        const sessions = await manager.getRepository(AttendanceSession).find({
          where: {
            tenant_id: tenantId,
            section_id: sectionId,
            date: In(dates),
            period_no: IsNull(),
          },
          lock: { mode: 'pessimistic_write' },
        });
        const sessionByDate = new Map(sessions.map((s) => [s.date, s]));
        const sortedDates = [...dates].sort();

        // Replay: every day already carries this request id -> same 200, no writes.
        // Only some days carrying it means either the id was reused for a
        // different request, or someone else saved some of these days since
        // (a legit retry): reject it rather than skip those days.
        const replayed = sortedDates.filter(
          (d) => sessionByDate.get(d)?.last_client_request_id === dto.client_request_id,
        );
        if (replayed.length === sortedDates.length) {
          return {
            saved_dates: sortedDates,
            versions: Object.fromEntries(
              sortedDates.map((d) => [d, sessionByDate.get(d)!.version]),
            ),
          };
        }
        if (replayed.length > 0) {
          throw new ConflictException({
            message:
              'This client_request_id was already used, or some of these days changed since. ' +
              'Reload the month and try again',
            details: { code: 'ATTENDANCE_MATRIX_REQUEST_REUSED', dates: replayed },
          });
        }

        // 1. Locked dates: the future, or not a school day for this class.
        const { dates: workingDates } = await this.schoolCalendarService.getWorkingDays({
          tenantId,
          from: sortedDates[0],
          to: sortedDates[sortedDates.length - 1],
          classId: section.class_id,
        });
        const working = new Set(workingDates);
        const locked = sortedDates.filter((d) => d > today || !working.has(d));
        if (locked.length > 0) {
          throw new UnprocessableEntityException({
            message: 'Some days cannot be marked (future date or non-working day)',
            details: { code: 'ATTENDANCE_MATRIX_LOCKED_DATE', dates: locked },
          });
        }

        // 2. Stale days: the client saw a different version (null = "no register").
        const stale = dto.days
          .filter((d) => d.base_version !== (sessionByDate.get(d.date)?.version ?? null))
          .map((d) => d.date)
          .sort();
        if (stale.length > 0) {
          throw new ConflictException({
            message: 'Some days changed since you opened the month',
            details: { code: 'ATTENDANCE_MATRIX_CONFLICT', dates: stale },
          });
        }

        // 2a. A new register needs at least one mark: a back-filled past day is
        // born FINALIZED (D22), so an empty one could only be fixed with
        // ATTENDANCE_CORRECT.
        const empty = dto.days
          .filter((d) => !sessionByDate.has(d.date) && d.entries.length === 0)
          .map((d) => d.date)
          .sort();
        if (empty.length > 0) {
          throw new UnprocessableEntityException({
            message: 'A day with no register yet needs at least one mark',
            details: { code: 'ATTENDANCE_MATRIX_EMPTY_DAY', dates: empty },
          });
        }

        // 3. Closed days (outside the window, or FINALIZED) need ATTENDANCE_CORRECT + a reason.
        const closed = sortedDates.filter((d) => {
          const s = sessionByDate.get(d);
          return (
            !!s &&
            (daysBetween(d, today) > policy.correctionWindowDays ||
              s.state === AttendanceSessionState.FINALIZED)
          );
        });
        if (closed.length > 0) {
          if (!hasCorrect) {
            throw new ForbiddenException({
              message: 'Some of these registers are outside the correction window or finalized',
              details: { code: 'ATTENDANCE_WINDOW_CLOSED', dates: closed },
            });
          }
          if (isReasonTooShort(dto.reason)) {
            throw new UnprocessableEntityException({
              message: `A reason of at least ${MIN_REASON_LENGTH} characters is required to correct these registers`,
              details: { code: 'ATTENDANCE_REASON_REQUIRED', dates: closed },
            });
          }
        }

        // Write every day with the same manager — one transaction.
        const ctx = {
          sectionId,
          tenantId,
          role,
          userId,
          ip,
          userAgent,
          matrix: true,
        };
        const versions: Record<string, number> = {};
        for (const day of [...dto.days].sort((a, b) => a.date.localeCompare(b.date))) {
          const existing = sessionByDate.get(day.date);
          const register = await this.writeRegisterDay(manager, ctx, {
            date: day.date,
            period_no: null,
            base_version: existing?.version ?? 0,
            client_request_id: dto.client_request_id,
            // D22: a back-filled past day is born FINALIZED, today stays DRAFT;
            // an existing register keeps its state.
            finalize: !existing && day.date < today,
            reason: dto.reason,
            entries: day.entries,
          });
          versions[day.date] = register.session.version;
        }
        return { saved_dates: sortedDates, versions };
      });
      // No attention recheck: the matrix finalizes only past days, and
      // attendance.not_taken looks at today alone.
      return saved;
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException({
          message: 'A register was just created by another request',
          details: { code: 'ATTENDANCE_SESSION_RACE' },
        });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // POST /attendance/sections/:sectionId/register/finalize
  // ---------------------------------------------------------------------

  async finalize(params: {
    sectionId: string;
    tenantId: string;
    role: string;
    userId: string;
    date: string;
    periodNo: number | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<RegisterResponseDto> {
    const { sectionId, tenantId, role, userId, date, periodNo, ip, userAgent } = params;
    await this.assertRegisterAccess(role, userId, sectionId, tenantId, date, periodNo);

    const result = await this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(AttendanceSession);
      const session = await sessionRepo.findOne({
        where: {
          tenant_id: tenantId,
          section_id: sectionId,
          date,
          period_no: periodNo === null ? IsNull() : periodNo,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) {
        throw new NotFoundException('No register exists for this section and date yet');
      }

      // Idempotent: finalizing an already-finalized session is a no-op, so
      // [9.8]'s cut-off sweep can call this without checking state first.
      if (session.state !== AttendanceSessionState.FINALIZED) {
        const wasState = session.state;
        session.state = AttendanceSessionState.FINALIZED;
        session.finalized_at = new Date();
        session.marked_by_user_id = userId;
        await sessionRepo.save(session);

        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'AttendanceSession',
            entity_id: session.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: ip,
            user_agent: userAgent,
            old_values: { state: wasState },
            new_values: { state: session.state, finalized_at: session.finalized_at },
          },
          manager,
        );
      }

      return this.loadRegister(manager, { sectionId, date, periodNo, tenantId, role });
    });
    emitRecheck(attentionEvents, {
      tenantId,
      ruleKey: 'attendance.not_taken',
      actorUserId: userId,
    });
    return result;
  }

  // ---------------------------------------------------------------------
  // PATCH /attendance/records/:recordId
  // ---------------------------------------------------------------------

  async correctRecord(params: {
    recordId: string;
    tenantId: string;
    role: string;
    userId: string;
    dto: CorrectRecordDto;
    ip: string | null;
    userAgent: string | null;
  }): Promise<RegisterResponseDto> {
    const { recordId, tenantId, role, userId, dto, ip, userAgent } = params;

    // `reason` is always required on this route — it only ever edits
    // something that already exists.
    if (isReasonTooShort(dto.reason)) {
      throw new UnprocessableEntityException({
        message: `A reason of at least ${MIN_REASON_LENGTH} characters is required`,
        details: { code: 'ATTENDANCE_REASON_REQUIRED' },
      });
    }

    const corrected: { sessionId: string; studentId: string; oldStatus: AttendanceStatus }[] = [];
    const result = await this.dataSource.transaction(async (manager) => {
      const recordRepo = manager.getRepository(AttendanceRecord);
      const sessionRepo = manager.getRepository(AttendanceSession);

      const record = await recordRepo.findOne({ where: { id: recordId, tenant_id: tenantId } });
      if (!record) {
        throw new NotFoundException('Attendance record not found');
      }
      const session = await sessionRepo.findOne({
        where: { id: record.session_id, tenant_id: tenantId },
      });
      if (!session) {
        throw new NotFoundException('Attendance session not found');
      }

      // D13: a teacher outside the section gets the same 404 as a missing record.
      await this.assertRegisterAccess(
        role,
        userId,
        session.section_id,
        tenantId,
        session.date,
        session.period_no,
      ).catch((e: unknown) => {
        throw e instanceof NotFoundException
          ? new NotFoundException('Attendance record not found')
          : e;
      });

      const settings = await this.schoolsService.getResolvedSettings(tenantId);
      const policy = resolveAttendancePolicy(settings);
      const timezone = settings.region?.timezone ?? 'UTC';
      const today = localToday(timezone);
      const age = daysBetween(session.date, today);
      const hasCorrect = roleHasPermission(role, Permission.ATTENDANCE_CORRECT);

      if (age > policy.correctionWindowDays && !hasCorrect) {
        throw new ForbiddenException({
          message: 'This record is outside the correction window',
          details: { code: 'ATTENDANCE_WINDOW_CLOSED' },
        });
      }
      // Same rules as writeRegisterDay: finalizing locks the register for
      // anyone who cannot correct, and a future day only ever holds LEAVE.
      if (session.state === AttendanceSessionState.FINALIZED && !hasCorrect) {
        throw new ForbiddenException({
          message: 'This register has been finalized',
          details: { code: 'ATTENDANCE_FINALIZED' },
        });
      }
      if (session.date > today && dto.status !== AttendanceStatus.LEAVE) {
        throw new UnprocessableEntityException({
          message: 'Only LEAVE may be marked for a future date',
          details: { code: 'ATTENDANCE_FUTURE_NOT_LEAVE' },
        });
      }

      const oldValues = {
        status: record.status,
        minutes_late: record.minutes_late,
        remarks: record.remarks,
      };
      corrected.push({
        sessionId: session.id,
        studentId: record.student_id,
        oldStatus: record.status,
      });
      record.status = dto.status;
      record.minutes_late =
        dto.status === AttendanceStatus.LATE ? (dto.minutes_late ?? null) : null;
      record.remarks = dto.remarks ?? null;
      record.recorded_by_user_id = userId;
      await recordRepo.save(record);

      // Bumps the parent session's version explicitly (rather than relying
      // on TypeORM's diff-based UPDATE, which may omit the column entirely
      // if no other tracked field changed) so a marking screen holding a
      // stale version finds out on its next read.
      await sessionRepo.increment({ id: session.id }, 'version', 1);
      session.version += 1;

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'AttendanceRecord',
          entity_id: record.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: ip,
          user_agent: userAgent,
          old_values: oldValues,
          new_values: {
            status: record.status,
            minutes_late: record.minutes_late,
            remarks: record.remarks,
            reason: dto.reason,
          },
        },
        manager,
      );

      return this.loadRegister(manager, {
        sectionId: session.section_id,
        date: session.date,
        periodNo: session.period_no,
        tenantId,
        role,
      });
    });

    // After commit: a failed send must never undo the correction.
    const [c] = corrected;
    if (c && c.oldStatus !== dto.status) {
      try {
        await this.absenceNoticeService.notifyCorrection({
          tenantId,
          userId,
          newStatus: dto.status,
          ...c,
        });
      } catch (err) {
        this.logger.warn(`Absence correction notice failed for record ${recordId}: ${String(err)}`);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------
  // GET /attendance/records/:recordId/history
  // ---------------------------------------------------------------------

  /**
   * Gated on section access, not `AUDIT_LOG_READ` — a teacher legitimately
   * needs to see who changed a mark in their own register, and must not be
   * handed the tenant-wide audit log to get it.
   */
  async getRecordHistory(params: {
    recordId: string;
    tenantId: string;
    role: string;
    userId: string;
    query: QueryAuditLogDto;
  }) {
    const { recordId, tenantId, role, userId, query } = params;

    const record = await this.recordRepo.findOne({ where: { id: recordId, tenant_id: tenantId } });
    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }
    const session = await this.sessionRepo.findOne({
      where: { id: record.session_id, tenant_id: tenantId },
    });
    if (!session) {
      throw new NotFoundException('Attendance session not found');
    }

    // Same gate as the register itself: the period switch (D18) and that
    // period's substitute apply to a period record's history too.
    await this.assertRegisterAccess(
      role,
      userId,
      session.section_id,
      tenantId,
      session.date,
      session.period_no,
      { includeCoordinated: true }, // [83.3.1] D4 read
    );

    const result = await this.auditService.findByEntity(
      'AttendanceRecord',
      recordId,
      query,
      tenantId,
    );
    return { ...result, data: result.data.map(AuditLogResponseDto.fromEntity) };
  }

  // ---------------------------------------------------------------------
  // GET /attendance/sections/:sectionId/periods
  // ---------------------------------------------------------------------

  async listPeriods(params: {
    sectionId: string;
    date: string;
    tenantId: string;
    role: string;
    userId: string;
  }): Promise<PeriodDto[]> {
    const { sectionId, date, tenantId, role, userId } = params;
    if (!(await this.periodAttendanceEnabled(tenantId))) return [];
    const periods = await this.attendanceAccessService.listAccessiblePeriods(
      role,
      userId,
      sectionId,
      tenantId,
      date,
      { includeCoordinated: true }, // [83.3.1] D4 read
    );
    if (periods.length === 0) return [];

    // One query each for subjects, teachers and sessions — not per period.
    const subjectIds = [...new Set(periods.map((p) => p.subject_id))];
    const teacherIds = [...new Set(periods.flatMap((p) => p.teacher_ids))];
    const [subjects, teachers, sessions] = await Promise.all([
      this.subjectRepo.find({ where: { id: In(subjectIds), tenant_id: tenantId } }),
      teacherIds.length
        ? this.teacherRepo.find({
            where: { id: In(teacherIds), tenant_id: tenantId },
            relations: ['user'],
          })
        : Promise.resolve([] as Teacher[]),
      this.sessionRepo.find({
        where: {
          tenant_id: tenantId,
          section_id: sectionId,
          date,
          period_no: In(periods.map((p) => p.period_no)),
        },
      }),
    ]);
    const subjectName = new Map(subjects.map((s) => [s.id, s.name_en]));
    const teacherName = new Map(teachers.map((t) => [t.id, t.user?.full_name ?? '']));
    const stateByPeriod = new Map(sessions.map((s) => [s.period_no, s.state]));

    return periods.map((p) => ({
      period_no: p.period_no,
      name: p.name,
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      subject_id: p.subject_id,
      subject_name: subjectName.get(p.subject_id) ?? null,
      teacher_names: p.teacher_ids.map((id) => teacherName.get(id)).filter((n): n is string => !!n),
      state: stateByPeriod.get(p.period_no) ?? null,
    }));
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async periodAttendanceEnabled(tenantId: string): Promise<boolean> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    return resolveAttendancePolicy(settings).periodAttendance?.enabled === true;
  }

  /**
   * The one access gate for a register route. A period register is refused
   * outright when the tenant's period switch is off (D18), then checked with
   * the period gate (section access, or that date's substitute for that
   * period); the day register keeps the plain section gate.
   */
  private async assertRegisterAccess(
    role: string,
    userId: string,
    sectionId: string,
    tenantId: string,
    date: string,
    periodNo: number | null,
    /** [83.3.1] D4 — true only for reads (register view, record history). */
    opts: { includeCoordinated?: boolean } = {},
  ): Promise<void> {
    if (periodNo === null) {
      await this.attendanceAccessService.assertCanAccessSection(
        role,
        userId,
        sectionId,
        tenantId,
        opts,
      );
      return;
    }
    if (!(await this.periodAttendanceEnabled(tenantId))) {
      throw new ForbiddenException({
        message: 'Period attendance is not enabled for this school',
        details: { code: 'ATTENDANCE_PERIOD_DISABLED' },
      });
    }
    await this.attendanceAccessService.assertCanAccessPeriod(
      role,
      userId,
      sectionId,
      tenantId,
      date,
      periodNo,
      opts,
    );
  }

  /** See the class docstring for why this is derived rather than a column. */
  private async getCorrectionCounts(
    manager: EntityManager,
    tenantId: string,
    recordIds: string[],
  ): Promise<Map<string, number>> {
    if (recordIds.length === 0) return new Map();
    const rows: Array<{ entity_id: string; count: string }> = await manager.query(
      `SELECT entity_id, COUNT(*) AS count FROM audit_logs
       WHERE tenant_id = $1 AND entity_type = 'AttendanceRecord' AND action = 'UPDATE'
         AND entity_id = ANY($2::uuid[])
       GROUP BY entity_id`,
      [tenantId, recordIds],
    );
    return new Map(rows.map((r) => [r.entity_id, Number(r.count)]));
  }

  /** Register rows for `date`: the roster on that date, plus anyone already marked in this
   *  session (a back-dated leave never hides a saved mark). GET and PUT share this rule. */
  private async registerRosterIds(
    manager: EntityManager,
    tenantId: string,
    sectionId: string,
    date: string,
    sessionId: string | null,
  ): Promise<Set<string>> {
    const ids = new Set(
      await sectionRosterStudentIds(manager, tenantId, sectionId, { onRollOn: date }),
    );
    if (sessionId) {
      const marked = await manager.getRepository(AttendanceRecord).find({
        where: { session_id: sessionId, tenant_id: tenantId },
        select: { student_id: true },
      });
      for (const r of marked) ids.add(r.student_id);
    }
    return ids;
  }

  /**
   * The one place that assembles the `RegisterResponseDto` shape, shared by
   * `getRegister`, every `putRegister`/`finalize`/`correctRecord` return
   * (including the idempotent-replay and 409-conflict payloads), so the
   * client can always replace its state wholesale from any of these calls.
   *
   * Takes an `EntityManager` rather than using the injected repositories
   * directly so it reads consistently whether called from a plain GET (the
   * `DataSource`'s own manager) or from inside a write's transaction (that
   * transaction's manager, seeing its own uncommitted writes).
   *
   * Does not itself check access — every caller has already called
   * `AttendanceAccessService.assertCanAccessSection` (or, for
   * `putRegister`'s conflict path, is re-deriving state for a call that
   * already passed that check).
   */
  private async loadRegister(
    manager: EntityManager,
    params: {
      sectionId: string;
      date: string;
      periodNo: number | null;
      tenantId: string;
      role: string;
    },
  ): Promise<RegisterResponseDto> {
    const { sectionId, date, periodNo, tenantId, role } = params;

    const section = await manager.getRepository(ClassSection).findOne({
      where: { id: sectionId, tenant_id: tenantId },
      relations: ['class'],
    });
    if (!section) {
      throw new ForbiddenException('You do not have access to this section');
    }

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);
    const timezone = settings.region?.timezone ?? 'UTC';

    const session = await manager.getRepository(AttendanceSession).findOne({
      where: {
        tenant_id: tenantId,
        section_id: sectionId,
        date,
        period_no: periodNo === null ? IsNull() : periodNo,
      },
    });

    // roll_number is an int column, so this ORDER BY is already
    // numeric — no varchar-sort trap (1, 10, 2, ...) to work around.
    const rosterIds = [
      ...(await this.registerRosterIds(manager, tenantId, sectionId, date, session?.id ?? null)),
    ];
    const students =
      rosterIds.length === 0
        ? []
        : await manager.getRepository(Student).find({
            where: { id: In(rosterIds), tenant_id: tenantId },
            order: { roll_number: 'ASC' },
          });

    const records = session
      ? await manager
          .getRepository(AttendanceRecord)
          .find({ where: { session_id: session.id, tenant_id: tenantId } })
      : [];
    const recordsByStudentId = new Map(records.map((r) => [r.student_id, r]));
    const correctionCounts = await this.getCorrectionCounts(
      manager,
      tenantId,
      records.map((r) => r.id),
    );

    // D8: a period register not yet saved suggests ABSENT/LEAVE from that day's
    // whole-day register. Read-only — nothing is written until the PUT.
    const suggestedByStudentId = new Map<string, AttendanceStatus>();
    if (periodNo !== null && !session) {
      const daySession = await manager.getRepository(AttendanceSession).findOne({
        where: { tenant_id: tenantId, section_id: sectionId, date, period_no: IsNull() },
      });
      if (daySession) {
        const dayRecords = await manager.getRepository(AttendanceRecord).find({
          where: { session_id: daySession.id, tenant_id: tenantId },
        });
        for (const r of dayRecords) {
          if (r.status === AttendanceStatus.ABSENT || r.status === AttendanceStatus.LEAVE) {
            suggestedByStudentId.set(r.student_id, r.status);
          }
        }
      }
    }

    const hasCorrect = roleHasPermission(role, Permission.ATTENDANCE_CORRECT);
    const nonWorkingDay = await this.schoolCalendarService.isNonWorkingDay({
      tenantId,
      date,
      classId: section.class_id,
    });
    const today = localToday(timezone);
    const reasonRequired = !!session && daysBetween(date, today) > policy.correctionWindowDays;
    const finalized = session?.state === AttendanceSessionState.FINALIZED;
    const editable =
      (!nonWorkingDay || hasCorrect) &&
      (!reasonRequired || hasCorrect) &&
      (!finalized || hasCorrect);

    return {
      section: {
        id: section.id,
        section_name: section.section_name,
        class_name: (section as ClassSection & { class?: { name: string } }).class?.name ?? '',
      },
      session: session
        ? {
            id: session.id,
            date: session.date,
            period_no: session.period_no,
            state: session.state,
            version: session.version,
            marked_by_user_id: session.marked_by_user_id,
            marked_at: session.marked_at ? session.marked_at.toISOString() : null,
            finalized_at: session.finalized_at ? session.finalized_at.toISOString() : null,
          }
        : {
            id: null,
            date,
            period_no: periodNo,
            state: AttendanceSessionState.DRAFT,
            version: 0,
            marked_by_user_id: null,
            marked_at: null,
            finalized_at: null,
          },
      editable,
      reason_required: reasonRequired,
      non_working_day: nonWorkingDay,
      policy: {
        late_after: policyForShift(policy, section.class?.shift_id, date).lateAfter,
        correction_window_days: policy.correctionWindowDays,
        allow_future_dates: policy.allowFutureDates,
      },
      students: students.map((s) => {
        const record = recordsByStudentId.get(s.id);
        return {
          student_id: s.id,
          roll_number: s.roll_number,
          full_name: s.full_name,
          record_id: record?.id ?? null,
          status: record?.status ?? null,
          minutes_late: record?.minutes_late ?? null,
          remarks: record?.remarks ?? null,
          source: record?.source ?? null,
          correction_count: record ? (correctionCounts.get(record.id) ?? 0) : 0,
          suggested_status: suggestedByStudentId.get(s.id) ?? null,
        };
      }),
    };
  }
}

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  AttendanceEventDirection,
  AttendanceSource,
  AttendanceSubjectType,
  AuditAction,
  EnrollmentStatus,
} from '@biddaloy/shared';
import { AttendanceDevice } from '../entities/attendance-device.entity';
import { AttendanceDeviceEvent } from '../entities/attendance-device-event.entity';
import { AttendanceSession } from '../entities/attendance-session.entity';
import { AttendanceRecord } from '../entities/attendance-record.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { StaffAttendanceSession } from '../../staff-attendance/entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from '../../staff-attendance/entities/staff-attendance-record.entity';
import { StaffProfile } from '../../staff-profiles/entities/staff-profile.entity';
import { ArrivalNoticeService, ArrivalStudent } from '../arrival-notice.service';
import { SchoolsService } from '../../schools/schools.service';
import { AuditService } from '../../audit/audit.service';
import {
  classifyCheckIn,
  policyForShift,
  daysBetween,
  localDate,
  localToday,
  resolveAttendancePolicy,
} from '../attendance-policy.util';
import {
  DeviceEventBatchResponseDto,
  DeviceEventDto,
  DeviceEventResultDto,
  DeviceHeartbeatResponseDto,
  DeviceRosterEntryDto,
} from '../dto/device.dto';

const CLOCK_WINDOW_DAYS = 2;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505';
}

/**
 * Turns a batch of raw device scans into attendance marks. Each event is
 * handled in its own transaction — a batch is not atomic, since the device
 * has no way to work out which single event we objected to and would just
 * retry the whole batch forever if one bad event failed the rest.
 */
@Injectable()
export class DeviceEventsService {
  private readonly logger = new Logger(DeviceEventsService.name);

  constructor(
    @InjectRepository(AttendanceDevice)
    private readonly deviceRepo: Repository<AttendanceDevice>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
    private readonly auditService: AuditService,
    private readonly arrivalNoticeService: ArrivalNoticeService,
  ) {}

  // ---------------------------------------------------------------------
  // GET /attendance/devices/me/roster
  // ---------------------------------------------------------------------

  /**
   * 403 unless `device.roster_access` is true. When the device is bound to
   * a section, that is the only section it may read. Response is exactly
   * these six fields — built by explicitly listing them, never by
   * returning the entity and deleting keys, which would leak whatever
   * field gets added to `Student` next year.
   */
  async getRoster(device: AttendanceDevice, sectionId?: string): Promise<DeviceRosterEntryDto[]> {
    if (!device.roster_access) {
      throw new ForbiddenException('This device is not permitted to read the roster');
    }

    const effectiveSectionId = device.section_id ?? sectionId;
    if (device.section_id && sectionId && sectionId !== device.section_id) {
      throw new ForbiddenException('This device may only read its own bound section');
    }
    if (!effectiveSectionId) {
      throw new ForbiddenException('section_id is required for a device with no bound section');
    }

    const students = await this.studentRepo.find({
      where: {
        tenant_id: device.tenant_id,
        class_section_id: effectiveSectionId,
        enrollment_status: EnrollmentStatus.ACTIVE,
        deleted_at: IsNull(),
      },
      order: { roll_number: 'ASC' },
    });

    return students.map((s) => ({
      student_id: s.id,
      registration_number: s.registration_number,
      card_no: s.card_no ?? null,
      roll_number: s.roll_number,
      full_name: s.full_name,
      section_id: effectiveSectionId,
    }));
  }

  // ---------------------------------------------------------------------
  // POST /attendance/devices/me/heartbeat
  // ---------------------------------------------------------------------

  async heartbeat(device: AttendanceDevice): Promise<DeviceHeartbeatResponseDto> {
    const settings = await this.schoolsService.getResolvedSettings(device.tenant_id);
    const timezone = settings.region?.timezone ?? 'UTC';
    const now = new Date();
    // Today's tenant-wide cut-offs, a covering special timing applied (#2290).
    const policy = policyForShift(
      resolveAttendancePolicy(settings),
      null,
      localDate(now, timezone),
    );

    await this.deviceRepo.update(device.id, { last_seen_at: now });

    return {
      server_time: now.toISOString(),
      tenant_timezone: timezone,
      policy: { late_after: policy.lateAfter, absent_after: policy.absentAfter },
    };
  }

  async ingest(
    device: AttendanceDevice,
    events: DeviceEventDto[],
  ): Promise<DeviceEventBatchResponseDto> {
    const results: DeviceEventResultDto[] = [];
    let accepted = 0;
    let duplicate = 0;
    let failed = 0;
    // [84.3.1] first check-ins of the batch, by local date; one notice call per date after the loop.
    const firstCheckInsByDate = new Map<string, ArrivalStudent[]>();

    for (const event of events) {
      let result: DeviceEventResultDto;
      try {
        result = await this.ingestOne(device, event, firstCheckInsByDate);
      } catch (err) {
        this.logger.error(
          `Device event ingest failed for device ${device.id}, event ${event.device_event_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        result = {
          device_event_id: event.device_event_id,
          outcome: 'rejected',
          reason: 'internal_error',
        };
      }

      results.push(result);
      if (result.outcome === 'accepted') accepted += 1;
      else if (result.outcome === 'duplicate') duplicate += 1;
      else failed += 1;
    }

    await this.sendBatchArrivalNotices(device, firstCheckInsByDate);

    // Once per batch, not per event — see this service's docstring.
    await this.deviceRepo.update(device.id, { last_seen_at: new Date() });

    // One audit row per batch (`attendance_device_events` is already the
    // per-event trail) — a turnstile would otherwise write thousands of
    // audit rows a day.
    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'AttendanceSession',
      entity_id: null,
      tenant_id: device.tenant_id,
      performed_by_user_id: null,
      old_values: null,
      new_values: {
        source: AttendanceSource.DEVICE,
        device_id: device.id,
        accepted,
        duplicate,
        failed,
      },
    });

    return { results, accepted, duplicate, failed };
  }

  private async ingestOne(
    device: AttendanceDevice,
    event: DeviceEventDto,
    firstCheckInsByDate: Map<string, ArrivalStudent[]>,
  ): Promise<DeviceEventResultDto> {
    const settings = await this.schoolsService.getResolvedSettings(device.tenant_id);
    const policy = resolveAttendancePolicy(settings);
    const timezone = settings.region?.timezone ?? 'UTC';
    const occurredAt = new Date(event.occurred_at);
    const eventDate = localDate(occurredAt, timezone);

    // [84.3.1] filled by handleCheckIn when check_in_at goes null -> value
    const firstCheckIns: ArrivalStudent[] = [];
    const result = await this.dataSource.transaction(async (manager) => {
      const eventRepo = manager.getRepository(AttendanceDeviceEvent);

      // 1. Idempotency: the unique index on (device_id, device_event_id)
      // is the guarantee. Catching the violation rather than pre-checking
      // with a SELECT avoids a race between two concurrent batches that
      // would otherwise let both through.
      let eventRow: AttendanceDeviceEvent;
      try {
        eventRow = await eventRepo.save(
          eventRepo.create({
            tenant_id: device.tenant_id,
            device_id: device.id,
            device_event_id: event.device_event_id,
            external_ref: event.external_ref ?? null,
            // `student_id` is a real FK to `students` — a STAFF event's
            // `student_id` field is a `staff_profiles.id`, never a real
            // student, so it must never land in this column (see
            // `ingestStaffEvent`'s docstring below for where it does go:
            // nowhere but `raw`).
            student_id:
              event.subject_type === AttendanceSubjectType.STAFF
                ? null
                : (event.student_id ?? null),
            occurred_at: occurredAt,
            direction: event.direction,
            // Placeholder — overwritten below once the real outcome is
            // known. `outcome` is NOT NULL, so the initial insert (which
            // is what the unique index actually guards) needs some value.
            outcome: 'accepted',
            raw: event as unknown as Record<string, unknown>,
          }),
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          return { device_event_id: event.device_event_id, outcome: 'duplicate' };
        }
        throw err;
      }

      // 2. Resolve the subject. Exactly one of student_id/external_ref must
      // be given — the DTO documents this as an either/or, but nothing
      // enforces it there, so a malformed event with both set must not
      // silently resolve by student_id and ignore external_ref. This rule
      // is shared by both subject types — only what the id is checked
      // against differs.
      const hasStudentId = event.student_id !== undefined && event.student_id !== null;
      const hasExternalRef = event.external_ref !== undefined && event.external_ref !== null;

      if (hasStudentId === hasExternalRef) {
        const outcome =
          event.subject_type === AttendanceSubjectType.STAFF ? 'unknown_staff' : 'unknown_student';
        await eventRepo.update(eventRow.id, { outcome });
        return { device_event_id: event.device_event_id, outcome };
      }

      if (event.subject_type === AttendanceSubjectType.STAFF) {
        return this.ingestStaffEvent(
          manager,
          eventRepo,
          eventRow,
          device,
          event,
          eventDate,
          occurredAt,
          policy,
          timezone,
        );
      }

      const student = await this.resolveStudent(manager, device.tenant_id, event);
      if (!student) {
        await eventRepo.update(eventRow.id, { outcome: 'unknown_student' });
        return { device_event_id: event.device_event_id, outcome: 'unknown_student' };
      }

      // 3. Clock-skew window. A scanner whose clock is a year off must not
      // be able to rewrite history.
      if (this.isOutOfWindow(eventDate, timezone)) {
        await eventRepo.update(eventRow.id, { outcome: 'out_of_window', student_id: student.id });
        return { device_event_id: event.device_event_id, outcome: 'out_of_window' };
      }

      if (device.section_id && student.class_section_id !== device.section_id) {
        await eventRepo.update(eventRow.id, { outcome: 'rejected', student_id: student.id });
        return {
          device_event_id: event.device_event_id,
          outcome: 'rejected',
          reason: 'section_mismatch',
        };
      }

      // ponytail: current standing, not the scan date; an offline scan from before a leave,
      // uploaded after it, is rejected (teacher marks it by hand). Use
      // sectionRosterStudentIds(..., { onRollOn: eventDate }) if that bites.
      if (student.enrollment_status !== EnrollmentStatus.ACTIVE) {
        await eventRepo.update(eventRow.id, { outcome: 'rejected', student_id: student.id });
        return {
          device_event_id: event.device_event_id,
          outcome: 'rejected',
          reason: 'not_on_roll',
        };
      }

      if (event.direction === AttendanceEventDirection.OUT) {
        return this.handleCheckOut(
          manager,
          eventRepo,
          eventRow,
          device,
          student,
          eventDate,
          occurredAt,
        );
      }
      return this.handleCheckIn(
        manager,
        eventRepo,
        eventRow,
        device,
        student,
        eventDate,
        occurredAt,
        policy,
        timezone,
        firstCheckIns,
      );
    });
    if (firstCheckIns.length > 0) {
      firstCheckInsByDate.set(eventDate, [
        ...(firstCheckInsByDate.get(eventDate) ?? []),
        ...firstCheckIns,
      ]);
    }
    return result;
  }

  /** After commit, fire-and-forget (D11, D26): the device answer never waits on or fails with it. */
  private async sendBatchArrivalNotices(
    device: AttendanceDevice,
    byDate: Map<string, ArrivalStudent[]>,
  ): Promise<void> {
    if (byDate.size === 0) return;
    const settings = await this.schoolsService
      .getResolvedSettings(device.tenant_id)
      .catch(() => null);
    if (settings?.attendance?.arrivalNotice?.enabled !== true) return;
    for (const [date, students] of byDate) {
      this.arrivalNoticeService
        .sendArrivalNotices({
          tenantId: device.tenant_id,
          date,
          students,
          takenBy: { kind: 'DEVICE', deviceId: device.id },
        })
        .catch((err: unknown) =>
          this.logger.warn(`Arrival notice failed for device ${device.id}: ${String(err)}`),
        );
    }
  }

  private isOutOfWindow(eventDateIso: string, timezone: string): boolean {
    return Math.abs(daysBetween(eventDateIso, localToday(timezone))) > CLOCK_WINDOW_DAYS;
  }

  private async resolveStudent(
    manager: EntityManager,
    tenantId: string,
    event: DeviceEventDto,
  ): Promise<Student | null> {
    const studentRepo = manager.getRepository(Student);
    if (event.student_id) {
      return studentRepo.findOne({
        where: { id: event.student_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
    }
    if (event.external_ref) {
      // One query, both columns (D9): the ref is a registration number or a card number.
      // If two rows match (one's reg number is another's card), the registration number wins.
      const ref = event.external_ref;
      const rows = await studentRepo.find({
        where: [
          { registration_number: ref, tenant_id: tenantId, deleted_at: IsNull() },
          { card_no: ref, tenant_id: tenantId, deleted_at: IsNull() },
        ],
        take: 2,
      });
      return rows.find((r) => r.registration_number === ref) ?? rows[0] ?? null;
    }
    return null;
  }

  private async handleCheckOut(
    manager: EntityManager,
    eventRepo: Repository<AttendanceDeviceEvent>,
    eventRow: AttendanceDeviceEvent,
    device: AttendanceDevice,
    student: Student,
    dateIso: string,
    occurredAt: Date,
  ): Promise<DeviceEventResultDto> {
    const recordRepo = manager.getRepository(AttendanceRecord);
    const record = await recordRepo.findOne({
      // Day register only (period_no IS NULL): a period-register record for
      // the same day must never receive the day's check-out.
      where: {
        tenant_id: device.tenant_id,
        student_id: student.id,
        date: dateIso,
        session: { period_no: IsNull() },
      },
    });

    if (!record) {
      await eventRepo.update(eventRow.id, { outcome: 'rejected', student_id: student.id });
      return {
        device_event_id: eventRow.device_event_id,
        outcome: 'rejected',
        reason: 'no_check_in',
      };
    }

    if (record.check_out_at === null) {
      record.check_out_at = occurredAt;
      await recordRepo.save(record);
    }

    await eventRepo.update(eventRow.id, {
      outcome: 'accepted',
      student_id: student.id,
      record_id: record.id,
    });
    return {
      device_event_id: eventRow.device_event_id,
      outcome: 'accepted',
      student_id: student.id,
      status: record.status,
      minutes_late: record.minutes_late,
    };
  }

  private async handleCheckIn(
    manager: EntityManager,
    eventRepo: Repository<AttendanceDeviceEvent>,
    eventRow: AttendanceDeviceEvent,
    device: AttendanceDevice,
    student: Student,
    dateIso: string,
    occurredAt: Date,
    policy: ReturnType<typeof resolveAttendancePolicy>,
    timezone: string,
    firstCheckIns: ArrivalStudent[],
  ): Promise<DeviceEventResultDto> {
    const sessionRepo = manager.getRepository(AttendanceSession);
    const recordRepo = manager.getRepository(AttendanceRecord);
    const sectionId = device.section_id ?? student.class_section_id;

    // [41.0] Judge lateness against the student's own shift, not the
    // school-wide pair. A class with no shift keeps the tenant pair.
    // Lateness follows the student's own class shift, not the device-bound section.
    const studentSection = await manager.getRepository(ClassSection).findOne({
      where: { id: student.class_section_id, tenant_id: device.tenant_id },
      relations: { class: true },
    });
    const shiftPolicy = policyForShift(policy, studentSection?.class?.shift_id, dateIso);

    let session = await sessionRepo.findOne({
      where: {
        tenant_id: device.tenant_id,
        section_id: sectionId,
        date: dateIso,
        period_no: IsNull(),
      },
    });
    if (!session) {
      try {
        session = await sessionRepo.save(
          sessionRepo.create({
            tenant_id: device.tenant_id,
            section_id: sectionId,
            date: dateIso,
            period_no: null,
            source: AttendanceSource.DEVICE,
          }),
        );
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Two concurrent device batches raced to create the same day's
        // whole-day session — the loser re-reads what the winner created.
        session = await sessionRepo.findOneOrFail({
          where: {
            tenant_id: device.tenant_id,
            section_id: sectionId,
            date: dateIso,
            period_no: IsNull(),
          },
        });
      }
    }

    let record = await recordRepo.findOne({
      where: { session_id: session.id, student_id: student.id },
    });
    let outcome: string;
    let versionBumped = false;

    if (!record) {
      const classification = classifyCheckIn(occurredAt, dateIso, shiftPolicy, timezone);
      record = await recordRepo.save(
        recordRepo.create({
          tenant_id: device.tenant_id,
          session_id: session.id,
          student_id: student.id,
          date: dateIso,
          status: classification.status,
          minutes_late: classification.minutesLate,
          check_in_at: occurredAt,
          source: AttendanceSource.DEVICE,
          device_id: device.id,
        }),
      );
      outcome = 'accepted';
      versionBumped = true;
      firstCheckIns.push({ studentId: student.id, status: record.status, occurredAt });
    } else if (record.source === AttendanceSource.TEACHER) {
      // Contract #4: teacher authority beats device authority. A device
      // may only fill fields the teacher left empty — never touch `status`.
      outcome = 'skipped_teacher_marked';
      if (record.check_in_at === null) {
        record.check_in_at = occurredAt;
        await recordRepo.save(record);
        versionBumped = true;
        firstCheckIns.push({ studentId: student.id, status: record.status, occurredAt });
      }
    } else if (occurredAt.getTime() < (record.check_in_at?.getTime() ?? Infinity)) {
      // Keep the earliest check-in among repeated device scans.
      const classification = classifyCheckIn(occurredAt, dateIso, shiftPolicy, timezone);
      record.check_in_at = occurredAt;
      record.status = classification.status;
      record.minutes_late = classification.minutesLate;
      record.device_id = device.id;
      await recordRepo.save(record);
      outcome = 'accepted';
      versionBumped = true;
    } else {
      outcome = 'duplicate';
    }

    if (versionBumped) {
      // Bumps the session's version explicitly so a teacher's open marking
      // screen finds out on its next write (the same conflict path [9.3]
      // uses).
      await sessionRepo.increment({ id: session.id }, 'version', 1);
    }

    await eventRepo.update(eventRow.id, {
      outcome,
      student_id: student.id,
      record_id: record.id,
    });

    return {
      device_event_id: eventRow.device_event_id,
      outcome,
      student_id: student.id,
      status: record.status,
      minutes_late: record.minutes_late,
    };
  }

  // ---------------------------------------------------------------------
  // [36.2.3] subject_type: STAFF branch. Mirrors the STUDENT path above
  // (same idempotency row, same ±2-day window, same outcome codes, same
  // "manual mark wins" rule) but resolves against `staff_profiles` and
  // finds-or-creates a `StaffAttendanceSession`/`StaffAttendanceRecord`
  // pair instead of the student ones. Staff have no section, so there is
  // no section-mismatch check here.
  //
  // `AttendanceDeviceEvent.student_id`/`record_id` carry real FK
  // constraints to `students`/`attendance_records` (see the [9.2]
  // migration), so a staff event's resolved ids are never written into
  // those columns — `raw` already has the original payload (subject_type,
  // external_ref/student_id-equivalent) for forensics.
  // ---------------------------------------------------------------------

  private async ingestStaffEvent(
    manager: EntityManager,
    eventRepo: Repository<AttendanceDeviceEvent>,
    eventRow: AttendanceDeviceEvent,
    device: AttendanceDevice,
    event: DeviceEventDto,
    eventDate: string,
    occurredAt: Date,
    policy: ReturnType<typeof resolveAttendancePolicy>,
    timezone: string,
  ): Promise<DeviceEventResultDto> {
    const staffProfile = await this.resolveStaffProfile(manager, device.tenant_id, event);
    if (!staffProfile) {
      await eventRepo.update(eventRow.id, { outcome: 'unknown_staff' });
      return { device_event_id: event.device_event_id, outcome: 'unknown_staff' };
    }

    // Clock-skew window — identical rule to the STUDENT branch.
    if (this.isOutOfWindow(eventDate, timezone)) {
      await eventRepo.update(eventRow.id, { outcome: 'out_of_window' });
      return { device_event_id: event.device_event_id, outcome: 'out_of_window' };
    }

    if (event.direction === AttendanceEventDirection.OUT) {
      return this.handleStaffCheckOut(
        manager,
        eventRepo,
        eventRow,
        device,
        staffProfile,
        eventDate,
        occurredAt,
      );
    }
    return this.handleStaffCheckIn(
      manager,
      eventRepo,
      eventRow,
      device,
      staffProfile,
      eventDate,
      occurredAt,
      policy,
      timezone,
    );
  }

  private async resolveStaffProfile(
    manager: EntityManager,
    tenantId: string,
    event: DeviceEventDto,
  ): Promise<StaffProfile | null> {
    const staffProfileRepo = manager.getRepository(StaffProfile);
    if (event.student_id) {
      return staffProfileRepo.findOne({
        where: { id: event.student_id, tenant_id: tenantId },
      });
    }
    if (event.external_ref) {
      // Staff namespace is separate (D37): only staff cards resolve here, never a student's.
      const ref = event.external_ref;
      const rows = await staffProfileRepo.find({
        where: [
          { employee_id: ref, tenant_id: tenantId },
          { card_no: ref, tenant_id: tenantId },
        ],
        take: 2,
      });
      return rows.find((r) => r.employee_id === ref) ?? rows[0] ?? null;
    }
    return null;
  }

  private async handleStaffCheckOut(
    manager: EntityManager,
    eventRepo: Repository<AttendanceDeviceEvent>,
    eventRow: AttendanceDeviceEvent,
    device: AttendanceDevice,
    staffProfile: StaffProfile,
    dateIso: string,
    occurredAt: Date,
  ): Promise<DeviceEventResultDto> {
    const recordRepo = manager.getRepository(StaffAttendanceRecord);
    const sessionRepo = manager.getRepository(StaffAttendanceSession);
    const session = await sessionRepo.findOne({
      where: { tenant_id: device.tenant_id, date: dateIso },
    });
    const record = session
      ? await recordRepo.findOne({
          where: { session_id: session.id, staff_profile_id: staffProfile.id },
        })
      : null;

    if (!record) {
      await eventRepo.update(eventRow.id, { outcome: 'rejected' });
      return {
        device_event_id: eventRow.device_event_id,
        outcome: 'rejected',
        reason: 'no_check_in',
      };
    }

    if (record.check_out_at === null) {
      record.check_out_at = occurredAt;
      await recordRepo.save(record);
    }

    await eventRepo.update(eventRow.id, { outcome: 'accepted' });
    return {
      device_event_id: eventRow.device_event_id,
      outcome: 'accepted',
      status: record.status,
    };
  }

  private async handleStaffCheckIn(
    manager: EntityManager,
    eventRepo: Repository<AttendanceDeviceEvent>,
    eventRow: AttendanceDeviceEvent,
    device: AttendanceDevice,
    staffProfile: StaffProfile,
    dateIso: string,
    occurredAt: Date,
    policy: ReturnType<typeof resolveAttendancePolicy>,
    timezone: string,
  ): Promise<DeviceEventResultDto> {
    const sessionRepo = manager.getRepository(StaffAttendanceSession);
    const recordRepo = manager.getRepository(StaffAttendanceRecord);

    let session = await sessionRepo.findOne({
      where: { tenant_id: device.tenant_id, date: dateIso },
    });
    if (!session) {
      try {
        session = await sessionRepo.save(
          sessionRepo.create({ tenant_id: device.tenant_id, date: dateIso }),
        );
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Two concurrent device batches raced to create the same day's
        // staff session — the loser re-reads what the winner created.
        session = await sessionRepo.findOneOrFail({
          where: { tenant_id: device.tenant_id, date: dateIso },
        });
      }
    }

    let record = await recordRepo.findOne({
      where: { session_id: session.id, staff_profile_id: staffProfile.id },
    });
    let outcome: string;
    let versionBumped = false;

    if (!record) {
      const classification = classifyCheckIn(
        occurredAt,
        dateIso,
        policyForShift(policy, null, dateIso),
        timezone,
      );
      record = await recordRepo.save(
        recordRepo.create({
          tenant_id: device.tenant_id,
          session_id: session.id,
          staff_profile_id: staffProfile.id,
          status: classification.status,
          source: AttendanceSource.DEVICE,
          check_in_at: occurredAt,
        }),
      );
      outcome = 'accepted';
      versionBumped = true;
    } else if (record.source === AttendanceSource.TEACHER) {
      // Manual-mark-wins (D3): a manually-marked staff record is never
      // overwritten by a device scan — only a blank check_in/check_out
      // gets filled in.
      outcome = 'skipped_teacher_marked';
      if (record.check_in_at === null) {
        record.check_in_at = occurredAt;
        await recordRepo.save(record);
        versionBumped = true;
      }
    } else if (occurredAt.getTime() < (record.check_in_at?.getTime() ?? Infinity)) {
      // Keep the earliest check-in among repeated device scans.
      const classification = classifyCheckIn(
        occurredAt,
        dateIso,
        policyForShift(policy, null, dateIso),
        timezone,
      );
      record.check_in_at = occurredAt;
      record.status = classification.status;
      await recordRepo.save(record);
      outcome = 'accepted';
      versionBumped = true;
    } else {
      outcome = 'duplicate';
    }

    if (versionBumped) {
      await sessionRepo.increment({ id: session.id }, 'version', 1);
    }

    await eventRepo.update(eventRow.id, { outcome });

    return {
      device_event_id: eventRow.device_event_id,
      outcome,
      status: record.status,
    };
  }
}

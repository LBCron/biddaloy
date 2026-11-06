import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import {
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  AuditAction,
  DailyAttendanceSource,
} from '@biddaloy/shared';
import { AttendanceSession } from './entities/attendance-session.entity';
import { sectionRosterIdsBySection } from '../enrollments/section-roster';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import {
  localTimeHHmm,
  localToday,
  policyForShift,
  resolveAttendancePolicy,
} from './attendance-policy.util';

export const DEVICE_ABSENT_SWEEP_QUEUE = 'device-absent-sweep';
export const DEVICE_ABSENT_SWEEP_JOB_ID = 'device-absent-sweep';
export const DEVICE_ABSENT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * [76.2.04] DEVICE-source schools (D27): once a shift's `absentAfter` has passed, every ACTIVE
 * student with no mark in the section's whole-day register becomes ABSENT / `source = SYSTEM`.
 *
 * - Skipped for a school with zero device scans today (a dead machine must not mark everyone
 *   absent), non-working days, and non-DEVICE schools.
 * - Insert-only: an existing mark (teacher or device) is never touched (D5). The register stays
 *   DRAFT so a teacher can correct it. A FINALIZED register is left alone.
 * - Per school, per section, in one transaction; every query is filtered by `tenant_id`.
 * - Redis down means the worker does not run, so the sweep is skipped (D41).
 */
@Injectable()
@Processor(DEVICE_ABSENT_SWEEP_QUEUE)
export class DeviceAbsentSweepScheduler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DeviceAbsentSweepScheduler.name);

  constructor(
    @InjectQueue(DEVICE_ABSENT_SWEEP_QUEUE) private readonly queue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
    private readonly schoolCalendarService: SchoolCalendarService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      DEVICE_ABSENT_SWEEP_JOB_ID,
      { every: DEVICE_ABSENT_SWEEP_INTERVAL_MS },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
    this.logger.log(`Scheduled device-absent sweep every ${DEVICE_ABSENT_SWEEP_INTERVAL_MS}ms`);
  }

  async process(): Promise<void> {
    for (const tenant of await this.schoolsService.findAllActive()) {
      // One broken school must never block the rest.
      try {
        await this.sweepTenant(tenant.id);
      } catch (error) {
        this.logger.error(`Device-absent sweep failed for tenant ${tenant.id}: ${String(error)}`);
      }
    }
  }

  async sweepTenant(tenantId: string): Promise<number> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);
    if (policy.dailySource !== DailyAttendanceSource.DEVICE) return 0;

    const timezone = settings.region?.timezone ?? 'UTC';
    const today = localToday(timezone);
    if (await this.schoolCalendarService.isNonWorkingDay({ tenantId, date: today })) return 0;

    // Any accepted scan that resolved to a student and HAPPENED today (occurred_at, not ingest
    // time: an offline device uploading yesterday's buffer this morning proves nothing about
    // today). Unknown-card or rejected scans do not count: a machine that only produces those is
    // as good as dead (D27).
    const scans = await this.dataSource.query(
      `SELECT 1 FROM attendance_device_events
       WHERE tenant_id = $1
         AND occurred_at >= ($2::date)::timestamp AT TIME ZONE $3
         AND occurred_at < ($2::date + 1)::timestamp AT TIME ZONE $3
         AND outcome = 'accepted' AND student_id IS NOT NULL
       LIMIT 1`,
      [tenantId, today, timezone],
    );
    if (scans.length === 0) {
      this.logger.log(`Device-absent sweep skipped for tenant ${tenantId}: no scans today`);
      return 0;
    }

    const sections: { id: string; class_id: string; shift_id: string | null }[] =
      await this.dataSource.query(
        `SELECT cs.id, c.id AS class_id, c.shift_id
       FROM class_sections cs
       JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
       JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.tenant_id = $1
         AND ay.is_current = true AND ay.deleted_at IS NULL
       WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL`,
        [tenantId],
      );

    const now = localTimeHHmm(timezone);
    // A holiday can be class-scoped: one check per distinct class.
    const workingByClass = new Map<string, boolean>();
    let inserted = 0;
    for (const section of sections) {
      const { absentAfter } = policyForShift(policy, section.shift_id, today);
      if (now < absentAfter) continue;
      if (!workingByClass.has(section.class_id)) {
        workingByClass.set(
          section.class_id,
          !(await this.schoolCalendarService.isNonWorkingDay({
            tenantId,
            date: today,
            classId: section.class_id,
          })),
        );
      }
      if (!workingByClass.get(section.class_id)) continue;
      inserted += await this.dataSource.transaction((manager) =>
        this.sweepSection(manager, tenantId, section.id, today),
      );
    }
    if (inserted > 0) {
      this.logger.log(`Device-absent sweep marked ${inserted} absent for tenant ${tenantId}`);
    }
    return inserted;
  }

  private async sweepSection(
    manager: EntityManager,
    tenantId: string,
    sectionId: string,
    date: string,
  ): Promise<number> {
    // Same roll rule as the register: enrolled in this section and on the roll today.
    const roster =
      (await sectionRosterIdsBySection(manager, tenantId, [sectionId], { onRollOn: date })).get(
        sectionId,
      ) ?? [];
    if (roster.length === 0) return 0;
    // Whole-day marks only (any section, as the not-taken rule counts them): a period mark leaves
    // the day register's gap open.
    const marked: { student_id: string }[] = await manager.query(
      `SELECT r.student_id FROM attendance_records r
       JOIN attendance_sessions s ON s.id = r.session_id AND s.tenant_id = $1 AND s.period_no IS NULL
       WHERE r.tenant_id = $1 AND r.date = $2 AND r.student_id = ANY($3::uuid[])`,
      [tenantId, date, roster],
    );
    const markedIds = new Set(marked.map((r) => r.student_id));
    const unmarked = roster.filter((id) => !markedIds.has(id));
    // No session is created for a section with nobody to mark.
    if (unmarked.length === 0) return 0;

    // ON CONFLICT DO NOTHING: a racing creator must not abort the transaction.
    await manager
      .createQueryBuilder()
      .insert()
      .into(AttendanceSession)
      .values({
        tenant_id: tenantId,
        section_id: sectionId,
        date,
        period_no: null,
        subject_id: null,
        source: AttendanceSource.SYSTEM,
        state: AttendanceSessionState.DRAFT,
      })
      .orIgnore()
      .execute();
    // Row lock (as markLeaveRange): serialises with a teacher save / finalize, and the state is
    // re-checked under it. No advisory lock needed: this lock plus insert-only ON CONFLICT.
    const sessionRepo = manager.getRepository(AttendanceSession);
    const session = await sessionRepo.findOneOrFail({
      where: { tenant_id: tenantId, section_id: sectionId, date, period_no: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (session.state === AttendanceSessionState.FINALIZED) return 0;

    // Insert-only and per-student NOT EXISTS: never updates a mark; a second run inserts nothing.
    const rows: { id: string }[] = await manager.query(
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status, source)
       SELECT s.tenant_id, $2, s.id, $3, 'ABSENT', 'SYSTEM'
       FROM students s
       WHERE s.tenant_id = $1 AND s.id = ANY($4::uuid[]) AND s.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM attendance_records r
           WHERE r.tenant_id = $1 AND r.session_id = $2 AND r.student_id = s.id)
       ON CONFLICT (session_id, student_id) DO NOTHING
       RETURNING id`,
      [tenantId, session.id, date, unmarked],
    );
    if (rows.length > 0) {
      await sessionRepo.increment({ id: session.id, tenant_id: tenantId }, 'version', 1);
    }
    for (const row of rows) {
      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'AttendanceRecord',
          entity_id: row.id,
          tenant_id: tenantId,
          performed_by_user_id: null,
          old_values: null,
          new_values: {
            status: AttendanceStatus.ABSENT,
            source: AttendanceSource.SYSTEM,
            sweep: 'device_absent',
          },
        },
        manager,
      );
    }
    return rows.length;
  }
}

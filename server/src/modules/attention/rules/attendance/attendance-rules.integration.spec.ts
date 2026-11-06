import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AlertSeverity, AttendanceStatus, UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { TENANT_STATUS_REDIS } from '../../../schools/tenant-status.service';
import { AttendanceService } from '../../../attendance/attendance.service';
import { AttendanceModule } from '../../../attendance/attendance.module';
import { localToday } from '../../../attendance/attendance-policy.util';
import { AuthModule } from '../../../auth/auth.module';
import { CalendarEvent } from '../../../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../../../calendar/entities/calendar-event-class.entity';
import { attentionEvents } from '../../attention.constants';
import { ATTENTION_RECHECK, AttentionRecheckPayload } from '../../engine/attention-events';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { RuleContext } from '../rule.types';
import { AttendanceNotTakenRule } from './attendance-not-taken.rule';
import { AttendanceRulesModule } from './attendance-rules.module';

// Today in the tenant's timezone, as RuleContextService builds it. A UTC date is
// a day behind from 18:00 UTC, so the alert's end-of-local-day expiry is already
// past and AlertWriterService drops the finding.
const DAY = localToday('Asia/Dhaka');
const WEEKDAY = new Date(`${DAY}T00:00:00Z`).getUTCDay(); // 0 = Sunday, as routine_slots.weekday

describe('AttendanceNotTakenRule (integration)', () => {
  let ds: DataSource;
  let redis: Redis;
  let writer: AlertWriterService;
  let rule: AttendanceNotTakenRule;
  let attendance: AttendanceService;

  interface Tenant {
    id: string;
    classId: string;
    yearId: string;
    sectionId: string;
    studentId: string;
    adminId: string;
    execId: string;
    userOf: Record<string, string>;
    teacherOf: Record<string, string>;
    spOf: Record<string, string>;
    slotId: string;
  }
  let A: Tenant;
  let B: Tenant;

  const rand = () => Math.random().toString(36).slice(2, 9);
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);
  const ctx = (t: Tenant, localTime: string, actorUserId?: string): RuleContext => ({
    tenantId: t.id,
    now: new Date(),
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime,
    isWorkingDay: true,
    settings: {
      attendanceGraceMinutes: 15,
      escalateAttendanceToHeads: true,
    } as RuleContext['settings'],
    actorUserId,
  });

  async function mkUser(tenantId: string, role: string) {
    const [{ id }] = await q(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Attendance Rule Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`att-rule-${rand()}@example.com`],
    );
    await q(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      id,
      tenantId,
      role,
    ]);
    return id as string;
  }

  /** Everything is wiped between tests, so each test builds its own tenants. */
  async function mkTenant(): Promise<Tenant> {
    const [{ id }] = await q(
      `INSERT INTO schools (name, slug, settings) VALUES ('Att Rule Test', $1, $2) RETURNING id`,
      [
        `att-rule-${rand()}`,
        JSON.stringify({
          version: 1,
          attendance: {
            weeklyOffDays: [],
            correctionWindowDays: 3650,
            allowFutureDates: true,
            lateAfter: '09:00',
            autoAbsentNotification: { enabled: false, cutoffTime: '10:00' },
          },
        }),
      ],
    );
    const [{ id: yearId }] = await q(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('Att Rule Year', '2020-01-01', '2099-12-31', true, $1) RETURNING id`,
      [id],
    );
    const [{ id: classId }] = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Seven', $1, $2) RETURNING id`,
      [yearId, id],
    );
    const [{ id: sectionId }] = await q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'B', $2) RETURNING id`,
      [classId, id],
    );
    const [{ id: studentId }] = await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       VALUES ('Kid', $1, 1, $2, $3, 'ACTIVE') RETURNING id`,
      [`AR-${rand()}`, sectionId, id],
    );
    // The register roster is read from enrollments (#2269), not students.class_section_id.
    await q(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
      [studentId, classId, sectionId, yearId, id],
    );
    const adminId = await mkUser(id, 'ADMIN');
    const execId = await mkUser(id, 'EXECUTIVE');
    const userOf: Record<string, string> = {};
    const teacherOf: Record<string, string> = {};
    const spOf: Record<string, string> = {};
    for (const [name, type] of [
      ['CT', 'CLASS_TEACHER'],
      ['AT', 'ASSISTANT_CLASS_TEACHER'],
      ['SUB', null],
    ] as const) {
      userOf[name] = await mkUser(id, 'TEACHER');
      const [{ id: sp }] = await q(
        `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
        [userOf[name], id, `SP-${rand()}`],
      );
      spOf[name] = sp;
      [{ id: teacherOf[name] }] = await q(
        `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, '{}', $3, $4, NOW(), NOW()) RETURNING id`,
        [userOf[name], `T-${rand()}`, id, sp],
      );
      if (type) {
        await q(
          `INSERT INTO teacher_class_sections (teacher_id, section_id, assignment_type, tenant_id)
           VALUES ($1, $2, $3, $4)`,
          [teacherOf[name], sectionId, type, id],
        );
      }
    }
    // PUBLISHED routine, period 1 starts at 08:00 on today's weekday, taught by CT.
    const [{ id: subjectId }] = await q(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', $2) RETURNING id`,
      [id, `M-${rand()}`],
    );
    const [{ id: routineId }] = await q(
      `INSERT INTO routines (tenant_id, academic_year_id, name, state, published_at)
       VALUES ($1, $2, 'R', 'PUBLISHED', NOW()) RETURNING id`,
      [id, yearId],
    );
    const [{ id: shiftId }] = await q(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, $2, '08:00', '14:00', 0) RETURNING id`,
      [id, `S-${rand()}`],
    );
    const [{ id: periodId }] = await q(
      `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
       VALUES ($1, $2, 1, 'CLASS', '08:00', '08:40') RETURNING id`,
      [id, shiftId],
    );
    const [{ id: slotId }] = await q(
      `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id,
         recurrence, recurrence_offset, valid_from)
       VALUES ($1, $2, $3, $4, $5, $6, 'WEEKLY', 0, '2020-01-01') RETURNING id`,
      [id, routineId, sectionId, periodId, WEEKDAY, subjectId],
    );
    await q(
      `INSERT INTO routine_slot_teachers (tenant_id, routine_slot_id, teacher_id) VALUES ($1, $2, $3)`,
      [id, slotId, teacherOf.CT],
    );
    return {
      id,
      classId,
      yearId,
      sectionId,
      studentId,
      adminId,
      execId,
      userOf,
      teacherOf,
      spOf,
      slotId,
    };
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!);
    const module = await createTestModule(
      ALL_ENTITIES,
      [AlertWriterService, { provide: TENANT_STATUS_REDIS, useValue: redis }],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        AttendanceModule,
        AuthModule,
        AttendanceRulesModule,
      ],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    rule = module.get(AttendanceNotTakenRule, { strict: false });
    attendance = module.get(AttendanceService, { strict: false });
  }, 90000);

  afterAll(async () => {
    redis.disconnect();
    await ds.destroy();
  });

  beforeEach(async () => {
    A = await mkTenant();
    B = await mkTenant();
  });

  it('ladder: REMINDER at 08:05 to CT only, WARNING at 08:20, CRITICAL after the cutoff with A heads', async () => {
    const [reminder] = await rule.evaluate(ctx(A, '08:05'));
    expect(reminder.severity).toBe(AlertSeverity.REMINDER);
    expect(reminder.recipients).toEqual([{ userId: A.userOf.CT, role: UserRole.TEACHER }]);

    const [warning] = await rule.evaluate(ctx(A, '08:20'));
    expect(warning.severity).toBe(AlertSeverity.WARNING);

    const [critical] = await rule.evaluate(ctx(A, '10:05'));
    expect(critical.severity).toBe(AlertSeverity.CRITICAL);
    expect(critical.recipients.map((r) => r.userId).sort()).toEqual(
      [A.userOf.CT, A.adminId, A.execId].sort(),
    );
  });

  it('two shifts: a day-shift section is not CRITICAL at its own first bell', async () => {
    const [{ id: dayShift }] = await q(
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, $2, '12:30', '17:00', 1) RETURNING id`,
      [A.id, `D-${rand()}`],
    );
    const [{ id: classId }] = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id, shift_id) VALUES ('Eight', $1, $2, $3) RETURNING id`,
      [A.yearId, A.id, dayShift],
    );
    const [{ id: sectionId }] = await q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'D', $2) RETURNING id`,
      [classId, A.id],
    );
    await q(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, assignment_type, tenant_id)
       VALUES ($1, $2, 'CLASS_TEACHER', $3)`,
      [A.teacherOf.CT, sectionId, A.id],
    );
    const [{ id: periodId }] = await q(
      `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
       VALUES ($1, $2, 1, 'CLASS', '12:30', '13:10') RETURNING id`,
      [A.id, dayShift],
    );
    await q(
      `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id,
         recurrence, recurrence_offset, valid_from)
       SELECT $1, rs.routine_id, $2, $3, $4, rs.subject_id, 'WEEKLY', 0, '2020-01-01'
       FROM routine_slots rs WHERE rs.id = $5`,
      [A.id, sectionId, periodId, WEEKDAY, A.slotId],
    );
    const daySection = async (time: string) =>
      (await rule.evaluate(ctx(A, time))).find((f) => f.subject!.id === sectionId)!;

    // No shift times: the school's 10:00 cutoff (2h after the 08:00 bell) is kept 2h after 12:30.
    expect((await daySection('12:35')).severity).toBe(AlertSeverity.REMINDER);
    expect((await daySection('14:29')).severity).toBe(AlertSeverity.WARNING);
    expect((await daySection('14:30')).severity).toBe(AlertSeverity.CRITICAL);

    // Own shift times move the school cutoff by the lateAfter offset: 10:00 + (12:45 - 09:00).
    await q(
      `UPDATE schools SET settings = jsonb_set(settings, '{attendance,shiftTimes}', $2::jsonb) WHERE id = $1`,
      [A.id, JSON.stringify([{ shiftId: dayShift, lateAfter: '12:45', absentAfter: '13:30' }])],
    );
    expect((await daySection('13:44')).severity).toBe(AlertSeverity.WARNING);
    const critical = await daySection('13:45');
    expect(critical.severity).toBe(AlertSeverity.CRITICAL);
    expect(critical.recipients.map((r) => r.userId)).toContain(A.adminId);
  });

  it('delegation: CT on approved leave and period 1 covered by SUB -> AT + SUB, not CT', async () => {
    await q(
      `INSERT INTO leave_records (tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status)
       VALUES ($1, $2, 'SICK', $3, $3, 1, 'APPROVED')`,
      [A.id, A.spOf.CT, DAY],
    );
    await q(
      `INSERT INTO routine_substitutions (tenant_id, routine_slot_id, date, substitute_teacher_id, is_cancelled, created_by)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [A.id, A.slotId, DAY, A.teacherOf.SUB, A.adminId],
    );
    const [finding] = await rule.evaluate(ctx(A, '08:05'));
    expect(finding.recipients.map((r) => r.userId).sort()).toEqual(
      [A.userOf.AT, A.userOf.SUB].sort(),
    );
  });

  it('does not fire: finalized register, class-scoped holiday, non-working day', async () => {
    const [{ id: sid }] = await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state) VALUES ($1, $2, $3, 'FINALIZED') RETURNING id`,
      [A.id, A.sectionId, DAY],
    );
    await q(
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status) VALUES ($1, $2, $3, $4, 'PRESENT')`,
      [A.id, sid, A.studentId, DAY],
    );
    expect(await rule.evaluate(ctx(A, '08:20'))).toEqual([]);

    // B: not finalized, but its class has a published holiday today.
    const event = await ds.getRepository(CalendarEvent).save({
      tenant_id: B.id,
      academic_year_id: B.yearId,
      type: 'HOLIDAY',
      name: 'Class holiday',
      start_date: DAY,
      end_date: DAY,
      counts_as_working_day: false,
      published_at: new Date(),
    } as never);
    await ds
      .getRepository(CalendarEventClass)
      .save({ event_id: (event as { id: string }).id, class_id: B.classId, tenant_id: B.id });
    expect(await rule.evaluate(ctx(B, '08:20'))).toEqual([]);

    expect(await rule.evaluate({ ...ctx(B, '08:20'), isWorkingDay: false })).toEqual([]);
  });

  it('[76.2.05] device school: 3 scanned + 20 unmarked fires; SYSTEM absences for the 20 resolve it', async () => {
    await q(
      `UPDATE schools SET settings = jsonb_set(settings, '{attendance,dailySource}', '"DEVICE"') WHERE id = $1`,
      [A.id],
    );
    const [{ id: sid }] = await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state) VALUES ($1, $2, $3, 'DRAFT') RETURNING id`,
      [A.id, A.sectionId, DAY],
    );
    const ids: string[] = [A.studentId];
    for (let i = 0; i < 22; i++) {
      const [{ id }] = await q(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
         VALUES ('Kid', $1, $2, $3, $4, 'ACTIVE') RETURNING id`,
        [`AR-${rand()}`, i + 2, A.sectionId, A.id],
      );
      await q(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
        [id, A.classId, A.sectionId, A.yearId, A.id],
      );
      ids.push(id);
    }
    const mark = (sidIds: string[], status: string, source: string) =>
      Promise.all(
        sidIds.map((student) =>
          q(
            `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status, source) VALUES ($1, $2, $3, $4, $5, $6)`,
            [A.id, sid, student, DAY, status, source],
          ),
        ),
      );
    await mark(ids.slice(0, 3), 'PRESENT', 'DEVICE');
    const [f] = await rule.evaluate(ctx(A, '08:20'));
    expect(f.dedupeKey).toBe(`section:${A.sectionId}:${DAY}`);
    expect(f.params.title_en).toMatch(/^Attendance incomplete: .* — 20 without status$/);
    await mark(ids.slice(3), 'ABSENT', 'SYSTEM');
    // PR #3609 review #4: ingest and the sweep leave a device register DRAFT (D27); with every
    // student marked the alert resolves without anyone submitting it.
    expect(await rule.evaluate(ctx(A, '08:20'))).toEqual([]);
  });

  it('[76.2.05] a non-device school still needs the register submitted, even with everyone marked', async () => {
    const [{ id: sid }] = await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state) VALUES ($1, $2, $3, 'DRAFT') RETURNING id`,
      [A.id, A.sectionId, DAY],
    );
    await q(
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status) VALUES ($1, $2, $3, $4, 'PRESENT')`,
      [A.id, sid, A.studentId, DAY],
    );
    const [f] = await rule.evaluate(ctx(A, '08:20'));
    expect(f.dedupeKey).toBe(`section:${A.sectionId}:${DAY}`);
  });

  it('[76.2.05] a FINALIZED session with unmarked students still fires', async () => {
    await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state) VALUES ($1, $2, $3, 'FINALIZED')`,
      [A.id, A.sectionId, DAY],
    );
    const [f] = await rule.evaluate(ctx(A, '08:20'));
    expect(f.params.title_en).toMatch(/1 without status$/);
  });

  it('[76.2.05] PR #3609 review: an inactive enrollment with no leaving event is not counted unmarked', async () => {
    const [{ id: sid }] = await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state) VALUES ($1, $2, $3, 'FINALIZED') RETURNING id`,
      [A.id, A.sectionId, DAY],
    );
    await q(
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status) VALUES ($1, $2, $3, $4, 'PRESENT')`,
      [A.id, sid, A.studentId, DAY],
    );
    // An ACTIVE student whose enrollment here ended with no leaving event: off the register
    // roster (and the device sweep's), so it must not keep the alert open either.
    const [{ id: gone }] = await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       VALUES ('Gone', $1, 2, $2, $3, 'ACTIVE') RETURNING id`,
      [`AR-${rand()}`, A.sectionId, A.id],
    );
    await q(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, 'INACTIVE', $5)`,
      [gone, A.classId, A.sectionId, A.yearId, A.id],
    );
    expect(await rule.evaluate(ctx(A, '08:20'))).toEqual([]);
  });

  it("tenant isolation: B's unfinalized section never shows up in A's findings", async () => {
    const findings = await rule.evaluate(ctx(A, '10:05'));
    expect(findings.map((f) => f.subject!.id)).toEqual([A.sectionId]);
    const users = findings.flatMap((f) => f.recipients.map((r) => r.userId));
    expect(users).not.toContain(B.adminId);
    expect(users).not.toContain(B.execId);
  });

  it('resolves: a finalized register emits a recheck and clears the alert with the actor recorded', async () => {
    const c = ctx(A, '08:20', A.adminId);
    await writer.apply(c, rule, await rule.evaluate(c));
    const row = async () =>
      (
        await q(
          `SELECT status, resolved_by_user_id FROM alerts WHERE tenant_id = $1 AND rule_key = 'attendance.not_taken'`,
          [A.id],
        )
      )[0];
    expect((await row()).status).toBe('ACTIVE');

    const events: AttentionRecheckPayload[] = [];
    const on = (p: AttentionRecheckPayload) => events.push(p);
    attentionEvents.on(ATTENTION_RECHECK, on);
    try {
      await attendance.putRegister({
        sectionId: A.sectionId,
        tenantId: A.id,
        role: UserRole.ADMIN,
        userId: A.adminId,
        ip: null,
        userAgent: null,
        dto: {
          date: DAY,
          period_no: null,
          base_version: 0,
          client_request_id: randomUUID(),
          finalize: true,
          entries: [{ student_id: A.studentId, status: AttendanceStatus.PRESENT }],
        } as never,
      });
    } finally {
      attentionEvents.off(ATTENTION_RECHECK, on);
    }
    expect(events).toEqual([
      { tenantId: A.id, ruleKey: 'attendance.not_taken', actorUserId: A.adminId },
    ]);

    await writer.apply(c, rule, await rule.evaluate(c));
    expect(await row()).toMatchObject({ status: 'RESOLVED', resolved_by_user_id: A.adminId });
  });
});

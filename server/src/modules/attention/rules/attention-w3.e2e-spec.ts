import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { AlertWriterService } from '../engine/alert-writer.service';
import { AttentionScheduler } from '../engine/attention-scheduler';
import { RuleContextService } from './rule-context.service';
import { RuleRegistryService } from './rule-registry.service';

/**
 * [67.3.08] attendance.not_taken over HTTP: a class teacher is told about their
 * unmarked section, nobody else is, and the alert resolves when the register
 * lands. No queue: the rule runs through the same three services the
 * scheduler uses (build context -> evaluate -> apply).
 */
const id = (n: number) => `00000000-0000-4000-8000-0000001e30${String(n).padStart(2, '0')}`;
const SCHOOL_A = id(1);
const SCHOOL_B = id(2);
const USERS = {
  CT: { id: id(3), email: 'ct@attn-w3.example', name: 'Class Teacher A' },
  CT2: { id: id(4), email: 'ct2@attn-w3.example', name: 'Class Teacher A2' },
  OT: { id: id(5), email: 'ot@attn-w3.example', name: 'Other Teacher A' },
  ADMIN: { id: id(6), email: 'admin@attn-w3.example', name: 'Admin A' },
  CT_B: { id: id(7), email: 'ct-b@attn-w3.example', name: 'Class Teacher B' },
};
type Who = keyof typeof USERS;
// Monday 09:00 Asia/Dhaka: past the 15 min grace, before the 10:00 cutoff.
const MONDAY_0900 = new Date('2026-10-12T03:00:00Z');
// 11:00: after the default cutoff -> CRITICAL, heads are added.
const MONDAY_1100 = new Date('2026-10-12T05:00:00Z');
const DAY = '2026-10-12';

describe('Attention W3 E2E: attendance.not_taken', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  const q = (sql: string, params: unknown[] = []) => ds.query(sql, params);

  const call = (path: string, who: Who, tenantId = SCHOOL_A) =>
    supertest(app.getHttpServer())
      .get(`/api/v1/attention${path}`)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('X-Tenant-ID', tenantId);

  /** Runs the rule for one school exactly as the scheduler does, minus the queue. */
  async function runRule(tenantId: string, now: Date, actorUserId?: string) {
    const ctx = await app.get(RuleContextService).build(tenantId, now, actorUserId);
    const rule = app.get(RuleRegistryService).get('attendance.not_taken')!;
    await app.get(AlertWriterService).apply(ctx, rule, await rule.evaluate(ctx));
  }

  /** A class + section with a PUBLISHED Monday 08:00 period, taught by `teacherUser`. */
  async function mkSection(tenantId: string, classTeacher: Who, klass: string, section: string) {
    const yearId: string =
      (
        await q(`SELECT id FROM academic_years WHERE tenant_id = $1 AND name = '2026'`, [tenantId])
      )[0]?.id ??
      (
        await q(
          `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current, created_at, updated_at)
           VALUES ($1, '2026', '2026-01-01', '2026-12-31', true, NOW(), NOW()) RETURNING id`,
          [tenantId],
        )
      )[0].id;
    const [{ id: classId }] = await q(
      `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, klass, yearId],
    );
    const [{ id: sectionId }] = await q(
      `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, classId, section],
    );
    for (const roll of [1, 2]) {
      await q(
        `INSERT INTO students (tenant_id, full_name, registration_number, roll_number, class_section_id, enrollment_status)
         VALUES ($1, 'Kid', $2, $3, $4, 'ACTIVE')`,
        [tenantId, `W3-${sectionId.slice(0, 8)}-${roll}`, roll, sectionId],
      );
    }
    const empId = `T-${USERS[classTeacher].id.slice(-4)}`;
    const [{ id: staffProfileId }] = await q(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [USERS[classTeacher].id, tenantId, empId],
    );
    const [{ id: teacherId }] = await q(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '{}', $3, $4, NOW(), NOW()) RETURNING id`,
      [USERS[classTeacher].id, empId, tenantId, staffProfileId],
    );
    await q(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, assignment_type, tenant_id)
       VALUES ($1, $2, 'CLASS_TEACHER', $3)`,
      [teacherId, sectionId, tenantId],
    );
    const [{ id: subjectId }] = await q(
      `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Math', 'গণিত', $2) RETURNING id`,
      [tenantId, `M-${sectionId.slice(0, 8)}`],
    );
    // One routine / shift / period per school, shared by every section.
    const getOrCreate = async (find: string, make: string, params: unknown[]) =>
      ((await q(find, [tenantId]))[0] ?? (await q(make, params))[0]).id as string;
    const routineId = await getOrCreate(
      `SELECT id FROM routines WHERE tenant_id = $1`,
      `INSERT INTO routines (tenant_id, academic_year_id, name, state, published_at)
       VALUES ($1, $2, 'R', 'PUBLISHED', NOW()) RETURNING id`,
      [tenantId, yearId],
    );
    const shiftId = await getOrCreate(
      `SELECT id FROM shifts WHERE tenant_id = $1`,
      `INSERT INTO shifts (tenant_id, name, day_starts_at, day_ends_at, sequence)
       VALUES ($1, 'W3 shift', '08:00', '14:00', 0) RETURNING id`,
      [tenantId],
    );
    const periodId = await getOrCreate(
      `SELECT id FROM period_slots WHERE tenant_id = $1`,
      `INSERT INTO period_slots (tenant_id, shift_id, sequence, kind, starts_at, ends_at)
       VALUES ($1, $2, 1, 'CLASS', '08:00', '08:40') RETURNING id`,
      [tenantId, shiftId],
    );
    await q(
      `INSERT INTO routine_slots (tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id,
         recurrence, recurrence_offset, valid_from)
       VALUES ($1, $2, $3, $4, 1, $5, 'WEEKLY', 0, '2026-01-01')`,
      [tenantId, routineId, sectionId, periodId, subjectId],
    );
    return sectionId as string;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    // The app's own BullMQ sweeps run every rule at the real clock (CI: Saturday 09:08 Dhaka) and
    // can add alerts (e.g. setup.incomplete) between runRules and a read. Only this file's runRules may write.
    await app.get(AttentionScheduler).worker.close();

    for (const [sid, slug] of [
      [SCHOOL_A, 'attn-w3-a'],
      [SCHOOL_B, 'attn-w3-b'],
    ]) {
      await q(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, $2, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [sid, slug],
      );
    }
    const members: [Who, string, UserRole][] = [
      ['CT', SCHOOL_A, UserRole.TEACHER],
      ['CT2', SCHOOL_A, UserRole.TEACHER],
      ['OT', SCHOOL_A, UserRole.TEACHER],
      ['ADMIN', SCHOOL_A, UserRole.ADMIN],
      ['CT_B', SCHOOL_B, UserRole.TEACHER],
    ];
    for (const u of Object.values(USERS)) {
      await q(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, u.email, SEED_ADMIN_PASSWORD_HASH, u.name],
      );
    }
    for (const [who, school, role] of members) {
      await q(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [USERS[who].id, school, role],
      );
    }
    for (const [who, u] of Object.entries(USERS)) {
      tokens[who] = (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: u.email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token;
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  let sectionA: string;
  beforeEach(async () => {
    // The harness does not wipe classes/teachers, so clear both schools' fixtures (children first).
    for (const table of [
      'alert_recipients',
      'alerts',
      'attendance_sessions',
      'routine_slot_teachers',
      'routine_slots',
      'routines',
      'period_slots',
      'shifts',
      'subjects',
      'teacher_class_sections',
      'teachers',
      'staff_profiles',
      'students',
      'class_sections',
      'classes',
      'academic_years',
    ]) {
      await q(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [[SCHOOL_A, SCHOOL_B]]);
    }
    sectionA = await mkSection(SCHOOL_A, 'CT', '7', 'B');
    await mkSection(SCHOOL_B, 'CT_B', '8', 'C');
  });

  it('tells the class teacher about their unmarked section, and nobody else', async () => {
    await runRule(SCHOOL_A, MONDAY_0900);
    await runRule(SCHOOL_B, MONDAY_0900);

    const ct = (await call('/summary?role=TEACHER&locale=en', 'CT').expect(200)).body;
    expect(ct).toMatchObject({ warning: 1, critical: 0 });
    expect(ct.top.ruleKey).toBe('attendance.not_taken');
    expect(ct.top.title).toContain('7-B');

    // A teacher who is not on the section sees nothing.
    expect((await call('/summary?role=TEACHER&locale=en', 'OT').expect(200)).body).toMatchObject({
      warning: 0,
      critical: 0,
      reminder: 0,
    });
    // School B's teacher gets only B's own alert, and school A's teacher cannot read school B through the header.
    const ctB = (await call('/summary?role=TEACHER&locale=en', 'CT_B', SCHOOL_B).expect(200)).body;
    expect(ctB).toMatchObject({ warning: 1, critical: 0 });
    expect(ctB.top.title).toContain('8-C');
    // CT is not a member of school B: the tenant guard answers 401.
    await call('/summary?role=TEACHER&locale=en', 'CT', SCHOOL_B).expect(401);

    const items = (await call('/items?tab=active&locale=en', 'CT').expect(200)).body;
    expect(items.items).toHaveLength(1);
    expect(items.items[0].actionUrl.startsWith(`/attendance/${sectionA}?date=${DAY}`)).toBe(true);
  });

  it('resolves once the register is finalized and records who resolved it', async () => {
    await runRule(SCHOOL_A, MONDAY_0900);
    // The real PUT route refuses a future date, so write the finalized day session directly.
    const [{ id: sessionId }] = await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, state) VALUES ($1, $2, $3, 'FINALIZED') RETURNING id`,
      [SCHOOL_A, sectionA, DAY],
    );
    // [76.2.05] D28: a FINALIZED register with students left unmarked still fires, so the
    // finalized register here marks both students.
    await q(
      `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status)
       SELECT tenant_id, $2, id, $3, 'PRESENT' FROM students WHERE tenant_id = $1 AND class_section_id = $4`,
      [SCHOOL_A, sessionId, DAY, sectionA],
    );
    await runRule(SCHOOL_A, MONDAY_0900, USERS.CT.id);

    expect((await call('/summary?role=TEACHER&locale=en', 'CT').expect(200)).body).toMatchObject({
      warning: 0,
      critical: 0,
      reminder: 0,
    });
    const history = (await call('/items?tab=history&locale=en', 'CT').expect(200)).body;
    expect(history.items).toHaveLength(1);
    expect(history.items[0].resolvedByName).toBe(USERS.CT.name);
  });

  it('escalates to CRITICAL after the cutoff and adds the admin', async () => {
    // A second section whose class teacher is CT2.
    await mkSection(SCHOOL_A, 'CT2', '9', 'A');
    await runRule(SCHOOL_A, MONDAY_1100);

    expect((await call('/summary?role=TEACHER&locale=en', 'CT2').expect(200)).body.critical).toBe(
      1,
    );
    // Both unmarked sections (7-B and 9-A) escalate, so the admin sees two.
    expect((await call('/summary?role=ADMIN&locale=en', 'ADMIN').expect(200)).body.critical).toBe(
      2,
    );
  });
});

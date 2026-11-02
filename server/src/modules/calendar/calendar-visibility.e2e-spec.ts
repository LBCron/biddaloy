import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole, CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
} from '@test/constants';
import { todayInSchoolTz } from '../../common/time';
import { addDays } from '../attendance/attendance-policy.util';

const API = '/api/v1';

/**
 * Event dates count from tomorrow in the school's timezone, never a literal:
 * `assertNotPast` refuses an event that ended before the school's "today", so
 * a fixed date turns this spec red the day it passes (#3436). Each test keeps
 * its own day; the list window is day(2)..day(11), so the two shape-test
 * events (day 0 and 1) stay outside it.
 * ponytail: the seed academic year ends on 2026-12-31 and an event must sit
 * inside it, so from about 2026-12-20 day(11) falls past the year end; move
 * the seed year forward (or create one here) when that day comes.
 */
const BASE_DAY = addDays(todayInSchoolTz(), 1);
const day = (offset: number): string => addDays(BASE_DAY, offset);

const FAMILY_KEYS = [
  'id',
  'type',
  'name',
  'description',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'class_ids',
  'counts_as_working_day',
].sort();

const PARENT_USER_ID = '00000000-0000-4000-8000-0000072a0001';
const STUDENT_USER_ID = '00000000-0000-4000-8000-0000072a0002';
const PARENT_EMAIL = 'calendar-vis-parent@e2e.example';
const STUDENT_EMAIL = 'calendar-vis-student@e2e.example';

/**
 * E2E tests for [17.5.1] — the family allow-list DTO and the visibility
 * rule it sits on top of (`visibilityWhere` + the draft filter in
 * `CalendarEventsService`). PARENT/STUDENT/TEACHER responses must contain
 * exactly the allow-listed keys, and never a class/audience/draft they're
 * not entitled to.
 */
describe('Calendar Visibility E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let parentToken: string;
  let studentToken: string;
  let teacherToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const CLASS_1_ID = SEED_CLASS_1_ID; // parent + student child #1, teacher mapped
  const CLASS_2_ID = SEED_CLASS_2_ID; // parent child #2, teacher NOT mapped
  let CLASS_3_ID: string; // nobody's class — the "not a third" negative case

  let academicYearId: string;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);

    // Reuse the seed academic year rather than creating a separate one —
    // `CLASS_1_ID`/`CLASS_2_ID` below alias the seeded classes, which
    // already belong to `SEED_ACADEMIC_YEAR_ID`; a class must belong to
    // the same academic year as the event it's linked to
    // (`CalendarEventsService.assertClassesInTenant`), so `CLASS_3_ID`
    // has to land in that same year too, not a fresh/mismatched one.
    academicYearId = SEED_ACADEMIC_YEAR_ID;

    const classRes = await dataSource.query(
      `INSERT INTO classes (id, name, tenant_id, academic_year_id, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Calendar Visibility E2E Class 3', '${TENANT_ID}', $1, NOW(), NOW())
       RETURNING id`,
      [academicYearId],
    );
    CLASS_3_ID = classRes[0].id;

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Calendar Vis Parent', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Calendar Vis Student', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [STUDENT_USER_ID, STUDENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, TENANT_ID, UserRole.PARENT],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [STUDENT_USER_ID, TENANT_ID, UserRole.STUDENT],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(PARENT_EMAIL);
    studentToken = await login(STUDENT_EMAIL);
  }, 60000);

  afterAll(async () => {
    await dataSource.query(
      `DELETE FROM user_tenants WHERE user_id = '${SEED_ADMIN_USER_ID}' AND tenant_id = '${TENANT_ID}' AND role = '${UserRole.TEACHER}'`,
    );
    await app.close();
  });

  beforeEach(async () => {
    // Reseeded per test, same pattern as attendance-summary.e2e-spec.ts:
    // "transactional" tables get fresh rows so tests don't interfere.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    teacherToken = await login(SEED_ADMIN_EMAIL);

    const teacherId = randomUUID();
    // `teachers.staff_profile_id` is NOT NULL ([36.1.1]) — this raw insert
    // bypasses TypeORM (so `TeacherStaffProfileSubscriber` doesn't fire),
    // hence the `staff_profiles` CTE. `SEED_ADMIN_USER_ID` is reused across
    // many e2e specs, so `ON CONFLICT (tenant_id, user_id)` reuses its profile instead
    // of erroring on the second file to run.
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $4::uuid, 'EMP-E2E-' || $1, NOW(), NOW())
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, $3, '{}', $4::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, SEED_ADMIN_USER_ID, `E2E-VIS-TEACHER-${teacherId.slice(0, 8)}`, TENANT_ID],
    );
    // TEACHER is mapped to section 1 (class 1) only, not section 2 (class 2).
    await dataSource.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), teacherId, SEED_SECTION_1_ID, TENANT_ID],
    );

    // Two children for the PARENT, one in each of class 1 and class 2.
    const child1Res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Vis Child One', $1, 1, $2, $3, 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [`VIS-E2E-REG-1-${randomUUID().slice(0, 8)}`, SEED_SECTION_1_ID, TENANT_ID],
    );
    const child1Id = child1Res[0].id;
    const child2Res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Vis Child Two', $1, 2, $2, $3, 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [`VIS-E2E-REG-2-${randomUUID().slice(0, 8)}`, SEED_SECTION_2_ID, TENANT_ID],
    );
    const child2Id = child2Res[0].id;

    const guardianRes = await dataSource.query(
      `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                              preferred_communication, is_primary_contact, created_at, updated_at)
       VALUES ('Vis Guardian', 'FATHER', '+8801700000001', 'calendar-vis-guardian@e2e.example',
               $1, $2, 'SMS', true, NOW(), NOW())
       RETURNING id`,
      [TENANT_ID, PARENT_USER_ID],
    );
    const guardianId = guardianRes[0].id;
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2), ($3, $2)`,
      [child1Id, guardianId, child2Id],
    );

    // The STUDENT-role user is the account behind child #1 (class 1 only).
    await dataSource.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [
      STUDENT_USER_ID,
      child1Id,
    ]);
  });

  async function createEvent(body: Record<string, unknown>): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/calendar/events`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send(body)
      .expect(201);
    return res.body.id;
  }

  describe('FamilyCalendarEventDto shape', () => {
    it('PARENT response contains exactly the allow-listed keys', async () => {
      const eventId = await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Exam Class 1',
        start_date: day(0),
        end_date: day(0),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_1_ID],
      });

      const res = await supertest(app.getHttpServer())
        .get(`${API}/calendar/events/${eventId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual(FAMILY_KEYS);
      expect(res.body).not.toHaveProperty('audience');
      expect(res.body).not.toHaveProperty('created_by');
      expect(res.body).not.toHaveProperty('external_refs');
      expect(res.body).not.toHaveProperty('published');
      expect(res.body).not.toHaveProperty('is_locked');
    });

    it('staff (ADMIN) response keeps the full DTO', async () => {
      const eventId = await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Exam Staff Full',
        start_date: day(1),
        end_date: day(1),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_1_ID],
      });

      const res = await supertest(app.getHttpServer())
        .get(`${API}/calendar/events/${eventId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body).toHaveProperty('audience');
      expect(res.body).toHaveProperty('is_locked');
      expect(res.body).toHaveProperty('published');
    });
  });

  describe('visibility matrix', () => {
    it('PARENT with children in two classes sees both classes’ exams and not a third', async () => {
      await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Exam A (class 1)',
        start_date: day(2),
        end_date: day(2),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_1_ID],
      });
      await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Exam B (class 2)',
        start_date: day(3),
        end_date: day(3),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_2_ID],
      });
      await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Exam C (class 3, unrelated)',
        start_date: day(4),
        end_date: day(4),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_3_ID],
      });

      const res = await supertest(app.getHttpServer())
        .get(`${API}/calendar/events`)
        .query({ from: day(2), to: day(11) })
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(200);

      const names = res.body.data.map((e: { name: string }) => e.name).sort();
      expect(names).toEqual(['Vis Exam A (class 1)', 'Vis Exam B (class 2)']);
    });

    it('STUDENT sees only their own class', async () => {
      await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Student Exam Class 1',
        start_date: day(5),
        end_date: day(5),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_1_ID],
      });
      await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Student Exam Class 2',
        start_date: day(6),
        end_date: day(6),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_2_ID],
      });

      const res = await supertest(app.getHttpServer())
        .get(`${API}/calendar/events`)
        .query({ from: day(2), to: day(11) })
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(200);

      const names = res.body.data.map((e: { name: string }) => e.name);
      expect(names).toEqual(['Vis Student Exam Class 1']);
    });

    // `CalendarAudience` only has two values (ALL, STAFF), and
    // `visibilityWhere` puts both in `teacherAudiences` — a TEACHER sees
    // every ALL- and STAFF-audience event unconditionally, regardless of
    // class. The `classScopeExists` OR-branch never actually narrows a
    // TEACHER's visibility with today's two-value audience enum; it only
    // matters for PARENT/STUDENT, who are restricted to `audience = ALL`.
    // (Plan correction: the issue body's "only mapped classes' scoped
    // events" does not hold against `calendar-visibility.util.ts`'s
    // current, already-tested rule — see `calendar-visibility.util.spec.ts`.)
    it('TEACHER sees every STAFF- and ALL-audience event regardless of class, draft excluded', async () => {
      const staffEventId = await createEvent({
        type: CalendarEventType.MEETING,
        name: 'Vis Staff Meeting',
        start_date: day(7),
        end_date: day(7),
        audience: CalendarAudience.STAFF,
      });
      await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Teacher Exam Mapped Class',
        start_date: day(8),
        end_date: day(8),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_1_ID],
      });
      await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Teacher Exam Unmapped Class',
        start_date: day(9),
        end_date: day(9),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_2_ID],
      });

      const res = await supertest(app.getHttpServer())
        .get(`${API}/calendar/events`)
        .query({ from: day(2), to: day(11) })
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);

      const names = res.body.data.map((e: { name: string }) => e.name).sort();
      expect(names).toEqual([
        'Vis Staff Meeting',
        'Vis Teacher Exam Mapped Class',
        'Vis Teacher Exam Unmapped Class',
      ]);

      // STAFF event must also be individually fetchable and stripped down.
      const single = await supertest(app.getHttpServer())
        .get(`${API}/calendar/events/${staffEventId}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);
      expect(Object.keys(single.body).sort()).toEqual(FAMILY_KEYS);
    });

    it('drafts are invisible to PARENT, STUDENT, and TEACHER', async () => {
      const draftId = await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Draft Exam',
        start_date: day(10),
        end_date: day(10),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_1_ID],
        publish: false,
      });

      for (const [token, role] of [
        [parentToken, UserRole.PARENT],
        [studentToken, UserRole.STUDENT],
        [teacherToken, UserRole.TEACHER],
      ] as const) {
        const res = await supertest(app.getHttpServer())
          .get(`${API}/calendar/events`)
          .query({ from: day(2), to: day(11), include_drafts: 'true' })
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', role)
          .expect(200);
        const ids = res.body.data.map((e: { id: string }) => e.id);
        expect(ids).not.toContain(draftId);

        await supertest(app.getHttpServer())
          .get(`${API}/calendar/events/${draftId}`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', role)
          .expect(404);
      }
    });

    it('a forged class_id query cannot surface a cross-family/class event for PARENT', async () => {
      await createEvent({
        type: CalendarEventType.EXAM,
        name: 'Vis Forged Class Exam',
        start_date: day(11),
        end_date: day(11),
        audience: CalendarAudience.ALL,
        class_ids: [CLASS_3_ID],
      });

      const res = await supertest(app.getHttpServer())
        .get(`${API}/calendar/events`)
        .query({ from: day(2), to: day(11), class_id: CLASS_3_ID })
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });
  });
});

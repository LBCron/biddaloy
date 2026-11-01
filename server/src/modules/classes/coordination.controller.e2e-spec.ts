import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AlertSeverity, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { NOTIFY_NOBODY } from './coordination.service';

/**
 * [83.3.2] `GET /coordination/overview` and `POST /coordination/alerts`.
 *
 * Fixture: class X (sections A, B) and class Y (section A), current year. Maths teacher in X-A,
 * Bangla teacher in X-B, a third teacher in Y-A. One DRAFT exam per class (Maths + Bangla) whose
 * last sitting is before DATE. X-A's day register is FINALIZED on DATE; X-B's is not.
 * The seed admin user doubles as the coordinator (a TEACHER membership + a teachers row).
 */
const API = '/api/v1';
const DATE = '2026-10-20';

describe('Coordination E2E (83.3.2)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  const extraRoles = [UserRole.TEACHER, UserRole.EXECUTIVE, UserRole.ACCOUNTANT];
  const tag = randomUUID().slice(0, 6);
  let classX: string;
  let classY: string;
  let secXA: string;
  let secXB: string;
  let secYA: string;
  const userIds: string[] = [];
  let mathsUser: string;
  let banglaUser: string;
  let yUser: string;
  let coordTeacherId: string;
  let maths: string;
  let bangla: string;

  const as = (role: UserRole, tenantId: string | null = SEED_TENANT_ID) => ({
    get: (path: string) => {
      const r = supertest(app.getHttpServer())
        .get(`${API}${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Role', role);
      return tenantId === null ? r : r.set('X-Tenant-ID', tenantId);
    },
    post: (path: string) => {
      const r = supertest(app.getHttpServer())
        .post(`${API}${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Role', role);
      return tenantId === null ? r : r.set('X-Tenant-ID', tenantId);
    },
  });
  const teacher = as(UserRole.TEACHER);

  const q = <T = { id: string }>(sql: string, params: unknown[]) =>
    ds.query(sql, params) as Promise<T[]>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    for (const role of extraRoles) {
      await q(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    await q(`UPDATE academic_years SET is_current = (id = $2) WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
      SEED_ACADEMIC_YEAR_ID,
    ]);
    const mkClass = async (name: string) =>
      (
        await q(
          `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, $2, $3) RETURNING id`,
          [SEED_TENANT_ID, `${name} ${tag}`, SEED_ACADEMIC_YEAR_ID],
        )
      )[0].id;
    const mkSection = async (classId: string, name: string) =>
      (
        await q(
          `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, $3) RETURNING id`,
          [SEED_TENANT_ID, classId, name],
        )
      )[0].id;
    classX = await mkClass('Coord X');
    classY = await mkClass('Coord Y');
    secXA = await mkSection(classX, 'A');
    secXB = await mkSection(classX, 'B');
    secYA = await mkSection(classY, 'A');
    const mkUser = async (name: string) => {
      const [u] = await q(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`coord-${name}-${tag}@e2e.example`, SEED_ADMIN_PASSWORD_HASH, `${name} Teacher`],
      );
      await q(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, 'TEACHER', NOW(), NOW())`,
        [u.id, SEED_TENANT_ID],
      );
      userIds.push(u.id);
      return u.id;
    };
    mathsUser = await mkUser('Maths');
    banglaUser = await mkUser('Bangla');
    yUser = await mkUser('Ylass');
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = res.body.access_token;
  }, 120000);

  // teachers, subjects, tcs, exams, sessions, alerts and coordinator rows reset per test.
  beforeEach(async () => {
    const teacherRepo = ds.getRepository(Teacher);
    const mkTeacher = async (userId: string) =>
      (
        await teacherRepo.save({
          user_id: userId,
          employee_id: `EMP-CO-${randomUUID().slice(0, 8)}`,
          tenant_id: SEED_TENANT_ID,
          designations: [],
        })
      ).id;
    coordTeacherId = await mkTeacher(SEED_ADMIN_USER_ID);
    const tMaths = await mkTeacher(mathsUser);
    const tBangla = await mkTeacher(banglaUser);
    const tY = await mkTeacher(yUser);
    const mkSubject = async (name: string) =>
      (
        await q(
          `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, $2, $3) RETURNING id`,
          [SEED_TENANT_ID, name, `${name.slice(0, 3).toUpperCase()}${randomUUID().slice(0, 5)}`],
        )
      )[0].id;
    maths = await mkSubject('Mathematics');
    bangla = await mkSubject('Bangla');
    const tcs = (teacherId: string, sectionId: string, type: string, subjectId: string | null) =>
      q(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [teacherId, sectionId, SEED_TENANT_ID, subjectId, type],
      );
    await tcs(tMaths, secXA, 'CLASS_TEACHER', null);
    await tcs(tMaths, secXA, 'SUBJECT_TEACHER', maths);
    await tcs(tBangla, secXB, 'SUBJECT_TEACHER', bangla);
    await tcs(tY, secYA, 'SUBJECT_TEACHER', maths);
    for (const classId of [classX, classY]) {
      const [exam] = await q(
        `INSERT INTO exams (tenant_id, academic_year_id, class_id, name, kind, status)
         VALUES ($1, $2, $3, 'Term 1', 'TERM', 'DRAFT') RETURNING id`,
        [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, classId],
      );
      for (const [i, subjectId] of [maths, bangla].entries()) {
        await q(
          `INSERT INTO exam_components (tenant_id, exam_id, subject_id, name, kind, full_marks, sequence)
           VALUES ($1, $2, $3, 'Written', 'WRITTEN', 100, $4)`,
          [SEED_TENANT_ID, exam.id, subjectId, i],
        );
        await q(
          `INSERT INTO exam_schedules (tenant_id, exam_id, subject_id, date, starts_at, ends_at)
           VALUES ($1, $2, $3, '2026-10-01', '10:00', '12:00')`,
          [SEED_TENANT_ID, exam.id, subjectId],
        );
      }
    }
    await q(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date, period_no, state, marked_by_user_id, marked_at, finalized_at)
       VALUES ($1, $2, $3, NULL, 'FINALIZED', $4, NOW(), NOW())`,
      [SEED_TENANT_ID, secXA, DATE, mathsUser],
    );
  });

  afterAll(async () => {
    if (ds) {
      await q(`DELETE FROM class_sections WHERE class_id = ANY($1)`, [[classX, classY]]);
      await q(`DELETE FROM classes WHERE id = ANY($1)`, [[classX, classY]]);
      await q(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [userIds]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
      await q(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = ANY($3)`, [
        SEED_ADMIN_USER_ID,
        SEED_TENANT_ID,
        extraRoles,
      ]);
    }
    await app?.close();
  });

  const coordinate = (classId: string, subjectId: string | null = null) =>
    q(
      `INSERT INTO coordinator_assignments (tenant_id, teacher_id, class_id, subject_id) VALUES ($1, $2, $3, $4)`,
      [SEED_TENANT_ID, coordTeacherId, classId, subjectId],
    );

  describe('GET /coordination/overview', () => {
    it('a TEACHER without coordinator rows gets an empty overview (D25)', async () => {
      const res = await teacher.get(`/coordination/overview?date=${DATE}`).expect(200);
      expect(res.body).toEqual({ date: DATE, classes: [] });
    });

    it('class coordinator of X: both sections, B not taken, X grids only, X teachers', async () => {
      await coordinate(classX);
      const res = await teacher.get(`/coordination/overview?date=${DATE}`).expect(200);
      expect(res.body.classes).toHaveLength(1);
      const [x] = res.body.classes;
      expect(x).toMatchObject({ class_id: classX, subject_id: null });
      expect(x.sections).toEqual([
        {
          section_id: secXA,
          section_name: 'A',
          attendance_taken: true,
          taken_by_name: 'Maths Teacher',
          class_teacher_name: 'Maths Teacher',
        },
        {
          section_id: secXB,
          section_name: 'B',
          attendance_taken: false,
          taken_by_name: null,
          class_teacher_name: null,
        },
      ]);
      // Two sections × two subjects, no grid submitted: four pending, none of class Y.
      expect(x.pending_grids).toHaveLength(4);
      expect(x.pending_grids.every((g: { section_id: string }) => g.section_id !== secYA)).toBe(
        true,
      );
      const maths = x.pending_grids.find(
        (g: { section_id: string; subject_name: string }) =>
          g.section_id === secXA && g.subject_name === 'Mathematics',
      );
      expect(maths.teacher_name).toBe('Maths Teacher');
      expect(x.teachers.map((t: { full_name: string }) => t.full_name).sort()).toEqual([
        'Bangla Teacher',
        'Maths Teacher',
      ]);
    });

    it('subject coordinator (Mathematics, X): only maths grids and maths teachers', async () => {
      await coordinate(classX, maths);
      const res = await teacher.get(`/coordination/overview?date=${DATE}`).expect(200);
      const [x] = res.body.classes;
      expect(x.subject_name).toBe('Mathematics');
      expect(x.pending_grids).toHaveLength(2);
      expect(x.pending_grids.every((g: { subject_id: string }) => g.subject_id === maths)).toBe(
        true,
      );
      expect(x.teachers.map((t: { full_name: string }) => t.full_name)).toEqual(['Maths Teacher']);
    });

    it('a bad date is 400', async () => {
      await teacher.get('/coordination/overview?date=31-10-2026').expect(400);
    });

    it('ADMIN, EXECUTIVE and ACCOUNTANT are 403 (TEACHER only, D25)', async () => {
      for (const role of [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT]) {
        await as(role).get('/coordination/overview').expect(403);
        await as(role)
          .post('/coordination/alerts')
          .send({ userIds: [mathsUser], message: 'Hi' })
          .expect(403);
      }
    });

    it('missing X-Tenant-ID is 401; a garbage one is refused', async () => {
      await as(UserRole.TEACHER, null).get('/coordination/overview').expect(401);
      const bad = await as(UserRole.TEACHER, 'not-a-tenant').get('/coordination/overview');
      expect([400, 401, 403]).toContain(bad.status);
    });
  });

  describe('POST /coordination/alerts', () => {
    it('drops a teacher outside the slice and sends a REMINDER to the rest (D8, D24)', async () => {
      await coordinate(classX);
      const res = await teacher
        .post('/coordination/alerts')
        .send({ userIds: [mathsUser, yUser], message: 'Please submit marks by Thursday.' })
        .expect(201);
      expect(res.body.recipient_count).toBe(1);
      const [alert] = await q<{ severity: string; title: string; body: string }>(
        `SELECT severity, manual_title AS title, manual_body AS body FROM alerts WHERE id = $1`,
        [res.body.alert_id],
      );
      expect(alert.severity).toBe(AlertSeverity.REMINDER);
      expect(alert.title).toContain('Coord X');
      expect(alert.body).toBe('Please submit marks by Thursday.');
      const recipients = await q<{ user_id: string }>(
        `SELECT user_id FROM alert_recipients WHERE alert_id = $1`,
        [res.body.alert_id],
      );
      // Class Y's teacher never receives it: the coordinator cannot reach outside the slice.
      expect(recipients.map((r) => r.user_id)).toEqual([mathsUser]);
    });

    it('everyone outside the slice is 422 with one fixed sentence', async () => {
      await coordinate(classX);
      const res = await teacher
        .post('/coordination/alerts')
        .send({ userIds: [yUser], message: 'Hi' })
        .expect(422);
      expect(res.body.message).toBe(NOTIFY_NOBODY);
      expect(JSON.stringify(res.body)).not.toContain(yUser);
    });

    it('a TEACHER with no rows cannot notify anyone (422)', async () => {
      await teacher
        .post('/coordination/alerts')
        .send({ userIds: [mathsUser], message: 'Hi' })
        .expect(422);
    });

    it('201 user ids or an empty message is 400', async () => {
      const many = Array.from({ length: 201 }, () => randomUUID());
      await teacher.post('/coordination/alerts').send({ userIds: many, message: 'x' }).expect(400);
      await teacher
        .post('/coordination/alerts')
        .send({ userIds: [mathsUser], message: '' })
        .expect(400);
    });

    it('the same Idempotency-Key twice sends one alert', async () => {
      await coordinate(classX);
      const key = `coord-${randomUUID()}`;
      const send = () =>
        teacher
          .post('/coordination/alerts')
          .set('Idempotency-Key', key)
          .send({ userIds: [banglaUser], message: 'Bangla marks please.' })
          .expect(201);
      const first = await send();
      const second = await send();
      expect(second.body).toEqual(first.body);
      const [{ n }] = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM alerts WHERE tenant_id = $1 AND source = 'MANUAL' AND manual_body = $2`,
        [SEED_TENANT_ID, 'Bangla marks please.'],
      );
      expect(n).toBe(1);
    });
  });
});

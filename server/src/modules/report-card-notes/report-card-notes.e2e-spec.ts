import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [70.3.1] Report-card notes over HTTP: closed by default (no token, missing / invalid
 * X-Tenant-ID, a guardian), non-UUID ids are 400, a class teacher reaches only their own section
 * (another teacher gets 404, Rule 2), office reads and saves any section, and a published exam
 * is locked with a fixed 409 (D28).
 */
const API = '/api/v1';
const UNKNOWN = '00000000-0000-4000-8000-00000000f00d';
// Pinned: a token with no X-Tenant-ID is refused with this status.
const MISSING_TENANT_STATUS = 401;
const FULL = { discipline: 'A', neatness: 'B', punctuality: 'A', sports: 'C' };

describe('[70.3.1] Report card notes routes', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens = new Map<string, string>();
  let teacherToken: string;
  let strangerToken: string;
  let examId: string;
  let studentId: string;

  const http = () => supertest(app.getHttpServer());
  const bearer = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': SEED_TENANT_ID,
  });
  const as = (role: string) => bearer(tokens.get(role)!);
  const codeOf = (body: any): string | undefined =>
    body.details?.code ?? body.message?.details?.code;

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(role: UserRole): Promise<{ email: string; id: string }> {
    const id = randomUUID();
    const email = `rcn-${role.toLowerCase()}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'RCN E2E', 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, SEED_TENANT_ID, role],
    );
    return { email, id };
  }

  /** A teacher row for the user; `homeroomSection` makes them its class teacher. */
  async function addTeacher(
    userId: string,
    homeroomSection: string | null,
    type: 'CLASS_TEACHER' | 'ASSISTANT_CLASS_TEACHER' = 'CLASS_TEACHER',
  ): Promise<void> {
    const teacherId = randomUUID();
    await ds.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-RCN-' || $4, NOW(), NOW())
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'RCN-' || $4, '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, userId, SEED_TENANT_ID, teacherId.slice(0, 8)],
    );
    if (homeroomSection) {
      await ds.query(
        `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, assignment_type, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
        [teacherId, homeroomSection, SEED_TENANT_ID, type],
      );
    }
  }

  const mine = (sectionId = SEED_SECTION_1_ID) =>
    `${API}/my-class/sections/${sectionId}/report-card-notes`;
  const target = () => `exam_id=${examId}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    tokens.set(UserRole.ADMIN, await login(SEED_ADMIN_EMAIL));
    tokens.set(UserRole.PARENT, await login((await addUser(UserRole.PARENT)).email));
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  /** Seeded fresh per test: the suite wipes tenant data between tests. */
  beforeEach(async () => {
    examId = (
      await ds.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'RCN E2E Term', 'TERM', 'PROCESSED', $3, NOW(), NOW()) RETURNING id`,
        [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, SEED_TENANT_ID],
      )
    )[0].id;
    studentId = (
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                               date_of_birth, gender, enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ('RCN Student', $1, $2, $3, $4, '2012-01-01', 'MALE', 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          `RCN-${randomUUID().slice(0, 10)}`,
          Math.floor(Math.random() * 1000000),
          SEED_SECTION_1_ID,
          SEED_TENANT_ID,
        ],
      )
    )[0].id;
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, enrollment_status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
      [studentId, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    // Users and teachers are wiped too, so these are made per test.
    const t = await addUser(UserRole.TEACHER);
    await addTeacher(t.id, SEED_SECTION_1_ID);
    teacherToken = await login(t.email);
    const s = await addUser(UserRole.TEACHER);
    await addTeacher(s.id, null);
    strangerToken = await login(s.email);
  });

  const routes = () => [
    { m: 'get', url: `${mine()}?${target()}` },
    { m: 'get', url: `${mine()}/missing?${target()}` },
    { m: 'put', url: `${mine()}?${target()}` },
    { m: 'get', url: `${API}/exams/${examId}/report-card-notes?section_id=${SEED_SECTION_1_ID}` },
    { m: 'get', url: `${API}/exams/${examId}/report-card-notes/missing` },
    { m: 'put', url: `${API}/exams/${examId}/report-card-notes?section_id=${SEED_SECTION_1_ID}` },
    {
      m: 'get',
      url: `${API}/final-results/${UNKNOWN}/report-card-notes?section_id=${SEED_SECTION_1_ID}`,
    },
    { m: 'get', url: `${API}/final-results/${UNKNOWN}/report-card-notes/missing` },
    {
      m: 'put',
      url: `${API}/final-results/${UNKNOWN}/report-card-notes?section_id=${SEED_SECTION_1_ID}`,
    },
  ];

  it('every route refuses a request with no token (401)', async () => {
    for (const r of routes()) {
      await (http() as any)[r.m](r.url).set('X-Tenant-ID', SEED_TENANT_ID).send({}).expect(401);
    }
  });

  it('every route refuses a missing or invalid X-Tenant-ID', async () => {
    const token = `Bearer ${tokens.get(UserRole.ADMIN)}`;
    for (const r of routes()) {
      const missing = await (http() as any)[r.m](r.url).set('Authorization', token).send({});
      expect(missing.status, `${r.m} ${r.url}`).toBe(MISSING_TENANT_STATUS);
      const invalid = await (http() as any)
        [r.m](r.url)
        .set({ Authorization: token, 'X-Tenant-ID': 'not-a-uuid' })
        .send({});
      expect(invalid.status, `${r.m} ${r.url}`).toBe(401);
      expect(JSON.stringify(invalid.body)).not.toContain('not-a-uuid');
    }
  });

  it('a guardian (PARENT) is refused 403 on every route', async () => {
    for (const r of routes()) {
      const res = await (http() as any)[r.m](r.url).set(as(UserRole.PARENT)).send({});
      expect(res.status, `${r.m} ${r.url}`).toBe(403);
    }
  });

  it('a TEACHER is refused 403 on the office routes (no RESULT_PROCESS)', async () => {
    await http()
      .get(`${API}/exams/${examId}/report-card-notes?section_id=${SEED_SECTION_1_ID}`)
      .set(bearer(teacherToken))
      .expect(403);
  });

  it('a non-UUID path id, section or query id is 400, never 500', async () => {
    await http()
      .get(`${API}/my-class/sections/nope/report-card-notes?${target()}`)
      .set(bearer(teacherToken))
      .expect(400);
    await http()
      .get(`${API}/exams/nope/report-card-notes?section_id=${SEED_SECTION_1_ID}`)
      .set(as(UserRole.ADMIN))
      .expect(400);
    await http()
      .get(`${API}/final-results/nope/report-card-notes/missing`)
      .set(as(UserRole.ADMIN))
      .expect(400);
    await http()
      .get(`${API}/exams/${examId}/report-card-notes?section_id=nope`)
      .set(as(UserRole.ADMIN))
      .expect(400);
    await http()
      .get(`${API}/exams/${examId}/report-card-notes`)
      .set(as(UserRole.ADMIN))
      .expect(400);
  });

  it('class teacher: reads the grid, saves, and sees it again', async () => {
    const get = await http().get(`${mine()}?${target()}`).set(bearer(teacherToken)).expect(200);
    expect(get.body.locked).toBe(false);
    expect(get.body.rows.map((r: any) => r.student_id)).toEqual([studentId]);

    const put = await http()
      .put(`${mine()}?${target()}`)
      .set(bearer(teacherToken))
      .send({ notes: [{ student_id: studentId, remark: 'Keep it up', conduct: FULL }] })
      .expect(200);
    expect(put.body).toEqual({ changed: 1 });

    const again = await http().get(`${mine()}?${target()}`).set(bearer(teacherToken)).expect(200);
    expect(again.body.rows[0]).toMatchObject({ remark: 'Keep it up', conduct: FULL });
    const missing = await http()
      .get(`${mine()}/missing?${target()}`)
      .set(bearer(teacherToken))
      .expect(200);
    expect(missing.body).toEqual({ total: 1, missing_remark: 0, missing_conduct: 0 });
  });

  it("Rule 2: a teacher who is not this section's class teacher gets 404 on read and write", async () => {
    await http().get(`${mine()}?${target()}`).set(bearer(strangerToken)).expect(404);
    await http().get(`${mine()}/missing?${target()}`).set(bearer(strangerToken)).expect(404);
    await http()
      .put(`${mine()}?${target()}`)
      .set(bearer(strangerToken))
      .send({ notes: [] })
      .expect(404);
    // The class teacher asking about a section they do not have is the same 404.
    await http()
      .get(`${mine(UNKNOWN)}?${target()}`)
      .set(bearer(teacherToken))
      .expect(404);
  });

  it('an ASSISTANT class teacher of the section reads and saves too', async () => {
    const a = await addUser(UserRole.TEACHER);
    await addTeacher(a.id, SEED_SECTION_1_ID, 'ASSISTANT_CLASS_TEACHER');
    const token = await login(a.email);
    await http().get(`${mine()}?${target()}`).set(bearer(token)).expect(200);
    await http()
      .put(`${mine()}?${target()}`)
      .set(bearer(token))
      .send({ notes: [{ student_id: studentId, remark: 'Assistant', conduct: {} }] })
      .expect(200);
  });

  it('Rule 2: the class teacher of ANOTHER real section gets 404 and writes nothing', async () => {
    const o = await addUser(UserRole.TEACHER);
    await addTeacher(o.id, SEED_SECTION_2_ID);
    const token = await login(o.email);
    await http().get(`${mine()}?${target()}`).set(bearer(token)).expect(404);
    await http().get(`${mine()}/missing?${target()}`).set(bearer(token)).expect(404);
    await http()
      .put(`${mine()}?${target()}`)
      .set(bearer(token))
      .send({ notes: [{ student_id: studentId, remark: 'Nope', conduct: {} }] })
      .expect(404);
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM report_card_notes`);
    expect(n).toBe(0);
  });

  it('office saves and reads any section through the exam route', async () => {
    const url = `${API}/exams/${examId}/report-card-notes?section_id=${SEED_SECTION_1_ID}`;
    await http()
      .put(url)
      .set(as(UserRole.ADMIN))
      .send({ notes: [{ student_id: studentId, remark: 'Office', conduct: { discipline: 'D' } }] })
      .expect(200);
    const res = await http().get(url).set(as(UserRole.ADMIN)).expect(200);
    expect(res.body.rows[0]).toMatchObject({ remark: 'Office', conduct: { discipline: 'D' } });
  });

  it('validation: long remark, bad grade, unknown key are 400 with fixed text', async () => {
    const put = (body: unknown) =>
      http()
        .put(`${mine()}?${target()}`)
        .set(bearer(teacherToken))
        .send(body as object);
    await put({ notes: [{ student_id: studentId, remark: 'x'.repeat(301), conduct: {} }] }).expect(
      400,
    );
    const grade = await put({
      notes: [{ student_id: studentId, conduct: { discipline: 'ZZZ-secret' } }],
    }).expect(400);
    expect(JSON.stringify(grade.body)).not.toContain('ZZZ-secret');
    const key = await put({
      notes: [{ student_id: studentId, conduct: { 'secret-key': 'A' } }],
    }).expect(400);
    expect(JSON.stringify(key.body)).not.toContain('secret-key');
  });

  it('a published exam is locked: 409 REPORT_CARD_NOTES_LOCKED, then saves again once reopened', async () => {
    const url = `${mine()}?${target()}`;
    const body = { notes: [{ student_id: studentId, remark: 'Late', conduct: {} }] };
    await ds.query(`UPDATE exams SET status = 'PUBLISHED', published_at = NOW() WHERE id = $1`, [
      examId,
    ]);

    const locked = await http().put(url).set(bearer(teacherToken)).send(body).expect(409);
    expect(codeOf(locked.body)).toBe('REPORT_CARD_NOTES_LOCKED');
    const read = await http().get(url).set(bearer(teacherToken)).expect(200);
    expect(read.body.locked).toBe(true);

    await ds.query(`UPDATE exams SET status = 'PROCESSED', published_at = NULL WHERE id = $1`, [
      examId,
    ]);
    await http().put(url).set(bearer(teacherToken)).send(body).expect(200);
  });

  it('exactly one target is required (400) and an unknown exam is 404', async () => {
    await http().get(mine()).set(bearer(teacherToken)).expect(400);
    await http()
      .get(`${mine()}?exam_id=${examId}&final_result_id=${UNKNOWN}`)
      .set(bearer(teacherToken))
      .expect(400);
    await http().get(`${mine()}?exam_id=${UNKNOWN}`).set(bearer(teacherToken)).expect(404);
  });
});

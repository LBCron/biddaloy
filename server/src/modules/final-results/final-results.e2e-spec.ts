import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { ApprovalScope, UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [70.2.1] Final result routes over HTTP: closed by default (no token, wrong tenant, missing or
 * invalid X-Tenant-ID, a role without the permission), non-UUID ids are 400, reopen needs a
 * step-up approval, and the happy path runs create -> edit -> build -> publish -> sms -> reopen.
 */
const API = '/api/v1';
const FR = `${API}/final-results`;
const UNKNOWN = '00000000-0000-4000-8000-00000000f00d';

describe('[70.2.1] Final results routes', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens = new Map<string, string>();
  let otherTenantAdminToken: string;
  let otherTenantId: string;
  let examId: string;
  let studentId: string;
  let subjectId: string;

  const http = () => supertest(app.getHttpServer());
  const as = (role: string) => ({
    Authorization: `Bearer ${tokens.get(role)}`,
    'X-Tenant-ID': SEED_TENANT_ID,
  });
  const codeOf = (body: any): string | undefined =>
    body.details?.code ?? body.message?.details?.code;

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(tenantId: string, role: UserRole): Promise<string> {
    const id = randomUUID();
    const email = `final-${role.toLowerCase()}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Final E2E', 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return email;
  }

  async function issueApprovalToken(scope: string, identifier: string): Promise<string> {
    const { body } = await http()
      .post(`${API}/auth/step-up/otp/request`)
      .set(as(UserRole.ADMIN))
      .send({ identifier, scope })
      .expect(202);
    if (!body.debug?.otp) throw new Error(`step-up OTP was not echoed: ${JSON.stringify(body)}`);
    const verify = await http()
      .post(`${API}/auth/step-up`)
      .set(as(UserRole.ADMIN))
      .send({ identifier, method: 'OTP', otp: body.debug.otp, scope })
      .expect(200);
    return verify.body.approval_token;
  }

  let previousEchoSecrets: string | undefined;

  beforeAll(async () => {
    // The step-up OTP is read back from `debug.otp`, which only exists with echo on.
    previousEchoSecrets = process.env.ACCOUNT_ACCESS_ECHO_SECRETS;
    process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    tokens.set(UserRole.ADMIN, await login(SEED_ADMIN_EMAIL));
    for (const role of [UserRole.EXAM_CONTROLLER, UserRole.TEACHER]) {
      tokens.set(role, await login(await addUser(SEED_TENANT_ID, role)));
    }
    otherTenantId = (
      await ds.query(
        `INSERT INTO schools (name, name_bn, slug) VALUES ($1, 'বিদ্যালয়', $2) RETURNING id`,
        [`Final ${randomUUID()}`, `final-${randomUUID()}`],
      )
    )[0].id;
    otherTenantAdminToken = await login(await addUser(otherTenantId, UserRole.ADMIN));
  }, 120000);

  afterAll(async () => {
    try {
      await app.close();
    } finally {
      if (previousEchoSecrets === undefined) delete process.env.ACCOUNT_ACCESS_ECHO_SECRETS;
      else process.env.ACCOUNT_ACCESS_ECHO_SECRETS = previousEchoSecrets;
    }
  });

  /** One PUBLISHED exam with one stored result, seeded per test (the suite wipes tenant data). */
  beforeEach(async () => {
    examId = (
      await ds.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, published_at, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'Final E2E Term', 'TERM', 'PUBLISHED', NOW(), $3, NOW(), NOW()) RETURNING id`,
        [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, SEED_TENANT_ID],
      )
    )[0].id;
    subjectId = (
      await ds.query(
        `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
         VALUES ('Mathematics', $1, $2, NOW(), NOW()) RETURNING id`,
        [`FR-${randomUUID().slice(0, 8)}`, SEED_TENANT_ID],
      )
    )[0].id;
    await ds.query(
      `INSERT INTO exam_components (exam_id, subject_id, name, kind, source, full_marks, sequence, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Written', 'WRITTEN', 'MANUAL', 100, 1, $3, NOW(), NOW())`,
      [examId, subjectId, SEED_TENANT_ID],
    );
    studentId = (
      await ds.query(
        `INSERT INTO students
           (full_name, registration_number, roll_number, class_section_id, tenant_id,
            enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ('Final Student', $1, $2, $3, $4, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          `FR-${randomUUID().slice(0, 10)}`,
          Math.floor(Math.random() * 1000000),
          SEED_SECTION_1_ID,
          SEED_TENANT_ID,
        ],
      )
    )[0].id;
    // The final's cohort is the class-year's ACTIVE enrollments (D25).
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, enrollment_status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
      [studentId, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    const scaleId = (
      await ds.query(
        `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id, created_at, updated_at)
         VALUES ('NCTB', 1, $1, $2, NOW(), NOW()) RETURNING id`,
        [SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
      )
    )[0].id;
    await ds.query(
      `INSERT INTO grading_bands
         (scale_id, percent_from, percent_to, grade, gpa, is_fail, sequence, tenant_id, created_at, updated_at)
       VALUES ($1, 0, 100, 'A+', 5.00, false, 1, $2, NOW(), NOW())`,
      [scaleId, SEED_TENANT_ID],
    );
    const resultId = (
      await ds.query(
        `INSERT INTO results
           (exam_id, student_id, total_marks, gpa, grade, position, is_fail, section_id,
            grading_scale_id, grading_scale_revision, rule_version, computed_at, published_at,
            tenant_id, created_at, updated_at)
         VALUES ($1, $2, 90.00, 5.00, 'A+', 1, false, $3, $4, 1, 'nctb-v3', NOW(), NOW(), $5, NOW(), NOW())
         RETURNING id`,
        [examId, studentId, SEED_SECTION_1_ID, scaleId, SEED_TENANT_ID],
      )
    )[0].id;
    await ds.query(
      `INSERT INTO result_subjects (result_id, subject_id, obtained, grade, gpa, is_fail, is_fourth_subject, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 90.00, 'A+', 5.00, false, false, $3, NOW(), NOW())`,
      [resultId, subjectId, SEED_TENANT_ID],
    );
  });

  async function createFinal(): Promise<string> {
    const res = await http()
      .post(FR)
      .set(as(UserRole.EXAM_CONTROLLER))
      .send({ class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID })
      .expect(201);
    return res.body.id;
  }

  // ---- closed by default ------------------------------------------------------------------

  /** Every route once, with the verb and the permission-holding role that may call it. */
  const routes = (id: string) =>
    [
      { m: 'get', url: `${FR}?academic_year_id=${SEED_ACADEMIC_YEAR_ID}`, deniedForTeacher: false },
      { m: 'post', url: FR, deniedForTeacher: true },
      { m: 'get', url: `${FR}/${id}`, deniedForTeacher: false },
      { m: 'patch', url: `${FR}/${id}`, deniedForTeacher: true },
      { m: 'delete', url: `${FR}/${id}`, deniedForTeacher: true },
      { m: 'post', url: `${FR}/${id}/build`, deniedForTeacher: true },
      { m: 'post', url: `${FR}/${id}/publish`, deniedForTeacher: true },
      { m: 'post', url: `${FR}/${id}/reopen`, deniedForTeacher: true },
      { m: 'post', url: `${FR}/${id}/sms`, deniedForTeacher: true },
      { m: 'get', url: `${FR}/${id}/rows`, deniedForTeacher: false },
      { m: 'get', url: `${FR}/${id}/students/${studentId}`, deniedForTeacher: false },
    ] as const;

  it('every route refuses a request with no token (401)', async () => {
    for (const r of routes(UNKNOWN)) {
      await (http() as any)[r.m](r.url).set('X-Tenant-ID', SEED_TENANT_ID).send({}).expect(401);
    }
  });

  it('every route refuses a missing or invalid X-Tenant-ID', async () => {
    const token = `Bearer ${tokens.get(UserRole.EXAM_CONTROLLER)}`;
    for (const r of routes(UNKNOWN)) {
      const missing = await (http() as any)[r.m](r.url).set('Authorization', token).send({});
      expect([400, 401, 403]).toContain(missing.status);
      const invalid = await (http() as any)
        [r.m](r.url)
        .set({ Authorization: token, 'X-Tenant-ID': 'not-a-uuid' })
        .send({});
      expect([400, 401, 403]).toContain(invalid.status);
    }
  });

  it('a TEACHER may read but is refused (403) on every write route', async () => {
    for (const r of routes(UNKNOWN)) {
      const res = await (http() as any)[r.m](r.url).set(as(UserRole.TEACHER)).send({});
      if (r.deniedForTeacher) expect(res.status, `${r.m} ${r.url}`).toBe(403);
      else expect(res.status, `${r.m} ${r.url}`).not.toBe(403);
    }
  });

  it("tenant B's admin gets 404 on tenant A's final result, and cannot list its year", async () => {
    const id = await createFinal();
    const other = {
      Authorization: `Bearer ${otherTenantAdminToken}`,
      'X-Tenant-ID': otherTenantId,
    };
    await http().get(`${FR}/${id}`).set(other).expect(404);
    await http().patch(`${FR}/${id}`).set(other).send({ rounding: 'WHOLE' }).expect(404);
    await http().post(`${FR}/${id}/build`).set(other).expect(404);
    await http().get(`${FR}?academic_year_id=${SEED_ACADEMIC_YEAR_ID}`).set(other).expect(404);
  });

  it('a non-UUID :id or :studentId is 400, never a 500', async () => {
    const h = as(UserRole.EXAM_CONTROLLER);
    await http().get(`${FR}/not-a-uuid`).set(h).expect(400);
    await http().patch(`${FR}/not-a-uuid`).set(h).send({}).expect(400);
    await http().delete(`${FR}/not-a-uuid`).set(h).expect(400);
    // `reopen` is left out: ApprovalGuard answers 403 (no approval token) before the pipe runs,
    // the same order the exam reopen route has. It is covered by the test below.
    for (const verb of ['build', 'publish', 'sms']) {
      await http().post(`${FR}/not-a-uuid/${verb}`).set(h).expect(400);
    }
    await http().get(`${FR}/not-a-uuid/rows`).set(h).expect(400);
    await http().get(`${FR}/${UNKNOWN}/students/not-a-uuid`).set(h).expect(400);
    await http().get(`${FR}?academic_year_id=not-a-uuid`).set(h).expect(400);
  });

  it('rows limit is capped at 100', async () => {
    const id = await createFinal();
    await http().get(`${FR}/${id}/rows?limit=101`).set(as(UserRole.EXAM_CONTROLLER)).expect(400);
    await http().get(`${FR}/${id}/rows?limit=100`).set(as(UserRole.EXAM_CONTROLLER)).expect(200);
  });

  it('reopen without a step-up approval is 403', async () => {
    const id = await createFinal();
    await http().post(`${FR}/${id}/reopen`).set(as(UserRole.ADMIN)).expect(403);
  });

  // ---- the whole lifecycle ----------------------------------------------------------------

  it('create -> edit -> build -> publish -> sms -> reopen, with the refusals on the way', async () => {
    const ec = as(UserRole.EXAM_CONTROLLER);
    const id = await createFinal();

    // Pre-filled from the one published TERM exam: 100% to it.
    const detail = await http().get(`${FR}/${id}`).set(ec).expect(200);
    expect(detail.body.status).toBe('DRAFT');
    expect(detail.body.weights).toEqual([
      { exam_id: examId, subject_id: null, share_percent: 100 },
    ]);

    // Shares that do not add up are accepted while editing and refused at build.
    await http()
      .patch(`${FR}/${id}`)
      .set(ec)
      .send({ weights: [{ exam_id: examId, share_percent: 60 }] })
      .expect(200);
    const bad = await http().post(`${FR}/${id}/build`).set(ec).expect(409);
    expect(codeOf(bad.body)).toBe('FINAL_SHARES_NOT_HUNDRED');
    await http()
      .patch(`${FR}/${id}`)
      .set(ec)
      .send({ weights: [{ exam_id: examId, share_percent: 100 }] })
      .expect(200);

    // Publishing before building is refused.
    const early = await http().post(`${FR}/${id}/publish`).set(ec).expect(409);
    expect(codeOf(early.body)).toBe('FINAL_NOT_PROCESSED');

    const built = await http().post(`${FR}/${id}/build`).set(ec).expect(201);
    expect(built.body.processed).toBe(1);
    const rows = await http().get(`${FR}/${id}/rows`).set(ec).expect(200);
    expect(rows.body.total).toBe(1);
    expect(rows.body.data[0]).toMatchObject({ total_marks: 90, grade: 'A+', position: 1 });

    // Editing a built result drops it back to a draft: it must be rebuilt before publishing.
    const edit = await http().patch(`${FR}/${id}`).set(ec).send({ rounding: 'WHOLE' }).expect(200);
    expect(edit.body.status).toBe('DRAFT');
    const stale = await http().post(`${FR}/${id}/publish`).set(ec).expect(409);
    expect(codeOf(stale.body)).toBe('FINAL_NOT_PROCESSED');
    await http().post(`${FR}/${id}/build`).set(ec).expect(201);

    // SMS before publishing is refused.
    await http().post(`${FR}/${id}/sms`).set(ec).set('Idempotency-Key', randomUUID()).expect(409);

    await http().post(`${FR}/${id}/publish`).set(ec).expect(201);
    // Published means no more edits and no delete until reopened.
    const locked = await http()
      .patch(`${FR}/${id}`)
      .set(ec)
      .send({ rounding: 'WHOLE' })
      .expect(409);
    expect(codeOf(locked.body)).toBe('FINAL_NOT_DRAFT');
    await http().delete(`${FR}/${id}`).set(ec).expect(409);
    const card = await http().get(`${FR}/${id}/students/${studentId}`).set(ec).expect(200);
    expect(card.body.final).toMatchObject({ total_marks: 90, grade: 'A+' });
    expect(card.body.subjects).toHaveLength(1);
    // The student has no guardian with a phone: nothing queued, the skip is reported.
    const sms = await http()
      .post(`${FR}/${id}/sms`)
      .set(ec)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(sms.body.queued).toBe(0);
    expect(sms.body.skipped).toEqual([{ student_id: studentId, reason: 'no_reachable_guardian' }]);

    const approval = await issueApprovalToken(ApprovalScope.RESULTS_REOPEN, SEED_ADMIN_EMAIL);
    await http()
      .post(`${FR}/${id}/reopen`)
      .set(as(UserRole.ADMIN))
      .set('X-Approval-Token', approval)
      .expect(201);
    const reopened = await http().get(`${FR}/${id}`).set(ec).expect(200);
    expect(reopened.body.status).toBe('PROCESSED');
    expect(reopened.body.published_at).toBeNull();
  });

  it('an exam used by a final result cannot be deleted (409 EXAM_IN_USE)', async () => {
    const ec = as(UserRole.EXAM_CONTROLLER);
    const id = await createFinal();
    // A second exam with no results of its own, so only the share row stands in the way.
    const spare = (
      await ds.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'Spare Exam', 'OTHER', 'DRAFT', $3, NOW(), NOW()) RETURNING id`,
        [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, SEED_TENANT_ID],
      )
    )[0].id;
    await http()
      .patch(`${FR}/${id}`)
      .set(ec)
      .send({
        weights: [
          { exam_id: examId, share_percent: 50 },
          { exam_id: spare, share_percent: 50 },
        ],
      })
      .expect(200);
    const res = await http().delete(`${API}/exams/${spare}`).set(as(UserRole.ADMIN)).expect(409);
    expect(codeOf(res.body)).toBe('EXAM_IN_USE');
    // Once the share row is gone the exam can be deleted again.
    await http()
      .patch(`${FR}/${id}`)
      .set(ec)
      .send({ weights: [{ exam_id: examId, share_percent: 100 }] })
      .expect(200);
    await http().delete(`${API}/exams/${spare}`).set(as(UserRole.ADMIN)).expect(200);
  });

  it('POST create with the same Idempotency-Key twice replays one answer (Rule 25)', async () => {
    const ec = as(UserRole.EXAM_CONTROLLER);
    const body = { class_id: SEED_CLASS_1_ID, academic_year_id: SEED_ACADEMIC_YEAR_ID };
    const key = randomUUID();
    const first = await http().post(FR).set(ec).set('Idempotency-Key', key).send(body).expect(201);
    const second = await http().post(FR).set(ec).set('Idempotency-Key', key).send(body).expect(201);
    // The second call is the stored first answer, not a second create.
    expect(second.body.id).toBe(first.body.id);
    const [{ n }] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM final_results WHERE class_id = $1 AND deleted_at IS NULL`,
      [SEED_CLASS_1_ID],
    );
    expect(n).toBe(1);
    // Without the key a repeat is the one-per-class-and-year 409.
    const dup = await http().post(FR).set(ec).send(body).expect(409);
    expect(codeOf(dup.body)).toBe('FINAL_ALREADY_EXISTS');
  });

  it('POST sms needs an Idempotency-Key, and the same key twice sends once (Rule 25, D8)', async () => {
    const ec = as(UserRole.EXAM_CONTROLLER);
    // A guardian with a phone, so the first send really queues one message.
    const [{ id: guardianId }] = await ds.query(
      `INSERT INTO guardians (full_name, relationship, phone, tenant_id)
       VALUES ('Final Guardian', 'FATHER', '01712345678', $1) RETURNING id`,
      [SEED_TENANT_ID],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      studentId,
      guardianId,
    ]);
    const id = await createFinal();
    await http().post(`${FR}/${id}/build`).set(ec).expect(201);
    await http().post(`${FR}/${id}/publish`).set(ec).expect(201);

    // No key: refused before anything is sent.
    await http().post(`${FR}/${id}/sms`).set(ec).expect(400);

    const key = randomUUID();
    const first = await http()
      .post(`${FR}/${id}/sms`)
      .set(ec)
      .set('Idempotency-Key', key)
      .expect(201);
    expect(first.body.queued).toBe(1);
    // The repeat is the stored first answer: no second run (a second run would say already_sent).
    const second = await http()
      .post(`${FR}/${id}/sms`)
      .set(ec)
      .set('Idempotency-Key', key)
      .expect(201);
    expect(second.body).toEqual(first.body);
    const [{ n }] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM communication_logs WHERE tenant_id = $1 AND reference_key LIKE $2`,
      [SEED_TENANT_ID, `final-result:${id}:%`],
    );
    expect(n).toBe(1);
  });

  it('the year list shows the class as not set up, then with its status', async () => {
    const ec = as(UserRole.EXAM_CONTROLLER);
    const before = await http()
      .get(`${FR}?academic_year_id=${SEED_ACADEMIC_YEAR_ID}`)
      .set(ec)
      .expect(200);
    const line = before.body.find((l: any) => l.class.id === SEED_CLASS_1_ID);
    expect(line).toMatchObject({ status: 'NOT_SET_UP', final_result_id: null });
    const id = await createFinal();
    const after = await http()
      .get(`${FR}?academic_year_id=${SEED_ACADEMIC_YEAR_ID}`)
      .set(ec)
      .expect(200);
    expect(after.body.find((l: any) => l.class.id === SEED_CLASS_1_ID)).toMatchObject({
      status: 'DRAFT',
      final_result_id: id,
    });
  });
});

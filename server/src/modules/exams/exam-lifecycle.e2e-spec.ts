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
 * [ACAD-05] A PUBLISHED exam is locked: delete is refused while results
 * exist, component writes are refused until the results are reopened (the
 * step-up approved, audited route), and `full_marks` can never drop below
 * an entered mark.
 */
const API = '/api/v1';

describe('[ACAD-05] Exam lifecycle guards', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens = new Map<string, string>();
  let otherTenantAdminToken: string;
  let otherTenantId: string;

  let examId: string;
  let componentId: string;

  const http = () => supertest(app.getHttpServer());
  const as = (role: string) => ({
    Authorization: `Bearer ${tokens.get(role)}`,
    'X-Tenant-ID': SEED_TENANT_ID,
  });
  // The error body nests `details` differently across filters; accept both.
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
    const email = `lifecycle-${role.toLowerCase()}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Lifecycle E2E', 'ACTIVE', NOW(), NOW())`,
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
    if (!body.debug?.otp) {
      throw new Error(`step-up OTP was not echoed: ${JSON.stringify(body)}`);
    }
    const verify = await http()
      .post(`${API}/auth/step-up`)
      .set(as(UserRole.ADMIN))
      .send({ identifier, method: 'OTP', otp: body.debug.otp, scope })
      .expect(200);
    return verify.body.approval_token;
  }

  let previousEchoSecrets: string | undefined;

  beforeAll(async () => {
    // `issueApprovalToken` reads the OTP back from `debug.otp`, which only exists with echo on.
    // CI does not set it for this job; other specs set it on the shared worker process, so
    // without this line the test passed or failed depending on which file ran first.
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
        [`Lifecycle ${randomUUID()}`, `lifecycle-${randomUUID()}`],
      )
    )[0].id;
    otherTenantAdminToken = await login(await addUser(otherTenantId, UserRole.ADMIN));
  }, 120000);

  afterAll(async () => {
    try {
      await app.close();
    } finally {
      // Put the flag back so later files on this worker do not inherit it.
      if (previousEchoSecrets === undefined) delete process.env.ACCOUNT_ACCESS_ECHO_SECRETS;
      else process.env.ACCOUNT_ACCESS_ECHO_SECRETS = previousEchoSecrets;
    }
  });

  /** The suite wipes tenant data between tests, so the fixture is seeded per test. */
  beforeEach(async () => {
    examId = (
      await ds.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, published_at, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'Lifecycle Exam', 'TERM', 'PUBLISHED', NOW(), $3, NOW(), NOW()) RETURNING id`,
        [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, SEED_TENANT_ID],
      )
    )[0].id;
    const subjectId = (
      await ds.query(
        `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
         VALUES ('Mathematics', $1, $2, NOW(), NOW()) RETURNING id`,
        [`LC-${randomUUID().slice(0, 8)}`, SEED_TENANT_ID],
      )
    )[0].id;
    componentId = (
      await ds.query(
        `INSERT INTO exam_components (exam_id, subject_id, name, kind, source, full_marks, sequence, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'Written', 'WRITTEN', 'MANUAL', 100, 1, $3, NOW(), NOW()) RETURNING id`,
        [examId, subjectId, SEED_TENANT_ID],
      )
    )[0].id;
    const studentId = (
      await ds.query(
        `INSERT INTO students
           (full_name, registration_number, roll_number, class_section_id, tenant_id,
            enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ('Lifecycle Student', $1, $2, $3, $4, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          `LC-${randomUUID().slice(0, 10)}`,
          Math.floor(Math.random() * 1000000),
          SEED_SECTION_1_ID,
          SEED_TENANT_ID,
        ],
      )
    )[0].id;
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
    await ds.query(
      `INSERT INTO results
         (exam_id, student_id, total_marks, gpa, grade, position, is_fail,
          grading_scale_id, grading_scale_revision, rule_version, computed_at, published_at,
          tenant_id, created_at, updated_at)
       VALUES ($1, $2, 90.00, 5.00, 'A+', 1, false, $3, 1, 'nctb-v1', NOW(), NOW(), $4, NOW(), NOW())`,
      [examId, studentId, scaleId, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO marks (exam_id, student_id, subject_id, component_id, value, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 90.00, 'PRESENT', $5, NOW(), NOW())`,
      [examId, studentId, subjectId, componentId, SEED_TENANT_ID],
    );
  });

  const patchComponent = (headers: Record<string, string>, body: object, id = examId) =>
    http().patch(`${API}/exams/${id}/components/${componentId}`).set(headers).send(body);

  it('DELETE /exams/:id on a PUBLISHED exam is 409 EXAM_HAS_RESULTS and results stay readable', async () => {
    const res = await http().delete(`${API}/exams/${examId}`).set(as(UserRole.ADMIN)).expect(409);
    expect(codeOf(res.body)).toBe('EXAM_HAS_RESULTS');
    const [{ count }] = await ds.query(
      `SELECT COUNT(*)::int AS count FROM results WHERE exam_id = $1 AND deleted_at IS NULL`,
      [examId],
    );
    expect(count).toBe(1);
    const [{ deleted }] = await ds.query(
      `SELECT (deleted_at IS NOT NULL) AS deleted FROM exams WHERE id = $1`,
      [examId],
    );
    expect(deleted).toBe(false);
  });

  it('PATCH component on a PUBLISHED exam is 409 EXAM_PUBLISHED', async () => {
    const res = await patchComponent(as(UserRole.ADMIN), { name: 'Theory' }).expect(409);
    expect(codeOf(res.body)).toBe('EXAM_PUBLISHED');
  });

  it('an EXAM_CONTROLLER gets the same 409 (not a bypass)', async () => {
    const res = await patchComponent(as(UserRole.EXAM_CONTROLLER), { name: 'Theory' }).expect(409);
    expect(codeOf(res.body)).toBe('EXAM_PUBLISHED');
  });

  it('a TEACHER gets 403', async () => {
    await patchComponent(as(UserRole.TEACHER), { name: 'Theory' }).expect(403);
  });

  it("tenant B's admin on tenant A's exam gets 404", async () => {
    await patchComponent(
      { Authorization: `Bearer ${otherTenantAdminToken}`, 'X-Tenant-ID': otherTenantId },
      { name: 'Theory' },
    ).expect(404);
  });

  it('after reopen, a component edit succeeds; full_marks below an entered mark is 400', async () => {
    const approval = await issueApprovalToken(ApprovalScope.RESULTS_REOPEN, SEED_ADMIN_EMAIL);
    await http()
      .post(`${API}/exams/${examId}/results/reopen`)
      .set(as(UserRole.ADMIN))
      .set('X-Approval-Token', approval)
      .expect(201);

    const low = await patchComponent(as(UserRole.ADMIN), { full_marks: '50' }).expect(400);
    expect(codeOf(low.body)).toBe('FULL_MARKS_BELOW_ENTERED');

    await patchComponent(as(UserRole.ADMIN), { name: 'Theory' }).expect(200);
  });

  describe('GET /exams?status= (notice "failed last exam" picker)', () => {
    /** 100 DRAFT exams newer than the fixture's PUBLISHED one: they fill the whole first page. */
    const fillPageWithDrafts = () =>
      ds.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
         SELECT $1, $2, 'Draft ' || g, 'TERM', 'DRAFT', $3, NOW() + interval '1 minute', NOW()
           FROM generate_series(1, 100) g`,
        [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, SEED_TENANT_ID],
      );

    it('status=PUBLISHED filters before the page: an older published exam is still found', async () => {
      await fillPageWithDrafts();
      // without the filter the published exam falls off the 100-row page
      const all = await http().get(`${API}/exams?limit=100`).set(as(UserRole.ADMIN)).expect(200);
      expect(all.body.data.map((e: any) => e.id)).not.toContain(examId);

      const res = await http()
        .get(`${API}/exams?limit=100&status=PUBLISHED`)
        .set(as(UserRole.ADMIN))
        .expect(200);
      expect(res.body.data.map((e: any) => e.id)).toContain(examId);
      expect(res.body.data.every((e: any) => e.status === 'PUBLISHED')).toBe(true);
      // the partial-list hint reads this total, so it counts published exams only
      const [{ c }] = await ds.query(
        `SELECT count(*)::int c FROM exams WHERE tenant_id = $1 AND status = 'PUBLISHED' AND deleted_at IS NULL`,
        [SEED_TENANT_ID],
      );
      expect(res.body.total).toBe(c);
    });

    it('an unknown status is 400 and the message does not echo it', async () => {
      const res = await http()
        .get(`${API}/exams?status=NOPE_${randomUUID().slice(0, 6)}`)
        .set(as(UserRole.ADMIN))
        .expect(400);
      expect(JSON.stringify(res.body)).not.toContain('NOPE_');
    });

    it('missing, foreign or malformed X-Tenant-ID is 401', async () => {
      const auth = { Authorization: `Bearer ${tokens.get(UserRole.ADMIN)}` };
      await http().get(`${API}/exams?status=PUBLISHED`).set(auth).expect(401);
      for (const tenant of ['00000000-0000-4000-8000-00000000dead', 'not-a-uuid']) {
        await http()
          .get(`${API}/exams?status=PUBLISHED`)
          .set({ ...auth, 'X-Tenant-ID': tenant })
          .expect(401);
      }
    });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { ReportLayoutType, ReportRunStatus, ReportSubjectArea, UserRole } from '@biddaloy/shared';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { AppModule } from '../../app.module';
import { buildValidationPipeOptions } from '../../validation-pipe';

/**
 * [8.15.24] The report-engine routes over real HTTP, with real roles. Business rules proved here:
 * who may open, run, export and design; that no response carries SQL; that a run is private to
 * whoever started it; and that a saved report is only found by the roles it was made for.
 */
describe('Report engine routes E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let otherToken: string;
  let bigSchool: string;
  const suffix = Date.now().toString(36);

  const http = () => supertest(app.getHttpServer());
  const as = (role: UserRole, req: supertest.Test, token = adminToken, tenant = SEED_TENANT_ID) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', tenant).set('X-Role', role);
  const binary = (res: supertest.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  const studentsDefinition = (field = 'name') => ({
    schema: 1,
    subjectArea: ReportSubjectArea.STUDENTS,
    parameters: [],
    dataset: { dimensions: [{ field }], measures: [], filters: [], sort: [{ field, dir: 'asc' }] },
    layout: { type: ReportLayoutType.TABLE },
    page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
    drill: [],
    calculated: [],
    format: [],
  });

  const create = async (key: string, visible_roles: string[] = []) => {
    const res = await as(
      UserRole.ADMIN,
      http().post('/api/v1/reports/definitions').set('Idempotency-Key', randomUUID()),
    )
      .send({
        key: `${key}-${suffix}`,
        name_en: `Report ${key}`,
        name_bn: `রিপোর্ট ${key}`,
        visible_roles,
        definition: studentsDefinition(),
      })
      .expect(201);
    return res.body.id as string;
  };
  const publish = (id: string) =>
    as(
      UserRole.ADMIN,
      http().post(`/api/v1/reports/definitions/${id}/publish`).set('Idempotency-Key', randomUUID()),
    ).expect(200);

  async function login(email: string): Promise<string> {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
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

    // One user holds every role under test in the seed school (X-Role picks one per request) and
    // admins a second school, made before login so the token carries it.
    for (const role of [
      UserRole.ACCOUNTANT,
      UserRole.TEACHER,
      UserRole.COMMITTEE,
      UserRole.PARENT,
    ]) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    const school = await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Engine Big ${suffix}`,
      `engine-big-${suffix}`,
    ]);
    bigSchool = school[0].id;
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
      [SEED_ADMIN_USER_ID, bigSchool],
    );
    // A second admin of the seed school, to prove a run is private to its owner.
    const [other] = await ds.query(
      `INSERT INTO users (email, full_name, password_hash, status) VALUES ($1, 'Other Admin', $2, 'ACTIVE') RETURNING id`,
      [`other-admin-${suffix}@example.test`, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
      [other.id, SEED_TENANT_ID],
    );
    adminToken = await login(SEED_ADMIN_EMAIL);
    otherToken = await login(`other-admin-${suffix}@example.test`);
  }, 90_000);

  // The suite's setup wipes students and reports before every test, so seed per test.
  beforeEach(async () => {
    for (const name of ['Alpha', 'Beta']) {
      await as(UserRole.ADMIN, http().post('/api/v1/students'))
        .send({ full_name: `${name} ${suffix}`, class_section_id: SEED_SECTION_1_ID })
        .expect(201);
    }
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  describe('who may open what', () => {
    it('anonymous callers get 401', async () => {
      await http().get('/api/v1/reports/catalogue').expect(401);
      await http().get('/api/v1/reports/meta').expect(401);
      await http().post('/api/v1/reports/run').send({}).expect(401);
    });

    it('meta is for the designer only (ADMIN)', async () => {
      await as(UserRole.ADMIN, http().get('/api/v1/reports/meta')).expect(200);
      for (const role of [
        UserRole.ACCOUNTANT,
        UserRole.TEACHER,
        UserRole.COMMITTEE,
        UserRole.PARENT,
      ]) {
        await as(role, http().get('/api/v1/reports/meta')).expect(403);
      }
    });

    it('the catalogue is open to every role that can run reports, and not to a guardian', async () => {
      for (const role of [
        UserRole.ADMIN,
        UserRole.ACCOUNTANT,
        UserRole.TEACHER,
        UserRole.COMMITTEE,
      ]) {
        await as(role, http().get('/api/v1/reports/catalogue')).expect(200);
      }
      await as(UserRole.PARENT, http().get('/api/v1/reports/catalogue')).expect(403);
    });

    it('how a report looks is open to every role that may run it, as the catalogue is', async () => {
      const id = await create('look-open');
      await publish(id);
      const url = `/api/v1/reports/catalogue/${id}/definition`;

      await http().get(url).expect(401);
      for (const role of [
        UserRole.ADMIN,
        UserRole.ACCOUNTANT,
        UserRole.TEACHER,
        UserRole.COMMITTEE,
      ]) {
        const res = await as(role, http().get(url)).expect(200);
        // Only the look: never the dataset, the calculated fields or the draft.
        expect(Object.keys(res.body).sort()).toEqual([
          'drill',
          'format',
          'layout',
          'page',
          'parameters',
          'schema',
          'subjectArea',
          'version_id',
        ]);
        expect(res.body.layout).toEqual({ type: ReportLayoutType.TABLE });
      }
      // A guardian cannot open reports at all.
      await as(UserRole.PARENT, http().get(url)).expect(403);
    });

    it('how a report looks is 404 (never 403) when the role, school, state or id does not fit', async () => {
      const adminsOnly = await create('look-admins', [UserRole.ADMIN]);
      await publish(adminsOnly);
      const draftOnly = await create('look-draft');
      const archived = await create('look-archived');
      await publish(archived);
      await as(
        UserRole.ADMIN,
        http().post(`/api/v1/reports/definitions/${archived}/archive`),
      ).expect(200);
      const look = (id: string) => `/api/v1/reports/catalogue/${id}/definition`;

      // Made for admins only: a teacher and an accountant are told it does not exist.
      await as(UserRole.TEACHER, http().get(look(adminsOnly))).expect(404);
      await as(UserRole.ACCOUNTANT, http().get(look(adminsOnly))).expect(404);
      await as(UserRole.ADMIN, http().get(look(adminsOnly))).expect(200);
      // Not published, archived, and an id nobody has.
      await as(UserRole.ADMIN, http().get(look(draftOnly))).expect(404);
      await as(UserRole.TEACHER, http().get(look(archived))).expect(404);
      await as(UserRole.TEACHER, http().get(look(randomUUID()))).expect(404);
      // Another school's admin does not find the seed school's published report.
      const open = await create('look-tenant');
      await publish(open);
      await as(UserRole.ADMIN, http().get(look(open)), adminToken, bigSchool).expect(404);
      await as(
        UserRole.TEACHER,
        http().get('/api/v1/reports/catalogue/not-a-uuid/definition'),
      ).expect(400);
    });

    it('only ADMIN may create, edit, publish, copy or archive a report', async () => {
      const id = await create('guarded');
      for (const role of [UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.COMMITTEE]) {
        await as(role, http().get('/api/v1/reports/definitions')).expect(403);
        await as(
          role,
          http().post('/api/v1/reports/definitions').set('Idempotency-Key', randomUUID()),
        )
          .send({})
          .expect(403);
        await as(role, http().patch(`/api/v1/reports/definitions/${id}`))
          .send({})
          .expect(403);
        await as(
          role,
          http()
            .post(`/api/v1/reports/definitions/${id}/publish`)
            .set('Idempotency-Key', randomUUID()),
        ).expect(403);
        await as(
          role,
          http()
            .post(`/api/v1/reports/definitions/${id}/clone`)
            .set('Idempotency-Key', randomUUID()),
        ).expect(403);
        await as(role, http().post(`/api/v1/reports/definitions/${id}/archive`)).expect(403);
      }
    });

    it('a non-UUID id is a 400, not a 500', async () => {
      await as(UserRole.ADMIN, http().get('/api/v1/reports/definitions/not-a-uuid')).expect(400);
      await as(UserRole.ADMIN, http().get('/api/v1/reports/runs/not-a-uuid')).expect(400);
    });
  });

  describe('no SQL leaves the server', () => {
    it('meta lists fields with labels and types and nothing of the database', async () => {
      const res = await as(UserRole.ADMIN, http().get('/api/v1/reports/meta')).expect(200);
      const text = JSON.stringify(res.body);
      expect(text).toContain('Student name');
      expect(text).toContain('শিক্ষার্থীর নাম');
      for (const leak of [
        '"sql"',
        '"on"',
        'FROM',
        'JOIN',
        's.full_name',
        'enrollments',
        'tenant_id',
        'tenantVia',
      ]) {
        expect(text).not.toContain(leak);
      }
    });

    it('a run result carries rows and labels, never SQL', async () => {
      const id = await create('nosql');
      await publish(id);
      const res = await as(UserRole.ADMIN, http().post('/api/v1/reports/run'))
        .send({ definitionId: id })
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/SELECT|FROM|tenant_id/);
      expect(res.body.rows.map((r: { name: string }) => r.name)).toEqual([
        `Alpha ${suffix}`,
        `Beta ${suffix}`,
      ]);
    });

    it('an invalid definition is refused with a code and a place, never the value', async () => {
      const res = await as(UserRole.ADMIN, http().post('/api/v1/reports/run'))
        .send({ definition: studentsDefinition("x'; DROP TABLE students;--") })
        .expect(422);
      expect(res.body.details).toEqual({ code: 'UNKNOWN_FIELD', path: 'dataset.dimensions[0]' });
      expect(JSON.stringify(res.body)).not.toContain('DROP');
    });
  });

  describe('running', () => {
    it('previewing an unsaved report is for the designer; an accountant gets 403', async () => {
      await as(UserRole.ADMIN, http().post('/api/v1/reports/run'))
        .send({ definition: studentsDefinition() })
        .expect(200);
      await as(UserRole.ACCOUNTANT, http().post('/api/v1/reports/run'))
        .send({ definition: studentsDefinition() })
        .expect(403);
    });

    it('a saved report runs for the roles it was made for and is not found by the others', async () => {
      const adminsOnly = await create('admins-only', [UserRole.ADMIN]);
      const forTeachers = await create('for-teachers', [UserRole.ADMIN, UserRole.TEACHER]);
      await publish(adminsOnly);
      await publish(forTeachers);

      // A TEACHER is also limited to their own sections: this one teaches none, so no rows.
      await as(UserRole.TEACHER, http().post('/api/v1/reports/run'))
        .send({ definitionId: forTeachers })
        .expect(200);
      await as(UserRole.TEACHER, http().post('/api/v1/reports/run'))
        .send({ definitionId: adminsOnly })
        .expect(404);
      await as(UserRole.ADMIN, http().post('/api/v1/reports/run'))
        .send({ definitionId: adminsOnly })
        .expect(200);
    });

    it('a draft that was never published cannot be run', async () => {
      const draft = await create('draft-only');
      await as(UserRole.ADMIN, http().post('/api/v1/reports/run'))
        .send({ definitionId: draft })
        .expect(404);
    });

    it('COMMITTEE running a report that names a student gets no person-level column', async () => {
      const id = await create('committee');
      await publish(id);
      const res = await as(UserRole.COMMITTEE, http().post('/api/v1/reports/run')).send({
        definitionId: id,
      });
      // The only column is a person's name, which COMMITTEE may not see, so there is nothing to show.
      expect(res.status).toBe(422);
      expect(res.body.details.code).toBe('NOTHING_TO_SHOW');
    });
  });

  describe('exporting', () => {
    it('a saved report comes back as an Excel file with its Bangla heading', async () => {
      const id = await create('export-me');
      await publish(id);
      const res = await as(
        UserRole.ADMIN,
        http().post('/api/v1/reports/runs/export').set('Idempotency-Key', randomUUID()),
      )
        .send({ definitionId: id })
        .buffer()
        .parse(binary)
        .expect(201);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as ExcelJS.Buffer);
      expect(workbook.worksheets[0].getRow(1).values).toEqual([undefined, 'শিক্ষার্থীর নাম']);
      expect(workbook.worksheets[0].rowCount).toBe(3);
    });

    it('a list can be exported only by a role that also reads it; a made-up source is a 404', async () => {
      await as(
        UserRole.ADMIN,
        http().post('/api/v1/reports/runs/export').set('Idempotency-Key', randomUUID()),
      )
        .send({ source: 'students-list', format: 'CSV' })
        .expect(201);
      await as(
        UserRole.ADMIN,
        http().post('/api/v1/reports/runs/export').set('Idempotency-Key', randomUUID()),
      )
        .send({ source: 'secrets-list' })
        .expect(404);
    });

    it('needs REPORTS_EXPORT: a teacher and a committee member get 403', async () => {
      for (const role of [UserRole.TEACHER, UserRole.COMMITTEE]) {
        await as(
          role,
          http().post('/api/v1/reports/runs/export').set('Idempotency-Key', randomUUID()),
        )
          .send({ source: 'students-list' })
          .expect(403);
      }
    });

    it('more than 5,000 rows are queued: 202 and a run id to follow', async () => {
      await ds.query(
        `INSERT INTO audit_logs (id, tenant_id, action, entity_type, created_at)
         SELECT gen_random_uuid(), $1, 'LOGIN', 'User', NOW() FROM generate_series(1, 5001)`,
        [bigSchool],
      );
      const res = await as(
        UserRole.ADMIN,
        http().post('/api/v1/reports/runs/export').set('Idempotency-Key', randomUUID()),
        adminToken,
        bigSchool,
      )
        .send({ source: 'audit-logs-list', format: 'CSV' })
        .expect(202);
      expect(res.body.run_id).toMatch(/^[0-9a-f-]{36}$/);
      expect([ReportRunStatus.QUEUED, ReportRunStatus.RUNNING, ReportRunStatus.FAILED]).toContain(
        res.body.status,
      );
      const [run] = await ds.query(`SELECT tenant_id FROM report_runs WHERE id = $1`, [
        res.body.run_id,
      ]);
      expect(run.tenant_id).toBe(bigSchool);
    });
  });

  describe('a run belongs to whoever started it', () => {
    async function myRun(): Promise<string> {
      const id = await create('mine');
      await publish(id);
      const res = await as(UserRole.ADMIN, http().post('/api/v1/reports/run'))
        .send({ definitionId: id })
        .expect(200);
      return res.body.run_id as string;
    }

    it('shows its status to the owner and a 404 to another user', async () => {
      const runId = await myRun();
      const mine = await as(UserRole.ADMIN, http().get(`/api/v1/reports/runs/${runId}`)).expect(
        200,
      );
      expect(mine.body).toMatchObject({
        id: runId,
        status: 'DONE',
        kind: 'RUN',
        downloadable: false,
      });
      await as(UserRole.ADMIN, http().get(`/api/v1/reports/runs/${runId}`), otherToken).expect(404);
    });

    it("another user's download is a 404, and so is the owner's before the file is ready or after it expired", async () => {
      const runId = await myRun();
      await as(
        UserRole.ADMIN,
        http().get(`/api/v1/reports/runs/${runId}/download`),
        otherToken,
      ).expect(404);
      await as(UserRole.ADMIN, http().get(`/api/v1/reports/runs/${runId}/download`)).expect(404); // not an export
      await ds.query(
        `UPDATE report_runs SET status = 'DONE', storage_key = 'tenants/x/reports/y.csv', expires_at = NOW() - interval '1 hour' WHERE id = $1`,
        [runId],
      );
      await as(UserRole.ADMIN, http().get(`/api/v1/reports/runs/${runId}/download`)).expect(404);
    });

    it('takes one "was this useful?" answer from the owner, and refuses a second and a stranger', async () => {
      const runId = await myRun();
      await as(UserRole.ADMIN, http().post(`/api/v1/reports/runs/${runId}/feedback`), otherToken)
        .send({ helpful: true })
        .expect(404);
      await as(UserRole.ADMIN, http().post(`/api/v1/reports/runs/${runId}/feedback`))
        .send({ helpful: false, comment: 'Too slow to find' })
        .expect(200);
      await as(UserRole.ADMIN, http().post(`/api/v1/reports/runs/${runId}/feedback`))
        .send({ helpful: true })
        .expect(409);
      const [row] = await ds.query(
        `SELECT helpful, feedback_comment FROM report_runs WHERE id = $1`,
        [runId],
      );
      expect(row).toEqual({ helpful: false, feedback_comment: 'Too slow to find' });
    });

    it('a comment over 500 characters is a 400', async () => {
      const runId = await myRun();
      await as(UserRole.ADMIN, http().post(`/api/v1/reports/runs/${runId}/feedback`))
        .send({ helpful: true, comment: 'x'.repeat(501) })
        .expect(400);
    });
  });
});

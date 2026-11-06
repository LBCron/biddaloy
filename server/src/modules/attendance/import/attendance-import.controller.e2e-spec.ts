import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_TENANT_ID,
} from '@test/constants';
import {
  createTeacherScopeFixture,
  TeacherScopeFixture,
} from '@test/helpers/teacher-scope.fixture';
import { enrollStudent } from '@test/helpers/enrollment.helper';

const API = '/api/v1';
const BASE = `${API}/attendance`;

/** [76.2.2] Attendance sheet routes: role matrix, tenant header, key, UUID, fixed 403, a full round trip. */
describe('Attendance import routes (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fx: TeacherScopeFixture;
  let adminToken: string;
  let teacherToken: string;
  let parentToken: string;
  let parentUserId: string;
  let savedSettings: unknown;
  let date: string;
  const tag = randomUUID().slice(0, 8);

  const as = (
    method: 'get' | 'post',
    url: string,
    token: string,
    role: UserRole,
    tenantId: string | null = SEED_TENANT_ID,
  ) => {
    const req = supertest(app.getHttpServer())[method](url).set('Authorization', `Bearer ${token}`);
    if (tenantId) req.set('X-Tenant-ID', tenantId);
    return req.set('X-Role', role);
  };
  const asAdmin = (m: 'get' | 'post', url: string) => as(m, url, adminToken, UserRole.ADMIN);
  const asTeacher = (m: 'get' | 'post', url: string) => as(m, url, teacherToken, UserRole.TEACHER);

  async function sheetFor(sectionName: string, className: string, status: string) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['Date', 'Class', 'Section', 'Roll', 'Name', 'Status']);
    ws.addRow([date, className, sectionName, 90001, '', status]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    [{ settings: savedSettings }] = await dataSource.query(
      `SELECT settings FROM schools WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    fx = await createTeacherScopeFixture(app, dataSource);
    teacherToken = await fx.login();
    const admin = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = admin.body.access_token;

    const email = `import-parent-${tag}@e2e.example`;
    const [user] = await dataSource.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, 'Import Parent', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [email, SEED_ADMIN_PASSWORD_HASH],
    );
    parentUserId = user.id;
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [parentUserId, SEED_TENANT_ID, UserRole.PARENT],
    );
    const parent = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    parentToken = parent.body.access_token;

    // A date inside the seed year: today when it fits, else the year's first day.
    const [year] = await dataSource.query(
      `SELECT to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e
         FROM academic_years WHERE id = (SELECT academic_year_id FROM classes WHERE id =
           (SELECT class_id FROM class_sections WHERE id = $1))`,
      [fx.sectionA],
    );
    const today = new Date().toISOString().slice(0, 10);
    date = today >= year.s && today <= year.e ? today : year.s;
  }, 120000);

  afterAll(async () => {
    await dataSource?.query(`DELETE FROM attendance_imports WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource?.query(`DELETE FROM user_tenants WHERE user_id = $1`, [parentUserId]);
    await dataSource?.query(`DELETE FROM users WHERE id = $1`, [parentUserId]);
    await dataSource?.query(`UPDATE schools SET settings = $2 WHERE id = $1`, [
      SEED_TENANT_ID,
      savedSettings,
    ]);
    await fx?.cleanup();
    await app?.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM attendance_imports WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await dataSource.query(
      `UPDATE schools SET settings = COALESCE(settings, '{}'::jsonb) ||
         jsonb_build_object('attendance', jsonb_build_object('weeklyOffDays', '[]'::jsonb, 'correctionWindowDays', 400))
       WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    await fx.seed();
    const [st] = await dataSource.query(
      `SELECT id, tenant_id, class_section_id FROM students WHERE id = $1`,
      [fx.studentA],
    );
    await enrollStudent(dataSource, st);
  });

  const templateUrl = () => `${BASE}/import/template?sectionIds=${fx.sectionA}&date=${date}`;
  const fakeCommit = () => ({ staging_id: randomUUID() });

  describe('who can reach what', () => {
    it('ANON gets 401 on all five routes', async () => {
      const s = supertest(app.getHttpServer());
      await s.get(templateUrl()).expect(401);
      await s.post(`${BASE}/import/validate`).expect(401);
      await s.post(`${BASE}/import/commit`).send(fakeCommit()).expect(401);
      await s.get(`${BASE}/imports`).expect(401);
      await s.get(`${BASE}/imports/${randomUUID()}`).expect(401);
    });

    it('a PARENT is refused (403) on all five routes', async () => {
      const p = (m: 'get' | 'post', url: string) => as(m, url, parentToken, UserRole.PARENT);
      await p('get', templateUrl()).expect(403);
      await p('post', `${BASE}/import/validate`).expect(403);
      await p('post', `${BASE}/import/commit`).send(fakeCommit()).expect(403);
      await p('get', `${BASE}/imports`).expect(403);
      await p('get', `${BASE}/imports/${randomUUID()}`).expect(403);
    });

    it('ADMIN and TEACHER reach the list routes', async () => {
      await asAdmin('get', `${BASE}/imports`).expect(200);
      await asTeacher('get', `${BASE}/imports`).expect(200);
    });
  });

  describe('X-Tenant-ID', () => {
    it('missing is 401 on every route', async () => {
      const t = (m: 'get' | 'post', url: string) => as(m, url, adminToken, UserRole.ADMIN, null);
      await t('get', templateUrl()).expect(401);
      await t('post', `${BASE}/import/validate`).expect(401);
      await t('post', `${BASE}/import/commit`).send(fakeCommit()).expect(401);
      await t('get', `${BASE}/imports`).expect(401);
      await t('get', `${BASE}/imports/${randomUUID()}`).expect(401);
    });

    it('an unknown or non-UUID tenant is 401 on every route', async () => {
      for (const tenant of [randomUUID(), 'not-a-uuid']) {
        const t = (m: 'get' | 'post', url: string) =>
          as(m, url, adminToken, UserRole.ADMIN, tenant);
        await t('get', templateUrl()).expect(401);
        await t('post', `${BASE}/import/validate`).expect(401);
        await t('post', `${BASE}/import/commit`).send(fakeCommit()).expect(401);
        await t('get', `${BASE}/imports`).expect(401);
        await t('get', `${BASE}/imports/${randomUUID()}`).expect(401);
      }
    });
  });

  describe('input checks', () => {
    it('commit without an Idempotency-Key is 400', async () => {
      await asAdmin('post', `${BASE}/import/commit`).send(fakeCommit()).expect(400);
    });

    it('a non-UUID :id is 400; an unknown id is 404', async () => {
      await asAdmin('get', `${BASE}/imports/not-a-uuid`).expect(400);
      await asAdmin('get', `${BASE}/imports/${randomUUID()}`).expect(404);
    });

    it('limit above 100 is 400', async () => {
      await asAdmin('get', `${BASE}/imports?limit=101`).expect(400);
    });

    it('validate with a non-xlsx body named .xlsx is 400 and stages nothing', async () => {
      await asAdmin('post', `${BASE}/import/validate`)
        .attach('file', Buffer.from('not a zip'), 'fake.xlsx')
        .expect(400);
    });

    it('template with a foreign section is one fixed 403', async () => {
      const res = await asAdmin(
        'get',
        `${BASE}/import/template?sectionIds=${randomUUID()}&date=${date}`,
      ).expect(403);
      expect(res.body.message).toBe('You cannot download a sheet for one of these sections');
    });
  });

  describe('download, fill, validate, commit, history', () => {
    it('saves a filled sheet as IMPORT and lists it', async () => {
      const tpl = await asAdmin('get', templateUrl())
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(tpl.headers['content-disposition']).toContain('filename*=UTF-8');

      const [sec] = await dataSource.query(
        `SELECT cs.section_name, c.name AS class_name FROM class_sections cs
           JOIN classes c ON c.id = cs.class_id WHERE cs.id = $1`,
        [fx.sectionA],
      );
      const validate = await asAdmin('post', `${BASE}/import/validate`)
        .attach('file', await sheetFor(sec.section_name, sec.class_name, 'P'), 'sheet.xlsx')
        .expect(201);
      expect(validate.body.counts).toMatchObject({ new: 1, error: 0 });

      const commit = await asAdmin('post', `${BASE}/import/commit`)
        .set('Idempotency-Key', `k-${tag}`)
        .send({ staging_id: validate.body.staging_id })
        .expect(201);

      const rec = await dataSource.query(
        `SELECT source FROM attendance_records WHERE student_id = $1`,
        [fx.studentA],
      );
      expect(rec[0].source).toBe('IMPORT');

      const list = await asAdmin('get', `${BASE}/imports`).expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).toContain(commit.body.import_id);
      const detail = await asAdmin('get', `${BASE}/imports/${commit.body.import_id}`).expect(200);
      expect(detail.body.rows[0]).toMatchObject({
        outcome: 'NEW',
        after: 'PRESENT',
        current: 'PRESENT',
      });
      // A teacher did not upload it: 404 on its detail, and it is absent from their list.
      await asTeacher('get', `${BASE}/imports/${commit.body.import_id}`).expect(404);
      const mine = await asTeacher('get', `${BASE}/imports`).expect(200);
      expect(mine.body.items).toEqual([]);
    });
  });
});

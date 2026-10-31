import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { ReportLayoutType, ReportSubjectArea, UserRole } from '@biddaloy/shared';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { AppModule } from '../../app.module';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { buildValidationPipeOptions } from '../../validation-pipe';

/**
 * [8.15.45] Schedules, kept copies, the dashboard tile and the platform usage page over real HTTP.
 * Business rules proved here: who may call what (allowed AND denied); a schedule, run or report of
 * another school is a plain 404; bad times, days, roles and limits are 400 and a client can never
 * send a cron; the tile has at most 50 rows and one number; its cache key carries the school; and
 * the usage page is for the platform SUPER_ADMIN alone and holds counts only.
 */
describe('Report delivery routes E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fx: ReportAreaFixture;
  let adminToken: string;
  let platformToken: string;
  let localSuperToken: string;
  let platformId: string;
  let otherSchool: string;
  const suffix = Date.now().toString(36);
  const LOCAL_SUPER = { id: randomUUID(), email: `local-sa-${suffix}@report-delivery.example` };
  const PLATFORM_USER = {
    id: randomUUID(),
    email: `platform-sa-${suffix}@report-delivery.example`,
  };

  const http = () => supertest(app.getHttpServer());
  const as = (role: UserRole, req: supertest.Test, tenant = SEED_TENANT_ID) =>
    req.set('Authorization', `Bearer ${adminToken}`).set('X-Tenant-ID', tenant).set('X-Role', role);
  const key = () => ({ 'Idempotency-Key': randomUUID() });

  const definitionJson = (
    over: Record<string, unknown> = {},
    subject = ReportSubjectArea.STUDENTS,
  ) => ({
    schema: 1,
    subjectArea: subject,
    parameters: [],
    dataset: {
      dimensions: [{ field: 'name' }],
      measures: [],
      filters: [],
      sort: [{ field: 'name', dir: 'asc' }],
      ...over,
    },
    layout: { type: ReportLayoutType.TABLE },
    page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
    drill: [],
    calculated: [],
    format: [],
  });

  /** A report of the seed school; published unless told not to. */
  const report = async (
    name: string,
    opts: { visible_roles?: string[]; publish?: boolean; definition?: object } = {},
  ) => {
    const res = await as(UserRole.ADMIN, http().post('/api/v1/reports/definitions').set(key()))
      .send({
        key: `${name}-${suffix}-${randomUUID().slice(0, 4)}`,
        name_en: `Report ${name}`,
        name_bn: `রিপোর্ট ${name}`,
        visible_roles: opts.visible_roles ?? [],
        definition: opts.definition ?? definitionJson(),
      })
      .expect(201);
    if (opts.publish !== false) {
      await as(
        UserRole.ADMIN,
        http().post(`/api/v1/reports/definitions/${res.body.id}/publish`).set(key()),
      ).expect(200);
    }
    return res.body.id as string;
  };

  /** The seed school's current year and first section, which already exist. */
  const seedSection = async () => {
    const [y] = await ds.query(
      `SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current`,
      [SEED_TENANT_ID],
    );
    const [c] = await ds.query(`SELECT class_id FROM class_sections WHERE id = $1`, [
      SEED_SECTION_1_ID,
    ]);
    return {
      year: y.id as string,
      six: { classId: c.class_id as string, sectionId: SEED_SECTION_1_ID },
    };
  };

  const goodSchedule = (over: Record<string, unknown> = {}) => ({
    frequency: 'DAILY',
    local_time: '03:15',
    recipient_roles: ['ADMIN', 'ACCOUNTANT'],
    format: 'CSV',
    ...over,
  });
  const schedulesUrl = (id: string) => `/api/v1/reports/definitions/${id}/schedules`;

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
    fx = new ReportAreaFixture(ds);

    // The seed admin holds every role under test (X-Role picks one per request) and admins a second school.
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
    const [school] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Delivery Other ${suffix}`, `delivery-other-${suffix}`],
    );
    otherSchool = school.id;
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
      [SEED_ADMIN_USER_ID, otherSchool],
    );
    // A platform SUPER_ADMIN: SUPER_ADMIN on the platform school.
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       SELECT $1, 'Platform', 'default-school', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM schools WHERE slug = 'default-school')`,
      [randomUUID()],
    );
    platformId = (await ds.query(`SELECT id FROM schools WHERE slug = 'default-school'`))[0].id;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Platform SA', 'ACTIVE', NOW(), NOW())`,
      [PLATFORM_USER.id, PLATFORM_USER.email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1, $2, 'SUPER_ADMIN', NOW(), NOW())`,
      [PLATFORM_USER.id, platformId],
    );
    // A SUPER_ADMIN of an ordinary school (legacy shape) is not the platform.
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Local SA', 'ACTIVE', NOW(), NOW())`,
      [LOCAL_SUPER.id, LOCAL_SUPER.email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1, $2, 'SUPER_ADMIN', NOW(), NOW())`,
      [LOCAL_SUPER.id, SEED_TENANT_ID],
    );
    localSuperToken = await login(LOCAL_SUPER.email);
    adminToken = await login(SEED_ADMIN_EMAIL);
    platformToken = await login(PLATFORM_USER.email);
  }, 90_000);

  afterAll(async () => {
    await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [
      [PLATFORM_USER.id, LOCAL_SUPER.id],
    ]);
    await app.close();
  });

  describe('schedules', () => {
    it('anonymous callers get 401 and only ADMIN may manage schedules (everyone else 403)', async () => {
      const id = await report('guarded');
      await http().get(schedulesUrl(id)).expect(401);
      await http().post(schedulesUrl(id)).send(goodSchedule()).expect(401);
      for (const role of [
        UserRole.ACCOUNTANT,
        UserRole.TEACHER,
        UserRole.COMMITTEE,
        UserRole.PARENT,
      ]) {
        await as(role, http().get(schedulesUrl(id))).expect(403);
        await as(role, http().post(schedulesUrl(id)).set(key()))
          .send(goodSchedule())
          .expect(403);
        await as(role, http().patch(`${schedulesUrl(id)}/${randomUUID()}`))
          .send({})
          .expect(403);
        await as(role, http().delete(`${schedulesUrl(id)}/${randomUUID()}`)).expect(403);
      }
    });

    it('creates, lists, changes, switches off and deletes a schedule', async () => {
      const id = await report('cycle');
      const created = await as(UserRole.ADMIN, http().post(schedulesUrl(id)).set(key()))
        .send(goodSchedule({ frequency: 'WEEKLY', day_of_week: 0 }))
        .expect(201);
      expect(created.body).toMatchObject({
        definition_id: id,
        frequency: 'WEEKLY',
        day_of_week: 0,
        day_of_month: null,
        local_time: '03:15',
        active: true,
        last_run_id: null,
      });
      const list = await as(UserRole.ADMIN, http().get(schedulesUrl(id))).expect(200);
      expect(list.body.map((s: { id: string }) => s.id)).toEqual([created.body.id]);

      const changed = await as(
        UserRole.ADMIN,
        http().patch(`${schedulesUrl(id)}/${created.body.id}`),
      )
        .send({ frequency: 'MONTHLY', day_of_month: 5, active: false })
        .expect(200);
      // A monthly schedule keeps no day of the week.
      expect(changed.body).toMatchObject({
        frequency: 'MONTHLY',
        day_of_month: 5,
        day_of_week: null,
        active: false,
      });

      await as(UserRole.ADMIN, http().delete(`${schedulesUrl(id)}/${created.body.id}`)).expect(204);
      const after = await as(UserRole.ADMIN, http().get(schedulesUrl(id))).expect(200);
      expect(after.body).toEqual([]);
      await as(UserRole.ADMIN, http().delete(`${schedulesUrl(id)}/${created.body.id}`)).expect(404);
    });

    it('refuses bad times, days, roles and a client-sent cron with a 400', async () => {
      const id = await report('validation');
      const bad: Array<Record<string, unknown>> = [
        { local_time: '25:00' },
        { local_time: '8:30' },
        { local_time: '08:60' },
        { frequency: 'WEEKLY', day_of_week: 7 },
        { frequency: 'WEEKLY' }, // a weekly schedule needs its day
        { frequency: 'MONTHLY', day_of_month: 29 },
        { frequency: 'MONTHLY' },
        { frequency: 'HOURLY' },
        { recipient_roles: [] },
        { recipient_roles: ['PARENT'] }, // a guardian cannot get a report
        { recipient_roles: ['NOT_A_ROLE'] },
        { recipient_roles: Array(11).fill('ADMIN') }, // more than 10
        { format: 'PDF' },
        { cron: '* * * * *' }, // never accepted from a client
      ];
      for (const over of bad) {
        await as(UserRole.ADMIN, http().post(schedulesUrl(id)).set(key()))
          .send(goodSchedule(over))
          .expect(400);
      }
    });

    it('refuses a draft report (409) and another school report (404), and a non-UUID id (400)', async () => {
      const draft = await report('draft', { publish: false });
      await as(UserRole.ADMIN, http().post(schedulesUrl(draft)).set(key()))
        .send(goodSchedule())
        .expect(409);
      const id = await report('mine');
      // The same user is ADMIN of another school, but the report is not in that school.
      await as(UserRole.ADMIN, http().post(schedulesUrl(id)).set(key()), otherSchool)
        .send(goodSchedule())
        .expect(404);
      await as(UserRole.ADMIN, http().get(schedulesUrl(id)), otherSchool).expect(404);
      await as(UserRole.ADMIN, http().get(schedulesUrl('not-a-uuid'))).expect(400);
      await as(UserRole.ADMIN, http().patch(`${schedulesUrl(id)}/not-a-uuid`))
        .send({})
        .expect(400);
    });

    it('another school cannot read, change or delete a schedule: always 404, never 403', async () => {
      const id = await report('tenant');
      const created = await as(UserRole.ADMIN, http().post(schedulesUrl(id)).set(key()))
        .send(goodSchedule())
        .expect(201);
      const url = `${schedulesUrl(id)}/${created.body.id}`;
      await as(UserRole.ADMIN, http().patch(url), otherSchool).send({ active: false }).expect(404);
      await as(UserRole.ADMIN, http().delete(url), otherSchool).expect(404);
      // And it is untouched.
      const [row] = await ds.query(`SELECT active FROM report_schedules WHERE id = $1`, [
        created.body.id,
      ]);
      expect(row.active).toBe(true);
      // A schedule id that belongs to a different report of the same school is a 404 as well.
      const other = await report('tenant-two');
      await as(UserRole.ADMIN, http().delete(`${schedulesUrl(other)}/${created.body.id}`)).expect(
        404,
      );
    });
  });

  describe('snapshots', () => {
    it('401 for anonymous; keeping and downloading need REPORTS_EXPORT, the list needs REPORTS_VIEW', async () => {
      await http().get('/api/v1/reports/snapshots').expect(401);
      await http().post(`/api/v1/reports/runs/${randomUUID()}/snapshot`).send({}).expect(401);
      for (const role of [UserRole.TEACHER, UserRole.COMMITTEE, UserRole.PARENT]) {
        await as(role, http().post(`/api/v1/reports/runs/${randomUUID()}/snapshot`).set(key()))
          .send({})
          .expect(403);
        await as(role, http().get(`/api/v1/reports/snapshots/${randomUUID()}/download`)).expect(
          403,
        );
      }
      // A teacher may open the list, which holds nothing for a role that cannot take files out.
      const teacher = await as(UserRole.TEACHER, http().get('/api/v1/reports/snapshots')).expect(
        200,
      );
      expect(teacher.body.items).toEqual([]);
      await as(UserRole.PARENT, http().get('/api/v1/reports/snapshots')).expect(403);
      for (const role of [UserRole.ADMIN, UserRole.ACCOUNTANT]) {
        await as(role, http().get('/api/v1/reports/snapshots')).expect(200);
      }
    });

    it('finds nothing for a run or snapshot that is not yours or not there (404), 400 for bad ids and limits', async () => {
      await as(
        UserRole.ADMIN,
        http().post(`/api/v1/reports/runs/${randomUUID()}/snapshot`).set(key()),
      )
        .send({})
        .expect(404);
      await as(
        UserRole.ADMIN,
        http().get(`/api/v1/reports/snapshots/${randomUUID()}/download`),
      ).expect(404);
      await as(UserRole.ADMIN, http().post('/api/v1/reports/runs/not-a-uuid/snapshot').set(key()))
        .send({})
        .expect(400);
      await as(UserRole.ADMIN, http().get('/api/v1/reports/snapshots/not-a-uuid/download')).expect(
        400,
      );
      for (const limit of ['101', '0', '-1', 'x']) {
        await as(UserRole.ADMIN, http().get(`/api/v1/reports/snapshots?limit=${limit}`)).expect(
          400,
        );
      }
      await as(UserRole.ADMIN, http().get('/api/v1/reports/snapshots?limit=100')).expect(200);
      for (const body of [
        { as_of: '31-10-2026' },
        { as_of: '2026-10-31T00:00' },
        { label: 'x'.repeat(161) },
      ]) {
        await as(
          UserRole.ADMIN,
          http().post(`/api/v1/reports/runs/${randomUUID()}/snapshot`).set(key()),
        )
          .send(body)
          .expect(400);
      }
    });
  });

  describe('dashboard tile', () => {
    const tile = (role: UserRole, id: string, tenant = SEED_TENANT_ID) =>
      as(role, http().get(`/api/v1/dashboard/widgets/report/${id}`), tenant);

    it('shows at most 50 rows, and its cache key carries the school', async () => {
      const { year, six } = await seedSection();
      for (let i = 0; i < 60; i++) {
        await fx.student(SEED_TENANT_ID, year, six, { name: `Tile ${String(i).padStart(3, '0')}` });
      }
      const id = await report('tile');
      const res = await tile(UserRole.ADMIN, id).expect(200);
      expect(res.body.rows).toHaveLength(50);
      expect(res.body.truncated).toBe(true);
      expect(res.body.definition_id).toBe(id);

      const redis = app.get<Redis>(TENANT_STATUS_REDIS);
      const keys = await redis.keys(`tenant:${SEED_TENANT_ID}:report:v1:*`);
      expect(keys.length).toBeGreaterThan(0);
      expect(await redis.keys(`tenant:${otherSchool}:report:v1:*`)).toEqual([]);
      // A tile that refreshes on its own writes no run row (it would inflate the usage numbers).
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM report_runs WHERE tenant_id = $1`,
        [SEED_TENANT_ID],
      );
      expect(n).toBe(0);
    });

    it('keeps the dimensions and the FIRST measure only', async () => {
      const { year, six } = await seedSection();
      const student = await fx.student(SEED_TENANT_ID, year, six, { name: 'Bill Payer' });
      await fx.bill(SEED_TENANT_ID, year, six.classId, student, {
        total: 500,
        status: 'PENDING',
        dueDate: '2026-01-10',
      });
      const id = await report('measures', {
        definition: definitionJson(
          {
            dimensions: [{ field: 'class' }],
            measures: [
              { field: 'bills', fn: 'COUNT' },
              { field: 'overdue_bills', fn: 'COUNT' },
            ],
            sort: [{ field: 'class', dir: 'asc' }],
          },
          ReportSubjectArea.FEES,
        ),
      });
      const res = await tile(UserRole.ADMIN, id).expect(200);
      expect(res.body.columns.map((c: { key: string }) => c.key)).toEqual(['class', 'bills']);
      expect(Object.keys(res.body.rows[0])).toEqual(['class', 'bills']);
    });

    it('is a 404 for a report the role may not see, a draft, another school report or no report; 400 for a bad id', async () => {
      const adminOnly = await report('admin-only', { visible_roles: ['ADMIN'] });
      await tile(UserRole.ADMIN, adminOnly).expect(200);
      await tile(UserRole.ACCOUNTANT, adminOnly).expect(404);
      const draft = await report('tile-draft', { publish: false });
      await tile(UserRole.ADMIN, draft).expect(404);
      await tile(UserRole.ADMIN, adminOnly, otherSchool).expect(404);
      await tile(UserRole.ADMIN, randomUUID()).expect(404);
      await tile(UserRole.ADMIN, 'not-a-uuid').expect(400);
    });

    it('401 for anonymous and 403 for a guardian', async () => {
      const id = await report('tile-roles');
      await http().get(`/api/v1/dashboard/widgets/report/${id}`).expect(401);
      await tile(UserRole.PARENT, id).expect(403);
    });
  });

  describe('platform usage', () => {
    const usage = (query = '') =>
      http()
        .get(`/api/v1/platform/reports/usage${query}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .set('X-Tenant-ID', platformId)
        .set('X-Role', UserRole.SUPER_ADMIN);

    it('only the platform SUPER_ADMIN may read it: anonymous 401, school roles and a school-local SUPER_ADMIN 403', async () => {
      await http().get('/api/v1/platform/reports/usage').expect(401);
      for (const role of [
        UserRole.ADMIN,
        UserRole.ACCOUNTANT,
        UserRole.TEACHER,
        UserRole.COMMITTEE,
      ]) {
        await as(role, http().get('/api/v1/platform/reports/usage')).expect(403);
      }
      // A SUPER_ADMIN of an ordinary school is not the platform.
      await http()
        .get('/api/v1/platform/reports/usage')
        .set('Authorization', `Bearer ${localSuperToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.SUPER_ADMIN)
        .expect(403);
    });

    it('returns counts per report key and the latest comments, and nothing that names a school, person or run', async () => {
      const id = await report('usage');
      const [{ current_version_id: versionId }] = await ds.query(
        `SELECT current_version_id FROM report_definitions WHERE id = $1`,
        [id],
      );
      const run = (over: Record<string, unknown>) =>
        ds.query(
          `INSERT INTO report_runs (tenant_id, definition_version_id, kind, status, row_count, run_by, helpful, feedback_comment, feedback_at, error_code, params)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            SEED_TENANT_ID,
            versionId,
            over.kind ?? 'RUN',
            over.status ?? 'DONE',
            over.rows ?? 10,
            SEED_ADMIN_USER_ID,
            over.helpful ?? null,
            over.comment ?? null,
            over.comment ? new Date() : null,
            over.error ?? null,
            over.params ?? {},
          ],
        );
      await run({ helpful: true, comment: 'Very useful list' });
      await run({ helpful: false });
      await run({ rows: 0 }); // an empty result
      await run({ kind: 'RUN', status: 'FAILED', rows: 0, error: 'REPORT_TOO_SLOW' });
      await run({ kind: 'EXPORT', rows: 6000 }); // a large export
      // A queued export holds its version only in its params.
      await ds.query(
        `INSERT INTO report_runs (tenant_id, kind, status, row_count, run_by, params)
         VALUES ($1, 'EXPORT', 'DONE', 7000, $2, $3)`,
        [SEED_TENANT_ID, SEED_ADMIN_USER_ID, { versionId, role: 'ADMIN', params: {} }],
      );

      const res = await usage().expect(200);
      const row = res.body.reports.find((r: { report_key: string }) => r.report_key === 'custom');
      expect(row).toMatchObject({
        runs: 6,
        schools: 1,
        unique_users: 1,
        helpful_pct: 50,
        too_slow: 1,
        empty_results: 1,
        large_exports: 2,
        latest_comments: ['Very useful list'],
      });
      // Aggregates only: no ids, no school or report names, nothing from the data.
      const text = JSON.stringify(res.body);
      for (const secret of [SEED_TENANT_ID, SEED_ADMIN_USER_ID, versionId, id, 'Report usage']) {
        expect(text).not.toContain(secret);
      }
      expect(Object.keys(row).sort()).toEqual([
        'empty_results',
        'helpful_pct',
        'large_exports',
        'latest_comments',
        'report_key',
        'runs',
        'schools',
        'too_slow',
        'unique_users',
      ]);
    });

    it('refuses a bad or too long date range with a 400', async () => {
      await usage('?from=2026-10-31&to=2026-10-01').expect(400);
      await usage('?from=2024-01-01&to=2026-10-01').expect(400);
      await usage('?from=2026-02-30&to=2026-03-01').expect(400);
      await usage('?from=yesterday').expect(400);
      await usage('?from=2026-10-01&to=2026-10-31').expect(200);
    });
  });
});

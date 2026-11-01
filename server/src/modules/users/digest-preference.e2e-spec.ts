import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import { digestEnabled } from './dto/digest-preference.dto';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * [8.10.7.5.11] PATCH /users/me/preferences/digest — the caller's own morning
 * summary opt-out, stored in users.preferences.digest.enabled.
 */
describe('PATCH /users/me/preferences/digest [8.10.7.5.11]', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const URL = '/api/v1/users/me/preferences/digest';
  // A school the seed admin does NOT belong to.
  const OTHER_TENANT = '00000000-0000-4000-8000-000000191001';

  // Roles the seed admin is given in the seed school, besides ADMIN.
  const EXTRA_ROLES = [
    UserRole.EXECUTIVE,
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
    UserRole.COMMITTEE,
    UserRole.SUPER_ADMIN,
    UserRole.PARENT,
    UserRole.STUDENT,
  ];

  const patch = (role: UserRole, body: unknown, tenant = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .patch(URL)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .set('X-Role', role)
      .send(body as object);

  const readPrefs = async () =>
    (await dataSource.query(`SELECT preferences FROM users WHERE id = $1`, [SEED_ADMIN_USER_ID]))[0]
      .preferences;

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
    dataSource = app.get(DataSource);

    for (const role of EXTRA_ROLES) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Digest Other School', 'digest-other-school', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_TENANT],
    );

    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 60000);

  beforeEach(async () => {
    await dataSource.query(`UPDATE users SET preferences = NULL WHERE id = $1`, [
      SEED_ADMIN_USER_ID,
    ]);
  });

  afterAll(async () => {
    await dataSource.query(`UPDATE users SET preferences = NULL WHERE id = $1`, [
      SEED_ADMIN_USER_ID,
    ]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1 AND role = ANY($2)`, [
      SEED_ADMIN_USER_ID,
      EXTRA_ROLES,
    ]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [OTHER_TENANT]);
    await app.close();
  });

  it('round trip: PATCH returns the value, GET /users/me shows it, dashboard key survives', async () => {
    const dashboard = { TEACHER: { widgets: [{ key: 'my-routine-today' }] } };
    await dataSource.query(`UPDATE users SET preferences = $2::jsonb WHERE id = $1`, [
      SEED_ADMIN_USER_ID,
      JSON.stringify({ dashboard }),
    ]);

    const res = await patch(UserRole.TEACHER, { enabled: false }).expect(200);
    expect(res.body).toEqual({ enabled: false });

    const me = await supertest(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(200);
    expect(me.body.preferences.digest.enabled).toBe(false);
    expect(me.body.preferences.dashboard).toEqual(dashboard);
  });

  it('absent means on: GET /users/me has no digest key before any save', async () => {
    const me = await supertest(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(200);
    expect(digestEnabled(me.body.preferences)).toBe(true);
  });

  it('only the caller row changes (id from the JWT, a body user_id is rejected)', async () => {
    const otherId = '00000000-0000-4000-8000-000000191002';
    await dataSource.query(
      `INSERT INTO users (id, full_name, preferences, created_at, updated_at)
       VALUES ($1, 'Digest Bystander', '{"theme":"dark"}'::jsonb, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET preferences = '{"theme":"dark"}'::jsonb`,
      [otherId],
    );
    const before = (
      await dataSource.query(`SELECT preferences FROM users WHERE id = $1`, [otherId])
    )[0].preferences;

    await patch(UserRole.TEACHER, { enabled: false, user_id: otherId }).expect(400);
    await patch(UserRole.TEACHER, { enabled: false }).expect(200);

    const after = (
      await dataSource.query(`SELECT preferences FROM users WHERE id = $1`, [otherId])
    )[0].preferences;
    expect(after).toEqual(before);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [otherId]);
  });

  describe('role matrix', () => {
    const allowed = [
      UserRole.ADMIN,
      UserRole.EXECUTIVE,
      UserRole.ACCOUNTANT,
      UserRole.TEACHER,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
      UserRole.SUPER_ADMIN,
    ];

    for (const role of allowed) {
      it(`${role} -> 200`, async () => {
        const res = await patch(role, { enabled: false }).expect(200);
        expect(res.body).toEqual({ enabled: false });
      });
    }

    for (const role of [UserRole.PARENT, UserRole.STUDENT]) {
      it(`${role} -> 403, preferences unchanged`, async () => {
        await patch(role, { enabled: false }).expect(403);
        expect(await readPrefs()).toBeNull();
      });
    }
  });

  it('missing X-Tenant-ID -> rejected, row unchanged', async () => {
    const res = await supertest(app.getHttpServer())
      .patch(URL)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', UserRole.TEACHER)
      .send({ enabled: false });
    expect([400, 401, 403]).toContain(res.status);
    expect(await readPrefs()).toBeNull();
  });

  it('invalid X-Tenant-ID -> rejected, row unchanged', async () => {
    const res = await patch(UserRole.TEACHER, { enabled: false }, 'not-a-uuid');
    expect([400, 401, 403]).toContain(res.status);
    expect(await readPrefs()).toBeNull();
  });

  it('a school the caller does not belong to -> rejected by ContextGuard, row unchanged', async () => {
    // ContextGuard answers 401 "User is not a member of the requested tenant" for every route.
    await patch(UserRole.ADMIN, { enabled: false }, OTHER_TENANT).expect(401);
    expect(await readPrefs()).toBeNull();
  });

  it('no token -> 401', async () => {
    await supertest(app.getHttpServer())
      .patch(URL)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ enabled: false })
      .expect(401);
  });

  it.each([{ enabled: 'no' }, { enabled: 1 }, { enabled: true, extra: 1 }, {}])(
    'body %j -> 400, row unchanged',
    async (body) => {
      await patch(UserRole.ADMIN, body).expect(400);
      expect(await readPrefs()).toBeNull();
    },
  );
});

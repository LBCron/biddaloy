import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DashboardWidgetKey, ROLE_DEFAULT_LAYOUTS, UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * [8.10.7.1.02] PATCH /users/me/preferences/dashboard — the active role
 * (X-Role) picks the slot in users.preferences.dashboard.
 */
describe('PATCH /users/me/preferences/dashboard [8.10.7.1.02]', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const URL = '/api/v1/users/me/preferences/dashboard';
  // A school the seed admin does NOT belong to.
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000298';

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
       VALUES ($1, 'Dash Prefs Other School', 'dash-prefs-other-school', NOW(), NOW())
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

  it('round trip: PATCH returns the stored layout and GET /users/me shows it', async () => {
    const body = {
      widgets: [
        { key: DashboardWidgetKey.MY_ROUTINE_TODAY, size: 'L' },
        { key: DashboardWidgetKey.HOMEWORK_TO_CHECK, hidden: true },
      ],
    };

    const res = await patch(UserRole.TEACHER, body).expect(200);
    expect(res.body).toEqual(body);

    const me = await supertest(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(200);
    expect(me.body.preferences.dashboard.TEACHER).toEqual(body);
  });

  it('the active role decides the slot: a TEACHER save leaves ADMIN alone', async () => {
    await patch(UserRole.TEACHER, {
      widgets: [{ key: DashboardWidgetKey.MY_ROUTINE_TODAY }],
    }).expect(200);

    const prefs = await readPrefs();
    expect(Object.keys(prefs.dashboard)).toEqual(['TEACHER']);
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
    ];

    for (const role of allowed) {
      it(`${role} -> 200`, async () => {
        const first = ROLE_DEFAULT_LAYOUTS[role][0];
        const res = await patch(role, { widgets: [{ key: first }] }).expect(200);
        expect(res.body).toEqual({ widgets: [{ key: first }] });
      });
    }

    it('SUPER_ADMIN -> 200 with an empty list', async () => {
      const res = await patch(UserRole.SUPER_ADMIN, { widgets: [] }).expect(200);
      expect(res.body).toEqual({ widgets: [] });
    });

    it('SUPER_ADMIN -> 400 with any key (no widget lists SUPER_ADMIN)', async () => {
      await patch(UserRole.SUPER_ADMIN, {
        widgets: [{ key: DashboardWidgetKey.COLLECTION_MONTH }],
      }).expect(400);
    });

    for (const role of [UserRole.PARENT, UserRole.STUDENT]) {
      it(`${role} -> 403, preferences unchanged`, async () => {
        await patch(role, { widgets: [] }).expect(403);
        expect(await readPrefs()).toBeNull();
      });
    }
  });

  it('a school the caller does not belong to -> rejected by ContextGuard, row unchanged', async () => {
    // ContextGuard answers 401 "User is not a member of the requested tenant" (not 403) for every route.
    await patch(UserRole.ADMIN, { widgets: [] }, OTHER_TENANT).expect(401);
    expect(await readPrefs()).toBeNull();
  });

  it('no token -> 401', async () => {
    await supertest(app.getHttpServer())
      .patch(URL)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ widgets: [] })
      .expect(401);
  });

  it('unknown key -> 400', async () => {
    await patch(UserRole.ADMIN, { widgets: [{ key: 'nope' }] }).expect(400);
  });

  it('a key twice -> 400', async () => {
    const key = DashboardWidgetKey.COLLECTION_MONTH;
    await patch(UserRole.ADMIN, { widgets: [{ key }, { key }] }).expect(400);
  });

  it('a widget not offered to the active role -> 400, row unchanged', async () => {
    await patch(UserRole.TEACHER, {
      widgets: [{ key: DashboardWidgetKey.COLLECTION_MONTH }],
    }).expect(400);
    expect(await readPrefs()).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_SETTINGS_SCHEMA_VERSION } from './dto/tenant-settings.dto';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

const API = '/api/v1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000c7601';
const DENIED_ROLES = [
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

/** [76.1.03] `attendance.dailySource` and `attention.staffSmsFallback` through `PATCH/GET /schools/:id/settings`. */
describe('Attendance source settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;
  const settingsUrl = (id: string) => `${API}/schools/${id}/settings`;

  /** PATCH `schoolId`'s settings as the seeded admin acting in `tenant` (and optionally `role`). */
  const patch = (
    body: Record<string, unknown>,
    opts: { tenant?: string; role?: UserRole; schoolId?: string } = {},
  ) => {
    const tenant = opts.tenant ?? TENANT_ID;
    const req = supertest(app.getHttpServer())
      .patch(settingsUrl(opts.schoolId ?? tenant))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);
    if (opts.role) req.set('X-Role', opts.role);
    return req.send({ version: TENANT_SETTINGS_SCHEMA_VERSION, ...body });
  };
  const get = (tenant = TENANT_ID) =>
    supertest(app.getHttpServer())
      .get(settingsUrl(tenant))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);

  /** The attendance block needs its required fields; reuse the GET payload, source omitted. */
  const attendanceWith = async (extra: Record<string, unknown>) => {
    const { dailySource: _omit, ...rest } = (await get().expect(200)).body.attendance;
    return { ...rest, ...extra };
  };

  const clearStored = () =>
    dataSource.query(
      `UPDATE schools SET settings = jsonb_set(jsonb_set(settings, '{attendance}', COALESCE(settings->'attendance','{}') - 'dailySource'), '{attention}', COALESCE(settings->'attention','{}') - 'staffSmsFallback') WHERE id = ANY($1)`,
      [[TENANT_ID, OTHER_TENANT_ID]],
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other Attendance Source School', 'other-attendance-source-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    // Same user holds every role on the seed tenant so `X-Role` can probe the matrix.
    for (const role of [...DENIED_ROLES, UserRole.SUPER_ADMIN]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, role],
      );
    }

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
    await clearStored();
  }, 60000);

  afterAll(async () => {
    await clearStored();
    // Remove the extra role memberships added in beforeAll so other specs see the seed admin unchanged.
    await dataSource.query(
      `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = ANY($3)`,
      [SEED_ADMIN_USER_ID, TENANT_ID, [...DENIED_ROLES, UserRole.SUPER_ADMIN]],
    );
    await app.close();
  });

  it('defaults to ANY / false, stores CLASS_TEACHER, and a later PATCH keeps it', async () => {
    const d = (await get().expect(200)).body;
    expect(d.attendance.dailySource).toBe('ANY');
    expect(d.attention.staffSmsFallback).toBe(false);

    await patch({
      attendance: await attendanceWith({ dailySource: 'CLASS_TEACHER' }),
      attention: { staffSmsFallback: true },
    }).expect(200);
    // An older form that omits both keys must not wipe them.
    await patch({ attendance: await attendanceWith({ lateAfter: '08:30' }) }).expect(200);
    const g = (await get().expect(200)).body;
    expect(g.attendance.dailySource).toBe('CLASS_TEACHER');
    expect(g.attention.staffSmsFallback).toBe(true);
  });

  it('rejects an unknown source with 400', async () => {
    await patch({ attendance: { dailySource: 'EVERYONE' } }).expect(400);
  });

  it('lets ADMIN change it and denies TEACHER with 403', async () => {
    await patch(
      { attendance: await attendanceWith({ dailySource: 'ANY' }) },
      { role: UserRole.ADMIN },
    ).expect(200);
    await patch({ attendance: { dailySource: 'DEVICE' } }, { role: UserRole.TEACHER }).expect(403);
  });

  it('blocks cross-tenant writes and does not leak values across tenants', async () => {
    await patch(
      { attendance: await attendanceWith({ dailySource: 'DEVICE' }) },
      { tenant: OTHER_TENANT_ID, schoolId: TENANT_ID },
    ).expect(403);
    expect((await get(OTHER_TENANT_ID).expect(200)).body.attendance.dailySource).toBe('ANY');
  });

  it('401s without X-Tenant-ID', async () => {
    await supertest(app.getHttpServer())
      .patch(settingsUrl(TENANT_ID))
      .set('Authorization', `Bearer ${token}`)
      .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, attendance: { dailySource: 'ANY' } })
      .expect(401);
  });
});

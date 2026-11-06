import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const BOGUS_TENANT = '00000000-0000-4000-8000-0000000000ff';

/** [40.1.04] School website: ADMIN-only editing routes and the anonymous by-host read routes. */
describe('Website API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let teacherUserId: string;
  const api = () => supertest(app.getHttpServer());
  const tag = randomUUID().slice(0, 8);

  const admin = (
    method: 'get' | 'put' | 'post',
    path: string,
    o: { tenant?: string | null } = {},
  ) => {
    let r = api()[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);
    r = r.set('X-Role', UserRole.ADMIN);
    const tenant = o.tenant === undefined ? SEED_TENANT_ID : o.tenant;
    if (tenant) r = r.set('X-Tenant-ID', tenant);
    return r;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    adminToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;

    [{ id: teacherUserId }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,'Site Teacher','ACTIVE',NOW(),NOW()) RETURNING id`,
      [`website-teacher-${tag}@e2e.example`, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
      [teacherUserId, SEED_TENANT_ID],
    );
    teacherToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: `website-teacher-${tag}@e2e.example`, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  afterAll(async () => {
    await ds.query(`DELETE FROM user_tenants WHERE user_id = $1`, [teacherUserId]);
    await app.close();
  });

  it('anonymous: unknown host answers 404 site.not_found', async () => {
    const res = await api().get('/api/v1/public/site/by-host/unknown.example/manifest').expect(404);
    expect(res.body.message).toBe('site.not_found');
  });

  it('ADMIN GET /website seeds and returns the site', async () => {
    const res = await admin('get', '/website').expect(200);
    expect(res.body.theme).toBe('basic');
    expect(res.body.enabled).toBe(false);
  });

  it('TEACHER GET /website is 403', async () => {
    await api()
      .get('/api/v1/website')
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Role', UserRole.TEACHER)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('GET /website: missing or foreign X-Tenant-ID is 401', async () => {
    await admin('get', '/website', { tenant: null }).expect(401);
    await admin('get', '/website', { tenant: BOGUS_TENANT }).expect(401);
  });
});

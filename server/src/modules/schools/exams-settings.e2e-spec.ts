import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DEFAULT_CONDUCT_ITEMS, UserRole } from '@biddaloy/shared';
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
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000e7002';
const item = (key: string) => ({ key, name_bn: 'নাম', name_en: 'Name' });

/** [70.2.01] `settings.exams.conductItems` through `PATCH/GET /schools/:id/settings`. */
describe('Exams conduct items settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const TENANT_ID = SEED_TENANT_ID;
  const url = (id: string) => `${API}/schools/${id}/settings`;

  const patch = (body: Record<string, unknown>, tenant = TENANT_ID, schoolId = tenant) =>
    supertest(app.getHttpServer())
      .patch(url(schoolId))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, ...body });
  const get = (tenant = TENANT_ID) =>
    supertest(app.getHttpServer())
      .get(url(tenant))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);
  const clearStored = () =>
    dataSource.query(`UPDATE schools SET settings = settings - 'exams' WHERE id = ANY($1)`, [
      [TENANT_ID, OTHER_TENANT_ID],
    ]);

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
       VALUES ($1, 'Other Exams School', 'other-exams-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    const login = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
    await clearStored();
  }, 60000);

  afterAll(async () => {
    await clearStored();
    await app.close();
  });

  it('a fresh tenant reads the four D30 defaults', async () => {
    expect((await get().expect(200)).body.exams.conductItems).toEqual(DEFAULT_CONDUCT_ITEMS);
  });

  it('PATCH replaces the list and keeps other sections; GET matches', async () => {
    await patch({ studyPlans: { reminderTime: '07:45' } }).expect(200);
    const res = await patch({ exams: { conductItems: [item('honesty'), item('respect')] } }).expect(
      200,
    );
    expect(res.body.exams.conductItems.map((i: { key: string }) => i.key)).toEqual([
      'honesty',
      'respect',
    ]);
    const read = (await get().expect(200)).body;
    expect(read.exams).toEqual(res.body.exams);
    expect(read.studyPlans.reminderTime).toBe('07:45');
  });

  it('duplicate key / 13 items -> 400 with fixed text, stored list unchanged', async () => {
    const before = (await get().expect(200)).body.exams;
    const dup = await patch({ exams: { conductItems: [item('zz_dup'), item('zz_dup')] } }).expect(
      400,
    );
    expect(JSON.stringify(dup.body)).not.toContain('zz_dup');
    const many = Array.from({ length: 13 }, (_, i) => item(`item_${i}`));
    await patch({ exams: { conductItems: many } }).expect(400);
    expect((await get().expect(200)).body.exams).toEqual(before);
  });

  it('is tenant-isolated: cross-tenant write 403, other tenant keeps defaults', async () => {
    const before = (await get().expect(200)).body.exams;
    await patch({ exams: { conductItems: [item('hijack')] } }, OTHER_TENANT_ID, TENANT_ID).expect(
      403,
    );
    expect((await get().expect(200)).body.exams).toEqual(before);
    expect((await get(OTHER_TENANT_ID).expect(200)).body.exams.conductItems).toEqual(
      DEFAULT_CONDUCT_ITEMS,
    );
  });

  it('401s without X-Tenant-ID and rejects a malformed one', async () => {
    await supertest(app.getHttpServer())
      .patch(url(TENANT_ID))
      .set('Authorization', `Bearer ${token}`)
      .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, exams: { conductItems: [item('abc')] } })
      .expect(401);
    const bad = await supertest(app.getHttpServer())
      .get(url(TENANT_ID))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', 'not-a-uuid');
    // context.guard: a tenant id the caller holds no membership in is 401, exactly.
    expect(bad.status).toBe(401);
    expect(JSON.stringify(bad.body)).not.toContain('not-a-uuid');
  });
});

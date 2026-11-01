import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [83.2.2] `/coordinators` over HTTP: CLASS_MANAGE only (ADMIN), the other roles 403, the
 * X-Tenant-ID contract, ParseUUIDPipe, the 50-class cap and the Idempotency-Key replay.
 * The seed admin user holds extra memberships so one token can ask as each role (X-Role).
 */
describe('Coordinators E2E (83.2.2)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let teacherId: string;
  const classIds: string[] = [];
  const extraRoles = [UserRole.TEACHER, UserRole.EXECUTIVE, UserRole.ACCOUNTANT];

  const req = (
    method: 'get' | 'post' | 'delete',
    path: string,
    role: UserRole = UserRole.ADMIN,
    tenantId: string | null = SEED_TENANT_ID,
  ) => {
    const r = supertest(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', role);
    return tenantId === null ? r : r.set('X-Tenant-ID', tenantId);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    for (const role of extraRoles) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `UPDATE academic_years SET is_current = (id = $2) WHERE tenant_id = $1`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID],
    );
    for (const n of [6, 7]) {
      const [c] = await dataSource.query(
        `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, $2, $3) RETURNING id`,
        [SEED_TENANT_ID, `Coord E2E ${n} ${randomUUID().slice(0, 6)}`, SEED_ACADEMIC_YEAR_ID],
      );
      classIds.push(c.id);
    }
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = res.body.access_token;
  }, 60000);

  // `teachers` and `coordinator_assignments` are reset before every test (test/reset-order.ts).
  beforeEach(async () => {
    teacherId = (
      await dataSource.getRepository(Teacher).save({
        user_id: SEED_ADMIN_USER_ID,
        employee_id: `EMP-CE-${randomUUID().slice(0, 8)}`,
        tenant_id: SEED_TENANT_ID,
        designations: [],
      })
    ).id;
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource.query(`DELETE FROM classes WHERE id = ANY($1)`, [classIds]);
      await dataSource.query(
        `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = ANY($3)`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, extraRoles],
      );
    }
    await app?.close();
  });

  describe('ADMIN (CLASS_MANAGE)', () => {
    it('POST 201 with the rows, GET 200 lists them, DELETE 204 removes one', async () => {
      const created = await req('post', '/coordinators').send({ teacherId, classIds }).expect(201);
      expect(created.body).toHaveLength(2);
      const list = await req('get', `/coordinators?teacherId=${teacherId}`).expect(200);
      expect(list.body).toHaveLength(2);
      await req('delete', `/coordinators/${created.body[0].id}`).expect(204);
      const after = await req('get', `/coordinators?classId=${classIds[0]}`).expect(200);
      expect(after.body).toEqual([]);
    });

    it('a duplicate is 409 with one fixed sentence that echoes no id', async () => {
      await req('post', '/coordinators')
        .send({ teacherId, classIds: [classIds[0]] })
        .expect(201);
      const res = await req('post', '/coordinators')
        .send({ teacherId, classIds: [classIds[0]] })
        .expect(409);
      expect(res.body.message).toBe('This coordinator assignment already exists.');
      expect(JSON.stringify(res.body)).not.toContain(classIds[0]);
    });

    it('the same Idempotency-Key twice creates one set of rows', async () => {
      const key = `coord-${randomUUID()}`;
      const first = await req('post', '/coordinators')
        .set('Idempotency-Key', key)
        .send({ teacherId, classIds })
        .expect(201);
      const second = await req('post', '/coordinators')
        .set('Idempotency-Key', key)
        .send({ teacherId, classIds })
        .expect(201);
      expect(second.body).toEqual(first.body);
      const list = await req('get', `/coordinators?teacherId=${teacherId}`).expect(200);
      expect(list.body).toHaveLength(2);
    });

    it('a non-UUID :id is 400 (Rule 3)', async () => {
      await req('delete', '/coordinators/not-a-uuid').expect(400);
    });

    it('51 classes is 400 (ArrayMaxSize 50); an empty list is 400', async () => {
      const many = Array.from({ length: 51 }, () => randomUUID());
      await req('post', '/coordinators').send({ teacherId, classIds: many }).expect(400);
      await req('post', '/coordinators').send({ teacherId, classIds: [] }).expect(400);
    });

    it('an unknown class id is 404', async () => {
      await req('post', '/coordinators')
        .send({ teacherId, classIds: [randomUUID()] })
        .expect(404);
    });
  });

  describe('roles without CLASS_MANAGE', () => {
    it('TEACHER, EXECUTIVE and ACCOUNTANT are 403 on every route', async () => {
      for (const role of extraRoles) {
        await req('get', '/coordinators', role).expect(403);
        await req('post', '/coordinators', role).send({ teacherId, classIds }).expect(403);
        await req('delete', `/coordinators/${randomUUID()}`, role).expect(403);
      }
    });
  });

  describe('X-Tenant-ID', () => {
    it('missing is 401 (ContextGuard); a garbage id is refused, never 2xx or 500', async () => {
      await req('get', '/coordinators', UserRole.ADMIN, null).expect(401);
      const bad = await req('get', '/coordinators', UserRole.ADMIN, 'not-a-tenant');
      expect([400, 401, 403]).toContain(bad.status);
    });
  });
});

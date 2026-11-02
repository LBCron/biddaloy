import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { AppModule } from '../../../app.module';
import { buildValidationPipeOptions } from '../../../validation-pipe';

/**
 * [8.15.35] The statement routes over real HTTP, with real roles. Business rules proved here: staff
 * need both invoice and payment access; a guardian sees only their own child's statement and gets
 * the same 404 for anyone else's.
 */
describe('Student statement E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let ownChild: string;
  let otherChild: string;

  const http = () => supertest(app.getHttpServer());
  const as = (role: UserRole, req: supertest.Test) =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);

  const makeStudent = async (name: string): Promise<string> => {
    const res = await as(UserRole.ADMIN, http().post('/api/v1/students'))
      .send({ full_name: name, class_section_id: SEED_SECTION_1_ID })
      .expect(201);
    return res.body.id as string;
  };

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

    // One user holds every role under test in the seed school; X-Role picks one per request.
    for (const role of [UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.PARENT]) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 90_000);

  // The suite's setup wipes students before every test, so seed per test.
  beforeEach(async () => {
    ownChild = await makeStudent('Own Child');
    otherChild = await makeStudent('Someone Else');
    // The signed-in user is a guardian of the first child only.
    const [guardian] = await ds.query(
      `INSERT INTO guardians (full_name, relationship, phone, tenant_id, user_id, is_primary_contact)
       VALUES ('Parent', 'Father', '01700000000', $1, $2, true) RETURNING id`,
      [SEED_TENANT_ID, SEED_ADMIN_USER_ID],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      ownChild,
      guardian.id,
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('anonymous callers get 401', async () => {
    await http().get(`/api/v1/students/${ownChild}/statement`).expect(401);
    await http().get(`/api/v1/portal/students/${ownChild}/statement`).expect(401);
  });

  it('staff with invoice and payment access can read it; a teacher cannot', async () => {
    const res = await as(
      UserRole.ADMIN,
      http().get(`/api/v1/students/${ownChild}/statement`),
    ).expect(200);
    expect(res.body).toMatchObject({
      student_id: ownChild,
      student_name: 'Own Child',
      closing_balance: 0,
      entries: [],
    });
    await as(UserRole.ACCOUNTANT, http().get(`/api/v1/students/${ownChild}/statement`)).expect(200);
    await as(UserRole.TEACHER, http().get(`/api/v1/students/${ownChild}/statement`)).expect(403);
  });

  it('a guardian cannot use the staff route', async () => {
    await as(UserRole.PARENT, http().get(`/api/v1/students/${ownChild}/statement`)).expect(403);
  });

  it('a guardian reads their own child and gets a 404 for anyone else’s', async () => {
    await as(UserRole.PARENT, http().get(`/api/v1/portal/students/${ownChild}/statement`)).expect(
      200,
    );
    await as(UserRole.PARENT, http().get(`/api/v1/portal/students/${otherChild}/statement`)).expect(
      404,
    );
  });

  it('the portal route is for guardians: staff get 403', async () => {
    await as(UserRole.ADMIN, http().get(`/api/v1/portal/students/${ownChild}/statement`)).expect(
      403,
    );
  });

  it('a student that does not exist is a 404; a non-UUID id is a 400; a bad date is a 400', async () => {
    await as(
      UserRole.ADMIN,
      http().get('/api/v1/students/00000000-0000-4000-8000-0000000000ff/statement'),
    ).expect(404);
    await as(UserRole.ADMIN, http().get('/api/v1/students/not-a-uuid/statement')).expect(400);
    await as(
      UserRole.ADMIN,
      http().get(`/api/v1/students/${ownChild}/statement?from=yesterday`),
    ).expect(400);
  });
});

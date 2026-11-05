import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
} from '@test/constants';

/**
 * [#1364] Guard-level proof of how the three new roles meet the ROLE_NARROWINGS routes.
 * Deliberately stops at the guards: object-level service scoping is #1362's job, so a
 * "reached" assertion here means the handler answered (200/201, or 404 for an unknown id),
 * never that the data came back. A 500 fails.
 */
const API = '/api/v1';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000999';

const USERS = {
  [UserRole.OFFICE_STAFF]: {
    id: '00000000-0000-4000-8000-0000013640a1',
    email: 'nr1364-office@e2e.example',
  },
  [UserRole.EXAM_CONTROLLER]: {
    id: '00000000-0000-4000-8000-0000013640a2',
    email: 'nr1364-exam@e2e.example',
  },
  [UserRole.COMMITTEE]: {
    id: '00000000-0000-4000-8000-0000013640a3',
    email: 'nr1364-committee@e2e.example',
  },
} as const;

describe('[#1364] new roles vs ROLE_NARROWINGS routes', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());

  const call = (role: UserRole, method: 'get' | 'post' | 'patch', path: string, body?: object) =>
    http()
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${tokens[role]}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const dataSource = app.get(DataSource);

    for (const [role, u] of Object.entries(USERS)) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, u.email, SEED_ADMIN_PASSWORD_HASH, `NR1364 ${role}`],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, SEED_TENANT_ID, role],
      );
      const res = await http()
        .post(`${API}/auth/login`)
        .send({ email: u.email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      tokens[role] = res.body.access_token;
    }
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // A 404 only counts as "reached" when the handler threw it (unknown id). Nest's own
  // "Cannot POST /api/v1/…" 404 fires before any guard, so a renamed route must fail here.
  const reached = (res: { status: number; body: { message?: unknown } }) => {
    expect([200, 201, 404]).toContain(res.status);
    if (res.status === 404) {
      expect(String(res.body.message)).not.toMatch(/^Cannot (GET|POST|PATCH|PUT|DELETE)/);
    }
  };
  const DATE = '2026-01-15';

  it('EXAM_CONTROLLER reaches results review and publish, may write marks (81 D5b) but never reopen', async () => {
    const R = UserRole.EXAM_CONTROLLER;
    reached(await call(R, 'get', `/exams/${UNKNOWN_ID}/results`));
    reached(await call(R, 'post', `/exams/${UNKNOWN_ID}/results/publish`));
    // The guard now passes; the empty body then fails validation (400), never 403.
    expect((await call(R, 'patch', `/exams/${UNKNOWN_ID}/marks`, {})).status).not.toBe(403);
    expect((await call(R, 'post', `/exams/${UNKNOWN_ID}/marks/reopen`, {})).status).toBe(403);
  });

  it('OFFICE_STAFF creates a student but cannot generate fees or see run history', async () => {
    const R = UserRole.OFFICE_STAFF;
    const created = await call(R, 'post', '/students', {
      full_name: 'NR1364 Student',
      class_section_id: SEED_SECTION_1_ID,
      date_of_birth: '2010-05-15',
    });
    expect(created.status).toBe(201);
    expect((await call(R, 'get', '/students')).status).toBe(200);
    expect((await call(R, 'get', '/fees/dues/flagged')).status).toBe(200);
    expect((await call(R, 'get', `/attendance/flags/low?from=${DATE}&to=${DATE}`)).status).toBe(
      200,
    );
    reached(
      await call(R, 'post', `/communications/reminder/single/${UNKNOWN_ID}/preview`, {
        message_template: 'Reminder',
      }),
    );
    // F8: OFFICE_STAFF holds FEE_READ but not PAYMENT_READ — no guardian payment history.
    expect((await call(R, 'get', `/payments/guardian/${UNKNOWN_ID}`)).status).toBe(403);
    expect((await call(R, 'post', '/fees/generate', {})).status).toBe(403);
    expect((await call(R, 'patch', `/fees/generations/${UNKNOWN_ID}`, {})).status).toBe(403);
    expect((await call(R, 'get', '/fees/generations')).status).toBe(403);
    expect((await call(R, 'post', `/invoices/${UNKNOWN_ID}/send`, {})).status).toBe(403);
  });

  it('EXAM_CONTROLLER and OFFICE_STAFF read students, enrollments and the attendance register', async () => {
    for (const R of [UserRole.EXAM_CONTROLLER, UserRole.OFFICE_STAFF]) {
      expect((await call(R, 'get', '/students')).status).toBe(200);
      reached(await call(R, 'get', `/enrollments/student/${UNKNOWN_ID}`));
      expect(
        (await call(R, 'get', `/attendance/sections/${SEED_SECTION_1_ID}/register?date=${DATE}`))
          .status,
      ).toBe(200);
    }
  });

  it('every new role reads its own profile; the two employee roles reach leave', async () => {
    for (const R of [UserRole.OFFICE_STAFF, UserRole.EXAM_CONTROLLER, UserRole.COMMITTEE]) {
      const me = await call(R, 'get', '/users/me');
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(USERS[R].id);
      expect((await call(R, 'get', '/me/push/public-key')).status).toBe(200);
    }
    for (const R of [UserRole.OFFICE_STAFF, UserRole.EXAM_CONTROLLER]) {
      expect((await call(R, 'get', '/leave/policies')).status).toBe(200);
    }
    // D17: COMMITTEE is not an employee.
    expect((await call(UserRole.COMMITTEE, 'get', '/leave/policies')).status).toBe(403);
  });

  it('COMMITTEE reaches none of the student or results staff routes', async () => {
    const R = UserRole.COMMITTEE;
    expect((await call(R, 'get', '/students')).status).toBe(403);
    expect((await call(R, 'get', `/exams/${UNKNOWN_ID}/results`)).status).toBe(403);
    expect((await call(R, 'get', '/attendance/my-sections')).status).toBe(403);
    // D16: the collections report (JSON and CSV) lists a student_name per payment.
    expect((await call(R, 'get', '/reports/collections')).status).toBe(403);
    expect((await call(R, 'get', '/reports/collections.csv')).status).toBe(403);
  });
});

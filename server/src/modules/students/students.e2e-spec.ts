import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';
import { NotFoundException } from '@nestjs/common';
import { StudentService } from './students.service';

import { Teacher } from '../academics/entities/teacher.entity';
/**
 * E2E tests for Student endpoints.
 *
 * Tests tenant isolation, registration number generation,
 * soft delete, role-based access control, paginated listing,
 * and update operations.
 */

describe('Students E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    // Ensure test database is used
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
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

    // Log in as admin
    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /students', () => {
    const createStudentPayload = {
      full_name: 'John Doe',
      class_section_id: SEED_SECTION_1_ID,
      date_of_birth: '2010-05-15',
    };

    describe('registration year follows the school (Asia/Dhaka) calendar', () => {
      afterEach(() => vi.useRealTimers());

      it('00:30 on 1 Jan 2027 Dhaka gets REG-2027', async () => {
        // Freeze before login so the JWT iat/exp match the frozen clock.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-12-31T18:30:00Z'));
        const login = await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
          .expect(200);
        const res = await supertest(app.getHttpServer())
          .post('/api/v1/students')
          .set('Authorization', `Bearer ${login.body.access_token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .send(createStudentPayload)
          .expect(201);
        expect(res.body.registration_number).toMatch(/^REG-2027-\d{4}$/);
      });
    });

    it('should create a student with ADMIN role', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send(createStudentPayload)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.full_name).toBe('John Doe');
      expect(res.body.registration_number).toMatch(/^REG-\d{4}-\d{4}$/);
      // Critical: student belongs to the correct tenant
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it('[2631] the same Idempotency-Key twice creates ONE student', async () => {
      const key = `student-${Date.now()}`;
      const send = () =>
        supertest(app.getHttpServer())
          .post('/api/v1/students')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('Idempotency-Key', key)
          .send({ ...createStudentPayload, full_name: `Idem Student ${key}` });

      const first = await send().expect(201);
      const second = await send().expect(201);

      expect(second.body.id).toBe(first.body.id);
      const rows = await dataSource.query(
        `SELECT count(*)::int AS n FROM students WHERE full_name = $1`,
        [`Idem Student ${key}`],
      );
      expect(rows[0].n).toBe(1);
    });

    it('LIFE-11: the create is visible in the audit log with the acting admin', async () => {
      const created = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ ...createStudentPayload, full_name: 'Audited Via Api' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/audit-logs?entity_type=Student&entity_id=${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].action).toBe('CREATE');
      expect(res.body.data[0].new_values.full_name).toBe('Audited Via Api');
      expect(res.body.data[0].performed_by_user_id).toBeTruthy();
    });

    it('neutralises a script payload in full_name and home_address (issue #33)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          ...createStudentPayload,
          full_name: '<script>alert(1)</script>Jane Doe',
          home_address: '<img src=x onerror=alert(1)>123 Main St',
        })
        .expect(201);

      expect(res.body.full_name).toBe('Jane Doe');
      expect(res.body.home_address).toBe('123 Main St');
    });

    it('leaves legitimate apostrophes, ampersands, and Unicode names untouched', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          ...createStudentPayload,
          full_name: "রহিম উদ্দিন O'Brien & Co",
        })
        .expect(201);

      expect(res.body.full_name).toBe("রহিম উদ্দিন O'Brien & Co");
    });

    it('should return 401 when X-Tenant-ID header is missing', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        // No X-Tenant-ID
        .send(createStudentPayload)
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });

    it('should return 403 when a STUDENT tries to create a student', async () => {
      // Add STUDENT role to the admin user for this tenant
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );

      // Get a fresh token with the STUDENT role included in the JWT memberships
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const studentToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send(createStudentPayload)
        .expect(403);

      expect(res.body.message).toContain('Requires permission(s)');
    });

    it('should return 404 when class_section does not exist', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          ...createStudentPayload,
          class_section_id: '00000000-0000-4000-8000-000000000000',
        })
        .expect(404);

      expect(res.body.message).toBe('Class section not found');
      expect(res.body.message).not.toContain('00000000-0000-4000-8000-000000000000');
    });

    it('should return 400 for invalid DTO (missing required fields)', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({}) // Empty body
        .expect(400);
    });
  });

  describe('GET /students', () => {
    it('should return paginated students', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeDefined();
      expect(res.body.page).toBe(1);
    });

    it('accepts an allowlisted sort field with asc/desc order', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/students?sort=full_name&order=asc')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
    });

    it('rejects a sort field that is not on the allowlist — no arbitrary column sort', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/students?sort=tenant_id')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(400);
    });
  });

  describe('GET /students/ids', () => {
    it('returns matching ids and total, filtered by search', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Ids Endpoint Test Student', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/students/ids?search=Ids Endpoint Test Student')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.ids).toContain(createRes.body.id);
      expect(res.body.total).toBe(res.body.ids.length);
    });

    it('matches a roll number typed in Bengali digits', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          full_name: 'Bengali Roll Student',
          class_section_id: SEED_SECTION_1_ID,
          roll_number: 912,
        })
        .expect(201);

      // ৯১২ is Bengali for 912 — normalizeSearchTerm converts it before the
      // roll_number equality match runs.
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/students/ids?search=৯১২')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.ids).toContain(createRes.body.id);
    });

    it('filters by class_id, section_id, and enrollment_status together with search', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Filtered Combo Student', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(
          `/api/v1/students/ids?class_id=${SEED_CLASS_1_ID}&section_id=${SEED_SECTION_1_ID}&enrollment_status=ACTIVE&search=Filtered Combo Student`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.ids).toContain(createRes.body.id);

      // A section that doesn't match the student excludes it.
      const missRes = await supertest(app.getHttpServer())
        .get(`/api/v1/students/ids?section_id=${SEED_SECTION_2_ID}&search=Filtered Combo Student`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(missRes.body.ids).not.toContain(createRes.body.id);
    });

    it('does not include a matching student from another tenant', async () => {
      const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000098';
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ('${OTHER_TENANT_ID}', 'Ids Isolation School', 'ids-isolation-school', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${OTHER_TENANT_ID}', '${UserRole.ADMIN}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );
      // Membership is embedded in the JWT at login time — re-login so the
      // token reflects the membership just inserted above.
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const multiTenantToken = loginRes.body.access_token;

      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${multiTenantToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Ids Tenant Isolation Student', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/students/ids?search=Ids Tenant Isolation Student')
        .set('Authorization', `Bearer ${multiTenantToken}`)
        .set('X-Tenant-ID', OTHER_TENANT_ID)
        .expect(200);

      expect(res.body.ids).not.toContain(createRes.body.id);
    });

    it('should return 403 when a STUDENT role tries to use the ids endpoint (not in its allowlist)', async () => {
      // Same pattern as "POST /students" role check above: give the seed
      // admin user a STUDENT role for this tenant, then re-login so the JWT
      // carries it, and confirm the ids route rejects that role.
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const studentToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/students/ids')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(403);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('stays under the 5,000 cap on a normal query (413-over-cap path covered in students.service.spec.ts)', async () => {
      // No practical way to seed 5,000+ students in an e2e run — the cap's
      // 413 branch is covered by a mocked-repo unit test in
      // `students.service.spec.ts` instead. This just confirms a normal
      // e2e-seeded query stays under the cap and succeeds end-to-end.
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/students/ids')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBeLessThan(5000);
    });
  });

  describe('GET /students/:id', () => {
    it('should return a student by ID', async () => {
      // Create a student first
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Jane Doe', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.id).toBe(createRes.body.id);
      expect(res.body.full_name).toBe('Jane Doe');
    });

    it('should return 404 for a non-existent student', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/students/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('PATCH /students/:id', () => {
    describe('[68.3.40] roll number conflicts', () => {
      const mk = async (name: string, section: string, roll: number) =>
        (
          await supertest(app.getHttpServer())
            .post('/api/v1/students')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-Tenant-ID', TENANT_ID)
            .send({ full_name: name, class_section_id: section, roll_number: roll })
            .expect(201)
        ).body;

      it('returns 409 ROLL_NUMBER_TAKEN (not 500) for a taken roll in the target section', async () => {
        const roll = 7000 + Math.floor(Math.random() * 1000);
        await mk('Roll Holder', SEED_SECTION_2_ID, roll);
        const mover = await mk('Roll Mover', SEED_SECTION_1_ID, roll);

        const res = await supertest(app.getHttpServer())
          .patch(`/api/v1/students/${mover.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .send({ class_section_id: SEED_SECTION_2_ID, roll_number: roll })
          .expect(200);
        // same roll re-sent on a move is replaced by a free one, not an error
        expect(res.body.roll_number).not.toBe(roll);

        const other = await mk('Roll Other', SEED_SECTION_1_ID, roll + 2000);
        const conflict = await supertest(app.getHttpServer())
          .patch(`/api/v1/students/${other.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .send({ class_section_id: SEED_SECTION_2_ID, roll_number: roll })
          .expect(409);
        expect(conflict.body.details?.code ?? conflict.body.message?.details?.code).toBe(
          'ROLL_NUMBER_TAKEN',
        );
      });

      it('POST /students with a taken roll returns 409 ROLL_NUMBER_TAKEN (create path)', async () => {
        const roll = 7000 + Math.floor(Math.random() * 1000);
        await mk('Roll Holder Create', SEED_SECTION_1_ID, roll);
        const res = await supertest(app.getHttpServer())
          .post('/api/v1/students')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .send({
            full_name: 'Roll Clash Create',
            class_section_id: SEED_SECTION_1_ID,
            roll_number: roll,
          })
          .expect(409);
        expect(res.body.details?.code ?? res.body.message?.details?.code).toBe('ROLL_NUMBER_TAKEN');
      });
    });

    describe('[76.2.06] card_no', () => {
      const mk = async (name: string) =>
        (
          await supertest(app.getHttpServer())
            .post('/api/v1/students')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-Tenant-ID', TENANT_ID)
            .send({ full_name: name, class_section_id: SEED_SECTION_1_ID })
            .expect(201)
        ).body.id as string;
      const patch = (id: string, body: object) =>
        supertest(app.getHttpServer())
          .patch(`/api/v1/students/${id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .send(body);

      it('ADMIN sets, clears, and a duplicate is a fixed 409', async () => {
        const a = await mk('Card A');
        const b = await mk('Card B');
        const set = await patch(a, { card_no: 'E2E-CARD-1' }).expect(200);
        expect(set.body.card_no).toBe('E2E-CARD-1');
        const dup = await patch(b, { card_no: 'E2E-CARD-1' }).expect(409);
        expect(JSON.stringify(dup.body)).toContain('This card number is already in use');
        await patch(b, { card_no: 'no spaces!' }).expect(400);
        const cleared = await patch(a, { card_no: null }).expect(200);
        expect(cleared.body.card_no).toBeNull();
      });

      it('missing X-Tenant-ID is 401, an unknown tenant is refused', async () => {
        const id = await mk('Card C');
        await supertest(app.getHttpServer())
          .patch(`/api/v1/students/${id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ card_no: 'E2E-CARD-2' })
          .expect(401);
        const res = await supertest(app.getHttpServer())
          .patch(`/api/v1/students/${id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', '00000000-0000-4000-8000-0000000000ff')
          .send({ card_no: 'E2E-CARD-2' });
        expect([401, 403, 404]).toContain(res.status);
      });

      it('a TEACHER cannot PATCH card_no (403)', async () => {
        const id = await mk('Card D');
        await dataSource.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
        );
        const login = await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
          .expect(200);
        await supertest(app.getHttpServer())
          .patch(`/api/v1/students/${id}`)
          .set('Authorization', `Bearer ${login.body.access_token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', UserRole.TEACHER)
          .send({ card_no: 'E2E-CARD-3' })
          .expect(403);
      });
    });

    it('should update a student', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Original Name', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Updated Name' })
        .expect(200);

      expect(res.body.full_name).toBe('Updated Name');
    });

    it('clears date_of_birth, gender and home_address when explicitly set to null', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          full_name: 'Clearable Fields',
          class_section_id: SEED_SECTION_1_ID,
          date_of_birth: '2010-05-15',
          gender: 'Male',
          home_address: '123 Main St',
        })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ date_of_birth: null, gender: null, home_address: null })
        .expect(200);

      expect(res.body.date_of_birth).toBeNull();
      expect(res.body.gender).toBeNull();
      expect(res.body.home_address).toBeNull();
    });

    // [2618] Staff update refuses impossible, future and pre-1900 birth dates and keeps the stored date.
    it.each(['2018-02-30', `${new Date().getUTCFullYear() + 2}-01-01`, '1850-01-01'])(
      'PATCH date_of_birth %s is 400 naming the field and leaves the date unchanged',
      async (date_of_birth) => {
        const createRes = await supertest(app.getHttpServer())
          .post('/api/v1/students')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .send({
            full_name: 'Birth Date Bound',
            class_section_id: SEED_SECTION_1_ID,
            date_of_birth: '2010-05-15',
          })
          .expect(201);

        const res = await supertest(app.getHttpServer())
          .patch(`/api/v1/students/${createRes.body.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .send({ date_of_birth })
          .expect(400);
        expect(res.body.message).toEqual(
          expect.arrayContaining([expect.stringMatching(/^date_of_birth /)]),
        );

        const after = await supertest(app.getHttpServer())
          .get(`/api/v1/students/${createRes.body.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .expect(200);
        expect(String(after.body.date_of_birth)).toContain('2010-05-15');
      },
    );

    it('neutralises a script payload on update, same as create (issue #33)', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Original Name', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: '<script>alert(1)</script>Updated Name' })
        .expect(200);

      expect(res.body.full_name).toBe('Updated Name');
    });

    it('should return 403 for STUDENT role on update', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Role Check', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      // Get a fresh token with the STUDENT role included
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const studentToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ full_name: 'Should Not Update' })
        .expect(403);
    });
  });

  describe('DELETE /students/:id', () => {
    it('should soft delete a student', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Delete Me', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      // Soft delete
      await supertest(app.getHttpServer())
        .delete(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      // Verify not found
      await supertest(app.getHttpServer())
        .get(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });

    it('returns 409 STUDENT_HAS_OPEN_MONEY when the student owes fees, and keeps the student', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Owes Money', class_section_id: SEED_SECTION_1_ID })
        .expect(201);
      const [{ id: structureId }] = await dataSource.query(
        `INSERT INTO fee_structures (fee_type, name, amount, class_id, academic_year_id, tenant_id)
         VALUES ('MONTHLY_TUITION', 'E2E Tuition ${Date.now()}', 1000, '${SEED_CLASS_1_ID}',
                 '${SEED_ACADEMIC_YEAR_ID}', '${TENANT_ID}') RETURNING id`,
      );
      await dataSource.query(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start,
           period_type, total_amount, paid_amount, discount_amount, status)
         VALUES ('${createRes.body.id}', '${SEED_ACADEMIC_YEAR_ID}', '${structureId}', '2026-02-01',
           'MONTH', 1000, 0, 0, 'PENDING')`,
      );

      const res = await supertest(app.getHttpServer())
        .delete(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(409);
      expect(res.body.details.code).toBe('STUDENT_HAS_OPEN_MONEY');

      await supertest(app.getHttpServer())
        .get(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
    });

    it('another tenant cannot delete the student: not found, student untouched', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Tenant A Keep', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      // The HTTP layer rejects a non-member tenant (see Tenant isolation below),
      // so the cross-tenant scoping is asserted on the service the route calls.
      await expect(
        app
          .get(StudentService)
          .remove(createRes.body.id, '00000000-0000-4000-8000-000000000099', null, {
            ip: null,
            userAgent: null,
          }),
      ).rejects.toThrow(NotFoundException);

      await supertest(app.getHttpServer())
        .get(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
    });

    it('should return 403 when a non-ADMIN tries to delete', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Protected', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      // Add ACCOUNTANT role and use it — ACCOUNTANT can't delete students
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.ACCOUNTANT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );

      // Get a fresh token with the ACCOUNTANT role included
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const accountantToken = loginRes.body.access_token;

      const res = await supertest(app.getHttpServer())
        .delete(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .expect(403);

      expect(res.body.message).toContain('Requires permission(s)');
    });
  });

  describe('Tenant isolation', () => {
    it('should prevent cross-tenant access to student data', async () => {
      // Create a student in tenant-1
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ full_name: 'Tenant A Student', class_section_id: SEED_SECTION_1_ID })
        .expect(201);

      // Create a second tenant and user-tenant (for cross-tenant test)
      // This simulates an admin from a different school
      const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ('${OTHER_TENANT_ID}', 'Other School', 'other-school', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );

      // Try to access the student using the other tenant
      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/students/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', OTHER_TENANT_ID)
        .expect(401);

      // The admin won't have access to this tenant
      expect(res.body.message).toContain('not a member');
    });
  });

  describe('[68.3.01] TEACHER section scope', () => {
    // The seed admin user doubles as the teacher (TEACHER membership + a `teachers` row), selected
    // with X-Role. `teachers`/`teacher_class_sections`/`subjects` are truncated per test, so the
    // fixture is re-created in beforeEach.
    let scopeToken: string;
    beforeEach(async () => {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
      );
      const teacher = await dataSource.getRepository(Teacher).save({
        user_id: SEED_ADMIN_USER_ID,
        employee_id: `EMP-SCOPE-${Math.random().toString(36).slice(2, 8)}`,
        tenant_id: TENANT_ID,
        designations: [],
      });
      const [subject] = await dataSource.query(
        `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
         VALUES ('Scope Maths', $1, $2, NOW(), NOW()) RETURNING id`,
        [`SC-${Math.random().toString(36).slice(2, 8)}`, TENANT_ID],
      );
      // Teaches SEED_SECTION_1 only; SEED_SECTION_2 plays the "other class".
      await dataSource.query(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
         VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER')`,
        [teacher.id, SEED_SECTION_1_ID, TENANT_ID, subject.id],
      );
      // The JWT embeds the user's memberships, so log in AFTER adding TEACHER.
      const login = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      scopeToken = login.body.access_token;
    });

    const asTeacher = (r: supertest.Test) =>
      r
        .set('Authorization', `Bearer ${scopeToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER);
    const asAdmin = (r: supertest.Test) =>
      r
        .set('Authorization', `Bearer ${scopeToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN);
    const get = (path: string) => supertest(app.getHttpServer()).get(`/api/v1${path}`);
    const insertStudent = async (name: string, sectionId: string) => {
      const [row] = await dataSource.query(
        `INSERT INTO students
           (full_name, registration_number, roll_number, class_section_id, tenant_id,
            enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          name,
          `SC-${Math.random().toString(36).slice(2, 12)}`,
          Math.floor(Math.random() * 1000000),
          sectionId,
          TENANT_ID,
        ],
      );
      return row.id as string;
    };

    it('TEACHER of section 1: GET /students lists only that section', async () => {
      const mine = await insertStudent('Scope Mine', SEED_SECTION_1_ID);
      const other = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      const res = await asTeacher(get('/students?limit=100')).expect(200);
      const ids = res.body.data.map((s: { id: string }) => s.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(other);
      expect(
        res.body.data.every(
          (s: { class_section_id: string }) => s.class_section_id === SEED_SECTION_1_ID,
        ),
      ).toBe(true);
    });

    it('TEACHER GET /students/:id of another section -> 404, own section -> 200', async () => {
      const mine = await insertStudent('Scope Mine', SEED_SECTION_1_ID);
      const other = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      await asTeacher(get(`/students/${other}`)).expect(404);
      await asTeacher(get(`/students/${mine}`)).expect(200);
    });

    it('TEACHER GET /students/ids returns only own-section ids', async () => {
      const mine = await insertStudent('Scope Mine', SEED_SECTION_1_ID);
      const other = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      const res = await asTeacher(get('/students/ids')).expect(200);
      expect(res.body.ids).toContain(mine);
      expect(res.body.ids).not.toContain(other);
    });

    it('a TEACHER with no assignments sees an empty list', async () => {
      await insertStudent('Scope Other', SEED_SECTION_2_ID);
      await dataSource.query(`DELETE FROM teacher_class_sections WHERE tenant_id = $1`, [
        TENANT_ID,
      ]);
      const res = await asTeacher(get('/students')).expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('ADMIN still sees every section', async () => {
      const mine = await insertStudent('Scope Mine', SEED_SECTION_1_ID);
      const other = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      const res = await asAdmin(get('/students/ids')).expect(200);
      expect(res.body.ids).toEqual(expect.arrayContaining([mine, other]));
      await asAdmin(get(`/students/${other}`)).expect(200);
    });
  });
});

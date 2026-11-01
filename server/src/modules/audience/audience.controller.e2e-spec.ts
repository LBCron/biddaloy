import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';
import { Teacher } from '../academics/entities/teacher.entity';
import { AudienceModule } from './audience.module';

/** The module is not in AppModule yet (53.2.05 imports it), so the spec adds it. */
describe('Audience API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let classId: string;
  let ownSection: string;
  let otherSection: string;
  let teacherId: string;
  const extra: string[] = [];
  const stamp = Date.now();
  const NEW_ROLES = [UserRole.OFFICE_STAFF, UserRole.TEACHER, UserRole.PARENT];
  const people = (
    qs: string,
    role: UserRole = UserRole.ADMIN,
    tenantId: string | null = SEED_TENANT_ID,
  ) => {
    let req = supertest(app.getHttpServer())
      .get(`/api/v1/audience/people?${qs}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', role);
    if (tenantId) req = req.set('X-Tenant-ID', tenantId);
    return req;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, AudienceModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    for (const role of NEW_ROLES) {
      const rows = await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING id`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
      if (rows[0]) extra.push(rows[0].id);
    }
    const [year] = await ds.query(
      `SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1`,
      [SEED_TENANT_ID],
    );
    [{ id: classId }] = await ds.query(
      `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, 'Aud E2E', $2) RETURNING id`,
      [SEED_TENANT_ID, year.id],
    );
    [{ id: ownSection }, { id: otherSection }] = [
      ...(await ds.query(
        `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'E1') RETURNING id`,
        [SEED_TENANT_ID, classId],
      )),
      ...(await ds.query(
        `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'E2') RETURNING id`,
        [SEED_TENANT_ID, classId],
      )),
    ];
    token = (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  // The suite wipes teachers and assignments before every test.
  beforeEach(async () => {
    // The login acts as a teacher assigned to E1 only when X-Role is TEACHER.
    // via the repository so the subscriber creates the staff profile
    ({ id: teacherId } = await ds.getRepository(Teacher).save({
      user_id: SEED_ADMIN_USER_ID,
      employee_id: `AUDE2E-${stamp}`,
      tenant_id: SEED_TENANT_ID,
      designations: [],
    }));
    await ds.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
       VALUES ($1, $2, $3, 'CLASS_TEACHER')`,
      [teacherId, ownSection, SEED_TENANT_ID],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM teacher_class_sections WHERE teacher_id = $1`, [teacherId]);
    await ds.query(`DELETE FROM teachers WHERE id = $1`, [teacherId]);
    await ds.query(`DELETE FROM class_sections WHERE id = ANY($1::uuid[])`, [
      [ownSection, otherSection],
    ]);
    await ds.query(`DELETE FROM classes WHERE id = $1`, [classId]);
    await ds.query(`DELETE FROM user_tenants WHERE id = ANY($1::uuid[])`, [extra]);
    await app.close();
  });

  it('permission matrix: ADMIN and OFFICE_STAFF 200, PARENT 403', async () => {
    const qs = 'target=STAFF&tab=NAMED_STAFF';
    const ok = await people(qs, UserRole.ADMIN).expect(200);
    expect(ok.body).toMatchObject({ page: 1, limit: 25 });
    expect(Array.isArray(ok.body.items)).toBe(true);
    await people(qs, UserRole.OFFICE_STAFF).expect(200);
    await people(qs, UserRole.PARENT).expect(403);
  });

  it('missing or foreign X-Tenant-ID is rejected', async () => {
    const qs = 'target=STAFF&tab=NAMED_STAFF';
    await people(qs, UserRole.ADMIN, null).expect(401);
    await people(qs, UserRole.ADMIN, '00000000-0000-4000-8000-00000000dead').expect(401);
    await supertest(app.getHttpServer()).get(`/api/v1/audience/people?${qs}`).expect(401);
  });

  it('limit 101 is 400; a non-UUID section is 400', async () => {
    await people('target=STAFF&tab=NAMED_STAFF&limit=101').expect(400);
    await people('target=STUDENTS&tab=SECTION&sectionIds=not-a-uuid').expect(400);
  });

  it('FEE_DUE answers 200 for ADMIN', async () => {
    await people('target=STUDENTS&tab=FEE_DUE', UserRole.ADMIN).expect(200);
  });

  it('advanced-tab validation is 400', async () => {
    await people('target=STUDENTS&tab=LOW_ATTENDANCE&belowPercent=0').expect(400);
    await people('target=STUDENTS&tab=LOW_ATTENDANCE&belowPercent=101').expect(400);
    await people('target=STUDENTS&tab=EXAM_FAILED&examId=not-a-uuid').expect(400);
    await people('target=STUDENTS&tab=EXAM_FAILED').expect(400);
    await people('target=STUDENTS&tab=ORG_GROUP').expect(400);
    await people(`target=STUDENTS&tab=ORG_GROUP&shift=${'x'.repeat(51)}`).expect(400);
  });

  it('an unknown exam is 404', async () => {
    await people(
      'target=STUDENTS&tab=EXAM_FAILED&examId=3f1c2a54-9b7e-4c1d-8a6f-0d2e5b7c9a11',
    ).expect(404);
  });

  it('an advanced tab with a missing or foreign X-Tenant-ID is rejected', async () => {
    const qs = 'target=STUDENTS&tab=FEE_DUE';
    await people(qs, UserRole.ADMIN, null).expect(401);
    await people(qs, UserRole.ADMIN, '00000000-0000-4000-8000-00000000dead').expect(401);
  });

  it('a non-v4 UUID in sectionIds is accepted (IsUUID all)', async () => {
    await people(
      'target=STUDENTS&tab=SECTION&sectionIds=00000000-0000-7000-8000-000000000001',
    ).expect(200);
  });

  it('a teacher gets their own section (200), 404 for another, 403 for staff', async () => {
    await people(`target=STUDENTS&tab=SECTION&sectionIds=${ownSection}`, UserRole.TEACHER).expect(
      200,
    );
    await people(`target=STUDENTS&tab=SECTION&sectionIds=${otherSection}`, UserRole.TEACHER).expect(
      404,
    );
    await people('target=STAFF&tab=NAMED_STAFF', UserRole.TEACHER).expect(403);
  });
});

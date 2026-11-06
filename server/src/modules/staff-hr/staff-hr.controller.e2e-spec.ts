import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * E2E tests for [23.2.1]'s `/designations` and `/staff-hr-records`: CRUD,
 * the promotion endpoint, an audit-log row on write, and tenant isolation
 * (a genuine tenant-B member never sees tenant-A's designations/records —
 * same pattern as `cross-tenant-access.e2e-spec.ts`).
 */
const API = '/api/v1';
const TENANT_A = SEED_TENANT_ID;
const TENANT_B = '00000000-0000-4000-8000-000000000297';
const STAFF_USER_ID = '00000000-0000-4000-8000-000000000298';
const STAFF_EMAIL = 'staff-hr-e2e-staff@testschool.example';
const TEACHER_USER_ID = '00000000-0000-4000-8000-000000000299';
const TEACHER_EMAIL = 'staff-hr-e2e-teacher@testschool.example';
const TENANT_B_USER_ID = '00000000-0000-4000-8000-000000000300';
const TENANT_B_EMAIL = 'staff-hr-e2e-tenant-b-user@testschool.example';

describe('Staff HR E2E (23.2.1)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let tenantBToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    // A second tenant, and the same seeded admin given a genuine ADMIN
    // membership in it — proves tenant isolation at the service layer, not
    // just "no membership at all" at the guard layer.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Staff HR E2E Tenant B', 'staff-hr-e2e-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    );

    // A staff user (tenant A) that HR records/promotions apply to.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Staff HR E2E Staff Member', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [STAFF_USER_ID, STAFF_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [STAFF_USER_ID, TENANT_A, UserRole.TEACHER],
    );

    // A genuine non-admin (TEACHER) user in tenant A — used to prove real
    // RBAC denial, not just the ContextGuard "no membership at all" case.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Staff HR E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_A, UserRole.TEACHER],
    );

    // A genuine tenant-B-only user — used to prove a tenant-A admin can't
    // attach this user's id (or a tenant-B designation) to a tenant-A
    // promotion/create call.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Staff HR E2E Tenant B User', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B_USER_ID, TENANT_B_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B_USER_ID, TENANT_B, UserRole.TEACHER],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
    tenantBToken = adminToken; // same user, genuine membership in both tenants
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM staff_designation_history WHERE tenant_id = $1`, [
      TENANT_A,
    ]);
    await dataSource.query(`DELETE FROM staff_hr_records WHERE tenant_id = $1`, [TENANT_A]);
    await dataSource.query(`DELETE FROM designations WHERE tenant_id IN ($1, $2)`, [
      TENANT_A,
      TENANT_B,
    ]);
    // `audit_logs` is append-only (a DB trigger rejects UPDATE/DELETE) — no
    // cleanup here, matching every other e2e spec's audit assertions.
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
      SEED_ADMIN_USER_ID,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [STAFF_USER_ID, TEACHER_USER_ID, TENANT_B_USER_ID],
    ]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await app.close();
  });

  it('creates a designation, reads it back, edits it, and soft-deletes it', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/designations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ title_en: 'Assistant Teacher', title_bn: 'সহকারী শিক্ষক', is_teaching: true })
      .expect(201);
    expect(createRes.body.title_en).toBe('Assistant Teacher');
    const designationId = createRes.body.id;

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/designations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);
    expect(listRes.body.some((d: { id: string }) => d.id === designationId)).toBe(true);

    await supertest(app.getHttpServer())
      .patch(`${API}/designations/${designationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ title_en: 'Senior Assistant Teacher' })
      .expect(200);

    const readRes = await supertest(app.getHttpServer())
      .get(`${API}/designations/${designationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);
    expect(readRes.body.title_en).toBe('Senior Assistant Teacher');

    await supertest(app.getHttpServer())
      .delete(`${API}/designations/${designationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    await supertest(app.getHttpServer())
      .get(`${API}/designations/${designationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(404);
  });

  it('never lets a genuine tenant-B member read a tenant-A designation (tenant isolation)', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/designations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ title_en: 'Tenant A Only Designation', is_teaching: false })
      .expect(201);
    const designationId = createRes.body.id;

    await supertest(app.getHttpServer())
      .get(`${API}/designations/${designationId}`)
      .set('Authorization', `Bearer ${tenantBToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .expect(404);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/designations`)
      .set('Authorization', `Bearer ${tenantBToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .expect(200);
    expect(listRes.body.some((d: { id: string }) => d.id === designationId)).toBe(false);
  });

  it('creates a staff HR record and writes an audit log entry', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/staff-hr-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ user_id: STAFF_USER_ID, index_no: 'IDX-001', department: 'Science' })
      .expect(201);
    expect(createRes.body.user_id).toBe(STAFF_USER_ID);

    const [auditRow] = await dataSource.query(
      `SELECT * FROM audit_logs WHERE entity_type = 'StaffHrRecord' AND entity_id = $1`,
      [createRes.body.id],
    );
    expect(auditRow).toBeDefined();
    expect(auditRow.action).toBe('CREATE');
    expect(auditRow.tenant_id).toBe(TENANT_A);
  });

  it('no-ops a PATCH with an empty body instead of 500ing (staff-hr-record)', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/staff-hr-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ user_id: STAFF_USER_ID, index_no: 'IDX-002', department: 'Arts' })
      .expect(201);

    const patchRes = await supertest(app.getHttpServer())
      .patch(`${API}/staff-hr-records/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({})
      .expect(200);
    expect(patchRes.body.department).toBe('Arts');
  });

  it('no-ops a PATCH with an empty body instead of 500ing (designation)', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/designations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ title_en: 'Lab Assistant', title_bn: 'ল্যাব সহকারী', is_teaching: false })
      .expect(201);

    const patchRes = await supertest(app.getHttpServer())
      .patch(`${API}/designations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({})
      .expect(200);
    expect(patchRes.body.title_en).toBe('Lab Assistant');
  });

  it('sets, clears and de-duplicates card_no on the linked staff profile [76.2.06]', async () => {
    // Two staff members in tenant A, each with a staff_profiles row and an HR record.
    for (const [uid, emp] of [
      [STAFF_USER_ID, 'E2E-CARD-1'],
      [TEACHER_USER_ID, 'E2E-CARD-2'],
    ]) {
      await dataSource.query(
        `INSERT INTO staff_profiles (user_id, tenant_id, employee_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [uid, TENANT_A, emp],
      );
      await supertest(app.getHttpServer())
        .post(`${API}/staff-hr-records`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .send({ user_id: uid })
        .expect((r) => expect([201, 409]).toContain(r.status));
    }
    const idOf = async (uid: string) =>
      (
        await dataSource.query(
          `SELECT id FROM staff_hr_records WHERE tenant_id = $1 AND user_id = $2`,
          [TENANT_A, uid],
        )
      )[0].id as string;
    const first = await idOf(STAFF_USER_ID);
    const second = await idOf(TEACHER_USER_ID);
    const patch = (
      id: string,
      body: object,
      token = adminToken,
      tenant: string | null = TENANT_A,
    ) => {
      const req = supertest(app.getHttpServer())
        .patch(`${API}/staff-hr-records/${id}`)
        .set('Authorization', `Bearer ${token}`);
      return (tenant ? req.set('X-Tenant-ID', tenant) : req).send(body);
    };
    const cardOf = async (uid: string) =>
      (
        await dataSource.query(
          `SELECT card_no FROM staff_profiles WHERE user_id = $1 AND tenant_id = $2`,
          [uid, TENANT_A],
        )
      )[0].card_no;

    await patch(first, { card_no: 'STAFF-77' }).expect(200);
    expect(await cardOf(STAFF_USER_ID)).toBe('STAFF-77');

    // A second person cannot take it; the 409 names nobody.
    const dup = await patch(second, { card_no: 'STAFF-77' }).expect(409);
    expect(JSON.stringify(dup.body)).toContain('This card number is already in use');

    await patch(first, { card_no: 'bad card!' }).expect(400);
    await patch(first, { card_no: null }).expect(200);
    expect(await cardOf(STAFF_USER_ID)).toBeNull();

    // The audit row never carries the value (Rule 13).
    const logs = await dataSource.query(
      `SELECT new_values FROM audit_logs WHERE entity_id = $1 AND action = 'UPDATE'`,
      [first],
    );
    expect(JSON.stringify(logs)).not.toContain('STAFF-77');

    // Missing tenant header -> 401; a non-admin (TEACHER) -> 403.
    await patch(first, { card_no: 'X-1' }, adminToken, null).expect(401);
    const teacherLogin = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: TEACHER_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    await patch(first, { card_no: 'X-1' }, teacherLogin.body.access_token).expect(403);
  });

  it('promotes a staff member: closes the current row, inserts a new one, and audits it', async () => {
    const designationRes = await supertest(app.getHttpServer())
      .post(`${API}/designations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ title_en: 'Head Teacher (E2E)', is_teaching: true })
      .expect(201);
    const designationId = designationRes.body.id;

    const firstPromotion = await supertest(app.getHttpServer())
      .post(`${API}/staff-hr-records/${STAFF_USER_ID}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ designation_id: designationId, effective_date: '2026-01-01' })
      .expect(201);
    expect(firstPromotion.body.end_date).toBeNull();

    const secondDesignationRes = await supertest(app.getHttpServer())
      .post(`${API}/designations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ title_en: 'Vice Principal (E2E)', is_teaching: true })
      .expect(201);
    const secondDesignationId = secondDesignationRes.body.id;

    const secondPromotion = await supertest(app.getHttpServer())
      .post(`${API}/staff-hr-records/${STAFF_USER_ID}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ designation_id: secondDesignationId, effective_date: '2026-06-01' })
      .expect(201);
    expect(secondPromotion.body.designation_id).toBe(secondDesignationId);
    expect(secondPromotion.body.end_date).toBeNull();

    // The first row is now closed, never mutated to point at the new
    // designation (close-then-insert, D7).
    const [closedRow] = await dataSource.query(
      `SELECT * FROM staff_designation_history WHERE id = $1`,
      [firstPromotion.body.id],
    );
    expect(closedRow.designation_id).toBe(designationId);
    expect(closedRow.end_date).not.toBeNull();

    // Exactly one open row for this user.
    const openRows = await dataSource.query(
      `SELECT * FROM staff_designation_history WHERE user_id = $1 AND end_date IS NULL`,
      [STAFF_USER_ID],
    );
    expect(openRows).toHaveLength(1);
    expect(openRows[0].designation_id).toBe(secondDesignationId);

    const currentRes = await supertest(app.getHttpServer())
      .get(`${API}/staff-hr-records/${STAFF_USER_ID}/current-designation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);
    expect(currentRes.body.designation_id).toBe(secondDesignationId);

    const auditRows = await dataSource.query(
      `SELECT * FROM audit_logs WHERE entity_type = 'StaffDesignationHistory' AND entity_id IN ($1, $2)`,
      [firstPromotion.body.id, secondPromotion.body.id],
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a genuine non-ADMIN member from creating a designation (PermissionsGuard)', async () => {
    // A real TEACHER-only membership in tenant A — not the seeded admin
    // with an `X-Role` header override, which only proves ContextGuard's
    // role echo works, not that RolesGuard denies a real non-admin.
    const teacherLoginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: TEACHER_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const teacherToken = teacherLoginRes.body.access_token;

    await supertest(app.getHttpServer())
      .post(`${API}/designations`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ title_en: 'Should Be Rejected', is_teaching: true })
      .expect(403);
  });

  it('rejects the DB insert of a second open designation-history row for the same user (partial unique index)', async () => {
    const designationRes = await supertest(app.getHttpServer())
      .post(`${API}/designations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ title_en: 'Duplicate-Open-Row Test Designation', is_teaching: false })
      .expect(201);
    const designationId = designationRes.body.id;

    await supertest(app.getHttpServer())
      .post(`${API}/staff-hr-records/${STAFF_USER_ID}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ designation_id: designationId, effective_date: '2027-01-01' })
      .expect(201);

    // A raw second open row for the same (tenant_id, user_id) must be
    // rejected by the DB itself — proves the partial unique index is real,
    // not just an application-level check.
    await expect(
      dataSource.query(
        `INSERT INTO staff_designation_history
           (tenant_id, user_id, designation_id, effective_date, end_date, status)
         VALUES ($1, $2, $3, '2027-02-01', NULL, 'REGULAR')`,
        [TENANT_A, STAFF_USER_ID, designationId],
      ),
    ).rejects.toThrow();
  });

  it('never lets a tenant-A caller promote/create using a tenant-B designation_id or user_id', async () => {
    // Inserted directly (not via the API) so this doesn't write a
    // `tenant_id: TENANT_B` audit_logs row — audit_logs is append-only, and
    // that FK would then block afterAll's `DELETE FROM schools` for
    // TENANT_B.
    const tenantBDesignationId = '00000000-0000-4000-8000-000000000301';
    await dataSource.query(
      `INSERT INTO designations (id, tenant_id, title_en, is_teaching, created_at, updated_at)
       VALUES ($1, $2, 'Tenant B Designation', false, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [tenantBDesignationId, TENANT_B],
    );

    const tenantADesignationRes = await supertest(app.getHttpServer())
      .post(`${API}/designations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ title_en: 'Tenant A Designation For Isolation Test', is_teaching: false })
      .expect(201);
    const tenantADesignationId = tenantADesignationRes.body.id;

    // A tenant-B designation_id, used from a tenant-A promote call.
    await supertest(app.getHttpServer())
      .post(`${API}/staff-hr-records/${STAFF_USER_ID}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ designation_id: tenantBDesignationId, effective_date: '2027-03-01' })
      .expect(404);

    // A tenant-B-only user_id, used from a tenant-A promote call.
    await supertest(app.getHttpServer())
      .post(`${API}/staff-hr-records/${TENANT_B_USER_ID}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ designation_id: tenantADesignationId, effective_date: '2027-03-01' })
      .expect(403);

    // Same for create().
    await supertest(app.getHttpServer())
      .post(`${API}/staff-hr-records`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ user_id: TENANT_B_USER_ID, index_no: 'IDX-CROSS-TENANT' })
      .expect(403);
  });
});

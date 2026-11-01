import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';
import { UserRole } from '@biddaloy/shared';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { CommunicationProviderRegistryService } from './providers/communication-provider.registry';

/**
 * E2E tests for the bulk-reminder read/preview endpoints added for the
 * Communications UI (issue #178, part a):
 *
 *   GET  /communications/reminder/bulk           — Reminder History list
 *   POST /communications/reminder/bulk/preview   — mandatory review step
 *   GET  /communications/reminder/bulk/:id/logs  — per-recipient status
 *
 * Focus: tenant isolation, the 500-student cap, soft-deleted students,
 * and that preview writes absolutely nothing.
 */

describe('Bulk Reminder Read/Preview E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  // An authenticated caller inside the tenant whose role is NOT on
  // @Roles(ADMIN, ACCOUNTANT, EXECUTIVE) — so RolesGuard, not "no token",
  // is what rejects them.
  let teacherToken: string;
  // OFFICE_STAFF holds COMMUNICATION_SEND (#2259).
  let officeToken: string;
  // ACCOUNTANT holds COMMUNICATION_BULK_SEND but not RESULT_READ (#3351 r2).
  let accountantToken: string;
  // A real ADMIN of the *other* school, for the cross-tenant case.
  let otherTenantAdminToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const TEACHER_USER_ID = '00000000-0000-4000-8000-00000000b0b1';
  const TEACHER_EMAIL = 'teacher@bulk-reminder-e2e.example';
  const OFFICE_USER_ID = '00000000-0000-4000-8000-00000000b0b3';
  const OFFICE_EMAIL = 'office@bulk-reminder-e2e.example';
  const ACCOUNTANT_USER_ID = '00000000-0000-4000-8000-00000000b0b4';
  const ACCOUNTANT_EMAIL = 'accountant@bulk-reminder-e2e.example';
  const OTHER_ADMIN_USER_ID = '00000000-0000-4000-8000-00000000b0b2';
  const OTHER_ADMIN_EMAIL = 'admin@bulk-reminder-e2e-other.example';
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-00000000b0b0';
  let seq = 0;

  async function createStudent(overrides: { deleted?: boolean } = {}): Promise<string> {
    seq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, deleted_at, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING id`,
      [
        `Reminder Student ${seq}`,
        `REG-REM-E2E-${String(seq).padStart(4, '0')}`,
        seq,
        SEED_SECTION_1_ID,
        TENANT_ID,
        '2010-01-01',
        'SMS',
        'ACTIVE',
        overrides.deleted ? new Date() : null,
      ],
    );
    return res[0].id;
  }

  async function createGuardian(
    studentId: string,
    overrides: { phone?: string | null; is_primary?: boolean; name?: string } = {},
  ): Promise<string> {
    seq += 1;
    const res = await dataSource.query(
      `INSERT INTO guardians (id, full_name, relationship, phone, preferred_communication, is_primary_contact, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id`,
      [
        overrides.name ?? `Reminder Guardian ${seq}`,
        'FATHER',
        overrides.phone === undefined ? '01712345678' : overrides.phone,
        'SMS',
        overrides.is_primary ?? true,
        TENANT_ID,
      ],
    );
    const guardianId = res[0].id;
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [studentId, guardianId],
    );
    return guardianId;
  }

  async function createFee(studentId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO student_fees (id, student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4::date, 1000, 0, 0, 'PENDING', NOW(), NOW())`,
      [
        studentId,
        SEED_ACADEMIC_YEAR_ID,
        await ensureFeeStructure(dataSource),
        periodStart(5, 2026),
      ],
    );
  }

  async function createBatch(
    tenantId: string,
    overrides: { name?: string; created_at?: string } = {},
  ): Promise<string> {
    seq += 1;
    const res = await dataSource.query(
      `INSERT INTO reminder_batches (id, tenant_id, batch_name, status, total_recipients, message_template, initiated_by_user_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'COMPLETED', 1, 'Dear {{guardian_name}}', $3, $4, NOW())
       RETURNING id`,
      [
        tenantId,
        overrides.name ?? `Batch ${seq}`,
        SEED_ADMIN_USER_ID,
        overrides.created_at ?? new Date().toISOString(),
      ],
    );
    return res[0].id;
  }

  async function createBatchLog(
    batchId: string,
    tenantId: string,
    overrides: {
      status?: string;
      metadata?: object | null;
      body?: string;
      trigger?: string;
      studentId?: string;
      guardianId?: string;
    } = {},
  ): Promise<string> {
    seq += 1;
    const res = await dataSource.query(
      `INSERT INTO communication_logs (id, tenant_id, reminder_batch_id, medium, recipient_address, recipient_name, message_body, status, trigger, student_id, guardian_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'SMS', '01712345678', $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [
        tenantId,
        batchId,
        `Log Recipient ${seq}`,
        overrides.body ?? 'Dear guardian',
        overrides.status ?? 'SENT',
        overrides.trigger ?? 'BULK_REMINDER',
        overrides.studentId ?? null,
        overrides.guardianId ?? null,
      ],
    );
    if (overrides.metadata !== undefined) {
      await dataSource.query(`UPDATE communication_logs SET metadata = $1 WHERE id = $2`, [
        JSON.stringify(overrides.metadata),
        res[0].id,
      ]);
    }
    return res[0].id;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
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

    // A second school, so "Tenant A cannot read Tenant B's batches" is a
    // real cross-tenant assertion rather than a mock. Seeded once — the
    // per-test truncation never touches the schools table.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other School', 'other-school-reminders-e2e', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );

    // A TEACHER membership inside the caller tenant: authenticated, but off
    // the @Roles list every bulk-reminder route carries.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Reminder E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Reminder E2E Office', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OFFICE_USER_ID, OFFICE_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OFFICE_USER_ID, TENANT_ID, UserRole.OFFICE_STAFF],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Reminder E2E Accountant', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, ACCOUNTANT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, TENANT_ID, UserRole.ACCOUNTANT],
    );

    // An ADMIN who belongs only to the other school — the right role, the
    // wrong tenant.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Reminder E2E Other Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_USER_ID, OTHER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;

    const teacherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: TEACHER_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;

    const officeLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: OFFICE_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    officeToken = officeLoginRes.body.access_token;

    const accountantLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ACCOUNTANT_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    accountantToken = accountantLoginRes.body.access_token;

    const otherAdminLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: OTHER_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    otherTenantAdminToken = otherAdminLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /communications/reminder/bulk', () => {
    it('lists only the caller tenant batches, newest first, with pagination metadata', async () => {
      await createBatch(TENANT_ID, { name: 'Older', created_at: '2026-03-01T00:00:00Z' });
      await createBatch(TENANT_ID, { name: 'Newer', created_at: '2026-04-01T00:00:00Z' });
      await createBatch(OTHER_TENANT_ID, { name: 'Foreign' });

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/communications/reminder/bulk')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
      expect(res.body.totalPages).toBe(1);
      expect(res.body.data.map((b: any) => b.batch_name)).toEqual(['Newer', 'Older']);
      // List rows must not carry each batch's (potentially huge) skip list.
      expect(res.body.data[0]).not.toHaveProperty('skipped');
    });

    it('paginates', async () => {
      await createBatch(TENANT_ID, { created_at: '2026-03-01T00:00:00Z' });
      await createBatch(TENANT_ID, { created_at: '2026-04-01T00:00:00Z' });
      await createBatch(TENANT_ID, { created_at: '2026-05-01T00:00:00Z' });

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/communications/reminder/bulk?page=2&limit=2')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.page).toBe(2);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.totalPages).toBe(2);
    });

    it('rejects an out-of-range limit', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/communications/reminder/bulk?limit=500')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(400);
    });

    it('requires the X-Tenant-ID header', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/communications/reminder/bulk')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  describe('POST /communications/reminder/bulk/preview', () => {
    it('returns the rendered recipients and skipped guardians without writing anything', async () => {
      const studentId = await createStudent();
      await createGuardian(studentId, { name: 'Karim Uddin' });
      await createGuardian(studentId, { name: 'Salma Begum', phone: null });
      await createFee(studentId);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          student_ids: [studentId],
          message_template: 'Dear {{guardian_name}}, {{student_name}} owes {{due_amount}}.',
        })
        .expect(200);

      expect(res.body.total_students).toBe(1);
      expect(res.body.recipients_count).toBe(1);
      expect(res.body.skipped_count).toBe(1);

      const student = res.body.students[0];
      expect(student.student_id).toBe(studentId);
      expect(student.recipients[0]).toMatchObject({
        guardian_name: 'Karim Uddin',
        medium: 'SMS',
        address: '01712345678',
        subject: null,
      });
      expect(student.recipients[0].message_body).toContain('Dear Karim Uddin');
      expect(student.recipients[0].message_body).toContain('owes 1,000.00');
      expect(student.skipped[0]).toMatchObject({
        guardian_name: 'Salma Begum',
        reason: 'guardian_has_no_address_for_preferred_medium',
      });

      // Preview must be side-effect free — no batch, no logs, no jobs.
      const batches = await dataSource.query(`SELECT COUNT(*)::int AS n FROM reminder_batches`);
      const logs = await dataSource.query(`SELECT COUNT(*)::int AS n FROM communication_logs`);
      expect(batches[0].n).toBe(0);
      expect(logs[0].n).toBe(0);
    });

    it('rejects more than 500 students in one batch', async () => {
      const ids = Array.from({ length: 501 }, () => randomUUID());

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ student_ids: ids, message_template: 'Hi {{guardian_name}}' })
        .expect(400);

      expect(JSON.stringify(res.body.message)).toContain('500');
    });

    // Fails closed: `[]` means "no channel at all", and the resolver would
    // otherwise read it the same as an omitted field — "any channel" — and
    // fan a send out to everybody.
    it('rejects an explicitly empty mediums list rather than defaulting to every channel', async () => {
      const studentId = await createStudent();
      await createGuardian(studentId);
      await createFee(studentId);

      await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          student_ids: [studentId],
          message_template: 'Dear {{guardian_name}}',
          mediums: [],
        })
        .expect(400);
    });

    it('rejects an unsupported template placeholder, naming it', async () => {
      const studentId = await createStudent();

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ student_ids: [studentId], message_template: 'Hi {{parent}}' })
        .expect(400);

      expect(res.body.message).toContain('Unsupported template placeholder(s): parent');
    });

    it('404s for a student belonging to another tenant', async () => {
      // Tenant isolation: an attacker guessing another school's student id
      // must get "not found", never that student's guardians and dues.
      const foreignStudent = await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
         VALUES (DEFAULT, 'Foreign Student', 'REG-REM-FOREIGN-1', 9001, $2, $1, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
         RETURNING id`,
        [OTHER_TENANT_ID, SEED_SECTION_1_ID],
      );

      await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ student_ids: [foreignStudent[0].id], message_template: 'Hi {{guardian_name}}' })
        .expect(404);
    });

    it('404s for a soft-deleted student', async () => {
      const deletedId = await createStudent({ deleted: true });

      await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ student_ids: [deletedId], message_template: 'Hi {{guardian_name}}' })
        .expect(404);
    });
  });

  describe('GET /communications/logs', () => {
    it('lists only this tenant logs, filtered by status, and caps limit at 100', async () => {
      const batchId = await createBatch(TENANT_ID);
      const foreignBatchId = await createBatch(OTHER_TENANT_ID);
      await createBatchLog(batchId, TENANT_ID, { status: 'FAILED' });
      await createBatchLog(batchId, TENANT_ID, { status: 'SENT' });
      await createBatchLog(foreignBatchId, OTHER_TENANT_ID, { status: 'FAILED' });

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/communications/logs?status=FAILED')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBe(1);
      // [97.4.02] D22: the row detail shows the message itself (the batch text, here).
      expect(res.body.data[0]).toMatchObject({
        status: 'FAILED',
        message_body: 'Dear guardian',
        batch_id: batchId,
        is_test: false,
        can_check_status: false,
      });

      await supertest(app.getHttpServer())
        .get('/api/v1/communications/logs?limit=101')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(400);
    });
  });

  // [97.4.01] D22 filters through the real HTTP stack (the SQL itself is proven in
  // reminders.service.integration.spec.ts).
  describe('GET /communications/logs filters', () => {
    const getLogs = (qs: string, t = token) =>
      supertest(app.getHttpServer())
        .get(`/api/v1/communications/logs?${qs}`)
        .set('Authorization', `Bearer ${t}`)
        .set('X-Tenant-ID', TENANT_ID);

    it('search (phone in +880 form), trigger, sent_by and provider each narrow the list', async () => {
      const batchId = await createBatch(TENANT_ID);
      const hit = await createBatchLog(batchId, TENANT_ID, { metadata: { provider: 'stub-sms' } });
      await dataSource.query(
        `UPDATE communication_logs SET recipient_address = '01799000111', sent_by_user_id = $1, trigger = 'MANUAL' WHERE id = $2`,
        [SEED_ADMIN_USER_ID, hit],
      );
      const decoy = await createBatchLog(batchId, TENANT_ID, {
        metadata: { provider: 'stub-other' },
      });

      // Other tests in this file write rows for the same tenant, so check this test's two rows
      // only: the hit is in, the decoy is out.
      for (const qs of [
        `search=${encodeURIComponent('+880 1799-000111')}`,
        'trigger=MANUAL',
        `sent_by=${SEED_ADMIN_USER_ID}`,
        'provider=stub-sms',
      ]) {
        const res = await getLogs(qs).expect(200);
        const found = res.body.data.map((r: { id: string }) => r.id);
        expect(found).toContain(hit);
        expect(found).not.toContain(decoy);
      }
      const rows = (await getLogs('provider=stub-sms').expect(200)).body.data;
      expect(rows.find((r: { id: string }) => r.id === hit)).toMatchObject({
        trigger: 'MANUAL',
        provider: 'stub-sms',
        sent_by_user_id: SEED_ADMIN_USER_ID,
        sent_by_name: expect.any(String),
        // stub-sms is no real company, so the flag is false, never a guess.
        can_check_status: false,
      });
    });

    it('can_check_status is true for a SENT row from a company that reports delivery', async () => {
      const id = await createBatchLog(await createBatch(TENANT_ID), TENANT_ID, {
        status: 'SENT',
        metadata: { provider: 'onecodesoft' },
      });
      await dataSource.query(
        `UPDATE communication_logs SET provider_message_id = 'vendor-9' WHERE id = $1`,
        [id],
      );
      const rows = (await getLogs('provider=onecodesoft').expect(200)).body.data;
      expect(rows.find((r: { id: string }) => r.id === id)).toMatchObject({
        can_check_status: true,
      });
    });

    it('OFFICE_STAFF (holds COMMUNICATION_BULK_SEND) can read the log', async () => {
      await getLogs('', officeToken).expect(200);
    });

    it('rejects bad filter values with 400', async () => {
      await getLogs('sent_by=not-a-uuid').expect(400);
      await getLogs('trigger=NOPE').expect(400);
      await getLogs(`provider=${'x'.repeat(41)}`).expect(400);
      await getLogs(`search=${'x'.repeat(101)}`).expect(400);
      await getLogs('student_id=not-a-uuid').expect(400);
      await getLogs('guardian_id=not-a-uuid').expect(400);
    });

    // [#3343] The student and guardian pages' Messages link: one person's messages, every other
    // filter still applies, PUSH rows stay out, and another school sees none of them.
    it('student_id and guardian_id narrow to one person, combine with status, and skip PUSH', async () => {
      const studentId = await createStudent();
      const guardianId = await createGuardian(studentId);
      const batchId = await createBatch(TENANT_ID);
      const failed = await createBatchLog(batchId, TENANT_ID, {
        status: 'FAILED',
        studentId,
        guardianId,
      });
      const sent = await createBatchLog(batchId, TENANT_ID, { studentId, guardianId });
      const other = await createBatchLog(batchId, TENANT_ID);
      const push = await createBatchLog(batchId, TENANT_ID, { studentId, guardianId });
      await dataSource.query(
        `UPDATE communication_logs SET medium = 'PUSH', recipient_address = 'push:x' WHERE id = $1`,
        [push],
      );
      const ids = async (qs: string, t = token, tenant = TENANT_ID) =>
        (
          await supertest(app.getHttpServer())
            .get(`/api/v1/communications/logs?${qs}`)
            .set('Authorization', `Bearer ${t}`)
            .set('X-Tenant-ID', tenant)
            .expect(200)
        ).body.data.map((r: { id: string }) => r.id);

      expect((await ids(`student_id=${studentId}`)).sort()).toEqual([failed, sent].sort());
      expect((await ids(`guardian_id=${guardianId}`)).sort()).toEqual([failed, sent].sort());
      expect(await ids(`student_id=${studentId}&status=FAILED`)).toEqual([failed]);
      expect(await ids(`guardian_id=${guardianId}&status=FAILED`)).toEqual([failed]);
      expect(await ids(`student_id=${studentId}`)).not.toContain(other);
      // Tenant isolation: the other school's admin, on their own school, gets nothing.
      expect(await ids(`student_id=${studentId}`, otherTenantAdminToken, OTHER_TENANT_ID)).toEqual(
        [],
      );
    });
  });

  // [#3351 r2] Finding 1: what a log row shows of the stored text, decided at read time. Rule 16:
  // a live invoice share token never leaves the server; RESULT_READ: an exam result only for a
  // role that may read results. The stored (and sent) text is unchanged.
  describe('message body on log rows', () => {
    // 32 random bytes, base64url: the invoice share token's real shape.
    const TOKEN = 'Q2xhdWRlU2hhcmVUb2tlbl9vbmx5X2luX3RoZV9EQg_-';
    const receipt = `Invoice INV-7 paid. See it: https://app.example/i/${TOKEN}`;
    const resultText = 'Karim Uddin: GPA 4.50, position 3';

    const read = (path: string, t: string) =>
      supertest(app.getHttpServer())
        .get(`/api/v1/communications/${path}`)
        .set('Authorization', `Bearer ${t}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

    it('masks the share token in the list and the batch logs for every role; the DB keeps it', async () => {
      const batchId = await createBatch(TENANT_ID);
      for (const trigger of ['AUTOMATED', 'MANUAL']) {
        await createBatchLog(batchId, TENANT_ID, { body: receipt, trigger });
      }

      for (const t of [token, accountantToken, officeToken]) {
        const list = await read('logs?search=Log%20Recipient&limit=100', t);
        const batch = await read(`reminder/bulk/${batchId}/logs`, t);
        for (const res of [list, batch]) {
          expect(JSON.stringify(res.body)).not.toContain(TOKEN);
        }
        const rows = batch.body.data as { message_body: string; body_withheld: boolean }[];
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.message_body).toBe('Invoice INV-7 paid. See it: https://app.example/i/••••••');
          expect(row.body_withheld).toBe(false);
        }
      }
      // What is stored, and what the worker sends, is the real link.
      const stored = await dataSource.query(
        `SELECT message_body FROM communication_logs WHERE reminder_batch_id = $1`,
        [batchId],
      );
      expect(stored.map((r: { message_body: string }) => r.message_body)).toEqual([
        receipt,
        receipt,
      ]);
    });

    it('withholds an exam result from ACCOUNTANT (no RESULT_READ); shows it to ADMIN and OFFICE_STAFF', async () => {
      const batchId = await createBatch(TENANT_ID);
      const id = await createBatchLog(batchId, TENANT_ID, {
        body: resultText,
        trigger: 'RESULT_SMS',
      });
      const rowFor = async (t: string) => {
        const list = await read('logs?trigger=RESULT_SMS&limit=100', t);
        const batch = await read(`reminder/bulk/${batchId}/logs`, t);
        const fromList = list.body.data.find((r: { id: string }) => r.id === id);
        expect(batch.body.data[0]).toEqual(fromList);
        return fromList;
      };

      const accountant = await rowFor(accountantToken);
      expect(accountant).toMatchObject({ message_body: null, body_withheld: true });
      for (const t of [token, officeToken]) {
        expect(await rowFor(t)).toMatchObject({ message_body: resultText, body_withheld: false });
      }
    });
  });

  // [97.4.01] D23. No vendor stub (the SSRF guard rightly refuses a loopback URL, D10): the 200
  // path stubs the registry's resolveFor with a fake provider, so guards, pipes, interceptor,
  // tenant scoping and the DB write are all real.
  describe('POST /communications/logs/:id/check-status', () => {
    let resolveSpy: ReturnType<typeof vi.spyOn> | undefined;
    const getStatus = vi.fn();

    const check = (id: string, t = token, tenant = TENANT_ID) =>
      supertest(app.getHttpServer())
        .post(`/api/v1/communications/logs/${id}/check-status`)
        .set('Authorization', `Bearer ${t}`)
        .set('X-Tenant-ID', tenant);

    async function sentLog(tenantId = TENANT_ID): Promise<string> {
      const id = await createBatchLog(await createBatch(tenantId), tenantId, {
        status: 'SENT',
        metadata: { provider: 'stub-sms', segments: 1 },
      });
      await dataSource.query(
        `UPDATE communication_logs SET provider_message_id = 'vendor-7' WHERE id = $1`,
        [id],
      );
      return id;
    }

    function stubProvider() {
      const registry = app.get(CommunicationProviderRegistryService);
      resolveSpy = vi.spyOn(registry, 'resolveFor').mockResolvedValue({
        provider: {
          descriptor: { medium: 'SMS', name: 'stub-sms', capabilities: ['status'] },
          getStatus,
        } as any,
        config: {},
        source: 'tenant',
      });
    }

    afterEach(() => {
      resolveSpy?.mockRestore();
      resolveSpy = undefined;
      getStatus.mockReset();
    });

    it('200: asks the sending company and returns the row as DELIVERED', async () => {
      stubProvider();
      getStatus.mockResolvedValue({ status: 'DELIVERED', code: '000' });
      const id = await sentLog();

      const res = await check(id).expect(200);

      expect(getStatus).toHaveBeenCalledWith('vendor-7', {});
      expect(res.body).toMatchObject({ id, status: 'DELIVERED', provider: 'stub-sms' });
      expect(res.body).not.toHaveProperty('metadata');
    });

    it('200 for OFFICE_STAFF too (D35: the page permission only)', async () => {
      stubProvider();
      getStatus.mockResolvedValue({ status: 'PENDING' });
      const id = await sentLog();

      const res = await check(id, officeToken).expect(200);

      expect(res.body.status).toBe('SENT');
    });

    // [#3351 r2] The answer is a log row too: same read-time rules as the list.
    it('the answer masks a share token, and withholds an exam result from ACCOUNTANT', async () => {
      stubProvider();
      getStatus.mockResolvedValue({ status: 'PENDING' });
      const shareToken = 'Q2xhdWRlU2hhcmVUb2tlbl9vbmx5X2luX3RoZV9EQg_-';
      const receipt = await sentLog();
      const result = await sentLog();
      await dataSource.query(
        `UPDATE communication_logs SET message_body = $1, trigger = 'AUTOMATED' WHERE id = $2`,
        [`Paid. https://app.example/i/${shareToken}`, receipt],
      );
      await dataSource.query(
        `UPDATE communication_logs SET message_body = 'GPA 4.50', trigger = 'RESULT_SMS' WHERE id = $1`,
        [result],
      );

      const masked = await check(receipt, accountantToken).expect(200);
      expect(masked.body.message_body).toBe('Paid. https://app.example/i/••••••');
      const withheld = await check(result, accountantToken).expect(200);
      expect(withheld.body).toMatchObject({ message_body: null, body_withheld: true });
    });

    it('the same Idempotency-Key replays the answer; the vendor is asked once', async () => {
      stubProvider();
      getStatus.mockResolvedValue({ status: 'PENDING' });
      const id = await sentLog();
      const key = `check-${randomUUID()}`;

      const first = await check(id).set('Idempotency-Key', key).expect(200);
      const second = await check(id).set('Idempotency-Key', key).expect(200);

      expect(second.body).toEqual(first.body);
      expect(getStatus).toHaveBeenCalledTimes(1);
    });

    it('502 with a fixed sentence when the vendor call fails; never the vendor text', async () => {
      stubProvider();
      getStatus.mockRejectedValue(new Error('secret-vendor-text'));
      const id = await sentLog();

      const res = await check(id).expect(502);

      expect(JSON.stringify(res.body)).not.toContain('secret-vendor-text');
    });

    it('409 when the message is not SENT (no vendor call)', async () => {
      stubProvider();
      const batchId = await createBatch(TENANT_ID);
      const failed = await createBatchLog(batchId, TENANT_ID, {
        status: 'FAILED',
        metadata: { provider: 'stub-sms' },
      });

      await check(failed).expect(409);
      expect(getStatus).not.toHaveBeenCalled();
    });

    it('409 when the log names no company that declares the status capability', async () => {
      // Real resolver: an unknown provider name for SMS is "not configured", not a crash.
      const batchId = await createBatch(TENANT_ID);
      const id = await createBatchLog(batchId, TENANT_ID, {
        status: 'SENT',
        metadata: { provider: 'no-such-company' },
      });
      await dataSource.query(
        `UPDATE communication_logs SET provider_message_id = 'vendor-8' WHERE id = $1`,
        [id],
      );

      const res = await check(id).expect(409);
      expect(JSON.stringify(res.body)).not.toContain('no-such-company');
    });

    it('404 for another school’s log id, and the row is untouched', async () => {
      stubProvider();
      const foreign = await sentLog(OTHER_TENANT_ID);

      await check(foreign).expect(404);

      expect(getStatus).not.toHaveBeenCalled();
      const [{ status }] = await dataSource.query(
        `SELECT status FROM communication_logs WHERE id = $1`,
        [foreign],
      );
      expect(status).toBe('SENT');
    });

    it('400 for a non-UUID id', async () => {
      await check('not-a-uuid').expect(400);
    });

    it('403 for a TEACHER (no COMMUNICATION_BULK_SEND)', async () => {
      await check(randomUUID(), teacherToken).expect(403);
    });

    it('401 without an X-Tenant-ID header', async () => {
      await supertest(app.getHttpServer())
        .post(`/api/v1/communications/logs/${randomUUID()}/check-status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('401 for an X-Tenant-ID that matches no school, or one the caller is not a member of', async () => {
      await check(randomUUID(), token, '00000000-0000-4000-8000-000000000fff').expect(401);
      await check(randomUUID(), otherTenantAdminToken, TENANT_ID).expect(401);
    });
  });

  // [97.4.02] D22: the Company and Sent-by choices on the log's own permission.
  describe('GET /communications/logs/filter-options', () => {
    const getOptions = (t = token, tenant: string | null = TENANT_ID) => {
      const req = supertest(app.getHttpServer())
        .get('/api/v1/communications/logs/filter-options')
        .set('Authorization', `Bearer ${t}`);
      return tenant ? req.set('X-Tenant-ID', tenant) : req;
    };

    it('ADMIN: every company, and only this school senders', async () => {
      const mine = await createBatchLog(await createBatch(TENANT_ID), TENANT_ID);
      await dataSource.query(`UPDATE communication_logs SET sent_by_user_id = $1 WHERE id = $2`, [
        OFFICE_USER_ID,
        mine,
      ]);
      const foreign = await createBatchLog(await createBatch(OTHER_TENANT_ID), OTHER_TENANT_ID);
      await dataSource.query(`UPDATE communication_logs SET sent_by_user_id = $1 WHERE id = $2`, [
        OTHER_ADMIN_USER_ID,
        foreign,
      ]);

      const res = await getOptions().expect(200);

      expect(res.body.companies).toContainEqual({
        name: 'onecodesoft',
        medium: 'SMS',
        label: expect.objectContaining({ en: expect.any(String), bn: expect.any(String) }),
      });
      const senderIds = res.body.senders.map((s: { id: string }) => s.id);
      expect(senderIds).toContain(OFFICE_USER_ID);
      // Tenant isolation: the other school's sender never shows here.
      expect(senderIds).not.toContain(OTHER_ADMIN_USER_ID);
      // One entry per sender, however many messages they sent.
      expect(new Set(senderIds).size).toBe(senderIds.length);
    });

    it('leaves out a staff member whose only messages are app notifications (PUSH)', async () => {
      const push = await createBatchLog(await createBatch(TENANT_ID), TENANT_ID);
      await dataSource.query(
        `UPDATE communication_logs SET medium = 'PUSH', recipient_address = 'push:x', sent_by_user_id = $1 WHERE id = $2`,
        [TEACHER_USER_ID, push],
      );

      const res = await getOptions().expect(200);

      expect(res.body.senders.map((s: { id: string }) => s.id)).not.toContain(TEACHER_USER_ID);
    });

    it('OFFICE_STAFF (holds COMMUNICATION_BULK_SEND, not SETTINGS_MANAGE or USER_READ) gets 200', async () => {
      await getOptions(officeToken).expect(200);
    });

    it('403 for a TEACHER (no COMMUNICATION_BULK_SEND)', async () => {
      await getOptions(teacherToken).expect(403);
    });

    it('401 without an X-Tenant-ID header', async () => {
      await getOptions(token, null).expect(401);
    });

    it('401 for an X-Tenant-ID that matches no school, or one the caller is not a member of', async () => {
      await getOptions(token, '00000000-0000-4000-8000-000000000fff').expect(401);
      await getOptions(otherTenantAdminToken, TENANT_ID).expect(401);
    });
  });

  it('GET /communications/logs: 401 without an X-Tenant-ID header', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/communications/logs')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  describe('GET /communications/reminder/bulk/:id/logs', () => {
    it('returns only the batch own logs, with the failure reason surfaced', async () => {
      const batchId = await createBatch(TENANT_ID);
      const otherBatchId = await createBatch(TENANT_ID);
      await createBatchLog(batchId, TENANT_ID, {
        status: 'FAILED',
        metadata: { error: 'No provider registered for medium "SMS"' },
      });
      await createBatchLog(otherBatchId, TENANT_ID);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/communications/reminder/bulk/${batchId}/logs`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        status: 'FAILED',
        error: 'NO_PROVIDER',
      });
      // [97.4.02] Same row shape as the message log (D22 row detail), so the body is in it.
      expect(res.body.data[0]).toMatchObject({ message_body: 'Dear guardian', batch_id: batchId });
    });

    it('paginates the logs', async () => {
      const batchId = await createBatch(TENANT_ID);
      await createBatchLog(batchId, TENANT_ID);
      await createBatchLog(batchId, TENANT_ID);
      await createBatchLog(batchId, TENANT_ID);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/communications/reminder/bulk/${batchId}/logs?page=2&limit=2`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.totalPages).toBe(2);
    });

    it('404s for a batch belonging to another tenant', async () => {
      const foreignBatchId = await createBatch(OTHER_TENANT_ID);
      await createBatchLog(foreignBatchId, OTHER_TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`/api/v1/communications/reminder/bulk/${foreignBatchId}/logs`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });

    it('404s for a batch that does not exist', async () => {
      await supertest(app.getHttpServer())
        .get(`/api/v1/communications/reminder/bulk/${randomUUID()}/logs`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });
  // Mandatory per server/CLAUDE.md: every route is exercised by a role the
  // route's permission excludes, and by a tenant header the caller has no
  // membership in. PermissionsGuard answers a role without the permission
  // with 403; a bad tenant header is still 401.
  describe('authorization and tenant scoping', () => {
    const routes: Array<{ name: string; call: (t: string, tenant: string) => supertest.Test }> = [
      {
        name: 'GET /communications/reminder/bulk',
        call: (t, tenant) =>
          supertest(app.getHttpServer())
            .get('/api/v1/communications/reminder/bulk')
            .set('Authorization', `Bearer ${t}`)
            .set('X-Tenant-ID', tenant),
      },
      {
        name: 'POST /communications/reminder/bulk/preview',
        call: (t, tenant) =>
          supertest(app.getHttpServer())
            .post('/api/v1/communications/reminder/bulk/preview')
            .set('Authorization', `Bearer ${t}`)
            .set('X-Tenant-ID', tenant)
            .send({ student_ids: [randomUUID()], message_template: 'Dear {{guardian_name}}' }),
      },
      {
        name: 'GET /communications/reminder/bulk/:id/logs',
        call: (t, tenant) =>
          supertest(app.getHttpServer())
            .get(`/api/v1/communications/reminder/bulk/${randomUUID()}/logs`)
            .set('Authorization', `Bearer ${t}`)
            .set('X-Tenant-ID', tenant),
      },
      // #3351 r2 (#3343): the per-person filters of the student and guardian Messages link.
      {
        name: 'GET /communications/logs (student_id / guardian_id)',
        call: (t, tenant) =>
          supertest(app.getHttpServer())
            .get('/api/v1/communications/logs')
            .query({ student_id: randomUUID(), guardian_id: randomUUID() })
            .set('Authorization', `Bearer ${t}`)
            .set('X-Tenant-ID', tenant),
      },
      // Review round 1 on #3347: the message log with the new filters (TEACHER, foreign and
      // unknown X-Tenant-ID).
      {
        name: 'GET /communications/logs (filtered)',
        call: (t, tenant) =>
          supertest(app.getHttpServer())
            .get('/api/v1/communications/logs')
            .query({ medium: 'SMS', search: '01712', provider: 'stub-sms' })
            .set('Authorization', `Bearer ${t}`)
            .set('X-Tenant-ID', tenant),
      },
    ];

    for (const route of routes) {
      it(`${route.name} rejects a TEACHER — a role without the permission`, async () => {
        await route.call(teacherToken, TENANT_ID).expect(403);
      });

      it(`${route.name} rejects an X-Tenant-ID the caller has no membership in`, async () => {
        // Right role, wrong school: an ADMIN of the other tenant cannot
        // borrow this tenant's header to read its reminders. Tenant here is
        // resolved from the header alone (no tenant path param), so the
        // guard answers 401 rather than the 403 a path-scoped route gives.
        await route.call(otherTenantAdminToken, TENANT_ID).expect(401);
      });

      it(`${route.name} rejects an X-Tenant-ID that matches no school`, async () => {
        await route.call(token, '00000000-0000-4000-8000-000000000fff').expect(401);
      });
    }
  });

  // [#2259] Freeform send goes only to a guardian of this school; the
  // address is read from the guardian's record.
  describe('POST /communications/send', () => {
    const post = (t: string, body: object) =>
      supertest(app.getHttpServer())
        .post('/api/v1/communications/send')
        .set('Authorization', `Bearer ${t}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send(body);

    it('TEACHER -> 403', async () => {
      const guardianId = await createGuardian(await createStudent());
      await post(teacherToken, {
        medium: 'SMS',
        guardian_id: guardianId,
        message_body: 'Hi',
      }).expect(403);
    });

    it('OFFICE_STAFF + guardian of this school -> 201, logged address is the guardian phone', async () => {
      const guardianId = await createGuardian(await createStudent(), { phone: '01755500001' });
      const res = await post(officeToken, {
        medium: 'SMS',
        guardian_id: guardianId,
        message_body: 'Hi',
      }).expect(201);
      const [log] = await dataSource.query(
        `SELECT recipient_address, guardian_id FROM communication_logs WHERE id = $1`,
        [res.body.id],
      );
      expect(log.recipient_address).toBe('01755500001');
      expect(log.guardian_id).toBe(guardianId);
    });

    it('no guardian_id -> 400', async () => {
      await post(officeToken, { medium: 'SMS', message_body: 'Hi' }).expect(400);
    });

    it('extra recipient_address is rejected by the whitelist -> 400', async () => {
      const guardianId = await createGuardian(await createStudent());
      await post(officeToken, {
        medium: 'SMS',
        guardian_id: guardianId,
        message_body: 'Hi',
        recipient_address: '01999999999',
      }).expect(400);
    });

    it('guardian of tenant B -> 404 and no log written', async () => {
      const [{ id: foreignGuardianId }] = await dataSource.query(
        `INSERT INTO guardians (full_name, relationship, phone, tenant_id)
         VALUES ('Foreign Guardian', 'FATHER', '01766600001', $1) RETURNING id`,
        [OTHER_TENANT_ID],
      );
      await post(officeToken, {
        medium: 'SMS',
        guardian_id: foreignGuardianId,
        message_body: 'Hi',
      }).expect(404);
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS count FROM communication_logs WHERE guardian_id = $1`,
        [foreignGuardianId],
      );
      expect(count).toBe(0);
    });

    it('student_id not linked to the guardian -> 400 GUARDIAN_NOT_LINKED', async () => {
      const guardianId = await createGuardian(await createStudent());
      const res = await post(officeToken, {
        medium: 'SMS',
        guardian_id: guardianId,
        student_id: await createStudent(),
        message_body: 'Hi',
      }).expect(400);
      expect(res.body.details.code).toBe('GUARDIAN_NOT_LINKED');
    });

    it('guardian without an email, EMAIL channel -> 400 GUARDIAN_NO_ADDRESS', async () => {
      const guardianId = await createGuardian(await createStudent());
      const res = await post(officeToken, {
        medium: 'EMAIL',
        guardian_id: guardianId,
        message_body: 'Hi',
      }).expect(400);
      expect(res.body.details.code).toBe('GUARDIAN_NO_ADDRESS');
    });
  });

  // [#2216] A PLATFORM-metered school with 0 credit must not text anyone.
  // Settings are restored after each case so other describes stay unmetered.
  describe('metered tenant SMS credit (#2216)', () => {
    async function setMetering(on: boolean) {
      await dataSource.query(`UPDATE schools SET settings = $2 WHERE id = $1`, [
        TENANT_ID,
        on
          ? JSON.stringify({
              version: 1,
              communications: { sms: { metering: 'PLATFORM', provider: 'test' } },
            })
          : null,
      ]);
      await dataSource.query(`DELETE FROM sms_credit_balance WHERE tenant_id = $1`, [TENANT_ID]);
    }

    afterEach(async () => {
      await setMetering(false);
    });

    it('POST /communications/send with 0 credit -> 409 INSUFFICIENT_SMS_CREDIT', async () => {
      const guardianId = await createGuardian(await createStudent(), { name: 'Metered Parent' });
      await setMetering(true);
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/communications/send')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ medium: 'SMS', guardian_id: guardianId, message_body: 'Hello' })
        .expect(409);
      expect(res.body.details.code).toBe('INSUFFICIENT_SMS_CREDIT');
      expect(res.body.details.required).toBe(1);
      expect(res.body.details.available).toBe(0);
      // Refused before the log row is written, so no job can exist either.
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS count FROM communication_logs WHERE tenant_id = $1 AND recipient_name = 'Metered Parent'`,
        [TENANT_ID],
      );
      expect(count).toBe(0);
    });

    it('POST /communications/reminder/single/:studentId with 0 credit -> 409', async () => {
      const studentId = await createStudent();
      await createGuardian(studentId);
      await createFee(studentId); // single reminder 400s without an open due
      await setMetering(true);
      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/communications/reminder/single/${studentId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ message_template: 'Dear {{guardian_name}}, reminder' })
        .expect(409);
      expect(res.body.details.code).toBe('INSUFFICIENT_SMS_CREDIT');
      expect(res.body.details.required).toBeGreaterThan(0);
      expect(res.body.details.available).toBe(0);
      // The whole send is refused: no guardian got a log row (or a job).
      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS count FROM communication_logs WHERE tenant_id = $1 AND student_id = $2`,
        [TENANT_ID, studentId],
      );
      expect(count).toBe(0);
    });

    it('an unmetered tenant still sends (201)', async () => {
      const guardianId = await createGuardian(await createStudent(), { name: 'Unmetered Parent' });
      await supertest(app.getHttpServer())
        .post('/api/v1/communications/send')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ medium: 'SMS', guardian_id: guardianId, message_body: 'Hello' })
        .expect(201);
    });
  });

  describe('Idempotency-Key on sends [#2631]', () => {
    const idemPost = (path: string, key: string, body: object) =>
      supertest(app.getHttpServer())
        .post(`/api/v1/communications/${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('Idempotency-Key', key)
        .send(body);

    const count = async (sql: string, params: unknown[]) =>
      (await dataSource.query(sql, params))[0].n as number;

    it('send: the same key twice gives the same 201 body and ONE communication_logs row', async () => {
      const guardianId = await createGuardian(await createStudent(), { name: 'Idem Parent' });
      const key = `send-${randomUUID()}`;
      const body = { medium: 'SMS', guardian_id: guardianId, message_body: 'Hello' };

      const first = await idemPost('send', key, body).expect(201);
      const second = await idemPost('send', key, body).expect(201);

      expect(second.body).toEqual(first.body);
      expect(
        await count(
          `SELECT count(*)::int AS n FROM communication_logs WHERE tenant_id = $1 AND guardian_id = $2`,
          [TENANT_ID, guardianId],
        ),
      ).toBe(1);
    });

    it('send: a different key sends again', async () => {
      const guardianId = await createGuardian(await createStudent());
      const body = { medium: 'SMS', guardian_id: guardianId, message_body: 'Hello' };
      await idemPost('send', `a-${randomUUID()}`, body).expect(201);
      await idemPost('send', `b-${randomUUID()}`, body).expect(201);
      expect(
        await count(`SELECT count(*)::int AS n FROM communication_logs WHERE guardian_id = $1`, [
          guardianId,
        ]),
      ).toBe(2);
    });

    it('send: a malformed key is a 400 that does not echo it', async () => {
      const res = await idemPost('send', 'bad key!', {}).expect(400);
      expect(JSON.stringify(res.body)).not.toContain('bad key!');
    });

    it('reminder/bulk: the same key twice gives ONE reminder_batches row', async () => {
      const studentId = await createStudent();
      await createGuardian(studentId);
      await createFee(studentId);
      const key = `bulk-${randomUUID()}`;
      const body = {
        student_ids: [studentId],
        message_template: 'Dear {{guardian_name}}, {{student_name}} owes {{due_amount}}.',
      };

      const first = await idemPost('reminder/bulk', key, body).expect(201);
      const second = await idemPost('reminder/bulk', key, body).expect(201);

      expect(second.body).toEqual(first.body);
      expect(await count(`SELECT count(*)::int AS n FROM reminder_batches`, [])).toBe(1);
    });

    it('reminder/single: the same key twice sends once', async () => {
      const studentId = await createStudent();
      await createGuardian(studentId);
      await createFee(studentId);
      const key = `single-${randomUUID()}`;
      const body = { message_template: 'Dear {{guardian_name}}, reminder' };

      const first = await idemPost(`reminder/single/${studentId}`, key, body).expect(201);
      const second = await idemPost(`reminder/single/${studentId}`, key, body).expect(201);

      expect(second.body).toEqual(first.body);
      expect(
        await count(
          `SELECT count(*)::int AS n FROM communication_logs WHERE tenant_id = $1 AND student_id = $2`,
          [TENANT_ID, studentId],
        ),
      ).toBe(1);
    });

    it('Redis rejecting the idempotency calls still sends (fail open)', async () => {
      const redis = app.get<{ set: (...a: unknown[]) => Promise<unknown> }>(TENANT_STATUS_REDIS);
      const realSet = redis.set.bind(redis);
      const spy = vi
        .spyOn(redis, 'set')
        .mockImplementation((...args: unknown[]) =>
          String(args[0]).startsWith('idem:')
            ? Promise.reject(new Error('redis down'))
            : realSet(...args),
        );
      try {
        const guardianId = await createGuardian(await createStudent());
        await idemPost('send', `down-${randomUUID()}`, {
          medium: 'SMS',
          guardian_id: guardianId,
          message_body: 'Hello',
        }).expect(201);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

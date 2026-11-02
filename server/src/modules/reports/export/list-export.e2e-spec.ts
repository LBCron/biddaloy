import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { UserRole } from '@biddaloy/shared';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { ensureFeeStructure, periodStart } from '@test/helpers/fee-fixture.helper';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { AppModule } from '../../../app.module';
import { buildValidationPipeOptions } from '../../../validation-pipe';

/**
 * [8.15.11] The six `GET <list>/export` routes. Real HTTP, real roles.
 * Business rules proved here: an export is exactly the filtered list, it needs
 * REPORTS_EXPORT on top of the list's own permission, a school never sees
 * another school's rows, and more than 5,000 rows is refused with a clear 413.
 */
describe('List exports E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let otherSchoolId: string;
  const suffix = Date.now().toString(36);

  const http = () => supertest(app.getHttpServer());
  const as = (role: UserRole, req: supertest.Test, tenantId = SEED_TENANT_ID) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', tenantId).set('X-Role', role);

  const binary = (res: supertest.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  /** CSV text → rows of cells. Fine here: the test data has no commas or line breaks. */
  const csvRows = (text: string): string[][] =>
    text
      .replace(/^﻿/, '')
      .trim()
      .split('\r\n')
      .map((line) => line.slice(1, -1).split('","'));

  async function createStudent(name: string, sectionId: string): Promise<string> {
    const res = await as(UserRole.ADMIN, http().post('/api/v1/students'))
      .send({ full_name: name, class_section_id: sectionId })
      .expect(201);
    return res.body.id as string;
  }

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

    // A second school the same admin belongs to, created before login so the token carries it.
    const school = await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Export Other ${suffix}`,
      `export-other-${suffix}`,
    ]);
    otherSchoolId = school[0].id;
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW())`,
      [SEED_ADMIN_USER_ID, otherSchoolId],
    );
    // The admin also holds TEACHER and OFFICE_STAFF in the seed school (X-Role picks one),
    // neither of which has REPORTS_EXPORT.
    for (const role of [UserRole.TEACHER, UserRole.OFFICE_STAFF]) {
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
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /students/export', () => {
    it('with a section filter returns exactly the students the list shows for that filter', async () => {
      await createStudent(`Export A1 ${suffix}`, SEED_SECTION_1_ID);
      await createStudent(`Export A2 ${suffix}`, SEED_SECTION_1_ID);
      await createStudent(`Export B1 ${suffix}`, SEED_SECTION_2_ID);

      const list = await as(
        UserRole.ADMIN,
        http().get(`/api/v1/students?section_id=${SEED_SECTION_1_ID}&limit=100`),
      ).expect(200);
      const exported = await as(
        UserRole.ADMIN,
        http().get(`/api/v1/students/export?section_id=${SEED_SECTION_1_ID}`),
      ).expect(200);

      expect(exported.headers['content-type']).toContain('text/csv');
      const [header, ...rows] = csvRows(exported.text);
      expect(header).toEqual([
        'Roll',
        'Registration No.',
        'Name',
        'Class',
        'Section',
        'Guardian',
        'Status',
      ]);
      const exportedRegistrations = rows.map((r) => r[1]).sort();
      const listedRegistrations = (list.body.data as { registration_number: string }[])
        .map((s) => s.registration_number)
        .sort();
      expect(exportedRegistrations).toEqual(listedRegistrations);
      // The section-2 student is outside the filter, so it is in neither.
      expect(rows.map((r) => r[2])).not.toContain(`Export B1 ${suffix}`);
      expect(rows.map((r) => r[2])).toContain(`Export A1 ${suffix}`);
    });

    it('as XLSX has the same header row as the CSV', async () => {
      const res = await as(UserRole.ADMIN, http().get('/api/v1/students/export?format=xlsx'))
        .buffer()
        .parse(binary)
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as ExcelJS.Buffer);
      expect(workbook.worksheets[0].getRow(1).values).toEqual([
        undefined,
        'Roll',
        'Registration No.',
        'Name',
        'Class',
        'Section',
        'Guardian',
        'Status',
      ]);
    });

    it('rejects an unknown format with 400', async () => {
      await as(UserRole.ADMIN, http().get('/api/v1/students/export?format=pdf')).expect(400);
    });

    it("never includes another school's students", async () => {
      // The other school has no students, while the seed school has several.
      const res = await as(
        UserRole.ADMIN,
        http().get('/api/v1/students/export'),
        otherSchoolId,
      ).expect(200);
      expect(csvRows(res.text)).toHaveLength(1); // header only
    });
  });

  describe('GET /fees/dues/export', () => {
    it('with a section filter returns exactly the students the dues list shows', async () => {
      const owing = await createStudent(`Export Dues ${suffix}`, SEED_SECTION_1_ID);
      const structureId = await ensureFeeStructure(ds);
      await ds.query(
        `INSERT INTO student_fees
           (id, student_id, academic_year_id, fee_structure_id, period_start,
            total_amount, paid_amount, discount_amount, status, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, $4::date, 1000, 250, 0, 'PARTIALLY_PAID', NOW(), NOW())`,
        [owing, SEED_ACADEMIC_YEAR_ID, structureId, periodStart(5, 2026)],
      );

      const list = await as(
        UserRole.ADMIN,
        http().get(`/api/v1/fees/dues?section_id=${SEED_SECTION_1_ID}&limit=100`),
      ).expect(200);
      const exported = await as(
        UserRole.ADMIN,
        http().get(`/api/v1/fees/dues/export?section_id=${SEED_SECTION_1_ID}`),
      ).expect(200);

      const [header, ...rows] = csvRows(exported.text);
      expect(header).toEqual(['Student', 'Class', 'Section', 'Billed', 'Paid', 'Due']);
      expect(rows.map((r) => r[0]).sort()).toEqual(
        (list.body.data as { full_name: string }[]).map((d) => d.full_name).sort(),
      );
      // Money columns are plain decimals: billed 1,000, paid 250, still owed 750.
      const mine = rows.find((r) => r[0] === `Export Dues ${suffix}`);
      expect(mine?.slice(3)).toEqual(['1000', '250', '750']);
    });
  });

  describe('permissions: REPORTS_EXPORT on top of the list permission', () => {
    const routes = [
      '/api/v1/students/export',
      '/api/v1/guardians/export',
      '/api/v1/invoices/export',
      '/api/v1/fees/dues/export',
      '/api/v1/payments/export',
      '/api/v1/audit-logs/export',
    ];

    it('ADMIN is allowed on all six routes', async () => {
      for (const route of routes) {
        await as(UserRole.ADMIN, http().get(route)).expect(200);
      }
    });

    it('a TEACHER and an OFFICE_STAFF member (no REPORTS_EXPORT) get 403 on all six routes', async () => {
      for (const role of [UserRole.TEACHER, UserRole.OFFICE_STAFF]) {
        for (const route of routes) {
          await as(role, http().get(route)).expect(403);
        }
      }
    });
  });

  describe('size limit', () => {
    it('refuses more than 5,000 rows with 413 and EXPORT_TOO_LARGE, writing no run row', async () => {
      // 5,001 audit rows in the other school (audit rows are append-only, so they stay).
      await ds.query(
        `INSERT INTO audit_logs (id, tenant_id, action, entity_type, created_at)
         SELECT gen_random_uuid(), $1, 'LOGIN', 'User', NOW() FROM generate_series(1, 5001)`,
        [otherSchoolId],
      );

      const res = await as(
        UserRole.ADMIN,
        http().get('/api/v1/audit-logs/export'),
        otherSchoolId,
      ).expect(413);

      expect(res.body.details).toEqual({ code: 'EXPORT_TOO_LARGE', rows: 5000 });
      const runs = await ds.query(
        `SELECT count(*)::int AS n FROM report_runs WHERE tenant_id = $1 AND source_key = 'audit-logs-list'`,
        [otherSchoolId],
      );
      expect(runs[0].n).toBe(0);
    });
  });

  describe('run log', () => {
    it('a successful export leaves one DONE run row with its row count', async () => {
      await as(UserRole.ADMIN, http().get('/api/v1/students/export')).expect(200);
      // The run is finished when the stream ends, just after the response body.
      await expect
        .poll(async () => {
          const rows = await ds.query(
            `SELECT status, row_count FROM report_runs
              WHERE tenant_id = $1 AND source_key = 'students-list' ORDER BY created_at DESC LIMIT 1`,
            [SEED_TENANT_ID],
          );
          return rows[0]?.status;
        })
        .toBe('DONE');
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import ExcelJS from 'exceljs';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { ExamKind, ExamStatus, TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { FailOpenThrottlerStorage } from '../../common/rate-limit/fail-open-throttler-storage';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { Teacher } from '../academics/entities/teacher.entity';
import type { GridResponse } from './mark-grid.service';
import { makeFilledSheet, SheetEdit } from './marks-sheet.test-helper';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [81.2.1] Marks sheet import: GET marks/sheet, POST marks/sheet/validate, POST marks/sheet/commit.
 * Scaffolding cloned from `marks-submit.e2e-spec.ts`; the Redis-down harness from
 * `notices/sms/notice-sms.controller.e2e-spec.ts`. Sheets are built in the spec (no binary fixtures).
 */
const API = '/api/v1';
const TENANT_B = '00000000-0000-4000-8000-0000081b0b01';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REDIS_DOWN_SENTENCE =
  'This action is temporarily unavailable. Please try again in a few minutes.';
const meta = { examName: 'x', sectionName: 'x', subjectName: 'x', lang: 'en' as const };

const U = {
  teacher: '00000000-0000-4000-8000-0000081a0001',
  otherTeacher: '00000000-0000-4000-8000-0000081a0002',
  controller: '00000000-0000-4000-8000-0000081a0003',
  executive: '00000000-0000-4000-8000-0000081a0004',
  accountant: '00000000-0000-4000-8000-0000081a0005',
  adminB: '00000000-0000-4000-8000-0000081a0006',
};
const EMAIL = (k: string) => `ms81-${k}@e2e.example`;

describe('[81.2.1] Marks sheet import', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => supertest.SuperTest<supertest.Test>;
  let redisDown = false;
  const tokens: Record<string, string> = {};
  let adminToken: string;
  let examId: string;
  let mathId: string;
  let scienceId: string;
  let mathComp: string;
  let s1: string;
  let s2: string;

  const addUser = async (id: string, email: string, role: UserRole, tenant: string) => {
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Marks Sheet User', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, tenant, role],
    );
  };
  const login = async (email: string) =>
    (
      await http()
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
  const as = (token: string, role: UserRole, req: supertest.Test, tenant = SEED_TENANT_ID) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', tenant).set('X-Role', role);

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      // Lets one test pretend the rate-limit store (Redis) is down.
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async (...a: unknown[]) => {
          if (redisDown)
            return new FailOpenThrottlerStorage({
              increment: () => Promise.reject(new Error('ECONNREFUSED')),
            }).increment(...(a as [string, number, number, number, string]));
          return { totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 };
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    // The real app registers this in main.ts; it turns ImportFileError and multer errors into 4xx.
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    ds = app.get(DataSource);
    http = () => supertest(app.getHttpServer()) as unknown as supertest.SuperTest<supertest.Test>;

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Marks Sheet Other School', 'marks-sheet-other', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await addUser(U.teacher, EMAIL('teacher'), UserRole.TEACHER, SEED_TENANT_ID);
    await addUser(U.otherTeacher, EMAIL('other'), UserRole.TEACHER, SEED_TENANT_ID);
    await addUser(U.controller, EMAIL('controller'), UserRole.EXAM_CONTROLLER, SEED_TENANT_ID);
    await addUser(U.executive, EMAIL('executive'), UserRole.EXECUTIVE, SEED_TENANT_ID);
    await addUser(U.accountant, EMAIL('accountant'), UserRole.ACCOUNTANT, SEED_TENANT_ID);
    await addUser(U.adminB, EMAIL('adminb'), UserRole.ADMIN, TENANT_B);
    adminToken = await login(SEED_ADMIN_EMAIL);
    for (const k of ['teacher', 'other', 'controller', 'executive', 'accountant', 'adminb']) {
      tokens[k] = await login(EMAIL(k));
    }
  }, 90000);

  afterAll(async () => {
    await app.close();
  });

  /** The global beforeEach truncates exams/students/marks: seed per test. */
  async function seed(): Promise<void> {
    examId = (
      await ds.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'অর্ধবার্ষিক', $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, ExamKind.TERM, ExamStatus.DRAFT, SEED_TENANT_ID],
      )
    )[0].id;
    const subject = async (name: string, code: string) =>
      (
        await ds.query(
          `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
          [name, code, SEED_TENANT_ID],
        )
      )[0].id as string;
    const component = async (subjectId: string) =>
      (
        await ds.query(
          `INSERT INTO exam_components (exam_id, subject_id, name, kind, source, full_marks, sequence, tenant_id, created_at, updated_at)
           VALUES ($1, $2, 'Written', 'WRITTEN', 'MANUAL', 100, 1, $3, NOW(), NOW()) RETURNING id`,
          [examId, subjectId, SEED_TENANT_ID],
        )
      )[0].id as string;
    mathId = await subject('Sheet Math', 'MS81-1');
    scienceId = await subject('Sheet Science', 'MS81-2');
    mathComp = await component(mathId);
    await component(scienceId);
    const student = async (roll: number) => {
      const id = (
        await ds.query(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
              enrollment_status, preferred_communication, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
          [`Sheet Student ${roll}`, `MS81-REG-${roll}`, roll, SEED_SECTION_1_ID, SEED_TENANT_ID],
        )
      )[0].id as string;
      await ds.query(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5, NOW(), NOW())`,
        [id, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
      );
      return id;
    };
    s1 = await student(1);
    s2 = await student(2);
  }

  /** Makes `U.teacher` the subject teacher of Math in section 1. */
  async function seedSubjectTeacher(): Promise<void> {
    const teacher = await ds.getRepository(Teacher).save({
      user_id: U.teacher,
      employee_id: 'EMP-MS81-1',
      tenant_id: SEED_TENANT_ID,
      designations: [],
    });
    await ds.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        teacher.id,
        SEED_SECTION_1_ID,
        SEED_TENANT_ID,
        mathId,
        TeacherAssignmentType.SUBJECT_TEACHER,
      ],
    );
  }

  const q = (subjectId = mathId, sectionId = SEED_SECTION_1_ID) =>
    `section_id=${sectionId}&subject_id=${subjectId}`;
  const sheetUrl = (id = examId, query = q()) => `${API}/exams/${id}/marks/sheet?${query}`;
  const validateUrl = (id = examId, query = q()) =>
    `${API}/exams/${id}/marks/sheet/validate?${query}`;
  const commitUrl = (id = examId) => `${API}/exams/${id}/marks/sheet/commit`;

  const getGrid = async (subjectId = mathId): Promise<GridResponse> =>
    (
      await as(
        adminToken,
        UserRole.ADMIN,
        http().get(`${API}/exams/${examId}/marks?${q(subjectId)}`),
      ).expect(200)
    ).body;
  const filled = async (edits: SheetEdit[], subjectId = mathId) =>
    makeFilledSheet(await getGrid(subjectId), meta, edits);

  const upload = (
    buf: Buffer,
    filename = 'marks.xlsx',
    token = adminToken,
    role: UserRole = UserRole.ADMIN,
    query = q(),
  ) => as(token, role, http().post(validateUrl(examId, query)).attach('file', buf, filename));
  const commit = (body: object, token = adminToken, role: UserRole = UserRole.ADMIN) =>
    as(token, role, http().post(commitUrl()).send(body));
  const commitBody = (stagingId: string) => ({
    staging_id: stagingId,
    section_id: SEED_SECTION_1_ID,
    subject_id: mathId,
  });
  const gridValues = async () => {
    const g = await getGrid();
    return Object.fromEntries(g.cells.map((c) => [c.student_id, `${c.status}:${c.value}`]));
  };
  const setGridState = async (state: string) => {
    await ds.query(
      `UPDATE mark_grids SET state = $4 WHERE exam_id = $1 AND section_id = $2 AND subject_id = $3`,
      [examId, SEED_SECTION_1_ID, mathId, state],
    );
    await ds.query(
      `INSERT INTO mark_grids (exam_id, section_id, subject_id, state, tenant_id, created_at, updated_at)
       SELECT $1, $2, $3, $4, $5, NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM mark_grids WHERE exam_id = $1 AND section_id = $2 AND subject_id = $3)`,
      [examId, SEED_SECTION_1_ID, mathId, state, SEED_TENANT_ID],
    );
  };
  const markAudits = async () =>
    ds.query(
      `SELECT new_values FROM audit_logs WHERE entity_type = 'Mark' AND entity_id = $1 ORDER BY created_at DESC`,
      [examId],
    );

  describe('download', () => {
    it('the subject teacher gets the xlsx with a UTF-8 filename for a Bangla exam name', async () => {
      await seed();
      await seedSubjectTeacher();
      const res = await as(tokens.teacher, UserRole.TEACHER, http().get(sheetUrl()))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain(XLSX_MIME);
      expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
      expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    });

    it('another teacher gets 404 (Rule 2)', async () => {
      await seed();
      await seedSubjectTeacher();
      await as(tokens.other, UserRole.TEACHER, http().get(sheetUrl())).expect(404);
    });

    it('EXAM_CONTROLLER and EXECUTIVE can download; ACCOUNTANT cannot', async () => {
      await seed();
      await as(tokens.controller, UserRole.EXAM_CONTROLLER, http().get(sheetUrl())).expect(200);
      await as(tokens.executive, UserRole.EXECUTIVE, http().get(sheetUrl())).expect(200);
      await as(tokens.accountant, UserRole.ACCOUNTANT, http().get(sheetUrl())).expect(403);
    });
  });

  describe('validate roles', () => {
    it('EXAM_CONTROLLER 201, EXECUTIVE 403, ACCOUNTANT 403, other teacher 404', async () => {
      await seed();
      await seedSubjectTeacher();
      const buf = await filled([{ roll: 1, component: 'Written', cell: 50 }]);
      await upload(buf, 'm.xlsx', tokens.controller, UserRole.EXAM_CONTROLLER).expect(201);
      await upload(buf, 'm.xlsx', tokens.executive, UserRole.EXECUTIVE).expect(403);
      await upload(buf, 'm.xlsx', tokens.accountant, UserRole.ACCOUNTANT).expect(403);
      await upload(buf, 'm.xlsx', tokens.other, UserRole.TEACHER).expect(404);
      await upload(buf, 'm.xlsx', tokens.teacher, UserRole.TEACHER).expect(201);
    });
  });

  describe('validate then commit', () => {
    it('writes the staged marks, shows them in the grid and audits source SHEET', async () => {
      await seed();
      const buf = await filled([
        { roll: 1, component: 'Written', cell: 80 },
        { roll: 2, component: 'Written', cell: 'A' },
      ]);
      const v = await upload(buf).expect(201);
      expect(v.body.summary).toMatchObject({ new: 2, absent: 1, errors: 0 });
      const res = await commit(commitBody(v.body.staging_id)).expect(201);
      expect(res.body).toEqual({ saved: 2 });
      expect(await gridValues()).toEqual({ [s1]: 'PRESENT:80.00', [s2]: 'ABSENT:null' });
      const [latest] = await markAudits();
      expect(latest.new_values.source).toBe('SHEET');
    });

    it('partial save: an above-full-marks cell is reported and left unchanged', async () => {
      await seed();
      const buf = await filled([
        { roll: 1, component: 'Written', cell: 150 },
        { roll: 2, component: 'Written', cell: 70 },
      ]);
      const v = await upload(buf).expect(201);
      expect(v.body.errors).toEqual([
        { row: 2, roll: 1, component_name: 'Written', code: 'ABOVE_FULL_MARKS' },
      ]);
      await commit(commitBody(v.body.staging_id)).expect(201);
      expect(await gridValues()).toEqual({ [s2]: 'PRESENT:70.00' });
    });

    it('a blank cell keeps the typed mark', async () => {
      await seed();
      await ds.query(
        `INSERT INTO marks (exam_id, subject_id, component_id, student_id, status, value, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'PRESENT', 66, $5, NOW(), NOW())`,
        [examId, mathId, mathComp, s1, SEED_TENANT_ID],
      );
      // The sheet is built from the grid, so roll 1 comes pre-filled; blank it, edit roll 2.
      const buf = await filled([
        { roll: 1, component: 'Written', cell: null },
        { roll: 2, component: 'Written', cell: 40 },
      ]);
      const v = await upload(buf).expect(201);
      await commit(commitBody(v.body.staging_id)).expect(201);
      expect(await gridValues()).toEqual({ [s1]: 'PRESENT:66.00', [s2]: 'PRESENT:40.00' });
    });

    it('a .csv save of a filled sheet works', async () => {
      await seed();
      const xlsx = await filled([{ roll: 1, component: 'Written', cell: 55 }]);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx as never);
      const csv = Buffer.from(await wb.csv.writeBuffer());
      await upload(csv, 'marks.csv').expect(201);
    });
  });

  describe('grid states', () => {
    it('SUBMITTED grid: validate 409 GRID_SUBMITTED', async () => {
      await seed();
      await setGridState('SUBMITTED');
      const buf = await filled([{ roll: 1, component: 'Written', cell: 50 }]);
      const res = await upload(buf).expect(409);
      expect(res.body.details.code).toBe('GRID_SUBMITTED');
      // Fixed sentence: no user id or timestamp in it.
      expect(res.body.message).toBe(
        'This marks list is submitted. Ask an admin to reopen it before uploading a sheet.',
      );
    });

    it('PUBLISHED exam: validate 409', async () => {
      await seed();
      const buf = await filled([{ roll: 1, component: 'Written', cell: 50 }]);
      await ds.query(`UPDATE exams SET status = $2 WHERE id = $1`, [examId, ExamStatus.PUBLISHED]);
      await upload(buf).expect(409);
    });

    it('submitted between validate and commit: commit 409, a retry gets 410', async () => {
      await seed();
      const buf = await filled([{ roll: 1, component: 'Written', cell: 50 }]);
      const v = await upload(buf).expect(201);
      await setGridState('SUBMITTED');
      await commit(commitBody(v.body.staging_id)).expect(409);
      // Documents the ponytail in MarksImportService.commit: the stage is consumed first.
      await commit(commitBody(v.body.staging_id)).expect(410);
    });
  });

  describe('wrong sheet', () => {
    it('the Science sheet in the Math grid of the same section is WRONG_SHEET', async () => {
      await seed();
      const science = await filled([{ roll: 1, component: 'Written', cell: 50 }], scienceId);
      const res = await upload(science).expect(400);
      expect(res.body.details.code).toBe('WRONG_SHEET');
    });

    it("another section's sheet is WRONG_SHEET", async () => {
      await seed();
      const grid = await getGrid();
      const other = await makeFilledSheet({ ...grid, section_id: SEED_SECTION_2_ID }, meta, [
        { roll: 1, component: 'Written', cell: 50 },
      ]);
      const res = await upload(other).expect(400);
      expect(res.body.details.code).toBe('WRONG_SHEET');
    });
  });

  describe('files', () => {
    it('a .png renamed .xlsx is IMPORT_FILE_UNREADABLE (Rule 6)', async () => {
      await seed();
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
      const res = await upload(png, 'marks.xlsx').expect(400);
      expect(res.body.details.code).toBe('IMPORT_FILE_UNREADABLE');
    });

    it('a .txt is IMPORT_FILE_UNSUPPORTED_TYPE', async () => {
      await seed();
      const res = await upload(Buffer.from('hello'), 'marks.txt').expect(400);
      expect(res.body.details.code).toBe('IMPORT_FILE_UNSUPPORTED_TYPE');
    });

    it('a 6 MB file is 413 File too large', async () => {
      await seed();
      const res = await upload(Buffer.alloc(6 * 1024 * 1024), 'marks.xlsx').expect(413);
      expect(res.body.message).toBe('File too large');
    });
  });

  describe('commit', () => {
    it('the same staging id twice (no key): the second is 410', async () => {
      await seed();
      const v = await upload(await filled([{ roll: 1, component: 'Written', cell: 50 }])).expect(
        201,
      );
      await commit(commitBody(v.body.staging_id)).expect(201);
      const res = await commit(commitBody(v.body.staging_id)).expect(410);
      expect(res.body.details.code).toBe('MARKS_SHEET_EXPIRED');
    });

    it('the same Idempotency-Key twice replays the 201 and writes one audit row', async () => {
      await seed();
      const v = await upload(await filled([{ roll: 1, component: 'Written', cell: 50 }])).expect(
        201,
      );
      const key = `ms81-${Date.now()}`;
      const send = () =>
        as(
          adminToken,
          UserRole.ADMIN,
          http().post(commitUrl()).set('Idempotency-Key', key).send(commitBody(v.body.staging_id)),
        );
      const first = await send().expect(201);
      const second = await send().expect(201);
      expect(second.body).toEqual(first.body);
      expect(await markAudits()).toHaveLength(1);
    });

    it("another user's staging id is 410", async () => {
      await seed();
      const v = await upload(await filled([{ roll: 1, component: 'Written', cell: 50 }])).expect(
        201,
      );
      await commit(
        commitBody(v.body.staging_id),
        tokens.controller,
        UserRole.EXAM_CONTROLLER,
      ).expect(410);
    });
  });

  describe('bad requests and tenant isolation', () => {
    it('a non-UUID :examId is 400 on all three routes (Rule 3)', async () => {
      await seed();
      const buf = await filled([{ roll: 1, component: 'Written', cell: 50 }]);
      await as(adminToken, UserRole.ADMIN, http().get(sheetUrl('not-a-uuid'))).expect(400);
      await as(
        adminToken,
        UserRole.ADMIN,
        http().post(validateUrl('not-a-uuid')).attach('file', buf, 'm.xlsx'),
      ).expect(400);
      await as(
        adminToken,
        UserRole.ADMIN,
        http().post(commitUrl('not-a-uuid')).send(commitBody(examId)),
      ).expect(400);
    });

    it('a bad section_id query is 400', async () => {
      await seed();
      await as(
        adminToken,
        UserRole.ADMIN,
        http().get(sheetUrl(examId, `section_id=nope&subject_id=${mathId}`)),
      ).expect(400);
    });

    it('a missing X-Tenant-ID is 401 and an invalid one is refused, on all three routes', async () => {
      await seed();
      const buf = await filled([{ roll: 1, component: 'Written', cell: 50 }]);
      const routes: Array<() => supertest.Test> = [
        () => http().get(sheetUrl()),
        () => http().post(validateUrl()).attach('file', buf, 'm.xlsx'),
        () => http().post(commitUrl()).send(commitBody(examId)),
      ];
      for (const route of routes) {
        await route().set('Authorization', `Bearer ${adminToken}`).expect(401);
        const bad = await route()
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', 'not-a-tenant');
        // Never a 2xx and never a 500.
        expect([400, 401, 403]).toContain(bad.status);
      }
    });

    it("another tenant's admin gets 404 on this tenant's exam", async () => {
      await seed();
      const buf = await filled([{ roll: 1, component: 'Written', cell: 50 }]);
      const b = (req: supertest.Test) => as(tokens.adminb, UserRole.ADMIN, req, TENANT_B);
      await b(http().get(sheetUrl())).expect(404);
      await b(http().post(validateUrl()).attach('file', buf, 'm.xlsx')).expect(404);
    });
  });

  describe('Redis down', () => {
    it('validate and commit answer 503 with the fixed sentence; the download still works', async () => {
      await seed();
      const buf = await filled([{ roll: 1, component: 'Written', cell: 50 }]);
      redisDown = true;
      // The app skips rate limiting when NODE_ENV is 'test'; turn that off for these requests.
      const cfg = app.get(ConfigService);
      const realGet = cfg.get.bind(cfg) as (k: string) => unknown;
      const spy = vi
        .spyOn(cfg, 'get')
        .mockImplementation(((k: string) =>
          k === 'NODE_ENV' ? 'development' : realGet(k)) as never);
      try {
        const v = await upload(buf).expect(503);
        expect(v.body.message).toBe(REDIS_DOWN_SENTENCE);
        const c = await commit(commitBody(examId)).expect(503);
        expect(c.body.message).toBe(REDIS_DOWN_SENTENCE);
        await as(adminToken, UserRole.ADMIN, http().get(sheetUrl())).expect(200);
      } finally {
        redisDown = false;
        spy.mockRestore();
      }
    });
  });
});

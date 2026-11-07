import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { EnrollmentStatus, ExamKind, ExamStatus, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/http-exception.filter';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { PUBLIC_RESULTS_RATE_LIMIT } from '../../../rate-limit';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Subject } from '../../academics/entities/subject.entity';
import { GradingScale } from '../../grading/entities/grading-scale.entity';
import { Exam } from '../../exams/entities/exam.entity';
import { Result } from '../../exams/entities/result.entity';
import { ResultSubject } from '../../exams/entities/result-subject.entity';
import { Student } from '../../students/entities/student.entity';

const ROOT = 'results.e2e.test';
const BOGUS_TENANT = '00000000-0000-4000-8000-0000000000fe';
const NO_EXAM = '00000000-0000-4000-8000-0000000000aa';

/**
 * [40.5.01] Publishing an exam's results to the school site and the public results routes.
 * The test setup empties data tables before every `it`, so each `it` seeds its own exam.
 */
describe('Public website results (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let teacherToken: string;
  const tag = randomUUID().slice(0, 8);
  const api = () => supertest(app.getHttpServer());

  const admin = (
    method: 'post' | 'patch',
    path: string,
    o: { tenant?: string | null; key?: string } = {},
  ) => {
    let r = api()
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Role', UserRole.ADMIN);
    const tenant = o.tenant === undefined ? SEED_TENANT_ID : o.tenant;
    if (tenant) r = r.set('X-Tenant-ID', tenant);
    return o.key ? r.set('Idempotency-Key', o.key) : r;
  };

  /** Switches the seed school's site on and returns its host. */
  const liveHost = async () => {
    const [{ subdomain }] = await ds.query(
      `SELECT subdomain FROM school_sites WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    await ds.query(
      `UPDATE school_sites SET published = draft, enabled = true WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    return `${subdomain}.${ROOT}`;
  };
  const table = (host: string, body: object) =>
    api()
      .post(`/api/v1/public/site/by-host/${host}/island/results`)
      .send({ captcha_token: 'any-token', ...body });

  /** A school year, class, section and an exam with three pupils (roll 1, 2, 3). */
  async function seed(status: ExamStatus) {
    const year = await ds.getRepository(AcademicYear).save({
      name: `Y-${randomUUID().slice(0, 6)}`,
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: false,
      tenant_id: SEED_TENANT_ID,
    } as AcademicYear);
    const cls = await ds.getRepository(Class).save({
      name: 'Six',
      academic_year_id: year.id,
      tenant_id: SEED_TENANT_ID,
    } as Class);
    const section = await ds.getRepository(ClassSection).save({
      section_name: 'A',
      class_id: cls.id,
      tenant_id: SEED_TENANT_ID,
    } as ClassSection);
    const scale = await ds.getRepository(GradingScale).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: year.id,
      class_id: null,
      name: 'S',
      revision: 1,
    } as GradingScale);
    const subject = await ds.getRepository(Subject).save({
      name_en: 'Math',
      code: `M${randomUUID().slice(0, 6)}`,
      tenant_id: SEED_TENANT_ID,
    } as Subject);
    const exam = await ds.getRepository(Exam).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: year.id,
      class_id: cls.id,
      name: 'Term 1',
      kind: ExamKind.TERM,
      status,
    } as Exam);
    const resultIds: string[] = [];
    for (const roll of [1, 2, 3]) {
      const st = await ds.getRepository(Student).save({
        full_name: `Pupil ${roll}`,
        registration_number: `R-${randomUUID()}`,
        roll_number: roll,
        class_section_id: section.id,
        tenant_id: SEED_TENANT_ID,
        date_of_birth: new Date('2012-01-01'),
        gender: 'MALE',
        enrollment_status: EnrollmentStatus.ACTIVE,
        preferred_communication: 'SMS',
      } as Student);
      const r = await ds.getRepository(Result).save({
        tenant_id: SEED_TENANT_ID,
        exam_id: exam.id,
        student_id: st.id,
        total_marks: '80',
        gpa: '5.00',
        grade: 'A+',
        position: roll,
        section_id: section.id,
        is_fail: false,
        grading_scale_id: scale.id,
      } as Result);
      await ds.getRepository(ResultSubject).save({
        tenant_id: SEED_TENANT_ID,
        result_id: r.id,
        subject_id: subject.id,
        obtained: '80',
        grade: 'A+',
        gpa: '5.00',
        is_fail: false,
        is_fourth_subject: false,
      } as ResultSubject);
      resultIds.push(r.id);
    }
    return { exam, section, resultIds };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.SITE_ROOT_DOMAIN = ROOT;
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    ds = app.get(DataSource);

    adminToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
    // Opens the seed school's site row (created on the first admin read).
    await api()
      .get('/api/v1/website')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Role', UserRole.ADMIN)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);
    const email = `results-teacher-${tag}@e2e.example`;
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,'Results Teacher','ACTIVE',NOW(),NOW()) RETURNING id`,
      [email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
      [id, SEED_TENANT_ID],
    );
    teacherToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  afterAll(async () => {
    await ds.query(
      `DELETE FROM user_tenants WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`results-teacher-${tag}@e2e.example`],
    );
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`results-teacher-${tag}@e2e.example`]);
    await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await app.close();
  });

  describe('admin routes', () => {
    const routes: ['post' | 'patch', string, object?][] = [
      ['post', `/exams/${NO_EXAM}/website-publish`],
      ['post', `/exams/${NO_EXAM}/website-unpublish`],
      ['patch', `/exams/${NO_EXAM}/website-names`, { showNames: false }],
    ];

    it('missing, bogus or malformed X-Tenant-ID is 401 on every route', async () => {
      for (const [m, p, b] of routes) {
        for (const tenant of [null, BOGUS_TENANT, 'not-a-uuid']) {
          const r = admin(m, p, { tenant });
          await (b ? r.send(b) : r).expect(401);
        }
      }
    });

    it('a TEACHER is 403 on every route', async () => {
      for (const [m, p, b] of routes) {
        const r = api()
          [m](`/api/v1${p}`)
          .set('Authorization', `Bearer ${teacherToken}`)
          .set('X-Role', UserRole.TEACHER)
          .set('X-Tenant-ID', SEED_TENANT_ID);
        await (b ? r.send(b) : r).expect(403);
      }
    });

    it('a non-UUID exam id is 400; an unknown exam is 404', async () => {
      await admin('post', '/exams/not-a-uuid/website-publish').expect(400);
      await admin('post', `/exams/${NO_EXAM}/website-publish`).expect(404);
    });

    it('a PROCESSED exam cannot go on the website: 409, fixed text, and the public read stays 404', async () => {
      const { exam, section } = await seed(ExamStatus.PROCESSED);
      const host = await liveHost();
      const r = await admin('post', `/exams/${exam.id}/website-publish`).expect(409);
      expect(r.body.message).toBe('Only an exam with published results can go on the website.');
      await table(host, { exam_id: exam.id, class_section_id: section.id }).expect(404);
    });

    it('publish, then the names switch, then unpublish: each takes effect on the next read', async () => {
      const { exam, section } = await seed(ExamStatus.PUBLISHED);
      const host = await liveHost();
      const read = () => table(host, { exam_id: exam.id, class_section_id: section.id });

      // Never put on the website: the one 404 (same body as an unknown exam).
      const hidden = await read().expect(404);
      expect(hidden.body.message).toBe('results.not_found');

      const key = randomUUID();
      await admin('post', `/exams/${exam.id}/website-publish`, { key }).expect(200);
      // The same key again replays the first answer instead of running twice.
      await admin('post', `/exams/${exam.id}/website-publish`, { key }).expect(200);

      const shown = await read().expect(200);
      expect(shown.body.rows.map((r: { roll: number }) => r.roll)).toEqual([1, 2, 3]);
      expect(shown.body.rows[0].name).toBe('Pupil 1');
      expect(shown.body.pageSize).toBe(100);

      const list = await api()
        .get(`/api/v1/public/site/by-host/${host}/island/results`)
        .expect(200);
      expect(list.body.map((e: { id: string }) => e.id)).toEqual([exam.id]);

      // One roll narrows the table to one row.
      const one = await table(host, {
        exam_id: exam.id,
        class_section_id: section.id,
        roll: 2,
      }).expect(200);
      expect(one.body.rows.map((r: { roll: number }) => r.roll)).toEqual([2]);

      await admin('patch', `/exams/${exam.id}/website-names`)
        .send({ showNames: false })
        .expect(200);
      const anon = await read().expect(200);
      expect(anon.body.rows.map((r: { name: string | null }) => r.name)).toEqual([
        null,
        null,
        null,
      ]);
      expect(JSON.stringify(anon.body)).not.toContain('Pupil');

      await admin('post', `/exams/${exam.id}/website-unpublish`).expect(200);
      await read().expect(404);
      const empty = await api()
        .get(`/api/v1/public/site/by-host/${host}/island/results`)
        .expect(200);
      expect(empty.body).toEqual([]);
    });

    it('an invalid names body is 400', async () => {
      const { exam } = await seed(ExamStatus.PUBLISHED);
      await admin('patch', `/exams/${exam.id}/website-names`).send({ showNames: 'no' }).expect(400);
    });
  });

  describe('public routes', () => {
    it('a missing roll type, page 0 and a non-UUID section are 400', async () => {
      const host = await liveHost();
      for (const bad of [
        { exam_id: NO_EXAM, class_section_id: NO_EXAM, roll: 'x' },
        { exam_id: NO_EXAM, class_section_id: NO_EXAM, page: 0 },
        { exam_id: NO_EXAM, class_section_id: 'nope' },
        { exam_id: NO_EXAM },
      ]) {
        await table(host, bad).expect(400);
      }
    });

    it('is 400 without a captcha token', async () => {
      const host = await liveHost();
      await api()
        .post(`/api/v1/public/site/by-host/${host}/island/results`)
        .send({ exam_id: NO_EXAM, class_section_id: NO_EXAM })
        .expect(400);
    });

    it('is 400 CAPTCHA_FAILED when Cloudflare says no, and reads nothing', async () => {
      const { exam, section } = await seed(ExamStatus.PUBLISHED);
      await ds.query(`UPDATE exams SET website_published_at = now() WHERE id = $1`, [exam.id]);
      const host = await liveHost();
      const config = app.get(ConfigService);
      const realGet = config.get.bind(config);
      const spy = vi
        .spyOn(config, 'get')
        .mockImplementation(((key: string) =>
          key === 'TURNSTILE_SECRET_KEY' ? 'test-secret' : realGet(key)) as typeof config.get);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }),
      );
      try {
        const r = await table(host, { exam_id: exam.id, class_section_id: section.id }).expect(400);
        expect(r.body.details.code).toBe('CAPTCHA_FAILED');
        expect(JSON.stringify(r.body)).not.toContain('Pupil');
      } finally {
        spy.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    it('is 503 in production with no Turnstile secret (fails closed, Rule 22) while the list still answers', async () => {
      const host = await liveHost();
      const config = app.get(ConfigService);
      const realGet = config.get.bind(config);
      const spy = vi
        .spyOn(config, 'get')
        .mockImplementation(((key: string) =>
          key === 'TURNSTILE_SECRET_KEY'
            ? undefined
            : key === 'NODE_ENV'
              ? 'production'
              : realGet(key)) as typeof config.get);
      try {
        await table(host, { exam_id: NO_EXAM, class_section_id: NO_EXAM }).expect(503);
        await api().get(`/api/v1/public/site/by-host/${host}/island/results`).expect(200);
      } finally {
        spy.mockRestore();
      }
    });

    it('detail: per-subject marks of a row; a result id of nowhere is the same 404', async () => {
      const { exam, resultIds } = await seed(ExamStatus.PUBLISHED);
      await ds.query(`UPDATE exams SET website_published_at = now() WHERE id = $1`, [exam.id]);
      const host = await liveHost();
      const detail = (id: string) =>
        api()
          .post(`/api/v1/public/site/by-host/${host}/island/results/detail`)
          .send({ exam_id: exam.id, result_id: id });
      const ok = await detail(resultIds[0]).expect(200);
      expect(ok.body.subjects).toEqual([
        { name: { en: 'Math', bn: null }, obtained: 80, grade: 'A+', gpa: 5, passed: true },
      ]);
      const miss = await detail(NO_EXAM).expect(404);
      expect(miss.body.message).toBe('results.not_found');
      await api()
        .post(`/api/v1/public/site/by-host/${host}/island/results/detail`)
        .send({ exam_id: exam.id, result_id: 'not-a-uuid' })
        .expect(400);
    });

    it('another school’s host cannot read this school’s exam: the same 404 as a missing one', async () => {
      const { exam, section } = await seed(ExamStatus.PUBLISHED);
      await ds.query(`UPDATE exams SET website_published_at = now() WHERE id = $1`, [exam.id]);
      // A second school with its own live site.
      const other = randomUUID();
      const sub = `other-${tag}`;
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,$2,$3,NOW(),NOW())`,
        [other, `Other ${tag}`, `other-${tag}`],
      );
      await ds.query(
        `INSERT INTO school_sites (tenant_id, subdomain, palette, enabled, draft, published) VALUES ($1,$2,'green',true,'{}'::jsonb,'{}'::jsonb)`,
        [other, sub],
      );
      try {
        const r = await table(`${sub}.${ROOT}`, {
          exam_id: exam.id,
          class_section_id: section.id,
        }).expect(404);
        expect(r.body.message).toBe('results.not_found');
      } finally {
        await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [other]);
        await ds.query(`DELETE FROM schools WHERE id = $1`, [other]);
      }
    });

    it('a disabled site and an unknown host answer the identical 404 on both routes', async () => {
      const host = await liveHost();
      await ds.query(`UPDATE school_sites SET enabled = false WHERE tenant_id = $1`, [
        SEED_TENANT_ID,
      ]);
      const body = { exam_id: NO_EXAM, class_section_id: NO_EXAM };
      const off = await table(host, body).expect(404);
      const unknown = await table(`nobody.${ROOT}`, body).expect(404);
      const strip = (b: Record<string, unknown>) => {
        const { requestId: _r, timestamp: _t, ...rest } = b;
        return rest;
      };
      expect(strip(off.body)).toEqual(strip(unknown.body));
    });

    // The e2e stack turns throttling off when NODE_ENV=test (app.module.ts `skipIf`), so the tier
    // is asserted as a constant on both handlers, the same way the enquiry e2e does.
    it('both routes are wired to the 30/min per IP tier', () => {
      expect(PUBLIC_RESULTS_RATE_LIMIT).toEqual({ limit: 30, ttl: 60_000 });
      const proto = require('./public-site.controller').PublicSiteController.prototype;
      for (const name of ['resultsTable', 'resultDetail']) {
        const handler = Object.getOwnPropertyDescriptor(proto, name)!.value;
        expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(30);
      }
    });
  });
});

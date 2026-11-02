import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  MarkStatus,
  UserRole,
} from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { ResultsService } from '../exams/results.service';
import { lockExam } from '../exams/exam-lock';
import { RecomputeService } from './recompute.service';
import { GradingScale } from './entities/grading-scale.entity';
import { GradingBand } from './entities/grading-band.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Exam } from '../exams/entities/exam.entity';
import { ExamComponent } from '../exams/entities/exam-component.entity';
import { Mark } from '../exams/entities/mark.entity';

/**
 * [68.2.06] The band-edit preview/confirm API against a scale that real
 * results use: the preview counts PROCESSED results, a scale used by a
 * PUBLISHED exam is refused (D16), and the permission / tenant gates hold.
 */
const API = '/api/v1';
process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

const TENANT_B = '00000000-0000-4000-8000-0000006e0299';
const TEACHER_USER_ID = '00000000-0000-4000-8000-0000006e0210';
const TEACHER_EMAIL = 'grading-recompute-teacher@e2e.example';
// One dedicated seeded identity for the step-up call (see the note in
// discount-rules.controller.e2e-spec.ts on the shared OTP limiter).
const APPROVER_ID = '00000000-0000-4000-8000-0000006e0211';
const APPROVER_EMAIL = 'grading-recompute-approver@e2e.example';

const NEW_BANDS = [
  { percent_from: 0, percent_to: 32, grade: 'F', gpa: 0, is_fail: true, sequence: 3 },
  { percent_from: 33, percent_to: 69, grade: 'B', gpa: 3, is_fail: false, sequence: 2 },
  { percent_from: 70, percent_to: 100, grade: 'A+', gpa: 5, is_fail: false, sequence: 1 },
];

describe('Grading scale recompute E2E (68.2.06)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let resultsService: ResultsService;
  let recomputeService: RecomputeService;
  let adminToken: string;
  let teacherToken: string;
  let seq = 0;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function issueApprovalToken(): Promise<string> {
    const requestRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/step-up/otp/request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ identifier: APPROVER_EMAIL, scope: 'grading_scale.manage' })
      .expect(202);
    const verifyRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/step-up`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({
        identifier: APPROVER_EMAIL,
        method: 'OTP',
        otp: requestRes.body.debug?.otp,
        scope: 'grading_scale.manage',
      })
      .expect(200);
    return verifyRes.body.approval_token;
  }

  /** A scale with an F / A band set and one exam, processed (and maybe
   * published), so its results are graded against that scale. */
  async function buildExam(publish: boolean): Promise<string> {
    seq += 1;
    const tag = `${Date.now()}${seq}`;
    const t = SEED_TENANT_ID;
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `GR E2E ${tag}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: t,
    });
    const cls = await dataSource
      .getRepository(Class)
      .save({ name: `GR Class ${tag}`, academic_year_id: year.id, tenant_id: t });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: 'A', class_id: cls.id, tenant_id: t });
    const subject = await dataSource
      .getRepository(Subject)
      .save({ name_en: `GR Subject ${tag}`, code: `G${tag}`.slice(0, 20), tenant_id: t });
    await dataSource.getRepository(ClassSubject).save({
      class_id: cls.id,
      subject_id: subject.id,
      academic_year_id: year.id,
      is_optional: false,
      is_graded_only: false,
      tenant_id: t,
    });
    const scale = await dataSource.getRepository(GradingScale).save({
      tenant_id: t,
      academic_year_id: year.id,
      class_id: null,
      name: `GR Scale ${tag}`,
    });
    await dataSource.getRepository(GradingBand).save([
      {
        tenant_id: t,
        scale_id: scale.id,
        percent_from: 0,
        percent_to: 32,
        grade: 'F',
        gpa: '0',
        is_fail: true,
        sequence: 2,
      },
      {
        tenant_id: t,
        scale_id: scale.id,
        percent_from: 33,
        percent_to: 100,
        grade: 'A',
        gpa: '5',
        is_fail: false,
        sequence: 1,
      },
    ]);
    const student: any = await dataSource.getRepository(Student).save({
      full_name: 'GR Student',
      registration_number: `GR-${tag}`,
      roll_number: 1,
      class_section_id: section.id,
      tenant_id: t,
      date_of_birth: new Date('2012-01-01'),
      gender: 'MALE',
      enrollment_status: EnrollmentStatus.ACTIVE,
      preferred_communication: 'SMS',
    } as any);
    await dataSource.getRepository(Enrollment).save({
      student_id: student.id,
      class_id: cls.id,
      section_id: section.id,
      academic_year_id: year.id,
      enrollment_status: EnrollmentStatus.ACTIVE,
      tenant_id: t,
    });
    const exam = await dataSource.getRepository(Exam).save({
      tenant_id: t,
      academic_year_id: year.id,
      class_id: cls.id,
      name: `GR Exam ${tag}`,
      kind: ExamKind.TERM,
      status: ExamStatus.DRAFT,
    });
    const component = await dataSource.getRepository(ExamComponent).save({
      tenant_id: t,
      exam_id: exam.id,
      subject_id: subject.id,
      name: 'Written',
      kind: ExamComponentKind.WRITTEN,
      source: ExamComponentSource.MANUAL,
      full_marks: '100',
      sequence: 1,
    });
    await dataSource.getRepository(Mark).save({
      tenant_id: t,
      exam_id: exam.id,
      student_id: student.id,
      subject_id: subject.id,
      component_id: component.id,
      value: '75.00',
      status: MarkStatus.PRESENT,
    });
    await resultsService.process(exam.id, t, SEED_ADMIN_USER_ID, true);
    if (publish) await resultsService.publish(exam.id, t, SEED_ADMIN_USER_ID);
    return scale.id;
  }

  const preview = (scaleId: string, token: string, tenant = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .post(`${API}/grading/scales/${scaleId}/bands/preview`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .send({ bands: NEW_BANDS });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);
    resultsService = app.get(ResultsService);
    recomputeService = app.get(RecomputeService);

    for (const [id, email, role] of [
      [TEACHER_USER_ID, TEACHER_EMAIL, UserRole.TEACHER],
      [APPROVER_ID, APPROVER_EMAIL, UserRole.ADMIN],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Grading Recompute E2E', 'ACTIVE', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
    }
    // The seeded admin is also a real member of tenant B.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Grading Recompute School B', 'grading-recompute-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('preview on a scale used by a PROCESSED exam reports the real affected count', async () => {
    const scaleId = await buildExam(false);
    const res = await preview(scaleId, adminToken).expect(201);
    expect(res.body).toMatchObject({ valid: true, bands_changed: true });
    expect(res.body.affected_result_count).toBeGreaterThan(0);
  });

  it('preview on a scale used by a PUBLISHED exam is invalid with SCALE_IN_PUBLISHED_RESULTS', async () => {
    const scaleId = await buildExam(true);
    const res = await preview(scaleId, adminToken).expect(201);
    expect(res.body.valid).toBe(false);
    expect(res.body.problems.map((p: { type: string }) => p.type)).toContain(
      'SCALE_IN_PUBLISHED_RESULTS',
    );
  });

  it('confirm on a scale used by a PUBLISHED exam is a 409 with details.code', async () => {
    const scaleId = await buildExam(true);
    const approvalToken = await issueApprovalToken();
    const res = await supertest(app.getHttpServer())
      .post(`${API}/grading/scales/${scaleId}/bands/confirm`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Approval-Token', approvalToken)
      .send({ bands: NEW_BANDS })
      .expect(409);
    expect(res.body.details?.code).toBe('SCALE_IN_PUBLISHED_RESULTS');
  });

  // Review r2 #2: confirm locks the scale, then every exam using it. A mark
  // save on a PROCESSED exam locks the exam, then inserts results that point
  // at the scale (the FK check takes KEY SHARE on it). A scale lock that
  // conflicts with KEY SHARE closes that cycle: 40P01 and a 500 on one side.
  it('a band-edit confirm racing a mark save on the same PROCESSED exam does not deadlock', async () => {
    const scaleId = await buildExam(false);
    const [{ exam_id: examId }] = (await dataSource.query(
      `SELECT exam_id FROM results WHERE grading_scale_id = $1 LIMIT 1`,
      [scaleId],
    )) as { exam_id: string }[];
    const qr = dataSource.createQueryRunner();
    await qr.startTransaction();
    let confirm: Promise<unknown> | undefined;
    let saved: unknown;
    try {
      // Stand-in for a mark save on a PROCESSED exam: the exam is locked first.
      await lockExam(qr.manager, examId, SEED_TENANT_ID);
      confirm = recomputeService
        .confirm(scaleId, SEED_TENANT_ID, SEED_ADMIN_USER_ID, APPROVER_ID, NEW_BANDS)
        .catch((e) => e);
      // confirm now holds the scale lock and waits on the exam.
      await new Promise((r) => setTimeout(r, 300));
      saved = await resultsService
        .recomputeProcessedExam(qr.manager, examId, SEED_TENANT_ID, SEED_ADMIN_USER_ID)
        .then(
          () => 'ok',
          (e) => e,
        );
      if (saved === 'ok') await qr.commitTransaction();
    } finally {
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await qr.release();
    }
    expect(saved).toBe('ok');
    // The band edit goes through once the mark save commits.
    expect(await confirm).toMatchObject({ affected_result_count: expect.any(Number) });
  });

  it('a TEACHER cannot preview (403)', async () => {
    const scaleId = await buildExam(false);
    await preview(scaleId, teacherToken).expect(403);
  });

  it("tenant B's admin gets 404 on tenant A's scale", async () => {
    const scaleId = await buildExam(false);
    await preview(scaleId, adminToken, TENANT_B).expect(404);
  });
});

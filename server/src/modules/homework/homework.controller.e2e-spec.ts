import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../schools/dto/tenant-settings.dto';
import { HomeworkGradingMode, UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
} from '@test/constants';

/**
 * E2E for the homework routes: full create -> assign -> reassign flow, and
 * the permission-denied case (a TEACHER not mapped to the target section).
 * `teachers`/`teacher_class_sections`/`subjects` are transactional tables —
 * reseeded in `beforeEach`, same pattern as `attendance.e2e-spec.ts`.
 */
describe('Homework E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let teacherToken: string;
  let subjectId: string;

  const TENANT_ID = SEED_TENANT_ID;
  const MAPPED_SECTION_ID = SEED_SECTION_1_ID;
  const UNMAPPED_SECTION_ID = SEED_SECTION_2_ID;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const teacherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;

    // `teachers`/`teacher_class_sections` are transactional — reseed every
    // test. The teacher is mapped to MAPPED_SECTION_ID as class teacher
    // (subject_id NULL) only.
    const teacherId = randomUUID();
    // `teachers.staff_profile_id` is NOT NULL ([36.1.1]) — this raw insert
    // bypasses TypeORM (so `TeacherStaffProfileSubscriber` doesn't fire),
    // hence the `staff_profiles` CTE. `SEED_ADMIN_USER_ID` is reused across
    // many e2e specs, so `ON CONFLICT (tenant_id, user_id)` reuses its profile instead
    // of erroring on the second file to run.
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-E2E-' || $1, NOW(), NOW())
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'E2E-HW-TEACHER', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, SEED_ADMIN_USER_ID, TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), teacherId, MAPPED_SECTION_ID, TENANT_ID],
    );

    const subjectRes = await dataSource.query(
      `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
       VALUES ($1, $2, 'E2E Subject', $3, NOW(), NOW())
       RETURNING id`,
      [randomUUID(), TENANT_ID, `E2E-${randomUUID().slice(0, 8)}`],
    );
    subjectId = subjectRes[0].id;
  });

  it('create -> assign -> reassign: full flow', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post('/api/v1/homework')
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        subject_id: subjectId,
        class_id: SEED_CLASS_1_ID,
        title: 'Chapter 4 exercises',
        grading_mode: HomeworkGradingMode.MARKS,
      })
      .expect(201);

    const homeworkId = createRes.body.id;
    expect(homeworkId).toBeDefined();

    const assignRes = await supertest(app.getHttpServer())
      .post(`/api/v1/homework/${homeworkId}/assign`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        section_id: MAPPED_SECTION_ID,
        assigned_date: '2026-01-01',
        due_date: '2026-01-08',
      })
      .expect(201);

    const assignmentId = assignRes.body.id;
    expect(assignRes.body.status).toBe('ACTIVE');

    const reassignRes = await supertest(app.getHttpServer())
      .post(`/api/v1/homework-assignments/${assignmentId}/reassign`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        section_id: MAPPED_SECTION_ID,
        assigned_date: '2026-01-02',
        due_date: '2026-01-09',
      })
      .expect(201);

    expect(reassignRes.body.id).not.toBe(assignmentId);
    expect(reassignRes.body.status).toBe('ACTIVE');

    // The old row must now be SUPERSEDED (D20) — read back via GET /homework.
    const listRes = await supertest(app.getHttpServer())
      .get(`/api/v1/homework?class_id=${SEED_CLASS_1_ID}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(200);
    expect(listRes.body.some((h: { id: string }) => h.id === homeworkId)).toBe(true);

    const oldRow = await dataSource.query('SELECT status FROM homework_assignments WHERE id = $1', [
      assignmentId,
    ]);
    expect(oldRow[0].status).toBe('SUPERSEDED');
  });

  it('404s assign for a TEACHER not mapped to the target section (D13)', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post('/api/v1/homework')
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        subject_id: subjectId,
        class_id: SEED_CLASS_1_ID,
        title: 'Chapter 5 exercises',
        grading_mode: HomeworkGradingMode.TICK,
      })
      .expect(201);

    await supertest(app.getHttpServer())
      .post(`/api/v1/homework/${createRes.body.id}/assign`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({
        section_id: UNMAPPED_SECTION_ID,
        assigned_date: '2026-01-01',
        due_date: '2026-01-08',
      })
      .expect(404);
  });

  // [75.6-c] D2/D13: teacher scope is current-year assignments only; a miss is 404.
  describe('teacher scope', () => {
    const asTeacher = (req: supertest.Test) =>
      req
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER);

    const createAndAssign = async () => {
      const created = await asTeacher(supertest(app.getHttpServer()).post('/api/v1/homework'))
        .send({
          subject_id: subjectId,
          class_id: SEED_CLASS_1_ID,
          title: 'Scope homework',
          grading_mode: HomeworkGradingMode.TICK,
        })
        .expect(201);
      const assigned = await asTeacher(
        supertest(app.getHttpServer()).post(`/api/v1/homework/${created.body.id}/assign`),
      )
        .send({
          section_id: MAPPED_SECTION_ID,
          assigned_date: '2026-01-01',
          due_date: '2026-01-08',
        })
        .expect(201);
      return { homeworkId: created.body.id as string, assignmentId: assigned.body.id as string };
    };

    const unassignTeacher = () => dataSource.query(`DELETE FROM teacher_class_sections`);

    // Extra sections this describe adds to SEED_CLASS_1_ID. class_sections is only reset once
    // per file, so afterEach removes them (students first: that FK has no cascade;
    // homework_assignments cascade).
    const extraSectionIds: string[] = [];
    const mkSectionB = async (): Promise<string> => {
      const [{ id }] = await dataSource.query(
        `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
        [`HW-B-${randomUUID().slice(0, 8)}`, SEED_CLASS_1_ID, TENANT_ID],
      );
      extraSectionIds.push(id);
      return id;
    };
    afterEach(async () => {
      if (!extraSectionIds.length) return;
      await dataSource.query(`DELETE FROM students WHERE class_section_id = ANY($1::uuid[])`, [
        extraSectionIds,
      ]);
      await dataSource.query(`DELETE FROM class_sections WHERE id = ANY($1::uuid[])`, [
        extraSectionIds,
      ]);
      extraSectionIds.length = 0;
    });

    const mkStudent = async (sectionId: string, roll = 1): Promise<string> => {
      const id = randomUUID();
      await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
         VALUES ($1, 'Scope Student', $2, $5, $3, $4, 'ACTIVE', NOW(), NOW())`,
        [id, `HW-STU-${randomUUID().slice(0, 8)}`, sectionId, TENANT_ID, roll],
      );
      return id;
    };

    const adminToken = async (): Promise<string> =>
      (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    const withAdmin = (req: supertest.Test, token: string) =>
      req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', TENANT_ID);
    const mkHomework = async (title: string): Promise<string> =>
      (
        await withAdmin(supertest(app.getHttpServer()).post('/api/v1/homework'), await adminToken())
          .send({
            subject_id: subjectId,
            class_id: SEED_CLASS_1_ID,
            title,
            grading_mode: HomeworkGradingMode.TICK,
          })
          .expect(201)
      ).body.id as string;
    const assignAsAdmin = async (
      homeworkId: string,
      target: { section_id?: string; student_id?: string },
    ) => {
      await withAdmin(
        supertest(app.getHttpServer()).post(`/api/v1/homework/${homeworkId}/assign`),
        await adminToken(),
      )
        .send({ ...target, assigned_date: '2026-01-01', due_date: '2026-01-08' })
        .expect(201);
    };
    const mkAssigned = async (
      title: string,
      target: { section_id?: string; student_id?: string },
    ) => {
      const id = await mkHomework(title);
      await assignAsAdmin(id, target);
      return id;
    };

    it("a teacher assigned only in a past academic year cannot read that class's homework analytics", async () => {
      const [{ id: teacherId }] = await dataSource.query(
        `SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2`,
        [TENANT_ID, SEED_ADMIN_USER_ID],
      );
      const [{ id: yearId }] = await dataSource.query(
        `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
         VALUES (gen_random_uuid(), 'HW Past Year', '2020-01-01', '2020-12-31', false, $1, NOW(), NOW()) RETURNING id`,
        [TENANT_ID],
      );
      const [{ id: classId }] = await dataSource.query(
        `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
         VALUES (gen_random_uuid(), 'HW Past Class', $1, $2, NOW(), NOW()) RETURNING id`,
        [yearId, TENANT_ID],
      );
      const [{ id: oldSectionId }] = await dataSource.query(
        `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
         VALUES (gen_random_uuid(), 'Old', $1, $2, NOW(), NOW()) RETURNING id`,
        [classId, TENANT_ID],
      );
      await dataSource.query(
        `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [randomUUID(), teacherId, oldSectionId, TENANT_ID],
      );
      await asTeacher(
        supertest(app.getHttpServer()).get(`/api/v1/homework/analytics/section/${oldSectionId}`),
      ).expect(404);
      await asTeacher(
        supertest(app.getHttpServer()).get(
          `/api/v1/homework/analytics/section/${MAPPED_SECTION_ID}`,
        ),
      ).expect(200);
    });

    it('an unassigned teacher lists nothing and gets 404 on direct fetch and update', async () => {
      const { homeworkId, assignmentId } = await createAndAssign();
      await unassignTeacher();
      const list = await asTeacher(supertest(app.getHttpServer()).get('/api/v1/homework')).expect(
        200,
      );
      expect(list.body).toEqual([]);
      const miss = await asTeacher(
        supertest(app.getHttpServer()).get(`/api/v1/homework/${homeworkId}`),
      ).expect(404);
      const unknown = await asTeacher(
        supertest(app.getHttpServer()).get(`/api/v1/homework/${randomUUID()}`),
      ).expect(404);
      // D13: same body as a homework that does not exist.
      expect(miss.body.message).toBe('Homework not found');
      expect(miss.body.message).toBe(unknown.body.message);
      await asTeacher(
        supertest(app.getHttpServer()).patch(`/api/v1/homework-assignments/${assignmentId}`),
      )
        .send({ status: 'DEACTIVATED' })
        .expect(404);
    });

    it('an unassigned teacher gets 404 on the submissions grid and on grading a submission', async () => {
      const { assignmentId } = await createAndAssign();
      const studentId = randomUUID();
      await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
         VALUES ($1, 'Scope Student', $2, 1, $3, $4, 'ACTIVE', NOW(), NOW())`,
        [studentId, `HW-SCOPE-${randomUUID().slice(0, 8)}`, MAPPED_SECTION_ID, TENANT_ID],
      );
      const [{ id: submissionId }] = await dataSource.query(
        `INSERT INTO homework_submissions (id, assignment_id, student_id, tenant_id, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'SUBMITTED', NOW(), NOW()) RETURNING id`,
        [assignmentId, studentId, TENANT_ID],
      );
      await asTeacher(
        supertest(app.getHttpServer()).get(
          `/api/v1/homework-assignments/${assignmentId}/submissions`,
        ),
      ).expect(200);
      await unassignTeacher();
      await asTeacher(
        supertest(app.getHttpServer()).get(
          `/api/v1/homework-assignments/${assignmentId}/submissions`,
        ),
      ).expect(404);
      await asTeacher(
        supertest(app.getHttpServer()).patch(`/api/v1/homework-submissions/${submissionId}`),
      )
        .send({ status: 'DONE' })
        .expect(404);
    });

    it('a SUBJECT teacher (no homeroom row) lists only their own subject homework', async () => {
      const [{ id: teacherId }] = await dataSource.query(
        `SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2`,
        [TENANT_ID, SEED_ADMIN_USER_ID],
      );
      const [{ id: otherSubjectId }] = await dataSource.query(
        `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'Other Subject', $2, NOW(), NOW()) RETURNING id`,
        [TENANT_ID, `E2E-${randomUUID().slice(0, 8)}`],
      );
      await unassignTeacher();
      await dataSource.query(
        `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, assignment_type, subject_id, created_at)
         VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER', $5, NOW())`,
        [randomUUID(), teacherId, MAPPED_SECTION_ID, TENANT_ID, subjectId],
      );
      const admin = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      const asAdmin = (req: supertest.Test) =>
        req.set('Authorization', `Bearer ${admin.body.access_token}`).set('X-Tenant-ID', TENANT_ID);
      const mk = async (sid: string, title: string) =>
        (
          await asAdmin(supertest(app.getHttpServer()).post('/api/v1/homework'))
            .send({
              subject_id: sid,
              class_id: SEED_CLASS_1_ID,
              title,
              grading_mode: HomeworkGradingMode.TICK,
            })
            .expect(201)
        ).body.id as string;
      const mine = await mk(subjectId, 'Mine');
      const theirs = await mk(otherSubjectId, 'Theirs');

      const teacherList = await asTeacher(
        supertest(app.getHttpServer()).get('/api/v1/homework'),
      ).expect(200);
      expect(teacherList.body.map((h: { id: string }) => h.id)).toEqual([mine]);
      // By id agrees with the list.
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${theirs}`)).expect(404);
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${mine}`)).expect(200);
      const adminList = await asAdmin(
        supertest(app.getHttpServer()).get('/api/v1/homework'),
      ).expect(200);
      expect(adminList.body.map((h: { id: string }) => h.id).sort()).toEqual([mine, theirs].sort());
    });

    it('ADMIN still reads the same homework (tenant-wide, unchanged)', async () => {
      const { homeworkId } = await createAndAssign();
      await unassignTeacher();
      const admin = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      await supertest(app.getHttpServer())
        .get(`/api/v1/homework/${homeworkId}`)
        .set('Authorization', `Bearer ${admin.body.access_token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
    });

    it('a teacher of section A does not list homework assigned only to section B of the same class', async () => {
      const otherSectionId = await mkSectionB();
      const x = await mkAssigned('Only B', { section_id: otherSectionId });
      const y = await mkAssigned('Mine A', { section_id: MAPPED_SECTION_ID });

      const list = await asTeacher(supertest(app.getHttpServer()).get('/api/v1/homework')).expect(
        200,
      );
      const ids = list.body.map((h: { id: string }) => h.id);
      expect(ids).toContain(y);
      expect(ids).not.toContain(x);
      // Rule 2: what the list hides is 404 by id too, not just missing from the list.
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${x}`)).expect(404);
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${y}`)).expect(200);
    });

    it('a teacher of section A gets 404 by id for homework assigned only to a student of section B', async () => {
      const sectionB = await mkSectionB();
      const studentB = await mkStudent(sectionB);
      const studentA = await mkStudent(MAPPED_SECTION_ID);
      const x = await mkAssigned('Only B student', { student_id: studentB });
      const y = await mkAssigned('A student', { student_id: studentA });

      const list = await asTeacher(supertest(app.getHttpServer()).get('/api/v1/homework')).expect(
        200,
      );
      const ids = list.body.map((h: { id: string }) => h.id);
      expect(ids).toContain(y);
      expect(ids).not.toContain(x);
      const miss = await asTeacher(
        supertest(app.getHttpServer()).get(`/api/v1/homework/${x}`),
      ).expect(404);
      // D13: same text as a homework that does not exist.
      expect(miss.body.message).toBe('Homework not found');
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${y}`)).expect(200);
    });

    it('unassigned homework in my class is 200 by id, then 404 once assigned only to section B', async () => {
      const sectionB = await mkSectionB();
      const h = await mkHomework('Not assigned yet');
      const listIds = async () =>
        (
          await asTeacher(supertest(app.getHttpServer()).get('/api/v1/homework')).expect(200)
        ).body.map((r: { id: string }) => r.id);

      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${h}`)).expect(200);
      expect(await listIds()).toContain(h);

      await assignAsAdmin(h, { section_id: sectionB });
      await asTeacher(supertest(app.getHttpServer()).get(`/api/v1/homework/${h}`)).expect(404);
      expect(await listIds()).not.toContain(h);
    });

    describe('GET /homework/:id/assignments (#1013)', () => {
      // Resolves to the body after asserting the status (a Test is thenable, so never return one).
      const list = async (
        id: string,
        as: 'admin' | 'teacher' = 'admin',
        status = 200,
      ): Promise<any> => {
        const req = supertest(app.getHttpServer()).get(`/api/v1/homework/${id}/assignments`);
        const res = await (as === 'teacher' ? asTeacher(req) : withAdmin(req, await adminToken()));
        expect(res.status).toBe(status);
        return res.body;
      };
      const reassignAsAdmin = async (assignmentId: string, due: string) =>
        withAdmin(
          supertest(app.getHttpServer()).post(
            `/api/v1/homework-assignments/${assignmentId}/reassign`,
          ),
          await adminToken(),
        )
          .send({
            section_id: MAPPED_SECTION_ID,
            assigned_date: '2026-01-01',
            due_date: due,
          })
          .expect(201);

      it('ADMIN gets ACTIVE first then SUPERSEDED, dates as YYYY-MM-DD, names for the target', async () => {
        const h = await mkHomework('List shape');
        const first = await withAdmin(
          supertest(app.getHttpServer()).post(`/api/v1/homework/${h}/assign`),
          await adminToken(),
        )
          .send({
            section_id: MAPPED_SECTION_ID,
            assigned_date: '2026-01-01',
            due_date: '2026-01-08',
          })
          .expect(201);
        await reassignAsAdmin(first.body.id, '2026-01-15');

        const body = await list(h);
        expect(body).toHaveLength(2);
        expect(body[0]).toMatchObject({
          status: 'ACTIVE',
          assigned_date: '2026-01-01',
          due_date: '2026-01-15',
          section_id: MAPPED_SECTION_ID,
          student_id: null,
          student_name: null,
          target_section_id: MAPPED_SECTION_ID,
        });
        expect(typeof body[0].section_name).toBe('string');
        expect(body[1]).toMatchObject({
          id: first.body.id,
          status: 'SUPERSEDED',
          due_date: '2026-01-08',
        });
      });

      it('a student row carries the student name and the student section', async () => {
        const studentId = await mkStudent(MAPPED_SECTION_ID);
        const h = await mkAssigned('List student', { student_id: studentId });
        const body = await list(h);
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({
          student_name: 'Scope Student',
          section_id: null,
          student_id: studentId,
          target_section_id: MAPPED_SECTION_ID,
        });
      });

      it('Rule 2: a teacher sees only rows in own sections; ADMIN sees all', async () => {
        const sectionB = await mkSectionB();
        const h = await mkAssigned('List scope', { section_id: MAPPED_SECTION_ID });
        await assignAsAdmin(h, { section_id: sectionB });

        const teacher = await list(h, 'teacher');
        expect(teacher.map((r: { target_section_id: string }) => r.target_section_id)).toEqual([
          MAPPED_SECTION_ID,
        ]);
        expect(await list(h)).toHaveLength(2);
      });

      it('D3: a SUBJECT_TEACHER sees rows only of homework in their subject', async () => {
        const [{ id: teacherId }] = await dataSource.query(
          `SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2`,
          [TENANT_ID, SEED_ADMIN_USER_ID],
        );
        const [{ id: otherSubjectId }] = await dataSource.query(
          `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, 'Other Subject', $2, NOW(), NOW()) RETURNING id`,
          [TENANT_ID, `E2E-${randomUUID().slice(0, 8)}`],
        );
        const own = await mkAssigned('List own subject', { section_id: MAPPED_SECTION_ID });
        const other = (
          await withAdmin(
            supertest(app.getHttpServer()).post('/api/v1/homework'),
            await adminToken(),
          )
            .send({
              subject_id: otherSubjectId,
              class_id: SEED_CLASS_1_ID,
              title: 'List other subject',
              grading_mode: HomeworkGradingMode.TICK,
            })
            .expect(201)
        ).body.id as string;
        await assignAsAdmin(other, { section_id: MAPPED_SECTION_ID });
        await unassignTeacher();
        await dataSource.query(
          `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, assignment_type, subject_id, created_at)
           VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER', $5, NOW())`,
          [randomUUID(), teacherId, MAPPED_SECTION_ID, TENANT_ID, subjectId],
        );

        expect(await list(own, 'teacher')).toHaveLength(1);
        await list(other, 'teacher', 404);
      });

      it('Rule 2: out-of-scope homework is the same 404 as a random id, also after unassigning', async () => {
        const sectionB = await mkSectionB();
        const hB = await mkAssigned('List only B', { section_id: sectionB });
        const missing = await list(randomUUID(), 'teacher', 404);
        const hidden = await list(hB, 'teacher', 404);
        expect(hidden.message).toBe('Homework not found');
        expect(missing.message).toBe('Homework not found');

        const visible = await mkAssigned('List visible', { section_id: MAPPED_SECTION_ID });
        await list(visible, 'teacher');
        await unassignTeacher();
        await list(visible, 'teacher', 404);
      });

      it('a homework not assigned yet lists as an empty array', async () => {
        const h = await mkHomework('List unassigned');
        expect(await list(h)).toEqual([]);
        expect(await list(h, 'teacher')).toEqual([]);
      });

      it('D5: a row whose student was soft-deleted is not listed', async () => {
        const studentId = await mkStudent(MAPPED_SECTION_ID);
        const h = await mkAssigned('List soft delete', { student_id: studentId });
        await dataSource.query(`UPDATE students SET deleted_at = NOW() WHERE id = $1`, [studentId]);
        expect(await list(h)).toEqual([]);
      });

      it('cross-tenant: other tenant 404, missing tenant header 401', async () => {
        const h = await mkHomework('List tenant');
        const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
        await dataSource.query(
          `INSERT INTO schools (id, name, slug, created_at, updated_at)
           VALUES ($1, 'Other', 'other-hw-list', NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [OTHER_TENANT],
        );
        await dataSource.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [SEED_ADMIN_USER_ID, OTHER_TENANT, UserRole.ADMIN],
        );
        try {
          const token = await adminToken(); // re-login: token carries memberships
          await supertest(app.getHttpServer())
            .get(`/api/v1/homework/${h}/assignments`)
            .set('Authorization', `Bearer ${token}`)
            .set('X-Tenant-ID', OTHER_TENANT)
            .expect(404);
          await supertest(app.getHttpServer())
            .get(`/api/v1/homework/${h}/assignments`)
            .set('Authorization', `Bearer ${token}`)
            .expect(401);
        } finally {
          await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
            SEED_ADMIN_USER_ID,
            OTHER_TENANT,
          ]);
        }
      });

      it('Rule 3: a non-UUID id is 400', async () => {
        await list('not-a-uuid', 'admin', 400);
      });
    });

    describe('PATCH /homework-assignments/:id (#2900)', () => {
      // Assigns and returns the new assignment id (assignAsAdmin returns nothing).
      const assignRow = async (
        homeworkId: string,
        target: { section_id?: string; student_id?: string },
      ): Promise<string> =>
        (
          await withAdmin(
            supertest(app.getHttpServer()).post(`/api/v1/homework/${homeworkId}/assign`),
            await adminToken(),
          )
            .send({ ...target, assigned_date: '2026-01-01', due_date: '2026-01-08' })
            .expect(201)
        ).body.id as string;
      const patch = async (id: string, body: object, as: 'admin' | 'teacher' = 'admin') => {
        const req = supertest(app.getHttpServer()).patch(`/api/v1/homework-assignments/${id}`);
        return as === 'teacher'
          ? asTeacher(req).send(body)
          : withAdmin(req, await adminToken()).send(body);
      };
      const rows = async (homeworkId: string): Promise<any[]> =>
        (
          await withAdmin(
            supertest(app.getHttpServer()).get(`/api/v1/homework/${homeworkId}/assignments`),
            await adminToken(),
          ).expect(200)
        ).body;
      const listIdsByStatus = async (status: string): Promise<string[]> =>
        (
          await withAdmin(
            supertest(app.getHttpServer()).get(`/api/v1/homework?status=${status}`),
            await adminToken(),
          ).expect(200)
        ).body.map((h: { id: string }) => h.id);

      it('deactivate shows up under the Deactivated filter, reactivate removes it', async () => {
        const h = await mkHomework('Patch status');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        expect((await patch(a, { status: 'DEACTIVATED' })).status).toBe(200);
        expect((await rows(h))[0].status).toBe('DEACTIVATED');
        expect(await listIdsByStatus('DEACTIVATED')).toContain(h);
        expect((await patch(a, { status: 'ACTIVE' })).status).toBe(200);
        expect((await rows(h))[0].status).toBe('ACTIVE');
        expect(await listIdsByStatus('DEACTIVATED')).not.toContain(h);
      });

      it('moves the due date in place and keeps the submissions on the same row', async () => {
        const studentId = await mkStudent(MAPPED_SECTION_ID);
        const h = await mkHomework('Patch due');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const [{ id: submissionId }] = await dataSource.query(
          `INSERT INTO homework_submissions (id, assignment_id, student_id, tenant_id, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'SUBMITTED', NOW(), NOW()) RETURNING id`,
          [a, studentId, TENANT_ID],
        );
        const res = await patch(a, { due_date: '2026-01-20' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: a, due_date: '2026-01-20' });
        const list = await rows(h);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(a);
        const [{ assignment_id }] = await dataSource.query(
          `SELECT assignment_id FROM homework_submissions WHERE id = $1`,
          [submissionId],
        );
        expect(assignment_id).toBe(a);
      });

      it('rejects bad bodies with 400 and leaves the row unchanged', async () => {
        const h = await mkHomework('Patch validation');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const before = (await rows(h))[0];
        const early = await patch(a, { due_date: '2025-12-31' });
        expect(early.status).toBe(400);
        expect(early.body.message).toBe('due_date must be on or after assigned_date');
        const empty = await patch(a, {});
        expect(empty.status).toBe(400);
        expect(empty.body.message).toBe('Nothing to change');
        for (const body of [
          { status: null },
          { due_date: null },
          { status: 'SUPERSEDED' },
          { due_date: 'not-a-date' },
        ]) {
          expect((await patch(a, body)).status).toBe(400);
        }
        expect((await rows(h))[0]).toEqual(before);
      });

      it('a SUPERSEDED row cannot be changed', async () => {
        const h = await mkHomework('Patch superseded');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        await withAdmin(
          supertest(app.getHttpServer()).post(`/api/v1/homework-assignments/${a}/reassign`),
          await adminToken(),
        )
          .send({
            section_id: MAPPED_SECTION_ID,
            assigned_date: '2026-01-01',
            due_date: '2026-01-15',
          })
          .expect(201);
        const res = await patch(a, { due_date: '2026-01-20' });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('A superseded assignment cannot be changed');
      });

      it('Rules 2 and 23: every 404 has one text and teachers reach only own sections', async () => {
        const sectionB = await mkSectionB();
        const h = await mkHomework('Patch scope');
        const mapped = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const other = await assignRow(h, { section_id: sectionB });

        expect((await patch(mapped, { due_date: '2026-01-20' }, 'teacher')).status).toBe(200);
        const hidden = await patch(other, { due_date: '2026-01-20' }, 'teacher');
        const unknown = await patch(randomUUID(), { due_date: '2026-01-20' }, 'teacher');
        expect(hidden.status).toBe(404);
        expect(unknown.status).toBe(404);
        expect(hidden.body.message).toBe('Homework assignment not found');
        expect(unknown.body.message).toBe('Homework assignment not found');

        await unassignTeacher();
        const gone = await patch(mapped, { due_date: '2026-01-21' }, 'teacher');
        expect(gone.status).toBe(404);
        expect(gone.body.message).toBe('Homework assignment not found');
      });

      it('cross-tenant: other tenant 404, missing tenant header 401', async () => {
        const h = await mkHomework('Patch tenant');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
        await dataSource.query(
          `INSERT INTO schools (id, name, slug, created_at, updated_at)
           VALUES ($1, 'Other', 'other-hw-list', NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [OTHER_TENANT],
        );
        await dataSource.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [SEED_ADMIN_USER_ID, OTHER_TENANT, UserRole.ADMIN],
        );
        try {
          const token = await adminToken(); // re-login: token carries memberships
          await supertest(app.getHttpServer())
            .patch(`/api/v1/homework-assignments/${a}`)
            .set('Authorization', `Bearer ${token}`)
            .set('X-Tenant-ID', OTHER_TENANT)
            .send({ status: 'DEACTIVATED' })
            .expect(404);
          await supertest(app.getHttpServer())
            .patch(`/api/v1/homework-assignments/${a}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ status: 'DEACTIVATED' })
            .expect(401);
        } finally {
          await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
            SEED_ADMIN_USER_ID,
            OTHER_TENANT,
          ]);
        }
      });

      it('Rule 3: a non-UUID id is 400', async () => {
        expect((await patch('not-a-uuid', { status: 'ACTIVE' })).status).toBe(400);
      });

      // #3172: the server refuses what the UI hides, and never holds two live rows per target.
      it('#3172 reassign of a DEACTIVATED row is a 400 and creates no row', async () => {
        const h = await mkHomework('Reassign deactivated');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        await patch(a, { status: 'DEACTIVATED' });
        const res = await withAdmin(
          supertest(app.getHttpServer()).post(`/api/v1/homework-assignments/${a}/reassign`),
          await adminToken(),
        ).send({
          section_id: MAPPED_SECTION_ID,
          assigned_date: '2026-01-01',
          due_date: '2026-01-15',
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Reactivate this assignment before reassigning it');
        expect(await rows(h)).toHaveLength(1);
      });

      it('#3172 a second ACTIVE row for one target is a 409 (assign and reactivate)', async () => {
        const h = await mkHomework('Two live rows');
        const first = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const again = await withAdmin(
          supertest(app.getHttpServer()).post(`/api/v1/homework/${h}/assign`),
          await adminToken(),
        ).send({
          section_id: MAPPED_SECTION_ID,
          assigned_date: '2026-01-01',
          due_date: '2026-01-08',
        });
        expect(again.status).toBe(409);
        // The screen shows its own sentence for this code (no echo of the target).
        expect(again.body.details).toEqual({ code: 'HOMEWORK_TARGET_TAKEN' });
        expect(await rows(h)).toHaveLength(1);

        // Deactivate the first, assign the target again, then reactivating the first would
        // make two live rows.
        await patch(first, { status: 'DEACTIVATED' });
        await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const revive = await patch(first, { status: 'ACTIVE' });
        expect(revive.status).toBe(409);
        expect(revive.body.details).toEqual({ code: 'HOMEWORK_TARGET_TAKEN' });
        expect((await rows(h)).filter((r) => r.status === 'ACTIVE')).toHaveLength(1);
      }, 20000); // ten requests, each with its own login
    });

    describe('check work: GET/PATCH /homework-assignments/:id/submissions (#2899)', () => {
      const MISS = 'Homework assignment not found';
      const assignRow = async (
        homeworkId: string,
        target: { section_id?: string; student_id?: string },
      ): Promise<string> =>
        (
          await withAdmin(
            supertest(app.getHttpServer()).post(`/api/v1/homework/${homeworkId}/assign`),
            await adminToken(),
          )
            .send({ ...target, assigned_date: '2026-01-01', due_date: '2026-01-08' })
            .expect(201)
        ).body.id as string;
      const mkMarksHomework = async (
        title: string,
        mode: HomeworkGradingMode = HomeworkGradingMode.MARKS,
      ): Promise<string> =>
        (
          await withAdmin(
            supertest(app.getHttpServer()).post('/api/v1/homework'),
            await adminToken(),
          )
            .send({
              subject_id: subjectId,
              class_id: SEED_CLASS_1_ID,
              title,
              grading_mode: mode,
            })
            .expect(201)
        ).body.id as string;
      const get = async (id: string, as: 'admin' | 'teacher' = 'admin') => {
        const req = supertest(app.getHttpServer()).get(
          `/api/v1/homework-assignments/${id}/submissions`,
        );
        return as === 'teacher' ? asTeacher(req) : withAdmin(req, await adminToken());
      };
      const grade = async (id: string, body: object, as: 'admin' | 'teacher' = 'admin') => {
        const req = supertest(app.getHttpServer()).patch(
          `/api/v1/homework-assignments/${id}/submissions`,
        );
        return as === 'teacher'
          ? asTeacher(req).send(body)
          : withAdmin(req, await adminToken()).send(body);
      };
      const rowFor = (body: any[], studentId: string) =>
        body.find((r) => r.student_id === studentId);
      const countRows = async (assignmentId: string, studentId: string): Promise<number> =>
        Number(
          (
            await dataSource.query(
              `SELECT COUNT(*)::int AS n FROM homework_submissions WHERE assignment_id=$1 AND student_id=$2`,
              [assignmentId, studentId],
            )
          )[0].n,
        );
      const insertSubmission = (
        assignmentId: string,
        studentId: string,
        status: string,
        attachments = '[]',
      ) =>
        dataSource.query(
          `INSERT INTO homework_submissions (id, tenant_id, assignment_id, student_id, status, attachments, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
          [TENANT_ID, assignmentId, studentId, status, attachments],
        );

      it('E1 roster: a student who never uploaded is listed with no submission', async () => {
        const s = await mkStudent(MAPPED_SECTION_ID);
        const h = await mkHomework('CW roster');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const res = await get(a);
        expect(res.status).toBe(200);
        expect(rowFor(res.body, s)).toEqual({
          student_id: s,
          student_name: 'Scope Student',
          roll_number: 1,
          submission_id: null,
          status: 'NOT_SUBMITTED',
          marks: null,
          attachment_count: 0,
        });
      });

      it('E2/E3 tick creates the row; the same body twice leaves one row (Rule 25)', async () => {
        const s = await mkStudent(MAPPED_SECTION_ID);
        const h = await mkHomework('CW tick');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const body = { items: [{ student_id: s, status: 'DONE' }] };
        const first = await grade(a, body);
        expect(first.status).toBe(200);
        expect(rowFor(first.body, s)).toMatchObject({ status: 'DONE' });
        expect(rowFor(first.body, s).submission_id).toEqual(expect.any(String));
        expect(await countRows(a, s)).toBe(1);
        const second = await grade(a, body);
        expect(second.status).toBe(200);
        expect(rowFor(second.body, s)).toMatchObject({ status: 'DONE' });
        expect(await countRows(a, s)).toBe(1);
        expect(rowFor((await get(a)).body, s).status).toBe('DONE');
      });

      it('E4 NOT_SUBMITTED on uploaded work leaves it SUBMITTED (D8)', async () => {
        const s1 = await mkStudent(MAPPED_SECTION_ID);
        const s2 = await mkStudent(MAPPED_SECTION_ID, 2);
        const h = await mkHomework('CW d8');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        await insertSubmission(
          a,
          s2,
          'DONE',
          '[{"key":"k","filename":"a.pdf","mimetype":"application/pdf","size":1}]',
        );
        await grade(a, { items: [{ student_id: s1, status: 'DONE' }] });
        const res = await grade(a, {
          items: [
            { student_id: s1, status: 'NOT_SUBMITTED' },
            { student_id: s2, status: 'NOT_SUBMITTED' },
          ],
        });
        expect(res.status).toBe(200);
        expect(rowFor(res.body, s1).status).toBe('NOT_SUBMITTED');
        expect(rowFor(res.body, s2).status).toBe('SUBMITTED');
      });

      it('E5 marks: set, clear, bounds, and TICK rejects marks', async () => {
        const s = await mkStudent(MAPPED_SECTION_ID);
        const h = await mkMarksHomework('CW marks');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const set = await grade(a, { items: [{ student_id: s, marks: 7 }] });
        expect(rowFor(set.body, s).marks).toBe(7);
        const clear = await grade(a, { items: [{ student_id: s, marks: null }] });
        expect(rowFor(clear.body, s).marks).toBeNull();
        for (const bad of [10000, -1, 1.5]) {
          expect((await grade(a, { items: [{ student_id: s, marks: bad }] })).status).toBe(400);
        }
        const tickH = await mkHomework('CW marks tick');
        const tickA = await assignRow(tickH, { section_id: MAPPED_SECTION_ID });
        const res = await grade(tickA, { items: [{ student_id: s, marks: 5 }] });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe(
          'Marks can only be set when the homework grading mode is MARKS',
        );
        expect(await countRows(tickA, s)).toBe(0);
      });

      it('#3172 PARTIAL is only accepted by a PARTIAL-mode homework', async () => {
        const s = await mkStudent(MAPPED_SECTION_ID);
        const tickA = await assignRow(await mkHomework('CW partial tick'), {
          section_id: MAPPED_SECTION_ID,
        });
        const res = await grade(tickA, { items: [{ student_id: s, status: 'PARTIAL' }] });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe(
          'Partial can only be set when the homework grading mode is PARTIAL',
        );
        expect(await countRows(tickA, s)).toBe(0);

        const partialA = await assignRow(
          await mkMarksHomework('CW partial mode', HomeworkGradingMode.PARTIAL),
          { section_id: MAPPED_SECTION_ID },
        );
        const ok = await grade(partialA, { items: [{ student_id: s, status: 'PARTIAL' }] });
        expect(ok.status).toBe(200);
        expect(rowFor(ok.body, s).status).toBe('PARTIAL');
      });

      it('E6 validation: each is a 400 and nothing is written', async () => {
        const s = await mkStudent(MAPPED_SECTION_ID);
        const other = await mkStudent(await mkSectionB());
        const h = await mkHomework('CW validation');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const bad = async (body: object, message?: string) => {
          const res = await grade(a, body);
          expect(res.status).toBe(400);
          if (message) {
            expect(res.body.message).toBe(message);
            expect(JSON.stringify(res.body)).not.toContain(other);
          }
        };
        await bad({ items: [] });
        await bad({});
        await bad({
          items: Array.from({ length: 301 }, () => ({ student_id: randomUUID(), status: 'DONE' })),
        });
        await bad(
          {
            items: [
              { student_id: s, status: 'DONE' },
              { student_id: s, status: 'PARTIAL' },
            ],
          },
          'Each student can appear only once',
        );
        await bad({ items: [{ student_id: s }] }, 'Nothing to change');
        await bad({ items: [{ student_id: s, status: 'SUBMITTED' }] });
        await bad({ items: [{ student_id: s, status: null }] });
        await bad(
          { items: [{ student_id: other, status: 'DONE' }] },
          'A student in this list is not on this homework',
        );
        expect(await countRows(a, s)).toBe(0);
        expect(await countRows(a, other)).toBe(0);
      });

      it('E7 teacher scope + Rule 23: every miss is the same 404 text', async () => {
        const secB = await mkSectionB();
        const h = await mkHomework('CW scope');
        const aMapped = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const aB = await assignRow(h, { section_id: secB });
        const s = await mkStudent(MAPPED_SECTION_ID);
        expect((await get(aMapped, 'teacher')).status).toBe(200);
        expect(
          (await grade(aMapped, { items: [{ student_id: s, status: 'DONE' }] }, 'teacher')).status,
        ).toBe(200);
        for (const id of [aB, randomUUID()]) {
          const g = await get(id, 'teacher');
          expect(g.status).toBe(404);
          expect(g.body.message).toBe(MISS);
          const p = await grade(id, { items: [{ student_id: s, status: 'DONE' }] }, 'teacher');
          expect(p.status).toBe(404);
          expect(p.body.message).toBe(MISS);
        }
        await unassignTeacher();
        const g = await get(aMapped, 'teacher');
        expect(g.status).toBe(404);
        expect(g.body.message).toBe(MISS);
      });

      it('E8 student-target row lists exactly that student; teacher can grade', async () => {
        const s = await mkStudent(MAPPED_SECTION_ID);
        await mkStudent(MAPPED_SECTION_ID, 2);
        const h = await mkHomework('CW student target');
        const a = await assignRow(h, { student_id: s });
        const res = await get(a, 'teacher');
        expect(res.status).toBe(200);
        expect(res.body.map((r: any) => r.student_id)).toEqual([s]);
        expect(
          (await grade(a, { items: [{ student_id: s, status: 'DONE' }] }, 'teacher')).status,
        ).toBe(200);
      });

      it('E9 SUPERSEDED lists only students who already have a row', async () => {
        const sA = await mkStudent(MAPPED_SECTION_ID);
        const sB = await mkStudent(MAPPED_SECTION_ID, 2);
        const h = await mkHomework('CW superseded');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        await grade(a, { items: [{ student_id: sA, status: 'DONE' }] });
        await withAdmin(
          supertest(app.getHttpServer()).post(`/api/v1/homework-assignments/${a}/reassign`),
          await adminToken(),
        )
          .send({
            section_id: MAPPED_SECTION_ID,
            assigned_date: '2026-01-01',
            due_date: '2026-01-15',
          })
          .expect(201);
        const res = await get(a);
        expect(rowFor(res.body, sA)).toBeDefined();
        expect(rowFor(res.body, sB)).toBeUndefined();
        const bad = await grade(a, { items: [{ student_id: sB, status: 'DONE' }] });
        expect(bad.status).toBe(400);
        expect(bad.body.message).toBe('A student in this list is not on this homework');
        expect((await grade(a, { items: [{ student_id: sA, status: 'DONE' }] })).status).toBe(200);
      });

      it('E10 a student who moved sections keeps their existing row (reconciliation)', async () => {
        const s = await mkStudent(MAPPED_SECTION_ID);
        const h = await mkHomework('CW moved');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        await insertSubmission(a, s, 'SUBMITTED');
        await dataSource.query(`UPDATE students SET class_section_id = $2 WHERE id = $1`, [
          s,
          await mkSectionB(),
        ]);
        expect(rowFor((await get(a)).body, s)).toMatchObject({ status: 'SUBMITTED' });
      });

      it('E11 cross-tenant: other tenant 404, missing tenant header 401', async () => {
        const h = await mkHomework('CW tenant');
        const a = await assignRow(h, { section_id: MAPPED_SECTION_ID });
        const OTHER_TENANT = '00000000-0000-4000-8000-000000000097';
        await dataSource.query(
          `INSERT INTO schools (id, name, slug, created_at, updated_at)
           VALUES ($1, 'Other', 'other-hw-cw', NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [OTHER_TENANT],
        );
        await dataSource.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [SEED_ADMIN_USER_ID, OTHER_TENANT, UserRole.ADMIN],
        );
        try {
          const token = await adminToken();
          const url = `/api/v1/homework-assignments/${a}/submissions`;
          const body = { items: [{ student_id: randomUUID(), status: 'DONE' }] };
          await supertest(app.getHttpServer())
            .get(url)
            .set('Authorization', `Bearer ${token}`)
            .set('X-Tenant-ID', OTHER_TENANT)
            .expect(404);
          await supertest(app.getHttpServer())
            .patch(url)
            .set('Authorization', `Bearer ${token}`)
            .set('X-Tenant-ID', OTHER_TENANT)
            .send(body)
            .expect(404);
          await supertest(app.getHttpServer())
            .get(url)
            .set('Authorization', `Bearer ${token}`)
            .expect(401);
          await supertest(app.getHttpServer())
            .patch(url)
            .set('Authorization', `Bearer ${token}`)
            .send(body)
            .expect(401);
        } finally {
          await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
            SEED_ADMIN_USER_ID,
            OTHER_TENANT,
          ]);
        }
      });

      it('E12 Rule 3: a non-UUID id is 400', async () => {
        expect(
          (await grade('not-a-uuid', { items: [{ student_id: randomUUID(), status: 'DONE' }] }))
            .status,
        ).toBe(400);
      });
    });
  });

  // [TIME-11] Guardian SMS on assign is off until the school turns it on.
  describe('assign notice switch', () => {
    const settingsUrl = `/api/v1/schools/${TENANT_ID}/settings`;
    let studentId: string;
    let guardianId: string;

    const logCount = async (): Promise<number> => {
      const rows = await dataSource.query(
        `SELECT COUNT(*)::int AS n FROM communication_logs WHERE student_id = $1`,
        [studentId],
      );
      return rows[0].n;
    };

    const assignHomework = async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/homework')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({
          subject_id: subjectId,
          class_id: SEED_CLASS_1_ID,
          title: 'Notice switch homework',
          grading_mode: HomeworkGradingMode.TICK,
        })
        .expect(201);
      await supertest(app.getHttpServer())
        .post(`/api/v1/homework/${createRes.body.id}/assign`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({
          section_id: MAPPED_SECTION_ID,
          assigned_date: '2026-01-01',
          due_date: '2026-01-08',
        })
        .expect(201);
    };

    beforeEach(async () => {
      await dataSource.query(`UPDATE schools SET settings = settings - 'homework' WHERE id = $1`, [
        TENANT_ID,
      ]);
      studentId = randomUUID();
      await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
         VALUES ($1, 'Notice Student', $2, 1, $3, $4, 'ACTIVE', NOW(), NOW())`,
        [studentId, `HW-NOTICE-${randomUUID().slice(0, 8)}`, MAPPED_SECTION_ID, TENANT_ID],
      );
      const guardian = await dataSource.query(
        `INSERT INTO guardians (full_name, relationship, phone, tenant_id, preferred_communication, is_primary_contact, created_at, updated_at)
         VALUES ('Notice Guardian', 'FATHER', '+8801700000077', $1, 'SMS', true, NOW(), NOW())
         RETURNING id`,
        [TENANT_ID],
      );
      guardianId = guardian[0].id;
      await dataSource.query(
        `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
        [studentId, guardianId],
      );
    });

    // Remove this test's student, guardian and their rows so later specs on the shared
    // section (roster, defaulters, communication_logs counts) do not see them.
    afterEach(async () => {
      await dataSource.query(`DELETE FROM communication_logs WHERE student_id = $1`, [studentId]);
      await dataSource.query(`DELETE FROM homework_submissions WHERE student_id = $1`, [studentId]);
      await dataSource.query(`DELETE FROM student_guardians WHERE student_id = $1`, [studentId]);
      await dataSource.query(`DELETE FROM guardians WHERE id = $1`, [guardianId]);
      await dataSource.query(`DELETE FROM students WHERE id = $1`, [studentId]);
    });

    afterAll(async () => {
      await dataSource.query(`UPDATE schools SET settings = settings - 'homework' WHERE id = $1`, [
        TENANT_ID,
      ]);
    });

    it('settings absent: assign returns 201 and writes no CommunicationLog', async () => {
      await assignHomework();
      expect(await logCount()).toBe(0);
    });

    it('after PATCH { homework: { notifyOnAssign: true } }: assign writes a log', async () => {
      await supertest(app.getHttpServer())
        .patch(settingsUrl)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, homework: { notifyOnAssign: true } })
        .expect(200);

      await assignHomework();
      expect(await logCount()).toBe(1);
    });

    it('a TEACHER cannot change the switch (403)', async () => {
      await supertest(app.getHttpServer())
        .patch(settingsUrl)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, homework: { notifyOnAssign: true } })
        .expect(403);
    });
  });
});

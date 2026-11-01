import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * E2E for the study-plan routes: the role matrix, the D6/D28 owner scope
 * (routine owner vs non-owner), D9 reads, the owner override, the PUT/copy/
 * delete routes, and the tenant fence. The owner scope itself is covered in
 * depth by `study-plans.service.integration.spec.ts`.
 */
const API = '/api/v1';
const TENANT_2 = '00000000-0000-4000-8000-0000007b0002';

const USERS = {
  T: { id: '00000000-0000-4000-8000-0000007b0001', role: UserRole.TEACHER },
  U: { id: '00000000-0000-4000-8000-0000007b0003', role: UserRole.TEACHER },
  H: { id: '00000000-0000-4000-8000-0000007b0004', role: UserRole.TEACHER },
  EXECUTIVE: { id: '00000000-0000-4000-8000-0000007b0005', role: UserRole.EXECUTIVE },
  ACCOUNTANT: { id: '00000000-0000-4000-8000-0000007b0006', role: UserRole.ACCOUNTANT },
  OFFICE_STAFF: { id: '00000000-0000-4000-8000-0000007b0007', role: UserRole.OFFICE_STAFF },
  EXAM_CONTROLLER: { id: '00000000-0000-4000-8000-0000007b0008', role: UserRole.EXAM_CONTROLLER },
  COMMITTEE: { id: '00000000-0000-4000-8000-0000007b0009', role: UserRole.COMMITTEE },
  PARENT: { id: '00000000-0000-4000-8000-0000007b000a', role: UserRole.PARENT },
  STUDENT: { id: '00000000-0000-4000-8000-0000007b000b', role: UserRole.STUDENT },
  ADMIN2: { id: '00000000-0000-4000-8000-0000007b000c', role: UserRole.ADMIN },
} as const;
type Who = keyof typeof USERS;

describe('Study plans E2E (66.2.01)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};
  let adminToken: string;
  let subjectId: string;
  let teacherT: string;
  let teacherU: string;

  const email = (who: string) => `sp-e2e-${who.toLowerCase()}@e2e.example`;

  async function login(mail: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: mail, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  /** Request as `who` in the seed tenant (admin = the seed admin). */
  function as(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    who: Who | 'ADMIN',
    tenant = SEED_TENANT_ID,
  ) {
    const token = who === 'ADMIN' ? adminToken : tokens[who];
    const role = who === 'ADMIN' ? UserRole.ADMIN : USERS[who].role;
    return supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .set('X-Role', role);
  }

  async function makeTeacher(userId: string, tag: string): Promise<string> {
    const teacherId = randomUUID();
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-SPE2E-' || $4, NOW(), NOW())
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'SPE2E-' || $4, '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, userId, SEED_TENANT_ID, tag],
    );
    return teacherId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Tenant Two', 'sp-e2e-tenant-two', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_2],
    );
    for (const [who, u] of Object.entries(USERS)) {
      const tenant = who === 'ADMIN2' ? TENANT_2 : SEED_TENANT_ID;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, email(who), SEED_ADMIN_PASSWORD_HASH, `SP E2E ${who}`],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, tenant, u.role],
      );
      tokens[who] = await login(email(who));
    }
    adminToken = await login(SEED_ADMIN_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Transactional tables are reset between tests: rebuild the fixture.
    subjectId = (
      await dataSource.query(
        `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
         VALUES ($1, $2, 'SP E2E Maths', $3, NOW(), NOW()) RETURNING id`,
        [randomUUID(), SEED_TENANT_ID, `SPE-${randomUUID().slice(0, 8)}`],
      )
    )[0].id;
    for (const classId of [SEED_CLASS_1_ID, SEED_CLASS_2_ID]) {
      await dataSource.query(
        `INSERT INTO class_subjects (id, tenant_id, class_id, subject_id, academic_year_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())`,
        [SEED_TENANT_ID, classId, subjectId, SEED_ACADEMIC_YEAR_ID],
      );
    }

    teacherT = await makeTeacher(USERS.T.id, 'T');
    teacherU = await makeTeacher(USERS.U.id, 'U');
    const teacherH = await makeTeacher(USERS.H.id, 'H');
    // H is CLASS_TEACHER (homeroom) of section 1.
    await dataSource.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, assignment_type, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'CLASS_TEACHER', NOW())`,
      [teacherH, SEED_SECTION_1_ID, SEED_TENANT_ID],
    );

    // Published routine slot: T teaches this subject in section 1.
    const [{ id: shiftId }] = await dataSource.query(
      `INSERT INTO shifts (id, tenant_id, name, day_starts_at, day_ends_at, sequence, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, '08:00', '13:00', 0, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, `SP E2E ${randomUUID().slice(0, 8)}`],
    );
    const [{ id: periodId }] = await dataSource.query(
      `INSERT INTO period_slots (id, tenant_id, shift_id, sequence, kind, name, starts_at, ends_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 1, 'CLASS', 'P1', '08:00', '08:45', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, shiftId],
    );
    const [{ id: routineId }] = await dataSource.query(
      `INSERT INTO routines (id, tenant_id, academic_year_id, name, state, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'SP E2E', 'PUBLISHED', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID],
    );
    const [{ id: slotId }] = await dataSource.query(
      `INSERT INTO routine_slots (id, tenant_id, routine_id, section_id, period_slot_id, weekday, subject_id, recurrence, valid_from, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, $5, 'WEEKLY', '2020-01-01', NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, routineId, SEED_SECTION_1_ID, periodId, subjectId],
    );
    await dataSource.query(
      `INSERT INTO routine_slot_teachers (id, tenant_id, routine_slot_id, teacher_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [SEED_TENANT_ID, slotId, teacherT],
    );
  });

  const body = (over: Record<string, unknown> = {}) => ({
    section_id: SEED_SECTION_1_ID,
    subject_id: subjectId,
    academic_term_id: null,
    ...over,
  });

  async function createPlan(): Promise<string> {
    const res = await as('post', '/study-plans', 'ADMIN').send(body()).expect(201);
    return res.body.id;
  }

  describe('POST /study-plans role matrix', () => {
    it('ADMIN gets 201 and the documented shape', async () => {
      const res = await as('post', '/study-plans', 'ADMIN').send(body()).expect(201);
      expect(res.body).toMatchObject({
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        section: { id: SEED_SECTION_1_ID, class_id: SEED_CLASS_1_ID },
        term: null,
        can_edit: true,
        lessons: [],
        exam_markers: [],
      });
      expect(res.body.owners).toHaveLength(1);
      expect(res.body.owners[0].teacher_id).toBe(teacherT);
    });

    it('the routine owner T gets 201', async () => {
      await as('post', '/study-plans', 'T').send(body()).expect(201);
    });

    it('a second identical POST is 409 STUDY_PLAN_EXISTS with existing_id', async () => {
      const id = await createPlan();
      const res = await as('post', '/study-plans', 'ADMIN').send(body()).expect(409);
      expect(res.body.details).toMatchObject({ code: 'STUDY_PLAN_EXISTS', existing_id: id });
    });

    it('teacher U (not an owner) gets 403', async () => {
      const res = await as('post', '/study-plans', 'U').send(body()).expect(403);
      expect(res.body.details.code).toBe('STUDY_PLAN_OUT_OF_SCOPE');
    });

    for (const who of [
      'EXECUTIVE',
      'ACCOUNTANT',
      'OFFICE_STAFF',
      'EXAM_CONTROLLER',
      'COMMITTEE',
      'PARENT',
      'STUDENT',
    ] as const) {
      it(`${who} gets 403`, async () => {
        await as('post', '/study-plans', who).send(body()).expect(403);
      });
    }

    it('a subject the class does not offer is 400', async () => {
      await dataSource.query('DELETE FROM class_subjects WHERE subject_id = $1', [subjectId]);
      const res = await as('post', '/study-plans', 'ADMIN').send(body()).expect(400);
      expect(res.body.details.code).toBe('STUDY_PLAN_SUBJECT_NOT_OFFERED');
    });

    it('a malformed body is 400', async () => {
      await as('post', '/study-plans', 'ADMIN').send({ section_id: 'nope' }).expect(400);
    });
  });

  describe('reads (D9)', () => {
    it('ADMIN and EXECUTIVE see every plan; T sees own; U sees none; GET /:id by U is 403', async () => {
      const id = await createPlan();
      for (const who of ['ADMIN', 'EXECUTIVE', 'T'] as const) {
        const list = await as('get', '/study-plans', who).expect(200);
        expect(list.body.data.map((p: { id: string }) => p.id)).toContain(id);
        await as('get', `/study-plans/${id}`, who).expect(200);
      }
      const uList = await as('get', '/study-plans', 'U').expect(200);
      expect(uList.body.data).toEqual([]);
      await as('get', `/study-plans/${id}`, 'U').expect(403);
    });

    it('the homeroom teacher of the section reads it but cannot edit it', async () => {
      const id = await createPlan();
      const res = await as('get', `/study-plans/${id}`, 'H').expect(200);
      expect(res.body.can_edit).toBe(false);
      await as('put', `/study-plans/${id}/lessons`, 'H').send({ lessons: [] }).expect(403);
    });

    for (const who of ['PARENT', 'STUDENT', 'COMMITTEE'] as const) {
      it(`${who} gets 403 on GET /study-plans/:id`, async () => {
        const id = await createPlan();
        await as('get', `/study-plans/${id}`, who).expect(403);
      });
    }

    it('filters by section_id and q', async () => {
      const id = await createPlan();
      const hit = await as(
        'get',
        `/study-plans?section_id=${SEED_SECTION_1_ID}&q=SP E2E`,
        'ADMIN',
      ).expect(200);
      expect(hit.body.data.map((p: { id: string }) => p.id)).toContain(id);
      const miss = await as('get', `/study-plans?section_id=${SEED_SECTION_2_ID}`, 'ADMIN').expect(
        200,
      );
      expect(miss.body.data.map((p: { id: string }) => p.id)).not.toContain(id);
    });

    it('a non-uuid id is 400 from ParseUUIDPipe', async () => {
      await as('get', '/study-plans/not-a-uuid', 'ADMIN').expect(400);
    });
  });

  describe('PATCH owner override', () => {
    it('ADMIN 200 (T then loses write, U gains it); owner T gets 403', async () => {
      const id = await createPlan();
      await as('patch', `/study-plans/${id}`, 'T')
        .send({ owner_override_teacher_id: teacherU })
        .expect(403);
      const res = await as('patch', `/study-plans/${id}`, 'ADMIN')
        .send({ owner_override_teacher_id: teacherU })
        .expect(200);
      expect(res.body.owners.map((o: { teacher_id: string }) => o.teacher_id)).toEqual([teacherU]);
      await as('put', `/study-plans/${id}/lessons`, 'T').send({ lessons: [] }).expect(403);
      await as('put', `/study-plans/${id}/lessons`, 'U').send({ lessons: [] }).expect(200);
    });

    it('an unknown teacher is 400', async () => {
      const id = await createPlan();
      await as('patch', `/study-plans/${id}`, 'ADMIN')
        .send({ owner_override_teacher_id: randomUUID() })
        .expect(400);
    });
  });

  describe('PUT lessons / PUT exam-markers / DELETE / copy', () => {
    it('lessons: owner 200, non-owner 403, ADMIN 200, bad input 400', async () => {
      const id = await createPlan();
      const lessons = [{ title: 'Fractions', periods: 3 }];
      const ok = await as('put', `/study-plans/${id}/lessons`, 'T').send({ lessons }).expect(200);
      expect(ok.body.lessons[0].id).toBeDefined();
      await as('put', `/study-plans/${id}/lessons`, 'U').send({ lessons }).expect(403);
      await as('put', `/study-plans/${id}/lessons`, 'ADMIN').send({ lessons }).expect(200);
      await as('put', `/study-plans/${id}/lessons`, 'ADMIN')
        .send({ lessons: [{ title: 'x', periods: 21 }] })
        .expect(400);
      await as('put', `/study-plans/${id}/lessons`, 'ADMIN')
        .send({ lessons: [{ title: 'x', periods: 1, topic_id: randomUUID() }] })
        .expect(400);
    });

    it('exam-markers: owner 200, non-owner 403, ADMIN 200, bad marker 400', async () => {
      const id = await createPlan();
      const put = await as('put', `/study-plans/${id}/lessons`, 'ADMIN')
        .send({ lessons: [{ id: 'l1', title: 'One', periods: 1 }] })
        .expect(200);
      expect(put.body.lessons[0].id).toBe('l1');
      const [{ id: examId }] = await dataSource.query(
        `INSERT INTO exams (id, tenant_id, academic_year_id, class_id, name, kind, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'SP Mid', 'TERM', 'DRAFT', NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID],
      );
      const markers = [{ exam_id: examId, up_to_lesson_id: 'l1' }];
      const ok = await as('put', `/study-plans/${id}/exam-markers`, 'T')
        .send({ markers })
        .expect(200);
      expect(ok.body.exam_markers[0]).toMatchObject({ exam_name: 'SP Mid', up_to_lesson_id: 'l1' });
      await as('put', `/study-plans/${id}/exam-markers`, 'U').send({ markers }).expect(403);
      await as('put', `/study-plans/${id}/exam-markers`, 'ADMIN').send({ markers }).expect(200);
      await as('put', `/study-plans/${id}/exam-markers`, 'ADMIN')
        .send({ markers: [{ exam_id: examId, up_to_lesson_id: 'missing' }] })
        .expect(400);
      await as('put', `/study-plans/${id}/exam-markers`, 'ADMIN')
        .send({ markers: [{ exam_id: randomUUID(), up_to_lesson_id: 'l1' }] })
        .expect(400);
    });

    it('delete: non-owner 403, owner 204, then GET is 404 and the row is soft-deleted', async () => {
      const id = await createPlan();
      await as('delete', `/study-plans/${id}`, 'U').expect(403);
      await as('delete', `/study-plans/${id}`, 'T').expect(204);
      await as('get', `/study-plans/${id}`, 'ADMIN').expect(404);
      const [row] = await dataSource.query('SELECT deleted_at FROM study_plans WHERE id = $1', [
        id,
      ]);
      expect(row.deleted_at).not.toBeNull();
    });

    it('copy-to-section: ADMIN 201, non-owner of the target 403, same section 409', async () => {
      const id = await createPlan();
      await as('post', `/study-plans/${id}/copy-to-section`, 'T')
        .send({ section_id: SEED_SECTION_2_ID })
        .expect(403);
      const copy = await as('post', `/study-plans/${id}/copy-to-section`, 'ADMIN')
        .send({ section_id: SEED_SECTION_2_ID })
        .expect(201);
      expect(copy.body.section.id).toBe(SEED_SECTION_2_ID);
      await as('post', `/study-plans/${id}/copy-to-section`, 'ADMIN')
        .send({ section_id: SEED_SECTION_2_ID })
        .expect(409);
    });
  });

  describe('tenant isolation', () => {
    it('a tenant-2 ADMIN gets 404 reading, editing and deleting a tenant-1 plan', async () => {
      const id = await createPlan();
      await as('get', `/study-plans/${id}`, 'ADMIN2', TENANT_2).expect(404);
      await as('put', `/study-plans/${id}/lessons`, 'ADMIN2', TENANT_2)
        .send({ lessons: [] })
        .expect(404);
      await as('patch', `/study-plans/${id}`, 'ADMIN2', TENANT_2)
        .send({ owner_override_teacher_id: null })
        .expect(404);
      await as('delete', `/study-plans/${id}`, 'ADMIN2', TENANT_2).expect(404);
      const [row] = await dataSource.query(
        'SELECT deleted_at, jsonb_array_length(lessons) AS n FROM study_plans WHERE id = $1',
        [id],
      );
      expect(row.deleted_at).toBeNull();
      expect(row.n).toBe(0);
      const list = await as('get', '/study-plans', 'ADMIN2', TENANT_2).expect(200);
      expect(list.body.data).toEqual([]);
    });

    it('a tenant-2 ADMIN naming tenant 1 in X-Tenant-ID (not a member) is 401, as is a missing header', async () => {
      const id = await createPlan();
      // ContextGuard answers 401 ("User is not a member of the requested tenant") for a foreign X-Tenant-ID.
      await as('get', `/study-plans/${id}`, 'ADMIN2', SEED_TENANT_ID).expect(401);
      await supertest(app.getHttpServer())
        .get(`${API}/study-plans/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(401);
    });
  });
});

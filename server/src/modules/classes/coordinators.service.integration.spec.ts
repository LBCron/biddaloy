import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { User } from '../users/entities/user.entity';
import { CoordinatorAssignment } from '../academics/entities/coordinator-assignment.entity';
import {
  CoordinatorsService,
  COORDINATOR_DUPLICATE,
  COORDINATOR_NOT_FOUND,
} from './coordinators.service';

/**
 * [83.2.2] CoordinatorsService against the migrated DB: bulk assign, duplicate 409, past-year
 * 422, cross-tenant 404 with one fixed sentence (Rule 23), remove.
 */
describe('CoordinatorsService (integration)', () => {
  let service: CoordinatorsService;
  let dataSource: DataSource;
  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000096';
  const classIds: string[] = [];
  let pastClassId: string;
  let classBId: string;
  let teacherId: string;
  let teacherBId: string;
  let subjectId: string;
  let subjectBId: string;
  let adminId: string;

  const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [CoordinatorsService, AuditService]);
    service = module.get(CoordinatorsService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    const schools = dataSource.getRepository(School);
    for (const id of [TENANT_A, TENANT_B]) {
      if (!(await schools.findOne({ where: { id } }))) {
        await schools.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    const years = dataSource.getRepository(AcademicYear);
    await years.update({ tenant_id: TENANT_A }, { is_current: false });
    await years.update({ tenant_id: TENANT_B }, { is_current: false });
    const mkYear = (tenant_id: string, is_current: boolean, y: number) =>
      years.save({
        name: `CO ${y} ${tag()}`,
        start_date: `${y}-01-01`,
        end_date: `${y}-12-31`,
        is_current,
        tenant_id,
      });
    const current = await mkYear(TENANT_A, true, 2026);
    const past = await mkYear(TENANT_A, false, 2025);
    const currentB = await mkYear(TENANT_B, true, 2026);
    const classes = dataSource.getRepository(Class);
    for (const n of [6, 7, 8]) {
      classIds.push(
        (
          await classes.save({
            name: `Class ${n} CO`,
            numeric_grade: n,
            academic_year_id: current.id,
            tenant_id: TENANT_A,
          })
        ).id,
      );
    }
    pastClassId = (
      await classes.save({ name: 'Old CO', academic_year_id: past.id, tenant_id: TENANT_A })
    ).id;
    classBId = (
      await classes.save({ name: 'B CO', academic_year_id: currentB.id, tenant_id: TENANT_B })
    ).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  // teachers / subjects / coordinator rows are reset before every test (test/reset-order.ts).
  beforeEach(async () => {
    const users = dataSource.getRepository(User);
    const teachers = dataSource.getRepository(Teacher);
    const mkTeacher = async (tenant_id: string, name: string) => {
      const u = await users.save({ email: `co-${tag()}@test.com`, full_name: name });
      return (
        await teachers.save({
          user_id: u.id,
          employee_id: `EMP-CO-${tag()}`,
          tenant_id,
          designations: [],
        })
      ).id;
    };
    teacherId = await mkTeacher(TENANT_A, 'Rahim Uddin');
    teacherBId = await mkTeacher(TENANT_B, 'Other School Teacher');
    const subjects = dataSource.getRepository(Subject);
    subjectId = (await subjects.save({ tenant_id: TENANT_A, name_en: 'Mathematics', code: 'MCO' }))
      .id;
    subjectBId = (await subjects.save({ tenant_id: TENANT_B, name_en: 'Mathematics', code: 'MCB' }))
      .id;
    adminId = (await users.save({ email: `co-admin-${tag()}@test.com`, full_name: 'Head Admin' }))
      .id;
  });

  it('bulk-assigns three classes in one call, with who assigned them (D13, D30)', async () => {
    const rows = await service.assign(TENANT_A, adminId, { teacherId, classIds });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.class_name)).toEqual(['Class 6 CO', 'Class 7 CO', 'Class 8 CO']);
    for (const r of rows) {
      expect(r).toMatchObject({
        teacher_id: teacherId,
        teacher_name: 'Rahim Uddin',
        subject_id: null,
        subject_name: null,
        assigned_by_name: 'Head Admin',
      });
      expect(typeof r.created_at).toBe('string');
    }
    const stored = await dataSource
      .getRepository(CoordinatorAssignment)
      .find({ where: { tenant_id: TENANT_A } });
    expect(stored.every((s) => s.assigned_by_user_id === adminId)).toBe(true);
  });

  it('a subject coordinator row carries the subject', async () => {
    const [row] = await service.assign(TENANT_A, adminId, {
      teacherId,
      classIds: [classIds[0]],
      subjectId,
    });
    expect(row).toMatchObject({ subject_id: subjectId, subject_name: 'Mathematics' });
  });

  it('a duplicate is 409 with the fixed sentence, and no partial rows', async () => {
    await service.assign(TENANT_A, adminId, { teacherId, classIds: [classIds[0]] });
    const err = await service
      .assign(TENANT_A, adminId, { teacherId, classIds: [classIds[1], classIds[0]] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(COORDINATOR_DUPLICATE);
    // The transaction rolled back: class 7's row was not kept.
    expect(await service.list(TENANT_A, { teacherId })).toHaveLength(1);
  });

  it('a class of a past academic year is 422', async () => {
    await expect(
      service.assign(TENANT_A, adminId, { teacherId, classIds: [pastClassId] }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // Rule 23: every cross-tenant id is the same 404 sentence as a missing one.
  it('a class, teacher or subject of tenant B is 404 with one sentence', async () => {
    // Thunks, run one at a time: an eager promise would reject before it is awaited.
    const attempts = [
      () => service.assign(TENANT_A, adminId, { teacherId, classIds: [classBId] }),
      () => service.assign(TENANT_A, adminId, { teacherId: teacherBId, classIds: [classIds[0]] }),
      () =>
        service.assign(TENANT_A, adminId, {
          teacherId,
          classIds: [classIds[0]],
          subjectId: subjectBId,
        }),
    ];
    for (const attempt of attempts) {
      const err = await attempt().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).message).toBe(COORDINATOR_NOT_FOUND);
    }
    expect(await service.list(TENANT_A, {})).toEqual([]);
  });

  it('lists by teacher and by class', async () => {
    await service.assign(TENANT_A, adminId, { teacherId, classIds: [classIds[0], classIds[1]] });
    expect(await service.list(TENANT_A, { teacherId })).toHaveLength(2);
    expect(await service.list(TENANT_A, { classId: classIds[1] })).toHaveLength(1);
    expect(await service.list(TENANT_B, { teacherId })).toEqual([]);
  });

  it('remove deletes the row; a tenant-B id is 404', async () => {
    const [row] = await service.assign(TENANT_A, adminId, { teacherId, classIds: [classIds[2]] });
    await expect(service.remove(TENANT_B, row.id, adminId)).rejects.toThrow(NotFoundException);
    await service.remove(TENANT_A, row.id, adminId);
    expect(await service.list(TENANT_A, {})).toEqual([]);
    await expect(service.remove(TENANT_A, row.id, adminId)).rejects.toThrow(NotFoundException);
  });
});

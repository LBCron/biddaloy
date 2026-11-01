import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { AcademicYear } from './academic-year.entity';
import { Class } from './class.entity';
import { Subject } from './subject.entity';
import { Teacher } from './teacher.entity';
import { CoordinatorAssignment } from './coordinator-assignment.entity';

/**
 * [83.1.2] `coordinator_assignments` against the migrated schema: the NULLS NOT DISTINCT unique
 * (D11), the cascades (D15) and SET NULL on the assigning user (D30), and tenant filtering.
 */
describe('CoordinatorAssignment entity (integration)', () => {
  let dataSource: DataSource;
  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000097';
  let yearId: string;
  let teacherId: string;
  let subjectId: string;
  let adminUserId: string;

  const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const repo = () => dataSource.getRepository(CoordinatorAssignment);
  const makeClass = async (tenantId = TENANT_A, year = yearId) =>
    (
      await dataSource
        .getRepository(Class)
        .save({ name: `CA ${tag()}`, academic_year_id: year, tenant_id: tenantId })
    ).id;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    const schools = dataSource.getRepository(School);
    for (const id of [TENANT_A, TENANT_B]) {
      if (!(await schools.findOne({ where: { id } }))) {
        await schools.save({ id, name: id, slug: `school-${id.slice(-4)}` });
      }
    }
    yearId = (
      await dataSource.getRepository(AcademicYear).save({
        name: `CA Year ${tag()}`,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        is_current: false,
        tenant_id: TENANT_A,
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  // teachers, subjects and coordinator rows are reset before every test (test/reset-order.ts).
  beforeEach(async () => {
    const teacherUser = await dataSource
      .getRepository(User)
      .save({ email: `ca-t-${tag()}@test.com`, full_name: 'CA Teacher' });
    teacherId = (
      await dataSource.getRepository(Teacher).save({
        user_id: teacherUser.id,
        employee_id: `EMP-CA-${tag()}`,
        tenant_id: TENANT_A,
        designations: [],
      })
    ).id;
    subjectId = (
      await dataSource
        .getRepository(Subject)
        .save({ tenant_id: TENANT_A, name_en: 'Mathematics', code: `M${tag().slice(-6)}` })
    ).id;
    adminUserId = (
      await dataSource
        .getRepository(User)
        .save({ email: `ca-a-${tag()}@test.com`, full_name: 'CA Admin' })
    ).id;
  });

  it('stores a class-level row and a subject row for the same (teacher, class)', async () => {
    const classId = await makeClass();
    await repo().save({ tenant_id: TENANT_A, teacher_id: teacherId, class_id: classId });
    await repo().save({
      tenant_id: TENANT_A,
      teacher_id: teacherId,
      class_id: classId,
      subject_id: subjectId,
      assigned_by_user_id: adminUserId,
    });
    expect(await repo().count({ where: { class_id: classId } })).toBe(2);
  });

  // D11: NULLS NOT DISTINCT — without it two NULL-subject rows would both be accepted.
  it('refuses a second class-level row for the same (tenant, teacher, class)', async () => {
    const classId = await makeClass();
    await repo().save({ tenant_id: TENANT_A, teacher_id: teacherId, class_id: classId });
    await expect(
      repo().insert({ tenant_id: TENANT_A, teacher_id: teacherId, class_id: classId }),
    ).rejects.toThrow(/UQ_coordinator_assignment/);
  });

  it('refuses a second identical subject row', async () => {
    const classId = await makeClass();
    const row = {
      tenant_id: TENANT_A,
      teacher_id: teacherId,
      class_id: classId,
      subject_id: subjectId,
    };
    // Copies: `insert` writes the generated id back onto the object it gets.
    await repo().insert({ ...row });
    await expect(repo().insert({ ...row })).rejects.toThrow(/UQ_coordinator_assignment/);
  });

  it('deleting the class deletes its rows (CASCADE, D15)', async () => {
    const classId = await makeClass();
    await repo().save({ tenant_id: TENANT_A, teacher_id: teacherId, class_id: classId });
    await dataSource.query(`DELETE FROM classes WHERE id = $1`, [classId]);
    expect(await repo().count({ where: { class_id: classId } })).toBe(0);
  });

  it('deleting the subject deletes the subject row (CASCADE, D15)', async () => {
    const classId = await makeClass();
    await repo().save({
      tenant_id: TENANT_A,
      teacher_id: teacherId,
      class_id: classId,
      subject_id: subjectId,
    });
    await dataSource.query(`DELETE FROM subjects WHERE id = $1`, [subjectId]);
    expect(await repo().count({ where: { class_id: classId } })).toBe(0);
  });

  it('deleting the assigning user keeps the row with assigned_by_user_id NULL (D30)', async () => {
    const classId = await makeClass();
    const row = await repo().save({
      tenant_id: TENANT_A,
      teacher_id: teacherId,
      class_id: classId,
      assigned_by_user_id: adminUserId,
    });
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [adminUserId]);
    const after = await repo().findOneByOrFail({ id: row.id });
    expect(after.assigned_by_user_id).toBeNull();
    expect(after.created_at).toBeInstanceOf(Date);
  });

  it('tenant isolation: a tenant-B row is invisible to a tenant-A query', async () => {
    const yearB = await dataSource.getRepository(AcademicYear).save({
      name: `CA Year B ${tag()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: false,
      tenant_id: TENANT_B,
    });
    const classB = await makeClass(TENANT_B, yearB.id);
    await repo().save({ tenant_id: TENANT_B, teacher_id: teacherId, class_id: classB });
    expect(await repo().count({ where: { tenant_id: TENANT_A, class_id: classB } })).toBe(0);
    expect(await repo().count({ where: { tenant_id: TENANT_B, class_id: classB } })).toBe(1);
  });
});

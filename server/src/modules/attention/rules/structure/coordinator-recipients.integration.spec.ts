import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { coordinatorRecipients, coordinates } from './coordinator-recipients';

/**
 * [83.2.4] `coordinatorRecipients` against Postgres: class and subject rows, an inactive user,
 * a past-year class and another tenant's row. Each tenant here is its own fresh school, so the
 * once-per-file reference reset never touches another spec's data.
 */
describe('coordinatorRecipients (integration)', () => {
  let ds: DataSource;
  const rand = () => Math.random().toString(36).slice(2, 9);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  async function mkTenant() {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Coord Recipients', $1) RETURNING id`,
      [`coord-rcpt-${rand()}`],
    );
    const year = async (current: boolean, y: number) =>
      (
        await ds.query(
          `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [`Y${y}-${rand()}`, `${y}-01-01`, `${y}-12-31`, current, id],
        )
      )[0].id as string;
    const current = await year(true, 2043);
    const past = await year(false, 2042);
    const klass = async (yearId: string) =>
      (
        await ds.query(
          `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, $2, $3) RETURNING id`,
          [id, `C-${rand()}`, yearId],
        )
      )[0].id as string;
    const subject = (
      await ds.query(
        `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'Mathematics', $2) RETURNING id`,
        [id, `M${rand()}`],
      )
    )[0].id as string;
    return {
      id,
      class6: await klass(current),
      class7: await klass(current),
      pastClass: await klass(past),
      subject,
    };
  }

  async function mkTeacher(tenantId: string, status = 'ACTIVE') {
    const [{ id: userId }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Coord', $2, NOW(), NOW()) RETURNING id`,
      [`coord-${rand()}@example.com`, status],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'TEACHER')`,
      [userId, tenantId],
    );
    // Via the repository so the `staff_profile_id` subscriber runs.
    const teacher = await ds.getRepository(Teacher).save({
      user_id: userId,
      employee_id: `EMP-${rand()}`,
      tenant_id: tenantId,
      designations: [],
    });
    return { userId: userId as string, teacherId: teacher.id };
  }

  const coordinate = (tenantId: string, teacherId: string, classId: string, subjectId?: string) =>
    ds.query(
      `INSERT INTO coordinator_assignments (tenant_id, teacher_id, class_id, subject_id)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, teacherId, classId, subjectId ?? null],
    );

  it('lists class and subject coordinators of the asked classes, as TEACHER', async () => {
    const a = await mkTenant();
    const classCoord = await mkTeacher(a.id);
    const mathsCoord = await mkTeacher(a.id);
    await coordinate(a.id, classCoord.teacherId, a.class6);
    await coordinate(a.id, mathsCoord.teacherId, a.class6, a.subject);
    await coordinate(a.id, mathsCoord.teacherId, a.class7, a.subject);

    const rows = await coordinatorRecipients(ds, a.id, [a.class6]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.role === UserRole.TEACHER)).toBe(true);
    const classRow = rows.find((r) => r.userId === classCoord.userId)!;
    const mathsRow = rows.find((r) => r.userId === mathsCoord.userId)!;
    // Class coordinator: every subject, and attendance (subject null).
    expect(coordinates(classRow, a.class6, null)).toBe(true);
    expect(coordinates(classRow, a.class6, a.subject)).toBe(true);
    // Subject coordinator: only their subject; never attendance.
    expect(coordinates(mathsRow, a.class6, a.subject)).toBe(true);
    expect(coordinates(mathsRow, a.class6, null)).toBe(false);
    expect(coordinates(mathsRow, a.class7, a.subject)).toBe(false);
  });

  it('skips a user whose TEACHER membership is gone, even with another live role', async () => {
    const a = await mkTenant();
    const former = await mkTeacher(a.id);
    await coordinate(a.id, former.teacherId, a.class6);
    await ds.query(
      `UPDATE user_tenants SET deleted_at = NOW() WHERE user_id = $1 AND tenant_id = $2 AND role = 'TEACHER'`,
      [former.userId, a.id],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'ACCOUNTANT')`,
      [former.userId, a.id],
    );
    expect(await coordinatorRecipients(ds, a.id, [a.class6])).toEqual([]);
  });

  it('skips an inactive user and a class of a past academic year', async () => {
    const a = await mkTenant();
    const suspended = await mkTeacher(a.id, 'SUSPENDED');
    const active = await mkTeacher(a.id);
    await coordinate(a.id, suspended.teacherId, a.class6);
    await coordinate(a.id, active.teacherId, a.pastClass);
    expect(await coordinatorRecipients(ds, a.id, [a.class6, a.pastClass])).toEqual([]);
  });

  it("tenant isolation: tenant B's row never shows for tenant A", async () => {
    const a = await mkTenant();
    const b = await mkTenant();
    const tb = await mkTeacher(b.id);
    await coordinate(b.id, tb.teacherId, b.class6);
    expect(await coordinatorRecipients(ds, a.id, [b.class6])).toEqual([]);
    expect(await coordinatorRecipients(ds, b.id, [b.class6])).toHaveLength(1);
  });

  it('no classes: no query, empty list', async () => {
    expect(await coordinatorRecipients(ds, '00000000-0000-4000-8000-000000000001', [])).toEqual([]);
  });
});

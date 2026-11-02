import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AudienceTab, AudienceTarget, NOTICE_LIMITS, UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { AuthModule } from '../auth/auth.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { SchoolsModule } from '../schools/schools.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AudienceService } from './audience.service';
import { AudienceQueryDto } from './dto/audience-query.dto';

describe('AudienceService (integration)', () => {
  let ds: DataSource;
  let service: AudienceService;
  const stamp = Date.now();
  const admin = { role: UserRole.ADMIN, userId: '00000000-0000-4000-8000-000000000001' };
  let tenantB: string;
  let studentLogin: string;
  let yearA: string;
  let yearB: string;
  let classA: string;
  let classB: string;
  let sec1: string;
  let sec2: string;
  let sec3: string;
  let secB: string;
  let teacherUser: string;
  let lonelyTeacherUser: string;
  let staffUser: string;
  let staffUserB: string;
  let s1: string;
  let s2: string;
  let sTransferred: string;
  let sB: string;
  let g1: string;
  let gDeleted: string;
  let gB: string;

  const q = (over: Partial<AudienceQueryDto>): AudienceQueryDto =>
    ({ page: 1, limit: 100, ...over }) as AudienceQueryDto;
  const mkUser = async (n: string, phone: string | null = null) =>
    (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, phone, created_at, updated_at)
         VALUES ($1, 'x', $2, 'ACTIVE', $3, NOW(), NOW()) RETURNING id`,
        [`aud-${n}-${stamp}@example.com`, `Aud ${n}`, phone],
      )
    )[0].id as string;
  const member = (userId: string, role: UserRole, tenant: string) =>
    ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [userId, tenant, role],
    );
  const mkStudent = async (
    name: string,
    section: string,
    tenant: string,
    status: string,
    userId: string | null,
    n: number,
  ) =>
    (
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, user_id, enrollment_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [name, `AUD-${stamp}-${n}`, n, section, tenant, userId, status],
      )
    )[0].id as string;
  const mkGuardian = async (name: string, tenant: string, deleted: boolean, ...kids: string[]) => {
    const [g] = await ds.query(
      `INSERT INTO guardians (full_name, relationship, phone, tenant_id, deleted_at)
       VALUES ($1, 'Father', '01700000000', $2, ${deleted ? 'NOW()' : 'NULL'}) RETURNING id`,
      [name, tenant],
    );
    for (const k of kids)
      await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
        k,
        g.id,
      ]);
    return g.id as string;
  };
  const names = (r: { items: { name: string }[] }) => r.items.map((i) => i.name);

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [AudienceService, TeacherScopeService],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, SchoolsModule, AuthModule],
    );
    ds = module.get(DataSource);
    service = module.get(AudienceService);
    [{ id: tenantB }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Audience B', 'aud-b-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    [{ id: yearA }] = await ds.query(
      `SELECT id FROM academic_years WHERE tenant_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1`,
      [SEED_TENANT_ID],
    );
    [{ id: yearB }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('AudB', '2026-01-01', '2026-12-31', true, $1) RETURNING id`,
      [tenantB],
    );
    const mkClass = async (tenant: string, year: string) =>
      (
        await ds.query(
          `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, 'Aud Class', $2) RETURNING id`,
          [tenant, year],
        )
      )[0].id as string;
    const mkSection = async (tenant: string, cls: string, name: string) =>
      (
        await ds.query(
          `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, $3) RETURNING id`,
          [tenant, cls, name],
        )
      )[0].id as string;
    classA = await mkClass(SEED_TENANT_ID, yearA);
    classB = await mkClass(tenantB, yearB);
    sec1 = await mkSection(SEED_TENANT_ID, classA, 'A1');
    sec2 = await mkSection(SEED_TENANT_ID, classA, 'A2');
    sec3 = await mkSection(SEED_TENANT_ID, classA, 'A3');
    secB = await mkSection(tenantB, classB, 'B1');

    teacherUser = await mkUser('teacher');
    lonelyTeacherUser = await mkUser('lonely');
    staffUser = await mkUser('staff', '01711111111');
    staffUserB = await mkUser('staffB');
    await member(teacherUser, UserRole.TEACHER, SEED_TENANT_ID);
    await member(lonelyTeacherUser, UserRole.TEACHER, SEED_TENANT_ID);
    await member(staffUser, UserRole.OFFICE_STAFF, SEED_TENANT_ID);
    await member(staffUserB, UserRole.OFFICE_STAFF, tenantB);
    studentLogin = await mkUser('studentlogin', '01722222222');
  }, 120_000);

  // The suite wipes students, guardians and teachers before every test, so they are made here.
  beforeEach(async () => {
    // via the repository so the subscriber creates the staff profile
    const t = await ds.getRepository(Teacher).save({
      user_id: teacherUser,
      employee_id: `AUD-${stamp}`,
      tenant_id: SEED_TENANT_ID,
      designations: [],
    });
    await ds.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
       VALUES ($1, $2, $3, 'CLASS_TEACHER')`,
      [t.id, sec1, SEED_TENANT_ID],
    );

    s1 = await mkStudent('Aud Stu One', sec1, SEED_TENANT_ID, 'ACTIVE', studentLogin, 1);
    s2 = await mkStudent('Aud Stu Two', sec1, SEED_TENANT_ID, 'ACTIVE', null, 2);
    sTransferred = await mkStudent('Aud Stu Gone', sec1, SEED_TENANT_ID, 'TRANSFERRED', null, 3);
    await mkStudent('Aud Stu Sec2', sec2, SEED_TENANT_ID, 'ACTIVE', null, 4);
    sB = await mkStudent('Aud Stu Other School', secB, tenantB, 'ACTIVE', null, 5);
    g1 = await mkGuardian('Aud Guardian', SEED_TENANT_ID, false, s1, s2);
    gDeleted = await mkGuardian('Aud Guardian Deleted', SEED_TENANT_ID, true, s1);
    gB = await mkGuardian('Aud Guardian B', tenantB, false, sB);
  }, 60_000);

  afterAll(async () => {
    const both = [SEED_TENANT_ID, tenantB];
    await ds.query(
      `DELETE FROM student_guardians WHERE student_id IN (SELECT id FROM students WHERE registration_number LIKE $1)`,
      [`AUD%-${stamp}%`],
    );
    await ds.query(`DELETE FROM guardians WHERE id = ANY($1::uuid[])`, [[g1, gDeleted, gB]]);
    await ds.query(`DELETE FROM students WHERE registration_number LIKE $1`, [`AUD%-${stamp}%`]);
    await ds.query(`DELETE FROM teacher_class_sections WHERE section_id = $1`, [sec1]);
    await ds.query(`DELETE FROM teachers WHERE employee_id = $1`, [`AUD-${stamp}`]);
    await ds.query(
      `DELETE FROM staff_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`aud-%-${stamp}@example.com`],
    );
    await ds.query(`DELETE FROM class_sections WHERE id = ANY($1::uuid[])`, [
      [sec1, sec2, sec3, secB],
    ]);
    await ds.query(`DELETE FROM classes WHERE id = ANY($1::uuid[])`, [[classA, classB]]);
    await ds.query(`DELETE FROM academic_years WHERE id = $1`, [yearB]);
    await ds.query(
      `DELETE FROM user_tenants WHERE tenant_id = ANY($1::uuid[]) AND user_id IN (SELECT id FROM users WHERE email LIKE $2)`,
      [both, `aud-%-${stamp}@example.com`],
    );
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`aud-%-${stamp}@example.com`]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
  });

  it('ROLE tab returns staff of that role, never another school (tenant isolation)', async () => {
    const r = await service.list(
      SEED_TENANT_ID,
      admin,
      q({ target: AudienceTarget.STAFF, tab: AudienceTab.ROLE, roles: [UserRole.OFFICE_STAFF] }),
    );
    const ids = r.items.map((i) => i.userId);
    expect(ids).toContain(staffUser);
    expect(ids).not.toContain(staffUserB);
    expect(r.items.find((i) => i.userId === staffUser)).toMatchObject({
      kind: 'STAFF',
      hasLogin: true,
      hasPhone: true,
    });
    // the phone number itself is never returned
    expect(JSON.stringify(r)).not.toContain('01711111111');
  });

  it('NAMED_STAFF finds by name; LIKE wildcards are literal', async () => {
    const hit = await service.list(
      SEED_TENANT_ID,
      admin,
      q({ target: AudienceTarget.STAFF, tab: AudienceTab.NAMED_STAFF, q: 'Aud staff' }),
    );
    expect(names(hit)).toEqual(['Aud staff']);
    const wild = await service.list(
      SEED_TENANT_ID,
      admin,
      q({ target: AudienceTarget.STAFF, tab: AudienceTab.NAMED_STAFF, q: '%' }),
    );
    expect(wild.items).toEqual([]);
  });

  it('SECTION and CLASS tabs return active students only', async () => {
    const bySection = await service.list(
      SEED_TENANT_ID,
      admin,
      q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.SECTION, sectionIds: [sec1] }),
    );
    // TRANSFERRED student is out
    expect(bySection.items.map((i) => i.studentId).sort()).toEqual([s1, s2].sort());
    expect(bySection.items.map((i) => i.studentId)).not.toContain(sTransferred);
    expect(bySection.items.find((i) => i.studentId === s1)).toMatchObject({
      kind: 'STUDENT',
      detail: 'Aud Class · A1',
      hasLogin: true,
      hasPhone: true,
    });
    expect(bySection.items.find((i) => i.studentId === s2)).toMatchObject({
      hasLogin: false,
      hasPhone: false,
    });
    const byClass = await service.list(
      SEED_TENANT_ID,
      admin,
      q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.CLASS, classIds: [classA] }),
    );
    expect(names(byClass)).toContain('Aud Stu Sec2');
    expect(byClass.total).toBe(3); // s1, s2, and the sec2 student; TRANSFERRED is out;
  });

  it("tenant A cannot reach tenant B's section or students", async () => {
    const r = await service.list(
      SEED_TENANT_ID,
      admin,
      q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.SECTION, sectionIds: [secB] }),
    );
    expect(r.items).toEqual([]);
    const named = await service.list(
      SEED_TENANT_ID,
      admin,
      q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.NAMED_STUDENT, q: 'Other School' }),
    );
    expect(named.items).toEqual([]);
  });

  it('NAMED_STUDENT searches by name', async () => {
    const r = await service.list(
      SEED_TENANT_ID,
      admin,
      q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.NAMED_STUDENT, q: 'stu one' }),
    );
    expect(r.items.map((i) => i.studentId)).toEqual([s1]);
  });

  it('GUARDIANS: one row per (guardian, student) pair; deleted guardian is out', async () => {
    const r = await service.list(
      SEED_TENANT_ID,
      admin,
      q({ target: AudienceTarget.GUARDIANS, tab: AudienceTab.SECTION, sectionIds: [sec1] }),
    );
    expect(r.items.map((i) => [i.guardianId, i.studentId]).sort()).toEqual(
      [
        [g1, s1],
        [g1, s2],
      ].sort(),
    );
    expect(r.items.map((i) => i.guardianId)).not.toContain(gDeleted);
    expect(r.items[0]).toMatchObject({ kind: 'GUARDIAN', hasLogin: false, hasPhone: true });
    expect(JSON.stringify(r)).not.toContain('01700000000');
  });

  it('paging: limit and page slice the result, total stays', async () => {
    const r = await service.list(
      SEED_TENANT_ID,
      admin,
      q({
        target: AudienceTarget.STUDENTS,
        tab: AudienceTab.SECTION,
        sectionIds: [sec1],
        limit: 1,
        page: 2,
      }),
    );
    expect(r.items).toHaveLength(1);
    expect(r.total).toBe(2);
  });

  it('matchAll stops at cap + 1', async () => {
    // 5,002 students in sec3 for the cap test
    await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       SELECT 'Aud Bulk ' || i, 'AUDBULK-' || $3::text || '-' || i, i, $1, $2, 'ACTIVE'
         FROM generate_series(1, $4::int) i`,
      [sec3, SEED_TENANT_ID, stamp, NOTICE_LIMITS.recipientsMax + 2],
    );
    const all = await service.matchAll(SEED_TENANT_ID, admin, {
      target: AudienceTarget.STUDENTS,
      tab: AudienceTab.SECTION,
      sectionIds: [sec3],
    });
    expect(all).toHaveLength(NOTICE_LIMITS.recipientsMax + 1);
  });

  it('advanced tabs, bad combos, SUPER_ADMIN and empty picks answer 400', async () => {
    const run = (over: Partial<AudienceQueryDto>) => service.list(SEED_TENANT_ID, admin, q(over));
    // an advanced tab with nothing picked is a 400
    await expect(
      run({ target: AudienceTarget.STUDENTS, tab: AudienceTab.EXAM_FAILED }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      run({ target: AudienceTarget.STUDENTS, tab: AudienceTab.LOW_ATTENDANCE }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      run({ target: AudienceTarget.GUARDIANS, tab: AudienceTab.ORG_GROUP }),
    ).rejects.toThrow(BadRequestException);
    // staff has no advanced tabs
    await expect(run({ target: AudienceTarget.STAFF, tab: AudienceTab.FEE_DUE })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      run({ target: AudienceTarget.STAFF, tab: AudienceTab.SECTION, sectionIds: [sec1] }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      run({ target: AudienceTarget.STAFF, tab: AudienceTab.ROLE, roles: [UserRole.SUPER_ADMIN] }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      run({ target: AudienceTarget.STUDENTS, tab: AudienceTab.CLASS, classIds: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('hasLogin is false for a suspended or deleted user, true for an active one', async () => {
    // student s1 is linked to an ACTIVE user (studentLogin)
    const sec = q({
      target: AudienceTarget.STUDENTS,
      tab: AudienceTab.SECTION,
      sectionIds: [sec1],
    });
    const active = await service.list(SEED_TENANT_ID, admin, sec);
    expect(active.items.find((i) => i.studentId === s1)?.hasLogin).toBe(true);
    await ds.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [studentLogin]);
    try {
      const suspended = await service.list(SEED_TENANT_ID, admin, sec);
      expect(suspended.items.find((i) => i.studentId === s1)?.hasLogin).toBe(false);
    } finally {
      await ds.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [studentLogin]);
    }
    // guardian: active user -> true, suspended -> false
    await ds.query(`UPDATE guardians SET user_id = $1 WHERE id = $2`, [staffUser, g1]);
    const gq = q({
      target: AudienceTarget.GUARDIANS,
      tab: AudienceTab.SECTION,
      sectionIds: [sec1],
    });
    try {
      const on = await service.list(SEED_TENANT_ID, admin, gq);
      expect(on.items.every((i) => i.hasLogin)).toBe(true);
      await ds.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [staffUser]);
      const off = await service.list(SEED_TENANT_ID, admin, gq);
      expect(off.items.every((i) => !i.hasLogin)).toBe(true);
    } finally {
      await ds.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [staffUser]);
    }
  });

  it('a page past the last page still reports the real total', async () => {
    const r = await service.list(
      SEED_TENANT_ID,
      admin,
      q({
        target: AudienceTarget.STUDENTS,
        tab: AudienceTab.SECTION,
        sectionIds: [sec1],
        limit: 1,
        page: 5,
      }),
    );
    expect(r.items).toEqual([]);
    expect(r.total).toBe(2);
  });

  it('GUARDIANS matchAll is not cut at the cap: every pair comes back, 2,501 distinct guardians', async () => {
    // 2,501 guardians, each with two children in sec3 => 5,002 pairs (> cap + 1)
    const n = 2501;
    await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
       SELECT 'Aud GBulk ' || i, 'AUDGBULK-' || $3::text || '-' || i, i, $1, $2, 'ACTIVE'
         FROM generate_series(1, $4::int) i`,
      [sec3, SEED_TENANT_ID, stamp, n * 2],
    );
    await ds.query(
      `INSERT INTO guardians (full_name, relationship, phone, tenant_id)
       SELECT 'Aud GBulk G' || i, 'Father', '01700000001', $1 FROM generate_series(1, $2::int) i`,
      [SEED_TENANT_ID, n],
    );
    await ds.query(
      `INSERT INTO student_guardians (student_id, guardian_id)
       SELECT s.id, g.id
         FROM (SELECT id, row_number() OVER (ORDER BY roll_number) AS rn FROM students
                WHERE registration_number LIKE $1) s
         JOIN (SELECT id, row_number() OVER (ORDER BY full_name) AS rn FROM guardians
                WHERE full_name LIKE 'Aud GBulk G%' AND tenant_id = $2) g
           ON g.rn = (s.rn + 1) / 2`,
      [`AUDGBULK-${stamp}-%`, SEED_TENANT_ID],
    );
    // Fresh planner statistics, as autovacuum would give a real school. Without them the planner
    // still thinks these tables hold a few rows and scans every guardian once per student (12.5M
    // row visits: ~10 s alone, over 60 s on a loaded CI worker). With them the query takes ~70 ms.
    await ds.query('ANALYZE students, guardians, student_guardians');
    try {
      const all = await service.matchAll(SEED_TENANT_ID, admin, {
        target: AudienceTarget.GUARDIANS,
        tab: AudienceTab.SECTION,
        sectionIds: [sec3],
      });
      expect(all.length).toBeGreaterThan(NOTICE_LIMITS.recipientsMax + 1);
      expect(all).toHaveLength(n * 2);
      expect(new Set(all.map((p) => p.guardianId)).size).toBe(n);
    } finally {
      await ds.query(
        `DELETE FROM student_guardians WHERE student_id IN (SELECT id FROM students WHERE registration_number LIKE $1)`,
        [`AUDGBULK-${stamp}-%`],
      );
      await ds.query(
        `DELETE FROM guardians WHERE full_name LIKE 'Aud GBulk G%' AND tenant_id = $1`,
        [SEED_TENANT_ID],
      );
      await ds.query(`DELETE FROM students WHERE registration_number LIKE $1`, [
        `AUDGBULK-${stamp}-%`,
      ]);
    }
  }, 60_000);

  describe('teacher scope (Rule 2)', () => {
    const teacher = () => ({ role: UserRole.TEACHER, userId: teacherUser });

    it('sees only their own section; a class pick narrows to it', async () => {
      const own = await service.list(
        SEED_TENANT_ID,
        teacher(),
        q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.SECTION, sectionIds: [sec1] }),
      );
      expect(own.items).toHaveLength(2);
      const byClass = await service.list(
        SEED_TENANT_ID,
        teacher(),
        q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.CLASS, classIds: [classA] }),
      );
      expect(names(byClass).sort()).toEqual(['Aud Stu One', 'Aud Stu Two']);
      const guardians = await service.list(
        SEED_TENANT_ID,
        teacher(),
        q({ target: AudienceTarget.GUARDIANS, tab: AudienceTab.CLASS, classIds: [classA] }),
      );
      expect(guardians.items).toHaveLength(2);
    });

    it('a section outside their scope is 404', async () => {
      await expect(
        service.list(
          SEED_TENANT_ID,
          teacher(),
          q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.SECTION, sectionIds: [sec2] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('a class with none of their sections is 404', async () => {
      await expect(
        service.list(
          SEED_TENANT_ID,
          teacher(),
          q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.CLASS, classIds: [classB] }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('STAFF is refused', async () => {
      await expect(
        service.list(
          SEED_TENANT_ID,
          teacher(),
          q({ target: AudienceTarget.STAFF, tab: AudienceTab.NAMED_STAFF }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a teacher with no assignment gets an empty list', async () => {
      const r = await service.list(
        SEED_TENANT_ID,
        { role: UserRole.TEACHER, userId: lonelyTeacherUser },
        q({ target: AudienceTarget.STUDENTS, tab: AudienceTab.CLASS, classIds: [classA] }),
      );
      expect(r).toMatchObject({ items: [], total: 0 });
    });
  });
});

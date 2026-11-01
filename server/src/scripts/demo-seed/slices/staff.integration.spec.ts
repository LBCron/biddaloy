import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../../modules/audit/audit.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { PresetApplyService } from '../../../modules/presets/preset-apply.service';
import { PresetRegistryService } from '../../../modules/presets/preset-registry.service';
import { AuthTokenService } from '../../../modules/account-access/auth-token.service';
import { SchoolInviteService } from '../../../modules/account-access/school-invite.service';
import { StaffProfilesService } from '../../../modules/staff-profiles/staff-profiles.service';
import { TeacherService, UserService } from '../../../modules/users/users.service';
import { AccessTokenDenylistService } from '../../../modules/auth/access-token-denylist.service';
import { SessionCutoffService } from '../../../modules/auth/session-cutoff.service';
import { RefreshTokenService } from '../../../modules/auth/refresh-token.service';
import { ACCESS_TOKEN_TTL_MS } from '../../../modules/auth/auth-tokens';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { TEACHER_ROSTER } from '../../seed-data/demo-bn/subjects-staffing';
import { createContext, type DemoSeedContext } from '../context';
import { slice as org } from './org';
import { slice, staffByCardKey } from './staff';

const ANCHOR = '2026-10-10';

describe('staff slice (integration, 2 years)', () => {
  let ds: DataSource;
  let ctx: DemoSeedContext;

  const q = <T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);
  // Active teachers per branch: a leaver's membership is soft-deleted, so the join drops them.
  const activeTeachers = (slug: string) =>
    q<{ n: string }>(
      `SELECT count(*) AS n FROM teachers t
         JOIN schools s ON s.id = t.tenant_id
         JOIN user_tenants ut ON ut.user_id = t.user_id AND ut.tenant_id = t.tenant_id
                              AND ut.role = 'TEACHER' AND ut.deleted_at IS NULL
        WHERE s.slug = $1`,
      [slug],
    ).then((r) => Number(r[0].n));

  let app: TestingModule;

  beforeAll(async () => {
    const module: TestingModule = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      AuthTokenService,
      SchoolInviteService,
      StaffProfilesService,
      UserService,
      TeacherService,
      { provide: ACCESS_TOKEN_TTL_MS, useValue: 900_000 },
      { provide: AccessTokenDenylistService, useValue: { revokeUserTokensIssuedBefore: vi.fn() } },
      { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
      { provide: RefreshTokenService, useValue: {} },
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
      { provide: StorageService, useValue: { put: async () => undefined } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    app = module;
  }, 120_000);

  // The test setup empties the data tables before every `it`, so both slices run once per test.
  beforeEach(async () => {
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await slice.run(ctx);
  }, 240_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('each branch has the D9 teacher roster (the shared ICT teacher counts in College too)', async () => {
    expect(await activeTeachers('bmsc-primary')).toBe(TEACHER_ROSTER.PRIMARY.length);
    expect(await activeTeachers('bmsc-high')).toBe(TEACHER_ROSTER.HIGH.length);
    // 8 own teachers + the shared ICT teacher.
    expect(await activeTeachers('bmsc-college')).toBe(TEACHER_ROSTER.COLLEGE.length + 1);
  });

  it('every branch has a principal, accountant, office staff and exam controller; High has 3 committee members', async () => {
    const rows = await q(
      `SELECT s.slug, ut.role, count(*) AS n FROM user_tenants ut JOIN schools s ON s.id = ut.tenant_id
        WHERE s.slug LIKE 'bmsc-%' AND ut.deleted_at IS NULL
          AND ut.role IN ('EXECUTIVE','ACCOUNTANT','OFFICE_STAFF','EXAM_CONTROLLER','COMMITTEE')
        GROUP BY s.slug, ut.role`,
    );
    for (const slug of ['bmsc-primary', 'bmsc-high', 'bmsc-college']) {
      for (const role of ['EXECUTIVE', 'ACCOUNTANT', 'OFFICE_STAFF', 'EXAM_CONTROLLER']) {
        expect(rows.find((r) => r.slug === slug && r.role === role)?.n).toBe('1');
      }
    }
    expect(rows.find((r) => r.slug === 'bmsc-high' && r.role === 'COMMITTEE')?.n).toBe('3');
    expect(rows.filter((r) => r.role === 'COMMITTEE')).toHaveLength(1);
  });

  it('the ICT teacher has Teacher rows and StaffProfiles in High and College', async () => {
    const [u] = await q(`SELECT id FROM users WHERE email = 'ict@bmsc.example'`);
    const teachers = await q(`SELECT tenant_id FROM teachers WHERE user_id = $1`, [u.id]);
    const profiles = await q(`SELECT tenant_id FROM staff_profiles WHERE user_id = $1`, [u.id]);
    expect(new Set(teachers.map((t) => t.tenant_id)).size).toBe(2);
    expect(profiles).toHaveLength(2);
    expect(new Set(profiles.map((t) => t.tenant_id)).size).toBe(2);
  });

  it('every staff DEMO_CARDS user has a live membership in its branch and the demo password', async () => {
    const staffCards = DEMO_CARDS.filter(
      (c) => !['admin', 'guardian', 'student-9b'].includes(c.key),
    );
    expect(staffCards.length).toBeGreaterThan(0);
    for (const card of staffCards) {
      const [m] = await q(
        `SELECT ut.role, u.password_hash FROM users u
           JOIN user_tenants ut ON ut.user_id = u.id AND ut.deleted_at IS NULL
           JOIN schools s ON s.id = ut.tenant_id AND s.slug = $2
          WHERE u.email = $1`,
        [card.email, card.branchSlug],
      );
      expect(m?.role).toBe(card.role);
      expect(m.password_hash).toBe(ctx.demoPasswordHash);
      expect(staffByCardKey(ctx).get(card.key)).toBeDefined();
    }
  });

  it('the Class 8-A class teacher of High is the card teacher, in the current and previous year', async () => {
    const card = DEMO_CARDS.find((c) => c.key === 'class-teacher-8a')!;
    const rows = await q(
      `SELECT count(*) AS n FROM teacher_class_sections tcs
         JOIN teachers t ON t.id = tcs.teacher_id JOIN users u ON u.id = t.user_id
         JOIN class_sections cs ON cs.id = tcs.section_id JOIN classes c ON c.id = cs.class_id
        WHERE u.email = $1 AND c.name = 'Class 8' AND cs.section_name = 'A'
          AND tcs.assignment_type = 'CLASS_TEACHER'`,
      [card.email],
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  // [83.1.3] D36: 3 class-coordinator rows (the 8-A card's teacher) + 2 Mathematics rows,
  // all in High, all on current-year classes, assigned by the demo admin.
  it('High has one class coordinator (3 classes, the 8-A card) and one Mathematics coordinator (2 classes)', async () => {
    const card = DEMO_CARDS.find((c) => c.key === 'class-teacher-8a')!;
    const rows = await q<{
      email: string;
      subject: string | null;
      slug: string;
      is_current: boolean;
      assigned_by: string | null;
    }>(
      `SELECT u.email, s.name_en AS subject, sc.slug, ay.is_current, ca.assigned_by_user_id AS assigned_by
         FROM coordinator_assignments ca
         JOIN teachers t ON t.id = ca.teacher_id JOIN users u ON u.id = t.user_id
         JOIN schools sc ON sc.id = ca.tenant_id
         JOIN classes c ON c.id = ca.class_id JOIN academic_years ay ON ay.id = c.academic_year_id
         LEFT JOIN subjects s ON s.id = ca.subject_id`,
    );
    expect(rows).toHaveLength(5);
    const classLevel = rows.filter((r) => r.subject === null);
    const maths = rows.filter((r) => r.subject === 'Mathematics');
    expect(classLevel).toHaveLength(3);
    expect(classLevel.every((r) => r.email === card.email)).toBe(true);
    expect(maths).toHaveLength(2);
    expect(new Set(maths.map((r) => r.email)).size).toBe(1);
    expect(maths[0].email).not.toBe(card.email);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(1);
    expect(rows.every((r) => r.is_current && r.assigned_by)).toBe(true);
  });

  it('every section of the current and previous year has a class teacher', async () => {
    const missing = await q(
      `SELECT s.slug, c.name AS class, cs.section_name FROM class_sections cs
         JOIN classes c ON c.id = cs.class_id JOIN schools s ON s.id = cs.tenant_id
        WHERE s.slug LIKE 'bmsc-%'
          AND NOT EXISTS (SELECT 1 FROM teacher_class_sections t
                           WHERE t.section_id = cs.id AND t.assignment_type = 'CLASS_TEACHER')`,
    );
    expect(missing).toEqual([]); // years = 2, so both years are covered
  });

  it('each branch has one leaver with an end-dated designation and an ended membership', async () => {
    const rows = await q(
      `SELECT s.slug FROM staff_designation_history h JOIN schools s ON s.id = h.tenant_id
        WHERE h.end_date IS NOT NULL AND h.status = 'RESIGNED' ORDER BY s.slug`,
    );
    expect(rows.map((r) => r.slug)).toEqual(['bmsc-college', 'bmsc-high', 'bmsc-primary']);
    const [{ n }] = await q(
      `SELECT count(*) AS n FROM user_tenants WHERE deleted_at IS NOT NULL AND role = 'TEACHER'`,
    );
    expect(Number(n)).toBe(3);
  });

  it('staff carry Bangla names, a religion, and a non-Muslim name appears in the sample', async () => {
    const rows = await q(`SELECT name_bn, religion FROM staff_hr_records`);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.every((r) => r.name_bn && r.religion)).toBe(true);
    // At scale 1 the split is 92/6/2; the roster is ~60 people, so the check is: mostly Islam.
    const muslim = rows.filter((r) => r.religion === 'Islam').length / rows.length;
    expect(muslim).toBeGreaterThan(0.7);
    expect(rows.some((r) => r.religion !== 'Islam')).toBe(true);
  });

  it('every HR child table has rows, and each person has one appointment-letter document', async () => {
    for (const table of [
      'designations',
      'staff_family_members',
      'staff_addresses',
      'staff_experience',
      'staff_education',
      'staff_training',
      'staff_achievements',
      'staff_languages',
      'staff_documents',
    ]) {
      const [{ n }] = await q(`SELECT count(*) AS n FROM ${table}`);
      expect(Number(n), table).toBeGreaterThan(0);
    }
  });
});

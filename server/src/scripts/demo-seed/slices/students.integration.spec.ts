import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { createContext, type DemoSeedContext } from '../context';
import { slice as org } from './org';
import { slice as students, studentIds } from './students';

// A fixed anchor keeps the assertions reproducible; students.ts itself never names a year.
const ANCHOR = '2026-10-10';
// 4 years = one bulk transition (year 0 -> 1) plus the two the real service commits.
const YEARS = 4;
const SCALE = 0.1;
const FULL = process.env.DEMO_SEED_FULL === '1';

let ds: DataSource;
let app: TestingModule;

async function seed(scale: number, years: number): Promise<DemoSeedContext> {
  // The test setup empties data tables between tests; schools and users survive, so drop ours.
  await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
  await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
  await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
  const ctx = await createContext({
    ds,
    app,
    scale,
    years,
    anchor: ANCHOR,
    password: 'unit-test-password',
  });
  await org.run(ctx);
  ctx.timings.push({ slice: 'students', rows: (await students.run(ctx)) as number, ms: 0 });
  return ctx;
}

const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
  ds.query(sql, args);

beforeAll(async () => {
  const module = await createTestModule(ALL_ENTITIES, [
    PresetApplyService,
    PresetRegistryService,
    AuditService,
    AuthTokenService,
    SchoolInviteService,
    StaffProfilesService,
    PromotionsService,
    EnrollmentService,
    StudentLifecycleService,
    { provide: ApprovalService, useValue: { consume: vi.fn() } },
    { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
    { provide: StorageService, useValue: { put: async () => undefined } },
  ]);
  ds = module.get<DataSource>(getDataSourceToken());
  app = module;
}, 120_000);

afterAll(async () => {
  if (ds) await ds.destroy();
});

describe('students slice (integration, 4 years, scale 0.1)', () => {
  // The suite resets data before each `it`, so everything is read once, right after the seed.
  const facts: Record<string, any> = {};

  beforeAll(async () => {
    const ctx = await seed(SCALE, YEARS);
    facts.cap = ctx.count(50);
    facts.ids = studentIds(ctx);
    facts.anchor = ctx.anchor;
    const D = `s.slug LIKE 'bmsc-%'`;
    facts.cards = await q(
      `SELECT tenant_id, count(*)::int AS n, count(DISTINCT card_no)::int AS d,
              bool_and(card_no ~ '^[0-9]{10}$') AS ok
         FROM students WHERE card_no IS NOT NULL GROUP BY tenant_id`,
    );
    facts.twoEnrollmentsInOneYear = await q(
      `SELECT e.student_id FROM enrollments e JOIN schools s ON s.id = e.tenant_id
        WHERE ${D} GROUP BY e.student_id, e.academic_year_id HAVING count(*) > 1`,
    );
    // A student is ACTIVE exactly when their enrollment in the current year is ACTIVE.
    facts.activeWithoutCurrentEnrollment = await q(
      `SELECT st.id FROM students st JOIN schools s ON s.id = st.tenant_id
        WHERE ${D} AND st.enrollment_status = 'ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id
           WHERE e.student_id = st.id AND y.is_current AND e.enrollment_status = 'ACTIVE')`,
    );
    // Every year a student attended except the one they left in has an ACTIVE enrollment.
    facts.closedEnrollmentNotLast = await q(
      `SELECT e.id FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id
        JOIN schools s ON s.id = e.tenant_id
        WHERE ${D} AND e.enrollment_status <> 'ACTIVE' AND EXISTS (
          SELECT 1 FROM enrollments n JOIN academic_years ny ON ny.id = n.academic_year_id
           WHERE n.student_id = e.student_id AND ny.start_date > y.start_date)`,
    );
    facts.graduated = await q(
      `SELECT st.id, EXISTS (SELECT 1 FROM student_lifecycle_events l
                              WHERE l.student_id = st.id AND l.event_type = 'GRADUATED') AS has_event,
              (SELECT e.enrollment_status FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id
                WHERE e.student_id = st.id ORDER BY y.start_date DESC LIMIT 1) AS last_status
         FROM students st JOIN schools s ON s.id = st.tenant_id
        WHERE ${D} AND st.enrollment_status = 'GRADUATED'`,
    );
    // Each Primary TC to the High branch has a new High Student row for the same child (same birth reg no).
    facts.tcToHigh = await q(
      `SELECT e.id, h.id AS high_id, y.start_date AS tc_year, first.start_date AS joined_year,
              first.numeric_grade
         FROM student_lifecycle_events e
         JOIN students p ON p.id = e.student_id
         JOIN schools ps ON ps.id = p.tenant_id AND ps.slug = 'bmsc-primary'
         JOIN academic_years y ON y.id = e.academic_year_id
         LEFT JOIN students h ON h.birth_reg_no = p.birth_reg_no AND h.tenant_id <> p.tenant_id
         LEFT JOIN LATERAL (
           SELECT hy.start_date, c.numeric_grade FROM enrollments he
             JOIN academic_years hy ON hy.id = he.academic_year_id
             JOIN classes c ON c.id = he.class_id
            WHERE he.student_id = h.id ORDER BY hy.start_date LIMIT 1) first ON true
        WHERE e.event_type = 'TRANSFERRED_OUT' AND e.destination LIKE '%মাধ্যমিক%'`,
    );
    facts.tcCount = await q(
      `SELECT count(*)::int AS n FROM student_lifecycle_events e JOIN schools s ON s.id = e.tenant_id
        WHERE ${D} AND e.event_type = 'TRANSFERRED_OUT'`,
    );
    facts.gender = await q(
      `SELECT st.gender, count(*)::int AS n FROM students st JOIN schools s ON s.id = st.tenant_id
        WHERE ${D} AND st.enrollment_status = 'ACTIVE' GROUP BY 1`,
    );
    facts.sectionSizes = await q(
      `SELECT st.class_section_id, count(*)::int AS n FROM students st
         JOIN schools s ON s.id = st.tenant_id
        WHERE ${D} AND st.enrollment_status = 'ACTIVE' GROUP BY 1`,
    );
    facts.runs = await q(
      `SELECT r.status, count(*)::int AS n, count(DISTINCT (r.tenant_id, r.target_academic_year_id))::int AS years
         FROM promotion_runs r JOIN schools s ON s.id = r.tenant_id WHERE ${D} GROUP BY 1`,
    );
    // Every run, bulk or service-committed, is stamped on its source year's last day, never "today".
    facts.runsOffYearEnd = await q(
      `SELECT r.id FROM promotion_runs r JOIN schools s ON s.id = r.tenant_id
         JOIN academic_years y ON y.id = r.source_academic_year_id
        WHERE ${D} AND (r.committed_at AT TIME ZONE 'Asia/Dhaka')::date <> y.end_date`,
    );
    facts.futureEvents = await q(
      `SELECT l.id FROM student_lifecycle_events l JOIN academic_years y ON y.id = l.academic_year_id
         JOIN schools s ON s.id = l.tenant_id
        WHERE ${D} AND l.occurred_on > y.end_date`,
    );
    facts.d13 = await q(
      `SELECT g.id, s.slug, g.phone, g.email, u.phone AS user_phone, u.email AS user_email,
              (SELECT count(*) FROM student_guardians sg WHERE sg.guardian_id = g.id)::int AS children
         FROM guardians g JOIN users u ON u.id = g.user_id JOIN schools s ON s.id = g.tenant_id
        WHERE u.email = $1 ORDER BY s.slug`,
      [DEMO_CARDS.find((c) => c.key === 'guardian')!.email],
    );
    facts.d13Memberships = await q(
      `SELECT s.slug, ut.role FROM user_tenants ut JOIN users u ON u.id = ut.user_id
         JOIN schools s ON s.id = ut.tenant_id WHERE u.email = $1 ORDER BY s.slug`,
      [DEMO_CARDS.find((c) => c.key === 'guardian')!.email],
    );
    facts.card9b = await q(
      `SELECT c.name, cs.section_name, st.enrollment_status FROM users u
         JOIN students st ON st.user_id = u.id
         JOIN class_sections cs ON cs.id = st.class_section_id JOIN classes c ON c.id = cs.class_id
        WHERE u.email = $1`,
      [DEMO_CARDS.find((c) => c.key === 'student-9b')!.email],
    );
    facts.hashes = await q(
      `SELECT DISTINCT password_hash FROM users WHERE email LIKE '%@bmsc.example' AND email <> $1`,
      [DEMO_CARDS.find((c) => c.key === 'admin')!.email],
    );
    facts.guardianContacts = await q(
      `SELECT g.phone, g.email FROM guardians g JOIN schools s ON s.id = g.tenant_id
        WHERE ${D} AND g.relationship = 'Father'`,
    );
    [{ orphans: facts.orphanGuardians }] = await q(
      `SELECT count(*)::int AS orphans FROM guardians g
        WHERE NOT EXISTS (SELECT 1 FROM student_guardians sg WHERE sg.guardian_id = g.id)`,
    );
    [{ shared: facts.sharedGuardians }] = await q(
      `SELECT count(*)::int AS shared FROM (
         SELECT guardian_id FROM student_guardians GROUP BY guardian_id HAVING count(*) >= 2) x`,
    );
    facts.regDuplicates = await q(
      `SELECT registration_number FROM students GROUP BY tenant_id, registration_number HAVING count(*) > 1`,
    );
  }, 600_000);

  it('gives every student at most one enrollment per year, and only the last year may be closed', () => {
    expect(facts.twoEnrollmentsInOneYear).toEqual([]);
    expect(facts.closedEnrollmentNotLast).toEqual([]);
    expect(facts.activeWithoutCurrentEnrollment).toEqual([]);
    expect(facts.regDuplicates).toEqual([]);
  });

  it('graduates carry a GRADUATED event and a GRADUATED last enrollment', () => {
    expect(facts.graduated.length).toBeGreaterThan(0);
    for (const g of facts.graduated) {
      expect(g.has_event).toBe(true);
      expect(g.last_status).toBe('GRADUATED');
    }
    // The service stamps "today" on graduations it commits; the seed moves them to the year's end.
    expect(facts.futureEvents).toEqual([]);
  });

  it('Primary leavers get a TC and most reappear as a new High class-6 student the next year', () => {
    expect(facts.tcCount[0].n).toBeGreaterThan(0);
    expect(facts.tcToHigh.length).toBeGreaterThan(0);
    for (const tc of facts.tcToHigh) {
      expect(tc.high_id).not.toBeNull(); // a new Student row in the High branch...
      expect(Number(tc.numeric_grade)).toBe(6); // ...in class 6...
      expect(new Date(tc.joined_year).getUTCFullYear()).toBe(
        new Date(tc.tc_year).getUTCFullYear() + 1, // ...of the following year
      );
    }
  });

  it('keeps the current gender split between 48% and 52% and every section within the cap', () => {
    const total = facts.gender.reduce((n: number, g: any) => n + g.n, 0);
    const male = facts.gender.find((g: any) => g.gender === 'MALE').n;
    expect(male / total).toBeGreaterThanOrEqual(0.48);
    expect(male / total).toBeLessThanOrEqual(0.52);
    for (const s of facts.sectionSizes) expect(s.n).toBeLessThanOrEqual(facts.cap);
  });

  it('records promotion runs for the bulk year and for the two committed through the service', () => {
    const committed = facts.runs.find((r: any) => r.status === 'COMMITTED');
    expect(committed.years).toBe(3 * (YEARS - 1)); // 3 branches x one run set per transition
    expect(facts.runs.find((r: any) => r.status === 'DRAFT')).toBeUndefined();
    expect(facts.runsOffYearEnd).toEqual([]);
  });

  it('the D13 guardian is one login with a Guardian row in Primary and in High, same phone and email', () => {
    expect(facts.d13Memberships).toEqual([
      { slug: 'bmsc-high', role: 'PARENT' },
      { slug: 'bmsc-primary', role: 'PARENT' },
    ]);
    expect(facts.d13.map((g: any) => g.slug)).toEqual(['bmsc-high', 'bmsc-primary']);
    for (const g of facts.d13) {
      expect(g.phone).toBe(g.user_phone);
      expect(g.email).toBe(g.user_email);
      expect(g.children).toBeGreaterThan(0);
    }
    expect(facts.d13[0].user_phone).toMatch(/^01700-\d{6}$/);
  });

  it('student card 9-B is an active Class 9 section B student and logins share one hash', () => {
    expect(facts.card9b).toHaveLength(1);
    expect(facts.card9b[0].section_name).toBe('B');
    expect(facts.card9b[0].enrollment_status).toBe('ACTIVE');
    expect(facts.hashes).toHaveLength(1);
  });

  it('one class per branch has 10-digit student card numbers, unique per tenant (76.2.8)', async () => {
    const rows = facts.cards;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.n).toBeGreaterThan(0);
      expect(r.d).toBe(r.n);
      expect(r.ok).toBe(true);
    }
  });

  it('every Guardian has a child, and some siblings share one Guardian row', () => {
    expect(facts.orphanGuardians).toBe(0);
    expect(facts.sharedGuardians).toBeGreaterThan(0);
  });

  it('uses the D26 contact pattern and publishes ids for later slices', () => {
    for (const g of facts.guardianContacts) {
      expect(g.phone).toMatch(/^01700-\d{6}$/);
      expect(g.email).toMatch(/@bmsc\.example$/);
    }
    const ids = facts.ids;
    expect(ids.students.length).toBeGreaterThan(0);
    expect(ids.bySection.size).toBeGreaterThan(0);
    expect(ids.cards.guardianUserId).toBeTruthy();
  });
});

// One full-size run: ~1,200 students now, religion within +-3 points of 92/6/2, under 4 minutes (D33).
describe.skipIf(!FULL)('students slice at scale 1, 10 years (DEMO_SEED_FULL=1)', () => {
  it('has the D33 shape and finishes inside the budget', async () => {
    const t0 = Date.now();
    await seed(1, 10);
    expect(Date.now() - t0).toBeLessThan(240_000);
    const [{ n }] = await q(
      `SELECT count(*)::int AS n FROM students WHERE enrollment_status = 'ACTIVE'`,
    );
    expect(n).toBeGreaterThan(1100);
    const rel = await q(
      `SELECT religion, count(*)::int AS n FROM students WHERE enrollment_status = 'ACTIVE' GROUP BY 1`,
    );
    const share = (r: string) => (rel.find((x) => x.religion === r)?.n ?? 0) / n;
    expect(Math.abs(share('Islam') - 0.92)).toBeLessThan(0.03);
    expect(Math.abs(share('Hinduism') - 0.06)).toBeLessThan(0.03);
  }, 600_000);
});

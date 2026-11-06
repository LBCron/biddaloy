import { readFileSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { clearTables } from '@test/helpers/db.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { UserRole } from '@biddaloy/shared';
import { AuditService } from '../../../modules/audit/audit.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { PresetApplyService } from '../../../modules/presets/preset-apply.service';
import { PresetRegistryService } from '../../../modules/presets/preset-registry.service';
import { AuthTokenService } from '../../../modules/account-access/auth-token.service';
import { SchoolInviteService } from '../../../modules/account-access/school-invite.service';
import { StaffProfilesService } from '../../../modules/staff-profiles/staff-profiles.service';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { createContext, type DemoSeedContext } from '../context';
import { academicYears } from '../dates';
import { BD_PUBLIC_HOLIDAYS_BY_YEAR } from '../../seed-data/public-holidays-bd';
import { orgIds, slice } from './org';

// A fixed anchor keeps the assertions reproducible; org.ts itself never names a year.
const ANCHOR = '2026-10-10';
const YEARS = 2;

describe('org slice (integration, 2 years)', () => {
  let ds: DataSource;
  let app: TestingModule;
  let ctx: DemoSeedContext;
  let rows: number | void;

  const q = <T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      AuthTokenService,
      SchoolInviteService,
      StaffProfilesService,
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
      { provide: StorageService, useValue: { put: async () => undefined } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    app = module;
  }, 120_000);

  // The test setup empties the data tables before every `it`, so the slice runs once per test.
  beforeEach(async () => {
    // Schools and users survive that reset; drop ours so a re-run starts fresh.
    // (Holiday sets and entries are in the reset, so they need no cleanup.)
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: YEARS,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    rows = await slice.run(ctx);
  }, 120_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('creates the three branch schools with their EIIN and no trial end', async () => {
    const schools = await q(
      `SELECT slug, registration_id, country_code, trial_ends_at,
              onboarding->>'finished_at' AS finished
         FROM schools WHERE slug LIKE 'bmsc-%' ORDER BY slug`,
    );
    expect(schools.map((s) => s.slug)).toEqual(['bmsc-college', 'bmsc-high', 'bmsc-primary']);
    expect(schools.map((s) => s.registration_id)).toEqual(['900003', '900002', '900001']);
    expect(schools.every((s) => s.country_code === 'BD' && s.trial_ends_at === null)).toBe(true);
    expect(schools.every((s) => s.finished)).toBe(true);
    expect(typeof rows).toBe('number');
  });

  it('the admin is one user with an ADMIN membership in all three branches', async () => {
    const card = DEMO_CARDS.find((c) => c.key === 'admin')!;
    const members = await q(
      `SELECT s.slug, ut.role FROM user_tenants ut
         JOIN users u ON u.id = ut.user_id JOIN schools s ON s.id = ut.tenant_id
        WHERE u.email = $1 ORDER BY s.slug`,
      [card.email],
    );
    expect(members).toEqual([
      { slug: 'bmsc-college', role: UserRole.ADMIN },
      { slug: 'bmsc-high', role: UserRole.ADMIN },
      { slug: 'bmsc-primary', role: UserRole.ADMIN },
    ]);
    // The two joined branches went through a JOIN_SCHOOL request that was accepted, not a direct insert.
    const [{ n }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM auth_tokens WHERE user_id = $1
          AND purpose = 'JOIN_SCHOOL' AND consumed_at IS NOT NULL`,
      [orgIds(ctx).adminUserId],
    );
    expect(Number(n)).toBe(2);
    // One shared password hash (D43).
    const [{ password_hash }] = await q(`SELECT password_hash FROM users WHERE email = $1`, [
      card.email,
    ]);
    expect(password_hash).toBe(ctx.demoPasswordHash);
  });

  it('every branch has exactly one current year and one year per requested year', async () => {
    const rowsPerTenant = await q(
      `SELECT s.slug, count(*) AS years, count(*) FILTER (WHERE a.is_current) AS current
         FROM academic_years a JOIN schools s ON s.id = a.tenant_id
        WHERE s.slug LIKE 'bmsc-%' GROUP BY s.slug`,
    );
    expect(rowsPerTenant).toHaveLength(3);
    for (const r of rowsPerTenant) {
      expect(Number(r.years)).toBe(YEARS);
      expect(Number(r.current)).toBe(1);
    }
  });

  it('College years run July to June; Primary and High run January to December', async () => {
    const college = await q(
      `SELECT to_char(a.start_date, 'MM-DD') AS s, to_char(a.end_date, 'MM-DD') AS e
         FROM academic_years a JOIN schools sc ON sc.id = a.tenant_id WHERE sc.slug = 'bmsc-college'`,
    );
    expect(college).toEqual(Array(YEARS).fill({ s: '07-01', e: '06-30' }));
    const current = academicYears('COLLEGE', YEARS, ANCHOR).at(-1)!;
    const [row] = await q(
      `SELECT a.name FROM academic_years a JOIN schools sc ON sc.id = a.tenant_id
        WHERE sc.slug = 'bmsc-college' AND a.is_current`,
    );
    expect(row.name).toBe(current.name);
    const high = await q(
      `SELECT to_char(a.start_date, 'MM-DD') AS s, to_char(a.end_date, 'MM-DD') AS e
         FROM academic_years a JOIN schools sc ON sc.id = a.tenant_id WHERE sc.slug = 'bmsc-high'`,
    );
    expect(high).toEqual(Array(YEARS).fill({ s: '01-01', e: '12-31' }));
  });

  it('each year has 12 classes overall (5 + 5 + 2) with 2 sections each', async () => {
    const perYear = await q(
      `SELECT a.id, count(DISTINCT c.id) AS classes, count(cs.id) AS sections
         FROM academic_years a JOIN schools s ON s.id = a.tenant_id
         JOIN classes c ON c.academic_year_id = a.id
         JOIN class_sections cs ON cs.class_id = c.id
        WHERE s.slug LIKE 'bmsc-%' GROUP BY a.id`,
    );
    expect(perYear).toHaveLength(3 * YEARS);
    for (const r of perYear) expect(Number(r.sections)).toBe(Number(r.classes) * 2);
    const total = perYear.reduce((n, r) => n + Number(r.classes), 0);
    expect(total).toBe(12 * YEARS);
    const groups = await q(
      `SELECT DISTINCT cs.group_name FROM class_sections cs JOIN schools s ON s.id = cs.tenant_id
        WHERE s.slug = 'bmsc-college' ORDER BY 1`,
    );
    expect(groups.map((g) => g.group_name)).toEqual(['Business Studies', 'Science']);
  });

  it('older years get the same subjects, grading scale and three terms as the current one', async () => {
    const perYear = await q(
      `SELECT a.is_current,
              (SELECT count(*) FROM class_subjects x WHERE x.academic_year_id = a.id) AS subjects,
              (SELECT count(*) FROM grading_scales g WHERE g.academic_year_id = a.id) AS scales,
              (SELECT count(*) FROM grading_bands b JOIN grading_scales g ON g.id = b.scale_id
                WHERE g.academic_year_id = a.id) AS bands,
              (SELECT count(*) FROM academic_terms t WHERE t.academic_year_id = a.id) AS terms
         FROM academic_years a JOIN schools s ON s.id = a.tenant_id
        WHERE s.slug = 'bmsc-high' ORDER BY a.start_date`,
    );
    expect(perYear).toHaveLength(YEARS);
    expect(Number(perYear[0].subjects)).toBeGreaterThan(0);
    expect(perYear[0].subjects).toBe(perYear[1].subjects);
    expect(perYear[0].bands).toBe(perYear[1].bands);
    expect(perYear.every((y) => Number(y.scales) === 1 && Number(y.terms) === 3)).toBe(true);
  });

  it('events never start on a Friday (except holiday-type rows) and exam events link classes', async () => {
    const [{ n }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM calendar_events e JOIN schools s ON s.id = e.tenant_id
        WHERE s.slug LIKE 'bmsc-%' AND e.type <> 'HOLIDAY'
          AND extract(dow FROM e.start_date) = 5`,
    );
    expect(Number(n)).toBe(0);
    const [{ linked }] = await q<{ linked: string }>(
      `SELECT count(*) AS linked FROM calendar_event_classes`,
    );
    expect(Number(linked)).toBeGreaterThan(0);
  });

  it('no Friday (the weekly off) falls inside a counts_as_working_day event', async () => {
    const [{ n }] = await q<{ n: string }>(
      `SELECT count(*) AS n
         FROM calendar_events e JOIN schools s ON s.id = e.tenant_id,
              generate_series(e.start_date, e.end_date, interval '1 day') AS d
        WHERE s.slug LIKE 'bmsc-%' AND e.counts_as_working_day
          AND extract(dow FROM d) = 5`,
    );
    expect(Number(n)).toBe(0);
  });

  it('after apply: period attendance on, Morning shift, classes on it, bn locale, terms, exam templates', async () => {
    const schools = await q<{ id: string; slug: string; settings: Record<string, any> }>(
      `SELECT id, slug, settings FROM schools WHERE slug LIKE 'bmsc-%'`,
    );
    expect(schools).toHaveLength(3);
    for (const s of schools) {
      expect(s.settings.attendance.periodAttendance.enabled).toBe(true);
      expect(s.settings.attendance.arrivalNotice.enabled).toBe(true);
      // [76.2.8] D25: High on the gate, Primary teacher-only, College untouched; SMS fallback stays off.
      const want = { 'bmsc-high': 'DEVICE', 'bmsc-primary': 'CLASS_TEACHER' }[s.slug as string];
      expect(s.settings.attendance.dailySource).toBe(want);
      expect(s.settings.attention?.staffSmsFallback ?? false).toBe(false);
      expect(s.settings.organisation.shifts).toContain('Morning');
      expect(JSON.stringify(s.settings.region)).toContain('bn');
    }
    expect(schools.filter((s) => s.settings.attendance.arrivalNotice.smsAllowed)).toHaveLength(1);
    // Every class of every year points at the shift.
    const [{ n }] = await q<{ n: string }>(
      `SELECT count(*) AS n FROM classes c JOIN schools s ON s.id = c.tenant_id
        WHERE s.slug LIKE 'bmsc-%' AND c.shift_id IS NULL`,
    );
    expect(Number(n)).toBe(0);
    // Current year: three terms per branch; the NCTB pack's exam templates cover grades 9-10 (High).
    const perTenant = await q(
      `SELECT s.slug,
              (SELECT count(*) FROM academic_terms t JOIN academic_years a ON a.id = t.academic_year_id
                WHERE a.tenant_id = s.id AND a.is_current) AS terms,
              (SELECT count(*) FROM exam_templates x WHERE x.tenant_id = s.id) AS templates
         FROM schools s WHERE s.slug LIKE 'bmsc-%'`,
    );
    expect(perTenant).toHaveLength(3);
    for (const r of perTenant) expect(Number(r.terms)).toBe(3);
    expect(Number(perTenant.find((r) => r.slug === 'bmsc-high')!.templates)).toBeGreaterThan(0);
  });

  it('a year past the holiday table seeds with a warning and no holidays for it, never a throw', async () => {
    // College runs Jul-Jun: an anchor of 1 July in the table's last year needs the next year too.
    const last = Math.max(...Object.keys(BD_PUBLIC_HOLIDAYS_BY_YEAR).map(Number));
    // Start clean, as beforeEach does, so this run creates its own schools and holiday sets.
    await clearTables();
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const far = await createContext({
      ds,
      app,
      scale: 0.05,
      years: YEARS,
      anchor: `${last}-07-01`,
      password: 'unit-test-password',
    });

    await expect(slice.run(far)).resolves.toBeTypeOf('number');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`has no ${last + 1}`));
    const years = await q<{ year: number }>(
      `SELECT year FROM public_holiday_sets WHERE country = 'BD' ORDER BY year`,
    );
    expect(years.map((r) => Number(r.year))).toContain(last);
    expect(years.map((r) => Number(r.year))).not.toContain(last + 1);
    warn.mockRestore();
  }, 120_000);

  it('writes shifts, period slots, rooms and the Bangladesh holiday sets', async () => {
    const slots = await q(
      `SELECT s.slug, count(p.id) AS n, count(p.id) FILTER (WHERE p.kind = 'BREAK') AS breaks
         FROM schools s JOIN period_slots p ON p.tenant_id = s.id
        WHERE s.slug LIKE 'bmsc-%' GROUP BY s.slug ORDER BY s.slug`,
    );
    // Primary 6 periods; High 8 periods + a break; College 6 periods.
    expect(slots.map((r) => [r.slug, Number(r.n), Number(r.breaks)])).toEqual([
      ['bmsc-college', 6, 0],
      ['bmsc-high', 9, 1],
      ['bmsc-primary', 6, 0],
    ]);
    const org = orgIds(ctx);
    for (const t of org.tenants) {
      const current = t.years.find((y) => y.isCurrent)!;
      const sectionCount = current.classes.reduce((n, c) => n + c.sections.length, 0);
      expect(t.rooms.filter((r) => r.sectionId)).toHaveLength(sectionCount);
      expect(t.rooms.length).toBeGreaterThan(sectionCount); // labs
    }
    const [{ sets }] = await q<{ sets: string }>(
      `SELECT count(*) AS sets FROM public_holiday_sets WHERE country = 'BD'`,
    );
    expect(Number(sets)).toBeGreaterThanOrEqual(YEARS);
  });

  it('publishes ids for the later slices', () => {
    const org = orgIds(ctx);
    expect(org.tenants.map((t) => t.slug)).toEqual(['bmsc-primary', 'bmsc-high', 'bmsc-college']);
    for (const t of org.tenants) {
      expect(t.years).toHaveLength(YEARS);
      expect(t.years.filter((y) => y.isCurrent)).toHaveLength(1);
    }
  });

  it('org.ts names no literal year (every date derives from the anchor)', () => {
    const source = readFileSync(join(__dirname, 'org.ts'), 'utf8');
    expect(source).not.toMatch(/20\d\d-/);
  });
});

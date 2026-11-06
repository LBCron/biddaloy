import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../../modules/audit/audit.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { SchoolsService } from '../../../modules/schools/schools.service';
import { resolveTenantSettings } from '../../../modules/schools/settings/tenant-settings-resolver';
import { SchoolSettingsReader } from '../../../modules/schools/settings/school-settings-reader.service';
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
import { RoutineService } from '../../../modules/routines/routine.service';
import { RoutineSlotsService } from '../../../modules/routines/routine-slots.service';
import { RoutineStateService } from '../../../modules/routines/routine-state.service';
import { SubstitutionsService } from '../../../modules/routines/substitutions.service';
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { ChangeRequestsService } from '../../../modules/routines/change-requests.service';
import { TeacherBusyService } from '../../../modules/routines/teacher-busy.service';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { createContext, type DemoSeedContext } from '../context';
import { validate } from '../validator';
import { arrivalLogs } from './comms-print';
import { slice as org } from './org';
import { slice as staff } from './staff';
import { slice as students } from './students';
import { slice as routine } from './routine';
import { slice } from './attendance';

const ANCHOR = '2026-10-10'; // a Saturday: a school day
const SCHOOL_DAY = ANCHOR;
const SCALE = 0.15; // sections of ~7: one chronic absentee each keeps the average in 88-96%
const YEARS = 3; // two years with period registers, one without
const DEMO = `s.slug LIKE 'bmsc-%'`;

describe('attendance slice (integration, 3 years, scale 0.15)', () => {
  let ds: DataSource;
  let ctx: DemoSeedContext;
  let app: TestingModule;
  const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

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
      RoutineService,
      RoutineSlotsService,
      RoutineStateService,
      SubstitutionsService,
      ChangeRequestsService,
      PromotionsService,
      EnrollmentService,
      StudentLifecycleService,
      { provide: ApprovalService, useValue: { consume: vi.fn() } },
      { provide: TeacherBusyService, useValue: { busyAt: async () => null } },
      {
        provide: SchoolsService,
        useValue: { getResolvedSettings: async () => resolveTenantSettings(null) },
      },
      { provide: SchoolSettingsReader, useValue: { routineSettings: async () => ({}) } },
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

  // The suite empties data tables before every `it`, so the slices run here and one `it` reads.
  beforeEach(async () => {
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    ctx = await createContext({
      ds,
      app,
      scale: SCALE,
      years: YEARS,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await staff.run(ctx);
    await students.run(ctx);
    await routine.run(ctx);
    const t0 = Date.now();
    await slice.run(ctx);
    console.log(`attendance slice: ${Date.now() - t0} ms`);
    // The comms slice tops up SMS credit (GRANT + balance) before arrivalLogs debits it.
    for (const sql of [
      `INSERT INTO sms_credit_ledger (tenant_id, kind, units, reference_type, idempotency_key)
       SELECT id, 'GRANT', 1000, 'manual', 'test-grant' FROM schools WHERE slug LIKE 'bmsc-%'`,
      `INSERT INTO sms_credit_balance (tenant_id, available, reserved)
       SELECT id, 1000, 0 FROM schools WHERE slug LIKE 'bmsc-%'`,
    ]) {
      await ds.query(sql);
    }
    await arrivalLogs(ctx); // [84.3.6] reads the subscriptions and records just seeded
  }, 600_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('writes believable registers, period sessions, today, devices, staff, leave and arrival notices', async () => {
    // No register on a Friday (the weekly off-day) or a holiday: the 58.1.05 attendance check.
    expect((await validate(ds)).filter((v) => v.check === 'attendance')).toEqual([]);
    const [{ n: fridays }] = await q(
      `SELECT count(*) AS n FROM attendance_sessions WHERE extract(dow FROM date) = 5`,
    );
    expect(Number(fridays)).toBe(0);

    // Current-year presence (PRESENT + LATE) of the whole-day registers up to yesterday: 88-96%.
    const [{ pct }] = await q(
      `SELECT 100.0 * count(*) FILTER (WHERE r.status IN ('PRESENT', 'LATE')) / count(*) AS pct
         FROM attendance_records r
         JOIN attendance_sessions a ON a.id = r.session_id AND a.period_no IS NULL
         JOIN class_sections cs ON cs.id = a.section_id
         JOIN classes c ON c.id = cs.class_id
         JOIN academic_years y ON y.id = c.academic_year_id AND y.is_current
        WHERE a.date < $1`,
      [ANCHOR],
    );
    expect(Number(pct)).toBeGreaterThan(88);
    expect(Number(pct)).toBeLessThan(96);

    // Every current-year section with students has a defaulter (a student under 75%).
    const sections = await q(
      `SELECT cs.id, EXISTS (
                SELECT 1 FROM (
                  SELECT r.student_id
                    FROM attendance_records r JOIN attendance_sessions a ON a.id = r.session_id
                   WHERE a.section_id = cs.id AND a.period_no IS NULL AND a.date < $1
                   GROUP BY r.student_id
                  HAVING 100.0 * count(*) FILTER (WHERE r.status IN ('PRESENT', 'LATE')) / count(*) < 75
                ) d) AS has_defaulter
         FROM class_sections cs
         JOIN classes c ON c.id = cs.class_id
         JOIN academic_years y ON y.id = c.academic_year_id AND y.is_current
         JOIN schools s ON s.id = cs.tenant_id AND ${DEMO}
        WHERE EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.section_id = cs.id)`,
      [ANCHOR],
    );
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) expect(s.has_defaulter, s.id).toBe(true);

    // Today: ~70% of the sections are finalized, one is a draft, the rest have no register.
    const today = await q(
      `SELECT a.state, count(*) AS n FROM attendance_sessions a
        WHERE a.date = $1 AND a.period_no IS NULL GROUP BY a.state`,
      [ANCHOR],
    );
    const finalized = Number(today.find((r) => r.state === 'FINALIZED')?.n ?? 0);
    const drafts = Number(today.find((r) => r.state === 'DRAFT')?.n ?? 0);
    const [{ n: allSections }] = await q(
      `SELECT count(*) AS n FROM class_sections cs JOIN classes c ON c.id = cs.class_id
         JOIN academic_years y ON y.id = c.academic_year_id AND y.is_current
         JOIN schools s ON s.id = cs.tenant_id AND ${DEMO}`,
    );
    expect(drafts).toBe(1);
    expect(finalized / Number(allSections)).toBeGreaterThanOrEqual(0.6);
    expect(finalized / Number(allSections)).toBeLessThanOrEqual(0.8);
    // Today's period registers stop after period 3.
    const [{ m }] = await q(`SELECT max(period_no) AS m FROM attendance_sessions WHERE date = $1`, [
      ANCHOR,
    ]);
    expect(Number(m)).toBeLessThanOrEqual(3);

    // Period registers exist for the current and previous year only (3 years seeded).
    const years = await q(
      `SELECT s.slug, count(DISTINCT y.id) FILTER (WHERE a.period_no IS NOT NULL) AS with_periods,
              count(DISTINCT y.id) AS with_days
         FROM attendance_sessions a JOIN class_sections cs ON cs.id = a.section_id
         JOIN classes c ON c.id = cs.class_id JOIN academic_years y ON y.id = c.academic_year_id
         JOIN schools s ON s.id = a.tenant_id GROUP BY s.slug`,
    );
    expect(years).toHaveLength(3);
    for (const y of years) {
      expect(Number(y.with_periods), y.slug).toBe(2);
      expect(Number(y.with_days), y.slug).toBe(YEARS);
    }

    // A student absent for the day is absent in every period of that day.
    const [{ n: leaks }] = await q(
      `SELECT count(*) AS n
         FROM attendance_records p
         JOIN attendance_sessions ps ON ps.id = p.session_id AND ps.period_no IS NOT NULL
         JOIN attendance_sessions ds ON ds.section_id = ps.section_id AND ds.date = ps.date AND ds.period_no IS NULL
         JOIN attendance_records d ON d.session_id = ds.id AND d.student_id = p.student_id
        WHERE d.status = 'ABSENT' AND p.status <> 'ABSENT'`,
    );
    expect(Number(leaks)).toBe(0);

    // One ACTIVE device per branch; today's scans are at High.
    const devices = await q(
      `SELECT d.status FROM attendance_devices d JOIN schools s ON s.id = d.tenant_id WHERE ${DEMO}`,
    );
    expect(devices).toHaveLength(3);
    const events = await q(
      `SELECT DISTINCT s.slug FROM attendance_device_events e JOIN schools s ON s.id = e.tenant_id`,
    );
    expect(events).toEqual([{ slug: 'bmsc-high' }]);
    // Only the 3 scanned-but-absent students (D5) are absent with a scan; none is a DEVICE mark.
    const [{ n: ghostScans }] = await q(
      `SELECT count(*)::int AS n FROM attendance_records
        WHERE (source = 'DEVICE' AND status IN ('ABSENT', 'LEAVE'))
           OR (check_in_at IS NOT NULL AND status IN ('ABSENT', 'LEAVE') AND source <> 'TEACHER')`,
    );
    expect(ghostScans).toBe(0);
    const [{ n: mismatches, t: mismatchTenants }] = await q(
      `SELECT count(*)::int AS n, array_agg(DISTINCT s.slug) AS t FROM attendance_records r
         JOIN schools s ON s.id = r.tenant_id
        WHERE r.check_in_at IS NOT NULL AND r.status IN ('ABSENT', 'LEAVE')`,
    );
    expect(mismatches).toBe(3);
    expect(mismatchTenants).toEqual(['bmsc-high']);

    // The upload history: one sheet, 40 rows, and every row's record exists with source IMPORT.
    const imports = await q(
      `SELECT i.*, s.slug FROM attendance_imports i JOIN schools s ON s.id = i.tenant_id`,
    );
    expect(imports).toHaveLength(1);
    const [imp] = imports;
    expect(imp.slug).toBe('bmsc-primary');
    expect(imp.rows).toHaveLength(40);
    expect([imp.count_new, imp.count_changed, imp.count_error]).toEqual([37, 2, 1]);
    const err = imp.rows.filter((r: any) => r.outcome === 'ERROR');
    expect(err).toHaveLength(1);
    expect(err[0].code).toBe('ROLL_NOT_IN_SECTION');
    const ids = imp.rows.filter((r: any) => r.recordId).map((r: any) => r.recordId);
    const [{ n: imported }] = await q(
      `SELECT count(*)::int AS n FROM attendance_records WHERE id = ANY($1) AND source = 'IMPORT'`,
      [ids],
    );
    expect(imported).toBe(39);

    // PR #3609 review S2: the uploader can really make this sheet (ADMIN holds ATTENDANCE_CORRECT
    // for the finalized past days), so the demo never shows rows the app would refuse.
    const [{ role: uploaderRole }] = await q(
      `SELECT m.role FROM user_tenants m
        WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.deleted_at IS NULL`,
      [imp.uploaded_by_user_id, imp.tenant_id],
    );
    expect(uploaderRole).toBe('ADMIN');
    // S1: each saved row's roll is that student's real roll; the ERROR row's roll is nobody's.
    const [{ n: wrongRolls }] = await q(
      `SELECT count(*)::int AS n FROM jsonb_array_elements($1::jsonb) h
         JOIN attendance_records r ON r.id = (h->>'recordId')::uuid
         JOIN students st ON st.id = r.student_id
        WHERE st.roll_number <> (h->>'roll')::int`,
      [JSON.stringify(imp.rows)],
    );
    expect(wrongRolls).toBe(0);
    const [{ n: takenErrorRoll }] = await q(
      `SELECT count(*)::int AS n FROM students WHERE class_section_id = $1 AND roll_number = $2`,
      [err[0].sectionId, err[0].roll],
    );
    expect(takenErrorRoll).toBe(0);
    const [{ n: deviceRows }] = await q(
      `SELECT count(*)::int AS n FROM attendance_records WHERE source = 'DEVICE'`,
    );
    expect(deviceRows).toBeGreaterThan(0);

    // The teacher the routine's substitution covers is on approved leave, and marked LEAVE today.
    const rt = ctx.ids.get('routineToday') as {
      tenantId: string;
      date: string;
      coveredUserId: string;
    };
    const leave = await q(
      `SELECT l.status, l.start_date::text AS d FROM leave_records l
         JOIN staff_profiles sp ON sp.id = l.staff_profile_id
        WHERE sp.user_id = $1 AND sp.tenant_id = $2 AND l.start_date = $3`,
      [rt.coveredUserId, rt.tenantId, rt.date],
    );
    expect(leave).toEqual([{ status: 'APPROVED', d: rt.date }]);
    const covered = await q(
      `SELECT r.status FROM staff_attendance_records r
         JOIN staff_attendance_sessions a ON a.id = r.session_id
         JOIN staff_profiles sp ON sp.id = r.staff_profile_id
        WHERE sp.user_id = $1 AND a.tenant_id = $2 AND a.date = $3`,
      [rt.coveredUserId, rt.tenantId, rt.date],
    );
    expect(covered).toEqual([{ status: 'LEAVE' }]);

    // History leave is decided; PENDING is Epic 52's job (58.3.08), not this slice's.
    const [{ n: pending }] = await q(
      `SELECT count(*) AS n FROM leave_records WHERE status = 'PENDING'`,
    );
    expect(Number(pending)).toBe(0);
    const [{ n: policies }] = await q(
      `SELECT count(*) AS n FROM leave_policies p JOIN schools s ON s.id = p.tenant_id WHERE ${DEMO}`,
    );
    expect(Number(policies)).toBe(15);

    // Staff are ~97% present.
    const [{ staffPct }] = await q(
      `SELECT 100.0 * count(*) FILTER (WHERE status <> 'ABSENT') / count(*) AS "staffPct" FROM staff_attendance_records`,
    );
    expect(Number(staffPct)).toBeGreaterThan(94);

    // [84.3.6] Sent arrival logs shaped like the real service (D4, D23). Same `it` on purpose:
    // a second `it` re-runs the 3-year seed and makes the suite's per-test reset delete it all,
    // which took longer than the 30 s hook limit on a slow CI runner.
    const per = await q(
      `SELECT a.status, a.mode, a.consumed_at, a.channel,
              (CASE WHEN a.channel = 'SMS' THEN g.phone IS NOT NULL ELSE g.user_id IS NOT NULL END)
                AS reachable,
              count(l.*)::int AS n,
              min(l.created_at) AS first_at
         FROM arrival_notice_subscriptions a
         JOIN guardians g ON g.id = a.guardian_id
         LEFT JOIN communication_logs l ON l.trigger = 'ARRIVAL_NOTICE'
          AND l.student_id = a.student_id AND l.guardian_id = a.guardian_id
        GROUP BY a.id, g.phone, g.user_id`,
    );
    // Every school day, reachable guardian: 1..10 messages (one per day the child came in).
    const recurring = per.filter((r) => r.status === 'ACTIVE' && r.mode === 'RECURRING');
    expect(recurring.some((r) => r.reachable)).toBe(true);
    for (const r of recurring) {
      if (r.reachable) {
        expect(r.n).toBeGreaterThanOrEqual(1);
        expect(r.n).toBeLessThanOrEqual(10);
      } else {
        // Like the service: no user means no PUSH address, no phone means no SMS.
        expect(r.n).toBe(0);
      }
    }
    // A used "Once" had exactly the one message that used it, at `consumed_at`.
    const used = per.filter((r) => r.status === 'OFF' && r.consumed_at !== null);
    expect(used.length).toBeGreaterThan(0);
    for (const r of used) {
      expect(r.n).toBe(r.reachable ? 1 : 0);
      if (r.reachable) {
        expect(new Date(r.first_at).getTime()).toBe(new Date(r.consumed_at).getTime());
      }
    }
    // An ACTIVE "Once" has sent nothing yet (the first message would use it up); REQUESTED and
    // plain OFF rows have none either.
    for (const r of per.filter((r) => !recurring.includes(r) && !used.includes(r))) {
      expect(r.n).toBe(0);
    }
    const bad = await q(
      `SELECT count(*)::int AS n FROM communication_logs
        WHERE trigger = 'ARRIVAL_NOTICE' AND (status <> 'SENT' OR reference_key NOT LIKE 'arrival:%'
          OR (medium = 'PUSH' AND recipient_address NOT LIKE 'push:%'))`,
    );
    expect(bad[0].n).toBe(0);
    // The Bangla time reads like `formatArrivalTime`: a day-part word, then h:mm (no leading 0).
    const bodies = await q<{ message_body: string }>(
      `SELECT message_body FROM communication_logs WHERE trigger = 'ARRIVAL_NOTICE' LIMIT 20`,
    );
    for (const { message_body } of bodies) {
      expect(message_body).toMatch(/আজ (সকাল|দুপুর|বিকাল) [১-৯][০-৯]?:[০-৯]{2}-এ /);
    }

    // [D43] 15 arrival-notice subscriptions over 3 branches.
    const count = async (where: string) =>
      Number(
        (await q(`SELECT count(*) AS n FROM arrival_notice_subscriptions WHERE ${where}`))[0].n,
      );
    expect(await count('true')).toBe(15);
    expect(await count(`mode = 'RECURRING' AND status = 'ACTIVE' AND lock = 'NONE'`)).toBe(6);
    expect(await count(`mode = 'ONCE' AND status = 'ACTIVE'`)).toBe(2);
    expect(await count(`mode = 'ONCE' AND status = 'OFF' AND consumed_at IS NOT NULL`)).toBe(2);
    expect(await count(`status = 'REQUESTED'`)).toBe(2);
    expect(
      await count(`lock = 'ALWAYS' AND status = 'ACTIVE' AND locked_by_user_id IS NOT NULL`),
    ).toBe(1);
    expect(await count(`lock = 'NEVER' AND status = 'OFF' AND locked_by_user_id IS NOT NULL`)).toBe(
      1,
    );
    // One staff-declined row (portal shows "the teacher declined"); locks carry a locked_at.
    expect(await count(`declined_at IS NOT NULL AND status = 'OFF' AND lock = 'NONE'`)).toBe(1);
    expect(await count(`lock <> 'NONE' AND locked_at IS NOT NULL`)).toBe(2);
    expect(await count(`channel = 'PUSH'`)).toBe(10);
    expect(await count(`channel = 'SMS'`)).toBe(5);
    // SMS only in the smsAllowed branch.
    const sms = await q(
      `SELECT DISTINCT s.settings->'attendance'->'arrivalNotice'->>'smsAllowed' AS ok
         FROM arrival_notice_subscriptions a JOIN schools s ON s.id = a.tenant_id
        WHERE a.channel = 'SMS'`,
    );
    expect(sms).toEqual([{ ok: 'true' }]);
    const branches = await q(`SELECT DISTINCT tenant_id FROM arrival_notice_subscriptions`);
    expect(branches).toHaveLength(3);
    // The class-teacher card's section owns exactly the 2 REQUESTED rows.
    const card = DEMO_CARDS.find((c) => c.key === 'class-teacher-8a')!;
    const own = await q(
      `SELECT DISTINCT a.id FROM arrival_notice_subscriptions a
         JOIN enrollments e ON e.student_id = a.student_id
         JOIN teacher_class_sections tcs ON tcs.section_id = e.section_id AND tcs.assignment_type = 'CLASS_TEACHER'
         JOIN teachers t ON t.id = tcs.teacher_id JOIN users u ON u.id = t.user_id
        WHERE u.email = $1 AND a.status = 'REQUESTED'`,
      [card.email],
    );
    expect(own).toHaveLength(2);
    // SMS arrival messages spend credit: ledger and balance still agree, and something was spent.
    const credit: { available: number; ledger: number }[] = await q(
      `SELECT b.available, (SELECT sum(CASE WHEN l.kind = 'GRANT' THEN l.units ELSE -l.units END)
                              FROM sms_credit_ledger l WHERE l.tenant_id = b.tenant_id)::int AS ledger
         FROM sms_credit_balance b`,
    );
    expect(credit.every((c) => c.available === c.ledger)).toBe(true);
    expect(credit.some((c) => c.available < 1000)).toBe(true);
  }, 120_000);
});

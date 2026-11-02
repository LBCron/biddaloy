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
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { FamilyAccessService } from '../../../modules/students/family-access.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { SchoolCalendarService } from '../../../modules/calendar/school-calendar.service';
import { ApplicationsService } from '../../../modules/applications/applications.service';
import { ApplicationDecisionsService } from '../../../modules/applications/application-decisions.service';
import { ApplicationAttachmentsService } from '../../../modules/applications/application-attachments.service';
import { ApplicationLetterService } from '../../../modules/applications/application-letter.service';
import { ApplicationNotifyService } from '../../../modules/applications/application-notify.service';
import { ReviewerScopeService } from '../../../modules/applications/reviewer-scope';
import { ManualHandler } from '../../../modules/applications/handlers/manual.handler';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { createContext, type DemoSeedContext } from '../context';
import { validate } from '../validator';
import { slice as org } from './org';
import { slice as staff } from './staff';
import { slice as students } from './students';
import { slice as attendance } from './attendance';
import { slice as extras } from './student-extras';
import { slice as exams } from './exams';
import { slice } from './applications';
import { FinalResultsService } from '../../../modules/final-results/final-results.service';
import { ReportCardNotesService } from '../../../modules/report-card-notes/report-card-notes.service';
import { TeacherScopeService } from '../../../modules/classes/teacher-scope.service';
import { AttendanceSummaryService } from '../../../modules/attendance/attendance-summary.service';
import { ResultsService } from '../../../modules/exams/results.service';
import { MarkGridService } from '../../../modules/exams/mark-grid.service';
import { AttendanceComponentService } from '../../../modules/exams/attendance-component.service';
import { MarksAuthorizationService } from '../../../modules/exams/marks-authorization.util';
import { SeatPlansService } from '../../../modules/seat-plans/seat-plans.service';
import { TeacherBusyService } from '../../../modules/routines/teacher-busy.service';
import { ResolveRoutineService } from '../../../modules/routines/resolve-routine.service';

const ANCHOR = '2026-10-10';
const SCALE = 0.1;
const YEARS = 2;

describe('applications slice (integration, 2 years, scale 0.1)', () => {
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
      PromotionsService,
      EnrollmentService,
      StudentLifecycleService,
      { provide: ApprovalService, useValue: { consume: vi.fn() } },
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
      {
        provide: StorageService,
        useValue: { put: async () => undefined, delete: async () => undefined },
      },
      // exams slice (runs before applications, as in slices.ts)
      ResultsService,
      FinalResultsService,
      // The exams slice writes report-card notes through the real service (#3411).
      ReportCardNotesService,
      TeacherScopeService,
      // Publish snapshots attendance per student; the seed has none in this slice-only run.
      {
        provide: AttendanceSummaryService,
        useValue: { getSummariesForStudents: async () => new Map() },
      },
      MarkGridService,
      SeatPlansService,
      TeacherBusyService,
      { provide: AttendanceComponentService, useValue: {} },
      { provide: MarksAuthorizationService, useValue: {} },
      { provide: ResolveRoutineService, useValue: { resolveTenantDay: async () => [] } },
      // applications (the notifier talks to push, SMS and the communications module: stubbed)
      SchoolCalendarService,
      FamilyAccessService,
      ReviewerScopeService,
      ApplicationLetterService,
      ApplicationsService,
      ApplicationDecisionsService,
      ApplicationAttachmentsService,
      ManualHandler,
      {
        provide: ApplicationNotifyService,
        useValue: {
          onSubmitted: async () => undefined,
          onTagged: async () => undefined,
          onStepAdvanced: async () => undefined,
          onStatusChanged: async () => undefined,
          onComment: async () => undefined,
        },
      },
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
    await attendance.run(ctx);
    await extras.run(ctx);
    await exams.run(ctx);
    await slice.run(ctx);
  }, 900_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('gives every application type a history and the demo cards their open requests', async () => {
    // Every type has decided history; SCRIPT_RECHECK is checked per branch below.
    const types = await q(
      `SELECT type, count(*) FILTER (WHERE status <> 'PENDING') AS decided FROM applications GROUP BY type`,
    );
    const seen = new Set(types.filter((t) => Number(t.decided) > 0).map((t) => t.type));
    for (const t of [
      'STAFF_LEAVE',
      'STUDENT_LEAVE',
      'FEE_WAIVER',
      'TESTIMONIAL',
      'TRANSFER_CERTIFICATE',
      'READMISSION',
      'SECTION_CHANGE',
      'ID_CARD_REPRINT',
      'GENERAL',
    ]) {
      expect(seen.has(t), t).toBe(true);
    }

    // SCRIPT_RECHECK: every branch with exams has one, pointing at its own exam.
    const branches = await q(
      `SELECT s.id, (SELECT count(*) FROM applications a WHERE a.tenant_id = s.id AND a.type = 'SCRIPT_RECHECK')::int AS n
         FROM schools s WHERE s.slug LIKE 'bmsc-%' AND EXISTS (SELECT 1 FROM exams e WHERE e.tenant_id = s.id)`,
    );
    expect(branches.length).toBeGreaterThan(0);
    for (const b of branches) expect(b.n, b.id).toBeGreaterThan(0);
    const foreign = await q(
      `SELECT a.id FROM applications a LEFT JOIN exams e ON e.id = (a.payload->>'exam_id')::uuid
        WHERE a.type = 'SCRIPT_RECHECK' AND e.tenant_id IS DISTINCT FROM a.tenant_id`,
    );
    expect(foreign).toEqual([]);

    // The principal card has 3+ pending approvals (staff leave waits for LEAVE_APPROVE; the principal holds it).
    const principal = DEMO_CARDS.find((c) => c.key === 'principal')!;
    const [{ n: pending }] = await q(
      `SELECT count(*) AS n FROM applications a JOIN schools s ON s.id = a.tenant_id
        WHERE s.slug = $1 AND a.type = 'STAFF_LEAVE' AND a.status = 'PENDING'`,
      [principal.branchSlug],
    );
    expect(Number(pending)).toBeGreaterThanOrEqual(3);

    // The class teacher 8-A has a pending leave application of their own.
    const teacher = DEMO_CARDS.find((c) => c.key === 'class-teacher-8a')!;
    const mine = await q(
      `SELECT a.status FROM applications a JOIN users u ON u.id = a.applicant_user_id
        WHERE u.email = $1 AND a.type = 'STAFF_LEAVE' AND a.status = 'PENDING'`,
      [teacher.email],
    );
    expect(mine).toHaveLength(1);

    // The guardian card filed one request in each of two branches.
    const guardian = DEMO_CARDS.find((c) => c.key === 'guardian')!;
    const filed = await q(
      `SELECT DISTINCT a.tenant_id FROM applications a JOIN users u ON u.id = a.applicant_user_id
        WHERE u.email = $1 AND a.created_at >= $2::date`,
      [guardian.email, ANCHOR],
    );
    expect(filed).toHaveLength(2);

    // Leave written by the attendance slice is linked to its application, and nothing else broke.
    const [{ n: unlinked }] = await q(
      `SELECT count(*) AS n FROM leave_records WHERE application_id IS NULL`,
    );
    expect(Number(unlinked)).toBe(0);
    const [{ n: mismatched }] = await q(
      `SELECT count(*) AS n FROM leave_records l JOIN applications a ON a.id = l.application_id
        WHERE a.tenant_id <> l.tenant_id OR a.subject_staff_profile_id <> l.staff_profile_id
           OR (l.status = 'APPROVED') <> (a.status = 'APPROVED')`,
    );
    expect(Number(mismatched)).toBe(0);

    // The multi-step path is honest: serials are unique per branch and year, one attachment, one tag.
    const [{ dup }] = await q(
      `SELECT count(*) - count(DISTINCT (tenant_id, serial_year, serial_no)) AS dup FROM applications`,
    );
    expect(Number(dup)).toBe(0);
    expect(Number((await q(`SELECT count(*) AS n FROM application_attachments`))[0].n)).toBe(1);
    expect(Number((await q(`SELECT count(*) AS n FROM application_tags`))[0].n)).toBeGreaterThan(0);

    // Everyone who files, enters or decides an application, and every actor on its history, is a
    // member of that application's branch (Primary's letter is decided by Primary's own office).
    const outsiders = await q(
      `SELECT x.what, x.app FROM (
           SELECT 'applicant' AS what, a.id AS app, a.tenant_id, a.applicant_user_id AS u FROM applications a
           UNION ALL SELECT 'entered_by', a.id, a.tenant_id, a.entered_by_user_id FROM applications a
           UNION ALL SELECT 'decider', a.id, a.tenant_id, a.decided_by_user_id FROM applications a
           UNION ALL SELECT 'actor', e.application_id, e.tenant_id, e.actor_user_id FROM application_events e
         ) x
        WHERE x.u IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM user_tenants ut
           WHERE ut.user_id = x.u AND ut.tenant_id = x.tenant_id AND ut.deleted_at IS NULL)`,
    );
    expect(outsiders).toEqual([]);

    // History (before the anchor) is filed for a student enrolled in that academic year, and a type
    // whose approval would change the student (TC, section change, readmission, fee waiver) is never
    // approved in bulk: the bulk rows apply no effect.
    const [{ n: notEnrolled }] = await q(
      `SELECT count(*)::int AS n FROM applications a
        WHERE a.subject_student_id IS NOT NULL AND a.created_at < $1::date AND NOT EXISTS (
          SELECT 1 FROM enrollments en
           WHERE en.student_id = a.subject_student_id AND en.academic_year_id = a.academic_year_id)`,
      [ANCHOR],
    );
    expect(notEnrolled).toBe(0);
    const [{ n: effectApproved }] = await q(
      `SELECT count(*)::int AS n FROM applications
        WHERE created_at < $1::date AND status = 'APPROVED'
          AND type IN ('TRANSFER_CERTIFICATE', 'SECTION_CHANGE', 'READMISSION', 'FEE_WAIVER')`,
      [ANCHOR],
    );
    expect(effectApproved).toBe(0);

    // The 58.1.05 checks stay clean.
    expect(await validate(ds)).toEqual([]);
  }, 120_000);
});

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
import { FinalResultsService } from '../../../modules/final-results/final-results.service';
import { ReportCardNotesService } from '../../../modules/report-card-notes/report-card-notes.service';
import { TeacherScopeService } from '../../../modules/classes/teacher-scope.service';
import { SchoolsService } from '../../../modules/schools/schools.service';
import { resolveTenantSettings } from '../../../modules/schools/settings/tenant-settings-resolver';
import { AttendanceSummaryService } from '../../../modules/attendance/attendance-summary.service';
import { ResultsService } from '../../../modules/exams/results.service';
import { MarkGridService } from '../../../modules/exams/mark-grid.service';
import { AttendanceComponentService } from '../../../modules/exams/attendance-component.service';
import { MarksAuthorizationService } from '../../../modules/exams/marks-authorization.util';
import { SeatPlansService } from '../../../modules/seat-plans/seat-plans.service';
import { TeacherBusyService } from '../../../modules/routines/teacher-busy.service';
import { ResolveRoutineService } from '../../../modules/routines/resolve-routine.service';
import { createContext } from '../context';
import { slice as org } from './org';
import { slice as students } from './students';
import { slice as extras } from './student-extras';
import { slice as exams } from './exams';

const ANCHOR = '2026-10-10';

describe('exams slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let app: TestingModule;
  // Everything is read once, right after the seed (the suite resets data before each `it`).
  const facts: Record<string, any> = {};
  const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  beforeAll(async () => {
    app = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      AuthTokenService,
      SchoolInviteService,
      StaffProfilesService,
      PromotionsService,
      EnrollmentService,
      StudentLifecycleService,
      ResultsService,
      FinalResultsService,
      // The exams slice writes report-card notes through the real service (#3411).
      ReportCardNotesService,
      TeacherScopeService,
      {
        provide: SchoolsService,
        useValue: { getResolvedSettings: async () => resolveTenantSettings(null) },
      },
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
      { provide: ApprovalService, useValue: { consume: vi.fn() } },
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
      { provide: StorageService, useValue: { put: vi.fn(), exists: vi.fn() } },
    ]);
    ds = app.get<DataSource>(getDataSourceToken());
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    const ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await students.run(ctx);
    await extras.run(ctx);
    facts.rows = await exams.run(ctx);

    facts.finals = await q(
      `SELECT fr.status, fr.mode, y.is_current,
              (SELECT count(*)::int FROM final_result_rows r WHERE r.final_result_id = fr.id) AS rows
         FROM final_results fr JOIN academic_years y ON y.id = fr.academic_year_id
        WHERE fr.deleted_at IS NULL`,
    );
    // Exams per class and year: names.
    // [#3411] Notes per target: the final card (past year) and the current Half-Yearly.
    facts.notes = await q(
      `SELECT n.final_result_id IS NOT NULL AS on_final, n.remark,
              (SELECT count(*)::int FROM jsonb_object_keys(n.conduct)) AS grades
         FROM report_card_notes n`,
    );
    facts.finalRuns = await q(
      `SELECT pr.final_result_id, fr.status, fr.class_id = pr.source_class_id AS same_class
         FROM promotion_runs pr JOIN final_results fr ON fr.id = pr.final_result_id`,
    );
    facts.examsPerClass = await q(
      `SELECT e.class_id, e.academic_year_id, c.numeric_grade, count(*)::int AS n,
              count(*) FILTER (WHERE e.name = 'Test Exam')::int AS tests
         FROM exams e JOIN classes c ON c.id = e.class_id GROUP BY 1, 2, 3`,
    );
    // Published current-year exams: results vs active students of the class.
    facts.published = await q(
      `SELECT e.id,
              (SELECT count(*)::int FROM results r WHERE r.exam_id = e.id AND r.deleted_at IS NULL
                  AND r.published_at IS NOT NULL) AS results,
              (SELECT count(*)::int FROM enrollments en WHERE en.class_id = e.class_id
                  AND en.academic_year_id = e.academic_year_id
                  AND en.enrollment_status = 'ACTIVE') AS active
         FROM exams e JOIN academic_years y ON y.id = e.academic_year_id
        WHERE y.is_current AND e.status = 'PUBLISHED'`,
    );
    facts.progress = await q(
      `SELECT e.id,
              (SELECT count(*)::int FROM mark_grids g WHERE g.exam_id = e.id) AS grids,
              (SELECT count(*)::int FROM mark_grids g WHERE g.exam_id = e.id
                  AND g.state = 'SUBMITTED') AS submitted,
              (SELECT count(*)::int FROM marks m WHERE m.exam_id = e.id) AS marks,
              (SELECT count(*)::int FROM results r WHERE r.exam_id = e.id) AS results,
              (SELECT count(DISTINCT s.subject_id)::int FROM exam_schedules s WHERE s.exam_id = e.id)
                * (SELECT count(*)::int FROM class_sections cs WHERE cs.class_id = e.class_id)
                AS pairs
         FROM exams e WHERE e.name = 'Half-Yearly Exam' AND e.status = 'DRAFT'`,
    );
    // Seat allocations of the next exam: one row per active student per sitting.
    facts.seats = await q(
      `SELECT es.id,
              (SELECT count(*)::int FROM seat_allocations a WHERE a.exam_schedule_id = es.id) AS seats,
              (SELECT count(DISTINCT a.student_id)::int FROM seat_allocations a
                  WHERE a.exam_schedule_id = es.id) AS distinct_students,
              (SELECT count(*)::int FROM enrollments en WHERE en.class_id = e.class_id
                  AND en.academic_year_id = e.academic_year_id
                  AND en.enrollment_status = 'ACTIVE') AS active
         FROM exam_schedules es JOIN exams e ON e.id = es.exam_id
        WHERE e.name = 'Annual Exam' AND e.status = 'DRAFT'`,
    );
    facts.plans = await q(`SELECT status FROM seat_plans`);
    facts.grades = await q(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE grade = 'A+')::int AS aplus,
              count(*) FILTER (WHERE is_fail)::int AS fails
         FROM results WHERE deleted_at IS NULL`,
    );
    // A past year's marks were first written inside that exam's sitting dates.
    facts.markDates = await q(
      `SELECT count(*)::int AS marks,
              count(*) FILTER (WHERE m.created_at::date
                  BETWEEN d.first AND d.last + 1)::int AS inside
         FROM marks m
         JOIN exams e ON e.id = m.exam_id
         JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current = $1
         JOIN LATERAL (SELECT min(date) AS first, max(date) AS last FROM exam_schedules s
                        WHERE s.exam_id = e.id) d ON true`,
      [false],
    );
    facts.markDatesNow = await q(
      `SELECT count(*)::int AS marks,
              count(*) FILTER (WHERE m.created_at::date
                  BETWEEN d.first AND d.last + 1)::int AS inside
         FROM marks m
         JOIN exams e ON e.id = m.exam_id
         JOIN academic_years y ON y.id = e.academic_year_id AND y.is_current = $1
         JOIN LATERAL (SELECT min(date) AS first, max(date) AS last FROM exam_schedules s
                        WHERE s.exam_id = e.id) d ON true`,
      [true],
    );
    facts.subjectFails = await q(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE is_fail)::int AS fails
         FROM result_subjects WHERE deleted_at IS NULL`,
    );
    // Overlapping papers: a class sitting two subjects at the same date and start time.
    facts.clashes = await q(
      `SELECT count(*)::int AS n FROM (
         SELECT exam_id, date, starts_at FROM exam_schedules
          GROUP BY 1, 2, 3 HAVING count(*) > 1) x`,
    );
  }, 600_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('every class has First Term, Half-Yearly and Annual each year, plus Test for X and XII', () => {
    expect(facts.examsPerClass.length).toBeGreaterThan(0);
    for (const c of facts.examsPerClass) {
      const wantsTest = [10, 12].includes(Number(c.numeric_grade));
      expect(c.tests).toBe(wantsTest ? 1 : 0);
      expect(c.n).toBe(wantsTest ? 4 : 3);
    }
  });

  it('publishes one result per active student for each finished exam of the current year', () => {
    expect(facts.published.length).toBeGreaterThan(0);
    for (const e of facts.published) expect(e.results).toBe(e.active);
  });

  it('leaves the current exam half filled and unsubmitted', () => {
    expect(facts.progress.length).toBeGreaterThan(0);
    for (const e of facts.progress) {
      expect(e.submitted).toBe(0);
      expect(e.results).toBe(0);
      expect(e.grids).toBeLessThanOrEqual(e.pairs);
    }
    expect(facts.progress.some((e: any) => e.marks > 0)).toBe(true);
    expect(facts.progress.some((e: any) => e.grids < e.pairs)).toBe(true);
  });

  it('publishes past-year finals, with a best-of one, and leaves current-year finals as drafts', () => {
    const past = facts.finals.filter((f: any) => !f.is_current);
    expect(past.length).toBeGreaterThan(0);
    // A class with no students in the small run publishes with no rows, so rows are checked on some.
    for (const f of past) expect(f.status).toBe('PUBLISHED');
    expect(past.some((f: any) => f.rows > 0)).toBe(true);
    expect(past.some((f: any) => f.mode === 'BEST_OF' && f.rows > 0)).toBe(true);
    const now = facts.finals.filter((f: any) => f.is_current);
    expect(now.length).toBeGreaterThan(0);
    for (const f of now) expect(f.status).toBe('DRAFT');
  });

  it('writes bn remarks and all four conduct grades on the past final card and the current Half-Yearly', () => {
    const onFinal = facts.notes.filter((n: any) => n.on_final);
    const onExam = facts.notes.filter((n: any) => !n.on_final);
    expect(onFinal.length).toBeGreaterThan(0);
    expect(onExam.length).toBeGreaterThan(0);
    for (const n of facts.notes) {
      expect(n.remark).toMatch(/[\u0980-\u09FF]/); // Bangla text
      expect(n.grades).toBe(4); // DEFAULT_CONDUCT_ITEMS (D30)
    }
  });

  it("points the past year's promotion runs at that class's published final result", () => {
    expect(facts.finalRuns.length).toBeGreaterThan(0);
    for (const r of facts.finalRuns) {
      expect(r.status).toBe('PUBLISHED');
      expect(r.same_class).toBe(true);
    }
  });

  it('seats every active student exactly once in each sitting of the next exam', () => {
    expect(facts.seats.length).toBeGreaterThan(0);
    for (const s of facts.seats) {
      expect(s.seats).toBe(s.active);
      expect(s.distinct_students).toBe(s.active);
    }
    expect(facts.plans.every((p: any) => p.status === 'PUBLISHED')).toBe(true);
  });

  it('gives about a tenth of results an A+', () => {
    const share = facts.grades[0].aplus / facts.grades[0].total;
    expect(share).toBeGreaterThanOrEqual(0.05);
    expect(share).toBeLessThanOrEqual(0.15);
    expect(facts.grades[0].fails).toBeGreaterThan(0);
  });

  it("dates a past year's marks inside that exam's sitting window", () => {
    expect(facts.markDates[0].marks).toBeGreaterThan(0);
    expect(facts.markDates[0].inside).toBe(facts.markDates[0].marks);
  });

  it("dates the current year's marks inside that exam's sitting window", () => {
    expect(facts.markDatesNow[0].marks).toBeGreaterThan(0);
    expect(facts.markDatesNow[0].inside).toBe(facts.markDatesNow[0].marks);
  });

  it('fails about 5% of subject results', () => {
    const { total, fails } = facts.subjectFails[0];
    expect(total).toBeGreaterThan(0);
    expect(fails / total).toBeGreaterThanOrEqual(0.01);
    expect(fails / total).toBeLessThanOrEqual(0.1);
  });

  it('never puts two papers of one exam at the same date and time', () => {
    expect(facts.clashes[0].n).toBe(0);
  });
});

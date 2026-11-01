import type { TabSpec } from './tab-spec';
import { schoolTabs } from '../tabs/school';
import { academicsTabs } from '../tabs/academics';
import { peopleTabs } from '../tabs/people';
import { feesTabs } from '../tabs/fees';
import { gradingTabs } from '../tabs/grading';
import { routinesTabs } from '../tabs/routines';
import { examsTabs } from '../tabs/exams';
import { homeworkTab } from '../tabs/academics/homework.tab';
import { homeworkAssignmentTab } from '../tabs/academics/homework-assignment.tab';
import { homeworkSubmissionTab } from '../tabs/academics/homework-submission.tab';
import { syllabusTopicTab } from '../tabs/academics/syllabus-topic.tab';
import { studyPlanTemplatesTab } from '../tabs/academics/study-plan-templates.tab';
import { studyPlansTab } from '../tabs/academics/study-plans.tab';
import { lessonDeliveriesTab } from '../tabs/academics/lesson-deliveries.tab';
import { promotionRunsTab } from '../tabs/people/promotion-runs.tab';
import { promotionEntriesTab } from '../tabs/people/promotion-entries.tab';
import { seatPlansTab } from '../tabs/exams/seat-plans.tab';
import { seatPlanSchedulesTab } from '../tabs/exams/seat-plan-schedules.tab';
import { seatAllocationsTab } from '../tabs/exams/seat-allocations.tab';
import { programsTabs } from '../tabs/programs';
import { designationTab } from '../tabs/people/designation.tab';
import { staffHrRecordTab } from '../tabs/people/staff-hr-record.tab';
import { staffDesignationHistoryTab } from '../tabs/people/staff-designation-history.tab';
import { staffFamilyMemberTab } from '../tabs/people/staff-family-member.tab';
import { staffAddressTab } from '../tabs/people/staff-address.tab';
import { staffExperienceTab } from '../tabs/people/staff-experience.tab';
import { staffEducationTab } from '../tabs/people/staff-education.tab';
import { staffTrainingTab } from '../tabs/people/staff-training.tab';
import { staffAchievementTab } from '../tabs/people/staff-achievement.tab';
import { staffLanguageTab } from '../tabs/people/staff-language.tab';
import { staffDocumentTab } from '../tabs/people/staff-document.tab';
import { printTabs } from '../tabs/print';
import { arrivalNoticeSubscriptionsTab, attendanceTabs } from '../tabs/attendance';
import { hrTabs } from '../tabs/hr';
import { applicationsTabs } from '../tabs/applications';
import { acrTabs } from '../tabs/people/acr.tab';
import { incidentsTabs } from '../tabs/people/incidents.tab';
import { surveysTabs } from '../tabs/people/surveys.tab';

/**
 * Every tab name a backup workbook may contain, in apply order (epic 14.0
 * decision D2). A tab may only depend on tabs earlier in this list, which is
 * what makes a single forward pass a valid restore order.
 *
 * This list is the contract between lanes: it is fixed here in 14.1.1 so that
 * lanes 14.2-14.4 can each add their tabs without renegotiating ordering, and
 * so `readWorkbook` (14.1.3) can tell a known sheet from a stray one.
 */
export const EXPECTED_TABS = [
  'school',
  'academic_years',
  'classes',
  'sections',
  'subjects',
  'class_subjects',
  'calendar_events',
  'users',
  // [36.4.5] `staff_profiles` sits immediately before `teachers`:
  // `teachers.staff_profile_id` now FKs it, though that column is excluded
  // from `teachers.tab.ts` as system-derived, so there's no reverse
  // ordering dependency.
  'staff_profiles',
  'teachers',
  'teacher_assignments',
  // [83.2.3] Class / subject coordinators (Epic 83).
  'coordinator_assignments',
  'guardians',
  'students',
  'enrollments',
  // [27.6] Epic 27.0's admission tabs. Placed here rather than at the very
  // end of this list (unlike [22.3.6]'s homework tabs): `peopleTabs`
  // (`tabs/people/index.ts`) appends them physically right after
  // `enrollments`, and `ALL_TABS` must be a strict subsequence of this list
  // (`assertRegistryValid` below) — every dependency (`sections`, `users`)
  // is already earlier here either way.
  'admission_intakes',
  'admission_applicants',
  'admission_evaluations',
  // [39.1.3] Epic 39.0's per-student child tabs, appended by `peopleTabs` after
  // the admission tabs; they depend on `students`, `enrollments`, `users`.
  'student_lifecycle_events',
  'student_notes',
  'student_public_exams',
  'fee_structures',
  // [38.1.2] `fine_rules` FKs `fee_structures` (its fine-category price) and
  // is FK'd by `student_fees.fine_rule_id`, so it sits between the two.
  'fine_rules',
  'student_fees',
  'invoices',
  'payments',
  'payment_allocations',
  'grading_scales',
  'grading_bands',
  // [35.1.5] Exam templates depend on nothing; kept ahead of `exams`.
  'exam_templates',
  'exam_template_components',
  'exams',
  'exam_components',
  'exam_schedules',
  'mark_grids',
  'marks',
  'results',
  'result_subjects',
  'student_subject_choices',
  // Epic 21.0 (class routine/timetable), appended at the end: no other
  // tab depends on these, and they depend on tabs already earlier in
  // this list (academic_years, sections, subjects, teachers, users).
  'shifts',
  'period_slots',
  'rooms',
  'routines',
  'routine_slots',
  'routine_slot_teachers',
  'routine_substitutions',
  'routine_change_requests',
  // [788] Promotion tabs. Depend on `classes`/`academic_years`/`exams`/
  // `students`/`enrollments`/`sections`, all of which are earlier in this
  // list by this point, so appending here (rather than inside `peopleTabs`,
  // which is spread *before* `examsTabs` in `ALL_TABS` below — too early
  // for a tab that depends on `exams`) keeps every dependency satisfied.
  // Placed after Epic 21.0's routine tabs (no ordering dependency between
  // the two groups; routines landed first).
  'promotion_runs',
  'promotion_entries',
  // [22.3.6] Epic 22.0's homework/syllabus tabs. Appended at the end rather
  // than interleaved into the academics block above: `homework_assignments`
  // depends on `sections`/`students` (people lane, registered after
  // academics), and a dependency must appear earlier in this list than its
  // dependent — appending here keeps every dependency already satisfied.
  'homework',
  'homework_assignments',
  'homework_submissions',
  'syllabus_topics',
  // [25.5, #1054] Epic 787's seat-plan tabs. Appended at the very end rather
  // than interleaved next to `exam_schedules` (their tab files live in
  // `tabs/exams/` alongside it): `seat_allocations` depends on `rooms`
  // (routines lane) and `users` (people lane), both of which appear later in
  // this list than `exam_schedules` does, and a dependency must appear
  // earlier in EXPECTED_TABS than its dependent.
  'seat_plans',
  'seat_plan_schedules',
  'seat_allocations',
  // [34.1.4] Epic 34.0's programs spine. Appended at the end: `programs`
  // has no dependency of its own, but `program_enrollments` depends on
  // `students` (people lane, registered earlier in ALL_TABS below) and
  // `milestone_achievements` depends on `program_enrollments` and
  // `program_milestones`, both of which must precede it in this list.
  'programs',
  'program_milestones',
  'program_enrollments',
  'milestone_achievements',
  // [23.5] Epic 785's wave-1 staff-HR tabs. Appended at the very end,
  // after every other lane's tabs: `staff_designation_history` depends on
  // `designations` and `users` (both earlier in this list already), and
  // nothing else in the registry depends on any of these ten, so there is
  // no earlier slot they are required to sit in.
  'designations',
  'staff_hr_records',
  'staff_designation_history',
  'staff_family_members',
  'staff_addresses',
  'staff_experience',
  'staff_education',
  'staff_training',
  'staff_achievements',
  'staff_languages',
  // [23.7] Wave 2 close — staff_documents, depends only on `users`
  // (already earlier in this list), appended right after the rest of the
  // staff-HR tabs.
  'staff_documents',
  // [36.4.5] Epic 36.0's staff-attendance/leave tabs. Appended at the end,
  // same reasoning as the homework/syllabus block above: `staff_attendance_records`
  // depends on `staff_profiles` (people lane, registered earlier in this
  // list) and `leave_records` depends on both `staff_profiles` and `users` —
  // both already satisfied by the time these are applied.
  'staff_attendance_sessions',
  'staff_attendance_records',
  // [52.1.6] applications go before leave_records, which now refs them.
  'applications',
  'application_events',
  'application_tags',
  'application_attachments',
  'leave_policies',
  'leave_records',
  // [32.3.10] Epic 32's print setup. Appended at the end, in dependency order:
  // templates point at assets, and versions point at their template.
  'printer_profiles',
  'print_assets',
  'print_templates',
  'print_template_versions',
  // [28.1.3] Epic 28.0's ACR / incident / survey tabs, appended at the end:
  // they depend only on `users`, `academic_years`, `teachers` and `subjects`,
  // all earlier in this list. Order is restore order.
  'acr_form_versions',
  'acr_criteria',
  'acr_assessments',
  'acr_scores',
  'staff_incidents',
  'surveys',
  'survey_questions',
  'survey_targets',
  'survey_responses',
  'survey_answers',
  // [66.1.03] Epic 66.0 study plans. Depend on `sections`, `subjects`, `teachers`,
  // `period_slots` and `users`, all earlier in this list.
  'study_plan_templates',
  'study_plans',
  'lesson_deliveries',
  // [84.2.3] Epic 84.0 arrival-notice subscriptions. Depend on `students` and
  // `guardians`, both earlier in this list.
  'arrival_notice_subscriptions',
] as const;

export type ExpectedTabName = (typeof EXPECTED_TABS)[number];

/**
 * The live registry. Assembled from four per-group barrels rather than one
 * literal list so that each lane owns exactly one file and no two lanes ever
 * conflict in this one.
 */
export const ALL_TABS: readonly TabSpec<any, any>[] = [
  ...schoolTabs,
  ...academicsTabs,
  ...peopleTabs,
  ...feesTabs,
  ...gradingTabs,
  ...examsTabs,
  ...routinesTabs,
  // [788] Registered here directly (not via `peopleTabs`) so they land
  // after `examsTabs` in this list — see the `EXPECTED_TABS` comment above.
  promotionRunsTab,
  promotionEntriesTab,
  // [22.3.6] Appended after every lane's own barrel, not folded into
  // `academicsTabs` — see the `EXPECTED_TABS` comment above on why these
  // four must come last.
  homeworkTab,
  homeworkAssignmentTab,
  homeworkSubmissionTab,
  syllabusTopicTab,
  // [25.5, #1054] Appended last, after `rooms` (routinesTabs) and `users`
  // (peopleTabs) are both already registered above — see the EXPECTED_TABS
  // comment for why these three can't live inside `examsTabs` itself.
  seatPlansTab,
  seatPlanSchedulesTab,
  seatAllocationsTab,
  // [34.1.4] Appended after every lane's own barrel, not folded into
  // `peopleTabs` — see the `EXPECTED_TABS` comment above on why these four
  // must come last.
  ...programsTabs,
  // [23.5] Epic 785's wave-1 staff-HR tabs. Registered here directly
  // (not via `peopleTabs`), same reason `promotionRunsTab`/`seatPlansTab`
  // above are: `EXPECTED_TABS` places them after every tab already
  // registered above, but `peopleTabs` itself is spread earlier in
  // `ALL_TABS` than `feesTabs`/`examsTabs`/`routinesTabs` — too early for
  // a tab that must sit after all of those.
  designationTab,
  staffHrRecordTab,
  staffDesignationHistoryTab,
  staffFamilyMemberTab,
  staffAddressTab,
  staffExperienceTab,
  staffEducationTab,
  staffTrainingTab,
  staffAchievementTab,
  staffLanguageTab,
  // [23.7] Wave 2 close.
  staffDocumentTab,
  // [36.4.5] Appended after every lane's own barrel, not folded into
  // `peopleTabs` — see the `EXPECTED_TABS` comment above on why these must
  // come last.
  ...attendanceTabs,
  // [52.1.6] before hrTabs: leave_records refs applications.
  ...applicationsTabs,
  ...hrTabs,
  // [32.3.10] Epic 32's print setup: printers, assets, templates, template versions.
  // Last, matching where they sit in EXPECTED_TABS.
  ...printTabs,
  // [28.1.3] After every lane's barrel — see the `EXPECTED_TABS` comment.
  ...acrTabs,
  ...incidentsTabs,
  ...surveysTabs,
  // [66.1.03] Same order as EXPECTED_TABS.
  studyPlanTemplatesTab,
  studyPlansTab,
  lessonDeliveriesTab,
  // [84.2.3]
  arrivalNoticeSubscriptionsTab,
];

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * Fails loudly on a registry that could not produce a correct restore.
 *
 * Throws rather than returning a report: every caller (the registry spec, and
 * later the export/import services) treats an invalid registry as a
 * programming error that must stop the process, so a precise message is the
 * entire useful output.
 *
 * `ref` targets are checked against the tabs actually passed in, not against
 * `EXPECTED_TABS`. While the registry is only partly populated — the state for
 * all of waves 1 and 2 — a tab referencing a not-yet-landed tab would be a
 * genuine dangling reference at runtime, and validating against the passed
 * array is what catches it.
 */
export interface RegistryValidationOptions {
  /**
   * Tolerate a `dependsOn` or `ref` target that is absent from the registry
   * entirely, treating it as "that lane has not landed yet" rather than a
   * dangling reference.
   *
   * Needed only while epic 14.0 is in flight: four lanes land tabs
   * independently, so if `students` (which depends on `guardians`) merges
   * before `guardians` does, a strict check at boot would take `main` down
   * for everyone over an ordinary landing order rather than a bad merge.
   * Every other invariant stays strict, and once the registry is complete
   * the boot check becomes strict automatically.
   */
  partial?: boolean;
}

export function assertRegistryValid(
  tabs: readonly TabSpec<any, any>[],
  options: RegistryValidationOptions = {},
): void {
  const partial = options.partial ?? false;
  const seen = new Set<string>();
  const names = new Set(tabs.map((t) => t.name));
  const expected = new Set<string>(EXPECTED_TABS);

  // The registry must be a *subsequence* of EXPECTED_TABS, not merely a
  // subset of it. `dependsOn` alone cannot enforce the D2 order: two tabs
  // with no declared dependency between them could concatenate in either
  // order and still pass, which would make export sheet order drift from
  // the documented contract.
  let expectedCursor = -1;

  tabs.forEach((tab, index) => {
    if (seen.has(tab.name)) {
      throw new RegistryError(`Duplicate tab name "${tab.name}" at index ${index}.`);
    }
    seen.add(tab.name);

    if (!expected.has(tab.name)) {
      throw new RegistryError(
        `Tab "${tab.name}" is not one of the ${EXPECTED_TABS.length} names in EXPECTED_TABS. ` +
          `readWorkbook treats an unlisted sheet as stray and skips it, so this tab would ` +
          `silently vanish on restore.`,
      );
    }

    const position = EXPECTED_TABS.indexOf(tab.name as (typeof EXPECTED_TABS)[number]);
    if (position <= expectedCursor) {
      throw new RegistryError(
        `Tab "${tab.name}" is registered out of EXPECTED_TABS order (expected it before ` +
          `"${EXPECTED_TABS[expectedCursor]}").`,
      );
    }
    expectedCursor = position;

    for (const dependency of tab.dependsOn) {
      // Strict even in partial mode: a dependency outside EXPECTED_TABS can
      // never be satisfied by a later lane landing, so tolerating it here
      // would let a genuinely broken tab boot successfully forever.
      if (!expected.has(dependency)) {
        throw new RegistryError(`Tab "${tab.name}" depends on unknown tab "${dependency}".`);
      }
      if (!names.has(dependency)) {
        if (partial) continue;
        throw new RegistryError(
          `Tab "${tab.name}" depends on "${dependency}", which is not registered.`,
        );
      }
      // `seen` holds only the tabs at a lower index, so membership here is
      // exactly "appears earlier in the array".
      if (!seen.has(dependency)) {
        throw new RegistryError(
          `Tab "${tab.name}" depends on "${dependency}", which must appear earlier in the registry.`,
        );
      }
    }

    const first = tab.columns[0];
    if (!first || first.key !== 'id' || first.type !== 'uuid') {
      throw new RegistryError(
        `Tab "${tab.name}" must declare { key: 'id', type: 'uuid' } as its first column.`,
      );
    }

    const columnKeys = new Set<string>();
    for (const column of tab.columns) {
      if (columnKeys.has(column.key)) {
        // Two ColumnSpecs with one key collapse to a single entry in the
        // `Record<string, string>` that fromRow receives, so the second
        // silently shadows the first on both export and import.
        throw new RegistryError(`Tab "${tab.name}" declares column "${column.key}" twice.`);
      }
      columnKeys.add(column.key);
    }

    // A tab with no natural key makes keyOf constant, which collapses its
    // whole KeyIndex to one entry and makes ref resolution and
    // deleteByAbsence match an arbitrary row.
    if (tab.naturalKey.length === 0) {
      throw new RegistryError(`Tab "${tab.name}" must declare at least one naturalKey column.`);
    }

    for (const key of tab.naturalKey) {
      if (!columnKeys.has(key)) {
        throw new RegistryError(
          `Tab "${tab.name}" has naturalKey entry "${key}" that is not one of its columns.`,
        );
      }
    }

    for (const column of tab.columns) {
      if (column.type === 'enum' && (!column.enumValues || column.enumValues.length === 0)) {
        // Without an allowed-value list the import validator has nothing to
        // check against, so a bad cell reaches the DB and fails the whole
        // restore instead of producing one per-row RowError.
        throw new RegistryError(
          `Tab "${tab.name}" column "${column.key}" is type "enum" but declares no enumValues.`,
        );
      }

      if (column.type !== 'ref' && column.type !== 'ref-list') continue;
      if (!column.ref) {
        throw new RegistryError(
          `Tab "${tab.name}" column "${column.key}" is type "${column.type}" but names no ref target.`,
        );
      }
      // Strict even in partial mode, same reasoning as the dependsOn check
      // above: a ref target outside EXPECTED_TABS is never satisfiable.
      if (!expected.has(column.ref)) {
        throw new RegistryError(
          `Tab "${tab.name}" column "${column.key}" references unknown tab "${column.ref}".`,
        );
      }
      // A ref target that isn't a declared dependency may be applied after
      // this tab, so its KeyIndex would not exist yet and every ctx.ref()
      // would return undefined — importing every row with a null parent.
      // Self-references (a parent class pointing at another class) are fine:
      // the tab is applied in one pass and can resolve within itself.
      // Checked before the "not yet registered" tolerance below so partial
      // mode cannot let an invalid tab boot just because its ref target
      // hasn't landed yet.
      if (column.ref !== tab.name && !tab.dependsOn.includes(column.ref)) {
        throw new RegistryError(
          `Tab "${tab.name}" column "${column.key}" references tab "${column.ref}", which must ` +
            `also be listed in its dependsOn.`,
        );
      }
      if (!names.has(column.ref)) {
        if (partial) continue;
        throw new RegistryError(
          `Tab "${tab.name}" column "${column.key}" references unknown tab "${column.ref}".`,
        );
      }
    }
  });
}

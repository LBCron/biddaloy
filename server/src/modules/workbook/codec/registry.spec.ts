import { describe, expect, it } from 'vitest';
import { ALL_TABS, EXPECTED_TABS, assertRegistryValid } from './registry';
import type { ColumnSpec, TabSpec } from './tab-spec';

const idColumn: ColumnSpec = { key: 'id', type: 'uuid', label: { en: 'ID', bn: 'আইডি' } };

const nameColumn: ColumnSpec = {
  key: 'name',
  type: 'string',
  required: true,
  label: { en: 'Name', bn: 'নাম' },
};

function refColumn(ref: string): ColumnSpec {
  return { key: 'class', type: 'ref', ref, label: { en: 'Class', bn: 'শ্রেণি' } };
}

/**
 * A minimal TabSpec whose behavioural methods are never called — every test
 * here exercises `assertRegistryValid`, which only reads the declarative
 * fields (name, dependsOn, columns, naturalKey).
 *
 * The defaults are deliberately *valid* (a real EXPECTED_TABS name, an
 * id:uuid first column, a non-empty naturalKey) so each test can introduce
 * exactly one defect and be sure that defect is what the assertion caught.
 */
function fakeTab(overrides: Partial<TabSpec<unknown, unknown>> = {}): TabSpec<unknown, unknown> {
  return {
    name: 'classes',
    entity: class Fake {},
    excluded: [],
    dependsOn: [],
    columns: [idColumn, nameColumn],
    naturalKey: ['name'],
    deleteByAbsence: false,
    load: () => Promise.resolve([]),
    toRow: () => ({}),
    fromRow: () => ({ row: {} }),
    keyOf: () => '',
    diffFields: () => [],
    upsert: () => Promise.resolve({}),
    remove: () => Promise.resolve(),
    ...overrides,
  };
}

describe('EXPECTED_TABS', () => {
  it('lists the tab names in epic decision D2 order, plus Epics 19.0, 21.0, 22.0, 26.0, 27.0, 36.0 and 32.0 appended at the end', () => {
    expect(EXPECTED_TABS).toEqual([
      'school',
      'academic_years',
      'classes',
      'sections',
      'subjects',
      'class_subjects',
      'calendar_events',
      'users',
      'staff_profiles',
      'teachers',
      'teacher_assignments',
      'coordinator_assignments',
      'guardians',
      'students',
      'enrollments',
      // [27.6] Epic 27.0's admission tabs.
      'admission_intakes',
      'admission_applicants',
      'admission_evaluations',
      'student_lifecycle_events',
      'student_notes',
      'student_public_exams',
      'fee_structures',
      // [38.1.2] Epic 38.0's fine rules.
      'fine_rules',
      'student_fees',
      'invoices',
      'payments',
      'payment_allocations',
      'grading_scales',
      'grading_bands',
      // [35.1.5] Exam templates, ahead of `exams`.
      'exam_templates',
      'exam_template_components',
      // [19.10.1] Epic 19.0's exams/marks/results spine (#906).
      'exams',
      'exam_components',
      // [19.11.1] Exam routine — one subject's sitting within an exam (#928).
      'exam_schedules',
      'mark_grids',
      'marks',
      'results',
      'result_subjects',
      'student_subject_choices',
      'shifts',
      'period_slots',
      'rooms',
      'routines',
      'routine_slots',
      'routine_slot_teachers',
      'routine_substitutions',
      'routine_change_requests',
      // [788] Promotion tabs — see EXPECTED_TABS's own comment in registry.ts.
      'promotion_runs',
      'promotion_entries',
      // [22.3.6] Appended last — see EXPECTED_TABS's own comment in registry.ts.
      'homework',
      'homework_assignments',
      'homework_submissions',
      'syllabus_topics',
      // [25.5] Wave 2 close — seat-plan tabs, in dependency order (#1054).
      'seat_plans',
      'seat_plan_schedules',
      'seat_allocations',
      // [34.1.4] Epic 34.0's programs spine — see EXPECTED_TABS's own
      // comment in registry.ts.
      'programs',
      'program_milestones',
      'program_enrollments',
      'milestone_achievements',
      // [23.5] Wave 1 close — staff-HR tabs (#1086).
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
      // [23.7] Wave 2 close — staff_documents (#1088).
      'staff_documents',
      // [36.4.5] Epic 36.0's staff-attendance/leave tabs — see
      // EXPECTED_TABS's own comment in registry.ts.
      'staff_attendance_sessions',
      'staff_attendance_records',
      // [52.1.6] before leave_records, which now refs applications.
      'applications',
      'application_events',
      'application_tags',
      'application_attachments',
      'leave_policies',
      'leave_records',
      // [32.3.10] Epic 32's print setup — see EXPECTED_TABS's own comment in registry.ts.
      'printer_profiles',
      'print_assets',
      'print_templates',
      'print_template_versions',
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
      // [66.1.03] Epic 66.0 study plans.
      'study_plan_templates',
      'study_plans',
      'lesson_deliveries',
      // [84.2.3] Epic 84.0 arrival-notice subscriptions.
      'arrival_notice_subscriptions',
    ]);
  });

  it('contains no duplicates', () => {
    expect(new Set(EXPECTED_TABS).size).toBe(EXPECTED_TABS.length);
  });
});

describe('ALL_TABS', () => {
  // Deliberately an invariant that survives the tab lanes populating their
  // barrels, rather than `toEqual([])` — otherwise every later lane would
  // have to edit this shared spec, which is the conflict the four-barrel
  // design exists to prevent.
  it('is valid', () => {
    // Same partial-to-strict lifecycle as WorkbookModule: strict once all
    // all tabs have landed, tolerant of not-yet-registered tabs until then.
    expect(() =>
      assertRegistryValid(ALL_TABS, { partial: ALL_TABS.length < EXPECTED_TABS.length }),
    ).not.toThrow();
  });

  it('registers only names declared in EXPECTED_TABS', () => {
    for (const tab of ALL_TABS) {
      expect(EXPECTED_TABS).toContain(tab.name);
    }
  });
});

describe('assertRegistryValid', () => {
  it('accepts a valid registry', () => {
    const tabs = [
      fakeTab({ name: 'classes' }),
      fakeTab({
        name: 'students',
        dependsOn: ['classes'],
        columns: [idColumn, nameColumn, refColumn('classes')],
      }),
    ];

    expect(() => assertRegistryValid(tabs)).not.toThrow();
  });

  it('throws when a dependency appears later in the array', () => {
    // 'sections' depends on 'classes' but is listed first. Both names are in
    // EXPECTED_TABS order-wise reversed, so this also proves the dependsOn
    // check reports before the ordering check would.
    const tabs = [
      fakeTab({ name: 'sections', dependsOn: ['classes'] }),
      fakeTab({ name: 'classes' }),
    ];

    expect(() => assertRegistryValid(tabs)).toThrow(/must appear earlier/);
  });

  it('throws on a duplicate tab name', () => {
    const tabs = [fakeTab({ name: 'classes' }), fakeTab({ name: 'classes' })];

    expect(() => assertRegistryValid(tabs)).toThrow(/Duplicate tab name "classes"/);
  });

  // A tab whose ref target is missing from the registry entirely is caught by
  // the dependsOn check first, since a ref target must also be a dependency.
  it('throws when a ref column names a tab that is not registered at all', () => {
    const tabs = [
      fakeTab({
        name: 'students',
        dependsOn: ['classes'],
        columns: [idColumn, nameColumn, refColumn('classes')],
      }),
    ];

    expect(() => assertRegistryValid(tabs)).toThrow(
      /depends on "classes", which is not registered/,
    );
  });

  // A ref target that isn't a dependency is applied in an undefined order
  // relative to this tab, so every ctx.ref() would return undefined and every
  // row would import with a null parent.
  it('throws when a ref target is registered but not declared in dependsOn', () => {
    const tabs = [
      fakeTab({ name: 'classes' }),
      fakeTab({
        name: 'students',
        dependsOn: [],
        columns: [idColumn, nameColumn, refColumn('classes')],
      }),
    ];

    expect(() => assertRegistryValid(tabs)).toThrow(/also be listed in its dependsOn/);
  });

  it('allows a self-referencing ref column without a dependsOn entry', () => {
    const tabs = [
      fakeTab({ name: 'classes', columns: [idColumn, nameColumn, refColumn('classes')] }),
    ];

    expect(() => assertRegistryValid(tabs)).not.toThrow();
  });

  it('throws when the first column is not id:uuid', () => {
    const tabs = [fakeTab({ name: 'classes', columns: [nameColumn] })];

    expect(() => assertRegistryValid(tabs)).toThrow(/must declare \{ key: 'id', type: 'uuid' \}/);
  });

  it('throws when a naturalKey entry is not a column', () => {
    const tabs = [fakeTab({ name: 'classes', naturalKey: ['code'] })];

    expect(() => assertRegistryValid(tabs)).toThrow(
      /naturalKey entry "code" that is not one of its columns/,
    );
  });

  it('throws when naturalKey is empty', () => {
    const tabs = [fakeTab({ name: 'classes', naturalKey: [] })];

    expect(() => assertRegistryValid(tabs)).toThrow(/at least one naturalKey column/);
  });

  it('throws on a duplicate column key', () => {
    const tabs = [fakeTab({ name: 'classes', columns: [idColumn, nameColumn, nameColumn] })];

    expect(() => assertRegistryValid(tabs)).toThrow(/declares column "name" twice/);
  });

  it('throws when an enum column declares no enumValues', () => {
    const tabs = [
      fakeTab({
        name: 'classes',
        columns: [
          idColumn,
          nameColumn,
          { key: 'level', type: 'enum', label: { en: 'Level', bn: 'স্তর' } },
        ],
      }),
    ];

    expect(() => assertRegistryValid(tabs)).toThrow(/is type "enum" but declares no enumValues/);
  });

  it('throws when a tab name is not in EXPECTED_TABS', () => {
    const tabs = [fakeTab({ name: 'student' })];

    expect(() => assertRegistryValid(tabs)).toThrow(/is not one of the \d+ names in EXPECTED_TABS/);
  });

  // While epic 14.0 is in flight the four lanes land tabs independently, so
  // a not-yet-shipped dependency must not take the server down at boot.
  describe('partial mode', () => {
    it('tolerates a dependency that has not landed yet', () => {
      const tabs = [fakeTab({ name: 'students', dependsOn: ['guardians'] })];

      expect(() => assertRegistryValid(tabs)).toThrow(/is not registered/);
      expect(() => assertRegistryValid(tabs, { partial: true })).not.toThrow();
    });

    it('tolerates a ref target that has not landed yet', () => {
      const tabs = [
        fakeTab({
          name: 'students',
          dependsOn: ['classes'],
          columns: [idColumn, nameColumn, refColumn('classes')],
        }),
      ];

      expect(() => assertRegistryValid(tabs, { partial: true })).not.toThrow();
    });

    it('still enforces every other invariant', () => {
      expect(() =>
        assertRegistryValid([fakeTab({ name: 'classes' }), fakeTab({ name: 'classes' })], {
          partial: true,
        }),
      ).toThrow(/Duplicate tab name/);

      expect(() =>
        assertRegistryValid([fakeTab({ name: 'classes', naturalKey: [] })], { partial: true }),
      ).toThrow(/at least one naturalKey column/);
    });

    // "Not yet landed" only excuses a target that will exist once every lane
    // has shipped. A dependency or ref outside EXPECTED_TABS altogether can
    // never be satisfied, so partial mode must not tolerate it either.
    it('does not tolerate a dependency outside EXPECTED_TABS', () => {
      const tabs = [fakeTab({ name: 'students', dependsOn: ['guardian'] })];

      expect(() => assertRegistryValid(tabs, { partial: true })).toThrow(/unknown tab "guardian"/);
    });

    it('does not tolerate a ref target outside EXPECTED_TABS', () => {
      const tabs = [
        fakeTab({
          name: 'students',
          dependsOn: ['classes'],
          columns: [idColumn, nameColumn, refColumn('class')],
        }),
      ];

      expect(() => assertRegistryValid(tabs, { partial: true })).toThrow(/unknown tab "class"/);
    });

    // A ref target that has landed (so `names.has` would pass) but isn't
    // declared in `dependsOn` must still fail even while partial, or the
    // tab boots with a ctx.ref() that can silently resolve to undefined.
    it('does not tolerate a ref target missing from dependsOn, even once it exists', () => {
      const tabs = [
        fakeTab({ name: 'classes' }),
        fakeTab({
          name: 'students',
          dependsOn: [],
          columns: [idColumn, nameColumn, refColumn('classes')],
        }),
      ];

      expect(() => assertRegistryValid(tabs, { partial: true })).toThrow(
        /also be listed in its dependsOn/,
      );
    });
  });

  // dependsOn alone cannot catch this: 'subjects' and 'sections' have no
  // declared relationship, so only the EXPECTED_TABS subsequence check does.
  it('throws when two independent tabs are registered out of EXPECTED_TABS order', () => {
    const tabs = [fakeTab({ name: 'subjects' }), fakeTab({ name: 'sections' })];

    expect(() => assertRegistryValid(tabs)).toThrow(/out of EXPECTED_TABS order/);
  });
});

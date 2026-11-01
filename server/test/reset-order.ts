import {
  SEED_TENANT_ID,
  SEED_ADMIN_USER_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
} from './constants';

/**
 * Child-first delete order for the transactional tables cleared before
 * every test. Validated against the live `pg_constraint` FK graph by
 * `reset-order.integration.spec.ts` — if a future migration adds an FK
 * this order violates, that spec fails and tells you which table to move.
 *
 * `user_tenants`, `schools`, `users`, `academic_years`, `classes`, and
 * `class_sections` are deliberately absent from this list — they're reset
 * separately, once per spec *file* rather than once per *test*, by
 * `buildReferenceResetSql()` below. See that function's doc comment for
 * why they need their own cadence.
 */
export const TRANSACTIONAL_TABLES_CHILD_FIRST = [
  // [75.34] platform incident state; no FKs.
  'platform_alerts',
  // [49.4] billing; payments FK orders, so they clear first.
  'platform_payments',
  'seat_orders',
  // [67.1.02] attention engine; recipients FK alerts, so they clear first.
  'alert_recipients',
  'alerts',
  // [28.1.2] ACR / incidents / surveys. Child-first within each group; all
  // FK (RESTRICT) to users/teachers/subjects/academic_years, so they clear
  // before those tables.
  'survey_answers',
  'survey_responses',
  'survey_targets',
  'survey_questions',
  'surveys',
  'staff_incidents',
  'acr_scores',
  'acr_assessments',
  'acr_criteria',
  'acr_form_versions',
  // [39.1.2] FK (RESTRICT) to `students` and `enrollments`, so all three
  // clear before either of those.
  'student_lifecycle_events',
  'student_notes',
  'student_public_exams',
  // [25.5, #1054] `seat_allocations` FKs to `seat_plans`, `exam_schedules`,
  // `students`, and `rooms` (all `ON DELETE CASCADE`); `seat_plan_schedules`
  // FKs to `seat_plans` and `exam_schedules`. All three appear before every
  // one of those tables below to keep this list child-first.
  'seat_allocations',
  'seat_plan_schedules',
  'seat_plans',
  'workbook_jobs',
  // [32.1.2] print tables: items -> jobs -> versions -> templates (versions
  // RESTRICT their template; templates' current_version_id is SET NULL).
  'print_job_items',
  'print_jobs',
  'print_template_versions',
  'print_templates',
  'printer_profiles',
  'print_assets',
  // [23.0] the 7 staff-child tables (documents/languages/achievements/
  // training/education/experience/addresses) and family_members have no FK
  // to each other or to staff_hr_records; staff_designation_history FKs to
  // designations (`ON DELETE CASCADE`), so it must clear before designations.
  'staff_documents',
  'staff_languages',
  'staff_achievements',
  'staff_training',
  'staff_education',
  'staff_experience',
  'staff_addresses',
  'staff_family_members',
  'staff_designation_history',
  'staff_hr_records',
  'designations',
  // [34.1.4] milestone_achievements references program_enrollments+
  // program_milestones; program_enrollments references programs+students;
  // program_milestones references programs. All must clear before
  // `students` below, and programs has no other incoming FK here.
  'milestone_achievements',
  'program_enrollments',
  'program_milestones',
  'programs',
  // [27.1] admission_evaluations references admission_applicants;
  // admission_applicants references admission_intakes; admission_intakes
  // references class_sections. All must clear before class_sections below.
  'admission_evaluations',
  'admission_applicants',
  'admission_intakes',
  // [788] promotion_entries references promotion_runs (`ON DELETE CASCADE`);
  // promotion_runs references classes/schools. Neither has an incoming FK
  // from anything else here, so this pair only needs to clear before
  // `classes`/`schools` — reset separately, per-file, by
  // `buildReferenceResetSql()` below — and entries before its own run.
  'promotion_entries',
  'promotion_runs',
  // [22.2.1] homework_submissions/homework_assignments reference
  // homework+students+class_sections; homework references subjects+classes;
  // syllabus_topics references subjects+classes. All must clear before
  // their parents below.
  'homework_submissions',
  'homework_assignments',
  'homework',
  'syllabus_topics',
  // [66.1.02] study_plans/lesson_deliveries/study_plan_templates FK sections,
  // subjects, terms, period slots and users, so they clear before them.
  'lesson_deliveries',
  'study_plans',
  'study_plan_templates',
  // [19.2.1] result_subjects/results reference exams+students+grading_scales;
  // marks/mark_grids/exam_components reference exams+students+subjects;
  // student_subject_choices references students+class_subjects;
  // [19.11.1] exam_schedules references exams+subjects. All must clear
  // before their parents below.
  'result_subjects',
  'results',
  'mark_grids',
  'marks',
  'student_subject_choices',
  'exam_components',
  'exam_template_components',
  'exam_templates',
  'exam_schedules',
  'exams',
  'grading_bands',
  'grading_scales',
  'push_subscriptions',
  // [84.1.1] FKs students, guardians and users, so it goes before them.
  'arrival_notice_subscriptions',
  'attendance_device_events',
  'attendance_records',
  'attendance_sessions',
  'attendance_devices',
  'calendar_feed_tokens',
  'calendar_event_classes',
  'calendar_events',
  'academic_terms',
  'public_holiday_entries',
  'public_holiday_sets',
  'wallet_transactions',
  'student_wallets',
  'payment_allocations',
  'invoice_share_tokens',
  'invoices',
  'payments',
  'discount_rules',
  'student_fees',
  // [38.1.2] `fine_rules` is referenced by `student_fees.fine_rule_id` (must
  // truncate after student_fees) and itself references `fee_structures`
  // (must truncate before it).
  'fine_rules',
  'recurring_schedule_exclusions',
  'recurring_schedule_structures',
  'fee_generations',
  'recurring_schedules',
  'fee_structures',
  'communication_logs',
  'reminder_batches',
  'sms_credit_ledger',
  'sms_credit_balance',
  'student_guardians',
  'guardians',
  'enrollments',
  'class_subjects',
  'teacher_class_sections',
  // [83.1.2] FKs teachers, classes, subjects, users (CASCADE / SET NULL); clears before teachers.
  'coordinator_assignments',
  // [21.2.1] Routine domain — child-first. `routine_slots` FKs to
  // `subjects`/`teachers` (via `routine_slot_teachers`) `ON DELETE CASCADE`,
  // so this whole block must precede both below. `shifts` is deliberately
  // NOT here — `classes.shift_id` (a reference table, below) FKs to it, so
  // it moved to `REFERENCE_TABLES_CHILD_FIRST` instead (once-per-file
  // cadence, positioned after `classes`) to keep the child-first invariant.
  'routine_change_requests',
  'routine_substitutions',
  'routine_slot_teachers',
  'routine_slots',
  'routines',
  'rooms',
  'period_slots',
  'teachers',
  // [36.1.1] Staff attendance/leave — child-first: `leave_records` and
  // `staff_attendance_records` both FK `staff_profiles` (and
  // `staff_attendance_records` also FKs `staff_attendance_sessions`), and
  // `teachers.staff_profile_id` FKs `staff_profiles` too, so `staff_profiles`
  // must clear last of this group (after `teachers`, above).
  'leave_records',
  // [52.1.2] Applications — children first. `leave_records.application_id` FKs
  // `applications`, so they clear after `leave_records`; they FK users,
  // students and staff_profiles, so before those.
  'application_attachments',
  'application_tags',
  'application_events',
  'applications',
  'staff_attendance_records',
  'staff_attendance_sessions',
  'leave_policies',
  'staff_profiles',
  'subjects',
  'audit_logs',
  'students',
  // [13.1.2] only FK is to `users` (reset later, per-file).
  'user_identities',
] as const;

/**
 * `audit_logs` is append-only at the database level: migration
 * `1784175065078-InitialSchema` installs a `BEFORE UPDATE OR DELETE ...
 * FOR EACH ROW` trigger named `trg_audit_logs_write_only` (running the
 * `block_audit_logs_write_only()` function), which
 * `1785749259955-AddTenantIdToAuditLogs` later drops and recreates —
 * grep for both if you need to change it. The trigger raises on
 * every row-level `DELETE`, by design — audit trail rows must never be
 * editable or removable outside a schema migration. `TRUNCATE` doesn't
 * fire row-level triggers (only statement-level `TRUNCATE` triggers,
 * and none is defined here), so it's the only way to clear this one
 * table between tests. Nothing else has a foreign key to `audit_logs`
 * (checked: no `REFERENCES "audit_logs"` in any migration), so this
 * doesn't need `CASCADE`.
 *
 * `wallet_transactions` (16.1.5) is append-only the same way, via
 * `trg_wallet_transactions_write_only` from migration
 * `1789800000000-AddStudentWallets` — same reasoning, same `TRUNCATE`
 * requirement. It has no incoming FKs either.
 */
const WRITE_ONLY_TABLES = new Set<string>(['audit_logs', 'wallet_transactions']);

/**
 * One multi-statement query — one round trip, implicitly transactional
 * (Postgres runs a multi-statement `simple query` message as a single
 * implicit transaction) — child-first so no FK violation fires mid-reset.
 * `DELETE` for ordinary tables (measured ~60x faster than the old
 * per-table `TRUNCATE` loop); `TRUNCATE` only for `audit_logs`, which
 * rejects `DELETE` outright (see `WRITE_ONLY_TABLES` above).
 */
export function buildResetSql(): string {
  const deletes = TRANSACTIONAL_TABLES_CHILD_FIRST.map((t) =>
    WRITE_ONLY_TABLES.has(t) ? `TRUNCATE TABLE "${t}"` : `DELETE FROM "${t}"`,
  );
  // `payments.invoice_id` and `invoices.payment_id` are a genuine FK
  // cycle (16.5.1's B6 unique index made the latter `ON DELETE RESTRICT`,
  // same as `related_invoice_id` — see the migration's doc comment): no
  // child-first table order can satisfy both directions at once. Nulling
  // `payments.invoice_id` first breaks the cycle without touching
  // production's `RESTRICT` semantics — this only runs against the test
  // database's transactional-table reset.
  // [32.1.2] Same for `print_templates.current_version_id` <->
  // `print_template_versions.template_id` (RESTRICT).
  return [
    `UPDATE "payments" SET "invoice_id" = NULL`,
    `UPDATE "print_templates" SET "current_version_id" = NULL`,
    ...deletes,
  ].join('; ');
}

/** Child-first delete order for the six reference tables below. */
export const REFERENCE_TABLES_CHILD_FIRST = [
  'class_sections',
  'classes',
  // [21.2.1] `classes.shift_id` FKs here (`ON DELETE SET NULL`) — must
  // reset after `classes` (child-first) and therefore live in this
  // once-per-file list rather than `TRANSACTIONAL_TABLES_CHILD_FIRST`
  // (see that list's own [21.2.1] comment).
  'shifts',
  'academic_years',
  'auth_tokens',
  'user_tenants',
  'users',
  'schools',
] as const;

/**
 * Reset the six reference tables (`schools`, `users`, `user_tenants`,
 * `academic_years`, `classes`, `class_sections`) to exactly the baseline
 * seed row set, once per spec *file* (called from `setup.ts`'s per-file
 * `beforeAll`, not its per-test `beforeEach`).
 *
 * These used to be reset implicitly, once per file, as a side effect of
 * `dataSource.dropDatabase()` + re-migrate + re-seed running in every
 * file's own `beforeAll`/`afterAll`. Stage 2 (`test/global-setup.ts`)
 * moved that migrate-and-seed cycle to run once per *run* instead of once
 * per *file*, for the ~340ms → ~6ms no-op win described there — but two
 * classes of spec file mutate these six tables directly and relied on
 * that per-file wipe for isolation:
 *
 * - Several e2e specs (e.g. `academic-years.e2e-spec.ts`,
 *   `auth.e2e-spec.ts`) `INSERT` an extra `user_tenants` row for the
 *   seeded admin, to test a second role, and never delete it themselves.
 * - Integration specs that build their own `TypeOrmModule` with
 *   `{ synchronize: true, dropSchema: true }` (e.g.
 *   `students.service.integration.spec.ts`) drop and rebuild the *entire*
 *   schema from entity metadata in their own `beforeAll`, then seed their
 *   own local fixtures into these tables. Note that this is schema-level
 *   damage, not just stray rows — `repairSchemaIfDamaged()` in `setup.ts`
 *   handles the part that re-inserting rows cannot fix.
 *
 * Without a per-file reset, both leak forward into whichever spec file
 * runs next in the same `vitest run` invocation — e.g. a stray extra
 * `user_tenants` row collides with `IDX_user_tenants_user_tenant_role`'s
 * unique constraint the next time some other file inserts the same
 * (user, tenant, role) tuple.
 *
 * This is *not* run per-test (unlike `buildResetSql()` above) because
 * some files intentionally create additional tenants/users in their own
 * `beforeAll` and mutate them across their own tests — e.g.
 * `cross-tenant-access.e2e-spec.ts`. Resetting every test would wipe
 * those out from under the file's own first test.
 *
 * The seed values are interpolated rather than passed as `$n` parameters
 * because Postgres's simple query protocol — the only one that accepts
 * several statements in a single round trip, which is the whole point of
 * building one string here — does not support bind parameters. That is
 * safe only because every interpolated value is a compile-time constant
 * from `test/constants.ts` (UUIDs, a fixed email, a bcrypt hash, none of
 * which contain a quote). Anything caller-supplied must not go in here.
 */
export function buildReferenceResetSql(): string {
  const deletes = REFERENCE_TABLES_CHILD_FIRST.map((t) => `DELETE FROM "${t}"`);
  const inserts = [
    `INSERT INTO schools (id, name, slug, created_at, updated_at)
     VALUES ('${SEED_TENANT_ID}', 'Test School', 'test-school', NOW(), NOW())`,
    `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
     VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_ADMIN_EMAIL}', '${SEED_ADMIN_PASSWORD_HASH}', 'Test Admin', 'ACTIVE', NOW(), NOW())`,
    `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
     VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_TENANT_ID}', 'ADMIN', NOW(), NOW())`,
    `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
     VALUES ('${SEED_ACADEMIC_YEAR_ID}', '2026-2027', '2026-01-01', '2026-12-31', true, '${SEED_TENANT_ID}', NOW(), NOW())`,
    `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
     VALUES ('${SEED_CLASS_1_ID}', 'Class 1', '${SEED_ACADEMIC_YEAR_ID}', '${SEED_TENANT_ID}', NOW(), NOW())`,
    `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
     VALUES ('${SEED_CLASS_2_ID}', 'Class 2', '${SEED_ACADEMIC_YEAR_ID}', '${SEED_TENANT_ID}', NOW(), NOW())`,
    `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
     VALUES ('${SEED_SECTION_1_ID}', 'Section A', '${SEED_CLASS_1_ID}', '${SEED_TENANT_ID}', NOW(), NOW())`,
    `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
     VALUES ('${SEED_SECTION_2_ID}', 'Section B', '${SEED_CLASS_2_ID}', '${SEED_TENANT_ID}', NOW(), NOW())`,
  ];
  return [...deletes, ...inserts].join('; ');
}

/**
 * [Epic 79 / #2793] The reviewed list of columns that may hold personal data, and what
 * `scripts/backup/scrub.sql` does to each one when production data is copied to staging.
 *
 * `staging-scrub.integration.spec.ts` reads the live schema and fails when a column that looks
 * personal (by name or by type) is missing from this list. Adding a column means a human decides:
 *
 *   fake         replaced by a value derived from the row id (no original value survives)
 *   null         set to NULL, or to '[scrubbed]' where the column is NOT NULL
 *   delete-row   the whole table is emptied; column '*' means every column of the table
 *   kept-public  reviewed, and not personal (school-level names, enum-like codes, config)
 *
 * A change here goes with the matching statement in scrub.sql. Reviewers read this file the way
 * they read a permission change.
 */
export type ScrubHandling = 'fake' | 'null' | 'delete-row' | 'kept-public';

export interface ScrubColumn {
  table: string;
  column: string;
  handling: ScrubHandling;
}

const BY_TABLE: Record<string, Partial<Record<ScrubHandling, string[]>>> = {
  // --- people and contacts ---
  users: {
    fake: ['email', 'phone', 'full_name', 'password_hash'],
    null: ['profile_picture_url'],
    'kept-public': ['preferences'],
  },
  guardians: {
    fake: ['full_name', 'phone', 'email', 'alternate_phone', 'address'],
    null: ['occupation'],
    'kept-public': ['relationship'],
  },
  // blood_group and religion are kept: low identifiability without a name or contact (decision
  // taken in the #2793 review, recommended option). date_of_birth moves 1-180 days.
  students: {
    fake: ['full_name', 'home_address', 'father_name', 'mother_name', 'date_of_birth'],
    null: ['full_name_bn', 'birth_reg_no', 'health_notes', 'photo_key'],
    'kept-public': ['registration_number', 'blood_group', 'religion', 'gender'],
  },
  admission_applicants: {
    fake: [
      'applicant_name',
      'guardian_name',
      'guardian_phone',
      'guardian_email',
      'home_address',
      'date_of_birth',
    ],
    null: ['documents'],
    'kept-public': ['reference_number', 'gender', 'status'],
  },
  applications: {
    'kept-public': ['serial_no'],
    fake: ['applicant_name'],
    null: ['letter_text', 'payload', 'granted', 'effect_result'],
  },
  application_events: { null: ['note', 'data'] },
  application_attachments: { fake: ['file_name'], 'kept-public': ['storage_key'] },
  user_identities: { 'delete-row': ['*'] },
  schools: {
    fake: ['phone', 'email', 'address'],
    null: ['status_reason'],
    // `settings` stays, minus every @Secret() path and the SMTP user/from (checked by the spec).
    'kept-public': [
      'settings',
      'name',
      'name_bn',
      'slug',
      'domain',
      'country_code',
      'registration_id',
      'logo_key',
      'status',
      'onboarding',
    ],
  },
  staff_family_members: {
    fake: ['name', 'contact'],
    null: ['occupation'],
    'kept-public': ['relation'],
  },
  staff_addresses: { null: ['district', 'post_office', 'upazila', 'village_street'] },
  staff_hr_records: {
    null: ['name_bn', 'index_no', 'salary_code', 'salary_scale'],
    'kept-public': ['blood_group', 'religion', 'department'],
  },
  staff_achievements: { null: ['description', 'title', 'issued_by'] },
  staff_experience: { null: ['description', 'designation', 'institution'] },
  staff_education: {
    null: ['institution', 'degree', 'board_university', 'result', 'passing_year'],
  },
  staff_training: { null: ['title', 'institution', 'certificate_no'] },
  survey_answers: { null: ['text'] },
  student_public_exams: { null: ['registration_no', 'roll_no'] },
  staff_designation_history: { null: ['notes'] },
  staff_incidents: { null: ['body', 'withdraw_reason'] },
  staff_documents: { fake: ['original_filename'], 'kept-public': ['storage_key'] },
  print_assets: { fake: ['original_name'], 'kept-public': ['storage_key'] },

  // --- tokens, sessions, devices ---
  refresh_tokens: { 'delete-row': ['*'] },
  auth_tokens: { 'delete-row': ['*'] },
  calendar_feed_tokens: { 'delete-row': ['*'] },
  invoice_share_tokens: { 'delete-row': ['*'] },
  push_subscriptions: { 'delete-row': ['*'] },
  attendance_devices: { 'delete-row': ['*'] },
  attendance_device_events: { 'delete-row': ['*'] },
  print_job_items: {
    fake: ['verify_token_hash', 'subject_label'],
    null: ['data_snapshot', 'revoke_reason'],
    'kept-public': ['document_kind', 'subject_type', 'outcome', 'context_type', 'serial_no'],
  },

  // --- messages ---
  communication_logs: {
    null: [
      'message_body',
      'recipient_address',
      'recipient_name',
      'subject',
      'provider_message_id',
      'metadata',
    ],
    'kept-public': ['reference_key'],
  },
  reminder_batches: {
    null: ['message_template'],
    'kept-public': ['batch_name', 'filters_applied'],
  },
  alerts: {
    null: ['manual_body', 'manual_title'],
    fake: ['params'],
    'kept-public': ['manual_audience', 'dedupe_key', 'rule_key', 'action_url'],
  },

  // --- audit (append-only triggers lifted inside the scrub transaction) ---
  audit_logs: {
    null: ['ip_address', 'user_agent', 'old_values', 'new_values'],
    'kept-public': ['entity_type'],
  },
  wallet_transactions: { null: ['note'] },
  invoices: { null: ['notes', 'issuer_snapshot'], fake: ['snapshot'] },
  payments: { null: ['remarks', 'reversal_reason', 'issuer_snapshot', 'transaction_reference'] },
  payment_allocations: { null: ['notes'] },
  student_fees: { null: ['note'] },
  seat_orders: { null: ['receipt_snapshot'] },
  platform_payments: { null: ['raw', 'gateway_ref'] },

  // --- free text about people ---
  admission_evaluations: { null: ['notes'] },
  attendance_records: { null: ['remarks'] },
  leave_records: { null: ['reason'] },
  lesson_deliveries: { null: ['note'] },
  milestone_achievements: { null: ['remark'] },
  promotion_entries: { null: ['override_note'], 'kept-public': ['group_name'] },
  routine_change_requests: { null: ['note', 'resolution_note'] },
  routine_substitutions: { null: ['reason'] },
  student_lifecycle_events: { null: ['reason', 'remark', 'destination'] },
  student_notes: { null: ['body'] },
  homework_submissions: { null: ['attachments'] },
  // Annual confidential reports are written about named staff.
  acr_assessments: { null: ['step1_data', 'step3_data'] },

  // --- reviewed, not personal: names of school things, rule and layout config ---
  recurring_schedule_exclusions: { 'kept-public': ['reason'] },
  teachers: { 'kept-public': ['designations'] },
  grading_bands: { 'kept-public': ['comment'] },
  academic_terms: { 'kept-public': ['name'] },
  designations: { 'kept-public': ['title_bn', 'title_en'] },
  admission_intakes: { 'kept-public': ['required_document_types', 'title'] },
  rooms: { 'kept-public': ['room_no'] },
  surveys: { 'kept-public': ['title'] },
  survey_questions: { 'kept-public': ['text'] },
  attendance_sessions: { 'kept-public': ['period_no'] },
  academic_years: { 'kept-public': ['name'] },
  calendar_events: { 'kept-public': ['name', 'description', 'external_refs'] },
  class_sections: { 'kept-public': ['section_name', 'group_name'] },
  class_subjects: { 'kept-public': ['group_name'] },
  classes: { 'kept-public': ['name'] },
  discount_rules: { 'kept-public': ['fee_types', 'reason'] },
  exam_components: { 'kept-public': ['name'] },
  exam_template_components: { 'kept-public': ['name'] },
  exam_templates: { 'kept-public': ['name'] },
  exams: { 'kept-public': ['name'] },
  fee_generations: { 'kept-public': ['structures'] },
  fee_structures: { 'kept-public': ['name'] },
  fine_rules: { 'kept-public': ['conditions'] },
  grading_scales: { 'kept-public': ['name'] },
  homework: { 'kept-public': ['attachments', 'description', 'title'] },
  period_slots: { 'kept-public': ['name'] },
  print_jobs: { 'kept-public': ['printer_name'] },
  print_template_versions: { 'kept-public': ['definition'] },
  print_templates: { 'kept-public': ['draft', 'name'] },
  printer_profiles: { 'kept-public': ['name'] },
  program_milestones: { 'kept-public': ['name', 'description'] },
  programs: { 'kept-public': ['name', 'description'] },
  promotion_runs: { 'kept-public': ['exam_ids'] },
  // [8.15.9] Report definitions are school configuration (titles, role codes, field keys).
  report_definition_versions: { 'kept-public': ['definition'] },
  report_definitions: { 'kept-public': ['draft', 'name_bn', 'name_en', 'visible_roles'] },
  // Run and schedule params can hold a typed search term; the feedback comment is free text.
  report_runs: { null: ['feedback_comment', 'params'] },
  report_schedules: { null: ['params'], 'kept-public': ['recipient_roles'] },
  public_holiday_entries: { 'kept-public': ['name', 'name_bn'] },
  recurring_schedules: { 'kept-public': ['name', 'audience', 'rule'] },
  routines: { 'kept-public': ['name'] },
  seat_plans: { 'kept-public': ['name'] },
  shifts: { 'kept-public': ['name'] },
  sms_credit_ledger: { 'kept-public': ['reason', 'reference_type'] },
  staff_languages: { 'kept-public': ['language_name'] },
  study_plan_templates: { 'kept-public': ['name', 'lessons'] },
  study_plans: { 'kept-public': ['lessons', 'exam_markers'] },
  subjects: { 'kept-public': ['name_bn', 'name_en'] },
  syllabus_topics: { 'kept-public': ['name', 'description'] },
  // Holds ids such as `ended_by`, no names or contacts.
  user_tenants: { 'kept-public': ['metadata'] },
  workbook_jobs: { 'kept-public': ['row_counts', 'progress'] },
};

export const STAGING_SCRUB_COLUMNS: ScrubColumn[] = Object.entries(BY_TABLE).flatMap(
  ([table, byHandling]) =>
    Object.entries(byHandling).flatMap(([handling, columns]) =>
      columns.map((column) => ({ table, column, handling: handling as ScrubHandling })),
    ),
);

// Types that are never personal text. Everything else is checked against PERSONAL_NAME, so a new
// `guardian_dob date` or `nid bigint` is flagged just like a new varchar.
// Enums are a fixed vocabulary, so they cannot hold free personal text.
const SAFE_TYPES = [/^uuid$/, /^boolean$/, /^timestamp/, /^USER-DEFINED$/];
// Names that suggest personal data. Substring match, case-insensitive.
export const PERSONAL_NAME =
  /(phone|email|name|address|token|secret|password|birth|dob|health|note|contact|otp|totp|mobile|nid|passport|endpoint|p256dh|auth|ip_|user_agent|photo|picture|signature|remark|comment|religion|blood|disab|occupation|father|mother|guardian|relation|bank|salary|hash|street|(^|_)city|district|village|post_?code|url|handle|social|whatsapp|username|reason|description|message|body|filename|text|title|_no$|institution|reference|answer|destination)/i;
// jsonb, arrays and bytea can hold anything, so they are always reviewed.
const STRUCTURED = /^(jsonb?|ARRAY|bytea)$/;

export interface SchemaColumn {
  table_name: string;
  column_name: string;
  data_type: string;
}

/** Columns in `rows` that look personal and are neither in the list nor in an emptied table. */
export function unreviewedColumns(
  rows: SchemaColumn[],
  list: ScrubColumn[] = STAGING_SCRUB_COLUMNS,
) {
  const reviewed = new Set(list.map((c) => `${c.table}.${c.column}`));
  const emptied = new Set(
    list.filter((c) => c.handling === 'delete-row' && c.column === '*').map((c) => c.table),
  );
  return rows
    .filter(
      (r) =>
        STRUCTURED.test(r.data_type) ||
        (!SAFE_TYPES.some((t) => t.test(r.data_type)) && PERSONAL_NAME.test(r.column_name)),
    )
    .filter((r) => !emptied.has(r.table_name) && !reviewed.has(`${r.table_name}.${r.column_name}`))
    .map((r) => `${r.table_name}.${r.column_name}`);
}

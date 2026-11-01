export enum Permission {
  // User Management
  USER_CREATE = 'USER_CREATE',
  USER_READ = 'USER_READ',
  USER_UPDATE = 'USER_UPDATE',
  // [10.4] G17 — no route deletes a user account; account deletion isn't a
  // staff-facing feature yet. Left SUPER_ADMIN-only (via
  // `ROLE_PERMISSIONS[SUPER_ADMIN] = Object.values(Permission)`) rather than
  // granted to ADMIN.
  USER_DELETE = 'USER_DELETE',
  // Removing a member's access to one school (deletes the user_tenants row,
  // not the account) — distinct from USER_DELETE, which no staff role holds.
  MEMBER_REMOVE = 'MEMBER_REMOVE',

  // Student Management
  STUDENT_CREATE = 'STUDENT_CREATE',
  // "May read the student records visible to you" — an *object-scoped*
  // read, not "may read the roster". [5.1] settled this deliberately
  // rather than splitting it into STUDENT_READ/STUDENT_LIST.
  //
  // Which records are visible is the server's decision, in two layers:
  //   - route `@Roles` — `GET /students` (the roster) admits staff only;
  //   - object-level linkage — `GET /students/mine` and `GET /students/:id`
  //     give a PARENT/STUDENT only the students they are linked to, via
  //     `FamilyAccessService` (server/src/modules/students/).
  //
  // So PARENT and STUDENT holding STUDENT_READ is correct and not a
  // client/server disagreement: they hold the read, the server decides the
  // scope. Compare PAYMENT_READ below, which is scoped the same way.
  STUDENT_READ = 'STUDENT_READ',
  STUDENT_UPDATE = 'STUDENT_UPDATE',
  STUDENT_DELETE = 'STUDENT_DELETE',
  STUDENT_BULK_UPLOAD = 'STUDENT_BULK_UPLOAD',
  // Student lifecycle (39.x) — D22.
  STUDENT_LIFECYCLE_MANAGE = 'STUDENT_LIFECYCLE_MANAGE',
  STUDENT_NOTES_READ = 'STUDENT_NOTES_READ',
  /** [47.1.1] D11 — the "My Class" view; TEACHER only. */
  MY_CLASS_VIEW = 'MY_CLASS_VIEW',
  /** [83.0] D9/D25 — Academics › My coordination and `/coordination/*`; TEACHER only, scoped by `coordinator_assignments`. */
  COORDINATION_VIEW = 'COORDINATION_VIEW',
  STUDENT_NOTES_WRITE = 'STUDENT_NOTES_WRITE',
  STUDENT_RECORDS_READ = 'STUDENT_RECORDS_READ',
  STUDENT_RECORDS_WRITE = 'STUDENT_RECORDS_WRITE',

  // Guardian Management
  GUARDIAN_CREATE = 'GUARDIAN_CREATE',
  GUARDIAN_READ = 'GUARDIAN_READ',
  GUARDIAN_UPDATE = 'GUARDIAN_UPDATE',
  // [10.4] G15 — mirrors STUDENT_DELETE. ADMIN only.
  GUARDIAN_DELETE = 'GUARDIAN_DELETE',

  // Fee Management
  FEE_STRUCTURE_CREATE = 'FEE_STRUCTURE_CREATE',
  FEE_STRUCTURE_READ = 'FEE_STRUCTURE_READ',
  FEE_STRUCTURE_UPDATE = 'FEE_STRUCTURE_UPDATE',
  FEE_STRUCTURE_DELETE = 'FEE_STRUCTURE_DELETE',
  FEE_GENERATE = 'FEE_GENERATE',
  FEE_READ = 'FEE_READ',
  FEE_COLLECT = 'FEE_COLLECT',
  // [16.2.1] Approve a pending fee action (manual generation, edit-paid,
  // discount override, ...) gated by the tenant's `settings.fees.approval_mode`.
  // ADMIN only by default — see ROLE_PERMISSIONS comment below.
  FEE_APPROVE = 'FEE_APPROVE',
  // [2639] Ask for a step-up approval token (the two /auth/step-up routes).
  // Held by the staff roles that can trigger a gated action; not FEE_APPROVE,
  // which is ADMIN-only and means "may be the approver".
  STEP_UP_REQUEST = 'STEP_UP_REQUEST',

  // Invoice
  INVOICE_CREATE = 'INVOICE_CREATE',
  INVOICE_READ = 'INVOICE_READ',
  INVOICE_PRINT = 'INVOICE_PRINT',
  // [#3033] Send / share an invoice link. The send/share routes and the
  // client gate both check this permission alone (no @Roles narrowing).
  INVOICE_SEND = 'INVOICE_SEND',
  INVOICE_DELETE = 'INVOICE_DELETE',

  // Payment
  PAYMENT_RECORD = 'PAYMENT_RECORD',
  // The tenant-wide payment ledger — `GET /payments` (ADMIN, ACCOUNTANT
  // only) and the receipts surface the UI gates on it.
  //
  // Deliberately *not* required for per-student payment history:
  // `GET /payments/student/:studentId` admits TEACHER and EXECUTIVE, who
  // hold no PAYMENT_READ, and since [5.1] a linked PARENT/STUDENT too.
  // Per-student history rides on the caller's relationship to that student,
  // not on the ledger permission.
  PAYMENT_READ = 'PAYMENT_READ',
  PAYMENT_REFUND = 'PAYMENT_REFUND',
  // [16.2.1] Reverse a recorded payment (16.x money flow) — ADMIN only by
  // default, same reasoning as FEE_APPROVE: it undoes money already moved.
  PAYMENT_REVERSE = 'PAYMENT_REVERSE',

  // Communication
  COMMUNICATION_SEND = 'COMMUNICATION_SEND',
  COMMUNICATION_BULK_SEND = 'COMMUNICATION_BULK_SEND',
  COMMUNICATION_LOG_READ = 'COMMUNICATION_LOG_READ',
  // [15.6.7] `GET /communications/sms-credits` — a tenant's own SMS credit
  // balance + ledger. Deliberately its own permission, not folded into
  // COMMUNICATION_LOG_READ: the ledger never carries recipient/message
  // data, so it's a narrower disclosure than the communication log is.
  COMMUNICATION_CREDIT_READ = 'COMMUNICATION_CREDIT_READ',

  // Reports
  REPORTS_VIEW = 'REPORTS_VIEW',
  REPORTS_EXPORT = 'REPORTS_EXPORT',
  // [16.2.1] The fees/payments collections report (16.x) — distinct from the
  // general REPORTS_VIEW so a role can see collections without the whole
  // reports surface, and vice versa.
  REPORT_COLLECTIONS_READ = 'REPORT_COLLECTIONS_READ',

  // Dashboard
  DASHBOARD_VIEW = 'DASHBOARD_VIEW',
  DASHBOARD_ADMIN = 'DASHBOARD_ADMIN',
  // [8.10.7] D44 — aggregate-only committee widgets/report; see the COMMITTEE row.
  COMMITTEE_REPORT_READ = 'COMMITTEE_REPORT_READ',

  // Academic Structure
  ACADEMIC_YEAR_MANAGE = 'ACADEMIC_YEAR_MANAGE',
  CLASS_MANAGE = 'CLASS_MANAGE',
  // [10.4] G4 — reference-data read (years/classes/sections/subjects/
  // calendar) every staff screen needs: student form, attendance register,
  // fee wizards, dues filter. ACADEMIC_YEAR_MANAGE/CLASS_MANAGE stay the
  // write gates and the nav gates; this is read-only, granted to all staff.
  ACADEMIC_STRUCTURE_READ = 'ACADEMIC_STRUCTURE_READ',

  // Audit
  AUDIT_LOG_READ = 'AUDIT_LOG_READ',
  // [10.4] G6 — the per-entity Activity tab on detail pages (object-scoped).
  // AUDIT_LOG_READ stays the tenant-wide ledger and the Audit nav gate
  // (ADMIN only, [8.11.10]). Same split as PAYMENT_READ vs per-student
  // payment history.
  AUDIT_ENTITY_HISTORY_READ = 'AUDIT_ENTITY_HISTORY_READ',

  // Settings
  SETTINGS_MANAGE = 'SETTINGS_MANAGE',
  // [35.1.1] Apply a curriculum preset to a fresh tenant — ADMIN only.
  CURRICULUM_PRESET_APPLY = 'CURRICULUM_PRESET_APPLY',
  // [16.2.1] Manage a recurring fee-generation `RecurringSchedule` (16.x).
  SCHEDULE_MANAGE = 'SCHEDULE_MANAGE',
  // [16.2.1] Manage a `DiscountRule` (16.x) — who qualifies for what
  // discount, applied automatically at generation time.
  DISCOUNT_RULE_MANAGE = 'DISCOUNT_RULE_MANAGE',

  // Attendance
  ATTENDANCE_READ = 'ATTENDANCE_READ',
  ATTENDANCE_MARK = 'ATTENDANCE_MARK',
  // [84.1.1] Arrival notices (D15/D16): MANAGE = request/set/clear a notice;
  // LOCK = force a notice always-on / never-on.
  ATTENDANCE_ARRIVAL_NOTICE_MANAGE = 'ATTENDANCE_ARRIVAL_NOTICE_MANAGE',
  ATTENDANCE_ARRIVAL_NOTICE_LOCK = 'ATTENDANCE_ARRIVAL_NOTICE_LOCK',
  // Edit a mark outside the tenant's correction window, or on a
  // non-working day. Object scope (which sections) is still enforced
  // server-side.
  ATTENDANCE_CORRECT = 'ATTENDANCE_CORRECT',
  ATTENDANCE_DEVICE_MANAGE = 'ATTENDANCE_DEVICE_MANAGE',

  // Backup
  // [14.2.1] Export and restore of the school's data workbook. ADMIN and
  // SUPER_ADMIN only — the surface is destructive (a restore overwrites
  // tenant data) and has no partial, role-scoped form. No route consumes
  // this yet; the backup endpoints land later in Epic 14.0 lane 14.2,
  // which is why it is listed in permission-matrix.e2e-spec.ts's
  // UI_ONLY_PERMISSIONS for now.
  BACKUP_MANAGE = 'BACKUP_MANAGE',

  // Calendar
  // [17.1.1] D19 — school calendar (holidays, exams, events, terms). Read
  // is granted to every tenant role; write (create/edit/delete holidays,
  // events, terms, import public holidays) is ADMIN only.
  CALENDAR_READ = 'CALENDAR_READ',
  CALENDAR_MANAGE = 'CALENDAR_MANAGE',

  // Grading
  // [20.1.1] Manage grading scales/bands (percent-to-grade mapping).
  // ADMIN only — no read permission: teachers/executives see scales
  // implicitly through results, not as a standalone list.
  GRADING_SCALE_MANAGE = 'GRADING_SCALE_MANAGE',

  // Exams (19.x)
  // [19.1.1] Create/edit/delete Exam, ExamComponent, ExamSchedule.
  EXAM_MANAGE = 'EXAM_MANAGE',
  // [19.1.1] Write access to the marks-entry grid. Runtime-scoped further
  // for TEACHER by `TeacherClassSection` (19.4.1) — a teacher only sees
  // marks entry for sections/subjects they are assigned to; that narrowing
  // happens in the marks-entry service, not here.
  MARK_ENTER = 'MARK_ENTER',
  // [19.1.1] Read the marks-entry grid (without editing it).
  MARK_VIEW = 'MARK_VIEW',
  // [19.1.1] Run NCTB result computation for an exam (DRAFT → PROCESSED).
  RESULT_PROCESS = 'RESULT_PROCESS',
  // [19.1.1] Publish a processed result (PROCESSED → PUBLISHED), which
  // makes it guardian-visible and can trigger result SMS (19.5.1).
  RESULT_PUBLISH = 'RESULT_PUBLISH',
  // [19.1.1] Read a published (or, for staff, processed) result.
  RESULT_READ = 'RESULT_READ',
  // [25.1.1] Create/edit/publish a SeatPlan and its seat allocations.
  SEAT_PLAN_MANAGE = 'SEAT_PLAN_MANAGE',
  // [32.1.1] Epic 32 D18/D47 — create/edit print templates, assets and printer profiles.
  PRINT_TEMPLATE_MANAGE = 'PRINT_TEMPLATE_MANAGE',
  // [32.1.1] Epic 32 D18/D47 — create and run print jobs (ID cards etc.).
  DOCUMENT_PRINT = 'DOCUMENT_PRINT',
  // [32.1.1] Epic 32 D18/D47 — read print-job history.
  PRINT_HISTORY_READ = 'PRINT_HISTORY_READ',
  // [32.1.1] Epic 32 D18/D47 — revoke an issued document (e.g. a lost card).
  DOCUMENT_REVOKE = 'DOCUMENT_REVOKE',
  // [48.1.01] D6 — issue a student certificate (TC, testimonial, ...). Not held by ACCOUNTANT / EXAM_CONTROLLER.
  CERTIFICATE_ISSUE = 'CERTIFICATE_ISSUE',
  // [26.1.1] Create/edit/run a PromotionRun (D22). ADMIN only — no separate
  // analysis permission; analysis reuses MARK_VIEW.
  PROMOTION_MANAGE = 'PROMOTION_MANAGE',
  // [26.1.1] Commit a run that overrides the suggested outcome for at least
  // one student (D11, D22) — gated behind ApprovalScope.PROMOTION_OVERRIDE.
  PROMOTION_OVERRIDE = 'PROMOTION_OVERRIDE',
  // Routine (class timetable)
  // [21.1.1] Read is granted to every tenant role that has a stake in a
  // published routine (admin, executive, teacher, guardian, student);
  // write (build/edit/publish a routine, its slots, its change requests)
  // is ADMIN only.
  ROUTINE_READ = 'ROUTINE_READ',
  ROUTINE_MANAGE = 'ROUTINE_MANAGE',

  // Homework/Syllabus (22.x)
  // [22.1.1] D26 — read a Homework/HomeworkAssignment/HomeworkSubmission.
  HOMEWORK_READ = 'HOMEWORK_READ',
  // [22.1.1] Create/reassign a HomeworkAssignment.
  HOMEWORK_ASSIGN = 'HOMEWORK_ASSIGN',
  // [22.1.1] Grade a HomeworkSubmission.
  HOMEWORK_GRADE = 'HOMEWORK_GRADE',
  // [22.1.1] CSV bulk-create of HomeworkAssignment rows (D21).
  HOMEWORK_IMPORT = 'HOMEWORK_IMPORT',
  // [22.1.1] Read a SyllabusTopic.
  SYLLABUS_READ = 'SYLLABUS_READ',
  // [22.1.1] Create/edit/mark a SyllabusTopic's status.
  SYLLABUS_MANAGE = 'SYLLABUS_MANAGE',
  // [66.1.01] D28 — create/edit/delete study-plan library templates.
  STUDY_PLAN_TEMPLATE_MANAGE = 'STUDY_PLAN_TEMPLATE_MANAGE',

  // Programs (34.x)
  // [34.1.1] D4 — read a Program/ProgramMilestone/ProgramEnrollment.
  PROGRAM_READ = 'PROGRAM_READ',
  // [34.1.1] D4 — create/edit a Program/ProgramMilestone.
  PROGRAM_MANAGE = 'PROGRAM_MANAGE',
  // [34.1.1] D4 — record a student's progress against a ProgramMilestone.
  PROGRAM_RECORD = 'PROGRAM_RECORD',

  // Admission (27.x)
  // [27.1] Review an AdmissionApplicant — shortlist/admit/reject and read
  // the intake/applicant/evaluation rows. ADMIN and OFFICE_STAFF (D16).
  ADMISSION_REVIEW = 'ADMISSION_REVIEW',
  // Staff HR (23.x)
  // [23.2.1] Read a Designation/StaffHrRecord/StaffDesignationHistory.
  STAFF_HR_READ = 'STAFF_HR_READ',
  // [23.2.1] Create/edit a Designation/StaffHrRecord and promote a staff
  // member's designation — ADMIN only (D9).
  STAFF_HR_MANAGE = 'STAFF_HR_MANAGE',
  // [28.1.1] Read / write ACR assessments, incidents, surveys and the
  // Performance views. ADMIN writes (D6, D8); COMMITTEE also reads (#1358 D16).
  ACR_READ = 'ACR_READ',
  ACR_WRITE = 'ACR_WRITE',

  // Staff Attendance & Leave (36.x)
  // [36.1.1] Read a StaffAttendanceRecord. Every tenant role holds it for
  // their own record; ADMIN/EXECUTIVE additionally get it for all staff
  // (object scope enforced server-side, same split as PAYMENT_READ).
  STAFF_ATTENDANCE_READ = 'STAFF_ATTENDANCE_READ',
  // [36.1.1] Mark a StaffAttendanceRecord. Every tenant role holds it for
  // their own record.
  STAFF_ATTENDANCE_MARK = 'STAFF_ATTENDANCE_MARK',
  // [36.1.1] Approve/reject a LeaveRecord. ADMIN/EXECUTIVE only.
  LEAVE_APPROVE = 'LEAVE_APPROVE',
  // [52.1.1] Applications (D22)
  APPLICATION_SUBMIT = 'APPLICATION_SUBMIT',
  APPLICATION_MANAGE = 'APPLICATION_MANAGE',
  // [67.1.01] Send a manual alert (D32). ADMIN/EXECUTIVE.
  ALERT_SEND = 'ALERT_SEND',
  // [67.1.01] View the alerts report (D33). ADMIN/EXECUTIVE.
  ALERT_REPORT_READ = 'ALERT_REPORT_READ',
}

import { UserRole } from './index';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permission),

  [UserRole.ADMIN]: [
    Permission.STEP_UP_REQUEST,
    // [52.1.1] Applications (D22/D45)
    Permission.APPLICATION_SUBMIT,
    Permission.APPLICATION_MANAGE,
    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.MEMBER_REMOVE,
    Permission.STUDENT_CREATE,
    Permission.STUDENT_READ,
    Permission.STUDENT_UPDATE,
    Permission.STUDENT_DELETE,
    Permission.STUDENT_BULK_UPLOAD,
    Permission.GUARDIAN_CREATE,
    Permission.GUARDIAN_READ,
    Permission.GUARDIAN_UPDATE,
    // [10.4] G15 — mirrors STUDENT_DELETE.
    Permission.GUARDIAN_DELETE,
    Permission.FEE_STRUCTURE_CREATE,
    Permission.FEE_STRUCTURE_READ,
    Permission.FEE_STRUCTURE_UPDATE,
    Permission.FEE_STRUCTURE_DELETE,
    Permission.FEE_GENERATE,
    Permission.FEE_READ,
    Permission.FEE_COLLECT,
    // [16.2.1] Approving fee actions is ADMIN-only by default — the
    // tenant's `settings.fees.approval_mode` gates *how* (OTP vs
    // OTP-or-password), not *who*.
    Permission.FEE_APPROVE,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_READ,
    Permission.INVOICE_PRINT,
    Permission.INVOICE_SEND,
    // [10.4] G17 — reserved for the refunds/void endpoint (#291); no route
    // consumes it yet.
    Permission.INVOICE_DELETE,
    Permission.PAYMENT_RECORD,
    Permission.PAYMENT_READ,
    // [10.4] G17 — reserved for the refunds endpoint (#291); no route
    // consumes it yet.
    Permission.PAYMENT_REFUND,
    // [16.2.1] Reversing a payment undoes money already moved — ADMIN only.
    Permission.PAYMENT_REVERSE,
    Permission.COMMUNICATION_SEND,
    Permission.COMMUNICATION_BULK_SEND,
    Permission.COMMUNICATION_LOG_READ,
    // [15.6.7] SMS credit balance/ledger.
    Permission.COMMUNICATION_CREDIT_READ,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    // [16.2.1] Fees/payments collections report.
    Permission.REPORT_COLLECTIONS_READ,
    Permission.DASHBOARD_VIEW,
    Permission.DASHBOARD_ADMIN,
    Permission.COMMITTEE_REPORT_READ,
    Permission.ACADEMIC_YEAR_MANAGE,
    Permission.CLASS_MANAGE,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    Permission.AUDIT_LOG_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    Permission.SETTINGS_MANAGE,
    Permission.CURRICULUM_PRESET_APPLY,
    // [16.2.1] Recurring fee-generation schedules and discount rules.
    Permission.SCHEDULE_MANAGE,
    Permission.DISCOUNT_RULE_MANAGE,
    Permission.ATTENDANCE_READ,
    Permission.ATTENDANCE_MARK,
    Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE,
    Permission.ATTENDANCE_ARRIVAL_NOTICE_LOCK,
    Permission.ATTENDANCE_CORRECT,
    Permission.ATTENDANCE_DEVICE_MANAGE,
    // [14.2.1] Backup/restore; see enum comment.
    Permission.BACKUP_MANAGE,
    // [17.1.1] School calendar — ADMIN manages, everyone else reads.
    Permission.CALENDAR_READ,
    Permission.CALENDAR_MANAGE,
    // [20.1.1] Grading scales — ADMIN only.
    Permission.GRADING_SCALE_MANAGE,
    // [19.1.1] Exams/marks/results — ADMIN holds all six.
    Permission.EXAM_MANAGE,
    Permission.MARK_ENTER,
    Permission.MARK_VIEW,
    Permission.RESULT_PROCESS,
    Permission.RESULT_PUBLISH,
    Permission.RESULT_READ,
    // [25.1.1] Seat plans — ADMIN only.
    Permission.SEAT_PLAN_MANAGE,
    // [32.1.1] Print module — ADMIN holds all four (D18/D47).
    Permission.PRINT_TEMPLATE_MANAGE,
    Permission.DOCUMENT_PRINT,
    Permission.PRINT_HISTORY_READ,
    Permission.DOCUMENT_REVOKE,
    // [48.1.01] D6
    Permission.CERTIFICATE_ISSUE,
    // [26.1.1] Promotion runs — ADMIN only (D22).
    Permission.PROMOTION_MANAGE,
    Permission.PROMOTION_OVERRIDE,
    // [21.1.1] Class routine — ADMIN builds/publishes, everyone else reads.
    Permission.ROUTINE_READ,
    Permission.ROUTINE_MANAGE,
    // [22.1.1] D26 — ADMIN holds all six homework/syllabus permissions.
    Permission.HOMEWORK_READ,
    Permission.HOMEWORK_ASSIGN,
    Permission.HOMEWORK_GRADE,
    Permission.HOMEWORK_IMPORT,
    Permission.SYLLABUS_READ,
    Permission.SYLLABUS_MANAGE,
    Permission.STUDY_PLAN_TEMPLATE_MANAGE,
    // [34.1.1] D4 — ADMIN holds all three program permissions.
    Permission.PROGRAM_READ,
    Permission.PROGRAM_MANAGE,
    Permission.PROGRAM_RECORD,
    // [27.1] Admission review — also held by OFFICE_STAFF (#1358 D16).
    Permission.ADMISSION_REVIEW,
    // [23.2.1] Staff HR — ADMIN only (D9).
    Permission.STAFF_HR_READ,
    Permission.STAFF_HR_MANAGE,
    // [28.1.1] ACR — ADMIN writes (D6, D8); COMMITTEE also reads (#1358 D16).
    Permission.ACR_READ,
    Permission.ACR_WRITE,
    // [36.1.1] Own record + all-staff read, mark own record, approve leave.
    Permission.STAFF_ATTENDANCE_READ,
    Permission.STAFF_ATTENDANCE_MARK,
    Permission.LEAVE_APPROVE,
    // [67.1.01] Manual alerts + alerts report.
    Permission.ALERT_SEND,
    Permission.ALERT_REPORT_READ,
    // [39.1.1] D22 — student lifecycle, notes, records.
    Permission.STUDENT_LIFECYCLE_MANAGE,
    Permission.STUDENT_NOTES_READ,
    Permission.STUDENT_NOTES_WRITE,
    Permission.STUDENT_RECORDS_READ,
    Permission.STUDENT_RECORDS_WRITE,
  ],

  [UserRole.ACCOUNTANT]: [
    Permission.STEP_UP_REQUEST,
    // [52.1.1] Applications (D22/D45)
    Permission.APPLICATION_SUBMIT,
    Permission.STUDENT_READ,
    // `POST /students/bulk-upload/{validate,commit}` require this permission
    // (PermissionsGuard). Without it the "Import students" button is hidden
    // and the endpoint 403s.
    Permission.STUDENT_BULK_UPLOAD,
    // [10.4] G3 — resolves the "can import 500 but cannot add one by hand"
    // contradiction the map used to flag. ACCOUNTANT is the front-office
    // clerk who does intake; the server has admitted this role on these
    // routes since day one. Visible effect: ACCOUNTANT gains
    // `/students/new`, `/students/:id/edit`, the enrollment tab's edit
    // controls, and guardian edit.
    Permission.STUDENT_CREATE,
    Permission.STUDENT_UPDATE,
    Permission.GUARDIAN_CREATE,
    Permission.GUARDIAN_READ,
    Permission.GUARDIAN_UPDATE,
    Permission.FEE_STRUCTURE_CREATE,
    Permission.FEE_STRUCTURE_READ,
    Permission.FEE_STRUCTURE_UPDATE,
    Permission.FEE_GENERATE,
    Permission.FEE_READ,
    Permission.FEE_COLLECT,
    Permission.INVOICE_CREATE,
    Permission.INVOICE_READ,
    Permission.INVOICE_PRINT,
    Permission.INVOICE_SEND,
    Permission.PAYMENT_RECORD,
    Permission.PAYMENT_READ,
    Permission.COMMUNICATION_SEND,
    Permission.COMMUNICATION_BULK_SEND,
    // [10.4] G5 — the student-detail Communications tab (visible via
    // STUDENT_READ) calls these; no nav item gates on this permission.
    Permission.COMMUNICATION_LOG_READ,
    // [15.6.7] SMS credit balance/ledger.
    Permission.COMMUNICATION_CREDIT_READ,
    Permission.REPORTS_VIEW,
    Permission.REPORTS_EXPORT,
    // [16.2.1] Fees/payments collections report.
    Permission.REPORT_COLLECTIONS_READ,
    Permission.DASHBOARD_VIEW,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    // [16.2.1] Deliberately no FEE_APPROVE, no PAYMENT_REVERSE — those stay
    // ADMIN-only regardless of the tenant's approval_mode.
    Permission.SCHEDULE_MANAGE,
    Permission.DISCOUNT_RULE_MANAGE,
    Permission.ATTENDANCE_READ,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
    // [36.1.1] Own record only — no LEAVE_APPROVE (ADMIN/EXECUTIVE only).
    Permission.STAFF_ATTENDANCE_READ,
    Permission.STAFF_ATTENDANCE_MARK,
    // [32.1.1] Front office prints cards (D18/D47).
    Permission.DOCUMENT_PRINT,
  ],

  [UserRole.TEACHER]: [
    // [52.1.1] Applications (D22/D45)
    Permission.APPLICATION_SUBMIT,
    Permission.MY_CLASS_VIEW,
    // [83.0] D25 — My coordination; empty overview without coordinator rows.
    Permission.COORDINATION_VIEW,
    Permission.STUDENT_READ,
    Permission.GUARDIAN_READ,
    // Deliberately no FEE_STRUCTURE_READ: the fee-structure GETs only need
    // FEE_READ, and granting FEE_STRUCTURE_READ here would surface the whole
    // Finance nav group to teachers — a product decision well outside
    // [8.11.5].
    Permission.FEE_READ,
    // [10.4] G5 — per-student Communications tab; see ACCOUNTANT comment.
    Permission.COMMUNICATION_LOG_READ,
    Permission.DASHBOARD_VIEW,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    Permission.ATTENDANCE_READ,
    Permission.ATTENDANCE_MARK,
    Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
    // [19.1.1] Marks entry (scoped further by TeacherClassSection at
    // runtime, see enum comment) and own-section result reads.
    Permission.MARK_ENTER,
    Permission.MARK_VIEW,
    Permission.RESULT_READ,
    // [21.1.1] Class routine read.
    Permission.ROUTINE_READ,
    // [22.1.1] D26 — TEACHER is the relevant teacher role, holds all six.
    Permission.HOMEWORK_READ,
    Permission.HOMEWORK_ASSIGN,
    Permission.HOMEWORK_GRADE,
    Permission.HOMEWORK_IMPORT,
    Permission.SYLLABUS_READ,
    Permission.SYLLABUS_MANAGE,
    // [34.1.1] D4 — TEACHER records milestone progress but doesn't manage
    // programs/milestones themselves.
    Permission.PROGRAM_READ,
    Permission.PROGRAM_RECORD,
    // [36.1.1] Own record only — no LEAVE_APPROVE (ADMIN/EXECUTIVE only).
    Permission.STAFF_ATTENDANCE_READ,
    Permission.STAFF_ATTENDANCE_MARK,
    // [39.1.1] D22 — teachers read/write notes, read records.
    Permission.STUDENT_NOTES_READ,
    Permission.STUDENT_NOTES_WRITE,
    Permission.STUDENT_RECORDS_READ,
  ],

  // [5.1] added no permissions to either family role. The widened server
  // routes (`/students/mine`, `/fees/dues`, `/fee-structures`,
  // `/payments/student/:id`, `/payments/invoices/student/:id`, `/invoices`,
  // `/invoices/:id`, `/invoices/:id/print`) are all covered by the three
  // reads below — object-scoped, per the STUDENT_READ note above.
  // Deliberately no PAYMENT_READ: that is the tenant-wide ledger.
  //
  // ATTENDANCE_READ is scoped the same way: server decides which student's
  // register a PARENT/STUDENT can see, via FamilyAccessService — same
  // reasoning as STUDENT_READ above.
  [UserRole.PARENT]: [
    // [52.1.1] Applications (D22/D45)
    Permission.APPLICATION_SUBMIT,
    Permission.STUDENT_READ,
    Permission.FEE_READ,
    Permission.INVOICE_READ,
    Permission.ATTENDANCE_READ,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
    // [19.1.1] Guardian-visible published results (D1's spine scope).
    Permission.RESULT_READ,
    // [21.1.1] Class routine read.
    Permission.ROUTINE_READ,
    // [22.1.1] D26 — PARENT/STUDENT get only the two _READ permissions.
    Permission.HOMEWORK_READ,
    Permission.SYLLABUS_READ,
    // [34.1.1] D4 — PARENT/STUDENT get only PROGRAM_READ.
    Permission.PROGRAM_READ,
  ],

  [UserRole.STUDENT]: [
    // [52.1.1] Applications (D22/D45)
    Permission.APPLICATION_SUBMIT,
    Permission.STUDENT_READ,
    Permission.FEE_READ,
    Permission.INVOICE_READ,
    Permission.ATTENDANCE_READ,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
    // [19.1.1] Own published results (D1's spine scope).
    Permission.RESULT_READ,
    // [21.1.1] Class routine read.
    Permission.ROUTINE_READ,
    // [22.1.1] D26 — PARENT/STUDENT get only the two _READ permissions.
    Permission.HOMEWORK_READ,
    Permission.SYLLABUS_READ,
    // [34.1.1] D4 — PARENT/STUDENT get only PROGRAM_READ.
    Permission.PROGRAM_READ,
  ],

  [UserRole.EXECUTIVE]: [
    // [52.1.1] Applications (D22/D45)
    // [84.1.1] Arrival notices (D15). LOCK too (D16): the principal is an EXECUTIVE.
    Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE,
    Permission.ATTENDANCE_ARRIVAL_NOTICE_LOCK,
    Permission.APPLICATION_SUBMIT,
    Permission.APPLICATION_MANAGE,
    Permission.STUDENT_READ,
    // Same reasoning as ACCOUNTANT above — the server route already admits
    // EXECUTIVE, so the UI gate matches it rather than being stricter.
    //
    // [10.4] G12 — still deliberately no GUARDIAN_READ: this role has no
    // surface for viewing guardians (`/guardians` is hidden, guardians are
    // excluded from global search). The corresponding routes are TIGHTENed
    // (EXECUTIVE removed from `@Roles`) rather than granting an unused read.
    Permission.STUDENT_BULK_UPLOAD,
    // Deliberately no FEE_STRUCTURE_* — same call as TEACHER above. The
    // fee-structure GETs only need FEE_READ, but the `/fees` and
    // `/fee-structures` pages are both gated on FEE_STRUCTURE_READ,
    // so granting it here surfaces the whole Finance group to a role whose
    // navigation is deliberately scoped to Students
    // (`e2e/journeys/permissions.spec.ts`'s CASES pin that). Widening it is
    // a product decision, not a mapping fix.
    Permission.FEE_READ,
    Permission.REPORTS_VIEW,
    // [16.2.1] Read-only subset — the collections report, not FEE_APPROVE/
    // FEE_GENERATE/PAYMENT_REVERSE/SCHEDULE_MANAGE/DISCOUNT_RULE_MANAGE.
    Permission.REPORT_COLLECTIONS_READ,
    Permission.DASHBOARD_VIEW,
    Permission.COMMITTEE_REPORT_READ,
    // [10.4] G4 — reference-data read; see enum comment.
    Permission.ACADEMIC_STRUCTURE_READ,
    // [10.4] G5 — per-student Communications tab; see ACCOUNTANT comment.
    Permission.COMMUNICATION_LOG_READ,
    // [10.4] G6 — per-entity Activity tab; see enum comment.
    Permission.AUDIT_ENTITY_HISTORY_READ,
    Permission.ATTENDANCE_READ,
    // [17.1.1] School calendar read.
    Permission.CALENDAR_READ,
    // [19.1.1] Executives see marks/results read-only.
    Permission.MARK_VIEW,
    Permission.RESULT_READ,
    // [21.1.1] Class routine read.
    Permission.ROUTINE_READ,
    // [66.1.01] D9 — executives read every study plan (also #1834 D39).
    Permission.SYLLABUS_READ,
    Permission.STUDY_PLAN_TEMPLATE_MANAGE,
    // [34.1.1] D4/D24 — EXECUTIVE holds all three program permissions.
    Permission.PROGRAM_READ,
    Permission.PROGRAM_MANAGE,
    Permission.PROGRAM_RECORD,
    // [36.1.1] Own record + all-staff read, mark own record, approve leave.
    Permission.STAFF_ATTENDANCE_READ,
    Permission.STAFF_ATTENDANCE_MARK,
    Permission.LEAVE_APPROVE,
    // [67.1.01] Manual alerts + alerts report.
    Permission.ALERT_SEND,
    Permission.ALERT_REPORT_READ,
    // [39.1.1] D22 — student lifecycle, notes, records.
    Permission.STUDENT_LIFECYCLE_MANAGE,
    Permission.STUDENT_NOTES_READ,
    Permission.STUDENT_NOTES_WRITE,
    Permission.STUDENT_RECORDS_READ,
    Permission.STUDENT_RECORDS_WRITE,
    // [32.1.1] Read-only print history (D18/D47).
    Permission.PRINT_HISTORY_READ,
    // [48.1.01] D6 — executives issue certificates.
    Permission.CERTIFICATE_ISSUE,
  ],
  // #1358 office clerk / computer operator: intake, records, communication,
  // printing. No money-moving, no delete, no lifecycle, no settings.
  [UserRole.OFFICE_STAFF]: [
    // [52.1.1] Applications (D22/D45)
    Permission.APPLICATION_SUBMIT,
    Permission.APPLICATION_MANAGE,
    Permission.STUDENT_CREATE,
    Permission.STUDENT_READ,
    Permission.STUDENT_UPDATE,
    Permission.STUDENT_BULK_UPLOAD,
    Permission.STUDENT_RECORDS_READ,
    Permission.STUDENT_RECORDS_WRITE,
    Permission.GUARDIAN_CREATE,
    Permission.GUARDIAN_READ,
    Permission.GUARDIAN_UPDATE,
    Permission.ADMISSION_REVIEW,
    Permission.ACADEMIC_STRUCTURE_READ,
    Permission.ATTENDANCE_READ,
    Permission.CALENDAR_READ,
    Permission.ROUTINE_READ,
    Permission.FEE_READ,
    Permission.INVOICE_READ,
    Permission.COMMUNICATION_SEND,
    Permission.COMMUNICATION_BULK_SEND,
    Permission.COMMUNICATION_LOG_READ,
    Permission.DOCUMENT_PRINT,
    // [48.1.01] D6 — front office issues certificates.
    Permission.CERTIFICATE_ISSUE,
    Permission.PRINT_HISTORY_READ,
    Permission.DASHBOARD_VIEW,
    Permission.RESULT_READ,
    Permission.STAFF_ATTENDANCE_READ,
    Permission.STAFF_ATTENDANCE_MARK,
  ],

  // #1358 exam controller: runs exams, seat plans and results; reads marks
  // but never enters them; prints documents but never edits templates.
  [UserRole.EXAM_CONTROLLER]: [
    Permission.STEP_UP_REQUEST,
    // [52.1.1] Applications (D22/D45)
    Permission.APPLICATION_SUBMIT,
    Permission.EXAM_MANAGE,
    Permission.SEAT_PLAN_MANAGE,
    Permission.MARK_VIEW,
    Permission.RESULT_PROCESS,
    Permission.RESULT_PUBLISH,
    Permission.RESULT_READ,
    Permission.DOCUMENT_PRINT,
    Permission.PRINT_HISTORY_READ,
    Permission.STUDENT_READ,
    Permission.ACADEMIC_STRUCTURE_READ,
    Permission.ATTENDANCE_READ,
    Permission.ROUTINE_READ,
    Permission.CALENDAR_READ,
    Permission.DASHBOARD_VIEW,
    Permission.STAFF_ATTENDANCE_READ,
    Permission.STAFF_ATTENDANCE_MARK,
  ],

  // #1358 school management committee: read-only, no student PII (D9).
  // No REPORT_COLLECTIONS_READ (D16): the collections report and its CSV list
  // a student_name per payment. The aggregate-only report has its own
  // permission, COMMITTEE_REPORT_READ [8.10.7 D44].
  [UserRole.COMMITTEE]: [
    Permission.DASHBOARD_VIEW,
    Permission.COMMITTEE_REPORT_READ,
    Permission.ACR_READ,
    Permission.ACADEMIC_STRUCTURE_READ,
    Permission.CALENDAR_READ,
  ],
};

/** True when `role` holds `permission` in ROLE_PERMISSIONS. Unknown or null roles hold nothing.
 * The own-property check keeps a role string like `'constructor'` or `'toString'` from
 * resolving to an inherited `Object.prototype` value instead of `undefined`. */
export function roleHasPermission(
  role: string | null | undefined,
  permission: Permission,
): boolean {
  if (!role || !Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) return false;
  return ROLE_PERMISSIONS[role as UserRole].includes(permission);
}

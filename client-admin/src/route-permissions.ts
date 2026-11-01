import { Permission } from '@biddaloy/shared';

/**
 * [8.14.17]'s one map: every staff route's TanStack **route ID** (not
 * path — index routes carry a trailing slash, `/_staff/students/`, and
 * `routes/_staff.tsx` wraps this in `RequirePermission` per route match)
 * to the single permission that route needs.
 *
 * The value type is deliberately non-optional (`Permission`, never
 * `undefined`) — "no gate" is not an expressible value here. A route
 * added later without an entry fails `route-permissions.test.ts`'s drift
 * guard rather than silently rendering to everyone.
 *
 * Every route gets **blanket refusal matching nav visibility** — the
 * same permission `_staff.tsx`'s nav item (or, where a route has no nav
 * item of its own, its data) already gates on. No route ships a
 * reduced-but-still-visible read-only view in this ticket: that would
 * require *granting* a permission (e.g. `INVOICE_READ` to `EXECUTIVE`)
 * in `shared/src/enums/permissions.ts`'s `ROLE_PERMISSIONS`, a product
 * decision this client-only ticket does not make. See `docs/architecture
 * /frontend.md`'s route-access section for the full table and that
 * decision's writeup.
 */
export const STAFF_ROUTE_PERMISSIONS: Record<string, Permission> = {
  '/_staff/dashboard': Permission.DASHBOARD_VIEW,
  // [8.14.11]: this is the signed-in user's own session history, not
  // tenant data — `DASHBOARD_VIEW` is the same "any staff role that
  // reaches the shell" baseline `/_staff/dashboard` already uses, not a
  // resource-specific permission this route doesn't need.
  '/_staff/notifications': Permission.DASHBOARD_VIEW,
  // [12.8]: this is the signed-in user's own active-sessions list, not
  // tenant data — same "any staff role" baseline as `/_staff/notifications`.
  '/_staff/security': Permission.DASHBOARD_VIEW,
  '/_staff/students/': Permission.STUDENT_READ,
  '/_staff/students/new': Permission.STUDENT_CREATE,
  '/_staff/students/import': Permission.STUDENT_BULK_UPLOAD,
  // [13.6.1] The first-run setup wizard is the school owner's — the same
  // permission Settings uses (ADMIN-only today).
  '/_staff/welcome': Permission.SETTINGS_MANAGE,
  '/_staff/students/$studentId': Permission.STUDENT_READ,
  '/_staff/students/$studentId_/edit': Permission.STUDENT_UPDATE,
  '/_staff/guardians/': Permission.GUARDIAN_READ,
  '/_staff/guardians/$guardianId': Permission.GUARDIAN_READ,
  // [17.4.2] the staff calendar page — mutations (create/edit/delete/
  // publish) are ADMIN-only server-side (CALENDAR_MANAGE), but
  // the route itself only needs CALENDAR_READ to render, same "blanket
  // refusal matching nav visibility" rule this file documents above.
  '/_staff/calendar/': Permission.CALENDAR_READ,
  // [17.5.3] import/clone/export all write or stage writes — unlike the
  // read-only calendar page above, this route requires CALENDAR_MANAGE
  // outright.
  '/_staff/calendar/import': Permission.CALENDAR_MANAGE,
  '/_staff/staff/': Permission.USER_READ,
  // [13.6.1] Same permission the "Add user" button uses.
  '/_staff/staff/import': Permission.USER_CREATE,
  '/_staff/staff/$userId': Permission.USER_READ,
  // [28.3.2] ACR_READ to view; the form itself gates edits on ACR_WRITE.
  '/_staff/staff/$userId_/acr/$assessmentId': Permission.ACR_READ,
  // [29.0] Teaching-assignments bulk view — gated on CLASS_MANAGE per D5,
  // matching `/_staff/classes/$classId`'s own Teachers tab (the same
  // assign/unassign mutations, just a cross-section view of them).
  '/_staff/staff/teaching-assignments': Permission.CLASS_MANAGE,
  // [28.4.1] Evaluations register — same gate as the ACR form it links to.
  '/_staff/staff/evaluations': Permission.ACR_READ,
  // [52.4.1] Decide rights come from the catalogue, not a route gate.
  '/_staff/applications/': Permission.APPLICATION_SUBMIT,
  '/_staff/applications/new': Permission.APPLICATION_SUBMIT,
  '/_staff/applications/$applicationId': Permission.APPLICATION_SUBMIT,
  '/_staff/applications/reports': Permission.APPLICATION_MANAGE,
  // [28.4.2] One survey's results — same gate as the register it opens from.
  '/_staff/staff/evaluations_/surveys/$surveyId': Permission.ACR_READ,
  '/_staff/programs/': Permission.PROGRAM_READ,
  '/_staff/programs/$programId': Permission.PROGRAM_READ,
  '/_staff/fees/': Permission.FEE_STRUCTURE_READ,
  '/_staff/fees/dues': Permission.FEE_COLLECT,
  '/_staff/fees/generate': Permission.FEE_GENERATE,
  // [16.7.5] recurring schedules — `SCHEDULE_MANAGE` (ADMIN/ACCOUNTANT),
  // the permission `@biddaloy/shared` already defines specifically for
  // managing `RecurringSchedule`, not `FEE_GENERATE`.
  '/_staff/fees/schedules/': Permission.SCHEDULE_MANAGE,
  '/_staff/fees/schedules/$id': Permission.SCHEDULE_MANAGE,
  // [38.4.3] Fines list — read-only gate (FEE_READ), matching "blanket
  // refusal matching nav visibility" above; Log/Generate fines buttons inside
  // the page are separately gated on FEE_GENERATE. The Rules page needs the
  // same permission as its server read (`GET /fees/fine-rules`).
  '/_staff/fees/fines/': Permission.FEE_READ,
  '/_staff/fees/fines/rules': Permission.FEE_STRUCTURE_READ,
  '/_staff/fee-structures/': Permission.FEE_STRUCTURE_READ,
  '/_staff/invoices/': Permission.INVOICE_READ,
  '/_staff/invoices/$invoiceId': Permission.INVOICE_READ,
  // The payments page is still a placeholder (pending payments-1a, which makes it a
  // read-only list); it is gated like that list will be, the same as `/payments/$id`.
  '/_staff/payments/': Permission.PAYMENT_READ,
  '/_staff/payments/record': Permission.PAYMENT_RECORD,
  // [16.6.2] the payment detail page — gated on the read permission, not
  // `PAYMENT_RECORD`, since viewing a past payment's allocations/reversal
  // state is a distinct capability from recording a new one.
  '/_staff/payments/$id': Permission.PAYMENT_READ,
  '/_staff/communications/send': Permission.COMMUNICATION_SEND,
  // [67.5.09] Manual alerts and their report (D32, D33).
  '/_staff/communications/send-alert': Permission.ALERT_SEND,
  '/_staff/reports/alerts': Permission.ALERT_REPORT_READ,
  '/_staff/communications/reminders': Permission.COMMUNICATION_BULK_SEND,
  '/_staff/communications/batches/': Permission.COMMUNICATION_BULK_SEND,
  '/_staff/communications/batches/$batchId': Permission.COMMUNICATION_BULK_SEND,
  '/_staff/communications/message-log/': Permission.COMMUNICATION_BULK_SEND,
  '/_staff/academic-years/': Permission.ACADEMIC_YEAR_MANAGE,
  '/_staff/academic-years/$academicYearId': Permission.ACADEMIC_YEAR_MANAGE,
  '/_staff/classes/': Permission.CLASS_MANAGE,
  '/_staff/classes/$classId': Permission.CLASS_MANAGE,
  // [22.4.1] ADMIN/TEACHER only. EXECUTIVE lacks HOMEWORK_READ
  // (`shared/src/enums/permissions.ts:423+`) despite `15-ux-principles.md`
  // §3.1 listing Homework as `A E T` — a doc/code gap flagged for a
  // product decision, not fixed here.
  '/_staff/academics/homework/': Permission.HOMEWORK_READ,
  '/_staff/academics/homework/new': Permission.HOMEWORK_ASSIGN,
  '/_staff/academics/homework/$homeworkId': Permission.HOMEWORK_READ,
  '/_staff/academics/homework/import': Permission.HOMEWORK_IMPORT,
  '/_staff/academics/syllabus/': Permission.SYLLABUS_READ,
  '/_staff/academics/study-plans/$planId': Permission.SYLLABUS_READ,
  '/_staff/grading-scales/': Permission.GRADING_SCALE_MANAGE,
  '/_staff/grading-scales/$scaleId': Permission.GRADING_SCALE_MANAGE,
  // [27.9] Staff intakes screen — blanket-gated on ADMISSION_REVIEW, same
  // as the rest of this map. Not a route this ticket's own Files list
  // named (`route-permissions.ts`), but without an entry here the route
  // is reachable by every staff role: `route-permissions.test.ts` fails
  // any route missing from this map by design, so it's added anyway.
  '/_staff/admissions/intakes/': Permission.ADMISSION_REVIEW,
  '/_staff/admissions/intakes/$intakeId': Permission.ADMISSION_REVIEW,
  // [27.10] Staff applicants screen — same blanket ADMISSION_REVIEW gate as
  // the intakes screen above.
  '/_staff/admissions/applicants/': Permission.ADMISSION_REVIEW,
  '/_staff/admissions/applicants/$applicantId': Permission.ADMISSION_REVIEW,
  // [39.4.2] Lifecycle report — `STUDENT_LIFECYCLE_MANAGE` (ADMIN, EXECUTIVE; D22).
  '/_staff/admissions/reports/': Permission.STUDENT_LIFECYCLE_MANAGE,
  // [19.6.1] `EXAM_MANAGE` — the management page; see `nav-tree.ts`'s
  // `examsResults.exams` comment (`GET /exams` itself is `MARK_VIEW`, but
  // detail and writes are `EXAM_MANAGE`).
  '/_staff/exams/': Permission.EXAM_MANAGE,
  '/_staff/exams/$examId': Permission.EXAM_MANAGE,
  // [25.6] `SEAT_PLAN_MANAGE` — matches `SeatPlansController`'s own gate
  // (`@RequirePermissions(Permission.SEAT_PLAN_MANAGE)` on every route,
  // `seat-plans.controller.ts`). There is no separate read-only permission.
  // [35.5.1] Exam templates — CRUD is the existing `EXAM_MANAGE` (D36).
  '/_staff/exams/templates/': Permission.EXAM_MANAGE,
  '/_staff/exams/templates/$templateId': Permission.EXAM_MANAGE,
  '/_staff/exams/seat-plans/': Permission.SEAT_PLAN_MANAGE,
  '/_staff/exams/seat-plans/$planId': Permission.SEAT_PLAN_MANAGE,
  // [19.7.1] MARK_VIEW (not MARK_ENTER) — same "seeing is weaker than
  // editing" split `/_staff/attendance/$sectionId` uses above: whether a
  // signed-in teacher may actually save a cell is decided server-side by
  // `MarksAuthorizationService`, not this table.
  '/_staff/marks/': Permission.MARK_VIEW,
  '/_staff/marks/$examId/$sectionId/$subjectId': Permission.MARK_VIEW,
  // [19.8.1] `RESULT_PROCESS` — the whole `/results` route is the
  // process/publish/reopen/SMS console, ADMIN-only the same way
  // `EXAM_MANAGE` gates `/exams` above (both `RESULT_PROCESS` and
  // `RESULT_PUBLISH` are ADMIN-only per `permissions.ts`'s role map, so
  // gating on either would exclude the same set of roles — `RESULT_PROCESS`
  // is picked since it's the first write step in the flow).
  '/_staff/results/': Permission.RESULT_PROCESS,
  '/_staff/results/$examId/$studentId': Permission.RESULT_READ,
  // [26.5.1] `MARK_VIEW` — matches `nav-tree.ts`'s `examsResults.analysis`
  // comment: analysis is read-only, gated the same as `/marks`.
  '/_staff/analysis/': Permission.MARK_VIEW,
  // [26.6.1] D22: PROMOTION_MANAGE (admin).
  '/_staff/promotions/': Permission.PROMOTION_MANAGE,
  '/_staff/promotions/new': Permission.PROMOTION_MANAGE,
  '/_staff/promotions/$runId': Permission.PROMOTION_MANAGE,
  // [21.7.1] Setup screens (shifts, period slots, rooms, routine-wide
  // settings) are all ADMIN-only server-side (`@RequirePermissions
  // (Permission.ROUTINE_MANAGE)` on every write route in
  // `shifts.controller.ts`/`rooms.controller.ts`) — no reduced read-only
  // view offered here, same "blanket refusal matching nav visibility"
  // rule as every other route in this file.
  '/_staff/routines/setup': Permission.ROUTINE_MANAGE,
  // [21.8.1] The grid builder is a write surface (cell save/clear, fill
  // assist), same blanket ADMIN-only gate as setup above — no reduced
  // read-only view of the builder exists.
  '/_staff/routines/': Permission.ROUTINE_MANAGE,
  '/_staff/routines/$sectionId': Permission.ROUTINE_MANAGE,
  // [21.9.1] Review is a shared surface — a teacher only needs
  // `ROUTINE_READ` to see their own slots and raise a change request
  // (`ChangeRequestsController.open` is gated on `ROUTINE_READ`
  // server-side too); the page itself narrows further by role, same
  // "blanket route gate, finer-grained UI inside" pattern `$sectionId`
  // uses for its own write actions.
  '/_staff/routines/review': Permission.ROUTINE_READ,
  // [21.10.1] The teacher/family agenda — same `ROUTINE_READ` gate as
  // review above, this route never writes anything.
  '/_staff/routines/my': Permission.ROUTINE_READ,
  // Substitution log + recorder — `ROUTINE_MANAGE` server-side
  // (`SubstitutionsController`), even for the `TEACHER` role entry in its
  // `@Roles` list.
  '/_staff/routines/substitutions': Permission.ROUTINE_MANAGE,
  '/_staff/roles/': Permission.USER_READ,
  '/_staff/audit-logs/': Permission.AUDIT_LOG_READ,
  '/_staff/settings': Permission.SETTINGS_MANAGE,
  // [35.5.1] Preset read + apply (D36).
  '/_staff/curriculum-preset': Permission.CURRICULUM_PRESET_APPLY,
  // [9.6] Both gated on ATTENDANCE_READ, not ATTENDANCE_MARK — this table
  // (like the nav item it mirrors) answers "may you see this route", and
  // seeing a register is a strictly weaker ask than changing it. Whether
  // a signed-in teacher may *submit* marks is decided twice, further in:
  // the server's per-register `editable` flag (a finalized/past-window
  // register refuses writes for everyone), and `$sectionId.tsx` hiding
  // its own submit bar when the caller lacks ATTENDANCE_MARK. A route
  // gated on ATTENDANCE_MARK here would also block ATTENDANCE_READ-only
  // roles (a co-ordinator reviewing marks, say) from viewing at all.
  // [47.4.2] Class teacher's own homeroom page — TEACHER only, server-gated
  // the same way (`MY_CLASS_VIEW`).
  '/_staff/my-class/': Permission.MY_CLASS_VIEW,
  '/_staff/my-class/$sectionId': Permission.MY_CLASS_VIEW,
  // [83.4.1] Coordinator's page — TEACHER only, server-gated the same way (`COORDINATION_VIEW`).
  '/_staff/my-coordination/': Permission.COORDINATION_VIEW,
  '/_staff/attendance/': Permission.ATTENDANCE_READ,
  '/_staff/attendance/$sectionId': Permission.ATTENDANCE_READ,
  // [9.10] Same ATTENDANCE_READ gate — the reports/register/flags surfaces
  // are read-only over [9.4]'s summary endpoints, same "may you see it"
  // reasoning as the two entries above, not a new permission.
  '/_staff/attendance/reports': Permission.ATTENDANCE_READ,
  '/_staff/attendance/register': Permission.ATTENDANCE_READ,
  // [36.4] Staff attendance/leave — READ, not MARK/APPROVE, matching the
  // "may you see this route" reasoning above. The leave page's approve
  // panel gates itself further on `LEAVE_APPROVE` inside the component.
  '/_staff/attendance/staff/': Permission.STAFF_ATTENDANCE_READ,
  '/_staff/attendance/staff/leave': Permission.STAFF_ATTENDANCE_READ,
  // [16.6.4] Cash-close sheet — matches `GET /reports/collections`'s own
  // `REPORT_COLLECTIONS_READ` gate (ADMIN/ACCOUNTANT/EXECUTIVE in
  // `ROLE_PERMISSIONS`), not the broader `REPORTS_VIEW`.
  '/_staff/reports/collections': Permission.REPORT_COLLECTIONS_READ,
  // [32.4.1] Print module: templates, preview (printing itself) and history.
  '/_staff/print-templates/': Permission.PRINT_TEMPLATE_MANAGE,
  '/_staff/print-templates/$templateId/edit': Permission.PRINT_TEMPLATE_MANAGE,
  '/_staff/print/preview': Permission.DOCUMENT_PRINT,
  '/_staff/print/committee-report': Permission.COMMITTEE_REPORT_READ,
  '/_staff/print/document': Permission.DOCUMENT_PRINT,
  '/_staff/reports/printables': Permission.PRINT_HISTORY_READ,
};

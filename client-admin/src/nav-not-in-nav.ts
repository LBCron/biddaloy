/**
 * [30.1.5] The allowlist for `nav-tree.test.ts`'s Direction A guard: every
 * leaf route in `routeTree.gen.ts` must either resolve through
 * `STAFF_NAV_GROUPS`/`STAFF_NAV_ITEMS`, or have a one-line reason here for
 * why it legitimately has no sidebar home. Copies
 * `registry.completeness.spec.ts`'s "reason required" convention
 * (`server/src/modules/workbook/codec/registry.ts`'s `excluded`) — a typo'd
 * route id here would silently mean "we don't need this in the sidebar,"
 * the same failure mode `route-permissions.test.ts` closes for permissions.
 *
 * Keyed by the route's `id` in `router.routesById` (the same id
 * `route-permissions.test.ts` uses), not by URL path.
 */
export const NOT_IN_NAV: Record<string, string> = {
  // Public/auth routes — reached before a signed-in staff nav ever renders.
  '/': 'root redirect, resolves to /login or /dashboard before any nav renders',
  '/activate': 'auth route reached via an email link, not signed-in nav',
  '/forgot-password': 'auth route reached via a login-page link, not signed-in nav',
  '/login': 'auth route, precedes any signed-in nav',
  '/reset-password': 'auth route reached via an email link, not signed-in nav',
  '/verify-email': 'auth route reached via an email link, not signed-in nav',
  '/register': '[13.6.1] public sign-up card, opened signed-out',
  '/auth/social/done': '[13.6.1] social sign-in landing, redirects at once, no UI',
  '/select-school': 'tenant/role switcher, reached before the staff sidebar itself renders',
  '/i/$token': 'invitation-accept route reached via a tokenized email link, not signed-in nav',
  '/v/$token': "[32.3.9] public verify page opened by scanning an ID card's QR code, signed-out",
  '/admission/$slug/':
    '[27.11] public admission-form route, opened signed-out via a school-specific link',
  '/admission/$slug/status':
    '[27.11] public status-check route, opened signed-out via a school-specific link',

  // Guardian portal — its own nav (`ui`'s portal shell), not the staff
  // sidebar `nav-tree.ts` describes.
  '/portal/': 'guardian portal home, has its own portal nav, not the staff sidebar',
  '/portal/account': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/attendance': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/calendar': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/exam-schedule': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/fees': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/statement': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/programs': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/routine': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/applications/': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/applications/new': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/applications/$applicationId':
    'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/notifications':
    'guardian portal page, reached from the bell and the alerts modal, not the portal nav',
  '/portal/surveys': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/results': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/syllabus': 'guardian portal page, has its own portal nav, not the staff sidebar',
  '/portal/homework': 'guardian portal page, has its own portal nav, not the staff sidebar',

  // Platform admin — its own nav, out of scope for the staff sidebar.
  '/_platform/holiday-sets/': 'platform admin page, has its own nav, not the staff sidebar',
  '/_platform/holiday-sets/$setId': 'platform admin page, has its own nav, not the staff sidebar',
  '/_platform/subscriptions/': 'platform admin page, has its own nav, not the staff sidebar',
  '/_platform/schools/': 'platform admin page, has its own nav, not the staff sidebar',
  '/_platform/schools/$schoolId': 'platform admin page, has its own nav, not the staff sidebar',
  '/_platform/schools/new': 'platform admin page, has its own nav, not the staff sidebar',

  // Staff routes reached from elsewhere in the UI, not their own sidebar item.
  '/_staff/notifications': 'reached from the header notification bell, not the sidebar',
  '/_staff/welcome':
    '[13.6.1] first-run setup wizard, reached by redirect or the palette, not the sidebar',
  '/_staff/security': 'reached from the account menu, not the sidebar',
  '/_staff/academic-years/$academicYearId': 'detail route reached from the academic years list',
  '/_staff/attendance/$sectionId': 'detail route reached from the attendance list',
  '/_staff/attendance/staff/leave':
    '[36.4] reached from the staff attendance page link, palette (Record leave), or the staff detail Attendance & Leave tab, not its own sidebar item',
  '/_staff/calendar/import': 'action reached from the calendar page, not its own nav item',
  '/_staff/classes/$classId': 'detail route reached from the classes list',
  '/_staff/academics/homework/new':
    'action reached from the homework list and the command palette, not its own nav item',
  '/_staff/academics/homework/$homeworkId': 'detail route reached from the homework list',
  '/_staff/academics/study-plans/$planId': 'detail route reached from the study plans tab',
  '/_staff/academics/homework/import':
    'action reached from the homework list and the command palette, not its own nav item',
  '/_staff/applications/new':
    'full-page task opened from the Applications page and the palette, not its own nav item',
  '/_staff/applications/$applicationId': 'detail page reached from a list row',
  '/_staff/exams/$examId': 'detail route reached from the exams list',
  '/_staff/promotions/$runId': 'detail route reached from the promotions list',
  '/_staff/print-templates/$templateId/edit':
    '[32.4.1] full-screen editor, reached from the print templates library',
  '/_staff/print/committee-report':
    '[8.10.7.5.07] chromeless print page, opened from the committee dashboard header and the palette',
  '/_staff/print/preview': "[32.4.1] full-screen print preview, reached from a list's Print action",
  '/_staff/print/document':
    "[48.3.08] chromeless print page, reached from the exam Print tab and a student's Documents tab",
  '/_staff/exams/templates/$templateId': 'detail route reached from the exam templates list',
  '/_staff/exams/seat-plans/$planId': 'detail route reached from the seat plans list',
  '/_staff/marks/$examId/$sectionId/$subjectId':
    'detail route reached from /marks or the exam Progress tab',
  '/_staff/results/$examId/$studentId':
    'report card, reached from the exam Results tab or /results, not its own sidebar item',
  '/_staff/grading-scales/$scaleId': 'detail route reached from the grading scales list',
  '/_staff/admissions/intakes/$intakeId': 'detail route reached from the admission intakes list',
  '/_staff/admissions/applicants/$applicantId':
    'detail route reached from the admission applicants list',
  '/_staff/guardians/$guardianId': 'detail route reached from the guardians list',
  '/_staff/my-class/$sectionId':
    'detail route reached from the My class section picker (or its single-section redirect)',
  '/_staff/routines/$sectionId': 'detail route reached from the routine builder section list',
  '/_staff/invoices/$invoiceId': 'detail route reached from the invoices list',
  '/_staff/fees/':
    '[31.0] D40 — a placeholder today; will redirect to /fees/dues (Student dues, own item), pending fees-1',
  '/_staff/payments/$id': 'detail route reached from the payments list',
  '/_staff/staff/$userId': 'detail route reached from the staff list',
  '/_staff/staff/$userId_/acr/$assessmentId':
    "[28.3.2] ACR form reached from a staff member's ACR history / the register, not its own nav item",
  '/_staff/staff/evaluations_/surveys/$surveyId':
    '[28.4.2] survey results reached from the Surveys tab on /staff/evaluations, not its own nav item',
  '/_staff/reports/$reportId':
    '[8.15.29] a report opened from a card on the Reports hub (/reports)',
  '/_staff/students/$studentId': 'detail route reached from the students list',
  '/_staff/students/$studentId_/edit': 'action reached from the student detail page',
  '/_staff/students/import': 'action reached from the students list, not its own nav item',
  '/_staff/students/new': 'action reached from the students list, not its own nav item',
  '/_staff/promotions/new':
    'action reached from the promotions list or the palette, not its own nav item',
  '/_staff/communications/batches/$batchId': 'detail route reached from the batches list',
  '/_staff/communications/message-log/':
    '[87.SD] message log reached from the dashboard Failed messages / SMS balance widgets, not its own nav item',
  '/_staff/fees/schedules/$id': 'detail route reached from the schedules list',
  '/_staff/fees/fines/rules':
    "[38.4.3] Rules tab reached from the Fines page's own tab bar, not a separate nav item",
  '/_staff/programs/$programId': 'detail route reached from the programs list',
};

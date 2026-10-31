import type { StaffNavLabel } from './nav-tree';

/**
 * [30.3.1]'s one map: every leaf route's TanStack **route ID** (not
 * path — index routes carry a trailing slash, same convention
 * `route-permissions.ts` and `nav-tree.ts`'s `NAV_PATH_TO_ROUTE_ID` use)
 * to the breadcrumb trail shown for that page.
 *
 * A trail is an ordered list of segments, outermost first. A segment
 * reuses `StaffNavLabel` (`{ key }` for a plain i18n string, `{ entity }`
 * for an `EntityLabel` noun resolved via `useEntityLabel`) so a route
 * that already has a nav item can share its exact label rather than
 * inventing a second string for the same thing.
 *
 * `dynamic: 'entity'` marks a segment whose real label the *consumer*
 * fills in once the page's own entity has loaded (e.g. a student's
 * name). Until then (or when there is no name to read) the segment's
 * `label` is the generic noun — never the id.
 *
 * A route with no sensible trail — an auth screen, the root redirect —
 * gets an explicit `null` plus a one-line reason, mirroring
 * `nav-not-in-nav.ts`'s (30.1.5) "reason required" convention for routes
 * that opt out of the nav rather than being missed by accident.
 *
 * This module is pure data: no React, no `useEntityLabel` call, no
 * fetch. `route-crumbs.test.ts` guards it bidirectionally against
 * `routeTree.gen.ts` the same way `route-permissions.test.ts` guards
 * `STAFF_ROUTE_PERMISSIONS` — a route added without a crumb entry (or
 * deleted while its entry lingers) fails the test by name.
 */
export interface CrumbSegment {
  readonly label: StaffNavLabel;
  readonly dynamic?: 'entity';
  /** Explicit link for a non-last segment whose list page needs a search param. */
  readonly to?: string;
}

export type RouteCrumbs = readonly CrumbSegment[];

/** Reason a route has no breadcrumb trail — always non-empty, same
 * discipline `nav-not-in-nav.ts` (30.1.5) uses for `NOT_IN_NAV`. */
export type NoCrumbReason = string;

export const ROUTE_CRUMBS: Record<string, RouteCrumbs | NoCrumbReason> = {
  // --- Auth flow + root: no signed-in shell to show a trail in ---
  '/': 'root redirect, never renders its own page',
  '/login': 'pre-auth screen, no shell',
  '/activate': 'pre-auth screen, no shell',
  '/forgot-password': 'pre-auth screen, no shell',
  '/reset-password': 'pre-auth screen, no shell',
  '/verify-email': 'pre-auth screen, no shell',
  '/register': 'pre-auth screen, no shell',
  '/auth/social/done': 'redirect-only landing, never renders a page',
  '/select-school': 'post-auth, pre-tenant-selection — no tenant nav to trail into yet',
  '/i/$token': 'public invite-accept link, opened signed-out',
  '/v/$token': 'public document-verify page, opened signed-out from a printed QR code',
  '/admission/$slug/': 'public admission form, opened signed-out',
  '/admission/$slug/status': 'public admission status-check page, opened signed-out',

  // --- Guardian portal: tab nav, no breadcrumb chrome ---
  '/portal/': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/account': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/attendance': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/calendar': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/exam-schedule': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/fees': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/statement': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/routine': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/applications/': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/applications/new': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/applications/$applicationId':
    'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/notifications': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/surveys': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/results': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/syllabus': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/homework': 'guardian portal uses bottom tab nav, no breadcrumb chrome',
  '/portal/programs': 'guardian portal uses bottom tab nav, no breadcrumb chrome',

  // --- Platform (SUPER_ADMIN) area ---
  '/_platform/holiday-sets/': [{ label: { key: 'holidaySets' } }],
  '/_platform/holiday-sets/$setId': [
    { label: { key: 'holidaySets' } },
    { label: { key: 'holidaySetDetail' }, dynamic: 'entity' },
  ],
  '/_platform/subscriptions/': [{ label: { key: 'subscriptions' } }],
  '/_platform/schools/': [{ label: { key: 'schools' } }],
  '/_platform/schools/new': [{ label: { key: 'schools' } }, { label: { key: 'new' } }],
  '/_platform/schools/$schoolId': [
    { label: { key: 'schools' } },
    { label: { key: 'schoolDetail' }, dynamic: 'entity' },
  ],

  // --- Staff shell: top-level pages mirror their nav item's own label ---
  '/_staff/dashboard': [{ label: { key: 'dashboard' } }],
  '/_staff/notifications': [{ label: { key: 'notifications' } }],
  '/_staff/security': [{ label: { key: 'security' } }],
  '/_staff/students/': [{ label: { entity: 'student' } }],
  '/_staff/guardians/': [{ label: { entity: 'guardian' } }],
  '/_staff/calendar/': [{ label: { key: 'calendar' } }],
  '/_staff/staff/': [{ label: { entity: 'staff' } }],
  '/_staff/staff/import': [{ label: { entity: 'staff' } }, { label: { key: 'importFromExcel' } }],
  '/_staff/welcome': [{ label: { key: 'welcome' } }],
  '/_staff/staff/teaching-assignments': [
    { label: { entity: 'staff' } },
    { label: { key: 'teachingAssignments' } },
  ],
  '/_staff/staff/evaluations': [{ label: { entity: 'staff' } }, { label: { key: 'evaluations' } }],
  // [28.4.2] Staff › Evaluations (back to the Surveys tab) › the survey's title.
  '/_staff/staff/evaluations_/surveys/$surveyId': [
    { label: { entity: 'staff' } },
    { label: { key: 'evaluations' }, to: '/staff/evaluations?tab=surveys' },
    { label: { key: 'surveyDetail' }, dynamic: 'entity' },
  ],
  '/_staff/programs/': [{ label: { key: 'programs' } }],
  '/_staff/programs/$programId': [
    { label: { key: 'programs' } },
    { label: { key: 'programDetail' }, dynamic: 'entity' },
  ],
  '/_staff/academic-years/': [{ label: { entity: 'academicYear' } }],
  '/_staff/classes/': [{ label: { entity: 'class' } }],
  '/_staff/academics/homework/': [{ label: { key: 'homework' } }],
  '/_staff/academics/homework/new': [{ label: { key: 'homework' } }, { label: { key: 'new' } }],
  '/_staff/academics/homework/$homeworkId': [
    { label: { key: 'homework' } },
    { label: { key: 'homeworkDetail' }, dynamic: 'entity' },
  ],
  '/_staff/academics/homework/import': [
    { label: { key: 'homework' } },
    { label: { key: 'import' } },
  ],
  '/_staff/academics/syllabus/': [{ label: { key: 'syllabus' } }],
  // [66.2] D46: the trail starts at Syllabus, there is no nav-group crumb in this repo.
  '/_staff/academics/study-plans/$planId': [
    { label: { key: 'syllabus' }, to: '/academics/syllabus' },
    { label: { key: 'studyPlans' }, to: '/academics/syllabus?tab=plans' },
    { label: { key: 'studyPlanDetail' }, dynamic: 'entity' },
  ],
  '/_staff/exams/': [{ label: { entity: 'exam' } }],
  // [25.6] Single-level, same as `/_staff/exams/` above — no separate
  // "Exams & Results" segment; that's the nav group label, not part of
  // any sibling route's own crumb trail either.
  '/_staff/exams/templates/': [{ label: { key: 'examTemplates' } }],
  '/_staff/exams/templates/$templateId': [
    { label: { key: 'examTemplates' } },
    { label: { key: 'examTemplateDetail' }, dynamic: 'entity' },
  ],
  '/_staff/exams/seat-plans/': [{ label: { key: 'seatPlans' } }],
  '/_staff/exams/seat-plans/$planId': [
    { label: { key: 'seatPlans' } },
    { label: { key: 'seatPlanDetail' }, dynamic: 'entity' },
  ],
  '/_staff/marks/': [{ label: { key: 'marksEntry' } }],
  '/_staff/results/': [{ label: { key: 'results' } }],
  // [26.5.1] The tab (`?tab=`) isn't a route-tree segment — `ROUTE_CRUMBS`
  // only resolves path params via `dynamic: 'entity'`, not search state —
  // so the trail stops at "Analysis"; the route itself sets
  // `document.title` to `<tab label> · <exam name>` directly.
  '/_staff/analysis/': [{ label: { key: 'analysis' } }],
  '/_staff/promotions/': [{ label: { key: 'promotion' } }],
  '/_staff/promotions/new': [
    { label: { key: 'promotion' } },
    { label: { key: 'promotionNewRun' } },
  ],
  // [26.7.1] A dynamic segment's `label` is the generic noun shown when
  // there is no name to read — `use-breadcrumbs.ts` never shows the id. No
  // `ENTITY_RESOLVERS` entry exists for a promotion run, so it always shows
  // the noun. No `EntityLabel` member exists for a promotion run, so this
  // uses a plain `key` rather than `entity`.
  '/_staff/promotions/$runId': [
    { label: { key: 'promotion' } },
    { label: { key: 'promotionRunDetail' }, dynamic: 'entity' },
  ],
  '/_staff/grading-scales/': [{ label: { key: 'gradingScales' } }],
  '/_staff/admissions/intakes/': [{ label: { key: 'admissionIntakes' } }],
  '/_staff/admissions/applicants/': [{ label: { key: 'admissionApplicants' } }],
  '/_staff/admissions/reports/': [{ label: { key: 'admissionReports' } }],
  '/_staff/routines/setup': [{ label: { key: 'routineSetup' } }],
  '/_staff/routines/': [{ label: { key: 'routineBuilder' } }],
  '/_staff/routines/$sectionId': [
    { label: { key: 'routineBuilder' } },
    { label: { key: 'section' }, dynamic: 'entity' },
  ],
  '/_staff/routines/review': [{ label: { key: 'routineReview' } }],
  '/_staff/routines/substitutions': [{ label: { key: 'routineSubstitutions' } }],
  '/_staff/routines/my': [{ label: { key: 'myRoutine' } }],
  '/_staff/my-class/': [{ label: { key: 'myClass' } }],
  '/_staff/my-class/$sectionId': [
    { label: { key: 'myClass' } },
    { label: { key: 'myClassSection' }, dynamic: 'entity' },
  ],
  '/_staff/attendance/': [{ label: { key: 'attendance' } }],
  '/_staff/attendance/reports': [{ label: { key: 'attendanceReports' } }],
  '/_staff/attendance/register': [{ label: { key: 'attendanceRegister' } }],
  '/_staff/attendance/staff/': [{ label: { key: 'staffAttendance' } }],
  '/_staff/attendance/staff/leave': [
    { label: { key: 'staffAttendance' } },
    { label: { key: 'leave' } },
  ],
  '/_staff/applications/': [{ label: { key: 'applications' } }],
  '/_staff/applications/new': [
    { label: { key: 'applications' } },
    { label: { key: 'newApplication' } },
  ],
  '/_staff/applications/reports': [
    { label: { key: 'applications' } },
    { label: { key: 'applicationsReports' } },
  ],
  '/_staff/applications/$applicationId': [
    { label: { key: 'applications' } },
    { label: { key: 'applicationDetail' }, dynamic: 'entity' },
  ],
  '/_staff/fees/dues': [{ label: { key: 'studentDues' } }],
  '/_staff/payments/record': [{ label: { key: 'recordPayment' } }],
  '/_staff/fees/': [{ label: { key: 'fees' } }],
  '/_staff/fee-structures/': [{ label: { key: 'feeStructures' } }],
  '/_staff/fees/generate': [{ label: { key: 'generateFees' } }],
  '/_staff/fees/schedules/': [{ label: { key: 'recurringSchedules' } }],
  '/_staff/fees/fines/': [{ label: { key: 'fines' } }],
  '/_staff/fees/fines/rules': [{ label: { key: 'fines' } }, { label: { key: 'fineRules' } }],
  '/_staff/invoices/': [{ label: { entity: 'invoice' } }],
  '/_staff/reports/collections': [{ label: { key: 'collectionsReport' } }],
  '/_staff/reports/student-count': [{ label: { key: 'studentCount' } }],
  // [8.15.29] The hub is one crumb (no trail row); a report is "All reports › <its name>".
  '/_staff/reports/': [{ label: { key: 'allReports' } }],
  '/_staff/reports/$reportId': [
    { label: { key: 'allReports' } },
    { label: { key: 'reportDetail' }, dynamic: 'entity' },
  ],
  // [32.4.1] The editor is chromeless (no crumb bar), so this only sets the tab title: the template's name.
  '/_staff/print-templates/': [{ label: { key: 'printTemplates' } }],
  '/_staff/print-templates/$templateId/edit': [
    { label: { key: 'printTemplates' } },
    { label: { key: 'printTemplateEdit' }, dynamic: 'entity' },
  ],
  '/_staff/print/preview': [{ label: { key: 'printPreview' } }],
  '/_staff/print/committee-report': [{ label: { key: 'committeeReport' } }],
  '/_staff/print/document': [{ label: { key: 'printDocument' } }],
  '/_staff/reports/printables': [{ label: { key: 'printables' } }],
  '/_staff/communications/send': [{ label: { key: 'sendMessage' } }],
  '/_staff/communications/send-alert': [{ label: { key: 'sendAlert' } }],
  '/_staff/reports/alerts': [{ label: { key: 'alertsReport' } }],
  '/_staff/communications/reminders': [{ label: { key: 'feeReminders' } }],
  '/_staff/communications/batches/': [{ label: { key: 'reminderHistory' } }],
  '/_staff/communications/message-log/': [{ label: { key: 'messageLog' } }],
  '/_staff/roles/': [{ label: { key: 'rolesAccess' } }],
  '/_staff/audit-logs/': [{ label: { key: 'auditLogs' } }],
  '/_staff/settings': [{ label: { key: 'settings' } }],
  '/_staff/curriculum-preset': [{ label: { key: 'curriculumPreset' } }],

  // --- Staff shell: sub-pages nest under their list route's segment ---
  '/_staff/students/new': [{ label: { entity: 'student' } }, { label: { key: 'new' } }],
  '/_staff/students/import': [{ label: { entity: 'student' } }, { label: { key: 'import' } }],
  '/_staff/students/$studentId': [
    { label: { entity: 'student' } },
    { label: { entity: 'student' }, dynamic: 'entity' },
  ],
  '/_staff/students/$studentId_/edit': [
    { label: { entity: 'student' } },
    { label: { entity: 'student' }, dynamic: 'entity' },
    { label: { key: 'edit' } },
  ],
  '/_staff/guardians/$guardianId': [
    { label: { entity: 'guardian' } },
    { label: { entity: 'guardian' }, dynamic: 'entity' },
  ],
  '/_staff/calendar/import': [{ label: { key: 'calendar' } }, { label: { key: 'import' } }],
  '/_staff/staff/$userId': [
    { label: { entity: 'staff' } },
    { label: { entity: 'staff' }, dynamic: 'entity' },
  ],
  // [28.3.2] Staff › name › ACR. One dynamic segment per trail, so the
  // year lives in the page heading / `document.title`, not a crumb.
  '/_staff/staff/$userId_/acr/$assessmentId': [
    { label: { entity: 'staff' } },
    { label: { entity: 'staff' }, dynamic: 'entity' },
    { label: { key: 'acr' } },
  ],
  '/_staff/academic-years/$academicYearId': [
    { label: { entity: 'academicYear' } },
    { label: { entity: 'academicYear' }, dynamic: 'entity' },
  ],
  '/_staff/classes/$classId': [
    { label: { entity: 'class' } },
    { label: { entity: 'class' }, dynamic: 'entity' },
  ],
  '/_staff/exams/$examId': [
    { label: { entity: 'exam' } },
    { label: { entity: 'exam' }, dynamic: 'entity' },
  ],
  '/_staff/marks/$examId/$sectionId/$subjectId': [
    { label: { key: 'marksEntry' } },
    // Static: three ids cannot feed one resolver; the page h1 names section and subject.
    { label: { key: 'marksEntryGrid' } },
  ],
  '/_staff/results/$examId/$studentId': [
    { label: { key: 'results' } },
    { label: { key: 'reportCard' }, dynamic: 'entity' },
  ],
  '/_staff/grading-scales/$scaleId': [
    { label: { key: 'gradingScales' } },
    { label: { key: 'gradingScaleDetail' }, dynamic: 'entity' },
  ],
  '/_staff/admissions/intakes/$intakeId': [
    { label: { key: 'admissionIntakes' } },
    { label: { key: 'admissionIntakeDetail' }, dynamic: 'entity' },
  ],
  '/_staff/admissions/applicants/$applicantId': [
    { label: { key: 'admissionApplicants' } },
    { label: { key: 'admissionApplicantDetail' }, dynamic: 'entity' },
  ],
  '/_staff/attendance/$sectionId': [
    { label: { key: 'attendance' } },
    { label: { key: 'section' }, dynamic: 'entity' },
  ],
  '/_staff/fees/schedules/$id': [
    { label: { key: 'recurringSchedules' } },
    { label: { key: 'scheduleDetail' }, dynamic: 'entity' },
  ],
  '/_staff/invoices/$invoiceId': [
    { label: { entity: 'invoice' } },
    { label: { entity: 'invoice' }, dynamic: 'entity' },
  ],
  '/_staff/payments/': [{ label: { key: 'payments' } }],
  '/_staff/payments/$id': [
    { label: { key: 'payments' } },
    { label: { key: 'paymentDetail' }, dynamic: 'entity' },
  ],
  '/_staff/communications/batches/$batchId': [
    { label: { key: 'reminderHistory' } },
    { label: { key: 'batchDetail' }, dynamic: 'entity' },
  ],
};

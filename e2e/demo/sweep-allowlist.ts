/**
 * [58.4.02] Console errors the nightly demo sweep tolerates. Every entry needs a reason.
 * Keep it empty unless a message is known and harmless.
 */
export const CONSOLE_ERROR_ALLOWLIST: { pattern: RegExp; reason: string }[] = [];

/**
 * Routes whose error boundary is a known app bug that must not block the nightly swap forever.
 * `path` is the manifest path; `roles` are the only roles tolerated (any other role still fails).
 * Each entry names the issue; delete it when the issue is fixed.
 */
export const KNOWN_ISSUES: { path: string; roles: string[]; reason: string }[] = [
  {
    path: '/attendance/staff',
    // EXECUTIVE = principal. Not ADMIN: it holds USER_READ, so a boundary there is a real regression.
    roles: ['EXECUTIVE', 'ACCOUNTANT', 'TEACHER', 'EXAM_CONTROLLER', 'OFFICE_STAFF'],
    reason:
      'principal, accountant, class teacher, exam controller and office staff hold STAFF_ATTENDANCE_READ but not USER_READ; the page loads GET /users (403) and shows the error state. Tracked in #2513.',
  },
  {
    path: '/staff/evaluations/surveys/$surveyId',
    roles: ['COMMITTEE'],
    reason:
      'committee holds ACR_READ (the page) but GET /surveys/:id/results is @Roles(ADMIN, TEACHER), so it returns 403 and the page shows the error state. Same class as #2514.',
  },
];

/**
 * Detail routes the sweep may skip: no list page renders a `<a href="<list>/...">` row link to open,
 * at any seed scale. Any other route skipped fails the run, so an empty or broken list page cannot
 * pass silently.
 */
export const EXPECTED_SKIPS: string[] = [
  // Several params: no single list page to open a row from.
  '/marks/$examId/$sectionId/$subjectId',
  '/results/$examId/$studentId',
  '/staff/$userId/acr/$assessmentId',
  // No list route: plans are listed on the Syllabus page's plans tab, opened by a row action.
  '/academics/study-plans/$planId',
  // Edit is a row action that calls navigate(), not a link.
  '/print-templates/$templateId/edit',
  // "View" is a row action, not a link.
  '/applications/$applicationId',
  // `/my-class` redirects to the section when the teacher has one (the demo class teacher has one).
  '/my-class/$sectionId',
];

/**
 * Manifest routes the sweep never visits, each with the reason. A staff route with no entry in
 * `route-permissions.ts`, no entry here and no public target in the spec fails the run before it
 * starts, so a new route is never dropped without a word.
 */
export const NOT_SWEPT: Record<string, string> = {
  '/': 'redirects to the role home, which the sweep visits',
  '/login': 'signed-out page',
  '/activate': 'signed-out page (needs an emailed token)',
  '/register': 'signed-out page',
  '/auth/social/done': 'signed-out redirect after a social sign-in',
  '/forgot-password': 'signed-out page',
  '/reset-password': 'signed-out page (needs an emailed token)',
  '/verify-email': 'signed-out page (needs an emailed token)',
  '/select-school': 'part of signing in (signIn passes through it)',
  '/schools': 'platform console: no demo card is a SUPER_ADMIN',
  '/schools/$schoolId': 'platform console: no demo card is a SUPER_ADMIN',
  '/schools/new': 'platform console: no demo card is a SUPER_ADMIN',
  '/holiday-sets': 'platform console: no demo card is a SUPER_ADMIN',
  '/holiday-sets/$setId': 'platform console: no demo card is a SUPER_ADMIN',
  '/subscriptions': 'platform console: no demo card is a SUPER_ADMIN',
  '/reports-usage': 'platform console: no demo card is a SUPER_ADMIN',
  '/reports/runs/$runId': 'opened from the link in a report email: no list page links to it',
  '/i/$token': 'the seed stores only the share token hash, so no link can be rebuilt',
  '/v/$token': 'the seed stores only the ID card verify token hash, so no link can be rebuilt',
};

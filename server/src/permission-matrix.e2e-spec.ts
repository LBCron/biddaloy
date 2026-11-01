import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  Permission,
  ROLE_PERMISSIONS,
  roleHasPermission,
  STAFF_ROLES,
  UserRole,
} from '@biddaloy/shared';
import { AppModule } from './app.module';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import { RolesGuard } from './modules/auth/guards/context.guard';
import { ROLES_KEY } from './modules/auth/decorators/roles.decorator';
import { PERMISSIONS_KEY } from './modules/auth/decorators/require-permissions.decorator';
import { AUTHENTICATED_ONLY_KEY } from './modules/auth/decorators/authenticated-only.decorator';
import { REQUIRE_APPROVAL_KEY } from './modules/auth/decorators/require-approval.decorator';
import {
  ALLOWLIST,
  buildFullPath,
  describeGuards,
  RequestMethodName,
} from '@test/helpers/route-path.helper';

/**
 * Regression coverage for [10.3]/[10.4]'s route -> permission mapping (the
 * plan comment on #397's "route -> permission table", resolved by #399).
 * Walks every registered route via DiscoveryService (same machinery as
 * route-guard-coverage), the same way that spec proves the guard stack is
 * present. This spec proves the mapping *declared on* that stack is sound
 * and complete.
 */

const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

interface IdentityScopedEntry {
  controller: string;
  method: string;
  path: string;
  reason: string;
}

/**
 * [10.4] G13, G14 — routes whose authorization is the caller's *identity*
 * (their own JWT `sub`, or a linked guardian row), not a capability check.
 * `ROLE_PERMISSIONS` has nothing to say about "read your own profile" or
 * "list schools you're a super-admin over" — there is no permission that
 * would make sense to grant or withhold here. These are the third valid
 * classification for a `PermissionsGuard` route, alongside "declares
 * `@RequirePermissions`" below.
 */
export const IDENTITY_SCOPED: IdentityScopedEntry[] = [
  {
    controller: 'PortalArrivalSubscriptionsController',
    method: 'GET',
    path: '/portal/arrival-subscriptions',
    reason: '84.2 — guardian reads own linked children only; ids come from the JWT',
  },
  {
    controller: 'PortalArrivalSubscriptionsController',
    method: 'PUT',
    path: '/portal/arrival-subscriptions/:studentId',
    reason: '84.2 — guardian changes own child subscription; 404 unless linked by guardian row',
  },
  {
    controller: 'UserController',
    method: 'GET',
    path: '/users/me',
    reason: '10.4 — self-service: the id comes from the JWT, never the path',
  },
  {
    controller: 'UserController',
    method: 'PATCH',
    path: '/users/me',
    reason: '10.4 — self-service',
  },
  {
    controller: 'UserController',
    method: 'GET',
    path: '/users/me/preferences/notifications',
    reason: '67.5.03 (#2083) — self-service: own push mute, id from the JWT',
  },
  {
    controller: 'UserController',
    method: 'PATCH',
    path: '/users/me/preferences/notifications',
    reason: '67.5.03 (#2083) — self-service: own push mute, id from the JWT',
  },
  {
    controller: 'UserController',
    method: 'POST',
    path: '/users/me/contact-change',
    reason: '12.7 — self-service: changes the caller own email/phone, id from the JWT',
  },
  {
    controller: 'UserController',
    method: 'POST',
    path: '/users/me/contact-change/confirm-phone',
    reason: '12.7 — self-service',
  },
  {
    controller: 'UserController',
    method: 'POST',
    path: '/users/me/leave',
    reason: '13.2.1 — self-service: the caller leaves a school, id from the JWT; staff roles only',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/guardians/mine',
    reason: '10.4 — self-service: ownership comes from the JWT, never a path id',
  },
  {
    controller: 'StudentController',
    method: 'PATCH',
    path: '/guardians/mine',
    reason: '10.4 — self-service',
  },
  {
    controller: 'SchoolsController',
    method: 'GET',
    path: '/schools',
    reason: '10.4 — platform route (SUPER_ADMIN school picker), not tenant-scoped',
  },
  {
    controller: 'ProvisioningController',
    method: 'POST',
    path: '/schools',
    reason:
      '15.4.4 — platform route (SUPER_ADMIN provisions a brand-new school), not tenant-scoped; RolesGuard(SUPER_ADMIN) is the whole check.',
  },
  {
    controller: 'SchoolAdminsController',
    method: 'GET',
    path: '/schools/:id/admins',
    reason: '15.4.6 — platform route (SUPER_ADMIN admin recovery), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolAdminsController',
    method: 'POST',
    path: '/schools/:id/admins',
    reason: '15.4.6 — platform route (SUPER_ADMIN admin recovery), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolAdminsController',
    method: 'POST',
    path: '/schools/:id/admins/:userId/resend-invitation',
    reason: '15.4.6 — platform route (SUPER_ADMIN admin recovery), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolAdminsController',
    method: 'DELETE',
    path: '/schools/:id/admins/:userId/invitation',
    reason: '15.4.6 — platform route (SUPER_ADMIN admin recovery), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolsController',
    method: 'GET',
    path: '/schools/:id/stats',
    reason: '15.4.7 — platform route (SUPER_ADMIN school stats), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolsController',
    method: 'PATCH',
    path: '/schools/:id/status',
    reason:
      '15.4.5 — platform route (SUPER_ADMIN suspend/reactivate), same rationale as GET /schools.',
  },
  {
    controller: 'PlatformBillingController',
    method: 'GET',
    path: '/platform/billing/schools',
    reason:
      "[49 W4] platform route (SUPER_ADMIN lists every school's seats and orders, PlatformSuperAdminGuard), same rationale as GET /schools.",
  },
  {
    controller: 'PlatformBillingController',
    method: 'GET',
    path: '/platform/billing/schools/:id',
    reason:
      "[49 W4] platform route (SUPER_ADMIN reads one school's orders, PlatformSuperAdminGuard), same rationale as GET /schools.",
  },
  {
    controller: 'PlatformBillingController',
    method: 'POST',
    path: '/platform/billing/orders/:id/offline-payment',
    reason:
      '[49 W4] platform route (SUPER_ADMIN records an offline payment, PlatformSuperAdminGuard), same rationale as GET /schools.',
  },
  {
    controller: 'PlatformBillingController',
    method: 'POST',
    path: '/platform/billing/schools/:id/grant',
    reason:
      '[49 W4] platform route (SUPER_ADMIN grants seats, PlatformSuperAdminGuard), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolsController',
    method: 'POST',
    path: '/schools/:id/revive',
    reason:
      '[49.15] platform route (SUPER_ADMIN revives an idle school, PlatformSuperAdminGuard), same rationale as GET /schools.',
  },
  {
    controller: 'OnboardingController',
    method: 'GET',
    path: '/onboarding/status',
    reason:
      "[13.3.3] self-service: the setup checklist of the caller's own active tenant (ADMIN only), never a path id.",
  },
  {
    controller: 'OnboardingController',
    method: 'PATCH',
    path: '/onboarding',
    reason:
      "[13.3.3] self-service: writes only schools.onboarding of the caller's own active tenant (ADMIN only), never a path id.",
  },
  {
    controller: 'AttentionController',
    method: 'GET',
    path: '/attention/summary',
    reason:
      "[67.1.07] self-service: only the caller's own alert_recipients rows (user_id from the JWT) in the active tenant.",
  },
  {
    controller: 'AttentionController',
    method: 'GET',
    path: '/attention/items',
    reason:
      "[67.1.07] self-service: only the caller's own alert_recipients rows (user_id from the JWT) in the active tenant.",
  },
  {
    controller: 'AttentionController',
    method: 'POST',
    path: '/attention/items/seen',
    reason:
      "[67.1.07] self-service: only the caller's own alert_recipients rows (user_id from the JWT) in the active tenant.",
  },
  {
    controller: 'AttentionController',
    method: 'POST',
    path: '/attention/items/:recipientId/hide',
    reason:
      "[67.1.07] self-service: only the caller's own alert_recipients rows (user_id from the JWT) in the active tenant.",
  },
  {
    controller: 'AttentionController',
    method: 'POST',
    path: '/attention/items/:recipientId/snooze',
    reason:
      "[67.1.07] self-service: only the caller's own alert_recipients rows (user_id from the JWT) in the active tenant.",
  },
  {
    controller: 'SchoolProfileController',
    method: 'GET',
    path: '/schools/me/profile',
    reason: "15.5.2 — self-service: always the caller's own active tenant, never a path id.",
  },
  {
    controller: 'SchoolProfileController',
    method: 'PATCH',
    path: '/schools/me/profile',
    reason: '15.5.2 — self-service, same as GET /schools/me/profile.',
  },
  {
    controller: 'SchoolLogoController',
    method: 'GET',
    path: '/schools/:id/logo',
    reason:
      '15.5.4 — membership-scoped, not capability-scoped: any staff role that belongs to :id ' +
      '(or SUPER_ADMIN) may read it — see assertCanReadSchoolLogo. No permission would make ' +
      'sense to grant or withhold here.',
  },
  {
    controller: 'SchoolLogoController',
    method: 'POST',
    path: '/schools/me/logo',
    reason: "15.5.3 — self-service upload, always the caller's own active tenant.",
  },
  {
    controller: 'SchoolLogoController',
    method: 'DELETE',
    path: '/schools/me/logo',
    reason: '15.5.3 — self-service removal, same as POST /schools/me/logo.',
  },
  {
    controller: 'SchoolSmsCreditsController',
    method: 'POST',
    path: '/schools/:id/sms-credits',
    reason:
      '15.6.7/#550 — platform route (SUPER_ADMIN SMS credit grant/adjust), same rationale as GET /schools.',
  },
  {
    controller: 'SchoolSmsCreditsController',
    method: 'GET',
    path: '/schools/:id/sms-credits',
    reason:
      '#570 — platform route (SUPER_ADMIN cross-school SMS credit read), same rationale as the POST on this controller.',
  },
  {
    controller: 'PlatformPresetsController',
    method: 'POST',
    path: '/platform/schools/:id/preset/reset',
    reason:
      '35.2.5 — platform route (SUPER_ADMIN undoes a school preset), same rationale as GET /schools; no new permission, RolesGuard(SUPER_ADMIN) is the whole check.',
  },
  {
    controller: 'PlatformBackupHealthController',
    method: 'GET',
    path: '/platform/backups/health',
    reason:
      '14.12.3/#617 — platform route (SUPER_ADMIN cross-school backup health), same rationale as GET /schools.',
  },
  {
    controller: 'PlatformAttentionHealthController',
    method: 'GET',
    path: '/platform/attention/health',
    reason:
      '[67.1.09] platform route (SUPER_ADMIN reads engine health, no tenant data), same rationale as GET /platform/backups/health.',
  },
  {
    controller: 'PlatformReportUsageController',
    method: 'GET',
    path: '/platform/reports/usage',
    reason:
      '[8.15.45] platform route (SUPER_ADMIN reads report usage counts, aggregates only, no student, guardian or money rows), same rationale as GET /platform/attention/health.',
  },
  {
    controller: 'PlatformAlertsController',
    method: 'GET',
    path: '/platform/alerts',
    reason:
      '[75.34] platform route (SUPER_ADMIN reads open platform alerts, no tenant data), same rationale as GET /platform/attention/health.',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'GET',
    path: '/platform/holiday-sets',
    reason:
      '17.2.4 — platform route (SUPER_ADMIN curates public-holiday sets), no tenant involved.',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'GET',
    path: '/platform/holiday-sets/:id',
    reason:
      '17.2.4 — platform route (SUPER_ADMIN curates public-holiday sets), no tenant involved.',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'POST',
    path: '/platform/holiday-sets/fetch',
    reason:
      '17.2.4 — platform route (SUPER_ADMIN fetches a country/year set from an external source).',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'PUT',
    path: '/platform/holiday-sets/:id/entries',
    reason: '17.2.4 — platform route (SUPER_ADMIN edits set entries).',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'POST',
    path: '/platform/holiday-sets/:id/publish',
    reason: '17.2.4 — platform route (SUPER_ADMIN publishes a set for tenants to import from).',
  },
  {
    controller: 'PublicHolidaysController',
    method: 'POST',
    path: '/platform/holiday-sets/:id/unpublish',
    reason: '17.2.4 — platform route (SUPER_ADMIN unpublishes a set).',
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'GET',
    path: '/me/push/public-key',
    reason:
      '15.7 — self-service: whether push is enabled and the VAPID key to subscribe with, no per-user data.',
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'POST',
    path: '/me/push/subscriptions',
    reason:
      "15.7 — self-service: registers the caller's own browser subscription, id from the JWT.",
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'GET',
    path: '/me/push/subscriptions',
    reason: "15.7 — self-service: lists the caller's own subscriptions, id from the JWT.",
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'DELETE',
    path: '/me/push/subscriptions/:id',
    reason:
      "15.7 — self-service: deletes one of the caller's own subscriptions, ownership checked in the service, not the path.",
  },
  {
    controller: 'PushSubscriptionsController',
    method: 'DELETE',
    path: '/me/push/subscriptions',
    reason: "15.7 — self-service: deletes all of the caller's own subscriptions, id from the JWT.",
  },
  {
    controller: 'LeaveController',
    method: 'GET',
    path: '/leave/balance',
    reason:
      '[36.3] self-or-approver scoped: no separate leave-read permission; the service requires ' +
      "staff_profile_id to be the caller's own user_id (403 otherwise) unless the caller holds " +
      'LEAVE_APPROVE.',
  },
  {
    controller: 'LeaveController',
    method: 'GET',
    path: '/leave/policies',
    reason:
      '[36.3] same rationale — every role can view the tenant quotas; only editing them ' +
      '(PUT /leave/policies/:type) requires LEAVE_APPROVE.',
  },
  {
    controller: 'SurveyRespondController',
    method: 'GET',
    path: '/surveys/mine',
    reason:
      '[28.4.2] self-service: pending pairs come from the JWT sub via FamilyAccessService linkage; PARENT/STUDENT hold no survey permission to grant or withhold',
  },
  {
    controller: 'SurveyRespondController',
    method: 'POST',
    path: '/surveys/:id/respond',
    reason:
      '[28.4.2] identity-scoped: D11 eligibility (caller-linked student taught that exact subject by that teacher, pair in survey_targets) checked in SurveyRespondService',
  },
  {
    controller: 'SurveyResultsController',
    method: 'GET',
    path: '/surveys/:id/results',
    reason:
      '[28.4.2] D2: ACR_READ checked in-service, not via @RequirePermissions, so a TEACHER or target teacher gets 404, never 403',
  },
];

function findIdentityScopedEntry(
  controller: string,
  method: string,
  path: string,
): IdentityScopedEntry | undefined {
  return IDENTITY_SCOPED.find(
    (entry) => entry.controller === controller && entry.method === method && entry.path === path,
  );
}

/**
 * [10.4] D4 — routes where `@Roles` deliberately admits fewer roles than
 * every role holding the required `@RequirePermissions` permission(s) would
 * suggest. Each entry documents *why* the narrowing exists, so the "never
 * tightens" test above stays meaningful: it proves `@Roles` never grants
 * more than the permission map allows, and this proves every place it grants
 * *less* is deliberate, not an oversight.
 */
interface RoleNarrowing {
  controller: string;
  method: string;
  path: string;
  reason: string;
}

export const ROLE_NARROWINGS: RoleNarrowing[] = [
  {
    controller: 'ApplicationsController',
    method: 'GET',
    path: '/applications/tag-options',
    reason: '[52.2.1] D50: tags are staff-only — guardians/students never see the staff list',
  },
  {
    controller: 'ApplicationsController',
    method: 'POST',
    path: '/applications/:id/tags',
    reason: '[52.2.1] D50: tags are staff-only — the portal has no tag step',
  },
  {
    controller: 'HomeworkController',
    method: 'GET',
    path: '/homework',
    reason:
      "[22.3.1] staff bulk listing — although PARENT/STUDENT hold HOMEWORK_READ (for their own child's view, not built by this route), this endpoint is the teacher/admin management list, unscoped by student" +
      ' #1364 OFFICE_STAFF/EXAM_CONTROLLER/COMMITTEE excluded: none holds HOMEWORK_READ.',
  },
  {
    controller: 'HomeworkController',
    method: 'GET',
    path: '/homework/:id',
    reason:
      '[22.3.1] same narrowing as GET /homework' +
      ' #1364 OFFICE_STAFF/EXAM_CONTROLLER/COMMITTEE excluded: none holds HOMEWORK_READ.',
  },
  {
    controller: 'HomeworkController',
    method: 'GET',
    path: '/homework/:id/assignments',
    reason:
      '[#1013] same narrowing as GET /homework/:id — staff assignment rows, not a family view' +
      ' #1364 OFFICE_STAFF/EXAM_CONTROLLER/COMMITTEE excluded: none holds HOMEWORK_READ.',
  },
  {
    controller: 'HomeworkController',
    method: 'GET',
    path: '/students/:studentId/homework',
    reason:
      "[8.10.7.4.14] family view of one linked child's homework — ADMIN/TEACHER also hold HOMEWORK_READ, but staff use the unscoped /homework list; this route is PARENT/STUDENT only and enforces the guardian link (FamilyAccessService.assertLinked)",
  },
  {
    controller: 'HomeworkController',
    method: 'GET',
    path: '/homework/analytics/student/:studentId',
    reason:
      "[22.3.6] staff-only rollup dashboard — although PARENT/STUDENT hold HOMEWORK_READ (for their own child's homework view), this analytics endpoint is the teacher/admin completion/defaulter rollup (D13), not a per-family view" +
      ' #1364 OFFICE_STAFF/EXAM_CONTROLLER/COMMITTEE excluded: none holds HOMEWORK_READ.',
  },
  {
    controller: 'HomeworkController',
    method: 'GET',
    path: '/homework/analytics/section/:sectionId',
    reason:
      '[22.3.6] same narrowing as the student rollup — staff-only analytics' +
      ' #1364 OFFICE_STAFF/EXAM_CONTROLLER/COMMITTEE excluded: none holds HOMEWORK_READ.',
  },
  {
    controller: 'HomeworkController',
    method: 'GET',
    path: '/homework/analytics/class/:classId',
    reason:
      '[22.3.6] same narrowing as the student rollup — staff-only analytics' +
      ' #1364 OFFICE_STAFF/EXAM_CONTROLLER/COMMITTEE excluded: none holds HOMEWORK_READ.',
  },
  {
    controller: 'HomeworkSubmissionController',
    method: 'POST',
    path: '/homework-assignments/:id/submissions',
    reason:
      '[22.3.2] uploading a submission is the STUDENT/PARENT-only self-service action (D26 ownership-scoped) — ADMIN/TEACHER also hold HOMEWORK_READ but grade via PATCH /homework-assignments/:id/submissions (#2899), not this route' +
      ' #1364 OFFICE_STAFF/EXAM_CONTROLLER/COMMITTEE excluded: none holds HOMEWORK_READ.',
  },
  {
    controller: 'HomeworkSubmissionController',
    method: 'GET',
    path: '/homework-assignments/:id/submissions',
    reason:
      '[22.3.2] teacher/admin grid view — although PARENT/STUDENT hold HOMEWORK_READ, this endpoint lists every submission for an assignment, not scoped to one guardian/student' +
      ' #1364 OFFICE_STAFF/EXAM_CONTROLLER/COMMITTEE excluded: none holds HOMEWORK_READ.',
  },
  {
    controller: 'RecurringSchedulesController',
    method: 'GET',
    path: '/fees/schedules',
    reason:
      '[16.7.1] recurring schedule definitions are staff-only, although every role (incl. PARENT/STUDENT) holds FEE_READ — a guardian who can read their own fees has no business seeing the billing-automation config' +
      ' #1364 new roles excluded on purpose: OFFICE_STAFF holds FEE_READ but billing-automation and run history are accountant/admin work (no money-moving); EXAM_CONTROLLER/COMMITTEE lack FEE_READ.',
  },
  {
    controller: 'RecurringSchedulesController',
    method: 'GET',
    path: '/fees/schedules/:id',
    reason:
      '[16.7.1] same narrowing as GET /fees/schedules' +
      ' #1364 new roles excluded on purpose: OFFICE_STAFF holds FEE_READ but billing-automation and run history are accountant/admin work (no money-moving); EXAM_CONTROLLER/COMMITTEE lack FEE_READ.',
  },
  {
    controller: 'RecurringSchedulesController',
    method: 'GET',
    path: '/fees/schedules/:id/preview',
    reason:
      '[16.7.1] same narrowing as GET /fees/schedules' +
      ' #1364 new roles excluded on purpose: OFFICE_STAFF holds FEE_READ but billing-automation and run history are accountant/admin work (no money-moving); EXAM_CONTROLLER/COMMITTEE lack FEE_READ.',
  },
  {
    controller: 'RecurringSchedulesController',
    method: 'GET',
    path: '/students/:id/schedules',
    reason:
      '[16.8.2] now admits PARENT/STUDENT, who get an allow-listed "what will I be billed ' +
      'next" view (FamilyStudentScheduleDto) after a FamilyAccessService linkage check — never ' +
      'the staff billing-automation config. Still narrower than FEE_READ: TEACHER is excluded, ' +
      'since a teacher has no fee-schedule surface at all' +
      ' #1364 new roles excluded on purpose: OFFICE_STAFF holds FEE_READ but billing-automation and run history are accountant/admin work (no money-moving); EXAM_CONTROLLER/COMMITTEE lack FEE_READ.',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/students',
    reason:
      'the roster is staff-only, although every role (incl. PARENT/STUDENT) holds STUDENT_READ' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold STUDENT_READ) joined; COMMITTEE excluded (no student PII).',
  },
  {
    controller: 'FeeController',
    method: 'POST',
    path: '/fees/schedules/run-now',
    reason:
      '[16.7.2] the manual/ops trigger for the fees-daily sweep is deliberately narrower than SCHEDULE_MANAGE (also held by ACCOUNTANT) — running it is an ops action, not routine fee-collection work' +
      ' #1364 new roles excluded: none holds SCHEDULE_MANAGE.',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/students/ids',
    reason:
      "[16.3.3] the audience picker's select-all is staff-only, although every role (incl. PARENT/STUDENT) holds STUDENT_READ — same narrowing as GET /students" +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold STUDENT_READ) joined; COMMITTEE excluded (no student PII).',
  },
  {
    controller: 'StudentController',
    method: 'GET',
    path: '/students/mine',
    reason:
      'family-only — the discovery route for a PARENT/STUDENT is meaningless for staff' +
      ' #1364 unchanged: family-only; no new role is PARENT/STUDENT.',
  },
  {
    controller: 'SearchController',
    method: 'GET',
    path: '/search',
    reason:
      '[30.2.1] staff-only palette query across students/guardians/staff/invoices/payments, same rationale as GET /students and GET /guardians — the object-scoped STUDENT_READ/GUARDIAN_READ/INVOICE_READ/PAYMENT_READ permissions PARENT/STUDENT also hold would otherwise let a guardian search every family in the tenant, not just their own.' +
      " #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold STUDENT_READ) joined; COMMITTEE excluded (no student PII). Per-group results are still decided in SearchService by the caller's own permissions.",
  },
  {
    controller: 'FeeController',
    method: 'GET',
    path: '/fees/dues/flagged',
    reason:
      'staff-only follow-up queue — returns guardian contact details, not exposed to family' +
      ' #1364 OFFICE_STAFF joined (holds FEE_READ; front-office follow-up with guardian contacts); EXAM_CONTROLLER/COMMITTEE lack FEE_READ.' +
      " #1808 TEACHER kept (Epic 75 D2): rows narrowed to the teacher's current-year assigned sections by TeacherScopeService.scopedStudentIds, so guardian contacts never leave those sections.",
  },
  {
    controller: 'FeeController',
    method: 'GET',
    path: '/payments/guardian/:guardianId',
    reason:
      "staff-only aggregate read across a guardian's students" +
      ' #1364 OFFICE_STAFF not admitted here (holds FEE_READ, deliberately not PAYMENT_READ, D16); per-student payment history (GET /payments/student/:id, /payments/invoices/student/:id) still rides on FEE_READ, see #1381. EXAM_CONTROLLER/COMMITTEE lack FEE_READ.',
  },
  {
    controller: 'FeeGenerationsController',
    method: 'GET',
    path: '/fees/generations',
    reason:
      '[16.1.4] staff-only billing-run history — every role holds FEE_READ so a family ' +
      'caller could otherwise see every batch a school has ever run' +
      ' #1364 new roles excluded on purpose: OFFICE_STAFF holds FEE_READ but billing-automation and run history are accountant/admin work (no money-moving); EXAM_CONTROLLER/COMMITTEE lack FEE_READ.',
  },
  {
    controller: 'FeeGenerationsController',
    method: 'GET',
    path: '/fees/generations/:id',
    reason:
      '[16.1.4] staff-only billing-run detail, same reason as the list route' +
      ' #1364 new roles excluded on purpose: OFFICE_STAFF holds FEE_READ but billing-automation and run history are accountant/admin work (no money-moving); EXAM_CONTROLLER/COMMITTEE lack FEE_READ.',
  },
  {
    controller: 'FeeGenerationsController',
    method: 'GET',
    path: '/fees/generations/:id/bills',
    reason:
      '[16.1.4] staff-only: lists every student billed in a run, across families' +
      ' #1364 new roles excluded on purpose: OFFICE_STAFF holds FEE_READ but billing-automation and run history are accountant/admin work (no money-moving); EXAM_CONTROLLER/COMMITTEE lack FEE_READ.',
  },
  {
    controller: 'EnrollmentController',
    method: 'GET',
    path: '/enrollments/student/:studentId',
    reason:
      'staff-only enrollment-history view; family holds STUDENT_READ but has no such page' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold STUDENT_READ) joined; COMMITTEE excluded (no student PII).',
  },
  {
    controller: 'EnrollmentController',
    method: 'GET',
    path: '/enrollments/:studentId/current',
    reason:
      'staff-only "move class" starting point; family holds STUDENT_READ but has no such page' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold STUDENT_READ) joined; COMMITTEE excluded (no student PII).',
  },
  {
    controller: 'AttendanceController',
    method: 'GET',
    path: '/attendance/my-sections',
    reason:
      'staff marking landing screen; family holds ATTENDANCE_READ for the read-only family view, not this route' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold ATTENDANCE_READ) joined; COMMITTEE lacks ATTENDANCE_READ.',
  },
  {
    controller: 'AttendanceController',
    method: 'GET',
    path: '/attendance/sections/:sectionId/register',
    reason:
      'staff register view; family holds ATTENDANCE_READ for their own child, not the section register' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold ATTENDANCE_READ) joined; COMMITTEE lacks ATTENDANCE_READ.',
  },
  {
    controller: 'AttendanceController',
    method: 'GET',
    path: '/attendance/sections/:sectionId/periods',
    reason:
      'staff period list for marking (Epic 41); family holds ATTENDANCE_READ for their own child, not the section periods' +
      ' — same roles as the section register; COMMITTEE lacks ATTENDANCE_READ.',
  },
  {
    controller: 'AttendanceController',
    method: 'GET',
    path: '/attendance/records/:recordId/history',
    reason:
      'staff-only correction history for a mark; not exposed on the family attendance view' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold ATTENDANCE_READ) joined; COMMITTEE lacks ATTENDANCE_READ.',
  },
  {
    controller: 'AttendanceSummaryController',
    method: 'GET',
    path: '/attendance/sections/:sectionId/summary',
    reason:
      'staff-only section summary; family holds ATTENDANCE_READ for their own child only' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold ATTENDANCE_READ) joined; COMMITTEE lacks ATTENDANCE_READ.',
  },
  {
    controller: 'AttendanceSummaryController',
    method: 'GET',
    path: '/attendance/sections/:sectionId/subject-summary',
    reason:
      'staff-only subject-wise section summary (Epic 41); family holds ATTENDANCE_READ for their own child only' +
      ' — same roles as the section summary; COMMITTEE lacks ATTENDANCE_READ.',
  },
  {
    controller: 'AttendanceSummaryController',
    method: 'GET',
    path: '/attendance/sections/:sectionId/register-matrix',
    reason:
      'staff-only section register matrix; family holds ATTENDANCE_READ for their own child only' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold ATTENDANCE_READ) joined; COMMITTEE lacks ATTENDANCE_READ.',
  },
  {
    controller: 'AttendanceSummaryController',
    method: 'GET',
    path: '/attendance/sections/:sectionId/streaks',
    reason:
      'staff-only section streak flags (#1395); family holds ATTENDANCE_READ for their own child only,' +
      ' COMMITTEE lacks ATTENDANCE_READ; OFFICE_STAFF and EXAM_CONTROLLER (both hold it) are included.',
  },
  {
    controller: 'AttendanceSummaryController',
    method: 'GET',
    path: '/attendance/flags/low',
    reason:
      'staff-only low-attendance follow-up queue, not TEACHER-visible and not exposed to family' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold ATTENDANCE_READ) joined; COMMITTEE lacks ATTENDANCE_READ.',
  },
  {
    controller: 'AbsenceNoticeController',
    method: 'POST',
    path: '/attendance/sections/:sectionId/absence-notice/preview',
    reason:
      'school-policy action kept ADMIN-only; ACCOUNTANT holds COMMUNICATION_BULK_SEND for fee reminders, not this' +
      ' #1364 OFFICE_STAFF holds COMMUNICATION_BULK_SEND but stays excluded: school-policy action; EXAM_CONTROLLER/COMMITTEE lack it.',
  },
  {
    controller: 'AbsenceNoticeController',
    method: 'POST',
    path: '/attendance/sections/:sectionId/absence-notice/send',
    reason:
      'school-policy action kept ADMIN-only; ACCOUNTANT holds COMMUNICATION_BULK_SEND for fee reminders, not this' +
      ' #1364 OFFICE_STAFF holds COMMUNICATION_BULK_SEND but stays excluded: school-policy action; EXAM_CONTROLLER/COMMITTEE lack it.',
  },
  {
    controller: 'MarksController',
    method: 'POST',
    path: '/exams/:examId/marks/reopen',
    reason:
      "[19.4.1] D12 — reopening a SUBMITTED grid is deliberately ADMIN-only, although TEACHER also holds MARK_ENTER (which gates entering/submitting marks). A teacher may submit their own grid but must not be able to unlock it again once it's in review — reopening is enforced a second time inside MarkGridService.reopen with an explicit role check, not just this route gate." +
      ' #1364 EXAM_CONTROLLER excluded: it holds MARK_VIEW, never MARK_ENTER, so it cannot reopen (or write) marks.',
  },
  {
    controller: 'ResultsController',
    method: 'GET',
    path: '/exams/:examId/results',
    reason:
      '[19.8.1] This is the staff results-review console (sorting, fail filter, position) — PARENT/STUDENT also hold RESULT_READ, but for `GET /students/:studentId/results` (19.9.1, `StudentResultsController`), not this staff list across every student in the class.' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold RESULT_READ) joined; COMMITTEE lacks RESULT_READ.',
  },
  {
    controller: 'ResultsController',
    method: 'GET',
    path: '/exams/:examId/results/:studentId',
    reason:
      '[19.8.1] Same narrowing as GET /exams/:examId/results.' +
      ' #1364 OFFICE_STAFF and EXAM_CONTROLLER (both hold RESULT_READ) joined; COMMITTEE lacks RESULT_READ.',
  },
  {
    controller: 'ChangeRequestsController',
    method: 'POST',
    path: '/routines/slots/:slotId/change-requests',
    reason:
      "[21.6.1]/[21.9.1] D11 — raising a change request is the requesting teacher's own action against their own published slot; every other ROUTINE_READ holder (ADMIN, PARENT, STUDENT, EXECUTIVE) reads the routine but has no reason to flag one of a teacher's slots for review" +
      " #1364 new roles excluded: raising a change request is the teacher's own action.",
  },
  {
    controller: 'ChangeRequestsController',
    method: 'GET',
    path: '/routines/:id/change-requests/mine',
    reason:
      '[86.3] The requesting teacher reads back their own change requests and the admin reply; the service filters by the token user. Managers use GET /routines/:id/change-requests (ROUTINE_MANAGE), and no other ROUTINE_READ holder raises requests.',
  },
  {
    controller: 'ProgramEnrollmentsController',
    method: 'GET',
    path: '/programs/:id/enrollments',
    reason:
      '[34.2.1] staff-only program roster — although PARENT/STUDENT hold PROGRAM_READ, this is the whole-program enrollment list across every student, not a family view; families use GET /students/:studentId/programs (StudentProgramsController) instead' +
      ' #1364 new roles excluded: none holds PROGRAM_READ.',
  },
];

function findRoleNarrowing(
  controller: string,
  method: string,
  path: string,
): RoleNarrowing | undefined {
  return ROLE_NARROWINGS.find(
    (entry) => entry.controller === controller && entry.method === method && entry.path === path,
  );
}

/**
 * [10.4] D5 — permission values that gate the UI (nav items, dashboard
 * widgets, report buttons) but no server route requires. Nav/page-only
 * gates are legitimate; this list makes which ones exist a deliberate,
 * reviewed choice rather than a silent accumulation.
 */
export const UI_ONLY_PERMISSIONS: Permission[] = [
  // Nav/page gates with no corresponding route check.
  Permission.DASHBOARD_ADMIN,
  // [10.4] G17 — reserved for endpoints that don't exist yet (#291's
  // refund/void work); granted to ADMIN so the value isn't dead weight once
  // that endpoint ships, but nothing consumes it today.
  Permission.INVOICE_DELETE,
  Permission.PAYMENT_REFUND,
  // [10.4] G17 — no route deletes a user account; SUPER_ADMIN-only via
  // Object.values(Permission), never granted to a staff role.
  Permission.USER_DELETE,
  // Pre-existing UI-only gates, unaffected by [10.4]: no route requires
  // these — they gate a button/action inline rather than a whole route
  // (invoice print button, correcting a mark outside the window, collecting
  // a fee).
  Permission.INVOICE_PRINT,
  Permission.ATTENDANCE_CORRECT,
  Permission.FEE_COLLECT,
  // [16.2.1] Plumbing landed ahead of the routes that will require them:
  // PAYMENT_REVERSE now gates `POST /payments/:id/reverse` (16.6.1) and
  // REPORT_COLLECTIONS_READ now gates `GET /reports/collections` and
  // `.../collections.csv` (16.6.2), so both are no longer UI-only —
  // removed from this list. [16.7.1]/[16.7.2]/[16.7.3] SCHEDULE_MANAGE now
  // gates the recurring-schedule management endpoints and
  // `POST /fees/schedules/run-now`; DISCOUNT_RULE_MANAGE now gates the
  // discount-rule CRUD endpoints — also removed from this list.
  // [38.2.5] FEE_STRUCTURE_READ now gates `GET /fees/fine-rules`
  // (FineRulesController) and FEE_APPROVE now gates
  // `POST /fees/fines/:id/waive` (FinesController) — both no longer
  // UI-only, removed from this list.
  // [17.2.1]-[17.2.5] CALENDAR_READ/CALENDAR_MANAGE now gate
  // `/calendar/events`, `/calendar/terms`, `/calendar-settings`, the
  // platform holiday-set routes, and `/calendar/public-holidays/add` —
  // no longer UI-only, removed from this list.
  // [19.1.1] Plumbing landed ahead of the exam/marks/result routes
  // (19.2.1-19.5.1 build the Exam/ExamComponent/marks/result endpoints
  // these will gate). Remove from this list as each route lands.
  // [19.3.1] EXAM_MANAGE now gates ExamsController's create/get/update/
  // delete routes and every ExamComponentsController route — no longer
  // UI-only, removed from this list. ([26.x] `GET /exams`, the read-only
  // list, is on MARK_VIEW so the marks/analysis exam pickers load for
  // teachers and executives.)
  // [19.4.1] MARK_ENTER/MARK_VIEW now gate MarksController's routes —
  // no longer UI-only, removed from this list.
  // [19.5.1] RESULT_PROCESS/RESULT_PUBLISH now gate ResultsController's
  // process/publish/reopen/sms routes — no longer UI-only, removed from
  // this list.
  // [19.8.1] RESULT_READ now gates ResultsController's GET routes (the
  // staff results-review console) — no longer UI-only, removed from this
  // list. The guardian/student-facing portal view is still 19.9.1's job.
  // [22.3.3] HOMEWORK_IMPORT now gates HomeworkBulkUploadController's routes,
  // [22.3.4] SYLLABUS_READ/SYLLABUS_MANAGE now gate SyllabusController's
  // routes — no longer UI-only, removed from this list at wave-3 integration.
  // [27.3]/[27.5] ADMISSION_REVIEW now gates IntakeController's CRUD routes
  // and ApplicantReviewController's evaluate/admit/reject routes — no
  // longer UI-only, removed from this list at wave-2 integration.
  // [26.3.3] Checked in-service, never on a route: `PromotionsService.commit()`
  // requires it only when the run carries overrides (D11). A route-level
  // `@RequirePermissions` would also block override-free commits, which
  // only need PROMOTION_MANAGE.
  Permission.PROMOTION_OVERRIDE,
  // [34.2.1] PROGRAM_RECORD now gates POST /programs/:id/achievements and
  // DELETE /milestone-achievements/:id — no longer UI-only, removed from
  // this list.
  // [52.1.1] Plumbing ahead of the /applications routes. [52.2.1]
  // APPLICATION_SUBMIT now gates POST /applications — removed from this list.
  // [52.3.5] APPLICATION_MANAGE now gates GET /applications/reports — removed.
  // [67.5.01/.04] ALERT_SEND gates /attention/manual and ALERT_REPORT_READ gates /attention/report: no longer UI-only.
];

describe('Permission matrix (regression)', () => {
  let moduleRef: TestingModule;
  let discoveryService: DiscoveryService;
  let metadataScanner: MetadataScanner;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();

    discoveryService = moduleRef.get(DiscoveryService);
    metadataScanner = moduleRef.get(MetadataScanner);
  }, 60000);

  afterAll(async () => {
    await moduleRef.close();
  });

  function walkRoutes(
    visit: (info: {
      controllerName: string;
      methodName: string;
      methodLabel: string;
      fullPath: string;
      roles: UserRole[];
      permissions: Permission[];
      hasPermissionsGuard: boolean;
      guards: unknown[];
      approvalScope: string | undefined;
      authenticatedOnly: boolean;
      handler: (...args: unknown[]) => unknown;
      controllerClass: new (...args: never[]) => unknown;
    }) => void,
    // Default: PermissionsGuard routes only. `includeRolesGuardOnly` also visits routes guarded
    // by RolesGuard without PermissionsGuard, so a mirrored @Roles there cannot hide (#1357).
    // `includeEveryRoute` skips the guard filter entirely (route → permission snapshot).
    {
      includeRolesGuardOnly = false,
      includeEveryRoute = false,
    }: { includeRolesGuardOnly?: boolean; includeEveryRoute?: boolean } = {},
  ) {
    const controllers = discoveryService.getControllers();

    for (const wrapper of controllers) {
      const { metatype } = wrapper;
      if (!metatype) continue;

      const controllerName = metatype.name;
      const controllerPrefix: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
      const classRoles: UserRole[] = Reflect.getMetadata(ROLES_KEY, metatype) ?? [];
      const classPermissions: Permission[] = Reflect.getMetadata(PERMISSIONS_KEY, metatype) ?? [];
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];
      const prototype = metatype.prototype;

      for (const methodName of metadataScanner.getAllMethodNames(prototype)) {
        const handler = prototype[methodName];
        const httpMethod: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (httpMethod === undefined) continue;

        const routePath: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
        const allGuards = [...classGuards, ...methodGuards];
        const hasPermissionsGuard = allGuards.includes(PermissionsGuard);
        if (
          !includeEveryRoute &&
          !hasPermissionsGuard &&
          !(includeRolesGuardOnly && allGuards.includes(RolesGuard))
        ) {
          continue;
        }

        // getAllAndOverride semantics: handler metadata wins if present.
        const handlerRoles: UserRole[] | undefined = Reflect.getMetadata(ROLES_KEY, handler);
        const roles = handlerRoles ?? classRoles;
        const handlerPermissions: Permission[] | undefined = Reflect.getMetadata(
          PERMISSIONS_KEY,
          handler,
        );
        const permissions = handlerPermissions ?? classPermissions;

        const fullPath = buildFullPath(controllerPrefix, routePath);
        const methodLabel = RequestMethodName(httpMethod);

        visit({
          controllerName,
          methodName,
          methodLabel,
          fullPath,
          roles,
          permissions,
          hasPermissionsGuard,
          guards: allGuards,
          approvalScope:
            Reflect.getMetadata(REQUIRE_APPROVAL_KEY, handler) ??
            Reflect.getMetadata(REQUIRE_APPROVAL_KEY, metatype),
          authenticatedOnly:
            Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, handler) ??
            Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, metatype) ??
            false,
          handler,
          controllerClass: metatype as new (...args: never[]) => unknown,
        });
      }
    }
  }

  // The committed file lists every HTTP route and what protects it. A diff in it is a permission
  // change: review it like one. After adding or changing a route, regenerate it with
  // `yarn test:file src/permission-matrix.e2e-spec.ts -u` and commit the result.
  it('[68] matches the committed route → permission snapshot', async () => {
    const lines: string[] = [];
    const violations: string[] = [];

    walkRoutes(
      ({ controllerName, methodLabel, fullPath, roles, permissions, guards, approvalScope }) => {
        let protection: string;
        if (permissions.length > 0) {
          protection = `perm: ${[...permissions].sort().join(',')}`;
        } else if (findIdentityScopedEntry(controllerName, methodLabel, fullPath)) {
          protection = 'identity';
        } else if (
          ALLOWLIST.some(
            (e) =>
              e.controller === controllerName && e.method === methodLabel && e.path === fullPath,
          )
        ) {
          protection = `allowlist: ${describeGuards(guards)}`;
        } else {
          protection = `UNCLASSIFIED: ${describeGuards(guards)}`;
          violations.push(`${methodLabel} ${fullPath} (${controllerName}) — ${protection}`);
        }
        // roles/approval are recorded for every route (identity and allowlist too), so a
        // @Roles or approval change on those is visible in the diff.
        if (roles.length > 0) protection += ` | roles: ${[...roles].sort().join(',')}`;
        if (approvalScope) protection += ` | approval: ${approvalScope}`;
        lines.push(`${methodLabel} ${fullPath} | ${controllerName} | ${protection}`);
      },
      { includeEveryRoute: true },
    );

    expect(violations).toEqual([]);
    // Default sort = UTF-16 code-unit order: the same on every machine, unlike localeCompare.
    const text = lines.sort().join('\n') + '\n';
    await expect(text).toMatchFileSnapshot('./__snapshots__/route-permissions.txt');
  });

  it('never tightens: every role in @Roles (excluding SUPER_ADMIN) holds every @RequirePermissions permission', () => {
    const violations: string[] = [];

    walkRoutes(({ controllerName, methodName, methodLabel, fullPath, roles, permissions }) => {
      if (permissions.length === 0) return;

      for (const role of roles) {
        if (role === UserRole.SUPER_ADMIN) continue;
        for (const permission of permissions) {
          if (!roleHasPermission(role, permission)) {
            violations.push(
              `${methodLabel} ${fullPath} (${controllerName}.${methodName}) — @Roles admits ` +
                `${role}, which lacks required permission ${permission}`,
            );
          }
        }
      }
    });

    expect(violations).toEqual([]);
  });

  it('[10.4] classifies every PermissionsGuard route as APPLY (@RequirePermissions) or IDENTITY_SCOPED', () => {
    const violations: string[] = [];

    walkRoutes(({ controllerName, methodLabel, fullPath, permissions }) => {
      if (permissions.length > 0) return; // APPLY

      const identityScoped = findIdentityScopedEntry(controllerName, methodLabel, fullPath);
      if (!identityScoped) {
        violations.push(
          `${methodLabel} ${fullPath} (${controllerName}) has no @RequirePermissions and no ` +
            'IDENTITY_SCOPED entry — a new route must declare @RequirePermissions() or be added ' +
            'to IDENTITY_SCOPED with a reason',
        );
      }
    });

    expect(violations).toEqual([]);
  });

  it('[75.7] every IDENTITY_SCOPED route carries @AuthenticatedOnly(), and every @AuthenticatedOnly() route is IDENTITY_SCOPED', () => {
    const violations: string[] = [];

    walkRoutes(
      ({ controllerName, methodLabel, fullPath, permissions, authenticatedOnly }) => {
        const label = `${methodLabel} ${fullPath} (${controllerName})`;
        const identityScoped = !!findIdentityScopedEntry(controllerName, methodLabel, fullPath);
        if (identityScoped && !authenticatedOnly) {
          violations.push(`${label} is IDENTITY_SCOPED but lacks @AuthenticatedOnly()`);
        }
        if (authenticatedOnly && !identityScoped) {
          violations.push(`${label} has @AuthenticatedOnly() but no IDENTITY_SCOPED entry`);
        }
        if (authenticatedOnly && permissions.length > 0) {
          violations.push(`${label} has both @AuthenticatedOnly() and @RequirePermissions()`);
        }
      },
      { includeEveryRoute: true },
    );

    expect(violations).toEqual([]);
  });

  it('[75.7-b] the fail-closed PermissionsGuard admits every PermissionsGuard route (nothing that works today turns into a 403)', () => {
    const guard = new PermissionsGuard(new Reflector());
    const refused: string[] = [];
    let walked = 0;

    walkRoutes(({ controllerName, methodLabel, fullPath, handler, controllerClass }) => {
      walked++;
      // SUPER_ADMIN holds every permission, so only the "declares nothing" 403 can fire here.
      const context = {
        getHandler: () => handler,
        getClass: () => controllerClass,
        switchToHttp: () => ({
          getRequest: () => ({ currentTenant: { role: UserRole.SUPER_ADMIN } }),
        }),
      } as unknown as ExecutionContext;
      try {
        guard.canActivate(context);
      } catch (e) {
        refused.push(`${methodLabel} ${fullPath} (${controllerName}): ${(e as Error).message}`);
      }
    });

    expect(walked).toBeGreaterThan(0);
    expect(refused).toEqual([]);
  });

  it('keeps every IDENTITY_SCOPED entry pointed at a route that still exists', () => {
    const existingRoutes = new Set<string>();

    walkRoutes(({ controllerName, methodLabel, fullPath }) => {
      existingRoutes.add(`${controllerName}|${methodLabel}|${fullPath}`);
    });

    const stale = IDENTITY_SCOPED.filter(
      (entry) => !existingRoutes.has(`${entry.controller}|${entry.method}|${entry.path}`),
    );
    expect(stale).toEqual([]);
  });

  it('[10.4] documents every deliberate @Roles narrowing', () => {
    const violations: string[] = [];
    const allRoles = Object.values(UserRole);

    walkRoutes(({ controllerName, methodLabel, fullPath, roles, permissions }) => {
      if (permissions.length === 0) return; // self-service / platform — not a narrowing question
      // #1357: no @Roles means RolesGuard lets every role through and PermissionsGuard alone
      // decides — that is the epic-24 default, not a narrowing.
      if (roles.length === 0) return;

      const holders = allRoles.filter((role) =>
        permissions.every((permission) => roleHasPermission(role, permission)),
      );
      const roleSet = new Set<UserRole>([...roles, UserRole.SUPER_ADMIN]);
      const holderSet = new Set<UserRole>(holders);

      const sameMembers =
        roleSet.size === holderSet.size && [...roleSet].every((role) => holderSet.has(role));
      if (sameMembers) return;

      const narrowing = findRoleNarrowing(controllerName, methodLabel, fullPath);
      if (!narrowing) {
        violations.push(
          `${methodLabel} ${fullPath} (${controllerName}) — @Roles (${[...roleSet].join(', ')}) ` +
            `differs from every role holding the required permission(s) (${[...holderSet].join(', ')}) ` +
            'and has no ROLE_NARROWINGS entry',
        );
      }
    });

    expect(violations).toEqual([]);
  });

  it('#1357 every remaining @Roles is a ROLE_NARROWINGS or IDENTITY_SCOPED route', () => {
    // Epic 24 retired every @Roles that only mirrored the permission map. What is left must be
    // a documented narrowing or an identity-scoped route — otherwise a new role that holds the
    // permission would be silently shut out (D32).
    const violations: string[] = [];

    walkRoutes(
      ({ controllerName, methodLabel, fullPath, roles, hasPermissionsGuard }) => {
        if (roles.length === 0) return;
        // A RolesGuard-only @Roles(SUPER_ADMIN) is a platform route: the role is the whole check.
        if (!hasPermissionsGuard && roles.length === 1 && roles[0] === UserRole.SUPER_ADMIN) {
          return;
        }
        if (findRoleNarrowing(controllerName, methodLabel, fullPath)) return;
        if (findIdentityScopedEntry(controllerName, methodLabel, fullPath)) return;
        violations.push(
          `${methodLabel} ${fullPath} (${controllerName}) — @Roles (${roles.join(', ')}) is neither ` +
            'a ROLE_NARROWINGS nor an IDENTITY_SCOPED route; delete it or document why it narrows',
        );
      },
      { includeRolesGuardOnly: true },
    );

    expect(violations).toEqual([]);
  });

  it('#1379 an IDENTITY_SCOPED route open to every old staff role admits every staff role', () => {
    // Self-service routes (own profile, own leave, own push) are not ROLE_NARROWINGS, so the
    // #1364 sweep skipped them and the new roles got 403 on GET /users/me. A route that admits
    // ADMIN, ACCOUNTANT, EXECUTIVE and TEACHER is "every staff member" — it must admit the
    // rest of STAFF_ROLES too, unless a role is shut out below with a reason.
    const OLD_STAFF = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER];
    const SHUT_OUT_ON_PURPOSE: Record<string, UserRole[]> = {
      // D17: COMMITTEE is not an employee — no staff profile, so no leave.
      LeaveController: [UserRole.COMMITTEE],
    };
    const violations: string[] = [];

    walkRoutes(({ controllerName, methodLabel, fullPath, roles }) => {
      if (!findIdentityScopedEntry(controllerName, methodLabel, fullPath)) return;
      if (!OLD_STAFF.every((role) => roles.includes(role))) return;
      const allowedOut = SHUT_OUT_ON_PURPOSE[controllerName] ?? [];
      for (const role of STAFF_ROLES) {
        if (role === UserRole.SUPER_ADMIN || roles.includes(role) || allowedOut.includes(role)) {
          continue;
        }
        violations.push(`${methodLabel} ${fullPath} (${controllerName}) shuts out ${role}`);
      }
    });

    expect(violations).toEqual([]);
  });

  it('#1357 every ROLE_NARROWINGS entry still narrows a live route', () => {
    const allRoles = Object.values(UserRole);
    const live = new Map<string, { roles: UserRole[]; permissions: Permission[] }>();

    walkRoutes(({ controllerName, methodLabel, fullPath, roles, permissions }) => {
      live.set(`${controllerName}|${methodLabel}|${fullPath}`, { roles, permissions });
    });

    const stale = ROLE_NARROWINGS.filter((entry) => {
      const route = live.get(`${entry.controller}|${entry.method}|${entry.path}`);
      if (!route || route.roles.length === 0) return true;
      const holders = allRoles.filter((role) =>
        route.permissions.every((permission) => roleHasPermission(role, permission)),
      );
      const roleSet = new Set<UserRole>([...route.roles, UserRole.SUPER_ADMIN]);
      return roleSet.size === holders.length && holders.every((role) => roleSet.has(role));
    }).map((entry) => `${entry.method} ${entry.path} (${entry.controller})`);

    expect(stale).toEqual([]);
  });

  it('[10.4] lists every UI-only permission', () => {
    const requiredByRoute = new Set<Permission>();
    walkRoutes(({ permissions }) => {
      for (const permission of permissions) requiredByRoute.add(permission);
    });

    const uiOnly = Object.values(Permission).filter(
      (permission) => !requiredByRoute.has(permission),
    );

    expect(new Set(uiOnly)).toEqual(new Set(UI_ONLY_PERMISSIONS));
  });

  it('SUPER_ADMIN holds every permission (sanity check for the narrowing test above)', () => {
    expect(ROLE_PERMISSIONS[UserRole.SUPER_ADMIN]).toEqual(Object.values(Permission));
  });

  /**
   * [16.8.1] Epic #637's final role defaults for the fees domain, pinned.
   *
   * The tests above are all *structural* — they prove `@Roles` never grants
   * more than `ROLE_PERMISSIONS` allows, and that every narrowing is
   * documented. None of them pins what `ROLE_PERMISSIONS` actually says, so
   * quietly adding `PAYMENT_REVERSE` to ACCOUNTANT (or `FEE_GENERATE` to
   * TEACHER) would keep the whole suite green.
   *
   * Epic 16 added five money-moving capabilities across seven waves
   * (FEE_GENERATE, PAYMENT_REVERSE, REPORT_COLLECTIONS_READ,
   * SCHEDULE_MANAGE, DISCOUNT_RULE_MANAGE). This test states, per role,
   * exactly which of the fee-domain permissions that role holds when the
   * epic closes. Widening any of them is a one-line diff here, in review.
   */
  describe('[16.8.1] fees-domain role defaults', () => {
    const FEE_DOMAIN: Permission[] = [
      Permission.FEE_READ,
      Permission.FEE_GENERATE,
      Permission.FEE_COLLECT,
      Permission.FEE_APPROVE,
      Permission.FEE_STRUCTURE_CREATE,
      Permission.FEE_STRUCTURE_READ,
      Permission.FEE_STRUCTURE_UPDATE,
      Permission.FEE_STRUCTURE_DELETE,
      Permission.PAYMENT_RECORD,
      Permission.PAYMENT_READ,
      Permission.PAYMENT_REFUND,
      Permission.PAYMENT_REVERSE,
      Permission.INVOICE_CREATE,
      Permission.INVOICE_READ,
      Permission.INVOICE_PRINT,
      Permission.INVOICE_SEND,
      Permission.INVOICE_DELETE,
      Permission.REPORT_COLLECTIONS_READ,
      Permission.SCHEDULE_MANAGE,
      Permission.DISCOUNT_RULE_MANAGE,
    ];

    function feeDomainPermissionsOf(role: UserRole): Permission[] {
      return FEE_DOMAIN.filter((permission) => roleHasPermission(role, permission)).sort();
    }

    function expectFeeDomain(role: UserRole, expected: Permission[]): void {
      expect(feeDomainPermissionsOf(role)).toEqual([...expected].sort());
    }

    it('ADMIN holds every fees-domain permission', () => {
      expectFeeDomain(UserRole.ADMIN, FEE_DOMAIN);
    });

    it('ACCOUNTANT runs collection but cannot approve or reverse', () => {
      expectFeeDomain(UserRole.ACCOUNTANT, [
        Permission.FEE_READ,
        Permission.FEE_GENERATE,
        Permission.FEE_COLLECT,
        Permission.FEE_STRUCTURE_CREATE,
        Permission.FEE_STRUCTURE_READ,
        Permission.FEE_STRUCTURE_UPDATE,
        Permission.PAYMENT_RECORD,
        Permission.PAYMENT_READ,
        Permission.INVOICE_CREATE,
        Permission.INVOICE_READ,
        Permission.INVOICE_PRINT,
        Permission.INVOICE_SEND,
        Permission.REPORT_COLLECTIONS_READ,
        Permission.SCHEDULE_MANAGE,
        Permission.DISCOUNT_RULE_MANAGE,
      ]);
    });

    it('ACCOUNTANT specifically holds neither FEE_APPROVE nor PAYMENT_REVERSE', () => {
      // [16.2.1] kept both ADMIN-only regardless of the tenant's
      // approval_mode: an approver must not be able to approve their own
      // work, and a reversal undoes money that already moved. `POST
      // /payments/:id/reverse` is `@Roles(ADMIN)` to match, and
      // `checkout.controller.e2e-spec.ts` pins the 401 for an ACCOUNTANT.
      // Granting either here silently widens who can unwind a payment.
      expect(roleHasPermission(UserRole.ACCOUNTANT, Permission.FEE_APPROVE)).toBe(false);
      expect(roleHasPermission(UserRole.ACCOUNTANT, Permission.PAYMENT_REVERSE)).toBe(false);
      expect(roleHasPermission(UserRole.ADMIN, Permission.PAYMENT_REVERSE)).toBe(true);
    });

    it('EXECUTIVE is read-only: fee reads plus the collections report, nothing that writes', () => {
      expectFeeDomain(UserRole.EXECUTIVE, [
        Permission.FEE_READ,
        Permission.REPORT_COLLECTIONS_READ,
      ]);
    });

    it('TEACHER holds only the object-scoped fee read, never a money capability', () => {
      // FEE_READ is object-scoped for a TEACHER exactly as it is for a
      // family: the routes it unlocks (`/fees/dues`, `/fee-structures`)
      // decide *whose* fees, not this permission.
      expectFeeDomain(UserRole.TEACHER, [Permission.FEE_READ]);
    });

    it('PARENT and STUDENT hold only the two object-scoped family reads', () => {
      for (const role of [UserRole.PARENT, UserRole.STUDENT]) {
        expectFeeDomain(role, [Permission.FEE_READ, Permission.INVOICE_READ]);
      }
    });

    it('no non-admin role holds a fees capability that moves or unwinds money', () => {
      const moneyMoving = [
        Permission.FEE_APPROVE,
        Permission.PAYMENT_REVERSE,
        Permission.PAYMENT_REFUND,
        Permission.INVOICE_DELETE,
      ];
      // Every role but ADMIN/SUPER_ADMIN, so a role added later is covered too.
      const nonAdmin = Object.values(UserRole).filter(
        (role) => role !== UserRole.ADMIN && role !== UserRole.SUPER_ADMIN,
      );

      const violations: string[] = [];
      for (const role of nonAdmin) {
        for (const permission of moneyMoving) {
          if (roleHasPermission(role, permission)) {
            violations.push(`${role} holds ${permission}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('#1361 new role defaults', () => {
    const NEW_ROLES = [UserRole.OFFICE_STAFF, UserRole.EXAM_CONTROLLER, UserRole.COMMITTEE];

    // The unwind-money set is pinned for every non-admin role in [16.8.1]
    // above. These are the money capabilities ACCOUNTANT legitimately holds
    // but no new role may.
    it('none of the new roles collects, records, bills or reprices fees', () => {
      const moneyMoving = [
        Permission.FEE_COLLECT,
        Permission.PAYMENT_RECORD,
        Permission.FEE_GENERATE,
        Permission.INVOICE_CREATE,
        Permission.SCHEDULE_MANAGE,
        Permission.DISCOUNT_RULE_MANAGE,
        Permission.FEE_STRUCTURE_CREATE,
        Permission.FEE_STRUCTURE_UPDATE,
        Permission.FEE_STRUCTURE_DELETE,
      ];
      const violations = NEW_ROLES.flatMap((role) =>
        moneyMoving
          .filter((permission) => roleHasPermission(role, permission))
          .map((permission) => `${role} holds ${permission}`),
      );
      expect(violations).toEqual([]);
    });

    it('COMMITTEE holds no STUDENT_READ (D9 — no student PII)', () => {
      expect(roleHasPermission(UserRole.COMMITTEE, Permission.STUDENT_READ)).toBe(false);
    });

    it('COMMITTEE holds no REPORT_COLLECTIONS_READ — the report and CSV name students (D16)', () => {
      expect(roleHasPermission(UserRole.COMMITTEE, Permission.REPORT_COLLECTIONS_READ)).toBe(false);
    });
  });
});

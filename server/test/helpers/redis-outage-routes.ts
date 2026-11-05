import { AuthController } from '../../src/modules/auth/auth.controller';
import { StepUpController } from '../../src/modules/auth/step-up.controller';
import { SocialAuthController } from '../../src/modules/auth/social/social-auth.controller';
import { AccountAccessController } from '../../src/modules/account-access/account-access.controller';
import { FirstPasswordController } from '../../src/modules/account-access/first-password.controller';
import { SchoolInvitesController } from '../../src/modules/account-access/school-invites.controller';
import { RegistrationController } from '../../src/modules/registration/registration.controller';
import { UserController } from '../../src/modules/users/users.controller';
import { MarksController } from '../../src/modules/exams/marks.controller';

// What each sign-in-related route does while Redis (the rate limiter) is down. Shared by
// app-throttler.guard.spec (every route on these controllers must be in exactly one list) and
// route-guard-coverage.e2e-spec (every /auth* or /account* controller must be listed here).
// `@FailClosedWithoutRedis()` defaults to fail open, so these lists make that a written choice.

// Every controller under /auth or /account, plus UserController (POST /users/me/contact-change
// checks a password), plus MarksController (81 D21: the sheet import stages in Redis).
export const REDIS_OUTAGE_CONTROLLERS: Function[] = [
  AuthController,
  StepUpController,
  SocialAuthController,
  AccountAccessController,
  FirstPasswordController,
  SchoolInvitesController,
  RegistrationController,
  UserController,
  MarksController,
];

// Checks a password, or sends or checks a one-time code: answers 503 without Redis, because
// with no rate limit it would allow unlimited guessing.
export const FAIL_CLOSED = [
  'POST /auth/login',
  'POST /auth/change-password',
  'POST /auth/activate',
  'POST /auth/activate/resend',
  'POST /auth/activate/verify',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'POST /auth/otp/request',
  'POST /auth/otp/verify',
  'POST /auth/verify-email',
  'POST /auth/register/start',
  'POST /auth/register/resend',
  'POST /auth/register/verify',
  'POST /auth/step-up',
  'POST /auth/step-up/otp/request',
  'GET /auth/social/:provider/start',
  'GET /auth/social/:provider/callback',
  'POST /auth/social/:provider/link-start',
  'DELETE /auth/social/identities/:provider',
  'POST /auth/social/facebook/data-deletion',
  'POST /users/me/contact-change',
  // MarksController: the sheet import stages in Redis, so without it validate and commit cannot work.
  'POST /exams/:examId/marks/sheet/validate',
  'POST /exams/:examId/marks/sheet/commit',
];

// Served without a rate limit while Redis is down: keeps signed-in people signed in, reads,
// and routes that check no password or code. confirm-phone checks a code, but OtpService.verify
// itself answers 503 when Redis is down, so it cannot fail open.
export const FAIL_OPEN = [
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/logout-all',
  'GET /auth/sessions',
  'DELETE /auth/sessions/:id',
  'GET /auth/social/providers',
  'GET /auth/social/identities',
  'GET /auth/social/facebook/data-deletion/status',
  'POST /account/first-password',
  'GET /account/school-invites',
  'POST /account/school-invites/:id/accept',
  'POST /account/school-invites/:id/decline',
  'POST /users/me/contact-change/confirm-phone',
  // The rest of UserController: signed-in admin and self-service routes that check no password
  // or code. The admin reset only sends a code to the target, and OTP storage needs Redis anyway.
  'GET /users',
  'POST /users',
  'GET /users/:id',
  'PATCH /users/:id',
  'DELETE /users/:id',
  'POST /users/:id/restore',
  'POST /users/:id/reset-password',
  'DELETE /users/:id/invitation',
  'POST /users/:id/invitation/resend',
  'POST /users/invitations/preview',
  'POST /users/invitations/batch',
  'GET /users/invitations/batch/:batchId',
  'POST /users/join-requests',
  'GET /users/me',
  'PATCH /users/me',
  'POST /users/me/leave',
  'GET /users/me/preferences/notifications',
  'PATCH /users/me/preferences/notifications',
  'PATCH /users/me/preferences/digest',
  'PATCH /users/me/preferences/dashboard',
  'GET /teachers',
  'POST /teachers',
  'PATCH /teachers/:id',
  'GET /teachers/:teacherId/assignments',
  // MarksController: reads and grid writes use Postgres only
  'GET /exams/:examId/marks',
  'PATCH /exams/:examId/marks',
  'POST /exams/:examId/marks/submit',
  'POST /exams/:examId/marks/reopen',
  'GET /exams/:examId/marks/progress',
  'GET /exams/:examId/marks/sheet',
];

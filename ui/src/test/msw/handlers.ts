import type { HttpHandler } from 'msw';

import { academicYearDefaultHandlers } from './handlers/academic-years';
import { acrDefaultHandlers } from './handlers/acr';
import { applicationDefaultHandlers } from './handlers/applications';
import { attentionDefaultHandlers } from './handlers/attention';
import { auditLogDefaultHandlers } from './handlers/audit-logs';
import { authDefaultHandlers } from './handlers/auth';
import { backupDefaultHandlers } from './handlers/backup';
import { billingDefaultHandlers } from './handlers/billing';
import { classDefaultHandlers } from './handlers/classes';
import { communicationDefaultHandlers } from './handlers/communications';
import { enrollmentDefaultHandlers } from './handlers/enrollments';
import { feeDefaultHandlers, feeStructureDefaultHandlers } from './handlers/fees';
import { fineDefaultHandlers } from './handlers/fines';
import { guardianDefaultHandlers } from './handlers/guardians';
import { incidentDefaultHandlers } from './handlers/incidents';
import { invitationDefaultHandlers } from './handlers/invitations';
import { invoiceDefaultHandlers } from './handlers/invoices';
import { paymentDefaultHandlers } from './handlers/payments';
import { performanceDefaultHandlers } from './handlers/performance';
import { publicHolidaySetsDefaultHandlers } from './handlers/public-holiday-sets';
import { schoolsDefaultHandlers } from './handlers/schools';
import { studentDefaultHandlers } from './handlers/students';
import { surveyDefaultHandlers } from './handlers/surveys';
import { teacherDefaultHandlers } from './handlers/teachers';
import { userDefaultHandlers } from './handlers/users';
import { websiteDefaultHandlers } from './handlers/website';

/**
 * The shared handler library — the "happy path" default for every
 * endpoint the SPAs call, typed against `ui/src/api/schema.d.ts` (or, for
 * the handful of endpoints whose OpenAPI 2xx body is `content?: never`
 * because the controller never declared an `@ApiResponse` type, against
 * the runtime DTO shape read directly from the server module — see each
 * `./handlers/*.ts` file's own comments for which).
 *
 * Handlers are hand-written, not generated from the spec — a deliberate
 * choice recorded on the issue: generated handlers produce unrealistic
 * data, and the contract-drift risk they're meant to solve is already
 * covered by `tsc` breaking on a schema/response-shape mismatch here.
 *
 * Error and slow variants are **not** hand-duplicated per endpoint (that's
 * 40+ endpoints × several variants each). Instead `./support.ts` exports
 * `errorHandler`/`slowHandler`, composable factories a test overrides with
 * directly: `server.use(errorHandler('get', '/api/v1/students', 500))` or
 * `server.use(slowHandler('get', '/api/v1/students', someHandlerBody, 2000))`.
 * Each group file additionally exports named "empty" variants (and, for
 * `auth`, `login`/`refresh` failure variants, since those encode genuinely
 * different logic, not just a different status code) via its own
 * `*Handlers` object — e.g. `studentHandlers.listEmpty` — for the common
 * case of swapping in an alternate success response rather than an error.
 *
 * `readonly`: the intended way to add or override a handler is
 * `server.use(...)` (per-test, auto-reset) or editing a `./handlers/*.ts`
 * file (the shared baseline) — not mutating this array in place, which
 * nothing calling `setupServer`/`setupWorker` would ever see take effect
 * anyway, since both capture the handlers at construction time.
 */
export const handlers: readonly HttpHandler[] = [
  ...authDefaultHandlers,
  ...backupDefaultHandlers,
  ...websiteDefaultHandlers,
  ...billingDefaultHandlers,
  ...academicYearDefaultHandlers,
  ...classDefaultHandlers,
  ...enrollmentDefaultHandlers,
  ...userDefaultHandlers,
  ...invitationDefaultHandlers,
  ...teacherDefaultHandlers,
  ...studentDefaultHandlers,
  ...guardianDefaultHandlers,
  ...feeStructureDefaultHandlers,
  ...feeDefaultHandlers,
  ...fineDefaultHandlers,
  ...paymentDefaultHandlers,
  ...invoiceDefaultHandlers,
  ...communicationDefaultHandlers,
  ...auditLogDefaultHandlers,
  ...schoolsDefaultHandlers,
  ...publicHolidaySetsDefaultHandlers,
  ...acrDefaultHandlers,
  ...incidentDefaultHandlers,
  ...attentionDefaultHandlers,
  ...surveyDefaultHandlers,
  ...performanceDefaultHandlers,
  ...applicationDefaultHandlers,
];

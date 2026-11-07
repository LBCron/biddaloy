import { AuthGuard } from '@nestjs/passport';

// Shared by the route e2e specs (route-guard-coverage, permission-matrix,
// route-status-snapshot). Lives outside a spec file so importing it does not
// register (and re-run) another spec's describe blocks.

// Nest stores '/' as an index route's own path metadata (e.g. bare
// `@Get()`), which `filter(Boolean)` keeps (it's a non-empty string) — left
// alone, that produces a trailing slash (`/students/`) that would never
// match a human writing `/students` into the allowlist by hand. Stripped
// here, once, so every path this file produces is the same shape a person
// would naturally write.
export function buildFullPath(controllerPrefix: string, routePath: string): string {
  return `/${[controllerPrefix, routePath].filter(Boolean).join('/')}`
    .replace(/\/+/g, '/')
    .replace(/(.)\/$/, '$1');
}

// Nest's RequestMethod enum (from @nestjs/common) — duplicated as a small
// literal map rather than imported, since only the numeric value stored in
// route metadata is available here and this keeps the mapping self-evident.
export function RequestMethodName(method: number): string {
  const names: Record<number, string> = {
    0: 'GET',
    1: 'POST',
    2: 'PUT',
    3: 'DELETE',
    4: 'PATCH',
    5: 'ALL',
    6: 'OPTIONS',
    7: 'HEAD',
  };
  return names[method] ?? `UNKNOWN(${method})`;
}

// AuthGuard(type) memoizes per type string in this @nestjs/passport version
// (verified empirically: two separate `AuthGuard('jwt')` calls return the
// *same* class reference) — so calling it here and comparing by reference
// reliably detects the exact guard every controller in this codebase uses,
// with no fragile name/string matching against a dynamically-generated
// mixin class.
export const JWT_AUTH_GUARD = AuthGuard('jwt');

export interface AllowlistEntry {
  controller: string;
  method: string;
  path: string;
  reason: string;
}

/**
 * A hardcoded, reviewed allowlist — not derived from any metadata — of
 * routes that deliberately do not carry the full guard stack. Adding a new
 * public or partially-guarded route requires a deliberate edit here, which
 * is the entire point: it can never happen by silent omission.
 *
 * The Swagger docs mount (`/api/docs`, `/api/docs-json`) is NOT listed here
 * because it isn't a Nest route at all — main.ts mounts it as raw Express
 * middleware via SwaggerModule.setup, invisible to DiscoveryService. Its
 * production access control (Basic Auth, gated by ENABLE_API_DOCS) is
 * covered separately by swagger-gating.e2e-spec.ts, not this test.
 */
export const ALLOWLIST: AllowlistEntry[] = [
  {
    controller: 'AppController',
    method: 'GET',
    path: '/health',
    reason: 'Liveness probe — pre-authentication by definition.',
  },
  {
    controller: 'HealthController',
    method: 'GET',
    path: '/health/ready',
    reason:
      '[15.1.3] Readiness probe for an uptime monitor, not a tenant user — guarded by its own X-Health-Token check (404 with no token configured, 401 on mismatch) rather than the JWT/tenant guard stack.',
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/login',
    reason: 'Issues credentials in the first place — nothing to authenticate yet.',
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/refresh',
    reason:
      'Cookie-authenticated, pre-tenant-selection (SameOriginGuard only) — see the README\'s "CSRF posture" section.',
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/logout',
    reason:
      'Cookie-authenticated, pre-tenant-selection (SameOriginGuard only), same rationale as /auth/refresh.',
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/logout-all',
    reason:
      "Bearer-authenticated but tenant-agnostic — operates on the caller's own user.sub/jti (AuthGuard(jwt) only, no ContextGuard/RolesGuard, since it is not a tenant-scoped resource).",
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/change-password',
    reason:
      "Bearer-authenticated but tenant-agnostic — rotates the caller's own password, identified solely by user.sub, and takes no user id from the body (AuthGuard(jwt) only, same rationale as /auth/logout-all).",
  },
  {
    controller: 'AuthController',
    method: 'GET',
    path: '/auth/sessions',
    reason:
      "[12.8] Bearer-authenticated but tenant-agnostic — lists the caller's own refresh-token families (session spans every tenant the user belongs to), identified solely by user.sub (AuthGuard(jwt) only, same rationale as /auth/logout-all).",
  },
  {
    controller: 'AuthController',
    method: 'DELETE',
    path: '/auth/sessions/:id',
    reason:
      "[12.8] Bearer-authenticated but tenant-agnostic, plus SameOriginGuard since it consults the refresh cookie to detect the caller's current session — revokes only a family already proven (by countForFamily) to belong to user.sub, same rationale as /auth/logout-all.",
  },
  {
    controller: 'StepUpController',
    method: 'POST',
    path: '/auth/step-up/otp/request',
    reason:
      '[16.2.2] Bearer-authenticated, tenant-scoped (AuthGuard(jwt) + ContextGuard), but ' +
      'deliberately no RolesGuard/PermissionsGuard: any authenticated member of the tenant ' +
      "may request that an OTP be sent — the eligibility check is on the identifier's " +
      "resolved approver (must hold FEE_APPROVE), not the caller's own role, and the route " +
      'always responds 202 regardless of outcome to avoid identifier enumeration.',
  },
  {
    controller: 'StepUpController',
    method: 'POST',
    path: '/auth/step-up',
    reason:
      '[16.2.2] Same rationale as /auth/step-up/otp/request — the caller is the actor, not ' +
      'necessarily the approver, so RolesGuard/PermissionsGuard on the caller would check the ' +
      'wrong identity. StepUpService resolves the approver fresh from `identifier` and ' +
      'verifies FEE_APPROVE on THAT user before issuing an approval token.',
  },
  {
    controller: 'DeviceIngestController',
    method: 'POST',
    path: '/attendance/device-events',
    reason:
      'Device-authenticated (X-Device-Key) — no JWT, no user, no tenant header. Tenant is ' +
      'resolved from the device row by DeviceAuthGuard; RolesGuard is deliberately absent ' +
      'because a device holds no UserRole. See [9.5].',
  },
  {
    controller: 'DeviceIngestController',
    method: 'GET',
    path: '/attendance/devices/me/roster',
    reason:
      'Device-authenticated (X-Device-Key) — no JWT, no user, no tenant header. Tenant is ' +
      'resolved from the device row by DeviceAuthGuard; RolesGuard is deliberately absent ' +
      'because a device holds no UserRole. See [9.5].',
  },
  {
    controller: 'DeviceIngestController',
    method: 'POST',
    path: '/attendance/devices/me/heartbeat',
    reason:
      'Device-authenticated (X-Device-Key) — no JWT, no user, no tenant header. Tenant is ' +
      'resolved from the device row by DeviceAuthGuard; RolesGuard is deliberately absent ' +
      'because a device holds no UserRole. See [9.5].',
  },
  {
    controller: 'AccountAccessController',
    method: 'POST',
    path: '/auth/activate/verify',
    reason:
      '12.2 — checks an invite token before the caller has any credentials at all, same rationale as /auth/login.',
  },
  {
    controller: 'AccountAccessController',
    method: 'POST',
    path: '/auth/activate',
    reason:
      '12.2 — consumes an invite token and issues credentials in the same request; nothing to authenticate yet, same rationale as /auth/login.',
  },
  {
    controller: 'AccountAccessController',
    method: 'POST',
    path: '/auth/activate/resend',
    reason:
      '12.2 — self-service, enumeration-safe resend by identifier; the caller has no account session to authenticate with.',
  },
  {
    controller: 'AccountAccessController',
    method: 'POST',
    path: '/auth/forgot-password',
    reason:
      '12.3 — a locked-out user has no credentials at all yet; enumeration-safe, same rationale as /auth/login.',
  },
  {
    controller: 'AccountAccessController',
    method: 'POST',
    path: '/auth/reset-password',
    reason:
      '12.3 — consumes an OTP or reset token and issues credentials in the same request; nothing to authenticate yet, same rationale as /auth/activate.',
  },
  {
    controller: 'AccountAccessController',
    method: 'POST',
    path: '/auth/otp/request',
    reason:
      '12.5 — a passwordless-login OTP request has no credentials at all yet; enumeration-safe, same rationale as /auth/login.',
  },
  {
    controller: 'AccountAccessController',
    method: 'POST',
    path: '/auth/otp/verify',
    reason:
      '12.5 — consumes a phone+OTP pair and issues credentials in the same request; nothing to authenticate yet, same rationale as /auth/login.',
  },
  {
    controller: 'AccountAccessController',
    method: 'POST',
    path: '/auth/verify-email',
    reason:
      '12.7 — the link is clicked from an inbox, possibly logged out; nothing to authenticate against yet, same rationale as /auth/activate.',
  },
  {
    controller: 'PublicInvoiceController',
    method: 'GET',
    path: '/public/invoices/:token',
    reason:
      '[#666] the share token itself is the credential and carries its own tenant scope (InvoiceShareService.validatePublicToken) — there is no JWT, no user, and no X-Tenant-ID on this path at all, same no-guards rationale as /auth/activate*. Throttled instead via PUBLIC_INVOICE_RATE_LIMIT.',
  },
  {
    controller: 'PublicNoticeController',
    method: 'GET',
    path: '/public/notices/:token',
    reason:
      '[53.2] D17 — the 256-bit link token is the credential; the tenant comes from the token row (hashed lookup), so there is no JWT, user or X-Tenant-ID. Unknown, expired or revoked tokens answer one 404. Throttled via the public notice rate limit.',
  },
  {
    controller: 'PublicNoticeController',
    method: 'GET',
    path: '/public/notices/:token/files/:fileId',
    reason:
      '[53.2] D17 — same token credential as GET /public/notices/:token; the file must belong to the token’s notice, else 404.',
  },
  {
    controller: 'PublicNoticeController',
    method: 'POST',
    path: '/public/notices/:token/opened',
    reason:
      '[53.2] D17 — same token credential; stamps link_opened_at on the matching recipient only, never changes notice state.',
  },
  ...(
    [
      ['/public/site/by-host/:host/manifest', 'the manifest'],
      ['/public/site/by-host/:host/page/:page', 'one published page'],
      ['/public/site/by-host/:host/blog/:slug', 'one published blog post'],
      ['/public/site/by-host/:host/island/:kind', 'a live island list'],
      ['/public/site/by-host/:host/media/:key', 'the logo or a site picture'],
    ] as const
  ).map(([path, what]) => ({
    controller: 'PublicSiteController',
    method: 'GET',
    path,
    reason: `[40.1.04] Reads ${what} for the school-site container. The host name is the only tenant signal; there is no JWT, user or X-Tenant-ID. Unknown host and switched-off site answer one 404 (site.not_found). Throttled via SITE_READ_RATE_LIMIT.`,
  })),
  {
    controller: 'PublicEnquiryController',
    method: 'POST',
    path: '/public/site/by-host/:host/island/enquiry',
    reason:
      '[40.3.01] D22, D42 — the one public write of the site. The host name is the only tenant signal (no JWT, user or X-Tenant-ID); a live site is checked first (unknown host and switched-off site answer one 404, site.not_found), then Turnstile (fail-closed in production, Rule 22), then the write. Throttled via STRICT_RATE_LIMIT (5/min per IP).',
  },
  {
    controller: 'PublicVerifyController',
    method: 'GET',
    path: '/public/verify/:token',
    reason:
      '[32.2.5] D22 — the printed QR token is the credential; the tenant is resolved from the token row (PublicVerifyService hashes it and looks it up), so there is no JWT, user or X-Tenant-ID. Returns only the allowlisted fields (spec-enforced) and is throttled via PUBLIC_VERIFY_RATE_LIMIT.',
  },
  {
    controller: 'CalendarFeedPublicController',
    method: 'GET',
    path: '/calendar/feed/:token.ics',
    reason:
      '[17.4.1] D13 — per-user feed token itself is the credential and carries its own tenant scope (CalendarFeedService.render resolves tenant + user from the token row, 404s on unknown/revoked/deactivated); the link is opened by a phone calendar app with no login, so there is no JWT, no user and no X-Tenant-ID on this path at all — same no-guards rationale as /public/invoices/:token. Throttled instead via CALENDAR_FEED_RATE_LIMIT.',
  },
  {
    controller: 'PublicAdmissionController',
    method: 'GET',
    path: '/public/admission/:slug',
    reason:
      "[27.2] Anyone can view a school's open admission intakes without logging in — the `:slug` in the URL is the sole tenant signal (AdmissionApplicantService.listOpenIntakes resolves and scopes by it), same no-guards rationale as /public/invoices/:token.",
  },
  {
    controller: 'PublicAdmissionController',
    method: 'POST',
    path: '/public/admission/:slug/applicants',
    reason:
      '[27.2] D9/D14 — public unauthenticated admission submission, tenant resolved from `:slug` inside AdmissionApplicantService.submit, same no-guards rationale as GET /public/admission/:slug. Throttled via STRICT_RATE_LIMIT (5/min).',
  },
  {
    controller: 'PublicAdmissionController',
    method: 'POST',
    path: '/public/admission/:slug/status',
    reason:
      '[27.7] Reference number + guardian phone is the credential; tenant resolved from `:slug`. Wrong or unknown either one 404s identically. Throttled via ADMISSION_STATUS_RATE_LIMIT.',
  },
  {
    controller: 'FirstPasswordController',
    method: 'POST',
    path: '/account/first-password',
    reason:
      "[13.2.2] Bearer-authenticated but tenant-agnostic — sets only the caller's own first password, identified solely by user.sub (AuthGuard(jwt) only, same rationale as /auth/change-password).",
  },
  {
    controller: 'SchoolInvitesController',
    method: 'GET',
    path: '/account/school-invites',
    reason:
      "[68.1.10] Bearer-authenticated, tenant-agnostic: lists only the caller's own live JOIN_SCHOOL requests, filtered by user.sub. The caller is not yet a member of the inviting school, so ContextGuard would always reject it.",
  },
  {
    controller: 'SchoolInvitesController',
    method: 'POST',
    path: '/account/school-invites/:id/accept',
    reason:
      "[68.1.10] Bearer-authenticated, tenant-agnostic: acts only on the caller's own JOIN_SCHOOL row (every id paired with user.sub, tenant taken from the row, never the request). Throttled via STRICT_RATE_LIMIT.",
  },
  {
    controller: 'SchoolInvitesController',
    method: 'POST',
    path: '/account/school-invites/:id/decline',
    reason:
      "[68.1.10] Bearer-authenticated, tenant-agnostic: acts only on the caller's own JOIN_SCHOOL row (every id paired with user.sub). Throttled via STRICT_RATE_LIMIT.",
  },
  {
    controller: 'BkashCallbackController',
    method: 'GET',
    path: '/billing/bkash/callback',
    reason:
      '[49 W4 #1820] Public bKash redirect target (a browser redirect carries no bearer token). The paymentID is only believed after bKash execute/query confirms it, the order is paid only on Completed + matching invoice and amount, and a replay is a no-op. Throttled via STRICT_RATE_LIMIT.',
  },
  {
    controller: 'SocialAuthController',
    method: 'GET',
    path: '/auth/social/providers',
    reason:
      '[13.2.4] Public, read-only list of configured sign-in providers — no user or tenant data (D41).',
  },
  {
    controller: 'SocialAuthController',
    method: 'GET',
    path: '/auth/social/:provider/start',
    reason:
      '[13.2.4] Public start of the OAuth authorization-code flow — nothing to authenticate yet; state + PKCE stored server-side and bound to an httpOnly cookie. Throttled via STRICT_RATE_LIMIT.',
  },
  {
    controller: 'SocialAuthController',
    method: 'GET',
    path: '/auth/social/:provider/callback',
    reason:
      '[13.2.4] Public OAuth redirect target — the single-use state (Redis GETDEL + cookie + provider) is the credential, same rationale as /auth/login. Throttled via STRICT_RATE_LIMIT.',
  },
  {
    controller: 'SocialAuthController',
    method: 'GET',
    path: '/auth/social/identities',
    reason:
      "[13.2.4] Bearer-authenticated but tenant-agnostic — lists the caller's own sign-in identities, identified solely by user.sub (AuthGuard(jwt) only, same rationale as /auth/sessions).",
  },
  {
    controller: 'SocialAuthController',
    method: 'DELETE',
    path: '/auth/social/identities/:provider',
    reason:
      "[13.2.4] Bearer-authenticated but tenant-agnostic — disconnects one of the caller's own identities, identified solely by user.sub; the last sign-in method is refused with 409 (AuthGuard(jwt) only).",
  },
  {
    controller: 'SocialAuthController',
    method: 'POST',
    path: '/auth/social/:provider/link-start',
    reason:
      "[13.2.4] Bearer-authenticated but tenant-agnostic — starts connecting a provider to the caller's own account, identified solely by user.sub (AuthGuard(jwt) only).",
  },
  {
    controller: 'SocialAuthController',
    method: 'POST',
    path: '/auth/social/facebook/data-deletion',
    reason:
      "[13.7.1] Meta's server-to-server data-deletion callback — the HMAC-signed signed_request (app secret) is the credential; deletes only the matching Facebook identity row. Default throttle tier so Meta is not turned away.",
  },
  {
    controller: 'SocialAuthController',
    method: 'GET',
    path: '/auth/social/facebook/data-deletion/status',
    reason:
      '[13.7.1] Public static confirmation page Meta links the person to — echoes the UUID-validated code, no lookup, no user or tenant data, strict CSP.',
  },
  {
    controller: 'RegistrationController',
    method: 'POST',
    path: '/auth/register/start',
    reason:
      '[13.3.1] Public, unauthenticated — stages the registrant details and sends a code; Turnstile-checked, STRICT throttle, same response for known and unknown contacts.',
  },
  {
    controller: 'RegistrationController',
    method: 'POST',
    path: '/auth/register/resend',
    reason:
      '[13.3.1] Public, unauthenticated — resends the code for a staged registration_id; STRICT throttle and a per-registration resend cap.',
  },
  {
    controller: 'RegistrationController',
    method: 'POST',
    path: '/auth/register/verify',
    reason:
      '[13.3.1] Public, unauthenticated — checks the code and creates the school in trial; STRICT throttle, 5-attempt lock, single-use stage.',
  },
  {
    controller: 'DemoController',
    method: 'GET',
    path: '/demo/roles',
    reason:
      '[58.1.01] Public, unauthenticated — the demo login cards and shared demo password; 404 unless DEMO_MODE=true, default throttle.',
  },
];

export function describeGuards(guards: unknown[]): string {
  if (guards.length === 0) return 'none';
  return guards
    .map((g) => {
      if (g === JWT_AUTH_GUARD) return "AuthGuard('jwt')";
      if (typeof g === 'function') return g.name || '(anonymous)';
      return String(g);
    })
    .join(', ');
}

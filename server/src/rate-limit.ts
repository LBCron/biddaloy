export interface RateLimitTierOptions {
  limit: number;
  ttl: number;
}

/**
 * The generous, globally-applied default tier (see app.module.ts). Configurable
 * by env so it can be tuned without a redeploy; unset falls back to 100
 * requests per 60s per tracked identity (authenticated user, else IP — see
 * common/rate-limit/rate-limit-tracker.ts).
 *
 * The stricter per-route tier used on expensive endpoints (bulk upload, fee
 * generation, bulk reminders, invoice creation) is applied via `@Throttle()`
 * decorators with literal values instead: `@Throttle()` arguments are
 * evaluated at module-import time, before ConfigModule's dotenv loading runs,
 * so env-driven numbers there would silently miss `.env`-file overrides in
 * local dev (only already-present process env vars would take effect).
 */
export function resolveDefaultRateLimit(
  limitEnv: string | undefined,
  ttlMsEnv: string | undefined,
): RateLimitTierOptions {
  return {
    limit: limitEnv ? Number(limitEnv) : 100,
    ttl: ttlMsEnv ? Number(ttlMsEnv) : 60_000,
  };
}

/**
 * Applied per-route via `@Throttle({ default: STRICT_RATE_LIMIT })` on the
 * genuinely expensive endpoints (bulk upload, fee generation, bulk
 * reminders, invoice creation) — these do real work per request and are
 * the actual abuse targets, unlike a typical CRUD read/write.
 */
export const STRICT_RATE_LIMIT: RateLimitTierOptions = { limit: 5, ttl: 60_000 };

/**
 * Tighter than `STRICT_RATE_LIMIT` — applied to #8.7.12's provider
 * connection test (`POST /schools/:id/settings/test`), the one endpoint in
 * this codebase that makes a real outbound call to a third-party API
 * (Meta Graph, an SMTP server, an SMS gateway) on every request rather
 * than just doing more DB work. A caller hammering it either burns a
 * tenant's own SMTP/API quota or, worse, becomes a vector for probing a
 * third party's auth endpoint.
 */
export const PROVIDER_TEST_RATE_LIMIT: RateLimitTierOptions = { limit: 3, ttl: 60_000 };

/**
 * Applied to `GET`/`PATCH /schools/:id/settings` — a credential-bearing
 * read/write (a masked hint is still information about a school's
 * provider accounts), but not an "expensive" endpoint in
 * `STRICT_RATE_LIMIT`'s sense: it's a single-row jsonb read/write, and
 * #8.7.13's dashboard saves one section (region/SMS/WhatsApp/email/
 * Messenger) at a time rather than the whole page at once, so a normal
 * "paste five credentials from a password manager" setup session is five
 * PATCHes in quick succession — `STRICT_RATE_LIMIT`'s 5/60s sits right on
 * that boundary and one typo-and-retry tips it over. This tier keeps a
 * meaningful brake on enumerating a credential-bearing read while leaving
 * room for a normal setup session.
 */
export const SETTINGS_RATE_LIMIT: RateLimitTierOptions = { limit: 20, ttl: 60_000 };

/**
 * Applied to `GET /public/invoices/:token` (#666) — the one route in this
 * codebase reachable with no auth header and no `X-Tenant-ID` at all. A
 * guardian re-opening a receipt link a few times is normal; 30/min per IP
 * is generous for that while still bounding a brute-force scan across
 * random 32-byte tokens (which is astronomically infeasible regardless,
 * but the tier still caps how hard a caller can hammer the DB lookup).
 */
export const PUBLIC_INVOICE_RATE_LIMIT: RateLimitTierOptions = { limit: 30, ttl: 60_000 };

/**
 * Applied to the three `/public/notices/:token...` routes (53.2.02), reachable
 * with no auth header and no `X-Tenant-ID`. Same reasoning as the invoice tier.
 */
export const PUBLIC_NOTICE_RATE_LIMIT: RateLimitTierOptions = { limit: 30, ttl: 60_000 };

/**
 * Applied to `GET /public/verify/:token` (32.2.5) — the third route reachable
 * with no auth header and no `X-Tenant-ID`. Someone scanning a printed card's
 * QR code opens it a few times at most; 30/min per IP bounds a token scan.
 */
export const PUBLIC_VERIFY_RATE_LIMIT: RateLimitTierOptions = { limit: 30, ttl: 60_000 };

/**
 * Applied to `GET /calendar/feed/:token.ics` (17.4.1) — the second route in
 * this codebase reachable with no auth header and no `X-Tenant-ID` at all.
 * A phone calendar app re-polls a subscribed `.ics` URL on its own refresh
 * schedule (typically every 15-60 minutes), so this tier is sized for
 * automated polling rather than a human clicking a link: same 30/min cap
 * as `PUBLIC_INVOICE_RATE_LIMIT` (per issue #717's spec), generous enough
 * that a normal client's poll cadence never trips it, while still bounding
 * a brute-force scan across random 32-byte tokens.
 */
export const CALENDAR_FEED_RATE_LIMIT: RateLimitTierOptions = { limit: 30, ttl: 60_000 };

/**
 * Applied to `POST /public/admission/:slug/status` (#1042) — a public,
 * no-auth status check keyed by reference number + guardian phone (D-A),
 * same shape as `PUBLIC_INVOICE_RATE_LIMIT`'s per-token GET rather than the
 * submit route's `STRICT_RATE_LIMIT` (sized for the expensive write path).
 * 30/min per IP is generous for a guardian re-checking status while still
 * bounding a brute-force scan across reference numbers.
 */
export const ADMISSION_STATUS_RATE_LIMIT: RateLimitTierOptions = { limit: 30, ttl: 60_000 };

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Same digit shape as BD_PHONE_REGEX in modules/students/dto/students.dto.ts
// (kept as a separate constant rather than imported, since `common/` sits
// below feature modules in this codebase's layering) — that one is anchored
// (^...$) for whole-string DTO validation; this scans for the same shape as
// a substring inside a larger line (a URL, an error message), unanchored
// and global instead. Keep both in sync if the phone format ever changes.
const PHONE_PATTERN = /(?:\+?880|0)1[3-9]\d{8}/g;

// A single static alternation, not one dynamically-built RegExp per key —
// keeps this scannable at a glance and avoids a `new RegExp(variable)`
// pattern static analysis tools flag as a potential ReDoS vector even
// though these keys are a fixed internal list, never user input.
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:password|token|access_token|refresh_token|secret|api_key|apikey|device_key|devicekey|otp|code)=)[^&\s]+/gi;

// Same key list, shaped for a JSON `"key":"value"` pair instead of a query
// param — a Postgres constraint-violation DETAIL can echo the offending
// jsonb value verbatim (#8.7.11's tenant-settings column stores provider
// credentials), and that lands in `logQueryError`'s raw driver-error text,
// not a URL, so SENSITIVE_QUERY_PATTERN above doesn't reach it.
const SENSITIVE_JSON_VALUE_PATTERN =
  /("(?:password|token|accessToken|access_token|refreshToken|refresh_token|secret|apiKey|api_key|deviceKey|device_key|otp|code)"\s*:\s*)"(?:\\.|[^"\\])*"/gi;

/**
 * Scrubs email/phone-shaped substrings and known-sensitive query-param
 * values out of a line before it's logged (#36). Applied to request
 * URLs and error detail messages — the two places PII most often leaks
 * into logs, since neither is a structured object redact.util.ts's
 * key-based approach could walk.
 *
 * Deliberately tested against a *failing* request, not just a successful
 * one — a redaction helper that only runs on the happy path is worthless,
 * since the leak is usually in an error log written under debugging
 * pressure.
 */
export function redactPii(text: string): string {
  // Userinfo also runs on the raw text: decoding turns a password's `%2F`
  // into `/`, which ends the match and would leave the rest of it in the log.
  return applyRedaction(safeDecode(text.replace(URL_USERINFO_PATTERN, '$1[REDACTED]@')));
}

// A raw request URL/query string is commonly percent-encoded by the client
// (e.g. `admin%40example.com`) — matching only the literal, unencoded shape
// would let that straight through. Decoding first (defensively — a lone
// `%` not followed by two hex digits throws) catches both forms; only this
// log line's redacted text is affected, never anything returned to a client.
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// [PUB-07] Path segments that ARE bearer secrets: `/public/invoices/:token`,
// `/public/verify/:token`, `/public/notices/:token`, `/calendar/feed/:token.ics`. Here, not only in the
// pino serializer, so the exception filter and Sentry mask them too.
const SECRET_PATH_PATTERN =
  /(\/(?:public\/invoices|public\/verify|public\/notices|calendar\/feed)\/)[^/?\s"]+/g;

// [75.23] The SPA pages people open from a shared link: `/i/:token` (invoice
// receipt) `/v/:token` (certificate verify) and `/n/:token` (notice link). Only at the start of the
// URL (or of a log word), so `/api/v1/v/x` is never matched.
// Also after a scheme+host (`https://x.test:8080/i/tok`) or `key=`. The host
// part is length-capped so the lookbehind stays linear.
const SECRET_SPA_PATH_PATTERN = /(?<=^|[\s"=]|\/\/[^\s/"]{1,255})(\/[ivn]\/)[^/?\s"]+/g;

// A connection string's password: `postgres://app:pw@db:5432/x`, or with no
// username, `redis://:pw@redis:6379`. The host `db` has no TLD, so
// EMAIL_PATTERN misses it. Runs first, so a host with a TLD is not turned
// into one email. The password part is greedy up to the last `@` before a `/`,
// `?`, `#` or space, since safeDecode turns `%40` back into `@`. A raw `?`/`#`
// cannot be in a URL password, so `x.test:8080?next=a@b.com` is not userinfo.
const URL_USERINFO_PATTERN = /(\/\/[^\s/:@?#]*:)[^\s/?#]+@/g;

function applyRedaction(text: string): string {
  return text
    .replace(URL_USERINFO_PATTERN, '$1[REDACTED]@')
    .replace(SECRET_PATH_PATTERN, '$1[REDACTED]')
    .replace(SECRET_SPA_PATH_PATTERN, '$1[REDACTED]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
    .replace(SENSITIVE_QUERY_PATTERN, '$1[REDACTED]')
    .replace(SENSITIVE_JSON_VALUE_PATTERN, '$1"[REDACTED]"');
}

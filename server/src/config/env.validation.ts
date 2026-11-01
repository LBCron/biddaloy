import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';
import { isValidOrigin } from '../cors-origins';

const POSITIVE_INTEGER = /^[1-9]\d*$/;

const NODE_ENVS = ['development', 'test', 'production'] as const;

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  JWT_SECRET!: string;

  // Verify-only previous signing secret during a JWT_SECRET rotation (see
  // docs/architecture/08-security.md). An empty value counts as unset.
  @ValidateIf((o: EnvironmentVariables) => !!o.JWT_SECRET_PREVIOUS)
  @IsString()
  @MinLength(32)
  JWT_SECRET_PREVIOUS?: string;

  // Read straight off process.env by StorageService / HealthController;
  // declared so assertProductionConfig can vet them. Format is not checked.
  @IsOptional()
  @IsString()
  S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  HEALTH_TOKEN?: string;

  // Deploy stack name (prod | staging | demo); set by deploy/stack.yml. Free text here:
  // config-check --env judges the value, assertMessageSinkAllowed reads it.
  @IsOptional()
  @IsString()
  ENV_NAME?: string;

  // Test inbox (Epic 87). `mailpit` sends every message to the Mailpit sink; prod leaves it unset.
  @ValidateIf((o: EnvironmentVariables) => !!o.MESSAGE_SINK)
  @IsIn(['mailpit', 'real'])
  MESSAGE_SINK?: 'mailpit' | 'real';

  @ValidateIf((o: EnvironmentVariables) => !!o.MESSAGE_SINK_SMTP_URL)
  @IsUrl({ protocols: ['smtp'], require_protocol: true, require_tld: false })
  MESSAGE_SINK_SMTP_URL?: string;

  @ValidateIf((o: EnvironmentVariables) => !!o.MESSAGE_SINK_PUBLIC_URL)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  MESSAGE_SINK_PUBLIC_URL?: string;

  @IsOptional()
  @IsIn(NODE_ENVS)
  NODE_ENV?: string;

  @IsOptional()
  @IsString()
  PORT?: string;

  // Comma-separated allowlist, e.g. "https://app.example.com,https://admin.example.com".
  // Unset defaults to ['http://localhost:5173'] outside production and [] in
  // production — see resolveCorsOrigins in cors-origins.ts.
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  // Postgres TLS — see db-ssl.ts. Required (must be exactly "true") in
  // production; refuses to boot otherwise. Optional elsewhere.
  @IsOptional()
  @IsString()
  DB_SSL?: string;

  @IsOptional()
  @IsString()
  DB_SSL_REJECT_UNAUTHORIZED?: string;

  // Global rate-limit tier — see rate-limit.ts. Unset defaults to 100
  // requests/60s per tracked identity (authenticated user, else IP).
  // Must be a positive integer string: ThrottlerModule treats a
  // non-numeric, zero, or negative ttl/limit as a startup-time footgun
  // (NaN or a rejecting-everything bucket), so malformed values fail
  // fast here instead of surfacing as unpredictable behavior per request.
  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: 'RATE_LIMIT_DEFAULT_LIMIT must be a positive integer' })
  RATE_LIMIT_DEFAULT_LIMIT?: string;

  // Step-up approval verifications allowed per approver / actor per 15 min
  // (step-up.service.ts). Unset keeps the strict default of 5. Exists for the
  // e2e job only: every spec approves as the one seeded admin, so the suite
  // shares a single budget. Never raise it in a real deployment.
  @IsOptional()
  @Matches(POSITIVE_INTEGER, {
    message: 'STEP_UP_RATE_LIMIT_MAX_ATTEMPTS must be a positive integer',
  })
  STEP_UP_RATE_LIMIT_MAX_ATTEMPTS?: string;

  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: 'RATE_LIMIT_DEFAULT_TTL_MS must be a positive integer' })
  RATE_LIMIT_DEFAULT_TTL_MS?: string;

  // Login lockout policy — see login-attempt.service.ts. Unset defaults to
  // 5 failed attempts / 15 minutes.
  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: 'LOGIN_LOCKOUT_THRESHOLD must be a positive integer' })
  LOGIN_LOCKOUT_THRESHOLD?: string;

  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: 'LOGIN_LOCKOUT_WINDOW_MS must be a positive integer' })
  LOGIN_LOCKOUT_WINDOW_MS?: string;

  // Access/refresh token lifetimes — see auth.module.ts. Unset defaults to
  // a 15-minute access token and a 30-day refresh token (README's "Session
  // & token lifecycle" section has the full rotation/revocation policy).
  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: 'ACCESS_TOKEN_TTL_MS must be a positive integer' })
  ACCESS_TOKEN_TTL_MS?: string;

  @IsOptional()
  @Matches(POSITIVE_INTEGER, { message: 'REFRESH_TOKEN_TTL_MS must be a positive integer' })
  REFRESH_TOKEN_TTL_MS?: string;

  // Swagger docs gate — see swagger.ts/docs-auth.ts. Docs always mount
  // outside production; in production only when this is exactly "true",
  // and then only behind API_DOCS_USER/API_DOCS_PASSWORD Basic Auth.
  @IsOptional()
  @IsString()
  ENABLE_API_DOCS?: string;

  @IsOptional()
  @IsString()
  API_DOCS_USER?: string;

  @IsOptional()
  @IsString()
  API_DOCS_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMS_PROVIDER?: string;

  @IsOptional()
  @IsString()
  GREENWEB_API_KEY?: string;

  @IsOptional()
  @IsString()
  GREENWEB_API_URL?: string;

  @IsOptional()
  @IsString()
  MIMSMS_API_KEY?: string;

  @IsOptional()
  @IsString()
  MIMSMS_SENDER_ID?: string;

  @IsOptional()
  @IsString()
  MIMSMS_API_URL?: string;

  @IsOptional()
  @IsString()
  ONECODESOFT_API_KEY?: string;

  @IsOptional()
  @IsString()
  ONECODESOFT_SENDER_ID?: string;

  @IsOptional()
  @IsString()
  ONECODESOFT_API_URL?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_ACCESS_TOKEN?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PHONE_NUMBER_ID?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsString()
  SMTP_PORT?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  // AES-256-GCM key for tenant-settings secrets (schools.settings jsonb
  // fields marked @Secret() — see server/src/modules/schools/settings).
  // Base64, must decode to exactly 32 bytes — see encryption-key.ts for
  // the format/production-required check; format alone is validated here,
  // no different from any other env var, but "required in production" is
  // a runtime check (like DB_SSL's) rather than something class-validator
  // can express against NODE_ENV cleanly.
  @IsOptional()
  @IsString()
  SETTINGS_ENCRYPTION_KEY?: string;

  // A key rotation still in its grace window — accepted for *decrypting*
  // rows not yet re-encrypted under SETTINGS_ENCRYPTION_KEY, never used to
  // encrypt new writes. Comma-separated for more than one prior key.
  @IsOptional()
  @IsString()
  SETTINGS_ENCRYPTION_KEY_PREVIOUS?: string;

  // Base URL of the staff SPA — invitation/reset links target
  // `${APP_BASE_URL}/activate?token=...` etc. Defaults to
  // http://localhost:5174 outside production; required (checked at
  // runtime, like DB_SSL) in production.
  @IsOptional()
  @IsString()
  APP_BASE_URL?: string;

  // See account-access-echo.ts — must never be "true" in production.
  @IsOptional()
  @IsString()
  ACCOUNT_ACCESS_ECHO_SECRETS?: string;

  // The one tenant/School row that designates a user's SUPER_ADMIN
  // membership as a genuine platform admin (see context.guard.ts). Unset
  // means NO membership carries platform authority — fails closed, never
  // open. In production this MUST be set by hand to the real platform
  // school's id (`seed.ts` itself refuses to run against production, so
  // there is no script-known id to default to there, and this validator
  // has no database access to look one up either). Outside production, left
  // unset here on purpose: `TenantStatusService.platformTenantId()` resolves
  // it at request time instead, by looking up the school with the
  // well-known slug `default-school` and caching whatever id it finds — see
  // that method's own comment for why a *config-time* default here doesn't
  // work (no database actually has a predictable hardcoded id; the
  // `MultiTenantAuth` migration creates that row with a random uuid, #620).
  @IsOptional()
  @IsString()
  PLATFORM_TENANT_ID?: string;

  // [17.2.4] Timeout for each outbound call `PublicHolidayFetchService`
  // makes (Google ICS, then the Nager.Date fallback). Unset defaults to
  // 8000ms — see `PublicHolidayFetchService.timeoutMs()`.
  @IsOptional()
  @Matches(POSITIVE_INTEGER, {
    message: 'PUBLIC_HOLIDAY_FETCH_TIMEOUT_MS must be a positive integer',
  })
  PUBLIC_HOLIDAY_FETCH_TIMEOUT_MS?: string;

  // Billing [49.4]. Seats are free until this instant; checked in
  // assertProductionConfig and parsed by billingFreeUntil().
  @IsOptional()
  @IsISO8601({ strict: true })
  BILLING_FREE_UNTIL?: string;

  @IsOptional()
  @IsString()
  BKASH_BASE_URL?: string;

  // VAT registration number printed on seat receipts; unset = no VAT line (Epic 62 #1779).
  @IsOptional()
  @IsString()
  BILLING_VAT_REGISTRATION?: string;

  @IsOptional()
  @IsString()
  BKASH_APP_KEY?: string;

  @IsOptional()
  @IsString()
  BKASH_APP_SECRET?: string;

  @IsOptional()
  @IsString()
  BKASH_USERNAME?: string;

  @IsOptional()
  @IsString()
  BKASH_PASSWORD?: string;

  // Comma-separated phone prefixes OTP SMS may go to; default "+880".
  @IsOptional()
  @IsString()
  OTP_SMS_ALLOWED_PREFIXES?: string;

  @IsOptional()
  @IsString()
  TURNSTILE_SECRET_KEY?: string;

  // Public values served to the SPA at /runtime-config.js (runtime-config.ts).
  @IsOptional()
  @IsString()
  TURNSTILE_SITE_KEY?: string;

  @IsOptional()
  @IsString()
  SENTRY_DSN_WEB?: string;

  @IsOptional()
  @IsString()
  SENTRY_ENVIRONMENT?: string;

  // A fraction from 0 to 1, e.g. "0.1". Empty = unset (compose passes '' for an unset var).
  @IsOptional()
  @Matches(/^$|^(0(\.\d+)?|1(\.0+)?)$/, {
    message: 'SENTRY_TRACES_SAMPLE_RATE must be between 0 and 1',
  })
  SENTRY_TRACES_SAMPLE_RATE?: string;

  @IsOptional()
  @IsString()
  APP_VERSION?: string;

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  FACEBOOK_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  FACEBOOK_OAUTH_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  SUPPORT_CONTACT_URL?: string;

  // Public demo deployment [58.1.01]. Exactly "true" switches on the demo
  // guards (see modules/demo); anything else leaves behaviour untouched.
  @IsOptional()
  @IsIn(['true', 'false'])
  DEMO_MODE?: string;

  // The one shared password of every demo login, shown on the role cards.
  @ValidateIf((o: EnvironmentVariables) => o.DEMO_MODE === 'true')
  @IsString()
  @MinLength(8)
  DEMO_PASSWORD?: string;
}

/** The fixed id `seed.ts` gives its "Default School" row when it has to
 * create one from scratch (a database with neither a `default-school`
 * slug nor this id already present). Purely a seed-script convenience for
 * a predictable dev/e2e fixture id — NOT used to resolve platform
 * authority anymore (see `PLATFORM_TENANT_ID`'s own comment above and
 * `TenantStatusService.platformTenantId()`, which discovers the
 * platform tenant from the database instead of assuming this id). Never
 * used in production (`seed.ts` refuses to run there). */
export const DEV_SEED_PLATFORM_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export const BILLING_FREE_UNTIL_DEFAULT = '2027-01-01T00:00:00+06:00';

/** Parsed BILLING_FREE_UNTIL (default 2027-01-01T00:00+06:00). */
export function billingFreeUntil(raw = process.env.BILLING_FREE_UNTIL): Date {
  return new Date(raw || BILLING_FREE_UNTIL_DEFAULT);
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  if (config.NODE_ENV === 'production') {
    assertProductionConfig(config);
  }

  return validatedConfig;
}

const PLACEHOLDER = /change-?me|replace-?me|do-not-use|placeholder|example/i;
const PLACEHOLDER_KEYS = [
  'JWT_SECRET',
  'JWT_SECRET_PREVIOUS',
  'SETTINGS_ENCRYPTION_KEY',
  'POSTGRES_PASSWORD', // compose builds the container's DATABASE_URL from it
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'API_DOCS_PASSWORD',
  'SMTP_PASSWORD',
  'HEALTH_TOKEN',
] as const;

/**
 * [87 D22] The test inbox lives only on non-prod stacks: prod must never use it, and staging
 * and demo must always use it (so no real message leaves them). Names the variable, never a
 * value. An unknown `envName` (dev, CI, tests) passes. Staging alone may opt out with
 * `ALLOW_REAL_PROVIDERS_ON_STAGING=true` (real providers, real messages); demo and prod never can.
 */
export function assertMessageSinkAllowed(
  envName: string | undefined,
  messageSink: string | undefined,
  allowRealOnStaging?: string,
): void {
  if (envName === 'staging' && allowRealOnStaging === 'true') return;
  if (envName === 'prod' && messageSink === 'mailpit') {
    throw new Error('MESSAGE_SINK must not be mailpit on prod');
  }
  if ((envName === 'staging' || envName === 'demo') && messageSink !== 'mailpit') {
    throw new Error(`MESSAGE_SINK must be mailpit on ${envName}`);
  }
}

/**
 * Production-only boot guard (D21): collects every problem and throws one
 * error. Messages name variables, never their values. Only called when
 * NODE_ENV=production, so dev, test and CI env files are unaffected.
 */
export function assertProductionConfig(config: Record<string, unknown>): void {
  const str = (k: string): string => (typeof config[k] === 'string' ? (config[k] as string) : '');
  const problems: string[] = [];

  for (const key of PLACEHOLDER_KEYS) {
    if (PLACEHOLDER.test(str(key))) problems.push(`${key} still holds a placeholder value`);
  }
  try {
    const password = decodeURIComponent(new URL(str('DATABASE_URL')).password);
    if (PLACEHOLDER.test(password)) {
      problems.push('DATABASE_URL password still holds a placeholder value');
    }
  } catch {
    // Malformed URL or escape: the database driver reports it more clearly.
  }

  for (const key of ['JWT_SECRET', 'JWT_SECRET_PREVIOUS']) {
    const secret = str(key);
    if (secret && (/^\d+$/.test(secret) || /^(.+?)\1+$/.test(secret) || new Set(secret).size < 8)) {
      // All digits, one substring repeated ('abcde123'.repeat(4)), or under 8
      // distinct symbols ('a'.repeat(40)). Random hex of the minimum 32
      // characters trips none of these far less than once in a million draws;
      // the old bar of 11 distinct refused ~0.2% of them. A floor, not an
      // entropy check: 'password1234password1234password' still passes.
      problems.push(
        `${key} is too weak (all digits, a repeated pattern, or under 8 distinct characters)`,
      );
    }
  }
  if (str('JWT_SECRET') && str('JWT_SECRET') === str('SETTINGS_ENCRYPTION_KEY')) {
    problems.push('JWT_SECRET must differ from SETTINGS_ENCRYPTION_KEY');
  }
  if (str('JWT_SECRET') && str('JWT_SECRET') === str('JWT_SECRET_PREVIOUS')) {
    problems.push('JWT_SECRET must differ from JWT_SECRET_PREVIOUS');
  }

  const freeUntil = str('BILLING_FREE_UNTIL');
  // An offset (Z or +06:00) is required: without it the instant depends on the server's timezone.
  if (
    freeUntil &&
    (Number.isNaN(Date.parse(freeUntil)) || !/(Z|[+-]\d{2}:?\d{2})$/i.test(freeUntil))
  ) {
    problems.push('BILLING_FREE_UNTIL must be an ISO-8601 date with an explicit offset');
  }

  for (const key of ['SETTINGS_ENCRYPTION_KEY', 'APP_BASE_URL', 'PUBLIC_APP_URL']) {
    if (!str(key)) problems.push(`${key} is required in production`);
  }

  const origins = str('CORS_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.some((o) => !isValidOrigin(o))) {
    problems.push(
      'CORS_ORIGINS has an entry that is not a bare origin (expected e.g. https://app.school.org, no path or trailing slash)',
    );
  }

  if (Boolean(str('TURNSTILE_SITE_KEY')) !== Boolean(str('TURNSTILE_SECRET_KEY'))) {
    problems.push('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set together or not at all');
  }

  if (str('OUTBOUND_TEST_ALLOW_LOOPBACK')) {
    problems.push('OUTBOUND_TEST_ALLOW_LOOPBACK is a test-only flag and must not be set');
  }

  if (problems.length > 0) {
    throw new Error(`Refusing to start with unsafe production config:\n- ${problems.join('\n- ')}`);
  }
}

import * as Sentry from '@sentry/node';
import type { ErrorEvent, Breadcrumb, Exception } from '@sentry/node';
import { Logger } from '@nestjs/common';
import { redactPii } from './redact-log.util';

const logger = new Logger('Sentry');

/**
 * [15.1.1] Server-side Sentry bootstrap. Mirrors `ui/src/api/sentry.ts`'s
 * "missing config degrades gracefully" shape: no `SENTRY_DSN` means this is
 * a no-op and `Sentry.getClient()` stays undefined for the life of the
 * process — every call site that reports through Sentry (the exception
 * filter, the communications worker) must tolerate that.
 *
 * A malformed DSN is different: `Sentry.init` doesn't validate its shape
 * itself (an invalid DSN just silently drops events), so this checks it
 * with the `new URL()` constructor and throws at boot — a typo'd DSN
 * should fail loudly in CI/deploy, not "work" by quietly sending nothing.
 *
 * `event.request`/breadcrumb/exception scrubbing lives in `beforeSend`
 * below, reusing `redactPii` from `redact-log.util.ts` rather than a
 * second redaction list (same policy as `ui/src/api/sentry.ts`, which
 * duplicates the *patterns* because it can't reach across the ui/server
 * package boundary — server code has no such excuse).
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.log('SENTRY_DSN not set — Sentry is disabled (no-op).');
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    throw new Error(`SENTRY_DSN is set but not a valid URL — refusing to boot: "${dsn}"`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`SENTRY_DSN must use https — refusing to boot: "${dsn}"`);
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: resolveTracesSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
    // [15.1.5]: `httpIntegration` is already one of the Node SDK's default
    // integrations — it's what parses an incoming `sentry-trace`/`baggage`
    // header pair and continues that trace instead of starting a new one,
    // which is the entire point of this ticket. Appended to (not replacing)
    // the defaults via the function form, so console/native-fetch/etc.
    // integrations this SDK also registers by default are unaffected.
    // `cors-origins.ts`'s `allowedHeaders` is what lets those two headers
    // survive a browser preflight to reach here at all.
    integrations: (defaults) => [...defaults, Sentry.httpIntegration()],
    // SDK v11 dropped `sendDefaultPii` and its `dataCollection` defaults
    // collect everything, so each PII source is switched off explicitly.
    // No request payload, headers, cookies, query string or user context is
    // ever attached automatically.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => redactBreadcrumb(breadcrumb),
  });
}

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

function resolveTracesSampleRate(value: string | undefined): number {
  const rate = value === undefined || value === '' ? NaN : Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }
  return rate;
}

function redactException(values: Exception[] | undefined): Exception[] | undefined {
  return values?.map((value) =>
    value.value !== undefined ? { ...value, value: redactPii(value.value) } : value,
  );
}

function redactBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return breadcrumb.message !== undefined
    ? { ...breadcrumb, message: redactPii(breadcrumb.message) }
    : breadcrumb;
}

/**
 * `event.request` is deleted wholesale rather than allow-listed — the
 * exception filter never attaches one to begin with (see its tags-only
 * `Sentry.withScope` call), so this is defense-in-depth against a future
 * capture site, or the Node SDK's own request-data integration, adding one.
 */
function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed: ErrorEvent = { ...event };

  if (scrubbed.message !== undefined) {
    scrubbed.message = redactPii(scrubbed.message);
  }
  if (scrubbed.exception?.values) {
    scrubbed.exception = { ...scrubbed.exception, values: redactException(scrubbed.exception.values) };
  }
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map(redactBreadcrumb);
  }
  delete scrubbed.request;

  return scrubbed;
}

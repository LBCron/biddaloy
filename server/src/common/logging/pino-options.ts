import { Params } from 'nestjs-pino';
import { IncomingMessage, ServerResponse } from 'http';
import { Request } from 'express';
import { redactPii } from '../redact-log.util';
import { resolveRequestId } from '../request-context.util';

interface RequestWithTenant extends Request {
  currentTenant?: { id: string };
}

/**
 * [15.1.2]: one JSON log line per request in production — request_id,
 * tenant_id, route template, status, duration_ms, error_class — nothing
 * else. Development keeps `pino-pretty`'s human-readable output, same
 * split as `ui/src/api/sentry.ts` and this module's own `sentry.ts` use
 * for "does this need to be machine-parseable".
 *
 * Everything that could carry PII (headers, body, query string) is
 * dropped by the `serializers` below rather than logged and redacted —
 * redaction is a second layer applied only to the few string fields that
 * are still free-form (the URL's own path/query and the error message),
 * reusing `redactPii` rather than a second redaction list.
 */
/** nestjs-pino also accepts a stream or [options, stream]; this module only ever builds options. */
type PinoHttpOptions = Extract<NonNullable<Params['pinoHttp']>, { serializers?: unknown }>;

export function buildPinoOptions(nodeEnv: string | undefined): PinoHttpOptions {
  const isProduction = nodeEnv === 'production';

  return {
    // Ties every log line to the same id `AllExceptionsFilter` puts in
    // `X-Request-Id` and in Sentry's `request_id` tag — mutating the
    // incoming header (rather than only setting `req.id`) means the
    // filter's own `X-Request-Id` header read later in the chain reuses
    // this exact id instead of minting a second one when none arrived.
    genReqId: (req: IncomingMessage) => {
      const id = resolveRequestId(req as Request);
      req.headers['x-request-id'] = id;
      return id;
    },
    transport: isProduction ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
    customProps: (req: IncomingMessage) => {
      const request = req as RequestWithTenant;
      return {
        request_id: request.headers['x-request-id'],
        tenant_id: request.currentTenant?.id ?? null,
        route: request.route?.path ?? null,
      };
    },
    serializers: {
      req: (req: IncomingMessage & { url?: string; route?: { path?: string } }) => ({
        method: req.method,
        // [666]/PUB-07 `redactPii` masks secret path tokens
        // (`/public/invoices/:token`, `/public/verify/:token`, `/public/notices/:token`,
        // `/calendar/feed/:token.ics`) as well as `?token=`-style params.
        url: req.url ? redactPii(req.url) : req.url,
        route: req.route?.path ?? null,
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      err: (err: Error) => ({
        error_class: err.constructor.name,
        message: redactPii(err.message),
        ...(isProduction ? {} : { stack: err.stack }),
      }),
    },
    // Liveness/readiness are polled constantly (uptime monitors, container
    // healthchecks) — logging every hit would drown real request logs in
    // noise for zero operational value.
    customLogLevel: (req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (req.url?.startsWith('/api/health')) return 'silent';
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  };
}

import { ExceptionFilter, Catch, ArgumentsHost, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { buildErrorResponseBody, resolveDetailMessage, resolveStatus } from './error-response';
import { mapKnownError } from './known-errors';
import { redactPii } from '../redact-log.util';
import { resolveRequestId } from '../request-context.util';

interface RequestWithTenant extends Request {
  currentTenant?: { id: string };
}

/**
 * The `path` an error body shows: the matched route pattern (`/api/v1/students/:id`), not the
 * URL, so a body never echoes a host name, an id or a query string the caller sent (Rule 23).
 * An unmatched route has no pattern and keeps the URL (Nest's own 404 text names it anyway).
 */
export function errorPath(request: Request): string {
  const pattern: unknown = request.route?.path;
  return typeof pattern === 'string' ? pattern : request.url;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly nodeEnv: string | undefined = process.env.NODE_ENV) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithTenant>();

    const requestId = resolveRequestId(request);

    const mapped = mapKnownError(exception) ?? exception;
    const status = resolveStatus(mapped);
    const body = buildErrorResponseBody(mapped, {
      path: errorPath(request),
      requestId,
      nodeEnv: this.nodeEnv,
    });

    // Logged detail is never suppressed, even in production — that's what
    // lets support map a user-reported requestId back to the real cause.
    // Redacted before logging (not before building `body` above) — the
    // client-facing response is unaffected, only what lands in logs. The
    // request body itself (e.g. a login password) is never included here.
    // The stack is redacted too, separately — Logger.error's second
    // argument isn't covered by the first-argument redactPii() call above
    // it, and Error.stack's own first line repeats the exception's message
    // (which is exactly where PII a query failed on tends to surface).
    const detail = resolveDetailMessage(exception);
    this.logger.error(
      redactPii(
        `${request.method} ${request.url} → ${status}: ${Array.isArray(detail) ? detail.join('; ') : detail} [requestId=${requestId}]`,
      ),
      exception instanceof Error && exception.stack ? redactPii(exception.stack) : undefined,
    );

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.captureToSentry(exception, request, status, requestId);
    }

    response.setHeader('X-Request-Id', requestId);
    response.status(status).json(body);
  }

  /**
   * [15.1.1]: only 5xx (server-caused) failures are worth an on-call
   * looking at — a 4xx is a normal, expected response to a bad request.
   * Tags only — the request object itself, its headers, body, and query
   * are never attached (`sentry.ts`'s `beforeSend` also strips
   * `event.request` as a second layer of defense). A no-op when
   * `SENTRY_DSN` is unset: `Sentry.captureException` is safe to call with
   * no client configured.
   */
  private captureToSentry(
    exception: unknown,
    request: RequestWithTenant,
    status: number,
    requestId: string,
  ): void {
    Sentry.withScope((scope) => {
      scope.setTag('route', request.route?.path ?? request.path);
      scope.setTag('request_id', requestId);
      scope.setTag('http_status', status);
      if (request.currentTenant?.id) {
        scope.setTag('tenant_id', request.currentTenant.id);
      }
      Sentry.captureException(exception);
    });
  }
}

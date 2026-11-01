import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';

import { TENANT_STATUS_REDIS } from '../../modules/schools/tenant-status.service';

/**
 * [2631] Collapses a repeated `Idempotency-Key` on a create/send route into one run.
 *
 * ```mermaid
 * flowchart LR
 *   A[request + key] --> B{Redis reserve OK?}
 *   B -- yes --> C[run handler, store answer 24h]
 *   B -- already stored --> D[replay stored answer, handler skipped]
 *   B -- Redis down --> E[run handler unprotected, log]
 * ```
 *
 * No header: nothing changes. This is the one route family that FAILS OPEN when Redis is
 * down on purpose (D4): a lost guard is a possible double send, a closed route is a school
 * that cannot message anyone. See 08-security.md, Rule 15.
 *
 * Decorated: communications `send`, `reminder/bulk`, `reminder/single/:studentId`,
 * `invoices/:id/send`, `promotions` (create), `students` (create), `schools/:id/settings/test`
 * (the key is required only with `sendTo`, which sends a real test message),
 * `communications/logs/:id/check-status` (a double click asks the vendor once).
 *
 * Exempt, with the reason (D23):
 * - `POST exams/:examId/results/sms`: deduped by the unique `reference_key` (result-sms.service.ts).
 * - `POST students/bulk-upload/commit`: single-use staging id.
 * - `POST fees/generate`, `fees/schedules/run-now`, `fees/fines/generate`: skip periods that
 *   already ran (DB-level uniqueness; checked in the PR).
 * - `POST fees/fines`: manual fine, not a bulk send; its dialog joins the UI sweep (#2656).
 *
 * The replay answers with the route's normal status (Nest applies it after the interceptor),
 * so the second answer is the same 201 as the first.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const IN_FLIGHT = 'IN_FLIGHT';
/** A handler running longer than this loses its reservation (a second run is then possible). */
const IN_FLIGHT_TTL_MS = 120_000;
const RESULT_TTL_SECONDS = 24 * 60 * 60;

interface IdempotentRequest extends Request {
  currentTenant?: { id: string };
  user?: { sub?: string };
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(@Inject(TENANT_STATUS_REDIS) private readonly redis: Redis) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<IdempotentRequest>();
    const header = request.headers['idempotency-key'];
    if (header === undefined) return next.handle();
    // Fixed sentence: never echo the submitted value (Rule 23).
    if (typeof header !== 'string' || !KEY_PATTERN.test(header)) {
      throw new BadRequestException(
        'Idempotency-Key must be 1 to 64 letters, digits, dashes or underscores.',
      );
    }

    // The real URL, not the route pattern: one key on `/invoices/A/send` must never replay
    // into `/invoices/B/send` [2683].
    const target = `${request.method} ${request.originalUrl ?? request.url}`;
    const key = `idem:${request.currentTenant?.id ?? '-'}:${request.user?.sub ?? '-'}:${target}:${header}`;

    let stored: string | null;
    try {
      const reserved = await this.redis.set(key, IN_FLIGHT, 'PX', IN_FLIGHT_TTL_MS, 'NX');
      stored = reserved === 'OK' ? null : await this.redis.get(key);
      // Expired between SET and GET: nothing to replay, run unprotected.
      if (reserved !== 'OK' && stored === null) return next.handle();
    } catch (error) {
      this.logRedisFailure('reserve', error);
      return next.handle();
    }

    if (stored === IN_FLIGHT) {
      throw new ConflictException('This request is already being processed.');
    }
    if (stored !== null) {
      try {
        return of((JSON.parse(stored) as { body: unknown }).body);
      } catch {
        // Corrupt stored answer: treat as a miss, drop it and run again [2683].
        this.logger.error('Idempotency replay value was unreadable; key dropped.');
        await this.release(key);
        return this.intercept(context, next);
      }
    }

    return next.handle().pipe(
      mergeMap(async (body) => {
        try {
          await this.redis.set(key, JSON.stringify({ body }), 'EX', RESULT_TTL_SECONDS);
        } catch (error) {
          this.logRedisFailure('store', error);
          await this.release(key);
        }
        return body;
      }),
      // ANY error frees the key so a corrected retry (e.g. after an SMS top-up) runs again.
      catchError((error: unknown) =>
        from(this.release(key)).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private async release(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logRedisFailure('release', error);
    }
  }

  // No key and no body in the log: both carry tenant/user data.
  private logRedisFailure(step: string, error: unknown): void {
    this.logger.error(
      `Idempotency ${step} failed, request ran unprotected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

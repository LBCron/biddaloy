import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './http-exception.filter';

const { mockSetTag } = vi.hoisted(() => ({ mockSetTag: vi.fn() }));
vi.mock('@sentry/node', () => ({
  withScope: vi.fn((callback: (scope: { setTag: typeof mockSetTag }) => void) =>
    callback({ setTag: mockSetTag }),
  ),
  captureException: vi.fn(),
}));

describe('AllExceptionsFilter', () => {
  let mockJson: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;
  let mockSetHeader: ReturnType<typeof vi.fn>;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    mockJson = vi.fn();
    mockStatus = vi.fn().mockReturnValue({ json: mockJson });
    mockSetHeader = vi.fn();
    mockResponse = { status: mockStatus, setHeader: mockSetHeader };
    mockRequest = { method: 'GET', url: '/test', headers: {} };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockSetTag.mockClear();
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.withScope).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Protects the public error-response contract: clients (the SPAs) rely on
  // 4xx messages to act on validation/auth/tenant errors, in every environment.
  it('passes a 4xx message through unchanged in production', () => {
    const filter = new AllExceptionsFilter('production');

    filter.catch(new BadRequestException('Validation failed'), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: HttpStatus.BAD_REQUEST, message: 'Validation failed' }),
    );
  });

  // Protects production data confidentiality: a wrapped TypeORM error or an
  // InternalServerErrorException(err.message) can carry a query fragment,
  // column name, or connection string — this must never reach the client.
  it('suppresses 5xx detail in production', () => {
    const filter = new AllExceptionsFilter('production');
    const exception = new InternalServerErrorException('relation "users" does not exist');

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = mockJson.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(body.stack).toBeUndefined();
  });

  it('passes a ValidationPipe-style array message through as an array', () => {
    const filter = new AllExceptionsFilter('production');

    filter.catch(
      new BadRequestException(['name should not be empty', 'email must be an email']),
      mockHost,
    );

    const body = mockJson.mock.calls[0][0];
    expect(body.message).toEqual(['name should not be empty', 'email must be an email']);
  });

  it('includes 5xx detail and stack outside production', () => {
    const filter = new AllExceptionsFilter('development');
    const exception = new InternalServerErrorException('relation "users" does not exist');

    filter.catch(exception, mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.message).toBe('relation "users" does not exist');
    expect(body.stack).toBe(exception.stack);
  });

  it('suppresses a non-HttpException 500 in production and logs the real detail', () => {
    const filter = new AllExceptionsFilter('production');
    const exception = new Error('connection to postgres://user:pass@host failed');

    filter.catch(exception, mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    // The real detail is logged, minus the URL password (redactPii, Rule 13).
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('connection to postgres://user:[REDACTED]@host failed'),
      expect.stringContaining('connection to postgres://user:[REDACTED]@host failed'),
    );
    expect(JSON.stringify(vi.mocked(Logger.prototype.error).mock.calls)).not.toContain('pass@');
  });

  it('generates a requestId, returns it in the body and the X-Request-Id header', () => {
    const filter = new AllExceptionsFilter('production');

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(typeof body.requestId).toBe('string');
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(mockSetHeader).toHaveBeenCalledWith('X-Request-Id', body.requestId);
  });

  it('reuses an incoming X-Request-Id header instead of generating a new one', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.headers['x-request-id'] = 'client-supplied-id';

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.requestId).toBe('client-supplied-id');
    expect(mockSetHeader).toHaveBeenCalledWith('X-Request-Id', 'client-supplied-id');
  });

  it('replaces an incoming X-Request-Id that is not plain, in body and header', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.headers['x-request-id'] = 'has a space';

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.requestId).not.toBe('has a space');
    expect(mockSetHeader).toHaveBeenCalledWith('X-Request-Id', body.requestId);
  });

  it('includes the requestId in the server-side log line', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.headers['x-request-id'] = 'log-correlation-id';

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockHost);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('[requestId=log-correlation-id]'),
      expect.any(String),
    );
  });

  it('defaults nodeEnv from process.env.NODE_ENV when not passed', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      const filter = new AllExceptionsFilter();
      const exception = new InternalServerErrorException('leaky detail');

      filter.catch(exception, mockHost);

      const body = mockJson.mock.calls[0][0];
      expect(body.message).toBe('Internal server error');
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('includes timestamp and path in the response body', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.url = '/api/things';

    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.path).toBe('/api/things');
    expect(typeof body.timestamp).toBe('string');
    // new Date(invalid) returns an Invalid Date rather than throwing, so
    // Date.parse is the assertion that can actually fail on a bad string.
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  // Rule 23: the body's path is the route pattern, so it never echoes the host name, id or
  // query string the caller sent.
  it('uses the matched route pattern as the path, never the raw URL', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.url = '/api/v1/public/site/by-host/secret.example/manifest?q=leak';
    mockRequest.route = { path: '/api/v1/public/site/by-host/:host/manifest' };

    filter.catch(new NotFoundException('site.not_found'), mockHost);

    const body = mockJson.mock.calls[0][0];
    expect(body.path).toBe('/api/v1/public/site/by-host/:host/manifest');
    expect(JSON.stringify(body)).not.toContain('secret.example');
    expect(JSON.stringify(body)).not.toContain('leak');
  });

  it('handles null/undefined exceptions with 500', () => {
    const filter = new AllExceptionsFilter('production');

    filter.catch(null, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockJson.mock.calls[0][0].message).toBe('Internal server error');
  });

  // Tested against a genuinely failing request, not a successful one — a
  // redaction helper that only runs on the happy path is worthless, since
  // the leak is usually in an error log written under debugging pressure.
  it('redacts PII from the request URL before logging a failing request', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.url = '/api/v1/students?email=guardian@example.com';

    filter.catch(new BadRequestException('Invalid query'), mockHost);

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.not.stringContaining('guardian@example.com'),
      expect.anything(),
    );
  });

  it("redacts PII embedded in the exception's own detail message", () => {
    const filter = new AllExceptionsFilter('development');
    const exception = new InternalServerErrorException('duplicate key for guardian@example.com');

    filter.catch(exception, mockHost);

    const loggedArgs = (Logger.prototype.error as any).mock.calls.flat();
    expect(
      loggedArgs.some(
        (arg: unknown) => typeof arg === 'string' && arg.includes('[REDACTED_EMAIL]'),
      ),
    ).toBe(true);
    expect(
      loggedArgs.some(
        (arg: unknown) => typeof arg === 'string' && arg.includes('guardian@example.com'),
      ),
    ).toBe(false);
  });

  // 12.3's forgot-password/reset-password flow: a 6-digit code preceded by
  // `otp=` (e.g. a query-string echo in an error message) must never reach
  // the logs in the clear — same shape as password/token above, extended
  // to the otp/code keys.
  it("redacts a 6-digit OTP embedded in the exception's detail message", () => {
    const filter = new AllExceptionsFilter('development');
    const exception = new InternalServerErrorException('reset failed for ?otp=123456&phone=x');

    filter.catch(exception, mockHost);

    const loggedArgs = (Logger.prototype.error as any).mock.calls.flat();
    expect(
      loggedArgs.some((arg: unknown) => typeof arg === 'string' && arg.includes('[REDACTED]')),
    ).toBe(true);
    expect(
      loggedArgs.some((arg: unknown) => typeof arg === 'string' && arg.includes('123456')),
    ).toBe(false);
  });

  // Logger.error's stack argument is a separate parameter from the message
  // redactPii() is applied to — and Error.stack's own first line repeats
  // the exception's message, so it carries the same PII if left unredacted.
  it('redacts PII from the exception stack, not just the message', () => {
    const filter = new AllExceptionsFilter('development');
    const exception = new InternalServerErrorException('duplicate key for guardian@example.com');

    filter.catch(exception, mockHost);

    expect(exception.stack).toContain('guardian@example.com');
    const loggedArgs = (Logger.prototype.error as any).mock.calls.flat();
    expect(
      loggedArgs.some(
        (arg: unknown) => typeof arg === 'string' && arg.includes('guardian@example.com'),
      ),
    ).toBe(false);
  });

  // The login path carries a plaintext password in the request body — this
  // filter must never reference request.body at all, in any form.
  it('never logs the request body, even when it carries a password', () => {
    const filter = new AllExceptionsFilter('development');
    mockRequest.body = { email: 'admin@example.com', password: 'hunter2' };

    filter.catch(new BadRequestException('Invalid credentials'), mockHost);

    const loggedArgs = (Logger.prototype.error as any).mock.calls.flat();
    expect(
      loggedArgs.some((arg: unknown) => typeof arg === 'string' && arg.includes('hunter2')),
    ).toBe(false);
  });

  // [15.1.1] — a 5xx is the one class of failure worth paging on; Sentry
  // capture must fire with route/tenant/request-id/status tags and never
  // touch the request object itself.
  it('captures a 5xx to Sentry with route/tenant/request_id/http_status tags', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.route = { path: '/api/v1/students/:id' };
    mockRequest.currentTenant = { id: 'tenant-123' };
    mockRequest.headers['x-request-id'] = 'req-abc';

    filter.catch(new InternalServerErrorException('boom'), mockHost);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(mockSetTag).toHaveBeenCalledWith('route', '/api/v1/students/:id');
    expect(mockSetTag).toHaveBeenCalledWith('tenant_id', 'tenant-123');
    expect(mockSetTag).toHaveBeenCalledWith('request_id', 'req-abc');
    expect(mockSetTag).toHaveBeenCalledWith('http_status', HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('maps a body-parser 413 to a fixed message, logs the original and skips Sentry', () => {
    const filter = new AllExceptionsFilter('production');
    const err = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });

    filter.catch(err, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(413);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 413, message: 'Request body too large' }),
    );
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('request entity too large'),
      expect.anything(),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('maps a Postgres 23505 to 409, logs the original and skips Sentry', () => {
    const filter = new AllExceptionsFilter('production');
    const driverError = Object.assign(new Error('duplicate key value violates "IDX_x"'), {
      code: '23505',
      table: 'classes',
    });

    filter.catch(new QueryFailedError('INSERT', [], driverError), mockHost);

    expect(mockStatus).toHaveBeenCalledWith(409);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'A class with this name already exists in this year' }),
    );
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('IDX_x'),
      expect.anything(),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('does not capture a 4xx to Sentry', () => {
    const filter = new AllExceptionsFilter('production');

    filter.catch(new NotFoundException('not found'), mockHost);

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('never attaches the request object to the Sentry scope call', () => {
    const filter = new AllExceptionsFilter('production');
    mockRequest.body = { password: 'hunter2' };

    filter.catch(new InternalServerErrorException('boom'), mockHost);

    // Only setTag is ever called on the scope — never anything that would
    // carry the request (setContext/setExtra/setUser).
    expect(mockSetTag.mock.calls.every(([key]) => typeof key === 'string')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { redactPii } from './redact-log.util';

describe('redactPii', () => {
  it('redacts an email address', () => {
    expect(redactPii('login failed for admin@example.com')).toBe(
      'login failed for [REDACTED_EMAIL]',
    );
  });

  it('redacts a Bangladeshi phone number in any of its accepted forms', () => {
    expect(redactPii('guardian phone: 01712345678')).toBe('guardian phone: [REDACTED_PHONE]');
    expect(redactPii('guardian phone: +8801712345678')).toBe('guardian phone: [REDACTED_PHONE]');
    expect(redactPii('guardian phone: 8801712345678')).toBe('guardian phone: [REDACTED_PHONE]');
  });

  it('redacts multiple occurrences in the same line', () => {
    expect(redactPii('a@b.com and c@d.com')).toBe('[REDACTED_EMAIL] and [REDACTED_EMAIL]');
  });

  // The issue's own gotcha: this must work on a failing/error line, not
  // just a clean success message — that's exactly where debugging pressure
  // tempts someone into logging everything unredacted.
  it('redacts PII embedded in a validation error message from a failing request', () => {
    const errorLine =
      'POST /api/v1/auth/login → 401: Invalid credentials for identifier admin@example.com [requestId=abc-123]';

    expect(redactPii(errorLine)).toBe(
      'POST /api/v1/auth/login → 401: Invalid credentials for identifier [REDACTED_EMAIL] [requestId=abc-123]',
    );
  });

  it('redacts a sensitive query-param value while leaving the key and other params intact', () => {
    expect(redactPii('/api/v1/reset?token=abc123&page=1')).toBe(
      '/api/v1/reset?token=[REDACTED]&page=1',
    );
    expect(redactPii('/api/v1/login?password=hunter2')).toBe('/api/v1/login?password=[REDACTED]');
  });

  it('masks a website preview token (bearer link, Rule 13)', () => {
    expect(redactPii('GET /manifest?x=1&preview=tenant.123.sig_-abc HTTP')).toBe(
      'GET /manifest?x=1&preview=[REDACTED] HTTP',
    );
    expect(redactPii('/p?preview=a.b.c')).toBe('/p?preview=[REDACTED]');
  });

  // 12.1's invitation/reset links carry the raw secret as a `token` query
  // param (`/activate?token=...`) — the exact shape a request-URL log line
  // would carry if a delivery failure or an access log ever printed it.
  it('redacts an activation link token in a URL', () => {
    expect(redactPii('GET /activate?token=abcDEF123_-xyz → 200')).toBe(
      'GET /activate?token=[REDACTED] → 200',
    );
  });

  it('leaves text with no PII untouched', () => {
    expect(redactPii('GET /api/v1/health → 200 [requestId=abc]')).toBe(
      'GET /api/v1/health → 200 [requestId=abc]',
    );
  });

  // A raw request URL is commonly percent-encoded by the client — matching
  // only the literal, unencoded shape would let PII straight through.
  it('redacts a percent-encoded email address in a query string', () => {
    expect(redactPii('/api/v1/students?email=guardian%40example.com')).toBe(
      '/api/v1/students?email=[REDACTED_EMAIL]',
    );
  });

  it('redacts a percent-encoded phone number in a query string', () => {
    expect(redactPii('/api/v1/students?phone=%2B8801712345678')).toBe(
      '/api/v1/students?phone=[REDACTED_PHONE]',
    );
  });

  it('falls back to the raw text instead of throwing on malformed percent-encoding', () => {
    expect(() => redactPii('/api/v1/students?q=100%off')).not.toThrow();
    expect(redactPii('/api/v1/students?q=100%off')).toBe('/api/v1/students?q=100%off');
  });

  // A Postgres constraint-violation DETAIL can echo an offending jsonb
  // value verbatim in the raw driver-error text a TypeORM logQueryError
  // call receives — not a URL, so this needs its own pattern rather than
  // relying on SENSITIVE_QUERY_PATTERN above (#8.7.11).
  it('redacts a secret value embedded in JSON-shaped driver-error text', () => {
    const errorLine =
      'duplicate key value violates unique constraint "schools_settings_key" DETAIL: Key (settings)=({"communications":{"whatsapp":{"accessToken":"super-secret-token"}}}) already exists.';

    const redacted = redactPii(errorLine);

    expect(redacted).not.toContain('super-secret-token');
    expect(redacted).toContain('"accessToken":"[REDACTED]"');
  });

  it('redacts every known secret key shape in JSON text, case-insensitively', () => {
    expect(redactPii('{"apiKey":"abc"}')).toBe('{"apiKey":"[REDACTED]"}');
    expect(redactPii('{"api_key":"abc"}')).toBe('{"api_key":"[REDACTED]"}');
    expect(redactPii('{"PASSWORD":"abc"}')).toBe('{"PASSWORD":"[REDACTED]"}');
    expect(redactPii('{"refresh_token":"abc"}')).toBe('{"refresh_token":"[REDACTED]"}');
  });

  it('redacts a JSON secret value containing an escaped quote', () => {
    const errorLine = 'DETAIL: Key (settings)=({"token":"abc\\"def"}) already exists.';

    const redacted = redactPii(errorLine);

    expect(redacted).not.toContain('abc\\"def');
    expect(redacted).toContain('"token":"[REDACTED]"');
  });

  it('leaves non-secret JSON keys untouched', () => {
    expect(redactPii('{"phoneNumberId":"123","pageId":"456"}')).toBe(
      '{"phoneNumberId":"123","pageId":"456"}',
    );
  });

  // Rule 13: a connection string echoed in a migration/driver error.
  it('redacts the password in a scheme://user:pass@host URL', () => {
    expect(redactPii('connect failed: postgres://app:pw@db:5432/x')).toBe(
      'connect failed: postgres://app:[REDACTED]@db:5432/x',
    );
    // `%40` decodes to `@`; the whole password still goes.
    expect(redactPii('redis://u:p%40ss@cache.example.com:6379')).toBe(
      'redis://u:[REDACTED]@cache.example.com:6379',
    );
    expect(redactPii('https://x.test:8080/i/tok')).toBe('https://x.test:8080/i/[REDACTED]');
  });

  it('redacts the notice link token in the API path and the SPA page', () => {
    expect(redactPii('GET /api/v1/public/notices/abc123 200')).toBe(
      'GET /api/v1/public/notices/[REDACTED] 200',
    );
    expect(redactPii('/n/abc123')).toBe('/n/[REDACTED]');
  });

  it('redacts a password-only URL (empty username)', () => {
    expect(redactPii('redis://:s3cret@redis:6379')).toBe('redis://:[REDACTED]@redis:6379');
  });

  // Decoding first would turn `%2F` into `/` and end the match mid-password.
  it('redacts a password that contains an encoded slash', () => {
    expect(redactPii('postgres://app:ab%2Fcd@db:5432/x')).toBe(
      'postgres://app:[REDACTED]@db:5432/x',
    );
  });

  // An `@` in the query or fragment is not userinfo: the port and host stay.
  it('does not read an @ in the query or fragment as userinfo', () => {
    expect(redactPii('https://x.test:8080?next=a@b.com')).toBe(
      'https://x.test:8080?next=[REDACTED_EMAIL]',
    );
    expect(redactPii('https://x.test:8080#a@b.com')).toBe('https://x.test:8080#[REDACTED_EMAIL]');
  });
});

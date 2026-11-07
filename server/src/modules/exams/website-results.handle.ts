import { createHmac, timingSafeEqual } from 'node:crypto';

export const RESULT_HANDLE_TTL_MS = 30 * 60 * 1000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SHAPE = new RegExp(`^(${UUID})\\.(${UUID})\\.(\\d{1,16})\\.[A-Za-z0-9_-]{43}$`);

function mac(body: string): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  // Domain-prefixed, so a handle is never a JWT or a preview token.
  return createHmac('sha256', secret).update(`site-result:${body}`).digest();
}

/**
 * Short-lived signed pointer to one result row (D36). `query` hands one out per row; `detail`
 * accepts nothing else, so a result id can never be tried by guessing. Token =
 * `<examId>.<resultId>.<expiryMs>.<hmac>`; the HMAC also covers the tenant.
 */
export function signResultHandle(
  tenantId: string,
  examId: string,
  resultId: string,
  now: number = Date.now(),
): string {
  const body = `${examId}.${resultId}.${now + RESULT_HANDLE_TTL_MS}`;
  return `${body}.${mac(`${tenantId}.${body}`).toString('base64url')}`;
}

/** The exam and result ids of an unexpired handle signed for this tenant, else null. Never throws on junk. */
export function verifyResultHandle(
  handle: unknown,
  tenantId: string,
  now: number = Date.now(),
): { examId: string; resultId: string } | null {
  if (typeof handle !== 'string' || handle.length > 200) return null;
  const m = SHAPE.exec(handle);
  if (!m) return null;
  const [, examId, resultId, exp] = m;
  if (Number(exp) <= now) return null;
  const sig = handle.slice(handle.lastIndexOf('.') + 1);
  const want = mac(`${tenantId}.${examId}.${resultId}.${exp}`);
  const got = Buffer.from(sig, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want) ? { examId, resultId } : null;
}

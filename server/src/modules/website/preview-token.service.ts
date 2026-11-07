import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const PREVIEW_TTL_MS = 60 * 60 * 1000;

/**
 * [40.2.01] Signed 1-hour link to a school's DRAFT site (D33). Token = `<tenantId>.<expiryMs>.<hmac>`;
 * the HMAC (SHA-256, key `JWT_SECRET`, domain-prefixed so a preview token is never a JWT) covers
 * tenant and expiry. A token only ever opens its own tenant's site.
 */
@Injectable()
export class PreviewTokenService {
  private mac(body: string): Buffer {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    return createHmac('sha256', secret).update(`site-preview:${body}`).digest();
  }

  sign(tenantId: string, now: number = Date.now()): string {
    const body = `${tenantId}.${now + PREVIEW_TTL_MS}`;
    return `${body}.${this.mac(body).toString('base64url')}`;
  }

  /** True only for an unexpired token signed for exactly this tenant. Never throws on junk. */
  verify(token: unknown, tenantId: string, now: number = Date.now()): boolean {
    if (typeof token !== 'string' || token.length > 300) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [tid, exp, sig] = parts;
    if (tid !== tenantId || !/^\d{1,16}$/.test(exp) || Number(exp) <= now) return false;
    const want = this.mac(`${tid}.${exp}`);
    const got = Buffer.from(sig, 'base64url');
    return got.length === want.length && timingSafeEqual(got, want);
  }
}

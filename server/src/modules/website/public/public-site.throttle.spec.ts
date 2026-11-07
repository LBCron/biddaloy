import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import {
  PublicSiteController,
  SITE_MEDIA_RATE_LIMIT,
  SITE_READ_RATE_LIMIT,
} from './public-site.controller';

/** [40.6.03] Pictures get their own per-IP tier, so a gallery page is not cut off by the page tier. */
describe('public site throttle tiers', () => {
  const limitOf = (target: object) =>
    Reflect.getMetadata('THROTTLER:LIMITdefault', target) as number | undefined;

  it('pages use the read tier, media/:key its own higher tier', () => {
    expect(limitOf(PublicSiteController)).toBe(SITE_READ_RATE_LIMIT.limit);
    expect(limitOf(PublicSiteController.prototype.media)).toBe(SITE_MEDIA_RATE_LIMIT.limit);
    expect(SITE_MEDIA_RATE_LIMIT.limit).toBeGreaterThan(20 * 60); // one 20-album x 60-photo page
  });
});

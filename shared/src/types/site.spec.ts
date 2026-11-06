import { describe, expect, it } from 'vitest';

import { RESERVED_SUBDOMAINS, SITE_SUBDOMAIN_RE } from './site';

describe('SITE_SUBDOMAIN_RE', () => {
  it.each(['rumsc', 'rumsc-2026', 'abc', 'a'.repeat(30)])('accepts %s', (s) => {
    expect(SITE_SUBDOMAIN_RE.test(s)).toBe(true);
  });
  it.each(['-a', 'a-', 'ab', 'a'.repeat(31), 'Rumsc', 'a_b', ''])('rejects %s', (s) => {
    expect(SITE_SUBDOMAIN_RE.test(s)).toBe(false);
  });
});

describe('RESERVED_SUBDOMAINS', () => {
  it('has no duplicates', () => {
    expect(new Set(RESERVED_SUBDOMAINS).size).toBe(RESERVED_SUBDOMAINS.length);
  });
  it('is made of valid labels or dotted fixed hosts', () => {
    for (const s of RESERVED_SUBDOMAINS) {
      expect(SITE_SUBDOMAIN_RE.test(s) || s.includes('.'), s).toBe(true);
    }
  });
});

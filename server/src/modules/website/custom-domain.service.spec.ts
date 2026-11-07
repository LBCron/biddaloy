import { describe, expect, it } from 'vitest';
import type { CfHostname } from './cloudflare-saas.client';
import { isApex, mapCfStatus, normalizeCustomHost, recordsFor } from './custom-domain.service';

const PLATFORM = ['schools.test', 'sites.schools.test', 'app.schools.test'];
const cf = (status: string, ssl: string, extra: Partial<CfHostname> = {}): CfHostname => ({
  id: 'a'.repeat(32),
  status,
  ssl: { status: ssl },
  ...extra,
});

describe('normalizeCustomHost (what a school may type)', () => {
  it.each([
    ['www.example.edu', 'www.example.edu'],
    ['  WWW.Example.EDU ', 'www.example.edu'], // uppercase and spaces normalised
    ['example.edu', 'example.edu'], // apex is allowed (D23)
    ['www.school.edu.bd', 'www.school.edu.bd'],
  ])('accepts %s', (raw, expected) => {
    expect(normalizeCustomHost(raw, PLATFORM)).toBe(expected);
  });

  it.each([
    ['foo.schools.test'], // under the platform root
    ['schools.test'], // the root itself
    ['sites.schools.test'], // the fallback origin
    ['app.schools.test'], // an app host
    ['bücher.example.edu'], // IDN
    ['xn--bcher-kva.example.edu'], // punycode
    ['localhost'], // one label
    ['127.0.0.1'], // an IP, numeric TLD
    ['example.edu:8080'],
    ['https://example.edu'],
    ['example.edu/path'],
    ['exa mple.edu'],
    ['-bad.example.edu'],
    [''],
    [`${'a'.repeat(64)}.example.edu`],
    [42],
    [null],
  ])('refuses %s', (raw) => {
    expect(normalizeCustomHost(raw, PLATFORM)).toBeNull();
  });
});

describe('isApex', () => {
  it('is true for two labels only', () => {
    expect(isApex('example.edu')).toBe(true);
    expect(isApex('www.example.edu')).toBe(false);
  });
});

describe('mapCfStatus (anything not explicitly active stays pending)', () => {
  it('maps Cloudflare statuses to ours', () => {
    expect(mapCfStatus(cf('pending', 'initializing'))).toBe('PENDING_DNS');
    expect(mapCfStatus(cf('active', 'pending_validation'))).toBe('PENDING_SSL');
    expect(mapCfStatus(cf('active', 'active'))).toBe('ACTIVE');
    expect(mapCfStatus(cf('blocked', 'active'))).toBe('FAILED');
    expect(mapCfStatus(cf('moved', ''))).toBe('FAILED');
    // An unknown status never reads as ACTIVE.
    expect(mapCfStatus(cf('something_new', 'active'))).toBe('PENDING_DNS');
    expect(mapCfStatus(cf('pending', 'active'))).toBe('PENDING_DNS');
  });
});

describe('recordsFor', () => {
  it('gives the CNAME to the fallback origin and the ownership TXT (D35)', () => {
    const r = recordsFor(
      'www.example.edu',
      cf('pending', 'initializing', {
        ownership_verification: { name: '_cf-custom-hostname.www.example.edu', value: 'abc-123' },
      }),
      'sites.schools.test',
    );
    expect(r).toEqual([
      { type: 'CNAME', name: 'www.example.edu', value: 'sites.schools.test' },
      { type: 'TXT', name: '_cf-custom-hostname.www.example.edu', value: 'abc-123' },
    ]);
  });

  it('adds certificate validation TXT records when Cloudflare returns them', () => {
    const r = recordsFor(
      'www.example.edu',
      cf('pending', 'pending_validation', {
        ownership_verification: { value: 'abc' },
        ssl: {
          status: 'pending_validation',
          validation_records: [{ txt_name: '_acme-challenge.www.example.edu', txt_value: 'xyz' }],
        },
      }),
      'sites.schools.test',
    );
    expect(r).toHaveLength(3);
    expect(r[1].name).toBe('_cf-custom-hostname.www.example.edu'); // default name
    expect(r[2]).toEqual({ type: 'TXT', name: '_acme-challenge.www.example.edu', value: 'xyz' });
  });
});

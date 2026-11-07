import { afterEach, describe, expect, it } from 'vitest';
import type { SiteAnnouncement } from '@biddaloy/shared';
import { buildManifest, inWindow } from './page-read-model';

const ann = (o: Partial<SiteAnnouncement>): SiteAnnouncement => ({
  id: 'a',
  text: { bn: 'x', en: 'x' },
  enabled: true,
  ...o,
});

describe('inWindow', () => {
  it('a bare until-date lasts the whole Bangladesh day', () => {
    // 2026-11-10 20:00 UTC is 02:00 on 11 Nov in Dhaka: already over.
    expect(inWindow(ann({ until: '2026-11-10' }), new Date('2026-11-10T17:00:00Z'))).toBe(true);
    expect(inWindow(ann({ until: '2026-11-10' }), new Date('2026-11-10T20:00:00Z'))).toBe(false);
  });

  it('a from-date starts at local midnight', () => {
    expect(inWindow(ann({ from: '2026-11-10' }), new Date('2026-11-09T17:59:00Z'))).toBe(false);
    expect(inWindow(ann({ from: '2026-11-10' }), new Date('2026-11-09T18:01:00Z'))).toBe(true);
  });

  it('no window means always shown; an unparseable date is never shown', () => {
    expect(inWindow(ann({}), new Date())).toBe(true);
    expect(inWindow(ann({ from: 'garbage' }), new Date())).toBe(false);
  });
});

describe('manifest analytics', () => {
  const cfg = {
    theme: 'basic',
    palette: 'green',
    typography: {},
    announcements: { items: [] },
    pages: [],
  } as never;
  const school = { name: 'S', name_bn: null, address: null, phone: null, email: null } as never;
  const make = (id: string | null) => buildManifest(cfg, false, school, false, id);
  afterEach(() => delete process.env.UMAMI_SCRIPT_URL);

  it('is absent without the script URL or without a website id', () => {
    expect(make('w1')).not.toHaveProperty('analytics');
    process.env.UMAMI_SCRIPT_URL = 'https://stats.example.org/script.js';
    expect(make(null)).not.toHaveProperty('analytics');
  });

  it('carries exactly the website id and the public script URL', () => {
    process.env.UMAMI_SCRIPT_URL = 'https://stats.example.org/script.js';
    expect(make('w1').analytics).toEqual({
      websiteId: 'w1',
      scriptUrl: 'https://stats.example.org/script.js',
    });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { SitePage, SiteTheme, type SiteAnnouncement } from '@biddaloy/shared';
import { defaultConfigFor } from '@biddaloy/site-themes';
import { buildManifest, buildPage, inWindow } from './page-read-model';

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

describe('buildPage: results page gate (D12)', () => {
  const withResults = (enabled: boolean | null) => {
    const c = defaultConfigFor(SiteTheme.BASIC);
    c.pages = c.pages.filter((p) => p.page !== SitePage.RESULTS);
    if (enabled !== null) c.pages.push({ page: SitePage.RESULTS, enabled, sections: [] });
    return c;
  };

  it('is null when the page is off or missing, a page when on', () => {
    expect(buildPage(withResults(false), SitePage.RESULTS)).toBeNull();
    expect(buildPage(withResults(null), SitePage.RESULTS)).toBeNull();
    expect(buildPage(withResults(true), SitePage.RESULTS)).toEqual({
      page: SitePage.RESULTS,
      sections: [],
    });
  });

  it('shows Results in the nav only when on', () => {
    const school = {
      name: 'S',
      name_bn: null,
      address: null,
      phone: null,
      email: null,
      logo_key: null,
    };
    const nav = (c: ReturnType<typeof withResults>) =>
      buildManifest(c, false, school).nav.map((n) => n.page);
    expect(nav(withResults(true))).toContain(SitePage.RESULTS);
    expect(nav(withResults(false))).not.toContain(SitePage.RESULTS);
  });
});

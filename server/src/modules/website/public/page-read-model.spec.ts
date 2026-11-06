import { describe, expect, it } from 'vitest';
import type { SiteAnnouncement } from '@biddaloy/shared';
import { inWindow } from './page-read-model';

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

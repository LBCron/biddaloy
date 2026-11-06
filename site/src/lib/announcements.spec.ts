import { describe, expect, it } from 'vitest';
import { SiteAnnouncementStyle, SiteMarqueeSpeed } from '@biddaloy/shared';
import { barItems } from './announcements';

const NOW = Date.parse('2026-11-06T00:00:00Z');
const bar = (items: object[]) =>
  ({ style: SiteAnnouncementStyle.STATIC, speed: SiteMarqueeSpeed.NORMAL, items }) as never;
const item = (o: object) => ({ id: 'a', text: { bn: 'ক', en: 'a' }, enabled: true, ...o });

describe('barItems', () => {
  it('keeps a site-relative link', () => {
    expect(barItems(bar([item({ href: '/notices' })]), 'bn', NOW)).toEqual([
      { text: 'ক', href: '/notices' },
    ]);
  });

  // Defence in depth: the server validator refuses these; the renderer drops them anyway.
  it('drops a javascript:, protocol-relative or absolute link but keeps the text', () => {
    const items = [
      item({ href: 'javascript:alert(1)' }),
      item({ href: '//evil.com' }),
      item({ href: 'https://evil.com' }),
    ];
    expect(barItems(bar(items), 'en', NOW)).toEqual([{ text: 'a' }, { text: 'a' }, { text: 'a' }]);
  });

  it('skips disabled, not-yet-started and finished items', () => {
    const items = [
      item({ enabled: false }),
      item({ from: '2026-12-01T00:00:00Z' }),
      item({ until: '2026-11-01T00:00:00Z' }),
    ];
    expect(barItems(bar(items), 'bn', NOW)).toEqual([]);
  });
});

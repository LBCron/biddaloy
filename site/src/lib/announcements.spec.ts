import { describe, expect, it } from 'vitest';
import { SiteAnnouncementStyle, SiteMarqueeSpeed } from '@biddaloy/shared';
import { barItems, withLang } from './announcements';

const bar = (items: object[]) =>
  ({ style: SiteAnnouncementStyle.STATIC, speed: SiteMarqueeSpeed.NORMAL, items }) as never;
const item = (o: object) => ({ id: 'a', text: { bn: 'ক', en: 'a' }, enabled: true, ...o });

describe('barItems', () => {
  it('keeps a site-relative link under the page language', () => {
    expect(barItems(bar([item({ href: '/notices' })]), 'bn')).toEqual([
      { text: 'ক', href: '/bn/notices' },
    ]);
    expect(barItems(bar([item({ href: '/admissions?x=1' })]), 'en')).toEqual([
      { text: 'a', href: '/en/admissions?x=1' },
    ]);
  });

  // Defence in depth: the server validator refuses these; the renderer drops them anyway.
  it('drops a javascript:, protocol-relative or absolute link but keeps the text', () => {
    const items = [
      item({ href: 'javascript:alert(1)' }),
      item({ href: '//evil.com' }),
      item({ href: 'https://evil.com' }),
    ];
    expect(barItems(bar(items), 'en')).toEqual([{ text: 'a' }, { text: 'a' }, { text: 'a' }]);
  });

  it('skips disabled items', () => {
    expect(barItems(bar([item({ enabled: false })]), 'bn')).toEqual([]);
  });

  // Regression (#3621 gate): the server sends only in-window items, in Asia/Dhaka days. The old
  // client check read `until: '2026-11-06'` as UTC midnight and hid the item from 06:00 Dhaka
  // on its last day; `from: '2026-11-07'` stayed hidden until 06:00 Dhaka. Both must render.
  it('keeps an item the server sent on its first or last day', () => {
    const items = [item({ until: '2026-11-06' }), item({ from: '2026-11-07' })];
    expect(barItems(bar(items), 'en')).toEqual([{ text: 'a' }, { text: 'a' }]);
  });
});

describe('withLang', () => {
  it('prefixes a plain site path and keeps one that already has a language', () => {
    expect(withLang('/', 'bn')).toBe('/bn/');
    expect(withLang('/admissions', 'en')).toBe('/en/admissions');
    expect(withLang('/en/notices/', 'bn')).toBe('/en/notices/');
    expect(withLang('/bn?x=1', 'en')).toBe('/bn?x=1');
    expect(withLang('/english', 'bn')).toBe('/bn/english');
  });
});

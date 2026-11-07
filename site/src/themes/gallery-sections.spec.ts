import { SiteSectionKey, SiteTheme } from '@biddaloy/shared';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Lang, SiteManifest } from '../lib/types';
import { themes } from './index';

const bt = (bn: string, en: string) => ({ bn, en });
const manifest = (gallery: boolean) =>
  ({
    schoolName: bt('সূর্যমুখী', 'Surjomukhi'),
    contact: {},
    nav: gallery ? [{ page: 'gallery' }] : [],
  }) as unknown as SiteManifest;

const album = (n: number, withCaption = true) => ({
  id: 'a1',
  title: bt('বার্ষিক ক্রীড়া', 'Annual sports'),
  photos: Array.from({ length: n }, (_, i) => ({
    mediaId: `m${i}`,
    caption: withCaption && i === 0 ? bt('প্রথম ছবি', 'First photo') : null,
  })),
});
const VIDEO = 'dQw4w9WgXcQ';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

describe.each(Object.values(SiteTheme))('%s: gallery and video sections', (id) => {
  const theme = themes[id];
  const render = (
    key: SiteSectionKey,
    props: { data?: Record<string, unknown>; feed?: unknown[]; lang?: Lang; nav?: boolean },
  ) =>
    container.renderToString(theme.sections[key]!, {
      props: {
        data: {},
        feed: [],
        lang: 'bn',
        manifest: manifest(!!props.nav),
        ...props,
      },
    });

  it('registers gallery and video (the SectionRenderer finds them)', () => {
    expect(theme.sections[SiteSectionKey.GALLERY]).toBeTruthy();
    expect(theme.sections[SiteSectionKey.VIDEO]).toBeTruthy();
  });

  describe('gallery', () => {
    const G = SiteSectionKey.GALLERY;
    it('no feed, empty feed, album without photos: renders nothing', async () => {
      for (const feed of [[], [album(0)], undefined]) {
        expect((await render(G, { feed: feed as unknown[] })).trim()).toBe('');
      }
    });
    it('one photo: a static image, no controls', async () => {
      const html = await render(G, { feed: [album(1)] });
      expect(html).toContain('/media/m0');
      expect(html).toContain('data-single');
      expect(html).not.toContain('hc-prev');
      expect(html).not.toContain('hc-dots');
    });
    it('12 photos: carousel with 12 slides, first eager, rest lazy', async () => {
      const html = await render(G, { feed: [album(12)] });
      expect(html.match(/class="hc-slide|hc-slide gc-slide/g)).toHaveLength(12);
      expect(html).toContain('hc-prev');
      expect(html.match(/loading="eager"/g)).toHaveLength(1);
      expect(html.match(/loading="lazy"/g)).toHaveLength(11);
    });
    it('60 photos: still only 12 slides', async () => {
      const html = await render(G, { feed: [album(60)] });
      expect(html.match(/hc-slide gc-slide/g)).toHaveLength(12);
      expect(html).not.toContain('/media/m12');
    });
    it('page link only when the nav lists the gallery page', async () => {
      expect(await render(G, { feed: [album(3)], nav: true })).toContain('/bn/gallery/');
      expect(await render(G, { feed: [album(3)], nav: false })).not.toContain('/bn/gallery/');
    });
    it('caption in the page language, falling back to Bangla; alt falls back to the title', async () => {
      const bn = await render(G, { feed: [album(2)] });
      expect(bn).toContain('প্রথম ছবি');
      const en = await render(G, { feed: [album(2)], lang: 'en' });
      expect(en).toContain('First photo');
      expect(en).toContain('alt="Annual sports"'); // photo 2 has no caption
      const enNoCap = await render(G, {
        feed: [{ ...album(1), photos: [{ mediaId: 'm0', caption: { bn: 'শুধু বাংলা', en: '' } }] }],
        lang: 'en',
      });
      expect(enNoCap).toContain('শুধু বাংলা');
    });
    it('escapes markup in a caption and a heading', async () => {
      const html = await render(G, {
        data: { heading: bt('<script>x</script>', '<script>x</script>') },
        feed: [{ ...album(1), photos: [{ mediaId: 'm0', caption: bt('<img onerror=1>', 'x') }] }],
      });
      expect(html).not.toContain('<script>x');
      // Inside a quoted attribute a `<` is inert; in the text it must be escaped.
      expect(html).toContain('&lt;img onerror=1&gt;</figcaption>');
    });
    it('writes no inline style attribute of its own', async () => {
      expect(await render(G, { feed: [album(5)], nav: true })).not.toMatch(/\sstyle=/);
    });
  });

  describe('video', () => {
    const V = SiteSectionKey.VIDEO;
    const data = {
      videoId: VIDEO,
      heading: bt('আমাদের স্কুল', 'Our school'),
      headingPosition: 'above',
    };
    it.each([null, undefined, 'javascript:alert(1)', 'short', `${VIDEO}x`, `${VIDEO}"><b>`])(
      'videoId %j renders nothing',
      async (videoId) => {
        expect((await render(V, { data: { ...data, videoId } })).trim()).toBe('');
      },
    );
    it('poster only before the click: no iframe, no YouTube request in the markup', async () => {
      const html = await render(V, { data });
      expect(html).toContain('data-video-play');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('youtube');
      expect(html).not.toContain('ytimg');
    });
    it('heading above comes before the player, below comes after', async () => {
      const above = await render(V, { data });
      expect(above.indexOf('আমাদের স্কুল')).toBeLessThan(above.indexOf('data-video-embed'));
      const below = await render(V, { data: { ...data, headingPosition: 'below' } });
      expect(below.indexOf('আমাদের স্কুল')).toBeGreaterThan(below.indexOf('data-video-embed'));
    });
    it('play button is labelled in the page language', async () => {
      expect(await render(V, { data })).toContain('ভিডিও চালান');
      expect(await render(V, { data, lang: 'en' })).toContain('Play video');
    });
    it('writes no inline style attribute of its own', async () => {
      expect(await render(V, { data })).not.toMatch(/\sstyle=/);
    });
  });
});

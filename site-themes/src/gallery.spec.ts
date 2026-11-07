import { SitePage, SiteSectionKey } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import { THEMES, defaultConfigFor } from './index';

describe.each(Object.values(THEMES))('$id theme: gallery and video sections', (m) => {
  it('lists gallery and video, disabled by default, with both heading languages', () => {
    for (const [key, bn, en] of [
      [SiteSectionKey.GALLERY, 'ছবির গ্যালারি', 'Photo gallery'],
      [SiteSectionKey.VIDEO, 'ভিডিও', 'Video'],
    ] as const) {
      const s = m.sections.find((x) => x.key === key)!;
      expect(s.enabledByDefault, key).toBe(false);
      expect(s.fields.find((f) => f.key === 'heading')?.defaults).toEqual({ bn, en });
    }
  });

  it('default config carries both switched off with null / false data, and a gallery page', () => {
    const cfg = defaultConfigFor(m.id);
    const home = cfg.pages.find((p) => p.page === SitePage.HOME)!;
    const gallery = home.sections.find((s) => s.key === SiteSectionKey.GALLERY)!;
    const video = home.sections.find((s) => s.key === SiteSectionKey.VIDEO)!;
    expect(gallery.enabled).toBe(false);
    expect(gallery.data).toMatchObject({ albumId: null, showPageLink: false });
    expect(video.enabled).toBe(false);
    expect(video.data).toMatchObject({
      headingPosition: 'above',
      videoId: null,
      startSeconds: null,
    });
    expect(cfg.pages.some((p) => p.page === SitePage.GALLERY)).toBe(true);
  });
});

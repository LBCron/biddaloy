import { describe, expect, it } from 'vitest';
import { galleryAlbums, galleryPageLinked, videoOf } from './sections';

describe('galleryAlbums', () => {
  const photo = (n: number, caption: unknown = null) => ({ mediaId: `m${n}`, caption });
  const album = (n: number, extra: object = {}) => ({
    id: 'a',
    title: { bn: 'অ্যালবাম', en: 'Album' },
    photos: Array.from({ length: n }, (_, i) => photo(i)),
    ...extra,
  });

  it('empty or malformed feed gives no album (the section hides)', () => {
    expect(galleryAlbums([])).toEqual([]);
    expect(galleryAlbums(null)).toEqual([]);
    expect(galleryAlbums([album(0)])).toEqual([]);
    expect(galleryAlbums([{ id: 'x' }, 'str', null])).toEqual([]);
  });
  it('1 photo and 60 photos pass; max cuts each album', () => {
    expect(galleryAlbums([album(1)])[0].photos).toHaveLength(1);
    expect(galleryAlbums([album(60)])[0].photos).toHaveLength(60);
    expect(galleryAlbums([album(60)], 12)[0].photos).toHaveLength(12);
  });
  it('drops a photo whose media id could break out of /media/<id>', () => {
    const bad = album(0, {
      photos: [
        photo(1),
        { mediaId: '../x', caption: null },
        { mediaId: 'a"onload=1', caption: null },
        { mediaId: 5 },
      ],
    });
    expect(galleryAlbums([bad])[0].photos.map((p) => p.mediaId)).toEqual(['m1']);
  });
  it('keeps a caption as plain text and nulls a non-text one', () => {
    const [a] = galleryAlbums([
      album(0, { photos: [photo(1, { bn: '<b>ক</b>', en: 'a' }), photo(2, 'x')] }),
    ]);
    expect(a.photos[0].caption).toEqual({ bn: '<b>ক</b>', en: 'a' });
    expect(a.photos[1].caption).toBeNull();
  });
});

describe('galleryPageLinked', () => {
  it('is true only when the manifest nav lists the gallery page', () => {
    expect(galleryPageLinked({ nav: [{ page: 'about' }] } as never)).toBe(false);
    expect(galleryPageLinked({ nav: [{ page: 'gallery' }] } as never)).toBe(true);
  });
});

describe('videoOf (second guard on the YouTube id)', () => {
  const ok = {
    videoId: 'dQw4w9WgXcQ',
    heading: { bn: 'ভিডিও', en: 'Video' },
    headingPosition: 'below',
    startSeconds: 90,
  };
  it('reads a clean id, start, heading and position', () => {
    expect(videoOf(ok, 'en')).toEqual({
      id: 'dQw4w9WgXcQ',
      start: 90,
      heading: 'Video',
      below: true,
    });
  });
  it.each([
    null,
    undefined,
    '',
    'javascript:alert(1)',
    'dQw4w9WgXc',
    'dQw4w9WgXcQQ',
    'dQw4w9WgXcQ?autoplay=1',
    'dQw4w9WgXc"',
    'https://youtu.be/dQw4w9WgXcQ',
    12345678901,
  ])('rejects %j', (videoId) => {
    expect(videoOf({ ...ok, videoId }, 'bn')).toBeNull();
  });
  it('turns a bad start into null', () => {
    for (const startSeconds of [-1, 0, 1.5, 86401, '30', null]) {
      expect(videoOf({ ...ok, startSeconds }, 'bn')?.start).toBeNull();
    }
    expect(videoOf({ ...ok, startSeconds: 86400 }, 'bn')?.start).toBe(86400);
  });
});

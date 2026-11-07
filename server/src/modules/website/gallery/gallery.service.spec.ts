import { describe, it, expect, vi } from 'vitest';
import { GalleryService } from './gallery.service';

/** [40.6.03] Input checks run before anything touches the database or storage. */
describe('GalleryService input checks', () => {
  const touched = vi.fn();
  const svc = new GalleryService(
    { manager: { transaction: touched } } as never,
    { prepare: touched, lockSite: touched, storeIn: touched } as never,
    { put: touched, delete: touched } as never,
    { invalidate: touched } as never,
    { get: touched } as never,
  );
  const T = '00000000-0000-4000-8000-000000000001';
  const A = '00000000-0000-4000-8000-000000000002';

  it.each([
    [{ bn: '', en: '' }],
    [{ bn: 'x'.repeat(201), en: 'ok' }],
    [{ bn: 1, en: 'ok' }],
    [null],
    ['text'],
    [['a']],
  ])('an album title %j is site.gallery_invalid with no side effect', async (title) => {
    await expect(svc.createAlbum(T, title)).rejects.toThrow('site.gallery_invalid');
    await expect(svc.updateAlbum(T, A, title)).rejects.toThrow('site.gallery_invalid');
    expect(touched).not.toHaveBeenCalled();
  });

  it.each([
    ['not json'],
    ['{"bn":"x"}'],
    [JSON.stringify({ bn: 'x'.repeat(121), en: '' })],
    [JSON.stringify({ bn: '', en: 'y'.repeat(121) })],
    ['[]'],
  ])('a photo caption %s is site.gallery_invalid before the file is read', async (caption) => {
    const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg' };
    await expect(svc.uploadPhoto(T, A, file, caption)).rejects.toThrow('site.gallery_invalid');
    expect(touched).not.toHaveBeenCalled();
  });

  it('a caption update over 120 chars is refused', async () => {
    await expect(svc.updatePhoto(T, A, { bn: 'x'.repeat(121), en: '' })).rejects.toThrow(
      'site.gallery_invalid',
    );
    expect(touched).not.toHaveBeenCalled();
  });
});

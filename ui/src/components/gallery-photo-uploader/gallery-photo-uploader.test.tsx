import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GalleryPhotoUploader, type GalleryPhotoUploaderLabels } from './gallery-photo-uploader';

const labels: GalleryPhotoUploaderLabels = {
  choose: 'Choose photos',
  hint: 'Many at once',
  pickerLabel: 'Photos to add',
  waiting: 'Waiting',
  uploading: 'Sending',
  done: 'Done',
  failed: 'Failed',
  notPhoto: 'Not a photo',
  notAdded: 'Section full',
  storageFull: 'Space full',
  retry: 'Try again',
  summary: (d, t) => `${d} of ${t} done`,
};

const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const jpg = (name = 'a.jpg') => file(name, 'image/jpeg');
const pick = (files: File[]) =>
  fireEvent.change(screen.getByTestId('gallery-files'), { target: { files } });

describe('GalleryPhotoUploader', () => {
  let revoke = vi.fn();
  let exported: { w: number; h: number; type: string; quality: unknown }[];

  beforeEach(() => {
    exported = [];
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 4000;
        naturalHeight = 3000;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb,
      type,
      quality,
    ) {
      exported.push({ w: this.width, h: this.height, type: type ?? '', quality });
      cb(new Blob(['x'], { type: type ?? 'image/png' }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('turns a 4000x3000 JPEG into a 1200x800 WebP at 0.82 before upload', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    render(<GalleryPhotoUploader remaining={5} onUpload={onUpload} labels={labels} />);
    pick([jpg()]);
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(exported[0]).toMatchObject({ w: 1200, h: 800, type: 'image/webp', quality: 0.82 });
    const sent = onUpload.mock.calls[0]![0] as File;
    expect(sent.type).toBe('image/webp');
    expect(sent.name).toBe('a.webp');
    expect(await screen.findByText('1 of 1 done')).toBeTruthy();
  });

  it('lists a PDF, an SVG and a file over 20 MB as not a photo and never uploads them', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    render(<GalleryPhotoUploader remaining={5} onUpload={onUpload} labels={labels} />);
    pick([
      file('a.pdf', 'application/pdf'),
      file('b.svg', 'image/svg+xml'),
      file('c.jpg', 'image/jpeg', 21 * 1024 * 1024),
    ]);
    expect(await screen.findAllByText('Not a photo')).toHaveLength(3);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('does not process files past `remaining`', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    render(<GalleryPhotoUploader remaining={2} onUpload={onUpload} labels={labels} />);
    pick([jpg('1.jpg'), jpg('2.jpg'), jpg('3.jpg'), jpg('4.jpg')]);
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('Section full')).toHaveLength(2);
    expect(exported).toHaveLength(2);
  });

  it('uploads in order, one at a time', async () => {
    const order: string[] = [];
    let running = 0;
    let peak = 0;
    const onUpload = vi.fn(async (f: File) => {
      running += 1;
      peak = Math.max(peak, running);
      order.push(f.name);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
    });
    render(<GalleryPhotoUploader remaining={9} onUpload={onUpload} labels={labels} />);
    pick([jpg('1.jpg'), jpg('2.jpg'), jpg('3.jpg')]);
    await waitFor(() => expect(order).toHaveLength(3));
    expect(order).toEqual(['1.webp', '2.webp', '3.webp']);
    expect(peak).toBe(1);
  });

  it('a failed photo waits for its own retry press and does not block the next one', async () => {
    let first = true;
    const onUpload = vi.fn((f: File) => {
      if (f.name === '1.webp' && first) {
        first = false;
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve();
    });
    render(
      <GalleryPhotoUploader
        remaining={9}
        onUpload={onUpload}
        labels={labels}
        errorText={() => 'Fixed sentence'}
      />,
    );
    pick([jpg('1.jpg'), jpg('2.jpg')]);
    expect(await screen.findByText('Fixed sentence')).toBeTruthy();
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(onUpload).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('2 of 2 done')).toBeTruthy();
  });

  it('storage full stops the queue and parks the rest', async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error('full'));
    render(
      <GalleryPhotoUploader
        remaining={9}
        onUpload={onUpload}
        labels={labels}
        isStorageFull={() => true}
      />,
    );
    pick([jpg('1.jpg'), jpg('2.jpg'), jpg('3.jpg')]);
    expect(await screen.findAllByText('Space full')).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 30));
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it('stops uploading when it unmounts', async () => {
    let release: () => void = () => {};
    const onUpload = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const { unmount } = render(
      <GalleryPhotoUploader remaining={9} onUpload={onUpload} labels={labels} />,
    );
    pick([jpg('1.jpg'), jpg('2.jpg')]);
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    unmount();
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalled();
  });

  it('opens the picker with Enter on the drop area', async () => {
    render(<GalleryPhotoUploader remaining={5} onUpload={vi.fn()} labels={labels} />);
    const click = vi.spyOn(screen.getByTestId('gallery-files'), 'click');
    const button = screen.getByRole('button', { name: /Choose photos/ });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Photos to add')).toBeTruthy();
  });

  it('is disabled when nothing more fits', () => {
    render(<GalleryPhotoUploader remaining={0} onUpload={vi.fn()} labels={labels} />);
    expect(screen.getByRole('button', { name: /Choose photos/ }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});

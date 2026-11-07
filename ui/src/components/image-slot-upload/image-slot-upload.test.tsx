import { SiteMediaSlot } from '@biddaloy/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clampOffset, fitCover, slotSize, zoomOffset } from './crop-canvas';
import { ImageSlotUpload } from './image-slot-upload';

const labels = {
  choose: 'Choose',
  zoom: 'Zoom',
  save: 'Save',
  svgRefused: 'No SVG',
  tooLarge: 'Too big',
  unreadable: 'Unreadable',
};

describe('crop-canvas', () => {
  it('fitCover covers the slot and scales with zoom', () => {
    const d = fitCover({ w: 4000, h: 1000 }, { w: 1920, h: 1080 }, 1);
    expect(d.h).toBeCloseTo(1080);
    expect(d.w).toBeCloseTo(4320);
    expect(fitCover({ w: 4000, h: 1000 }, { w: 1920, h: 1080 }, 2).h).toBeCloseTo(2160);
  });

  it('clampOffset keeps the image covering the slot', () => {
    const slot = { w: 100, h: 100 };
    const drawn = { w: 300, h: 100 };
    expect(clampOffset({ x: 50, y: 50 }, drawn, slot)).toEqual({ x: 0, y: 0 });
    expect(clampOffset({ x: -999, y: -999 }, drawn, slot)).toEqual({ x: -200, y: 0 });
  });

  it('zoomOffset keeps the centre point', () => {
    const slot = { w: 100, h: 100 };
    const from = { w: 200, h: 200 };
    const to = { w: 400, h: 400 };
    const o = zoomOffset({ x: -50, y: -50 }, from, to, slot);
    expect((50 - o.x) / to.w).toBeCloseTo((50 + 50) / from.w);
  });

  it('slotSize: exact px, or ratio-kept and width-capped for post images', () => {
    expect(slotSize({ w: 512, h: 512 }, { w: 9, h: 3 })).toEqual({ w: 512, h: 512 });
    expect(slotSize({ w: 0, h: 0, maxW: 1200 }, { w: 2400, h: 1200 })).toEqual({ w: 1200, h: 600 });
    expect(slotSize({ w: 0, h: 0, maxW: 1200 }, { w: 600, h: 300 })).toEqual({ w: 600, h: 300 });
  });
});

describe('ImageSlotUpload', () => {
  const drawImage = vi.fn();
  let exported: { w: number; h: number; type: string }[];

  beforeEach(() => {
    exported = [];
    drawImage.mockClear();
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 3000;
        naturalHeight = 2000;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb,
      type,
    ) {
      exported.push({ w: this.width, h: this.height, type: type ?? '' });
      cb(new Blob(['x'], { type: type ?? 'image/png' }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const file = (name: string, type: string, size = 10) => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };

  it('refuses SVG and files over 20 MB with the given sentences', async () => {
    render(<ImageSlotUpload slot={SiteMediaSlot.LOGO} labels={labels} onUpload={vi.fn()} />);
    const input = screen.getByTestId('slot-file');
    fireEvent.change(input, { target: { files: [file('a.svg', 'image/svg+xml')] } });
    expect((await screen.findByRole('alert')).textContent).toBe('No SVG');
    fireEvent.change(input, {
      target: { files: [file('a.png', 'image/png', 21 * 1024 * 1024)] },
    });
    expect(await screen.findByText('Too big')).toBeTruthy();
  });

  it('uploads a blob at exactly the slot px, never the original file', async () => {
    const onUpload = vi.fn();
    render(<ImageSlotUpload slot={SiteMediaSlot.HERO} labels={labels} onUpload={onUpload} />);
    fireEvent.change(screen.getByTestId('slot-file'), {
      target: { files: [file('a.png', 'image/png')] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(exported[0]).toMatchObject({ w: 1920, h: 1080, type: 'image/webp' });
    expect(onUpload.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect(onUpload.mock.calls[0]![0]).not.toBeInstanceOf(File);
  });

  it('arrow keys move the image within the clamp', async () => {
    render(<ImageSlotUpload slot={SiteMediaSlot.HERO} labels={labels} onUpload={vi.fn()} />);
    fireEvent.change(screen.getByTestId('slot-file'), {
      target: { files: [file('a.png', 'image/png')] },
    });
    const preview = await screen.findByTestId('slot-preview');
    // 3000x2000 into 1920x1080: drawn 1920x1280, centred y = -100; wide side has no slack.
    const lastX = () => drawImage.mock.calls.at(-1)![1] as number;
    const lastY = () => drawImage.mock.calls.at(-1)![2] as number;
    await waitFor(() => expect(lastY()).toBeCloseTo(-100));
    fireEvent.keyDown(preview, { key: 'ArrowDown' });
    await waitFor(() => expect(lastY()).toBeCloseTo(-110));
    for (let i = 0; i < 30; i++) fireEvent.keyDown(preview, { key: 'ArrowDown' });
    await waitFor(() => expect(lastY()).toBeCloseTo(-200));
    fireEvent.keyDown(preview, { key: 'ArrowRight' });
    expect(lastX()).toBeCloseTo(0);
  });
});

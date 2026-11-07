/**
 * Picks a photo, lets the user crop it to a website slot's exact px (cover fit, drag, zoom),
 * and hands `onUpload` a re-encoded blob. The original file is never sent (D15, D19); the
 * server still verifies the result. Texts are props, like `ChoiceCards`.
 */
import { SITE_MEDIA_SLOT_PX, type SiteMediaSlot } from '@biddaloy/shared';
import * as React from 'react';

import { cn } from '../../primitives/lib/utils';
import { Button } from '../button';

import {
  centered,
  clampOffset,
  fitCover,
  render,
  slotSize,
  zoomOffset,
  type Offset,
  type Size,
} from './crop-canvas';

export const MAX_SLOT_UPLOAD_BYTES = 20 * 1024 * 1024;
const NUDGE = 10;

export interface ImageSlotUploadLabels {
  choose: string;
  zoom: string;
  save: string;
  /** Same sentence the server answers with for an SVG. */
  svgRefused: string;
  /** Same sentence the server answers with for a file over 20 MB. */
  tooLarge: string;
  unreadable: string;
}

export interface ImageSlotUploadProps {
  slot: SiteMediaSlot;
  /** URL of the photo already in the slot, if any. */
  value?: string | null;
  onChange?: (blob: Blob | null) => void;
  onUpload: (blob: Blob) => void | Promise<void>;
  labels: ImageSlotUploadLabels;
  disabled?: boolean;
  className?: string;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable'));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === 'image/webp') return resolve(webp);
        // Browsers without WebP encoding fall back to PNG silently; ask for JPEG instead.
        canvas.toBlob((jpeg) => resolve(jpeg), 'image/jpeg', 0.9);
      },
      'image/webp',
      0.9,
    );
  });
}

export function ImageSlotUpload({
  slot,
  value,
  onChange,
  onUpload,
  labels,
  disabled,
  className,
}: ImageSlotUploadProps) {
  const px = SITE_MEDIA_SLOT_PX[slot];
  const inputRef = React.useRef<HTMLInputElement>(null);
  const previewRef = React.useRef<HTMLCanvasElement>(null);
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState<Offset>({ x: 0, y: 0 });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sentBytes, setSentBytes] = React.useState<number | null>(null);
  const drag = React.useRef<{ x: number; y: number; start: Offset } | null>(null);

  const imgSize: Size | null = img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  const out = imgSize ? slotSize(px, imgSize) : null;
  const drawn = imgSize && out ? fitCover(imgSize, out, zoom) : null;

  React.useEffect(() => {
    const canvas = previewRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !img || !out || !drawn) return;
    canvas.width = out.w;
    canvas.height = out.h;
    render(ctx, img, drawn, offset);
  }, [img, out?.w, out?.h, drawn?.w, drawn?.h, offset.x, offset.y]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      return setError(labels.svgRefused);
    }
    if (file.size > MAX_SLOT_UPLOAD_BYTES) return setError(labels.tooLarge);
    try {
      const loaded = await loadImage(file);
      const size = { w: loaded.naturalWidth, h: loaded.naturalHeight };
      const o = slotSize(px, size);
      setImg(loaded);
      setZoom(1);
      setSentBytes(null);
      setOffset(centered(fitCover(size, o, 1), o));
    } catch {
      setError(labels.unreadable);
    }
  }

  function setZoomKeepingCentre(next: number) {
    if (!imgSize || !out || !drawn) return;
    setOffset(zoomOffset(offset, drawn, fitCover(imgSize, out, next), out));
    setZoom(next);
  }

  function move(dx: number, dy: number) {
    if (!out || !drawn) return;
    setOffset(clampOffset({ x: offset.x + dx, y: offset.y + dy }, drawn, out));
  }

  async function save() {
    if (!img || !out || !drawn) return;
    const canvas = document.createElement('canvas');
    canvas.width = out.w;
    canvas.height = out.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return setError(labels.unreadable);
    render(ctx, img, drawn, offset);
    const blob = await toBlob(canvas);
    if (!blob) return setError(labels.unreadable);
    onChange?.(blob);
    setSentBytes(blob.size);
    setBusy(true);
    try {
      await onUpload(blob);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [NUDGE, 0],
      ArrowRight: [-NUDGE, 0],
      ArrowUp: [0, NUDGE],
      ArrowDown: [0, -NUDGE],
    };
    const step = arrows[e.key];
    if (step) {
      e.preventDefault();
      move(step[0], step[1]);
    } else if (e.key === '+' || e.key === '=') setZoomKeepingCentre(Math.min(3, zoom + 0.1));
    else if (e.key === '-') setZoomKeepingCentre(Math.max(1, zoom - 0.1));
  }

  const ratio = out ? `${out.w} / ${out.h}` : `${px.w || 4} / ${px.h || 3}`;

  return (
    <div
      className={cn('flex w-full max-w-xl flex-col gap-3', className)}
      data-slot="image-slot-upload"
    >
      <div
        className="relative w-full overflow-hidden rounded-lg border border-border-subtle bg-muted"
        style={{ aspectRatio: ratio }}
      >
        {img ? (
          <canvas
            ref={previewRef}
            tabIndex={disabled ? -1 : 0}
            aria-label={labels.zoom}
            data-testid="slot-preview"
            className="size-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, start: offset };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || !drawn || !out) return;
              // Canvas px per screen px, so the image follows the pointer.
              const k = out.w / (e.currentTarget.getBoundingClientRect().width || out.w);
              setOffset(
                clampOffset(
                  { x: d.start.x + (e.clientX - d.x) * k, y: d.start.y + (e.clientY - d.y) * k },
                  drawn,
                  out,
                ),
              );
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          />
        ) : value ? (
          <img src={value} alt="" className="size-full object-cover" />
        ) : null}
      </div>
      {out && (
        <p className="text-caption text-text-secondary">
          {`${out.w} × ${out.h}`}
          {sentBytes !== null && ` · ${Math.max(1, Math.round(sentBytes / 1024))} KB`}
        </p>
      )}
      {img && (
        <label className="flex items-center gap-3 text-sm">
          {labels.zoom}
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            disabled={disabled}
            onChange={(e) => setZoomKeepingCentre(Number(e.target.value))}
            className="min-h-11 flex-1"
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        data-testid="slot-file"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {labels.choose}
        </Button>
        {img && (
          <Button type="button" disabled={disabled || busy} onClick={() => void save()}>
            {labels.save}
          </Button>
        )}
      </div>
    </div>
  );
}

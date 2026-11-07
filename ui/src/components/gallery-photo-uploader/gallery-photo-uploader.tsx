/**
 * [40.6.05] Pick many photos at once; the browser cover-crops each to the gallery's exact size
 * (`SITE_MEDIA_SLOT_PX.gallery`), re-encodes it as WebP and hands it to `onUpload`, one at a
 * time. The original file is never sent (D15, D19); the server still verifies the result.
 *
 * Never auto-retries (Rule 25): a failed photo waits for its own "try again" press. A "photo
 * space full" failure stops the queue and parks the rest. Texts are props, like `ImageSlotUpload`.
 *
 * ponytail: strictly sequential, so album order equals pick order and the 60 cap cannot race.
 * Running two at once is a `uploading` count change in the effect below if speed ever matters.
 * Closing the page stops the queue; a request already in flight still finishes on the server.
 */
import { SITE_MEDIA_SLOT_PX, SiteMediaSlot } from '@biddaloy/shared';
import * as React from 'react';

import { cn } from '../../primitives/lib/utils';
import { Button } from '../button';
import { centered, fitCover, render, slotSize } from '../image-slot-upload/crop-canvas';
import { MAX_SLOT_PIXELS, MAX_SLOT_UPLOAD_BYTES } from '../image-slot-upload/image-slot-upload';

export const GALLERY_WEBP_QUALITY = 0.82;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

export interface GalleryPhotoUploaderLabels {
  /** Visible text of the drop area, also its accessible name. */
  choose: string;
  hint: string;
  /** Accessible name of the hidden file input. */
  pickerLabel: string;
  waiting: string;
  uploading: string;
  done: string;
  failed: string;
  /** Wrong type, over 20 MB or unreadable: the same sentence the server gives. */
  notPhoto: string;
  /** Past `remaining`: never processed. */
  notAdded: string;
  storageFull: string;
  retry: string;
  summary: (done: number, total: number) => string;
}

export interface GalleryPhotoUploaderProps {
  /** How many more photos the album accepts. */
  remaining: number;
  /** Throws on failure. Gets a WebP `File` at exactly the gallery size. */
  onUpload: (file: File) => Promise<void>;
  labels: GalleryPhotoUploaderLabels;
  /** Fixed sentence for a failure; default is `labels.failed`. Never echo the error text. */
  errorText?: (error: unknown, file: File) => string;
  /** True when the failure means photo space is full (stops the queue). */
  isStorageFull?: (error: unknown, file: File) => boolean;
  disabled?: boolean;
  className?: string;
}

type Status = 'waiting' | 'uploading' | 'done' | 'failed' | 'notPhoto' | 'notAdded' | 'storageFull';

interface Item {
  id: number;
  file: File;
  thumb: string;
  status: Status;
  error?: string | undefined;
}

const ACTIVE: Status[] = ['waiting', 'uploading'];

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

/** Cover-crops to the gallery size and encodes WebP at 0.82. Null if the file cannot be used. */
async function prepare(file: File): Promise<File | null> {
  const img = await loadImage(file);
  const src = { w: img.naturalWidth, h: img.naturalHeight };
  if (src.w * src.h > MAX_SLOT_PIXELS) return null;
  const out = slotSize(SITE_MEDIA_SLOT_PX[SiteMediaSlot.GALLERY], src);
  const canvas = document.createElement('canvas');
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const drawn = fitCover(src, out, 1);
  render(ctx, img, drawn, centered(drawn, out));
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', GALLERY_WEBP_QUALITY),
  );
  if (!blob) return null;
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.webp`, {
    type: blob.type,
  });
}

const isUsable = (f: File) =>
  ACCEPT.includes(f.type) && !/\.svg$/i.test(f.name) && f.size <= MAX_SLOT_UPLOAD_BYTES;

export function GalleryPhotoUploader({
  remaining,
  onUpload,
  labels,
  errorText,
  isStorageFull,
  disabled,
  className,
}: GalleryPhotoUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [items, setItems] = React.useState<Item[]>([]);
  const nextId = React.useRef(0);
  const busy = React.useRef(false);
  const alive = React.useRef(true);
  const wasActive = React.useRef(false);
  const thumbs = React.useRef<string[]>([]);
  // Latest props for the async loop, so a re-render never restarts it.
  const latest = React.useRef({ onUpload, errorText, isStorageFull });
  latest.current = { onUpload, errorText, isStorageFull };

  React.useEffect(() => {
    alive.current = true;
    const urls = thumbs.current;
    return () => {
      alive.current = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const patch = React.useCallback((id: number, change: Partial<Item>) => {
    if (alive.current) setItems((all) => all.map((i) => (i.id === id ? { ...i, ...change } : i)));
  }, []);

  const run = React.useCallback(
    async (item: Item) => {
      busy.current = true;
      patch(item.id, { status: 'uploading', error: undefined });
      try {
        const ready = await prepare(item.file);
        if (!ready) {
          patch(item.id, { status: 'notPhoto' });
          return;
        }
        if (!alive.current) return;
        try {
          await latest.current.onUpload(ready);
          patch(item.id, { status: 'done' });
        } catch (error) {
          if (latest.current.isStorageFull?.(error, ready)) {
            if (alive.current) {
              setItems((all) =>
                all.map((i) =>
                  i.id === item.id
                    ? { ...i, status: 'storageFull' }
                    : i.status === 'waiting'
                      ? { ...i, status: 'storageFull' }
                      : i,
                ),
              );
            }
          } else {
            patch(item.id, {
              status: 'failed',
              error: latest.current.errorText?.(error, ready) ?? labels.failed,
            });
          }
        }
      } catch {
        patch(item.id, { status: 'notPhoto' });
      } finally {
        busy.current = false;
      }
    },
    [labels.failed, patch],
  );

  React.useEffect(() => {
    if (busy.current || !alive.current) return;
    const next = items.find((i) => i.status === 'waiting');
    if (next) void run(next);
  }, [items, run]);

  const active = items.some((i) => ACTIVE.includes(i.status));
  React.useEffect(() => {
    // The queue just ended: hand focus back to the drop area.
    if (wasActive.current && !active) buttonRef.current?.focus();
    wasActive.current = active;
  }, [active]);

  function add(files: File[]) {
    if (disabled || files.length === 0) return;
    let room = Math.max(0, remaining - items.filter((i) => ACTIVE.includes(i.status)).length);
    const added: Item[] = files.map((file) => {
      const thumb = URL.createObjectURL(file);
      thumbs.current.push(thumb);
      let status: Status = 'waiting';
      if (!isUsable(file)) status = 'notPhoto';
      else if (room <= 0) status = 'notAdded';
      else room -= 1;
      return { id: nextId.current++, file, thumb, status };
    });
    setItems((all) => [...all, ...added]);
  }

  const counted = items.filter((i) => i.status !== 'notPhoto' && i.status !== 'notAdded');
  const done = counted.filter((i) => i.status === 'done').length;
  const text: Record<Status, string> = {
    waiting: labels.waiting,
    uploading: labels.uploading,
    done: labels.done,
    failed: labels.failed,
    notPhoto: labels.notPhoto,
    notAdded: labels.notAdded,
    storageFull: labels.storageFull,
  };

  return (
    <div className={cn('flex w-full flex-col gap-3', className)} data-slot="gallery-photo-uploader">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled || remaining <= 0}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          add(Array.from(e.dataTransfer.files));
        }}
        className="flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-subtle bg-muted p-4 text-center outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="text-sm font-medium">{labels.choose}</span>
        <span className="text-caption text-text-secondary">{labels.hint}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT.join(',')}
        hidden
        aria-label={labels.pickerLabel}
        data-testid="gallery-files"
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <p aria-live="polite" className="text-caption text-text-secondary">
        {counted.length > 0 ? labels.summary(done, counted.length) : null}
      </p>
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-md border border-border-subtle p-2"
            >
              <img src={item.thumb} alt="" className="size-12 shrink-0 rounded object-cover" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm" dir="auto">
                  {item.file.name}
                </span>
                <span
                  className={cn(
                    'text-caption',
                    item.status === 'failed' || item.status === 'notPhoto'
                      ? 'text-destructive'
                      : 'text-text-secondary',
                  )}
                >
                  {item.status === 'failed' ? (item.error ?? text.failed) : text[item.status]}
                </span>
              </div>
              {(item.status === 'failed' || item.status === 'storageFull') && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => patch(item.id, { status: 'waiting', error: undefined })}
                >
                  {labels.retry}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pure maths for the slot cropper, so it is unit-testable without a DOM. */
export interface Size {
  w: number;
  h: number;
}
export interface Offset {
  x: number;
  y: number;
}
export interface SlotPx extends Size {
  maxW?: number;
}

/** Output size: the slot's exact px; a width-only slot (`w: 0`) keeps the image ratio, capped at `maxW`. */
export function slotSize(slot: SlotPx, img: Size): Size {
  if (slot.w > 0) return { w: slot.w, h: slot.h };
  const w = Math.min(img.w, slot.maxW ?? img.w);
  return { w, h: Math.round((img.h * w) / img.w) };
}

/** Drawn size of the image after "cover" fit at `zoom` (>= 1). */
export function fitCover(img: Size, slot: Size, zoom: number): Size {
  const scale = Math.max(slot.w / img.w, slot.h / img.h) * Math.max(zoom, 1);
  return { w: img.w * scale, h: img.h * scale };
}

/** Top-left of the drawn image, kept so it always covers the slot. */
export function clampOffset(offset: Offset, drawn: Size, slot: Size): Offset {
  return {
    x: Math.min(0, Math.max(slot.w - drawn.w, offset.x)),
    y: Math.min(0, Math.max(slot.h - drawn.h, offset.y)),
  };
}

/** Keep the same image point under the slot centre when zoom changes. */
export function zoomOffset(offset: Offset, from: Size, to: Size, slot: Size): Offset {
  const cx = (slot.w / 2 - offset.x) / from.w;
  const cy = (slot.h / 2 - offset.y) / from.h;
  return clampOffset({ x: slot.w / 2 - cx * to.w, y: slot.h / 2 - cy * to.h }, to, slot);
}

export function centered(drawn: Size, slot: Size): Offset {
  return { x: (slot.w - drawn.w) / 2, y: (slot.h - drawn.h) / 2 };
}

export function render(
  ctx: Pick<CanvasRenderingContext2D, 'drawImage'>,
  img: CanvasImageSource,
  drawn: Size,
  offset: Offset,
): void {
  ctx.drawImage(img, offset.x, offset.y, drawn.w, drawn.h);
}

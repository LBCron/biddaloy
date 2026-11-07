import { swipeStep, wrapIndex } from '../lib/carousel';

/** -1 / 1 for the arrow keys, 0 for any other key. */
export const keyStep = (key: string): -1 | 0 | 1 =>
  key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;

/** The photo shown after `step` from `i` in an album of `n` photos (wraps). */
export const nextPhoto = (i: number, step: number, n: number) => wrapIndex(i + step, n);

/**
 * The photo viewer of the gallery page (D50): a tile opens one native `<dialog>` (modal: the page
 * behind is inert, Tab stays inside, Esc closes) with arrows, a close button, keyboard arrows and
 * swipe. Photos come from the tile's own `<img>`; the caption is set with `textContent`.
 * Focus returns to the tile on close.
 */
export function initGalleryViewer(root: ParentNode = document): void {
  const dialog = root.querySelector<HTMLDialogElement>('dialog[data-gv]');
  if (!dialog || dialog.dataset.ready !== undefined) return;
  dialog.dataset.ready = '';
  const img = dialog.querySelector<HTMLImageElement>('.gv-img')!;
  const cap = dialog.querySelector<HTMLElement>('.gv-cap')!;
  const prev = dialog.querySelector<HTMLElement>('.gv-prev')!;
  const next = dialog.querySelector<HTMLElement>('.gv-next')!;
  let tiles: HTMLElement[] = [];
  let at = 0;
  let opener: HTMLElement | null = null;

  const show = (n: number) => {
    at = nextPhoto(n, 0, tiles.length);
    const tile = tiles[at];
    const thumb = tile.querySelector('img');
    img.src = thumb?.getAttribute('src') ?? '';
    img.alt = thumb?.getAttribute('alt') ?? '';
    cap.textContent = tile.dataset.cap ?? '';
    cap.hidden = !cap.textContent;
    prev.hidden = next.hidden = tiles.length < 2;
  };
  const move = (step: number) => step && show(nextPhoto(at, step, tiles.length));

  root.addEventListener('click', (e) => {
    const tile = (e.target as Element).closest<HTMLElement>('[data-gv-open]');
    if (!tile) return;
    opener = tile;
    tiles = [
      ...(tile.closest('[data-gv-album]') ?? root).querySelectorAll<HTMLElement>('[data-gv-open]'),
    ];
    show(tiles.indexOf(tile));
    dialog.showModal();
    dialog.querySelector<HTMLElement>('.gv-close')?.focus();
  });
  prev.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  dialog.querySelector('.gv-close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  dialog.addEventListener('keydown', (e) => move(keyStep(e.key)));
  dialog.addEventListener('close', () => {
    img.removeAttribute('src');
    opener?.focus();
  });

  let x0: number | null = null;
  dialog.addEventListener('touchstart', (e) => (x0 = e.touches[0]?.clientX ?? null), {
    passive: true,
  });
  dialog.addEventListener('touchend', (e) => {
    const x1 = e.changedTouches[0]?.clientX;
    if (x0 !== null && x1 !== undefined) move(swipeStep(x1 - x0));
    x0 = null;
  });
}

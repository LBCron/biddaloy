/** Auto-advance period (D26). */
export const AUTO_MS = 6000;
/** A horizontal drag shorter than this many pixels is a tap, not a swipe. */
export const SWIPE_PX = 40;

/** `i` wrapped into `0..count-1`; 0 for an empty list. */
export function wrapIndex(i: number, count: number): number {
  return count > 0 ? ((i % count) + count) % count : 0;
}

/** -1 (previous), 1 (next) or 0 (a tap) for a finger that moved `dx` pixels to the right. */
export function swipeStep(dx: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_PX) return 0;
  return dx < 0 ? 1 : -1;
}

/** Auto-advance only for 2+ slides and only when the visitor has not asked for less motion. */
export const shouldAutoplay = (count: number, reduceMotion: boolean) => count > 1 && !reduceMotion;

/**
 * Wires one `.hc` carousel: prev/next, dots, 6 s auto-advance (paused on hover and focus, off under
 * `prefers-reduced-motion`) and touch swipe. A single slide gets no timer and no listeners.
 * Shared by the hero and the gallery carousel; the markup contract is `.hc-track`, `.hc-slide`,
 * `.hc-prev`, `.hc-next` and `.hc-dots button`.
 */
export function initCarousel(root: HTMLElement): void {
  const track = root.querySelector<HTMLElement>('.hc-track');
  const slides = root.querySelectorAll<HTMLElement>('.hc-slide');
  const dots = root.querySelectorAll<HTMLElement>('.hc-dots button');
  if (!track || slides.length < 2 || root.dataset.ready !== undefined) return;
  root.dataset.ready = '';
  const reduce =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const go = (n: number) => {
    i = wrapIndex(n, slides.length);
    track.style.transform = `translateX(${-100 * i}%)`;
    slides.forEach((s, k) =>
      k === i ? s.removeAttribute('aria-hidden') : s.setAttribute('aria-hidden', 'true'),
    );
    dots.forEach((d, k) => d.setAttribute('aria-current', k === i ? 'true' : 'false'));
  };
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const start = () => {
    if (shouldAutoplay(slides.length, reduce) && !timer)
      timer = setInterval(() => go(i + 1), AUTO_MS);
  };

  root.querySelector('.hc-prev')?.addEventListener('click', () => go(i - 1));
  root.querySelector('.hc-next')?.addEventListener('click', () => go(i + 1));
  dots.forEach((d, k) => d.addEventListener('click', () => go(k)));
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', start);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', start);

  let x0: number | null = null;
  root.addEventListener('touchstart', (e) => (x0 = e.touches[0]?.clientX ?? null), {
    passive: true,
  });
  root.addEventListener('touchend', (e) => {
    const x1 = e.changedTouches[0]?.clientX;
    const step = x0 === null || x1 === undefined ? 0 : swipeStep(x1 - x0);
    x0 = null;
    if (step) go(i + step);
  });
  start();
}

/** Every `[data-carousel]` on the page. */
export const initCarousels = () =>
  document.querySelectorAll<HTMLElement>('[data-carousel]').forEach(initCarousel);

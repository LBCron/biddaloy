// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_MS, initCarousel, shouldAutoplay, swipeStep, wrapIndex } from './carousel';

function mount(n: number): HTMLElement {
  const slides = Array.from(
    { length: n },
    (_, i) => `<div class="hc-slide"${i ? ' aria-hidden="true"' : ''}></div>`,
  ).join('');
  const dots = Array.from({ length: n }, () => '<button></button>').join('');
  document.body.innerHTML = `<div class="hc" data-carousel><div class="hc-track">${slides}</div><button class="hc-prev"></button><button class="hc-next"></button><div class="hc-dots">${dots}</div></div>`;
  return document.querySelector<HTMLElement>('.hc')!;
}
const shown = (r: HTMLElement) =>
  [...r.querySelectorAll('.hc-slide')].findIndex((s) => !s.hasAttribute('aria-hidden'));
const reduced = (on: boolean) =>
  vi.stubGlobal('matchMedia', () => ({ matches: on }) as MediaQueryList);
const touch = (el: HTMLElement, type: string, x: number) => {
  const e = new Event(type, { bubbles: true }) as Event & {
    touches: unknown;
    changedTouches: unknown;
  };
  e.touches = e.changedTouches = [{ clientX: x }];
  el.dispatchEvent(e);
};

describe('index math', () => {
  it('wraps both ways and bounds an empty list', () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(-7, 3)).toBe(2);
    expect(wrapIndex(5, 0)).toBe(0);
  });
  it('swipe: a short drag is a tap, left is next, right is previous', () => {
    expect(swipeStep(10)).toBe(0);
    expect(swipeStep(-60)).toBe(1);
    expect(swipeStep(60)).toBe(-1);
  });
  it('autoplay needs 2+ slides and no reduced motion', () => {
    expect(shouldAutoplay(1, false)).toBe(false);
    expect(shouldAutoplay(3, true)).toBe(false);
    expect(shouldAutoplay(3, false)).toBe(true);
  });
});

describe('initCarousel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reduced(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('one slide: no timer, buttons do nothing', () => {
    const r = mount(1);
    initCarousel(r);
    vi.advanceTimersByTime(AUTO_MS * 3);
    expect(vi.getTimerCount()).toBe(0);
    r.querySelector<HTMLElement>('.hc-next')!.click();
    expect(shown(r)).toBe(0);
  });

  it('several: advances every 6 s and wraps; dots follow', () => {
    const r = mount(3);
    initCarousel(r);
    vi.advanceTimersByTime(AUTO_MS);
    expect(shown(r)).toBe(1);
    expect(r.querySelectorAll('.hc-dots button')[1].getAttribute('aria-current')).toBe('true');
    vi.advanceTimersByTime(AUTO_MS * 2);
    expect(shown(r)).toBe(0);
  });

  it('prev/next buttons and dots move; prev wraps to the last', () => {
    const r = mount(3);
    initCarousel(r);
    r.querySelector<HTMLElement>('.hc-prev')!.click();
    expect(shown(r)).toBe(2);
    r.querySelectorAll<HTMLElement>('.hc-dots button')[1].click();
    expect(shown(r)).toBe(1);
  });

  it('pauses on hover and on focus, resumes on leave', () => {
    const r = mount(3);
    initCarousel(r);
    r.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(AUTO_MS * 2);
    expect(shown(r)).toBe(0);
    r.dispatchEvent(new Event('mouseleave'));
    r.dispatchEvent(new Event('focusin'));
    vi.advanceTimersByTime(AUTO_MS * 2);
    expect(shown(r)).toBe(0);
    r.dispatchEvent(new Event('focusout'));
    vi.advanceTimersByTime(AUTO_MS);
    expect(shown(r)).toBe(1);
  });

  it('never auto-advances under prefers-reduced-motion; buttons still work', () => {
    reduced(true);
    const r = mount(3);
    initCarousel(r);
    vi.advanceTimersByTime(AUTO_MS * 3);
    expect(shown(r)).toBe(0);
    r.querySelector<HTMLElement>('.hc-next')!.click();
    expect(shown(r)).toBe(1);
  });

  it('swipe moves exactly one slide; a tap moves none', () => {
    const r = mount(3);
    initCarousel(r);
    touch(r, 'touchstart', 200);
    touch(r, 'touchend', 100);
    expect(shown(r)).toBe(1);
    touch(r, 'touchstart', 100);
    touch(r, 'touchend', 105);
    expect(shown(r)).toBe(1);
    touch(r, 'touchstart', 100);
    touch(r, 'touchend', 220);
    expect(shown(r)).toBe(0);
  });

  it('a second init on the same root does not double the timer', () => {
    const r = mount(3);
    initCarousel(r);
    initCarousel(r);
    vi.advanceTimersByTime(AUTO_MS);
    expect(shown(r)).toBe(1);
  });
});

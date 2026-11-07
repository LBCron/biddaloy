import { describe, expect, it } from 'vitest';

import { CONTRAST_PAIRS } from '../../tailwind.preset';

import { contrastRatio, normalizeHex, relativeLuminance } from './contrast';

/**
 * Proves `contrast.ts` — the browser-safe fork used by
 * `colors.stories.tsx` — agrees with `scripts/check-contrast.mjs`'s own
 * relative-luminance math, which is the whole reason this fork exists
 * rather than a re-typed approximation. Every pair `check-contrast.mjs`
 * already verifies is re-checked here so the two files cannot drift apart
 * silently.
 */
describe('contrastRatio (WCAG 2.2 relative-luminance math)', () => {
  it('matches the textbook black-on-white ratio of 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('is the identity ratio (1:1) for a colour against itself', () => {
    expect(contrastRatio('#4a3fd4', '#4a3fd4')).toBeCloseTo(1, 5);
  });

  it('is symmetric — argument order does not change the ratio', () => {
    expect(contrastRatio('#4a3fd4', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#4a3fd4'),
      10,
    );
  });

  it('rejects a non-hex colour, same as check-contrast.mjs', () => {
    expect(() => relativeLuminance('rgb(0, 0, 0)')).toThrow(TypeError);
    expect(() => relativeLuminance('#fff')).toThrow(TypeError);
  });

  it('rejects a malformed oklch() instead of returning NaN (NaN would pass every gate)', () => {
    expect(() => relativeLuminance('oklch(0.5. 0.1 30)')).toThrow(TypeError);
    expect(() => relativeLuminance('oklch(. 0.1 30)')).toThrow(TypeError);
    expect(() => relativeLuminance('oklch(0.5 0.1)')).toThrow(TypeError);
    expect(Number.isFinite(relativeLuminance('oklch(0.5 0.1 30)'))).toBe(true);
    expect(Number.isFinite(relativeLuminance('oklch(.5 .1 30)'))).toBe(true);
  });

  it.each(CONTRAST_PAIRS)('clears its documented WCAG minimum: $name', ({ fg, bg, min }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

/**
 * `colors.stories.tsx` reads live CSS custom properties out of Storybook's
 * *built* stylesheet, not the hand-authored source — and Vite's CSS
 * minifier losslessly shortens a six-digit hex to three digits wherever it
 * can (`#ffffff` -> `#fff`), which `getComputedStyle` then hands straight
 * back. Neither `tailwind.preset.ts` nor `globals.css` ever writes the
 * shorthand form, so this only ever shows up post-build — caught by
 * loading the actual built Storybook in a real browser, not by this spec
 * file, which is why this suite exists at all: to pin the fix.
 */
describe('normalizeHex (undoes CSS minification, not a colour transform)', () => {
  it('expands three-digit shorthand to six digits', () => {
    expect(normalizeHex('#fff')).toBe('#ffffff');
    expect(normalizeHex('#000')).toBe('#000000');
    expect(normalizeHex('#abc')).toBe('#aabbcc');
  });

  it('leaves an already six-digit value unchanged', () => {
    expect(normalizeHex('#4a3fd4')).toBe('#4a3fd4');
  });

  it('leaves a non-hex value (including empty string) unchanged', () => {
    expect(normalizeHex('')).toBe('');
    expect(normalizeHex('rgb(0, 0, 0)')).toBe('rgb(0, 0, 0)');
  });

  it('round-trips through contrastRatio the same as the six-digit source', () => {
    expect(contrastRatio(normalizeHex('#fff'), normalizeHex('#000'))).toBeCloseTo(
      contrastRatio('#ffffff', '#000000'),
      10,
    );
  });
});

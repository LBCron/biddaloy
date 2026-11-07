/**
 * WCAG 2.2 relative-luminance / contrast-ratio math — a fork of
 * `scripts/check-contrast.mjs`'s own implementation, not an import of it.
 * That script is a standalone CI entry point (`node
 * --experimental-strip-types scripts/check-contrast.mjs`) with top-level
 * `process.exit` side effects and Node-only `fs`/`path` reads, so importing
 * it into a browser bundle would drag those in and likely just crash
 * Storybook's Vite build. This file is the same ~15-line maths, nothing
 * else, so `colors.stories.tsx` can compute a real ratio at render time
 * instead of printing a pre-baked number out of `CONTRAST_PAIRS`.
 *
 * `contrast.spec.ts` asserts this fork agrees with the script on every pair
 * `CONTRAST_PAIRS` already lists, so the two cannot silently drift apart.
 */

const HEX_RE = /^#[0-9a-f]{6}$/i;
const OKLCH_RE = /^oklch\(\s*(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s*\)$/i;
const SHORT_HEX_RE = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;

/**
 * Expands CSS shorthand hex (`#fff`) to the six-digit form the rest of this
 * file (and `check-contrast.mjs`) expects. Needed only for
 * `useComputedVar`'s live browser reads: `tailwind.preset.ts` and
 * `globals.css` always write six-digit hex, but Storybook's production
 * build minifies the compiled CSS, and Vite's CSS minifier losslessly
 * shortens `#ffffff` to `#fff` wherever it can — so `getComputedStyle`
 * hands back the shorthand form even though nothing in this repo's own
 * source ever wrote it. Values that are already six digits, or aren't hex
 * at all, pass through unchanged; `relativeLuminance` below still rejects
 * anything that isn't a valid hex colour after this step.
 */
export function normalizeHex(value: string): string {
  const short = SHORT_HEX_RE.exec(value);
  if (!short) return value;
  const [, r, g, b] = short;
  return `#${r}${r}${g}${g}${b}${b}`;
}

function srgbToLinear(c: number): number {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

/** `oklch(L C h)` -> linear sRGB [r,g,b], clipped to gamut (Ottosson's matrices). Mirrors check-contrast.mjs. */
function oklchToLinear(L: number, C: number, hDeg: number): [number, number, number] {
  const a = C * Math.cos((hDeg * Math.PI) / 180);
  const b = C * Math.sin((hDeg * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function relativeLuminance(hex: string): number {
  const ok = OKLCH_RE.exec(hex);
  if (ok) {
    const [L, C, h] = [Number(ok[1]), Number(ok[2]), Number(ok[3])];
    // A NaN would pass every ratio check (NaN < min is false), so refuse it.
    if (![L, C, h].every(Number.isFinite)) {
      throw new TypeError(`malformed oklch() colour: ${JSON.stringify(hex)}`);
    }
    const [r, g, b] = oklchToLinear(L, C, h);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  if (!HEX_RE.test(hex)) {
    // NaN < min is false, so an unvalidated bad value would silently pass
    // every ratio check below it — fail loudly instead, same as the script.
    throw new TypeError(`expected a #RRGGBB or oklch() colour, got ${JSON.stringify(hex)}`);
  }
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lighter = Math.max(relativeLuminance(hexA), relativeLuminance(hexB));
  const darker = Math.min(relativeLuminance(hexA), relativeLuminance(hexB));
  return (lighter + 0.05) / (darker + 0.05);
}

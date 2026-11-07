#!/usr/bin/env node
/**
 * Verify every documented token pair against WCAG 2.2 contrast minimums, and
 * verify the CSS mirror in globals.css has not drifted from the TypeScript
 * source of truth.
 *
 * Two failure modes, both silent until someone notices a component is hard
 * to read:
 *
 *  1. A colour value that does not actually clear its required ratio. Values
 *     in tailwind.preset.ts are asserted here rather than trusted, because a
 *     hex code "looking about right" is not evidence.
 *
 *  2. globals.css drifting from tailwind.preset.ts. The CSS `@theme` block
 *     is a hand-maintained mirror of the TS token values (Tailwind v4 has no
 *     mechanism to generate CSS custom properties from a TS file), so
 *     nothing stops the two from disagreeing except this check.
 *
 * The drift check compares parsed `--name: value;` declarations by name and
 * scope, not by searching for a hex value anywhere in the file. An earlier
 * version did the latter (`css.includes(hex)`), which cannot catch a real
 * mistake: swapping `--color-status-paid-fg` and `--color-status-paid-bg`
 * leaves both hex strings present *somewhere* in the file, so a
 * presence-only check still reports OK while the badge is now unreadable.
 *
 * Run via `node --experimental-strip-types` — see check:contrast in
 * package.json. That flag imports tailwind.preset.ts's real exported
 * values directly rather than re-parsing them by hand; CONTRAST_PAIRS
 * references other exported constants (e.g. `light.textPrimary`), not
 * repeated literals, so a text-regex parse cannot reconstruct it correctly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HEX_RE = /^#[0-9a-f]{6}$/i;
const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

/** `oklch(L C h)` -> linear sRGB [r,g,b], clipped to gamut (Ottosson's matrices). */
function oklchToLinear(L, C, hDeg) {
  const a = C * Math.cos((hDeg * Math.PI) / 180);
  const b = C * Math.sin((hDeg * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => Math.min(1, Math.max(0, x)));
}

function srgbToLinear(c) {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const ok = OKLCH_RE.exec(hex);
  if (ok) {
    const [r, gr, b] = oklchToLinear(+ok[1], +ok[2], +ok[3]);
    return 0.2126 * r + 0.7152 * gr + 0.0722 * b;
  }
  if (!HEX_RE.test(hex)) {
    // NaN < min is false, so an unvalidated bad value would silently pass
    // every ratio check below it — fail loudly instead.
    throw new TypeError(`expected a #RRGGBB colour, got ${JSON.stringify(hex)}`);
  }
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hexA, hexB) {
  const [l1, l2] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Extract `--name: value;` declarations from one CSS block's body (the text
 * between its outermost `{` and matching `}`). Good enough for this file's
 * hand-authored shape — not a general CSS parser — but real enough to catch
 * a name/value mismatch, which string search cannot.
 */
function parseDeclarations(blockBody) {
  const vars = {};
  const withoutComments = blockBody.replace(/\/\*[\s\S]*?\*\//g, '');
  const declRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match;
  while ((match = declRe.exec(withoutComments))) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

function extractBlock(css, selectorRe) {
  const start = css.search(selectorRe);
  if (start === -1) return null;
  const braceStart = css.indexOf('{', start);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(braceStart + 1, i);
    }
  }
  return null;
}

/**
 * Every block in `css` whose selector matches `selectorRe`, not just the
 * first. `extractBlock` above binds to one block on purpose (it is looking
 * for a specific, contents-identified block); this one is for guards that
 * must hold for ALL blocks of a shape, where finding one clean example
 * proves nothing.
 */
function extractAllBlocks(css, selectorRe) {
  const bodies = [];
  const re = new RegExp(selectorRe.source, `${selectorRe.flags.replace('g', '')}g`);
  let match;
  while ((match = re.exec(css))) {
    const body = extractBlock(css.slice(match.index), selectorRe);
    if (body !== null) bodies.push(body);
    re.lastIndex = match.index + match[0].length;
  }
  return bodies;
}

/** `#RRGGBB` -> the `var(--color-scale-key)` string it should appear as, by
 * reverse-lookup against the raw scale. Semantic role tokens are authored as
 * references to the raw scale (see globals.css's own comment on why), so the
 * *correct* expected form is the reference, not the literal hex it resolves to. */
function buildReverseLookup(preset) {
  const byHex = {};
  for (const [key, hex] of Object.entries(preset.neutral))
    byHex[hex] = `var(--color-neutral-${key})`;
  for (const [key, hex] of Object.entries(preset.brand)) byHex[hex] = `var(--color-brand-${key})`;
  return byHex;
}

const errors = [];

const preset = await import(join(pkgRoot, 'tailwind.preset.ts'));

if (preset.CONTRAST_PAIRS.length === 0) {
  errors.push('CONTRAST_PAIRS is empty — no pairs are being verified.');
}

for (const { name, fg, bg, min } of preset.CONTRAST_PAIRS) {
  const actual = contrastRatio(fg, bg);
  if (actual < min) {
    errors.push(`${name}: ${fg} on ${bg} is ${actual.toFixed(2)}:1, needs >=${min}:1`);
  }
}

// --- Drift check: parsed name -> value, scoped to @theme (light/default) vs
// :root[data-theme="dark"], compared against what tailwind.preset.ts says
// each name should hold in that scope.
const cssPath = join(pkgRoot, 'src', 'styles', 'globals.css');
const css = readFileSync(cssPath, 'utf8');

const themeBody = extractBlock(css, /@theme\s*\{/);
const darkBody = extractBlock(css, /:root\[data-theme=["']dark["']\]\s*\{/);
// The plain `:root` block holding the light elevation values. `@theme`
// cannot hold them itself — see the long note in globals.css.
//
// Matched by its CONTENTS, not by being the first plain `:root` in the file.
// Binding to the first one would break the moment another plain `:root` is
// added above it (a `color-scheme` declaration is the obvious candidate when
// #353 ships the theme toggle): the gate would parse that block, find no
// `--elevation-*`, and fail while pointing at entirely the wrong thing.
const rootBody = extractBlock(css, /:root\s*\{(?=[^}]*--elevation-)/);
// Likewise the plain `:root` holding the motion family — a second contents-
// matched block, for the same reason and with the same protection against
// binding to whichever plain `:root` happens to come first in the file.
const motionRootBody = extractBlock(css, /:root\s*\{(?=[^}]*--motion-)/);
// Density (contract §6) lives on an attribute selector, not `:root`: it is a
// mode applied to a SUBTREE (the portal/auth shell) while the rest of the app
// keeps the compact default. Matched by the attribute rather than by
// position, same as the contents-matched blocks above.
const densityBody = extractBlock(css, /\[data-density=["']comfortable["']\]\s*\{/);
if (themeBody === null) errors.push('globals.css: could not find an @theme block to check.');
if (darkBody === null)
  errors.push('globals.css: could not find a :root[data-theme="dark"] block to check.');
if (rootBody === null) errors.push('globals.css: could not find a plain :root block to check.');
if (motionRootBody === null)
  errors.push('globals.css: could not find a plain :root block declaring --motion-* to check.');
if (densityBody === null)
  errors.push(
    "globals.css: could not find a [data-density='comfortable'] block to check — comfortable " +
      'density (contract §6) is unreachable, so /portal renders at the compact 32px control ' +
      'height while its e2e gate demands 44px.',
  );

const lightVars = themeBody === null ? {} : parseDeclarations(themeBody);
const darkVars = darkBody === null ? {} : parseDeclarations(darkBody);
const rootVars = rootBody === null ? {} : parseDeclarations(rootBody);
const motionVars = motionRootBody === null ? {} : parseDeclarations(motionRootBody);
const densityVars = densityBody === null ? {} : parseDeclarations(densityBody);

/**
 * EVERY plain `:root { … }` block in the file, parsed.
 *
 * `rootVars`/`motionVars` above are each bound to one specific block by a
 * contents lookahead (`--elevation-`, `--motion-`). That is right for what
 * they assert, but it left the "no plain `:root` density default" guard
 * below with a hole big enough to drive the regression through: a THIRD
 * plain `:root { --control-h: … }` block containing neither marker was
 * extracted by neither lookahead, so the guard inspected two blocks that
 * could not contain the variable, found nothing, and passed — while compact
 * density had just become globally unreachable. The guard promised a check
 * it did not perform, which is worse than not having it.
 *
 * Comments are stripped FIRST. `globals.css`'s own density note spells out
 * the banned shape in prose — it literally writes `:root { --control-h: … }`
 * to explain why there isn't one — so scanning the raw text would match the
 * documentation and fail on a correct file.
 */
const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const plainRootVars = extractAllBlocks(cssWithoutComments, /:root\s*\{/).map(parseDeclarations);

function expectVar(scopeVars, scopeName, varName, expectedValue) {
  const actual = scopeVars[varName];
  if (actual === undefined) {
    errors.push(`${scopeName}: expected ${varName}: ${expectedValue}; — declaration missing.`);
    return;
  }
  if (actual !== expectedValue) {
    errors.push(`${scopeName}: ${varName} is "${actual}", expected "${expectedValue}".`);
  }
}

// Raw scale: literal hex, always.
for (const [key, hex] of Object.entries(preset.neutral)) {
  expectVar(lightVars, '@theme', `--color-neutral-${key}`, hex);
}
for (const [key, hex] of Object.entries(preset.brand)) {
  expectVar(lightVars, '@theme', `--color-brand-${key}`, hex);
}
for (const [key, value] of Object.entries(preset.radius)) {
  expectVar(lightVars, '@theme', `--radius-${key}`, value);
}

// Status: fg/bg literal in light scope; fgDark/bgDark literal in dark scope.
// Why `-bg` needs a dark-scope override at all:
// docs/architecture/09-design-direction.md §3.5.1.
for (const [statusKey, entry] of Object.entries(preset.status)) {
  expectVar(lightVars, '@theme', `--color-status-${statusKey}-fg`, entry.fg);
  expectVar(lightVars, '@theme', `--color-status-${statusKey}-bg`, entry.bg);
  expectVar(darkVars, ':root[data-theme="dark"]', `--color-status-${statusKey}-fg`, entry.fgDark);
  expectVar(darkVars, ':root[data-theme="dark"]', `--color-status-${statusKey}-bg`, entry.bgDark);
}

// Signal (epic #3592): same shape as status, values are OKLCH strings.
for (const [key, entry] of Object.entries(preset.signal)) {
  expectVar(lightVars, '@theme', `--color-signal-${key}-fg`, entry.fg);
  expectVar(lightVars, '@theme', `--color-signal-${key}-bg`, entry.bg);
  expectVar(darkVars, ':root[data-theme="dark"]', `--color-signal-${key}-fg`, entry.fgDark);
  expectVar(darkVars, ':root[data-theme="dark"]', `--color-signal-${key}-bg`, entry.bgDark);
}

// Typography (design contract §2). Typography is a token family like colour
// is, so it gets the same drift gate: the ramp lives in tailwind.preset.ts and
// globals.css only mirrors it. Unlike colour these are theme-invariant — a
// heading is 22px in dark mode too — so they are asserted in the @theme scope
// only, and the dark block is asserted NOT to redefine them.
expectVar(lightVars, '@theme', '--font-sans', preset.typography.fontSans);

const RAMP_SUBPROPS = [
  ['size', ''],
  ['lineHeight', '--line-height'],
  ['weight', '--font-weight'],
  ['tracking', '--letter-spacing'],
];
for (const [step, values] of [
  ...Object.entries(preset.typography.ramp),
  ...Object.entries(preset.typography.printRamp),
]) {
  for (const [tsKey, cssSuffix] of RAMP_SUBPROPS) {
    expectVar(lightVars, '@theme', `--text-${step}${cssSuffix}`, values[tsKey]);
  }
  for (const [, cssSuffix] of RAMP_SUBPROPS) {
    const name = `--text-${step}${cssSuffix}`;
    if (darkVars[name] !== undefined) {
      errors.push(
        `:root[data-theme="dark"]: ${name} is redefined ("${darkVars[name]}"). ` +
          'The type ramp is theme-invariant — remove it from the dark block.',
      );
    }
  }
}
if (darkVars['--font-sans'] !== undefined) {
  errors.push(':root[data-theme="dark"]: --font-sans is redefined; the family is theme-invariant.');
}

// Semantic roles: authored as `var(--color-scale-key)` references where the
// value matches a raw-scale entry, or a literal hex where it does not (e.g.
// dark.surface has no raw-scale equivalent).
const reverseLookup = buildReverseLookup(preset);
const roleVarNames = {
  bg: '--color-bg',
  surface: '--color-surface',
  textPrimary: '--color-text-primary',
  textSecondary: '--color-text-secondary',
  border: '--color-border-functional',
  // Subtle border is registered here for drift/lockstep only. It has no
  // CONTRAST_PAIRS row on purpose (decorative, exempt from SC 1.4.11) —
  // this gate is what stops the preset and globals.css disagreeing about it.
  borderSubtle: '--color-border-subtle',
  brand: '--color-brand',
};
for (const [roleKey, cssVarName] of Object.entries(roleVarNames)) {
  const lightExpected = reverseLookup[preset.light[roleKey]] ?? preset.light[roleKey];
  expectVar(lightVars, '@theme', cssVarName, lightExpected);

  const darkExpected = reverseLookup[preset.dark[roleKey]] ?? preset.dark[roleKey];
  expectVar(darkVars, ':root[data-theme="dark"]', cssVarName, darkExpected);
}

/**
 * Elevation (design contract §5). Shadows are not colours, so there is no
 * ratio to check — but they are a mirrored token family, so they get the same
 * drift gate everything else here gets, across three scopes:
 *
 *  1. `@theme` must point `--shadow-eN` at `var(--elevation-eN)` and not at a
 *     literal. This is the assertion that actually matters: Tailwind v4
 *     inlines a `--shadow-*` theme value into the utility at build time, so
 *     writing the numbers here instead would compile a shadow the dark block
 *     cannot override — dead CSS that silently does nothing. Someone
 *     "simplifying" the indirection away breaks dark mode and sees no error
 *     anywhere else; this line is that error.
 *  2. The plain `:root` block holds the light values.
 *  3. `:root[data-theme="dark"]` holds the dark ones.
 *
 * Values are compared as exact strings, so `0.40` may not become `0.4`.
 */
const lightSteps = Object.keys(preset.shadows.light);
const darkSteps = Object.keys(preset.shadows.dark);
if (lightSteps.join(',') !== darkSteps.join(',')) {
  errors.push(
    `tailwind.preset.ts: shadows.light has steps [${lightSteps}] but shadows.dark has ` +
      `[${darkSteps}] — every step needs both halves or one theme silently loses it.`,
  );
}
for (const step of lightSteps) {
  expectVar(lightVars, '@theme', `--shadow-${step}`, `var(--elevation-${step})`);
  expectVar(rootVars, ':root', `--elevation-${step}`, preset.shadows.light[step]);
  expectVar(darkVars, ':root[data-theme="dark"]', `--elevation-${step}`, preset.shadows.dark[step]);

  // The other route to the same dead-CSS bug. Asserting `@theme` holds the
  // indirection is only half the guard: someone debugging dark shadows will
  // reach for `--shadow-e2` in the dark block, and because the utility reads
  // `var(--elevation-e2)`, that declaration does nothing at all. Without this
  // check the gate would print OK over exactly the silent failure it exists
  // to catch.
  if (darkVars[`--shadow-${step}`] !== undefined) {
    errors.push(
      `globals.css: :root[data-theme="dark"] declares --shadow-${step}, which has no effect — ` +
        `the .shadow-${step} utility reads var(--elevation-${step}). Override --elevation-${step} instead.`,
    );
  }
}

/**
 * Motion (design contract §7). Five values, mirrored in a plain `:root` —
 * motion is theme-invariant, so unlike colour there is no dark half. The
 * dark block is asserted NOT to redefine any of them: a stray override there
 * is exactly the silent drift §1 means by "same value in both scopes".
 *
 * Values are literals, not hexes, so no ratio applies — this is a pure
 * mirror check, the same one typography gets.
 *
 * Scope matters here as much as value. `@theme` is asserted NOT to hold
 * them, because Tailwind v4 tree-shakes `@theme`: a variable no scanned
 * utility reads is dropped from the build entirely, so an `@theme` motion
 * family would compile to nothing and every `var(--motion-duration-base)`
 * outside a scanned class would silently resolve to an invalid value. The
 * compiled-output assertion further down is the end-to-end proof; this is
 * the one that names the cause.
 */
const motionVarNames = {
  durationFast: '--motion-duration-fast',
  durationBase: '--motion-duration-base',
  durationSlow: '--motion-duration-slow',
  easeStandard: '--motion-ease-standard',
  easeExit: '--motion-ease-exit',
};
for (const [key, cssVarName] of Object.entries(motionVarNames)) {
  expectVar(motionVars, ':root', cssVarName, preset.motion[key]);
  if (lightVars[cssVarName] !== undefined) {
    errors.push(
      `@theme: ${cssVarName} is declared here, where Tailwind drops it unless a scanned ` +
        'utility reads it. Declare motion tokens in the plain :root block instead.',
    );
  }
  if (darkVars[cssVarName] !== undefined) {
    errors.push(
      `:root[data-theme="dark"]: ${cssVarName} is redefined ("${darkVars[cssVarName]}"). ` +
        'Motion is theme-invariant — remove it from the dark block.',
    );
  }
}

/**
 * Density (design contract §6). Two numeric modes selected by a
 * `data-density` attribute, not by a component prop.
 *
 * Unlike colour, type, elevation and motion, density has NO
 * `tailwind.preset.ts` export to mirror — §9's row for #349 asks for the
 * attribute mechanism and the per-variant mapping, not a preset family, and
 * inventing one would give the drift check a second source of truth for a
 * single number. So the contract's 44px is written here as the literal it is
 * in §6's table.
 *
 * Scope matters exactly as much as it does for motion, and for one more
 * reason on top: `@theme` is asserted NOT to hold `--control-h` both because
 * Tailwind v4 tree-shakes unused `@theme` variables AND because `@theme`
 * only ever emits into `:root`. A `:root` density variable is not a mode at
 * all — it would apply the portal's 44px controls to every staff table in
 * the app, which is the precise regression this ticket exists to avoid.
 *
 * There must also be no plain `:root` default, checked against EVERY plain
 * `:root` block in the file rather than the two contents-identified ones the
 * elevation and motion guards bind to — a third block holding neither marker
 * is exactly how this default would sneak in. The compact heights are eight
 * DIFFERENT values (24/28/32/36px and their icon twins), carried by the
 * per-variant `var(--control-h, <today>)` fallbacks; a root default would
 * shadow all eight with one number and, worse, make every fallback dead code
 * so a typo in one could never be caught.
 */
const DENSITY_EXPECTATIONS = [
  ['--control-h', '2.75rem', 'comfortable control height — 44px, WCAG 2.2 SC 2.5.5'],
  [
    '--target-inset',
    '0.875rem',
    'comfortable checkbox/radio hit-area inset — 16px + 2x14px = 44px',
  ],
];
for (const [cssVarName, expectedValue, description] of DENSITY_EXPECTATIONS) {
  expectVar(densityVars, "[data-density='comfortable']", cssVarName, expectedValue);
  if (lightVars[cssVarName] !== undefined) {
    errors.push(
      `@theme: ${cssVarName} is declared here. @theme is tree-shaken AND only ever emits into ` +
        ':root, so density would stop being a per-subtree mode and every staff route would ' +
        `inherit the portal's target sizes. Declare it in the [data-density='comfortable'] ` +
        'block instead.',
    );
  }
  if (plainRootVars.some((vars) => vars[cssVarName] !== undefined)) {
    errors.push(
      `globals.css: ${cssVarName} is declared in a plain :root, which makes compact density ` +
        'unreachable — every staff control would take the comfortable value, and the ' +
        'per-variant var() fallbacks that carry the eight compact heights would become dead ' +
        `code. The ${description} belongs only in the [data-density='comfortable'] block.`,
    );
  }
  if (darkVars[cssVarName] !== undefined) {
    errors.push(
      `:root[data-theme="dark"]: ${cssVarName} is redefined ("${darkVars[cssVarName]}"). ` +
        'A target does not change size in dark mode — remove it from the dark block.',
    );
  }
}

/**
 * The literal class strings shipped by
 * `primitives/{button,input,select,tabs,checkbox,radio-group}.tsx` and the
 * inset password toggle in `components/sign-in-form.tsx`, paired with
 * the declaration each must compile to. Asserted against real compiler
 * output further down; see the long note there for why source text alone is
 * not enough. Keeping this list in sync with the primitives is the point: a
 * fallback typo (`2rem` written as `2em`) changes a STAFF control's height,
 * where nothing else looks, while the portal — which never reads the
 * fallback — stays perfect.
 */
const densityCandidates = [
  // `button` size `default` and `input` share the 32px fallback.
  ['h-[var(--control-h,2rem)]', 'height: var(--control-h,2rem)'],
  ['h-[var(--control-h,1.5rem)]', 'height: var(--control-h,1.5rem)'],
  ['h-[var(--control-h,1.75rem)]', 'height: var(--control-h,1.75rem)'],
  ['h-[var(--control-h,2.25rem)]', 'height: var(--control-h,2.25rem)'],
  ['size-[var(--control-h,2rem)]', 'height: var(--control-h,2rem)'],
  ['size-[var(--control-h,1.5rem)]', 'height: var(--control-h,1.5rem)'],
  ['size-[var(--control-h,1.75rem)]', 'height: var(--control-h,1.75rem)'],
  ['size-[var(--control-h,2.25rem)]', 'height: var(--control-h,2.25rem)'],
  ['data-[size=default]:h-[var(--control-h,2rem)]', 'height: var(--control-h,2rem)'],
  ['data-[size=sm]:h-[var(--control-h,1.75rem)]', 'height: var(--control-h,1.75rem)'],
  [
    'group-data-[orientation=horizontal]/tabs:h-[var(--control-h,2rem)]',
    'height: var(--control-h,2rem)',
  ],
  // The password toggle in `sign-in-form.tsx` is INSET inside the field, so
  // it derives its height from `--control-h` rather than taking it: minus
  // 4px keeps the 2px-per-side inset it has always had. Without this it
  // would be exactly as tall as the input it sits in and its hover
  // background would paint over the field's borders and rounded end corner.
  ['h-[calc(var(--control-h,2rem)-0.25rem)]', 'height: calc(var(--control-h,2rem) - 0.25rem)'],
  [
    'after:-inset-x-[var(--target-inset,0.75rem)]',
    'inset-inline: calc(var(--target-inset,0.75rem) * -1)',
  ],
  [
    'after:-inset-y-[var(--target-inset,0.5rem)]',
    'inset-block: calc(var(--target-inset,0.5rem) * -1)',
  ],
];

/**
 * The global `prefers-reduced-motion: reduce` rule (design contract §7).
 *
 * Nothing else in the repo would notice if this block were deleted: no unit
 * test can assert a media query it never matches, and the e2e spec that does
 * assert it (`e2e/reduced-motion.spec.ts`) only runs where browsers do. A
 * deletion would be invisible until a user with the OS preference set met a
 * spinner. So the presence and contents of the rule are checked here, in the
 * gate that already blocks CI on every other token-drift failure.
 *
 * Contents, not just presence: a rule that survives with
 * `animation-iteration-count` dropped still passes a grep for `@media` while
 * having stopped doing the one thing that tames an infinite spinner.
 */
//
// Matched by its CONTENTS (the universal selector's `animation-duration`),
// not by being the first `prefers-reduced-motion` query in the file — same
// reasoning as the plain `:root` blocks above. A per-component
// `@media (prefers-reduced-motion: reduce)` added earlier in the file would
// otherwise capture this check, which would then report the global rule
// "missing" while pointing at the wrong block. `[^}]*` reaches only as far
// as the first `}`, which is the end of the universal-selector rule nested
// directly inside the query — exactly the block being described.
const reducedMotionBody = extractBlock(
  css,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?=[^}]*animation-duration)/,
);
if (reducedMotionBody === null) {
  errors.push(
    'globals.css: the global @media (prefers-reduced-motion: reduce) rule is missing — ' +
      'reduced motion is a global rule by design (contract §7), not a per-component variant.',
  );
} else {
  const ruleText = reducedMotionBody.replace(/\/\*[\s\S]*?\*\//g, '');
  const REQUIRED_REDUCED_MOTION = [
    ['universal selector', /\*\s*,[\s\S]*?\*::before[\s\S]*?\*::after/],
    ['animation-duration: 0.01ms !important', /animation-duration:\s*0\.01ms\s*!important\s*;/],
    ['animation-iteration-count: 1 !important', /animation-iteration-count:\s*1\s*!important\s*;/],
    ['transition-duration: 0.01ms !important', /transition-duration:\s*0\.01ms\s*!important\s*;/],
    ['scroll-behavior: auto !important', /scroll-behavior:\s*auto\s*!important\s*;/],
  ];
  for (const [description, re] of REQUIRED_REDUCED_MOTION) {
    if (!re.test(ruleText)) {
      errors.push(
        `globals.css: the reduced-motion rule no longer declares ${description}. ` +
          'See the contract §7 block it is copied from.',
      );
    }
  }
}

/**
 * End-to-end proof: the tokens above survive COMPILATION, not just review.
 *
 * Everything before this point reads `globals.css` as source text, which is
 * one step short of the truth. Tailwind v4 tree-shakes `@theme`: a custom
 * property declared there is emitted only if the class scanner sees a
 * utility that reads it. So a token family can be present, correct and
 * perfectly mirrored in source while shipping ZERO BYTES to the browser —
 * and the failure is silent, because `var(--missing)` in a hand-written rule
 * or an inline style resolves to an invalid value and computes to `0s`
 * rather than raising anything.
 *
 * That is not hypothetical: it is the exact shape of the shadow-inlining bug
 * #346 fixed, and the motion family shipped in this state on first pass. So
 * compile the real stylesheet with the pinned Tailwind and assert the values
 * are actually in the output.
 *
 * `build([])` — no scanned candidates — is the strictest case on purpose. It
 * models "no component uses these yet", which is precisely when the
 * tree-shaking trap bites, and it means the assertion does not quietly start
 * passing for the wrong reason once some unrelated utility happens to pull a
 * variable in.
 */
const { compile } = await import('tailwindcss');
const require = createRequire(import.meta.url);

/**
 * Resolve a bare `@import "pkg"` to a real stylesheet path.
 *
 * Order matters: `pkg/index.css` first (that is how `tailwindcss` itself is
 * laid out), then the package manifest's `exports["."].style` / `style` /
 * `main`, which is the `style` condition every CSS-only package publishes
 * under and Node's own resolver will not follow.
 */
function resolveBareStylesheet(id) {
  if (id.endsWith('.css')) return require.resolve(id);
  try {
    return require.resolve(`${id}/index.css`);
  } catch {
    // fall through to the manifest
  }
  // Not `require.resolve(`${id}/package.json`)`: a package whose `exports`
  // map does not list `./package.json` (tw-animate-css does not) makes that
  // throw. Walk the same node_modules chain Node would and read the manifest
  // off disk instead.
  const manifestPath = (require.resolve.paths(id) ?? [])
    .map((dir) => join(dir, id, 'package.json'))
    .find((candidate) => existsSync(candidate));
  if (manifestPath === undefined) {
    throw new Error(`cannot find the package "${id}" for a bare stylesheet import`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = manifest.exports?.['.']?.style ?? manifest.style ?? manifest.main;
  if (typeof entry !== 'string' || !entry.endsWith('.css')) {
    throw new Error(`cannot resolve a stylesheet entry for the bare import "${id}"`);
  }
  return resolve(dirname(manifestPath), entry);
}

let compiledCss = null;
let compiler = null;
// Reported in the summary line so the count cannot drift from the list below.
let ANIMATION_CANDIDATE_COUNT = 0;
try {
  compiler = await compile(css, {
    base: dirname(cssPath),
    // Tailwind hands back `@import` specifiers to be resolved by the host.
    // `globals.css` imports the bare package (`tailwindcss`), whose own
    // index.css then imports its siblings relatively.
    //
    // A bare CSS-only package (`tw-animate-css`) resolves neither way: its
    // entry is not `index.css`, and its `exports` map declares only a
    // `"style"` condition, which Node's resolver — which only knows
    // `import`/`require`/`node` — refuses outright. Bundlers ask for the
    // `style` condition; here we read the package manifest and honour it
    // ourselves, so the compiled output this script asserts on is the same
    // stylesheet the Vite build produces.
    loadStylesheet: async (id, base) => {
      const path = id.startsWith('.') ? resolve(base, id) : resolveBareStylesheet(id);
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
    },
  });
  compiledCss = compiler.build([]);
} catch (error) {
  errors.push(`globals.css could not be compiled with tailwindcss: ${error.message}`);
}

if (compiledCss !== null) {
  // Exact `--name: value` pairs, so a token that survives compilation with a
  // mangled value fails just as loudly as one that vanishes.
  const compiledExpectations = [
    ...Object.entries(motionVarNames).map(([key, cssVarName]) => [
      cssVarName,
      preset.motion[key],
      'motion token (contract §7)',
    ]),
    ...lightSteps.map((step) => [
      `--elevation-${step}`,
      preset.shadows.light[step],
      'light elevation step (contract §5)',
    ]),
    ...darkSteps.map((step) => [
      `--elevation-${step}`,
      preset.shadows.dark[step],
      'dark elevation step (contract §5)',
    ]),
  ];
  for (const [cssVarName, expectedValue, description] of compiledExpectations) {
    if (!compiledCss.includes(`${cssVarName}: ${expectedValue}`)) {
      errors.push(
        `compiled CSS: ${cssVarName}: ${expectedValue} is not in the build output — the ` +
          `${description} ships nothing, so every var() reading it computes to an invalid ` +
          'value. Declare it in a plain :root, not @theme (Tailwind drops unused @theme vars).',
      );
    }
  }

  /**
   * The `dark:` variant must compile to the `data-theme` attribute, not to
   * `prefers-color-scheme`. Grepping globals.css for `@custom-variant` would
   * not prove this: the at-rule can be present and still be shadowed,
   * mis-spelled as a no-op, or overridden by a later declaration, and the
   * failure is invisible — utilities keep compiling, just against the wrong
   * switch. So compile a real `dark:` candidate and read the emitted rule.
   *
   * `build([])` above cannot be reused here: with no candidates Tailwind
   * emits no variant rules at all, which is precisely the case that would
   * make a source-text check pass for the wrong reason.
   */
  const darkVariantCss = compiler.build(['dark:underline']);
  // Match the emitted *selector line* for the candidate, not the whole
  // sheet: globals.css already contains a `:root[data-theme="dark"]` token
  // block, so a whole-sheet `includes('[data-theme="dark"]')` passes even
  // when the variant is broken. Verified by deleting the @custom-variant
  // line and watching this fail.
  const darkRuleSelector = darkVariantCss
    .split('\n')
    .find((line) => line.includes('.dark\\:underline'));
  if (darkRuleSelector === undefined) {
    errors.push(
      'compiled CSS: the `dark:underline` candidate produced no rule at all, so this ' +
        'assertion cannot prove anything about the dark variant.',
    );
  } else if (!darkRuleSelector.includes('[data-theme="dark"]')) {
    errors.push(
      'compiled CSS: `dark:underline` compiles to `' +
        darkRuleSelector.trim() +
        '`, not a [data-theme="dark"] selector — ' +
        'the @custom-variant dark line in globals.css is missing or not taking effect, so ' +
        'every dark: utility keys off a different switch than the token overrides ' +
        '(contract §3.4.1).',
    );
  }
  if (/@media\s*\([^)]*prefers-color-scheme:\s*dark/.test(darkVariantCss)) {
    errors.push(
      'compiled CSS: `dark:underline` still compiles to @media (prefers-color-scheme: dark) — ' +
        'dark styling would activate from the OS setting alone, giving every dark-OS user a ' +
        'half-dark UI on light tokens (contract §3.4.1).',
    );
  }

  /**
   * Density, end to end (contract §6). Two separate things have to be true,
   * and checking either one alone lets the other fail silently.
   *
   * 1. The variable REACHES the bundle. `build([])` — no scanned candidates
   *    at all — is the strict case: a `[data-density='comfortable']` rule
   *    mistakenly written into `@theme` would be tree-shaken away here, and
   *    every portal control would quietly stay 32px.
   *
   * 2. The utilities that READ it compile to real rules. This is the half a
   *    source grep cannot do. `h-[var(--control-h,2rem)]` is an arbitrary
   *    value containing a comma and parentheses; if Tailwind's parser ever
   *    rejects that shape it emits NO rule, the class silently does nothing,
   *    and the button loses its height entirely rather than merely failing
   *    to grow. So compile the exact class strings the primitives ship and
   *    assert each produced the declaration it was supposed to.
   *
   * The candidate list itself is `densityCandidates` above.
   */
  for (const [cssVarName, expectedValue, description] of DENSITY_EXPECTATIONS) {
    if (!compiledCss.includes(`${cssVarName}: ${expectedValue}`)) {
      errors.push(
        `compiled CSS: ${cssVarName}: ${expectedValue} is not in the build output, so the ` +
          `${description} ships nothing and /portal renders at compact size while its e2e ` +
          "gate demands 44px. Declare it in a plain [data-density='comfortable'] block, not " +
          '@theme (Tailwind drops unused @theme vars).',
      );
    }
  }
  const densityUtilityCss = compiler.build(densityCandidates.map(([candidate]) => candidate));
  /**
   * Each candidate is checked against ITS OWN rule, not against the sheet as
   * a whole. Several of these compile to the same declaration on purpose —
   * `h-[var(--control-h,2rem)]`, `size-[var(--control-h,2rem)]` and
   * `data-[size=default]:h-[var(--control-h,2rem)]` all emit
   * `height: var(--control-h,2rem)` — so a sheet-wide `includes()` would be
   * satisfied by any one of the three and would report all twelve healthy
   * while eleven of them emitted nothing. That is not hypothetical: it is
   * how the first version of this check behaved when deliberately broken.
   *
   * Selectors arrive CSS-escaped (`.h-\[var\(--control-h\,2rem\)\]`), so
   * backslashes are stripped before comparing to the raw candidate. Every
   * density utility compiles to a flat `selector { declarations }` rule with
   * no nested braces, which is what makes this scan sufficient.
   */
  const compiledRules = [...densityUtilityCss.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => [selector.replaceAll('\\', '').trim(), body],
  );
  for (const [candidate, expectedDeclaration] of densityCandidates) {
    const rule = compiledRules.find(([selector]) => selector.includes(`.${candidate}`));
    if (rule === undefined) {
      errors.push(
        `compiled CSS: the density utility \`${candidate}\` produced no rule at all. The class ` +
          'is shipped by a primitive, so that control has no height at all — not merely the ' +
          'wrong one. Tailwind rejected the arbitrary value.',
      );
    } else if (!rule[1].includes(expectedDeclaration)) {
      errors.push(
        `compiled CSS: the density utility \`${candidate}\` compiled to ` +
          `\`${rule[1].trim()}\`, not \`${expectedDeclaration}\` — it no longer reads the ` +
          'density variable, so its control is frozen at one size in both modes.',
      );
    }
  }

  /**
   * Surface application, end to end (contract §3.3, §4, §5 — [8.13.9]).
   *
   * [8.13.9] moved every lifted surface onto `bg-card`, routed decorative
   * edges to `border-border-subtle`, and swapped the raw Tailwind shadow
   * scale for `shadow-e1/e2/e3`. A source grep proves none of that: the
   * utility name is the token name MINUS the `--color-` prefix, so the
   * plausible-looking `border-subtle` matches no colour utility at all,
   * compiles to no rule, and leaves the element on the `border: 0 solid`
   * preflight default with `currentColor` — a black hairline instead of a
   * subtle one, with nothing anywhere reporting an error. The only way to
   * know is to compile the exact class strings the components ship and read
   * the declarations back.
   *
   * `dark:ring-border-subtle` is in the list because §5's dark rule (edges
   * carry a border AND a shadow in dark mode) is satisfied on the five
   * ring-carrying overlays by recolouring their existing ring rather than
   * adding a second edge — which only works if the variant and the colour
   * utility compose.
   */
  const SURFACE_CANDIDATES = [
    ['bg-card', 'background-color: var(--color-card)'],
    ['border-border-subtle', 'border-color: var(--color-border-subtle)'],
    ['border-border-functional', 'border-color: var(--color-border-functional)'],
    ['shadow-e1', '--tw-shadow: var(--elevation-e1)'],
    ['shadow-e2', '--tw-shadow: var(--elevation-e2)'],
    ['shadow-e3', '--tw-shadow: var(--elevation-e3)'],
    ['dark:ring-border-subtle', '--tw-ring-color: var(--color-border-subtle)'],
  ];
  /**
   * The near-miss name is compiled alongside the real ones and asserted to
   * produce NOTHING. That inverted assertion is what keeps the check honest:
   * if a future Tailwind release started emitting a rule for `border-subtle`
   * this list would go stale silently, and the comment above would be wrong.
   */
  const SURFACE_TRAP = 'border-subtle';
  const surfaceCss = compiler.build([...SURFACE_CANDIDATES.map(([c]) => c), SURFACE_TRAP]);
  const surfaceRules = [...surfaceCss.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => [selector.replaceAll('\\', '').trim(), body],
  );
  for (const [candidate, expectedDeclaration] of SURFACE_CANDIDATES) {
    const rule = surfaceRules.find(([selector]) => selector.includes(`.${candidate}`));
    if (rule === undefined) {
      errors.push(
        `compiled CSS: the surface utility \`${candidate}\` produced no rule at all, so every ` +
          'component shipping that class renders with no fill, no edge or no elevation ' +
          '(contract §3.3/§4/§5).',
      );
    } else if (!rule[1].includes(expectedDeclaration)) {
      errors.push(
        `compiled CSS: the surface utility \`${candidate}\` compiled to ` +
          `\`${rule[1].trim()}\`, not \`${expectedDeclaration}\` — it no longer reads the ` +
          'token it is named after.',
      );
    }
  }
  if (surfaceRules.some(([selector]) => /\.border-subtle(?![a-z-])/.test(selector))) {
    errors.push(
      'compiled CSS: `border-subtle` now compiles to a real rule. The comment above and the ' +
        'warning in globals.css both say it cannot — update them, because the trap they ' +
        'describe no longer exists.',
    );
  }

  /**
   * Overlay animation vocabulary, end to end (contract §7 — [8.13.10]).
   *
   * The same trap as `border-subtle` above, one order of magnitude worse:
   * `animate-in`, `fade-in-0`, `zoom-in-95` and `slide-in-from-top-2` are
   * NOT Tailwind core utilities. They came from `tailwindcss-animate`, a v3
   * plugin this repo never depended on, so for five primitives and seven
   * class strings Tailwind emitted nothing and reported nothing — the source
   * read like canonical shadcn while every overlay snapped open. Only
   * compiling the exact strings the primitives ship and reading the
   * declarations back can tell the difference.
   *
   * `--tw-duration` is asserted on the `duration-(--motion-duration-*)`
   * candidate because that is the seam between the two halves: the
   * animations are live only if the package is imported, and they run at the
   * contract's durations only if Tailwind's duration variable is what
   * `tw-animate-css` reads.
   */
  const ANIMATION_CANDIDATES = [
    // The duration fallback literal is trimmed off each `animation:`
    // expectation on purpose — the point is that the utility resolves to the
    // `enter`/`exit` keyframes and reads `--tw-duration`, not that
    // tw-animate-css never changes its own default.
    ['animate-in', 'animation: enter var(--tw-animation-duration,var(--tw-duration,'],
    ['animate-out', 'animation: exit var(--tw-animation-duration,var(--tw-duration,'],
    ['fade-in-0', '--tw-enter-opacity: 0'],
    ['fade-out-0', '--tw-exit-opacity: 0'],
    ['zoom-in-95', '--tw-enter-scale: .95'],
    ['zoom-out-95', '--tw-exit-scale: .95'],
    ['slide-in-from-top-2', '--tw-enter-translate-y: calc(2*var(--spacing)*-1)'],
    ['duration-(--motion-duration-base)', '--tw-duration: var(--motion-duration-base)'],
  ];
  ANIMATION_CANDIDATE_COUNT = ANIMATION_CANDIDATES.length;
  const animationCss = compiler.build(ANIMATION_CANDIDATES.map(([c]) => c));
  const animationRules = [...animationCss.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => [selector.replaceAll('\\', '').trim(), body],
  );
  for (const [candidate, expectedDeclaration] of ANIMATION_CANDIDATES) {
    const rule = animationRules.find(([selector]) => selector.includes(`.${candidate}`));
    if (rule === undefined) {
      errors.push(
        `compiled CSS: the animation utility \`${candidate}\` produced no rule at all, so the ` +
          'overlay primitives that ship it open and close with no transition — check that ' +
          '`@import "tw-animate-css"` is still in globals.css (contract §7).',
      );
    } else if (!rule[1].includes(expectedDeclaration)) {
      errors.push(
        `compiled CSS: the animation utility \`${candidate}\` compiled to ` +
          `\`${rule[1].trim()}\`, not \`${expectedDeclaration}\`.`,
      );
    }
  }

  if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(compiledCss)) {
    errors.push(
      'compiled CSS: the global @media (prefers-reduced-motion: reduce) rule is not in the ' +
        'build output, so no user with the OS preference set is served it.',
    );
  }
}

/**
 * Token hexes also appear OUTSIDE `ui/`, in files this script previously
 * never opened: the PWA manifest constants, the `<meta name="theme-color">`
 * tag, and the favicon artwork. A `.webmanifest` is consumed by the OS and an
 * `index.html` meta tag is read before any CSS loads, so neither can resolve a
 * custom property — the hex has to be repeated as a literal in both.
 *
 * Repeated literals drift. During [8.13.3]'s re-grade the favicon and the
 * three PWA PNGs were missed on the first pass precisely because nothing
 * checked them, while a comment in manifest.ts claimed this script already
 * did. It didn't: everything above only ever reads globals.css and
 * tailwind.preset.ts. So check them here, where the token values are known.
 *
 * The manifest's splash `background_color` is on this list for the same
 * reason as the brand sites, one step removed: it is a copy of neutral-50,
 * the ground the app's first painted frame uses. If the ground token moves
 * and this literal does not, every install flashes the old colour before the
 * app boots — a mismatch nothing else in the repo would notice, because the
 * manifest test that pins it is itself a hand-written copy of the same
 * literal and would keep passing.
 *
 * The PNG icons are renders of favicon.svg and cannot be verified by reading
 * text; see #358.
 *
 * The favicon is no longer on this list: since the SchoolManagERP logo it is
 * the logo's own navy house tile (landing/src/assets/brand/monogram*.svg),
 * not the app's brand-600, so pinning it to brand-600 would be wrong.
 */
const repoRoot = resolve(pkgRoot, '..');
const outOfUiHexSites = [
  [
    'client-admin/src/pwa/manifest.ts',
    preset.brand[600],
    'brand-600',
    'PWA manifest theme_color constant',
  ],
  ['client-admin/index.html', preset.brand[600], 'brand-600', '<meta name="theme-color">'],
  [
    'client-admin/src/pwa/manifest.ts',
    preset.neutral[50],
    'neutral-50',
    'PWA manifest background_color (splash ground)',
  ],
];
for (const [relPath, rawHex, tokenName, description] of outOfUiHexSites) {
  const hex = rawHex.toLowerCase();
  let contents;
  try {
    contents = readFileSync(join(repoRoot, relPath), 'utf8');
  } catch {
    errors.push(`${relPath} could not be read — the ${description} is unguarded`);
    continue;
  }
  if (!contents.toLowerCase().includes(hex)) {
    errors.push(
      `${relPath} does not contain the ${tokenName} hex ${hex} — ` +
        `the ${description} has drifted from tailwind.preset.ts`,
    );
  }
}

if (errors.length > 0) {
  console.error('check-contrast: FAILED\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `check-contrast: OK — ${preset.CONTRAST_PAIRS.length} pairs meet WCAG 2.2, ` +
    `${Object.keys(preset.typography.ramp).length} type steps + ${Object.keys(preset.typography.printRamp).length} print steps mirrored, ` +
    `${lightSteps.length} elevation steps mirrored in light and dark, ` +
    `${Object.keys(motionVarNames).length} motion tokens mirrored under a live reduced-motion rule, ` +
    `${DENSITY_EXPECTATIONS.length} density variables scoped to [data-density='comfortable'] ` +
    `with ${densityCandidates.length} reading utilities proven to compile, ` +
    `all of them plus every elevation step verified present in the compiled CSS, ` +
    `the dark: variant proven attribute-scoped in the compiled CSS, ` +
    `7 surface utilities compiled and the border-subtle near-miss proven dead, ` +
    `${ANIMATION_CANDIDATE_COUNT} overlay animation utilities proven to compile, ` +
    `CSS mirror matches tailwind.preset.ts by name and scope, ` +
    `and ${outOfUiHexSites.length} out-of-ui hex sites match their tokens.`,
);

/**
 * Shared design tokens — the single source of truth every SPA extends.
 *
 * Colour values are plain hex here rather than references to Tailwind's own
 * default palette: Tailwind v4 tree-shakes `@theme` CSS variables down to
 * whatever utility classes are actually used in a build, so a variable that
 * is only ever reached through a dynamically-built class name (as semantic
 * status tokens are) can silently disappear. Literal values sidestep that.
 *
 * `ui/src/styles/globals.css` mirrors these into a Tailwind v4 `@theme`
 * block by hand. `scripts/check-contrast.mjs` parses both this file and that
 * one and fails if a value drifts between them, so the duplication cannot go
 * unnoticed.
 *
 * Every foreground/background pair actually used by a component is checked
 * against WCAG 2.2 by that same script — see CONTRAST_PAIRS at the bottom.
 * Values were not taken from memory; they were computed and iterated against
 * the real relative-luminance formula before being written here.
 */

export const neutral = {
  0: '#ffffff',
  50: '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0', // decorative dividers only — ~1.2:1 on white, below the 3:1 a
  // functional border needs. Use `neutral[500]` for anything conveying state.
  400: '#94a3b8',
  500: '#64748b', // functional border / focus-adjacent minimum — clears 3:1 on white
  600: '#475569', // secondary text — clears 4.5:1 on white
  700: '#334155',
  900: '#0f172a', // primary text and dark-mode page background
  950: '#020617',
} as const;

export const brand = {
  50: '#eef1fe',
  100: '#dfe3fd',
  400: '#8f96f4', // dark-mode link/text — 6.66:1 on dark bg #0f172a, 5.46:1 on dark surface #1e293b
  600: '#4a3fd4', // light-mode link/text and interactive component colour — 7.11:1 on white, 6.80:1 on the #f8fafc ground
  700: '#3d33b8', // light-mode link/text, higher-contrast variant — 8.88:1 on white, 7.89:1 on brand-50
} as const;

export const radius = {
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  full: '9999px',
} as const;

/**
 * Typography — the two-script type system decided in
 * `docs/architecture/09-design-direction.md` §2. Spacing is still deliberately
 * absent: Tailwind v4's own 4px scale is already coherent and nothing about a
 * fee-payment admin UI needs a different one. Typography is different — the
 * product renders Bengali and English on the same line, and Tailwind's stock
 * `text-lg`/`text-sm` carry no weight or tracking decision at all.
 *
 * `fontSans` is one CSS family, `Biddaloy Sans`, backed by two files (Anek
 * Latin + Anek Bangla) split by `unicode-range` in globals.css, so one string
 * serves both scripts at one apparent weight. `Biddaloy Sans Fallback` is the
 * metric-matched local stack that holds the layout still during the swap.
 *
 * `ramp` is the eight steps, each carrying all four decisions (size, leading,
 * weight, tracking) so a caller writing `text-h1` cannot forget one. Values
 * assume a 16px root. globals.css mirrors every one of these as a Tailwind v4
 * `--text-*` theme variable, and check-contrast.mjs fails on drift.
 */
export const typography = {
  fontSans: '"Biddaloy Sans", "Biddaloy Sans Fallback", system-ui, "Segoe UI", sans-serif',
  ramp: {
    hero: { size: '2rem', lineHeight: '2.5rem', weight: '650', tracking: '-0.015em' },
    display: { size: '1.75rem', lineHeight: '2.25rem', weight: '620', tracking: '-0.01em' },
    h1: { size: '1.375rem', lineHeight: '1.875rem', weight: '620', tracking: '-0.01em' },
    h2: { size: '1.125rem', lineHeight: '1.625rem', weight: '600', tracking: '0em' },
    h3: { size: '1rem', lineHeight: '1.5rem', weight: '600', tracking: '0em' },
    'body-lg': { size: '1rem', lineHeight: '1.625rem', weight: '400', tracking: '0em' },
    body: { size: '0.875rem', lineHeight: '1.375rem', weight: '400', tracking: '0em' },
    label: { size: '0.8125rem', lineHeight: '1.125rem', weight: '500', tracking: '0em' },
    caption: { size: '0.75rem', lineHeight: '1.0625rem', weight: '400', tracking: '0em' },
  },
  /** [48.1.04] D38 — print-only sizes. Never used on screen; points, because paper. */
  printRamp: {
    'print-title': { size: '28pt', lineHeight: '34pt', weight: '700', tracking: '0em' },
    'print-door': { size: '72pt', lineHeight: '80pt', weight: '700', tracking: '0em' },
  },
} as const;

export type TypeStep = keyof typeof typography.ramp;

/**
 * Fee/invoice/payment status. Each state pairs a colour with a distinct
 * icon so the meaning survives red/green colour-vision deficiency, the most
 * common form and exactly the distinction this product relies on most
 * (paid vs. overdue). The icon is not decoration — StatusBadge (epic 8.6)
 * depends on every status here carrying one.
 *
 * `fg` is verified at >=4.5:1 against both `#ffffff` and its own `bg`. `bg`
 * is a light tint meant only as a badge background, never as a text colour.
 *
 * `bgDark` is [8.13.12]'s dark-mode counterpart to `bg` — computed (not
 * eyeballed) so `fgDark` clears >=4.5:1 against it (verified below in
 * CONTRAST_PAIRS). Why a dark-mode `bg` override exists at all — `status-
 * badge.tsx` has no `dark:` variant of its own — is
 * docs/architecture/09-design-direction.md §3.5.1.
 */
export const status = {
  paid: {
    fg: '#15803d',
    bg: '#dcfce7',
    fgDark: '#4ade80',
    bgDark: '#052e16',
    icon: 'check-circle',
  },
  partial: {
    fg: '#0e7490',
    bg: '#cffafe',
    fgDark: '#22d3ee',
    bgDark: '#083344',
    icon: 'circle-half',
  },
  due: { fg: '#b45309', bg: '#fef3c7', fgDark: '#fbbf24', bgDark: '#451a03', icon: 'clock' },
  overdue: {
    fg: '#b91c1c',
    bg: '#fee2e2',
    fgDark: '#f87171',
    bgDark: '#450a0a',
    icon: 'alert-triangle',
  },
} as const;

/**
 * Dashboard signal scale (epic #3592, D3/D5-D8): 4 levels, OKLCH. Separate from `status`
 * (fee-only) and `chart`. Icon pairs colour so meaning is never colour alone (D8).
 */
export const signal = {
  critical: {
    fg: 'oklch(0.5 0.19 27)',
    bg: 'oklch(0.95 0.022 25)',
    fgDark: 'oklch(0.75 0.15 25)',
    bgDark: 'oklch(0.25 0.07 25)',
    icon: 'alert-triangle',
  },
  warn: {
    fg: 'oklch(0.48 0.1 65)',
    bg: 'oklch(0.96 0.04 85)',
    fgDark: 'oklch(0.82 0.15 80)',
    bgDark: 'oklch(0.28 0.06 70)',
    icon: 'clock',
  },
  ok: {
    fg: 'oklch(0.48 0.13 150)',
    bg: 'oklch(0.95 0.05 150)',
    fgDark: 'oklch(0.8 0.17 150)',
    bgDark: 'oklch(0.27 0.06 150)',
    icon: 'check-circle',
  },
  neutral: {
    fg: 'oklch(0.45 0.02 255)',
    bg: 'oklch(0.95 0.005 255)',
    fgDark: 'oklch(0.78 0.02 255)',
    bgDark: 'oklch(0.3 0.01 255)',
    icon: 'minus',
  },
} as const;

/**
 * Elevation — three steps, each with a job (design contract §5). Replaces the
 * ad-hoc `shadow-sm`/`shadow-md`/`shadow-lg` picks; #350 moves the call sites.
 *
 *  - `e1` — cards, resting panels, tabs
 *  - `e2` — dropdown, select, popover
 *  - `e3` — dialog, drawer, toast, skip-link
 *
 * Two things about the dark half that are not obvious:
 *
 *  1. It is not the light scale reused. A shadow is a darkening of what is
 *     behind it, and on `#0f172a` there is almost nothing left to darken, so
 *     the alphas roughly triple (0.05–0.18 → 0.40–0.65) and the tint drops to
 *     pure black.
 *  2. Even tripled, a shadow alone still barely reads on `#0f172a`. So the
 *     contract makes dark elevation a *pair*: every elevated surface in dark
 *     mode also carries a 1px `border-border-subtle`, never a shadow alone.
 *
 * These are mirrored into `globals.css` as `--elevation-*` custom properties
 * rather than straight into `--shadow-*`, and `check-contrast.mjs` compares
 * the strings character-for-character. See the long note in globals.css for
 * why the indirection is load-bearing rather than stylistic — briefly,
 * Tailwind v4 inlines a `--shadow-*` theme value into the `.shadow-*` utility
 * at build time, so overriding `--shadow-e1` in the dark block would be dead
 * CSS that silently does nothing.
 */
export const shadows = {
  light: {
    e1: '0 1px 2px 0 rgb(15 23 42 / 0.05), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
    e2: '0 4px 6px -1px rgb(15 23 42 / 0.07), 0 8px 24px -4px rgb(15 23 42 / 0.10)',
    e3: '0 12px 24px -6px rgb(15 23 42 / 0.14), 0 24px 48px -12px rgb(15 23 42 / 0.18)',
  },
  dark: {
    e1: '0 1px 2px 0 rgb(0 0 0 / 0.40), 0 1px 3px 0 rgb(0 0 0 / 0.45)',
    e2: '0 4px 6px -1px rgb(0 0 0 / 0.50), 0 8px 24px -4px rgb(0 0 0 / 0.55)',
    e3: '0 12px 24px -6px rgb(0 0 0 / 0.60), 0 24px 48px -12px rgb(0 0 0 / 0.65)',
  },
} as const;

/**
 * Motion — three durations and two easing curves (design contract §7).
 *
 * The vocabulary is deliberately tiny: every animated thing in the product
 * picks one of three speeds and one of two curves, so "how fast should this
 * be?" is a lookup rather than a judgement call.
 *
 *   durationFast (120ms) — hover, focus ring, active
 *   durationBase (180ms) — dropdown, popover, select, tooltip
 *   durationSlow (240ms) — dialog, drawer, toast
 *   easeStandard        — enter and move
 *   easeExit            — exit
 *
 * These are theme-invariant — a dialog does not open faster in dark mode —
 * so globals.css mirrors them once and `check-contrast.mjs` asserts the dark
 * block never redefines one.
 *
 * That mirror is a plain `:root`, NOT `@theme`. Tailwind v4 tree-shakes
 * `@theme`, emitting a variable only once a scanned utility reads it, and
 * nothing reads these (see the namespace note below) — so an `@theme`
 * declaration would ship zero bytes and every `var(--motion-*)` would
 * silently compute to `0s`. `check-contrast.mjs` compiles globals.css and
 * asserts these five values are in the build output.
 *
 * Note for consumers: `--motion-*` is NOT one of Tailwind v4's utility
 * namespaces (`--duration-*` / `--ease-*` are), so no `duration-fast`
 * utility is generated from these. Reach for them with v4's arbitrary
 * custom-property syntax instead:
 *
 *   duration-(--motion-duration-base) ease-(--motion-ease-standard)
 *
 * The names come from the approved contract, so this is accepted rather
 * than worked around.
 */
export const motion = {
  durationFast: '120ms',
  durationBase: '180ms',
  durationSlow: '240ms',
  easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
  easeExit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

/**
 * Semantic role tokens — what a component should actually reach for. `bg`,
 * `surface`, `textPrimary` etc. keep a fixed *meaning* across themes, unlike
 * `neutral`/`brand` above which keep a fixed *value*. A component built from
 * roles instead of raw scale entries switches themes for free; one built
 * from `neutral[900]` directly does not, and light/dark can end up
 * mismatched (e.g. light text rendered on a light background) if only one
 * side of a pair is swapped.
 */
export const light = {
  // Ground/surface inversion, design contract §3.3: the page is the tinted
  // ground and lifted things (cards, panels, fields) are white, so a card
  // reads as paper on a desk rather than a slightly grey hole in a white
  // page. Call sites move from `bg-background` to `bg-card` in [8.13.9].
  bg: neutral[50],
  surface: neutral[0],
  textPrimary: neutral[900],
  textSecondary: neutral[600],
  // Two border roles, design contract §4. `border` is the *functional* one —
  // it marks where a control begins and ends, so SC 1.4.11 holds it to 3:1.
  // `borderSubtle` is decoration (card outlines, dividers, table rules); it
  // conveys nothing, so it is exempt from 3:1 and deliberately has no
  // CONTRAST_PAIRS entry below.
  border: neutral[500],
  borderSubtle: neutral[200],
  brand: brand[600],
} as const;

/**
 * Dark-mode values, defined now per [8.1.2] so the tokens exist before any
 * SPA exposes a theme toggle. Deliberately reached only through
 * `:root[data-theme="dark"]` in globals.css, never `@media
 * (prefers-color-scheme: dark)` — the latter would activate for every user
 * with a dark OS preference today, which is exposure, not preparation.
 */
export const dark = {
  bg: neutral[900],
  surface: '#1e293b',
  textPrimary: neutral[50],
  textSecondary: '#cbd5e1',
  border: neutral[500], // same value as light mode; verified separately below
  borderSubtle: neutral[700], // decorative only — exempt from 3:1, see `light` above
  brand: brand[400],
} as const;

export type StatusKey = keyof typeof status;
export type SignalKey = keyof typeof signal;

/**
 * Every pair `check-contrast.mjs` verifies against WCAG 2.2: 4.5:1 for text,
 * 3:1 for UI components/meaningful graphics. Add a line here for every new
 * foreground/background combination a component actually renders — an
 * unlisted pair is an unverified one.
 */
/** [8.10.7.1.05] Chart palette: identity (cat) and magnitude (seq), never status. */
export const chart = {
  cat: { light: ['#2a78d6', '#eb6834', '#18a372'], dark: ['#3987e5', '#d95926', '#199e70'] },
  seq: { light: [brand[400], brand[600], '#2a2385'], dark: ['#6b63e6', '#8f96f4', '#c3c7fb'] },
} as const;

export const CONTRAST_PAIRS = [
  {
    name: 'critical signal fg on white',
    fg: signal.critical.fg,
    bg: neutral[0],
    min: 4.5,
  },
  {
    name: 'critical signal fg on critical bg',
    fg: signal.critical.fg,
    bg: signal.critical.bg,
    min: 4.5,
  },
  {
    name: 'critical signal fgDark on dark bg',
    fg: signal.critical.fgDark,
    bg: dark.bg,
    min: 4.5,
  },
  {
    name: 'critical signal fgDark on dark surface',
    fg: signal.critical.fgDark,
    bg: dark.surface,
    min: 4.5,
  },
  {
    name: 'critical signal fgDark on critical bgDark',
    fg: signal.critical.fgDark,
    bg: signal.critical.bgDark,
    min: 4.5,
  },
  {
    name: 'warn signal fg on white',
    fg: signal.warn.fg,
    bg: neutral[0],
    min: 4.5,
  },
  {
    name: 'warn signal fg on warn bg',
    fg: signal.warn.fg,
    bg: signal.warn.bg,
    min: 4.5,
  },
  {
    name: 'warn signal fgDark on dark bg',
    fg: signal.warn.fgDark,
    bg: dark.bg,
    min: 4.5,
  },
  {
    name: 'warn signal fgDark on dark surface',
    fg: signal.warn.fgDark,
    bg: dark.surface,
    min: 4.5,
  },
  {
    name: 'warn signal fgDark on warn bgDark',
    fg: signal.warn.fgDark,
    bg: signal.warn.bgDark,
    min: 4.5,
  },
  {
    name: 'ok signal fg on white',
    fg: signal.ok.fg,
    bg: neutral[0],
    min: 4.5,
  },
  {
    name: 'ok signal fg on ok bg',
    fg: signal.ok.fg,
    bg: signal.ok.bg,
    min: 4.5,
  },
  {
    name: 'ok signal fgDark on dark bg',
    fg: signal.ok.fgDark,
    bg: dark.bg,
    min: 4.5,
  },
  {
    name: 'ok signal fgDark on dark surface',
    fg: signal.ok.fgDark,
    bg: dark.surface,
    min: 4.5,
  },
  {
    name: 'ok signal fgDark on ok bgDark',
    fg: signal.ok.fgDark,
    bg: signal.ok.bgDark,
    min: 4.5,
  },
  {
    name: 'neutral signal fg on white',
    fg: signal.neutral.fg,
    bg: neutral[0],
    min: 4.5,
  },
  {
    name: 'neutral signal fg on neutral bg',
    fg: signal.neutral.fg,
    bg: signal.neutral.bg,
    min: 4.5,
  },
  {
    name: 'neutral signal fgDark on dark bg',
    fg: signal.neutral.fgDark,
    bg: dark.bg,
    min: 4.5,
  },
  {
    name: 'neutral signal fgDark on dark surface',
    fg: signal.neutral.fgDark,
    bg: dark.surface,
    min: 4.5,
  },
  {
    name: 'neutral signal fgDark on neutral bgDark',
    fg: signal.neutral.fgDark,
    bg: signal.neutral.bgDark,
    min: 4.5,
  },
  {
    name: 'light textPrimary on critical band',
    fg: light.textPrimary,
    bg: signal.critical.bg,
    min: 4.5,
  },
  {
    name: 'light textSecondary on critical band',
    fg: light.textSecondary,
    bg: signal.critical.bg,
    min: 4.5,
  },
  {
    name: 'dark textPrimary on critical band',
    fg: dark.textPrimary,
    bg: signal.critical.bgDark,
    min: 4.5,
  },
  {
    name: 'dark textSecondary on critical band',
    fg: dark.textSecondary,
    bg: signal.critical.bgDark,
    min: 4.5,
  },
  { name: 'neutral-900 text on white', fg: neutral[900], bg: neutral[0], min: 4.5 },
  { name: 'neutral-600 text on white', fg: neutral[600], bg: neutral[0], min: 4.5 },
  { name: 'brand-700 text on white', fg: brand[700], bg: neutral[0], min: 4.5 },
  { name: 'brand-600 text on white', fg: brand[600], bg: neutral[0], min: 4.5 },
  { name: 'light textPrimary on light bg', fg: light.textPrimary, bg: light.bg, min: 4.5 },
  { name: 'light textSecondary on light bg', fg: light.textSecondary, bg: light.bg, min: 4.5 },
  { name: 'light functional border on light bg', fg: light.border, bg: light.bg, min: 3 },
  { name: 'paid fg on white', fg: status.paid.fg, bg: neutral[0], min: 4.5 },
  { name: 'paid fg on paid bg', fg: status.paid.fg, bg: status.paid.bg, min: 4.5 },
  { name: 'partial fg on white', fg: status.partial.fg, bg: neutral[0], min: 4.5 },
  { name: 'partial fg on partial bg', fg: status.partial.fg, bg: status.partial.bg, min: 4.5 },
  { name: 'due fg on white', fg: status.due.fg, bg: neutral[0], min: 4.5 },
  { name: 'due fg on due bg', fg: status.due.fg, bg: status.due.bg, min: 4.5 },
  { name: 'overdue fg on white', fg: status.overdue.fg, bg: neutral[0], min: 4.5 },
  { name: 'overdue fg on overdue bg', fg: status.overdue.fg, bg: status.overdue.bg, min: 4.5 },
  { name: 'dark text-primary on dark bg', fg: dark.textPrimary, bg: dark.bg, min: 4.5 },
  { name: 'dark text-secondary on dark bg', fg: dark.textSecondary, bg: dark.bg, min: 4.5 },
  { name: 'dark brand text on dark bg', fg: dark.brand, bg: dark.bg, min: 4.5 },
  { name: 'dark functional border on dark bg', fg: dark.border, bg: dark.bg, min: 3 },
  { name: 'paid fgDark on dark bg', fg: status.paid.fgDark, bg: dark.bg, min: 4.5 },
  { name: 'partial fgDark on dark bg', fg: status.partial.fgDark, bg: dark.bg, min: 4.5 },
  { name: 'due fgDark on dark bg', fg: status.due.fgDark, bg: dark.bg, min: 4.5 },
  { name: 'overdue fgDark on dark bg', fg: status.overdue.fgDark, bg: dark.bg, min: 4.5 },
  // [8.13.12]: `status-badge.tsx` renders `fgDark` on `bgDark`, not on
  // `dark.bg` — the pairs above prove the text alone survives the page
  // ground, these prove the actual badge (text-on-tint) is legible now that
  // dark mode is reachable.
  { name: 'paid fgDark on paid bgDark', fg: status.paid.fgDark, bg: status.paid.bgDark, min: 4.5 },
  {
    name: 'partial fgDark on partial bgDark',
    fg: status.partial.fgDark,
    bg: status.partial.bgDark,
    min: 4.5,
  },
  { name: 'due fgDark on due bgDark', fg: status.due.fgDark, bg: status.due.bgDark, min: 4.5 },
  {
    name: 'overdue fgDark on overdue bgDark',
    fg: status.overdue.fgDark,
    bg: status.overdue.bgDark,
    min: 4.5,
  },
  // [8.1.3]'s shadcn vocabulary bridge (globals.css) reuses existing tokens
  // under new names — most pairs are mathematically identical to one already
  // above (e.g. --primary-foreground on --primary is the white-on-brand
  // inverse of 'brand-600 text on white'). Only the genuinely new numeric
  // pairs get their own entry: the shadcn `secondary`/`muted` backgrounds
  // resolve to neutrals that were never checked against text before.
  //
  // [8.13.3] re-pointed both. `muted` stopped following `--color-surface` and
  // landed on neutral-100, so its row moved with it and is still genuinely
  // new. `secondary` went the other way: it followed `--color-surface`,
  // which the ground/surface inversion moved to white, so its pair collapsed
  // into 'neutral-900 text on white' above and its row was removed rather
  // than duplicated — per the rule this comment states.
  //
  // [8.13.10] re-pointed `secondary` a second time, this time off
  // `--color-surface` entirely: white-on-white measured ~1.00:1 with a
  // `border-transparent` variant giving no boundary either (SC 1.4.11). It
  // now follows `--color-brand-50` / `--color-brand-700`, so its rest-state
  // pair is 'brand-700 on brand-50 (selected nav item)' below (reused, not
  // duplicated) and its hover state gets the new row just after it. Dark
  // mode lifts `secondary` to the elevated surface with `dark.brand` text —
  // that pair already exists as 'dark brand text on dark surface' below, so
  // it collapses the same way `secondary`'s old row once did.
  {
    name: 'muted-foreground on muted (neutral-600 on neutral-100)',
    fg: neutral[600],
    bg: neutral[100],
    min: 4.5,
  },
  // Brand pairs the ramp re-grade in [8.13.3] makes newly reachable (design
  // contract §3.6). The white-on-brand-600 primary button and the
  // neutral-900-on-brand-400 dark primary button are the symmetric twins of
  // rows already here — contrast is symmetric, so they get no duplicate row.
  { name: 'brand-700 on brand-50 (selected nav item)', fg: brand[700], bg: brand[50], min: 4.5 },
  { name: 'brand-600 on light ground', fg: brand[600], bg: light.bg, min: 4.5 },
  { name: 'dark brand text on dark surface', fg: dark.brand, bg: dark.surface, min: 4.5 },
  // [8.13.10]: secondary variant's hover state (`hover:bg-brand-100`) is a
  // genuinely new numeric pair — brand-100 is lighter than brand-50, so this
  // is not the rest-state row above recomputed.
  { name: 'brand-700 on brand-100 (secondary hover)', fg: brand[700], bg: brand[100], min: 4.5 },
  ...chart.cat.light.map((fg, i) => ({
    name: `chart cat-${i + 1} light on white`,
    fg,
    bg: neutral[0],
    min: 3,
  })),
  ...chart.cat.dark.map((fg, i) => ({
    name: `chart cat-${i + 1} dark on surface`,
    fg,
    bg: dark.surface,
    min: 3,
  })),
  { name: 'chart seq-2 light on white', fg: chart.seq.light[1], bg: neutral[0], min: 3 },
  { name: 'chart seq-3 light on white', fg: chart.seq.light[2], bg: neutral[0], min: 3 },
  // ordinal light-end floor (dataviz validator); always shown with a value label
  { name: 'chart seq-1 light on white', fg: chart.seq.light[0], bg: neutral[0], min: 2 },
  ...chart.seq.dark.map((fg, i) => ({
    name: `chart seq-${i + 1} dark on surface`,
    fg,
    bg: dark.surface,
    min: 3,
  })),
] as const;

export const biddaloyPreset = {
  neutral,
  brand,
  radius,
  status,
  light,
  dark,
  typography,
  shadows,
  motion,
} as const;

export default biddaloyPreset;

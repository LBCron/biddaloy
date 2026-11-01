import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

/**
 * E2E harness — `e2e/` isn't a yarn workspace (it drives the API and the
 * client together, not one package from inside it), same reasoning as the
 * root `vitest.config.ts` covering multiple frontend packages from a single
 * top-level config.
 *
 * `webServer` boots the real API (`dev:server`) plus the client dev server,
 * the same processes `yarn dev:*` start for a human — not a separate
 * CI-only build path. Locally that means: bring up Postgres/Redis with
 * `docker compose up -d db redis` (see README's Development section),
 * migrate + seed once, then `yarn e2e` reuses that stack via
 * `reuseExistingServer`. CI has no persistent stack, so it migrates, seeds,
 * and lets Playwright start and tear down both servers itself.
 */
const CI = !!process.env.CI;

// [58.4.02] The nightly demo sweep. With DEMO_SWEEP_URL it drives an already-running demo site
// (no local servers are started); the whole run must finish inside 8 minutes (globalTimeout) so
// the 02:00 reset never overruns by much.
// DEMO_SWEEP_URL adds the project (the reset container sets only it) but does not limit the run to
// it: the command must still pass `--project=demo-nightly`, or every other suite runs against nothing.
const DEMO_SWEEP_URL = process.env.DEMO_SWEEP_URL || undefined;
const DEMO_NIGHTLY = process.env.E2E_DEMO_NIGHTLY === '1' || !!DEMO_SWEEP_URL;
// The refresh cookie is `__Host-` and so always `Secure`. Over plain HTTP Chromium keeps it only on
// localhost / 127.0.0.1 (measured: `--unsafely-treat-insecure-origin-as-secure` makes the page a
// secure context but Chromium still drops the cookie). So a plain-HTTP sweep URL must be loopback:
// the runner shares demo-reset's network namespace. Anything else would reload every page signed
// out, so it stops here instead of failing route by route.
// `new URL` lower-cases the scheme, so `HTTP://...` is caught too.
const sweepUrl = DEMO_SWEEP_URL ? new URL(DEMO_SWEEP_URL) : null;
if (sweepUrl?.protocol === 'http:') {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(sweepUrl.hostname)) {
    throw new Error(
      `DEMO_SWEEP_URL ${DEMO_SWEEP_URL}: plain HTTP keeps the session only on localhost/127.0.0.1. ` +
        'Run the sweep runner in the demo-reset network namespace and use http://127.0.0.1:3999 ' +
        '(docs/architecture/22-demo-seed.md, "The nightly sweep").',
    );
  }
}

// [15.1] Set only by ci.yml's per-job collect step. Unset (every local run)
// means zero behaviour change — the array below is unchanged.
const timingsOut = process.env.CI_TIMINGS_OUT;
const timingsReporter: ReporterDescription[] = timingsOut
  ? [['json', { outputFile: timingsOut }]]
  : [];

// Annotated as ReporterDescription[] rather than spread inline: Playwright
// types `reporter` as a union of literal tuples, and spreading a ternary
// into a fresh array literal widens `['list']` to `(string | {...})[]`,
// which no longer satisfies the required 1-or-2-element tuple shape.
const baseReporter: ReporterDescription[] = CI
  ? [['html', { open: 'never' }], ['list']]
  : [['html', { open: 'on-failure' }]];

// Browsers come from E2E_BROWSERS (comma-separated: "chromium,firefox,webkit").
// Default is chromium only — a deliberate product decision (#148): widening
// the list is an env-variable change (repo CI variable E2E_BROWSERS_JSON in
// the workflow, E2E_BROWSERS locally), never a code edit. Device presets for
// non-default browsers stay mapped so enabling one later needs no config work.
const BROWSER_DEVICES = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

const browsers = (process.env.E2E_BROWSERS ?? 'chromium')
  .split(',')
  .map((b) => b.trim())
  .filter((b): b is keyof typeof BROWSER_DEVICES => Object.hasOwn(BROWSER_DEVICES, b));

export default defineConfig({
  testDir: './e2e',
  // [8.12.6]'s PWA suite is excluded here and run by
  // `playwright.pwa.config.ts` (`yarn e2e:pwa`) instead. It needs a
  // *production* build served by `vite preview`, because the dev server
  // this config points at has no service worker at all
  // (`devOptions.enabled: false` in `client-admin/vite.config.ts`).
  // Without this ignore, `testDir: './e2e'` globs those specs too and
  // runs every one of them against a stack that cannot satisfy them.
  // [58.2.08] `e2e/demo/` needs a DEMO_MODE server on a seed:demo database; it has its own
  // opt-in project below and never runs in the default or sweeps projects.
  // [50.13] `e2e/landing/` is static-site smoke, run by `playwright.landing.config.ts`.
  testIgnore: ['**/pwa/**', '**/demo/**', '**/landing/**'],
  fullyParallel: true,
  forbidOnly: CI,
  // A suite needing more than one CI retry is hiding flake — see
  // [8.5.1]'s acceptance criteria.
  retries: CI ? 1 : 0,
  // The sweep runs unattended (no CI var in the reset container): never serve an html report.
  reporter: DEMO_SWEEP_URL
    ? [['list'], ['html', { open: 'never' }]]
    : [...baseReporter, ...timingsReporter],
  use: {
    // Relative page.goto()/request URLs resolve against the client shell —
    // matches e2e/config.ts's single-shell entry ([8.5.2]).
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Deliberately NOT 'on-first-retry' to match `trace` above (#440
    // considered it and rejected it). Two reasons, neither about speed:
    // locally `retries` is 0, so 'on-first-retry' would record nothing at
    // all for a developer debugging a failure; and in CI it keeps the
    // video of the *retry*, so a test that fails then passes leaves you a
    // recording of the passing run — useless for the flake hunting this
    // repo runs a nightly workflow for. 'retain-on-failure' records every
    // attempt and keeps the ones that failed, which is the artifact you
    // actually want. Measured at no wall-time cost either way (4 passing
    // tests x 2 runs: 4.0-4.4s for both settings), so there is no speed
    // argument on the other side.
    video: 'retain-on-failure',
  },
  // iOS Safari (WebKit) is a real share of Bangladeshi device traffic and
  // where CSS/date-input differences tend to surface first, so it's the one
  // to bring back first when cross-browser coverage is worth the CI time.
  // `setup` logs in every seed role once per shard and writes storageState
  // files ([8.5.2], e2e/fixtures/auth.setup.ts); every browser project
  // depends on it so specs can `test.use(loggedIn(role))`.
  // [18.1.2] Each browser now emits two projects instead of one: the
  // route-sweep specs (a11y, reflow, target-size — 79% of E2E runtime) are
  // tagged ` @sweep` on their top-level `test.describe` titles, so
  // `grepInvert`/`grep` splits a browser's full suite into a small
  // PR-facing project and a sweep-only project nightly-e2e.yml runs across
  // every browser (`--project=${browser}-sweeps`). PRs/ci.yml keep passing
  // `--project=${browser}`, which now resolves to the non-sweep project —
  // smoke coverage (`e2e/smoke/`) plus everything else untagged.
  projects: [
    { name: 'setup', testMatch: /fixtures\/auth\.setup\.ts/ },
    // [58.2.08] Opt-in: `E2E_DEMO=1 npx playwright test --project demo` against a DEMO_MODE
    // server (docs/architecture/22-demo-seed.md). Absent unless E2E_DEMO=1, so a bare
    // `playwright test` never picks it up. 58.4.02 wires it into the nightly pipeline.
    ...(process.env.E2E_DEMO === '1'
      ? [
          {
            name: 'demo',
            testDir: './e2e/demo',
            testIgnore: ['**/demo-nightly-sweep.spec.ts', '**/sweep-session.spec.ts'],
            use: { ...BROWSER_DEVICES.chromium },
          },
        ]
      : []),
    // [58.4.02] Opt-in: `E2E_DEMO_NIGHTLY=1 DEMO_SWEEP_URL=https://... yarn e2e --project=demo-nightly
    // --workers=3`. Run by the nightly reset (58.4.01) before the swap; see DEMO_NIGHTLY below.
    ...(DEMO_NIGHTLY
      ? [
          {
            name: 'demo-nightly',
            testDir: './e2e/demo',
            // sweep-session.spec.ts proves that a bounce to /login fails the sweep (no server needed).
            testMatch: /(demo-nightly-sweep|sweep-session)\.spec\.ts/,
            testIgnore: [], // overrides the top-level '**/demo/**' ignore
            retries: 0, // a retry would double a role's visit time against the 8-minute budget
            use: {
              ...BROWSER_DEVICES.chromium,
              baseURL: DEMO_SWEEP_URL ?? 'http://localhost:5174',
            },
          },
        ]
      : []),
    ...browsers.flatMap((name) => [
      {
        name,
        use: { ...BROWSER_DEVICES[name] },
        dependencies: ['setup'],
        grepInvert: /@sweep/,
      },
      {
        name: `${name}-sweeps`,
        use: { ...BROWSER_DEVICES[name] },
        dependencies: ['setup'],
        grep: /@sweep/,
      },
    ]),
  ],
  workers: CI ? 4 : undefined,
  // Only against a running site: with local servers the build time would eat the budget.
  ...(DEMO_SWEEP_URL ? { globalTimeout: 8 * 60_000 } : {}),
  webServer: DEMO_SWEEP_URL
    ? []
    : [
        {
          command: CI ? 'yarn e2e:serve:server' : 'yarn dev:server',
          url: 'http://localhost:3000/api/health',
          reuseExistingServer: !CI,
          timeout: 300_000,
          // Test-only seam (08-security Rule 7): lets the guard reach the 127.0.0.1 vendor stub.
          env: { NODE_ENV: 'test', OUTBOUND_TEST_ALLOW_LOOPBACK: 'true' },
        },
        {
          command: CI ? 'yarn e2e:serve:client' : 'yarn dev:client-admin',
          url: 'http://localhost:5174/',
          reuseExistingServer: !CI,
          timeout: 300_000,
        },
      ],
});

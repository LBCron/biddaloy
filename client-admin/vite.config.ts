import { resolve } from 'path';

import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { pwaManifest } from './src/pwa/manifest';

export default defineConfig({
  plugins: [
    // A mock-API bundle (MSW) must never ship as a production build.
    {
      name: 'refuse-mock-production-build',
      config(c, { command, mode }) {
        const env = loadEnv(mode, c.envDir || c.root || process.cwd(), 'VITE_');
        if (command === 'build' && mode === 'production' && env.VITE_USE_MOCKS === 'true') {
          throw new Error('VITE_USE_MOCKS=true cannot be used in a production build');
        }
      },
    },
    // Link-preview crawlers need an absolute og:image. VITE_APP_URL overrides the default (e.g. the demo host).
    {
      name: 'og-image-base',
      // loadEnv also reads .env files (and the process env), which plain process.env does not.
      transformIndexHtml(html, ctx) {
        const env = loadEnv(
          ctx.server?.config.mode ?? process.env.NODE_ENV ?? 'production',
          process.cwd(),
          'VITE_',
        );
        const base = env.VITE_APP_URL ?? 'https://app.schoolmanagerp.com';
        return html.replace('%OG_BASE%', base.replace(/\/$/, ''));
      },
    },
    // Must come before react() — the plugin transforms route files (and
    // generates routeTree.gen.ts) before the React plugin ever sees them.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      // Colocated `*.test.tsx` files (this repo's convention — see
      // ui/CONTRIBUTING.md's three-file requirement) live right next to
      // their route file. Without this, the plugin treats each one as its
      // own route and fails the build.
      routeFileIgnorePattern: '\\.(test|spec)\\.[jt]sx?$',
    }),
    react(),
    // [#3214] The live CSP is `style-src 'self'`: a `<style>` tag made at
    // runtime is blocked. Two libraries make one, so the build strips it:
    // - sonner injects its whole stylesheet on import. Its CSS comes from
    //   `sonner/dist/styles.css`, imported in `ui/src/styles/globals.css`.
    // - react-style-singleton (Radix's scroll lock) injects the scroll-lock
    //   rules on dialog open. `makeStyleTag()` returning null is its own
    //   "no document" path; the static lock rule is in globals.css.
    // Build only: `vite dev` pre-bundles deps and sends no CSP, so it keeps both.
    // `e2e/pwa/csp-inline-style.spec.ts` fails if a new injector shows up.
    {
      name: 'csp-no-runtime-style',
      apply: 'build',
      transform(code, id) {
        const patch = [
          {
            file: /\/node_modules\/sonner\/dist\/index\.m?js$/,
            find: /^__insertCSS\(".*"\);$/m,
            replace: '',
          },
          {
            file: /\/node_modules\/react-style-singleton\/dist\/[^/]+\/singleton\.js$/,
            find: 'function makeStyleTag() {',
            replace: 'function makeStyleTag() { return null;',
          },
        ].find((p) => p.file.test(id));
        if (!patch) return null;
        const patched = code.replace(patch.find, patch.replace);
        // A library upgrade that changes this shape must fail the build, not ship the violation.
        if (patched === code) throw new Error(`csp-no-runtime-style: pattern not found in ${id}`);
        return { code: patched, map: null };
      },
    },
    tailwindcss(),
    // [8.12.1]: installability + offline app shell.
    //
    // `injectManifest`, not `generateSW` — the service worker is
    // hand-written (`src/sw.ts`) because tenant-safe API caching needs a
    // custom `cacheKeyWillBeUsed`, which `generateSW`'s declarative config
    // cannot express. See `src/pwa/cache-policy.ts` for why.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // `prompt`, not `autoUpdate`: an activated update must not reload
      // the page out from under someone mid-form. [8.12.2] owns the
      // prompt UI; `src/pwa/register.ts` holds the (currently no-op) hook.
      registerType: 'prompt',
      // The manifest object is imported rather than inlined so
      // `src/pwa/manifest.test.ts` asserts against exactly what ships.
      manifest: pwaManifest,
      // The registration call is ours (`src/main.tsx` -> `src/pwa/register.ts`),
      // so the plugin must not inject a second one. Note this flag governs
      // the *register script only*: the `<link rel="manifest">` is still
      // injected unconditionally, which is why `index.html` no longer
      // writes one by hand.
      injectRegister: null,
      includeAssets: [],
      injectManifest: {
        // The *shell* only — `index.html`, the entry JS/CSS, the manifest
        // and icons. The [8.13.2] font subsets are deliberately absent too:
        // 170 KB of woff2 on first visit is what `font-display: swap` plus
        // the metric-matched fallbacks exist to avoid. They are runtime
        // cache-first instead (`isHashedAssetRequest`).
        // Deliberately not `**/*.js`: [8.9.1] split every route
        // into its own lazily-fetched chunk, and precaching all of them
        // would eagerly pull ~1.4 MB on first visit and re-pull it on
        // every deploy. That is the exact cost this epic exists to avoid
        // on a mid-range Android on 3G. Route chunks are instead cached
        // as they are actually visited, by the `CacheFirst` runtime route
        // in `src/sw.ts` — which is safe because their filenames are
        // content-hashed.
        globPatterns: [
          'index.html',
          'manifest.webmanifest',
          'favicon.svg',
          'icons/*.png',
          // The entry chunk only. `app-` is why `entryFileNames` is
          // overridden in `build.rollupOptions` below: Rollup's default
          // names the entry `index-<hash>.js`, and so are the dozen route
          // chunks that come from a route's `index.tsx`, which makes the
          // shell impossible to glob apart from the routes.
          'assets/app-*.js',
          'assets/*.css',
        ],
        // `mockServiceWorker.js` is MSW's worker script, only ever used
        // when `VITE_USE_MOCKS=true` (and `src/pwa/register.ts` skips PWA
        // registration entirely in that mode) — precaching it would ship
        // a mocking harness to production users. `stats.html` is the
        // `ANALYZE=true` bundle report above, not app output.
        // `runtime-config.js` is server-rendered per deploy; `sw.ts` serves it NetworkOnly.
        globIgnores: ['**/mockServiceWorker.js', '**/stats.html', '**/runtime-config.js'],
      },
      // No service worker in `vite dev`: it would cache the dev server's
      // unhashed module URLs and make every subsequent edit look like it
      // did not apply. The SW exists in `vite build`/`vite preview` only —
      // which is what CI's Lighthouse run and [8.12.5]'s Playwright suite
      // exercise.
      devOptions: { enabled: false },
    }),
    // `yarn build:analyze` (ANALYZE=true) opens a chunk-size treemap after
    // build — [8.9.1]'s "route-level code splitting verified in a bundle
    // report" AC. Off by default: it writes stats.html into dist/, which a
    // normal `yarn build:client-admin` shouldn't produce.
    ...(process.env.ANALYZE === 'true'
      ? [visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true, open: true })]
      : []),
    // [8.12.7]: uploads source maps and stamps the release, so a Sentry
    // stack trace points at `students/index.tsx:42` instead of
    // `app-a1b2c3.js:1:98421`, and every issue says which deploy it came
    // from. There is no separate deploy pipeline to host this step (the
    // Docker image is built from `scripts/build-all.sh` — see
    // `docs/architecture/07-deployment.md`), so it lives in the build
    // itself, gated on the token being present: without
    // `SENTRY_AUTH_TOKEN` a normal `yarn build:client-admin` (dev, CI,
    // anyone's laptop) produces byte-identical output to before, same
    // "missing config degrades gracefully" shape as `VITE_SENTRY_DSN`.
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            // Equals the runtime `release` (the commit SHA) so events match their maps.
            release: { name: process.env.SENTRY_RELEASE },
            // Deleted after upload: the maps exist for Sentry, not for
            // the public — shipping them would hand anyone the app's
            // unminified source.
            sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] },
          }),
        ]
      : []),
  ],
  // No `base`: [8.9.10] serves this single SPA from `/`, so asset URLs are
  // root-relative. It used to be `/admin/`, back when a second package was
  // expected to own `/student/`.
  build: {
    // `'hidden'` = maps are generated (for the upload above) but no
    // `//# sourceMappingURL` comment is emitted, so a browser never
    // fetches them. Only when uploading: an ordinary build must not pay
    // the extra build time or write `.map` files it will never delete.
    ...(process.env.SENTRY_AUTH_TOKEN ? { sourcemap: 'hidden' as const } : {}),
    rollupOptions: {
      output: {
        // [8.12.1]: distinguishes the entry from route chunks by name, so
        // the service worker can precache the shell without also
        // precaching every lazily-split route. See `globPatterns` above.
        entryFileNames: 'assets/app-[hash].js',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@biddaloy/shared': resolve(__dirname, '../shared/src'),
      '@biddaloy/ui/components': resolve(__dirname, '../ui/src/components/index.ts'),
      '@biddaloy/ui/shells': resolve(__dirname, '../ui/src/shells/index.ts'),
      '@biddaloy/ui/rich-text-editor': resolve(
        __dirname,
        '../ui/src/components/rich-text-editor/index.ts',
      ),
      '@biddaloy/ui/hooks': resolve(__dirname, '../ui/src/hooks/index.ts'),
      '@biddaloy/ui/routes': resolve(__dirname, '../ui/src/routes/index.ts'),
      '@biddaloy/ui/utils': resolve(__dirname, '../ui/src/utils/index.ts'),
      '@biddaloy/ui/i18n': resolve(__dirname, '../ui/src/i18n/index.ts'),
      '@biddaloy/ui/api': resolve(__dirname, '../ui/src/api/index.ts'),
      '@biddaloy/ui/test': resolve(__dirname, '../ui/src/test/index.ts'),
      '@biddaloy/ui/mocks': resolve(__dirname, '../ui/src/test/msw/enable-mocking.ts'),
      '@biddaloy/ui/styles': resolve(__dirname, '../ui/src/styles/globals.css'),
      '@biddaloy/ui/tailwind': resolve(__dirname, '../ui/tailwind.preset.ts'),
      '@biddaloy/ui': resolve(__dirname, '../ui/src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // No changeOrigin: the API's SameOriginGuard compares the Origin
        // header (always :5174 from the browser) against the Host header —
        // rewriting Host to :3000 makes every /auth/refresh a 403 ([8.5.2]).
        // The target is a plain local port, not a vhost, so Host rewriting
        // buys nothing.
      },
    },
  },
});

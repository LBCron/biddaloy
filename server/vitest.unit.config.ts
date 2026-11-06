import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import swc from 'unplugin-swc';

// [15.1] Set only by ci.yml's per-job collect step. Unset (every local run)
// means zero behaviour change. `test:unit` (package.json) has no CLI
// `--reporter` flag of its own, so unlike vitest.config.ts this one applies
// cleanly with no CLI-override caveat.
const timingsOut = process.env.CI_TIMINGS_OUT;

/**
 * Vitest configuration for unit tests.
 * No database setup — these tests use mocked repositories.
 */
export default defineConfig({
  // See vitest.config.ts — SWC is needed so NestJS decorator metadata
  // (emitDecoratorMetadata) is actually emitted under Vitest.
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.integration.spec.ts', 'src/**/*.e2e-spec.ts'],
    environment: 'node',
    globals: true,
    ...(timingsOut ? { reporters: ['default', ['json', { outputFile: timingsOut }]] } : {}),

    // class-transformer's `@Type()` calls `Reflect.getMetadata` at module
    // evaluation time, so any spec importing a DTO crashes on collection
    // unless the shim is loaded first. `vitest.config.ts` gets this via
    // `test/setup.ts`.
    //
    // [18.2.1] `./test/unit-setup.ts` resets mocks/timers/globals/env/module
    // registry after every test — required now that `isolate: false` below
    // shares that registry across files. See that file's header comment.
    setupFiles: ['reflect-metadata', './test/unit-setup.ts'],

    // [18.2.1] No database/Redis dependency to isolate unit tests against,
    // so share one worker-thread module registry across files instead of
    // spinning up a fresh one per file — `./test/unit-setup.ts` resets the
    // leakable state that sharing exposes. `poolOptions.threads.isolate` was
    // removed in Vitest 4 — `isolate` is now top-level (same as `pool`).
    pool: 'threads',
    isolate: false,

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/**/*.module.ts',
        'src/**/*.dto.ts',
        'src/**/*.entity.ts',
        'src/migrations/**',
        'src/scripts/**',
        'src/config/**',
        'src/**/*.e2e-spec.ts',
      ],
      thresholds: {
        perFile: false,
        branches: 50,
        functions: 50,
        lines: 50,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: {
      '@biddaloy/shared': resolve(__dirname, '../shared/src'),
      '@biddaloy/site-themes': resolve(__dirname, '../site-themes/src'),
      '@test': resolve(__dirname, 'test'),
    },
  },
});

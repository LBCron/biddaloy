import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'path';
import swc from 'unplugin-swc';
import { WORKERS } from './test/global-setup';

// [15.1] Set only by ci.yml's per-job collect step. Unset (every local run)
// means zero behaviour change. NOTE: `test:integration` and `test:e2e` in
// `package.json` pass their own `--reporter=verbose` on the CLI, and a CLI
// `--reporter` flag replaces this config's `reporters` array entirely — so
// this alone does not cover those two commands. See the conditional
// `--reporter=json` appended to those two scripts.
const timingsOut = process.env.CI_TIMINGS_OUT;

export default defineConfig({
  // esbuild (Vite/Vitest's default TS transform) does not emit
  // `emitDecoratorMetadata` output, so NestJS can't reflect `@Body()`
  // parameter types — ValidationPipe silently skips validation on every
  // DTO. SWC does emit it; this is the standard NestJS+Vitest fix.
  plugins: [swc.vite()],
  test: {
    // Test file patterns. `test/*.integration.spec.ts` (not `src/`) covers
    // this suite's own guard specs — e.g. reset-order.integration.spec.ts —
    // which validate test infrastructure itself, not application code.
    include: [
      'src/**/*.spec.ts',
      'src/**/*.integration.spec.ts',
      'src/**/*.e2e-spec.ts',
      'test/*.integration.spec.ts',
    ],
    // unit-setup-env.spec.ts tests test/unit-setup.ts, so it runs under vitest.unit.config.ts only.
    exclude: [...configDefaults.exclude, 'src/unit-setup-env.spec.ts'],

    // Environment
    environment: 'node',
    globals: true,
    ...(timingsOut ? { reporters: ['default', ['json', { outputFile: timingsOut }]] } : {}),

    // Runs once per `vitest run` invocation, before any spec file's worker
    // starts: migrates the schema and seeds baseline data exactly once
    // instead of once per spec file. See test/global-setup.ts.
    globalSetup: ['./test/global-setup.ts'],

    // Setup runs before all tests
    setupFiles: ['./test/setup.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
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
        'src/**/*.spec.ts',
        'src/**/*.integration.spec.ts',
      ],
      thresholds: {
        perFile: false,
        branches: 75,
        functions: 75,
        lines: 75,
        statements: 75,
        'src/modules/auth/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
        'src/**/*.guard.ts': { statements: 90, branches: 90, functions: 90, lines: 90 },
        'src/**/*.repository.ts': { statements: 85, branches: 85, functions: 85, lines: 85 },
        'src/**/*.service.ts': { statements: 85, branches: 85, functions: 85, lines: 85 },
        'src/**/*.controller.ts': { statements: 60, branches: 60, functions: 60, lines: 60 },
      },
    },

    // [18.2.1] Integration and e2e specs used to run sequentially — one file
    // at a time (`fileParallelism: false`) — so `clearTransactionalTables`'s
    // DELETEs never raced each other on the one shared Postgres test
    // database. Each vitest pool worker now gets its own database (cloned
    // from a migrated template in test/global-setup.ts) and its own Redis
    // db index (test/setup.ts), so up to WORKERS files can run at once with
    // nothing left to race. maxWorkers is imported from test/global-setup.ts's
    // WORKERS constant so the two can never drift out of sync.
    pool: 'threads',
    maxWorkers: WORKERS,
    minWorkers: 1,
  },
  resolve: {
    alias: {
      '@biddaloy/shared': resolve(__dirname, '../shared/src'),
      '@biddaloy/site-themes': resolve(__dirname, '../site-themes/src'),
      '@test': resolve(__dirname, 'test'),
    },
  },
});

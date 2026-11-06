import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Site-local runner: the root vitest config is a shared file, so it is not touched here.
export default defineConfig({
  resolve: {
    alias: {
      '@biddaloy/shared': resolve(import.meta.dirname, '../shared/src'),
      '@biddaloy/site-themes': resolve(import.meta.dirname, '../site-themes/src'),
    },
  },
  test: { environment: 'node', include: ['src/**/*.spec.ts'] },
});

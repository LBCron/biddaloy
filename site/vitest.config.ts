import { resolve } from 'node:path';
import { getViteConfig } from 'astro/config';

// Site-local runner: the root vitest config is a shared file, so it is not touched here.
// getViteConfig loads Astro's own Vite plugin so a spec can render a `.astro` file with the Astro container.
export default getViteConfig({
  resolve: {
    alias: {
      '@biddaloy/shared': resolve(import.meta.dirname, '../shared/src'),
      '@biddaloy/site-themes': resolve(import.meta.dirname, '../site-themes/src'),
    },
  },
  test: { environment: 'node', include: ['src/**/*.spec.ts'] },
} as never);

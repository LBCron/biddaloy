import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

// SSR: one container serves every school host (Host header). Zero framework JS (D38).
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321, host: true },
  trailingSlash: 'always',
  build: { inlineStylesheets: 'always' },
  // Keep the notices island a real file in dist/client instead of an inline script (D38).
  vite: { build: { assetsInlineLimit: 0 } },
});

import { defineConfig, devices } from '@playwright/test';

/**
 * [40.1.05] Site e2e: the built SSR server against a stub by-host API. No database, no login.
 * Run: `yarn workspace @biddaloy/site build && yarn workspace @biddaloy/site e2e`
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://ok.localhost:4321' },
  webServer: [
    { command: 'node e2e/stub-api.mjs', port: 4399, reuseExistingServer: !process.env.CI },
    {
      command: 'node dist/server/entry.mjs',
      url: 'http://127.0.0.1:4321/healthz',
      reuseExistingServer: !process.env.CI,
      env: {
        HOST: '127.0.0.1',
        PORT: '4321',
        SITE_API_BASE: 'http://127.0.0.1:4399',
        TURNSTILE_SITE_KEY: 'e2e-site-key',
      },
    },
  ],
  projects: [{ name: 'site', use: { ...devices['Desktop Chrome'] } }],
});

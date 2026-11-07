// [40.4.09] Budget gate for the school websites (D21, D38). Same device profile as
// lighthouserc.landing.cjs (mid-range Android on 3G). Raising a number here is a deliberate
// decision, never a CI fix.
// Run the site first (see the `site-budget` job in ci.yml): SITE_ROOT_DOMAIN=site.localhost,
// SITE_PREVIEW_PATHS=1, and `bmsc-high.site.localhost` pointing at 127.0.0.1 (the demo school's
// subdomain is its tenant slug). Trailing slashes on purpose (trailingSlash: 'always').
const SCHOOL = 'http://bmsc-high.site.localhost:4321';

module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      url: [
        `${SCHOOL}/bn/`,
        `${SCHOOL}/en/`,
        // No /bn/results/ yet: that page arrives with Epic 70 (the ticket's own "if absent" escape). Add it then.
        `${SCHOOL}/bn/notices/`,
        // lhci cannot send the X-Site-Preview header; the site maps this path itself when
        // SITE_PREVIEW_PATHS=1 (middleware.ts), and nginx does the same in production.
        'http://localhost:4321/website/preview/primary/bn/',
      ],
      settings: {
        formFactor: 'mobile',
        screenEmulation: { mobile: true, width: 360, height: 640, deviceScaleFactor: 2 },
        throttling: { rttMs: 400, throughputKbps: 700, cpuSlowdownMultiplier: 4 },
      },
    },
    assert: {
      // Every run must pass, not just the best of 3 (the lhci default is `optimistic`).
      aggregationMethod: 'pessimistic',
      assertMatrix: [
        {
          // School pages: all four budgets, SEO included.
          matchingUrlPattern: '^http://bmsc-high\\.site\\.localhost',
          assertions: {
            'categories:performance': ['error', { minScore: 0.9 }],
            'categories:accessibility': ['error', { minScore: 0.9 }],
            'categories:seo': ['error', { minScore: 0.9 }],
            'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
            // Islands only (D21): 30 KB of JavaScript per page, as downloaded.
            'resource-summary:script:size': ['error', { maxNumericValue: 30720 }],
          },
        },
        {
          // The preview is noindex by design (D33), so Lighthouse's `is-crawlable` fails: no SEO budget here.
          matchingUrlPattern: '/website/preview/',
          assertions: {
            'categories:performance': ['error', { minScore: 0.9 }],
            'categories:accessibility': ['error', { minScore: 0.9 }],
            'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
            'resource-summary:script:size': ['error', { maxNumericValue: 30720 }],
          },
        },
      ],
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci-site' },
  },
};

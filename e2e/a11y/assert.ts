import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from '../fixtures/test';
import { a11yException } from './exceptions';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * axe-core 4.14 (via @axe-core/playwright 4.14, PR #3502) moved
 * `label-content-name-mismatch` (WCAG 2.5.3) out of `experimental`. It
 * fails on four shared components whose accessible name must change,
 * which ripples into every test that selects them by exact name — too
 * wide for a dependency PR. #3574 makes the real fix and deletes this
 * line; `a11yException` throws once the recheck date passes.
 */
const DISABLED_RULES = [
  a11yException(
    'label-content-name-mismatch',
    'axe-core 4.14 enabled WCAG 2.5.3; four components need a name change tracked in #3574',
    '2026-12-19',
  ),
];

function formatViolations(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}`).join('\n'),
    )
    .join('\n');
}

/**
 * [8.5.5] Shared axe assertion — runs the five-tag WCAG scan (optionally
 * scoped to `include`, e.g. `[role="dialog"]` for an open overlay) and
 * fails with the formatted violation list. Extracted out of
 * `routes.a11y.spec.ts` in [18.1.2] so `e2e/smoke/routes.smoke.spec.ts`
 * can reuse it without depending on that sweep-only spec file.
 */
export async function expectNoAxeViolations(page: Page, include?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(TAGS).disableRules(DISABLED_RULES);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  expect(results.violations, `axe violations:\n${formatViolations(results.violations)}`).toEqual(
    [],
  );
}

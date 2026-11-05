import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from '../fixtures/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

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
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  expect(results.violations, `axe violations:\n${formatViolations(results.violations)}`).toEqual(
    [],
  );
}

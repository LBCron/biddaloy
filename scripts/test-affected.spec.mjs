// [15.6] Pure — no git, no spawning. Exercises `resolveAffected()` with
// literal changed-file lists, mirroring the mapping table in
// test-affected.mjs's own header comment.
import { describe, expect, it } from 'vitest';

import vitestConfig from '../vitest.config.ts';
import { ALL_PROJECTS, resolveAffected } from './test-affected.mjs';

describe('resolveAffected', () => {
  it('AC #1 — a one-package (client-admin) change runs only that package', () => {
    const plan = resolveAffected(['client-admin/src/routes/_staff/students/index.tsx']);
    expect(plan.frontendProjects).toEqual(['client-admin:node', 'client-admin:jsdom']);
    expect(plan.runServerUnit).toBe(false);
  });

  it('a server change runs no frontend projects, only the server unit suite', () => {
    const plan = resolveAffected(['server/src/modules/fees/fees.service.ts']);
    expect(plan.frontendProjects).toEqual([]);
    expect(plan.runServerUnit).toBe(true);
  });

  it('a shared change runs all five frontend projects, site-themes and the server suite', () => {
    const plan = resolveAffected(['shared/src/enums/permissions.ts']);
    expect(plan.frontendProjects).toEqual([
      'ui:node',
      'ui:jsdom',
      'client-admin:node',
      'client-admin:jsdom',
      'shared:node',
      'site-themes:node',
    ]);
    expect(plan.runServerUnit).toBe(true);
  });

  it('a ui change fans out into client-admin, but not into shared', () => {
    const plan = resolveAffected(['ui/src/components/button.tsx']);
    expect(plan.frontendProjects).toEqual([
      'ui:node',
      'ui:jsdom',
      'client-admin:node',
      'client-admin:jsdom',
    ]);
    expect(plan.frontendProjects).not.toContain('shared:node');
    expect(plan.runServerUnit).toBe(false);
  });

  it('a scripts change runs only scripts:node', () => {
    const plan = resolveAffected(['scripts/coverage-delta.mjs']);
    expect(plan.frontendProjects).toEqual(['scripts:node']);
    expect(plan.runServerUnit).toBe(false);
  });

  it('a landing change runs only the landing project', () => {
    const plan = resolveAffected(['landing/src/pages/index.astro']);
    expect(plan.frontendProjects).toEqual(['landing']);
    expect(plan.runServerUnit).toBe(false);
    expect(plan.notes).toEqual([]);
  });

  it.each([['README.md'], ['docs/architecture/README.md']])(
    'a docs-only change (%s) resolves to an empty plan',
    (file) => {
      const plan = resolveAffected([file]);
      expect(plan.frontendProjects).toEqual([]);
      expect(plan.runServerUnit).toBe(false);
      expect(plan.notes).toEqual([]);
    },
  );

  it('a top-level config file (yarn.lock) runs everything', () => {
    const plan = resolveAffected(['yarn.lock']);
    expect(plan.frontendProjects).toEqual(ALL_PROJECTS);
    expect(plan.runServerUnit).toBe(true);
  });

  it('an e2e-only change resolves to an empty plan plus a note to run yarn e2e', () => {
    const plan = resolveAffected(['e2e/students.spec.ts']);
    expect(plan.frontendProjects).toEqual([]);
    expect(plan.runServerUnit).toBe(false);
    expect(plan.notes).toEqual([
      'Playwright specs affected; run `yarn e2e` (not covered by test:affected).',
    ]);
  });

  it('an unmapped top-level path defaults to running everything, with a note', () => {
    const plan = resolveAffected(['some-new-toplevel-dir/x.ts']);
    expect(plan.frontendProjects).toEqual(ALL_PROJECTS);
    expect(plan.runServerUnit).toBe(true);
    expect(plan.notes).toHaveLength(1);
    expect(plan.notes[0]).toMatch(/unmapped path "some-new-toplevel-dir\/x\.ts"/);
  });

  it('dedupes and orders projects stably regardless of input order', () => {
    const plan = resolveAffected(['ui/a.ts', 'client-admin/b.ts', 'ui/c.ts']);
    expect(plan.frontendProjects).toEqual([
      'ui:node',
      'ui:jsdom',
      'client-admin:node',
      'client-admin:jsdom',
    ]);
    expect(plan.runServerUnit).toBe(false);
  });

  it('an empty change list resolves to an empty, no-op plan', () => {
    const plan = resolveAffected([]);
    expect(plan.frontendProjects).toEqual([]);
    expect(plan.runServerUnit).toBe(false);
    expect(plan.notes).toEqual([]);
  });
});

describe('ALL_PROJECTS project-universe guard', () => {
  it('matches every project name actually declared in vitest.config.ts', () => {
    // Guards against #441's mapping table silently going stale if a
    // project is ever renamed or added/removed in vitest.config.ts without
    // a matching update here — see [8.4.4]-style "gate never fires" bugs
    // this repo has hit before. Imports the real config rather than
    // regex-scanning its text, since two of the six project names
    // (`ui:node`/`ui:jsdom`, `client-admin:node`/`client-admin:jsdom`) are
    // built from a template literal (`frontendPackage()`), not a literal
    // string a regex could reliably match.
    const declared = vitestConfig.test.projects.map((p) => p.test.name);
    expect(new Set(declared)).toEqual(new Set(ALL_PROJECTS));
  });
});

import { SitePage } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import { THEMES, defaultConfigFor, validateSiteConfig } from './index';

describe.each(Object.values(THEMES))('$id theme: results page', (m) => {
  it('lists the results page, switched off with no sections (the school opts in, D12)', () => {
    const page = defaultConfigFor(m.id).pages.find((p) => p.page === SitePage.RESULTS);
    expect(page).toEqual({ page: SitePage.RESULTS, enabled: false, sections: [] });
  });

  it('validates with the page on, and with the page missing (older drafts)', () => {
    const cfg = defaultConfigFor(m.id);
    const on = {
      ...cfg,
      pages: cfg.pages.map((p) => (p.page === SitePage.RESULTS ? { ...p, enabled: true } : p)),
    };
    const ok = validateSiteConfig(on, m);
    expect(ok.ok && ok.value.pages.find((p) => p.page === SitePage.RESULTS)?.enabled).toBe(true);
    const old = { ...cfg, pages: cfg.pages.filter((p) => p.page !== SitePage.RESULTS) };
    expect(validateSiteConfig(old, m).ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { SiteTheme } from '@biddaloy/shared';
import { defaultConfigFor } from '@biddaloy/site-themes';
import { toCell } from '../../codec/cell-format';
import type { ImportContext } from '../../codec/tab-spec';
import { schoolSiteTab } from './school-site.tab';

const ctx: ImportContext = { tenantId: 't1', ref: () => undefined, warn: () => undefined };

/** A school_site row as the workbook writes it: every value as cell text. */
function cells(row: Record<string, unknown>) {
  return Object.fromEntries(
    schoolSiteTab.columns.map((c) => [c.key, String(toCell(c.type, row[c.key]) ?? '')]),
  );
}

const base = {
  id: '00000000-0000-4000-8000-000000000001',
  subdomain: 'green-valley-ab12',
  enabled: true,
  noindex: false,
  published_at: '2026-01-02T03:04:05.000Z',
};

describe('schoolSiteTab.fromRow', () => {
  // [#3621 gate] saveDraft moves the `theme` column to the draft's theme; the published copy
  // keeps its own theme until the next publish. Such a school must be able to restore its backup.
  it('accepts a draft on a new theme while the published copy is still on the old one', () => {
    const draft = defaultConfigFor(SiteTheme.PRIMARY);
    const published = defaultConfigFor(SiteTheme.BASIC);
    const parsed = schoolSiteTab.fromRow(
      cells({ ...base, theme: SiteTheme.PRIMARY, palette: draft.palette, draft, published }),
      2,
      ctx,
    );
    expect('errors' in parsed ? parsed.errors : []).toEqual([]);
  });

  it('still refuses a published copy that is not valid for its own theme', () => {
    const draft = defaultConfigFor(SiteTheme.BASIC);
    const published = { ...defaultConfigFor(SiteTheme.BASIC), palette: 'not-a-palette' };
    const parsed = schoolSiteTab.fromRow(
      cells({ ...base, theme: SiteTheme.BASIC, palette: draft.palette, draft, published }),
      2,
      ctx,
    );
    expect('errors' in parsed && parsed.errors.map((e) => e.column)).toEqual(['published']);
  });
});

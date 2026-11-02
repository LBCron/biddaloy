/**
 * [8.15.39] The layout rules, and the words of the designer (D21): the `designer` section of
 * `reports.json` never says what the glossary's "Never say" column lists, in either language.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildLayout, suggestLayout, type LayoutPicks } from './suggest-layout';

const cls = { key: 'class', isDate: false };
const section = { key: 'section', isDate: false };
const day = { key: 'date', isDate: true };

function picks(splitBy: LayoutPicks['splitBy'], counts: string[]): LayoutPicks {
  return { splitBy, counts };
}

describe('suggestLayout', () => {
  it('no split: a plain table', () => {
    expect(suggestLayout(picks([], []))).toEqual({ layout: 'TABLE', reason: 'noSplit' });
    expect(suggestLayout(picks([], ['students']))).toEqual({ layout: 'TABLE', reason: 'noSplit' });
  });

  it('a split with nothing to count: still a plain table', () => {
    expect(suggestLayout(picks([cls], []))).toEqual({ layout: 'TABLE', reason: 'noCount' });
  });

  it('one split and a count: grouped with subtotals', () => {
    expect(suggestLayout(picks([cls], ['students']))).toEqual({
      layout: 'GROUPED',
      reason: 'oneSplit',
    });
  });

  it('two splits and a count: a table of counts', () => {
    expect(suggestLayout(picks([cls, section], ['students']))).toEqual({
      layout: 'CROSSTAB',
      reason: 'twoSplits',
    });
  });

  it('two splits and several counts: grouped, so no count is hidden', () => {
    expect(suggestLayout(picks([cls, section], ['billed', 'paid']))).toEqual({
      layout: 'GROUPED',
      reason: 'twoSplitsManyCounts',
    });
  });

  it('a date split and a count: a line chart', () => {
    expect(suggestLayout(picks([day], ['payments']))).toEqual({
      layout: 'CHART',
      reason: 'dateSplit',
    });
  });

  it('three splits: grouped', () => {
    expect(suggestLayout(picks([cls, section, day], ['students']))).toEqual({
      layout: 'GROUPED',
      reason: 'manySplits',
    });
  });
});

describe('buildLayout', () => {
  it('grouped groups by every split and adds subtotals', () => {
    expect(buildLayout('GROUPED', picks([cls, section], ['students']))).toEqual({
      type: 'GROUPED',
      group_by: ['class', 'section'],
      subtotals: true,
      totals: true,
    });
  });

  it('a table of counts: first split is the rows, second the columns, first count the cell', () => {
    expect(buildLayout('CROSSTAB', picks([cls, section], ['students']))).toEqual({
      type: 'CROSSTAB',
      rows: ['class'],
      columns: ['section'],
      cell_measure: 'students',
      totals: true,
    });
  });

  it('a table of counts with one split leaves the columns empty instead of failing', () => {
    const layout = buildLayout('CROSSTAB', picks([cls], []));
    expect(layout).toMatchObject({ rows: ['class'], columns: [] });
    expect(layout.cell_measure).toBeUndefined();
  });

  it('a chart of a date split is a line, of anything else a bar', () => {
    expect(buildLayout('CHART', picks([day], ['payments'])).chart).toEqual({
      kind: 'line',
      x: 'date',
      y: ['payments'],
    });
    expect(buildLayout('CHART', picks([cls], ['students'])).chart?.kind).toBe('bar');
  });

  it('a table has no grouping', () => {
    expect(buildLayout('TABLE', picks([cls], ['students']))).toEqual({
      type: 'TABLE',
      totals: false,
    });
  });
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** `{ a: { b: 'x' } }` to `['x']`. */
function strings(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  return Object.values(node as Record<string, unknown>).flatMap(strings);
}

/** The terms in the glossary's last column of the "What we say" table. */
function neverSay(): string[] {
  const table = read('../../../../docs/ux-research/8.15-reports-glossary.md').split('## Rules')[0]!;
  const terms = table
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*(Idea|-)/.test(line))
    .flatMap((line) => (line.split('|').at(-2) ?? '').split(','))
    .map((term) => term.replace(/\(.*?\)/g, '').trim())
    .filter(Boolean);
  return [...new Set(terms)];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('designer words (reports.json, "designer")', () => {
  const terms = neverSay();
  const jargon = ['dimension', 'measure', 'crosstab', 'aggregate'];

  for (const language of ['en', 'bn'] as const) {
    const designer = (
      JSON.parse(read(`../../i18n/locales/${language}/reports.json`)) as Record<string, unknown>
    ).designer;

    it(`${language}: the section exists`, () => {
      expect(strings(designer).length).toBeGreaterThan(40);
    });

    it(`${language}: no never-say term and none of the four jargon words`, () => {
      for (const text of strings(designer)) {
        for (const term of [...terms, ...jargon]) {
          expect(text, `${language}: "${text}" must not say "${term}"`).not.toMatch(
            new RegExp(`(^|[^\\p{L}])${escape(term)}([^\\p{L}]|$)`, 'iu'),
          );
        }
      }
    });
  }
});

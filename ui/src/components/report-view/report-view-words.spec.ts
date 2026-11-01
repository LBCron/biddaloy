/**
 * [8.15.26] Every word on a report screen comes from the glossary (D21). This reads the "Never say"
 * column of docs/ux-research/8.15-reports-glossary.md and fails if any of those terms, or the
 * symbol the ticket rules out, shows up in the `reportView` namespace in either language.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const en = JSON.parse(read('../../i18n/locales/en/reportView.json')) as Record<string, unknown>;
const bn = JSON.parse(read('../../i18n/locales/bn/reportView.json')) as Record<string, unknown>;

/** `{ a: { b: 'x' } }` to `{ 'a.b': 'x' }`. */
function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  return Object.entries(node as Record<string, unknown>).reduce(
    (all, [key, value]) => ({ ...all, ...flatten(value, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

/** The terms in the glossary's last column of the "What we say" table. */
function neverSayTerms(): string[] {
  const glossary = read('../../../../docs/ux-research/8.15-reports-glossary.md');
  const table = glossary.split('## Rules')[0]!;
  const terms = table
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*(Idea|-)/.test(line))
    .flatMap((line) => (line.split('|').at(-2) ?? '').split(','))
    .map((term) => term.replace(/\(.*?\)/g, '').trim())
    .filter(Boolean);
  return [...new Set(terms)];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('reportView words', () => {
  const terms = neverSayTerms();

  it('reads the never-say column of the glossary', () => {
    expect(terms.length).toBeGreaterThan(30);
    expect(terms).toEqual(expect.arrayContaining(['dimension', 'aggregate', 'crosstab', 'ledger']));
  });

  for (const [language, file] of [
    ['en', en],
    ['bn', bn],
  ] as const) {
    it(`${language}: no never-say term and no sigma`, () => {
      for (const [key, text] of Object.entries(flatten(file))) {
        expect(text, key).not.toContain('Σ');
        for (const term of terms) {
          expect(text, `${language} ${key} must not say "${term}"`).not.toMatch(
            new RegExp(`(^|[^\\p{L}])${escape(term)}([^\\p{L}]|$)`, 'iu'),
          );
        }
      }
    });
  }

  it('en and bn have the same keys, and the ticket wording is in bn', () => {
    expect(Object.keys(flatten(en)).sort()).toEqual(Object.keys(flatten(bn)).sort());
    const words = flatten(bn);
    expect(words['total']).toBe('মোট');
    expect(words['grandTotal']).toBe('সর্বমোট');
    expect(words['hidden']).toBe('গোপনীয়তার জন্য ৫-এর কম সংখ্যা দেখানো হয় না');
    expect(words['crosstab.seeAsTable']).toBe('ছক হিসেবে দেখুন');
  });
});

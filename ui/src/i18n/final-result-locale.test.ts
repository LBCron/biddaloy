/** [70.4.1] The Epic 70 strings: same keys in en and bn, and none of the words the epic
 * glossary (D15) says never to show on screen. */
import { describe, expect, it } from 'vitest';

import bnExams from './locales/bn/exams.json';
import bnMyClass from './locales/bn/myClass.json';
import bnPortal from './locales/bn/portal.json';
import bnPromotions from './locales/bn/promotions.json';
import bnSettings from './locales/bn/settings.json';
import enExams from './locales/en/exams.json';
import enMyClass from './locales/en/myClass.json';
import enPortal from './locales/en/portal.json';
import enPromotions from './locales/en/promotions.json';
import enSettings from './locales/en/settings.json';

type Tree = Record<string, unknown>;

const pick = (tree: Tree, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((n, k) => (n as Tree | undefined)?.[k], tree);

/** The subtrees this ticket added, per namespace. */
const SUBTREES: Array<[string, Tree, Tree, string[]]> = [
  [
    'exams',
    enExams,
    bnExams,
    [
      'finalResults',
      'help.finalResults',
      'reportCard.finalTitle',
      'reportCard.finalColumn',
      'reportCard.examsHeading',
      'reportCard.workingDays',
      'reportCard.presentDays',
      'reportCard.remarkLabel',
      'reportCard.conductLabel',
      'reportCard.noGrade',
    ],
  ],
  ['myClass', enMyClass, bnMyClass, ['notes', 'help.notes']],
  ['settings', enSettings, bnSettings, ['conductItems', 'help.conductItems']],
  ['portal', enPortal, bnPortal, ['finalResult']],
  ['promotions', enPromotions, bnPromotions, ['source']],
];

function leaves(node: unknown, prefix: string, out: Map<string, string> = new Map()) {
  if (typeof node === 'string') out.set(prefix, node);
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) leaves(v, `${prefix}.${k}`, out);
  return out;
}

const collect = (tree: Tree, paths: string[]) => {
  const out = new Map<string, string>();
  for (const p of paths) leaves(pick(tree, p), p, out);
  return out;
};

// Words the glossary replaces: composition, weight, process, override, best-of, snapshot,
// annual result, null/missing, attendance summary, note/comment, evaluation.
const NEVER_EN =
  /\b(composition|weights?|process(ed|ing)?|overrides?|best-of|snapshot|annual result|null|missing|attendance summary|notes?|comments?|evaluation)\b/i;
// A Bangla word counts only at its start ("যেকোনোটিতে" contains "নোট" but is not that word).
const NEVER_BN = new RegExp(
  `(?<![\\u0980-\\u09FF])(${['বার্ষিক ফলাফল', 'কম্পোজিশন', 'ওয়েট', 'প্রক্রিয়া', 'ওভাররাইড', 'স্ন্যাপশট', 'নোট', 'কমেন্ট'].join('|')})`,
);

describe.each(SUBTREES)('%s: Epic 70 keys', (_ns, en, bn, paths) => {
  const enLeaves = collect(en, paths);
  const bnLeaves = collect(bn, paths);

  it('are present in both languages and not empty', () => {
    expect(enLeaves.size).toBeGreaterThan(0);
    expect([...bnLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
    for (const v of [...enLeaves.values(), ...bnLeaves.values()]) expect(v.trim()).not.toBe('');
  });

  it.each([...enLeaves])('en %s has no never-say word', (_k, v) => {
    expect(v).not.toMatch(NEVER_EN);
  });

  it.each([...bnLeaves])('bn %s has no never-say word', (_k, v) => {
    expect(v).not.toMatch(NEVER_BN);
  });
});

describe('help.* keys for the switches', () => {
  it.each(['share', 'rounding', 'failIfAnyExamFails', 'perSubjectShare', 'bestOf'])(
    'finalResults.%s has help in both languages',
    (k) => {
      expect(pick(enExams, `help.finalResults.${k}`)).toEqual(expect.any(String));
      expect(pick(bnExams, `help.finalResults.${k}`)).toEqual(expect.any(String));
    },
  );
});

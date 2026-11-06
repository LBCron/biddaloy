/** [76.4.02] The Epic 76 attendance-sheet strings: same keys in en and bn, and none of the
 * words the epic's plain-words list (D17) says never to show on screen. */
import { describe, expect, it } from 'vitest';

import bnAttendance from './locales/bn/attendance.json';
import bnImport from './locales/bn/attendanceImport.json';
import bnNav from './locales/bn/nav.json';
import bnSettings from './locales/bn/settings.json';
import bnStaff from './locales/bn/staff.json';
import bnStudents from './locales/bn/students.json';
import enAttendance from './locales/en/attendance.json';
import enImport from './locales/en/attendanceImport.json';
import enNav from './locales/en/nav.json';
import enSettings from './locales/en/settings.json';
import enStaff from './locales/en/staff.json';
import enStudents from './locales/en/students.json';

type Tree = Record<string, unknown>;

const pick = (tree: Tree, dotted: string): unknown =>
  dotted.split('.').reduce<unknown>((n, k) => (n as Tree | undefined)?.[k], tree);

/** The subtrees this ticket added, per namespace (whole namespace for attendanceImport). */
const SUBTREES: Array<[string, Tree, Tree, string[]]> = [
  ['attendanceImport', enImport, bnImport, ['']],
  [
    'attendance',
    enAttendance,
    bnAttendance,
    ['registerBanner', 'firstPeriod', 'markRestAbsent', 'scannedBadge', 'fromSheetBadge'],
  ],
  ['settings', enSettings, bnSettings, ['attendance.dailySource', 'help.dailySource', 'help.staffSmsFallback', 'help.deviceSecretKey']],
  ['students', enStudents, bnStudents, ['cardNo', 'bulkUpload', 'help.cardNo']],
  ['staff', enStaff, bnStaff, ['cardNo', 'bulkUpload', 'help.cardNo']],
  ['nav', enNav, bnNav, ['items.upload', 'items.uploads', 'items.uploadDetail']],
];

const leaves = (node: unknown, path = ''): Array<[string, string]> =>
  typeof node === 'string'
    ? [[path, node]]
    : Object.entries(node as Tree).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));

const subtree = (tree: Tree, dotted: string): unknown => (dotted ? pick(tree, dotted) : tree);

// Words that must not reach a screen (English only; the Bangla copy has no loan words for them).
const NEVER_SAY =
  /\b(source|device|rfid|biometric|import(?:ed|ing)?|sync(?:ed)?|payload|stage[ds]?|staging|commit(?:ted)?|validat\w*|entity|template|preview|token|api key)\b/i;

describe('Epic 76 attendance-sheet locale', () => {
  it.each(SUBTREES)('%s: en and bn have the same keys', (_ns, en, bn, paths) => {
    for (const p of paths) {
      const e = subtree(en, p);
      const b = subtree(bn, p);
      expect(e, `en ${p}`).toBeDefined();
      expect(b, `bn ${p}`).toBeDefined();
      expect(
        leaves(b)
          .map(([k]) => k)
          .sort(),
      ).toEqual(
        leaves(e)
          .map(([k]) => k)
          .sort(),
      );
    }
  });

  it.each(SUBTREES)('%s: no never-say word in an English value', (_ns, en, _bn, paths) => {
    const bad = paths.flatMap((p) => leaves(subtree(en, p))).filter(([, v]) => NEVER_SAY.test(v));
    expect(bad).toEqual([]);
  });

  it('has one sentence per row-error code', () => {
    expect(Object.keys((enImport as Tree).rowError as Tree).sort()).toEqual(
      [
        'BAD_STATUS',
        'DATE_OUTSIDE_YEAR',
        'DUPLICATE_ROW',
        'FUTURE_DATE',
        'NAME_MISMATCH',
        'NEEDS_CORRECT_PERMISSION',
        'NON_WORKING_DAY',
        'NOT_ALLOWED_SECTION',
        'ROLL_NOT_IN_SECTION',
        'SECTION_NOT_FOUND',
      ].sort(),
    );
  });
});

import { describe, expect, it } from 'vitest';

import { buildWeights, equalShares, previewShares, sumShares } from './-share-rules';

describe('share rules', () => {
  it('equal shares always add to exactly 100', () => {
    for (const n of [1, 2, 3, 6, 7]) expect(sumShares(equalShares(n))).toBe(100);
    expect(equalShares(3)).toEqual([33.33, 33.33, 33.34]);
    expect(equalShares(0)).toEqual([]);
  });

  it('sums in whole hundredths', () => {
    expect(sumShares([0.1, 0.2, 99.7])).toBe(100);
  });

  it('best-of sends equal shares and no subject rows', () => {
    const w = buildWeights({
      examIds: ['a', 'b'],
      shares: { a: 10, b: 10 },
      subjectShares: { s1: { a: 1, b: 99 } },
      bestOf: true,
    });
    expect(w.map((x) => x.share_percent)).toEqual([50, 50]);
    expect(w.every((x) => x.subject_id === null)).toBe(true);
  });

  it('per-subject rows follow the whole-exam rows', () => {
    const w = buildWeights({
      examIds: ['a', 'b'],
      shares: { a: 30, b: 70 },
      subjectShares: { s1: { a: 40, b: 60 } },
      bestOf: false,
    });
    expect(w).toHaveLength(4);
    expect(previewShares(w, ['a', 'b'], 's1')).toEqual({ a: 40, b: 60 });
    expect(previewShares(w, ['a', 'b'], 's2')).toEqual({ a: 30, b: 70 });
    expect(previewShares([], ['a', 'b'], 's2')).toEqual({ a: 50, b: 50 });
  });
});

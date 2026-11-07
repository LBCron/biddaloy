import { describe, expect, it } from 'vitest';
import { orderSections } from './sections';

const row = (key: string, extra: object = {}) => ({ key: key as never, data: {}, ...extra });

function* permutations<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) return yield xs;
  for (let i = 0; i < xs.length; i++) {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)]))
      yield [xs[i], ...rest];
  }
}

describe('orderSections', () => {
  const middle = ['about', 'notices', 'teachers', 'events'];

  it('pins hero first and footer last for every order of 4 other sections, no duplicates', () => {
    let n = 0;
    for (const p of permutations(middle)) {
      // hero and footer dropped anywhere in the list, and one key listed twice
      const sections = [row('footer'), ...p.map((k) => row(k)), row('hero'), row(p[0])];
      const out = orderSections({ sections }).map((s) => s.key as string);
      expect(out[0]).toBe('hero');
      expect(out[out.length - 1]).toBe('footer');
      expect(out.slice(1, -1)).toEqual(p);
      expect(new Set(out).size).toBe(out.length);
      n++;
    }
    expect(n).toBe(24);
  });

  it('drops disabled, empty and skipped sections', () => {
    const sections = [
      row('hero'),
      row('about', { enabled: false }),
      row('notices', { empty: true }),
      row('teachers', { feed: [{ id: 1 }] }),
      row('events'),
    ];
    expect(orderSections({ sections }, ['events']).map((s) => s.key)).toEqual(['hero', 'teachers']);
  });

  it('answers [] for a page with no sections', () => {
    expect(orderSections({ sections: [] })).toEqual([]);
  });
});

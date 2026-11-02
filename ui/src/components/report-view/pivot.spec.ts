import { describe, expect, it } from 'vitest';

import { pivot, type PivotInput } from './pivot';

// BANBEIS-shaped: students by class, then gender, then religion. Seven / Girl / Hindu has no row.
const rows = [
  { class: 'Six', gender: 'Boy', religion: 'Islam', students: 30 },
  { class: 'Six', gender: 'Boy', religion: 'Hindu', students: 10 },
  { class: 'Six', gender: 'Girl', religion: 'Islam', students: 28 },
  { class: 'Six', gender: 'Girl', religion: 'Hindu', students: 10 },
  { class: 'Seven', gender: 'Boy', religion: 'Islam', students: 25 },
  { class: 'Seven', gender: 'Boy', religion: 'Hindu', students: 5 },
  { class: 'Seven', gender: 'Girl', religion: 'Islam', students: 20 },
];

const input: PivotInput = {
  rows: ['class'],
  columns: ['gender', 'religion'],
  measure: 'students',
  type: 'NUMBER',
};

const id = (...parts: unknown[]) => JSON.stringify(parts);

describe('pivot: class x gender x religion', () => {
  const m = pivot(rows, input);

  it('keeps first-seen order for rows and leaf columns', () => {
    expect(m.rowKeys.map((k) => k.parts)).toEqual([['Six'], ['Seven']]);
    expect(m.leaves.map((k) => k.parts)).toEqual([
      ['Boy', 'Islam'],
      ['Boy', 'Hindu'],
      ['Girl', 'Islam'],
      ['Girl', 'Hindu'],
    ]);
  });

  it('nests the column header: gender over religion, spans count the leaves', () => {
    expect(m.colKeys.map((n) => [n.value, n.depth, n.span])).toEqual([
      ['Boy', 0, 2],
      ['Girl', 0, 2],
    ]);
    expect(m.colKeys[0]!.children.map((n) => [n.value, n.depth, n.span])).toEqual([
      ['Islam', 1, 1],
      ['Hindu', 1, 1],
    ]);
    expect(m.colKeys[0]!.children[0]!.children).toEqual([]);
  });

  it('puts each value in its cell and leaves a pair with no row absent', () => {
    const six = id('Six');
    expect(m.cells[six]![id('Boy', 'Islam')]).toEqual({ value: 30, incomplete: false });
    expect(m.cells[six]![id('Girl', 'Hindu')]).toEqual({ value: 10, incomplete: false });
    expect(m.cells[id('Seven')]![id('Girl', 'Hindu')]).toBeUndefined();
  });

  it('adds row totals, column totals and the grand total from the raw rows', () => {
    expect(m.rowTotals[id('Six')]!.value).toBe(78);
    expect(m.rowTotals[id('Seven')]!.value).toBe(50);
    expect(m.colTotals[id('Boy', 'Islam')]!.value).toBe(55);
    expect(m.colTotals[id('Boy', 'Hindu')]!.value).toBe(15);
    expect(m.colTotals[id('Girl', 'Islam')]!.value).toBe(48);
    expect(m.colTotals[id('Girl', 'Hindu')]!.value).toBe(10);
    expect(m.grand.value).toBe(128);
    const sumOfRows = Object.values(m.rowTotals).reduce((a, t) => a + (t.value ?? 0), 0);
    const sumOfCols = Object.values(m.colTotals).reduce((a, t) => a + (t.value ?? 0), 0);
    expect(sumOfRows).toBe(m.grand.value);
    expect(sumOfCols).toBe(m.grand.value);
  });
});

describe('pivot: hidden counts and other types', () => {
  it('a hidden (null) cell marks every total it belongs to incomplete, never zero', () => {
    const m = pivot(
      [
        { class: 'Six', gender: 'Boy', students: null },
        { class: 'Six', gender: 'Girl', students: 38 },
        { class: 'Seven', gender: 'Boy', students: 35 },
      ],
      { rows: ['class'], columns: ['gender'], measure: 'students', type: 'NUMBER' },
    );
    expect(m.cells[id('Six')]![id('Boy')]).toEqual({ value: null, incomplete: true });
    expect(m.rowTotals[id('Six')]).toEqual({ value: 38, incomplete: true });
    expect(m.rowTotals[id('Seven')]).toEqual({ value: 35, incomplete: false });
    expect(m.colTotals[id('Boy')]).toEqual({ value: 35, incomplete: true });
    expect(m.colTotals[id('Girl')]).toEqual({ value: 38, incomplete: false });
    expect(m.grand.incomplete).toBe(true);
  });

  it('adds money in whole paisa', () => {
    const m = pivot(
      [
        { c: 'A', g: 'x', fee: 0.1 },
        { c: 'A', g: 'y', fee: 0.2 },
      ],
      { rows: ['c'], columns: ['g'], measure: 'fee', type: 'MONEY' },
    );
    expect(m.rowTotals[id('A')]!.value).toBe(0.3);
    expect(m.grand.value).toBe(0.3);
  });

  it('adds up rows that share a cell', () => {
    const m = pivot(
      [
        { c: 'A', g: 'x', n: 2 },
        { c: 'A', g: 'x', n: 3 },
      ],
      { rows: ['c'], columns: ['g'], measure: 'n', type: 'NUMBER' },
    );
    expect(m.cells[id('A')]![id('x')]!.value).toBe(5);
  });

  it('has no totals for a percentage', () => {
    const m = pivot([{ c: 'A', g: 'x', p: 80 }], {
      rows: ['c'],
      columns: ['g'],
      measure: 'p',
      type: 'PERCENT',
    });
    expect(m.cells[id('A')]![id('x')]!.value).toBeNull();
    expect(m.grand.value).toBeNull();
  });

  it('works with one column field, or none', () => {
    const one = pivot(rows, { ...input, columns: ['gender'] });
    expect(one.colKeys.map((n) => [n.value, n.span, n.children.length])).toEqual([
      ['Boy', 1, 0],
      ['Girl', 1, 0],
    ]);
    expect(one.colTotals[id('Boy')]!.value).toBe(70);

    const none = pivot(rows, { ...input, columns: [] });
    expect(none.colKeys).toEqual([]);
    expect(none.leaves).toHaveLength(1);
    expect(none.rowTotals[id('Six')]!.value).toBe(78);
    expect(none.cells[id('Six')]![id()]!.value).toBe(78);
  });

  it('is empty for no rows', () => {
    const m = pivot([], input);
    expect(m.rowKeys).toEqual([]);
    expect(m.leaves).toEqual([]);
    expect(m.grand).toEqual({ value: null, incomplete: false });
  });
});

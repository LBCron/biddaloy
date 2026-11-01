import { act, screen, within } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '../../i18n';
import { renderWithProviders } from '../../test';

import { addUp, formatCell } from './format-cell';
import { ReportTable } from './report-table';
import type { ReportColumn, ReportRunResult } from './types';

import * as barrel from './index';

const col = (
  key: string,
  type: ReportColumn['type'],
  kind: ReportColumn['kind'],
  label_en: string,
  label_bn: string,
): ReportColumn => ({ key, type, kind, label_en, label_bn });

const columns: ReportColumn[] = [
  col('name', 'TEXT', 'dimension', 'Name', 'নাম'),
  col('joined', 'DATE', 'dimension', 'Joined', 'ভর্তির তারিখ'),
  col('fee', 'MONEY', 'measure', 'Charged', 'বিল'),
  col('students', 'NUMBER', 'measure', 'Students', 'ছাত্রছাত্রী'),
  col('rate', 'PERCENT', 'measure', 'Present', 'উপস্থিত'),
  col('active', 'BOOLEAN', 'dimension', 'Active', 'চালু'),
];

function run(overrides: Partial<ReportRunResult> = {}): ReportRunResult {
  return {
    columns,
    rows: [
      {
        name: 'Rahim',
        joined: '2026-09-09',
        fee: 1500.5,
        students: 1250,
        rate: 87.5,
        active: true,
      },
      { name: 'Karim', joined: '2026-01-02', fee: 20000, students: 3, rate: 90, active: false },
    ],
    masked: [],
    suppressed: false,
    truncated: false,
    total_rows: 2,
    page: 1,
    page_size: 25,
    total_pages: 1,
    run_id: 'run-1',
    ...overrides,
  };
}

async function renderEn(ui: React.ReactElement) {
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>{ui}</RegionConfigProvider>,
    { locale: 'en' },
  );
  await act(async () => {
    await view.localeReady;
  });
  return view;
}

async function renderBn(ui: React.ReactElement) {
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_BN}>{ui}</RegionConfigProvider>,
    { locale: 'bn' },
  );
  await act(async () => {
    await view.localeReady;
  });
  return view;
}

describe('ReportTable', () => {
  it('formats every column type and right-aligns numbers (en)', async () => {
    await renderEn(<ReportTable result={run()} caption="Students" layout="table" />);
    const table = await screen.findByRole('table', { name: 'Students' });
    const first = within(table).getAllByRole('row')[1]!;
    const cells = within(first)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells).toEqual(['Rahim', '9th September, 2026', '৳1,500.50', '1,250', '87.5%', 'Yes']);
    const money = within(first).getAllByRole('cell')[2]!;
    expect(money.className).toContain('text-end');
    expect(money.className).toContain('tabular-nums');
    expect(within(table).getByRole('columnheader', { name: 'Charged' })).toBeTruthy();
  });

  it('uses Bangla labels and digits under bn', async () => {
    await renderBn(<ReportTable result={run()} caption="ছাত্রছাত্রী" layout="table" />);
    const table = await screen.findByRole('table', { name: 'ছাত্রছাত্রী' });
    expect(within(table).getByRole('columnheader', { name: 'বিল' })).toBeTruthy();
    const first = within(table).getAllByRole('row')[1]!;
    const text = within(first)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(text[2]).toBe('৳১,৫০০.৫০');
    expect(text[3]).toBe('১,২৫০');
    expect(text[4]).toBe('৮৭.৫%');
    expect(text[1]).toContain('২০২৬');
    expect(text[5]).toBe('হ্যাঁ');
  });

  it('shows a dash with the plain-words reason for a hidden count, never 0', async () => {
    const result = run({
      suppressed: true,
      rows: [
        { name: 'Rahim', joined: '2026-09-09', fee: 10, students: null, rate: 50, active: true },
      ],
      total_rows: 1,
    });
    const { user } = await renderEn(<ReportTable result={result} layout="table" />);
    const hidden = await screen.findByRole('button', {
      name: 'Numbers under 5 are not shown, to protect privacy',
    });
    expect(hidden.textContent).toBe('—');
    expect(screen.queryByText('0')).toBeNull();
    // Reachable by keyboard, and the reason shows on focus, not only on hover.
    for (let i = 0; i < 20 && document.activeElement !== hidden; i++) await user.tab();
    expect(document.activeElement).toBe(hidden);
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      'Numbers under 5 are not shown, to protect privacy',
    );
  });

  it('keeps a plain dash for an empty label that is not a hidden count', async () => {
    const result = run({
      rows: [{ name: null, joined: null, fee: null, students: null, rate: null, active: null }],
      total_rows: 1,
    });
    await renderEn(<ReportTable result={result} layout="table" />);
    const row = (await screen.findAllByRole('row'))[1]!;
    for (const cell of within(row).getAllByRole('cell')) expect(cell.textContent).toBe('—');
    expect(screen.queryByRole('button', { name: /privacy/ })).toBeNull();
  });

  it('phone layout is a list of cards, not a table', async () => {
    await renderEn(<ReportTable result={run()} caption="Students" layout="cards" />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(await screen.findAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('৳1,500.50')).toBeTruthy();
  });

  it('says what to change when nobody matches', async () => {
    await renderEn(<ReportTable result={run({ rows: [], total_rows: 0 })} layout="table" />);
    expect(await screen.findByText('Nobody matches these choices')).toBeTruthy();
    expect(screen.getByText('Try changing the choices.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('is axe clean in table, card, hidden-count and empty states', async () => {
    const hiddenRun = run({
      suppressed: true,
      rows: [
        { name: 'Rahim', joined: '2026-09-09', fee: 10, students: null, rate: 50, active: true },
      ],
      total_rows: 1,
    });
    for (const [result, layout] of [
      [run(), 'table'],
      [run(), 'cards'],
      [hiddenRun, 'table'],
      [run({ rows: [], total_rows: 0 }), 'table'],
    ] as const) {
      const { container, unmount } = await renderEn(
        <ReportTable result={result} caption="Students" layout={layout} />,
      );
      await screen.findAllByText(/./);
      await expect(container).toHaveNoViolations();
      unmount();
    }
  });
});

describe('formatCell and addUp', () => {
  it('never turns a missing or unreadable value into 0 or NaN', () => {
    for (const type of ['TEXT', 'NUMBER', 'MONEY', 'PERCENT', 'DATE', 'BOOLEAN'] as const) {
      expect(formatCell(null, type, REGION_BD_EN)).toBe('—');
    }
    expect(formatCell('abc', 'NUMBER', REGION_BD_EN)).toBe('—');
    expect(formatCell('12', 'NUMBER', REGION_BD_EN)).toBe('12');
  });

  it('adds money in whole paisa and flags a hidden cell', () => {
    expect(addUp([0.1, 0.2], 'MONEY')).toEqual({ value: 0.3, incomplete: false });
    expect(addUp([40, null, 2], 'NUMBER')).toEqual({ value: 42, incomplete: true });
    expect(addUp([null], 'NUMBER')).toEqual({ value: null, incomplete: true });
    expect(addUp([50, 60], 'PERCENT')).toEqual({ value: null, incomplete: false });
  });
});

describe('report-view barrel', () => {
  it('exports the table and the grouped renderer, and leaves the table of counts and chart to [8.15.29]', () => {
    expect(barrel.ReportTable).toBe(ReportTable);
    expect(typeof barrel.ReportGrouped).toBe('function');
    expect(Object.keys(barrel)).not.toContain('ReportCrosstab');
    expect(Object.keys(barrel)).not.toContain('ReportChart');
  });
});

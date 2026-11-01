import { act, screen, within } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '../../i18n';
import { renderWithProviders } from '../../test';

import { ReportGrouped } from './report-grouped';
import type { ReportColumn, ReportLayoutProps, ReportRunResult } from './types';

const columns: ReportColumn[] = [
  { key: 'class', type: 'TEXT', kind: 'dimension', label_en: 'Class', label_bn: 'শ্রেণি' },
  { key: 'gender', type: 'TEXT', kind: 'dimension', label_en: 'Gender', label_bn: 'লিঙ্গ' },
  {
    key: 'students',
    type: 'NUMBER',
    kind: 'measure',
    label_en: 'Students',
    label_bn: 'ছাত্রছাত্রী',
  },
  { key: 'charged', type: 'MONEY', kind: 'measure', label_en: 'Charged', label_bn: 'বিল' },
];

const rows = [
  { class: 'Six', gender: 'Boy', students: 40, charged: 0.1 },
  { class: 'Six', gender: 'Girl', students: 38, charged: 0.2 },
  { class: 'Seven', gender: 'Boy', students: 35, charged: 1000 },
  { class: 'Seven', gender: 'Girl', students: 30, charged: 2000.5 },
];

function run(overrides: Partial<ReportRunResult> = {}): ReportRunResult {
  return {
    columns,
    rows,
    masked: [],
    suppressed: false,
    truncated: false,
    total_rows: rows.length,
    page: 1,
    page_size: 100,
    total_pages: 1,
    run_id: 'run-1',
    ...overrides,
  };
}

const layout: ReportLayoutProps = { group_by: ['class'], subtotals: true, totals: true };

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

const rowText = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent);

describe('ReportGrouped', () => {
  it('shows a header, the rows, a total per group and a grand total that equal the sums', async () => {
    await renderEn(<ReportGrouped result={run()} layout={layout} caption="Fees" view="table" />);
    const table = await screen.findByRole('table', { name: 'Fees' });

    expect(
      within(table)
        .getAllByRole('rowgroup')
        .filter((g) => g.tagName === 'TBODY'),
    ).toHaveLength(2);
    expect(within(table).getByRole('rowheader', { name: /Class:\s*Six/ })).toBeTruthy();

    const six = within(table).getByRole('row', { name: /Six — Total/ });
    expect(rowText(six)).toEqual(['78', '৳0.30']); // 40 + 38; 0.1 + 0.2 in whole paisa
    const seven = within(table).getByRole('row', { name: /Seven — Total/ });
    expect(rowText(seven)).toEqual(['65', '৳3,000.50']);
    const grand = within(table).getByRole('row', { name: /Grand total/ });
    expect(rowText(grand)).toEqual(['143', '৳3,000.80']);

    // The group column is a header, not repeated in every row; the grand total is the footer.
    expect(within(table).queryByRole('columnheader', { name: 'Class' })).toBeNull();
    expect(table.querySelector('tfoot')?.contains(grand)).toBe(true);
  });

  it('labels totals in Bangla with Bangla digits, never Σ or aggregate', async () => {
    const view = renderWithProviders(
      <RegionConfigProvider value={REGION_BD_BN}>
        <ReportGrouped result={run()} layout={layout} view="table" />
      </RegionConfigProvider>,
      { locale: 'bn' },
    );
    await act(async () => {
      await view.localeReady;
    });
    const table = await screen.findByRole('table');
    const six = within(table).getByRole('row', { name: /Six — মোট/ });
    expect(rowText(six)).toEqual(['৭৮', '৳০.৩০']);
    const grand = within(table).getByRole('row', { name: /সর্বমোট/ });
    expect(rowText(grand)[0]).toBe('১৪৩');
    expect(table.textContent).not.toMatch(/Σ|aggregate/i);
  });

  it('follows the layout: no group totals unless asked, no grand total unless asked', async () => {
    await renderEn(<ReportGrouped result={run()} layout={{ group_by: ['class'] }} view="table" />);
    const table = await screen.findByRole('table');
    expect(within(table).queryByRole('row', { name: /Total/ })).toBeNull();
    expect(table.querySelector('tfoot')).toBeNull();
  });

  it('nests two group levels, each with its own total', async () => {
    const result = run({
      columns: columns.filter((c) => c.key !== 'charged'),
      rows: rows.map((r) => ({ class: r.class, gender: r.gender, students: r.students })),
    });
    await renderEn(
      <ReportGrouped
        result={result}
        layout={{ group_by: ['class', 'gender'], subtotals: true, totals: true }}
        view="table"
      />,
    );
    const table = await screen.findByRole('table');
    // `gender` is the only label left, so it stays on the rows: one header level, still totals.
    expect(within(table).getByRole('row', { name: /Six — Total/ })).toBeTruthy();
    expect(rowText(within(table).getByRole('row', { name: /Grand total/ }))).toEqual(['143']);
    expect(within(table).getByRole('columnheader', { name: 'Gender' })).toBeTruthy();
  });

  it('a total that includes a hidden count is itself hidden, and the cell never reads 0', async () => {
    const result = run({
      suppressed: true,
      rows: [
        { class: 'Six', gender: 'Boy', students: null, charged: 10 },
        { class: 'Six', gender: 'Girl', students: 38, charged: 20 },
      ],
    });
    await renderEn(<ReportGrouped result={result} layout={layout} view="table" />);
    const table = await screen.findByRole('table');
    const hidden = within(table).getAllByRole('button', {
      name: 'Numbers under 5 are not shown, to protect privacy',
    });
    // The detail cell, the group total and the grand total.
    expect(hidden).toHaveLength(3);
    for (const mark of hidden) expect(mark.textContent).toBe('—');
    expect(within(table).queryByText('38', { selector: 'td' })).toBeTruthy();
    expect(within(table).queryByText('0')).toBeNull();
  });

  it('phone layout is a list of cards with the totals as cards', async () => {
    await renderEn(<ReportGrouped result={run()} layout={layout} caption="Fees" view="cards" />);
    expect(screen.queryByRole('table')).toBeNull();
    const list = await screen.findByRole('list', { name: 'Fees' });
    expect(within(list).getByText('Six — Total')).toBeTruthy();
    expect(within(list).getByText('Grand total')).toBeTruthy();
    expect(within(list).getAllByText('78').length).toBeGreaterThan(0);
  });

  it('says what to change when nobody matches', async () => {
    await renderEn(<ReportGrouped result={run({ rows: [] })} layout={layout} />);
    expect(await screen.findByText('Nobody matches these choices')).toBeTruthy();
  });

  it('is axe clean as a table, as cards and with a hidden count', async () => {
    const hiddenRun = run({
      suppressed: true,
      rows: [{ class: 'Six', gender: 'Boy', students: null, charged: 10 }],
    });
    for (const [result, view] of [
      [run(), 'table'],
      [run(), 'cards'],
      [hiddenRun, 'table'],
    ] as const) {
      const { container, unmount } = await renderEn(
        <ReportGrouped result={result} layout={layout} caption="Fees" view={view} />,
      );
      await screen.findAllByText(/./);
      await expect(container).toHaveNoViolations();
      unmount();
    }
  });
});

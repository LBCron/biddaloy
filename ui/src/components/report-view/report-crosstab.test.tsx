import { act, screen, within } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '../../i18n';
import { expectTabOrder, renderWithProviders } from '../../test';

import { ReportCrosstab } from './report-crosstab';
import type { ReportColumn, ReportLayoutProps, ReportRunResult } from './types';

const dim = (key: string, en: string, bn: string): ReportColumn => ({
  key,
  type: 'TEXT',
  kind: 'dimension',
  label_en: en,
  label_bn: bn,
});
const columns: ReportColumn[] = [
  dim('class', 'Class', 'শ্রেণি'),
  dim('gender', 'Gender', 'লিঙ্গ'),
  dim('religion', 'Religion', 'ধর্ম'),
  {
    key: 'students',
    type: 'NUMBER',
    kind: 'measure',
    label_en: 'Students',
    label_bn: 'ছাত্রছাত্রী',
  },
];
const rows = [
  { class: 'Six', gender: 'Boy', religion: 'Islam', students: 30 },
  { class: 'Six', gender: 'Boy', religion: 'Hindu', students: 10 },
  { class: 'Six', gender: 'Girl', religion: 'Islam', students: 28 },
  { class: 'Six', gender: 'Girl', religion: 'Hindu', students: 10 },
  { class: 'Seven', gender: 'Boy', religion: 'Islam', students: 25 },
  { class: 'Seven', gender: 'Boy', religion: 'Hindu', students: 5 },
  { class: 'Seven', gender: 'Girl', religion: 'Islam', students: 20 },
];
const layout: ReportLayoutProps = {
  rows: ['class'],
  columns: ['gender', 'religion'],
  cell_measure: 'students',
  totals: true,
};

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

const texts = (row: HTMLElement, role: 'cell' | 'columnheader' | 'rowheader') =>
  within(row)
    .queryAllByRole(role)
    .map((c) => c.textContent);

afterEach(() => vi.unstubAllGlobals());

describe('ReportCrosstab table', () => {
  it('nests the header: gender over religion, with a total column', async () => {
    await renderEn(
      <ReportCrosstab result={run()} layout={layout} caption="Students" view="table" />,
    );
    const table = await screen.findByRole('table', { name: 'Students' });
    const [top, second] = table.querySelectorAll('thead tr');
    const topCells = [...top!.querySelectorAll('th')];
    expect(topCells.map((c) => c.textContent)).toEqual(['Class', 'Boy', 'Girl', 'Total']);
    expect(topCells[0]!.getAttribute('rowspan')).toBe('2');
    expect(topCells[1]!.getAttribute('colspan')).toBe('2');
    expect(topCells[1]!.getAttribute('scope')).toBe('colgroup');
    expect(topCells[3]!.getAttribute('rowspan')).toBe('2');
    const leaves = [...second!.querySelectorAll('th')];
    expect(leaves.map((c) => c.textContent)).toEqual(['Islam', 'Hindu', 'Islam', 'Hindu']);
    expect(leaves.every((c) => c.getAttribute('scope') === 'col')).toBe(true);
  });

  it('shows row totals, column totals and the grand total', async () => {
    await renderEn(<ReportCrosstab result={run()} layout={layout} view="table" />);
    const table = await screen.findByRole('table');
    const six = within(table).getByRole('row', { name: /^Six/ });
    expect(texts(six, 'cell')).toEqual(['30', '10', '28', '10', '78']);
    const seven = within(table).getByRole('row', { name: /^Seven/ });
    // No Seven / Girl / Hindu row: a count of nothing reads 0.
    expect(texts(seven, 'cell')).toEqual(['25', '5', '20', '0', '50']);
    const foot = table.querySelector('tfoot tr') as HTMLElement;
    expect(texts(foot, 'rowheader')).toEqual(['Total']);
    expect(texts(foot, 'cell')).toEqual(['55', '15', '48', '10', '128']);
  });

  it('labels totals and digits in Bangla', async () => {
    const view = renderWithProviders(
      <RegionConfigProvider value={REGION_BD_BN}>
        <ReportCrosstab result={run()} layout={layout} view="table" />
      </RegionConfigProvider>,
      { locale: 'bn' },
    );
    await act(async () => {
      await view.localeReady;
    });
    const table = await screen.findByRole('table');
    expect(table.querySelector('thead tr')!.textContent).toContain('মোট');
    expect(table.querySelector('thead tr')!.textContent).toContain('শ্রেণি');
    const foot = table.querySelector('tfoot tr') as HTMLElement;
    expect(texts(foot, 'rowheader')).toEqual(['মোট']);
    expect(texts(foot, 'cell')).toEqual(['৫৫', '১৫', '৪৮', '১০', '১২৮']);
  });

  it('a hidden count hides the totals it is part of and is never 0', async () => {
    const result = run({
      suppressed: true,
      rows: [
        { class: 'Six', gender: 'Boy', religion: 'Islam', students: null },
        { class: 'Six', gender: 'Girl', religion: 'Islam', students: 28 },
      ],
    });
    await renderEn(
      <ReportCrosstab result={result} layout={{ ...layout, columns: ['gender'] }} view="table" />,
    );
    const table = await screen.findByRole('table');
    const six = within(table).getByRole('row', { name: /^Six/ });
    expect(within(six).getAllByRole('button')).toHaveLength(2); // the Boy cell and the row total
    expect(texts(within(six).getAllByRole('cell')[1]!.parentElement!, 'cell')[1]).toBe('28');
    const foot = table.querySelector('tfoot tr') as HTMLElement;
    expect(within(foot).getAllByRole('button')).toHaveLength(2); // Boy column and the grand total
    expect(within(table).queryByText('0')).toBeNull();
  });

  it('works with one column field and with none', async () => {
    const { unmount } = await renderEn(
      <ReportCrosstab result={run()} layout={{ ...layout, columns: ['gender'] }} view="table" />,
    );
    const table = await screen.findByRole('table');
    expect(table.querySelectorAll('thead tr')).toHaveLength(1);
    expect(texts(table.querySelector('tfoot tr') as HTMLElement, 'cell')).toEqual([
      '70',
      '58',
      '128',
    ]);
    unmount();

    await renderEn(
      <ReportCrosstab result={run()} layout={{ ...layout, columns: [] }} view="table" />,
    );
    const plain = await screen.findByRole('table');
    expect(within(plain).getByRole('columnheader', { name: 'Students' })).toBeTruthy();
    expect(texts(within(plain).getByRole('row', { name: /^Six/ }), 'cell')).toEqual(['78', '78']);
  });

  it('has a keyboard-reachable scroll region and sticky first column', async () => {
    await renderEn(
      <ReportCrosstab result={run()} layout={layout} caption="Students" view="table" />,
    );
    const region = await screen.findByRole('region', { name: 'Students' });
    await expectTabOrder([region]);
    expect(within(region).getByRole('rowheader', { name: 'Six' }).className).toContain('sticky');
    expect(within(region).getByRole('columnheader', { name: 'Class' }).className).toContain(
      'sticky',
    );
  });

  it('says what to change when nobody matches', async () => {
    await renderEn(<ReportCrosstab result={run({ rows: [] })} layout={layout} />);
    expect(await screen.findByText('Nobody matches these choices')).toBeTruthy();
  });
});

describe('ReportCrosstab list', () => {
  it('reads one row per line, with the total last', async () => {
    await renderEn(
      <ReportCrosstab result={run()} layout={layout} caption="Students" view="list" />,
    );
    const list = await screen.findByRole('list', { name: 'Students' });
    const items = within(list)
      .getAllByRole('listitem')
      .map((i) => i.textContent);
    expect(items[0]).toBe(
      'Six — Boy › Islam 30, Boy › Hindu 10, Girl › Islam 28, Girl › Hindu 10, Total 78',
    );
    expect(items[1]).toContain('Seven — ');
    expect(items[2]).toBe(
      'Total — Boy › Islam 55, Boy › Hindu 15, Girl › Islam 48, Girl › Hindu 10, Total 128',
    );
  });

  it('reads in Bangla like the ticket example', async () => {
    const view = renderWithProviders(
      <RegionConfigProvider value={REGION_BD_BN}>
        <ReportCrosstab
          result={run({ rows: rows.filter((r) => r.religion === 'Islam') })}
          layout={{ ...layout, columns: ['gender'] }}
          view="list"
        />
      </RegionConfigProvider>,
      { locale: 'bn' },
    );
    await act(async () => {
      await view.localeReady;
    });
    const items = (await screen.findAllByRole('listitem')).map((i) => i.textContent);
    expect(items[0]).toBe('Six — Boy ৩০, Girl ২৮, মোট ৫৮');
  });

  it('a table too wide for the screen opens as a list, with a switch to the table and back', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const { user } = await renderEn(<ReportCrosstab result={run()} layout={layout} />);
    expect(await screen.findByRole('list')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'See as table' }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'See as list' }));
    expect(screen.getByRole('list')).toBeTruthy();
  });

  it('on a wide screen there is no switch and the table shows', async () => {
    await renderEn(<ReportCrosstab result={run()} layout={layout} />);
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('explains a dash in plain words', async () => {
    const result = run({
      suppressed: true,
      rows: [{ class: 'Six', gender: 'Boy', religion: 'Islam', students: null }],
    });
    await renderEn(<ReportCrosstab result={result} layout={layout} view="list" />);
    expect(
      await screen.findByText('Numbers under 5 are not shown, to protect privacy'),
    ).toBeTruthy();
    expect((await screen.findAllByRole('listitem'))[0]!.textContent).toContain('Boy › Islam —');
  });
});

describe('ReportCrosstab accessibility', () => {
  it('is axe clean as a table, a list and with hidden counts', async () => {
    const hidden = run({
      suppressed: true,
      rows: [
        { class: 'Six', gender: 'Boy', religion: 'Islam', students: null },
        { class: 'Six', gender: 'Girl', religion: 'Islam', students: 28 },
      ],
    });
    for (const [result, view] of [
      [run(), 'table'],
      [run(), 'list'],
      [hidden, 'table'],
      [hidden, 'list'],
    ] as const) {
      const { container, unmount } = await renderEn(
        <ReportCrosstab result={result} layout={layout} caption="Students" view={view} />,
      );
      await screen.findAllByText(/./);
      await expect(container).toHaveNoViolations();
      unmount();
    }
  });
});

import { act, screen, within } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '../../i18n';
import { expectKeyboardOperable, renderWithProviders } from '../../test';

import { ReportChart } from './report-chart';
import type { ReportColumn, ReportLayoutProps, ReportRunResult } from './types';

const columns: ReportColumn[] = [
  { key: 'class', type: 'TEXT', kind: 'dimension', label_en: 'Class', label_bn: 'শ্রেণি' },
  { key: 'boys', type: 'NUMBER', kind: 'measure', label_en: 'Boys', label_bn: 'ছাত্র' },
  { key: 'girls', type: 'NUMBER', kind: 'measure', label_en: 'Girls', label_bn: 'ছাত্রী' },
];
const rows = [
  { class: 'Six', boys: 40, girls: 38 },
  { class: 'Seven', boys: 35, girls: 30 },
  { class: 'Eight', boys: 20, girls: 25 },
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

const bar: ReportLayoutProps = { chart: { kind: 'bar', x: 'class', y: ['boys'] } };
const line: ReportLayoutProps = { chart: { kind: 'line', x: 'class', y: ['boys'] } };

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

const SUMMARY = 'Highest: Six (40). Lowest: Eight (20).';

describe('ReportChart', () => {
  it('draws columns with a text alternative and a switch to the same numbers as a table', async () => {
    const { user } = await renderEn(
      <ReportChart result={run()} layout={bar} caption="Boys by class" />,
    );
    // Text alternative: the chart is named by the summary, which is also on screen.
    expect(await screen.findByRole('img', { name: SUMMARY })).toBeTruthy();
    expect(screen.getAllByText(SUMMARY).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'See as table' }));
    const table = screen.getByRole('table', { name: 'Boys by class' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Class', 'Boys']);
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual(['Six40', 'Seven35', 'Eight20']);
    expect(screen.queryByRole('img')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'See as chart' }));
    expect(screen.getByRole('img', { name: SUMMARY })).toBeTruthy();
  });

  it('can open on the table', async () => {
    await renderEn(<ReportChart result={run()} layout={bar} defaultView="table" />);
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('stacks two series and lists both in the table', async () => {
    const layout: ReportLayoutProps = { chart: { kind: 'bar', x: 'class', y: ['boys', 'girls'] } };
    const { user } = await renderEn(<ReportChart result={run()} layout={layout} />);
    expect(await screen.findByText('Boys')).toBeTruthy(); // legend
    expect(screen.getByText('Girls')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'See as table' }));
    expect(screen.getByRole('columnheader', { name: 'Girls' })).toBeTruthy();
  });

  it('draws a line per series', async () => {
    const layout: ReportLayoutProps = { chart: { kind: 'line', x: 'class', y: ['boys', 'girls'] } };
    await renderEn(<ReportChart result={run()} layout={layout} />);
    const charts = await screen.findAllByRole('img');
    expect(charts).toHaveLength(2);
    expect(charts[0]!.getAttribute('aria-label')).toBe(`Boys: ${SUMMARY}`);
    expect(charts[1]!.getAttribute('aria-label')).toBe(
      'Girls: Highest: Six (38). Lowest: Eight (25).',
    );
    const single = await renderEn(<ReportChart result={run()} layout={line} />);
    expect(within(single.container).getAllByRole('img')).toHaveLength(1);
  });

  it('formats in Bangla digits and words', async () => {
    const view = renderWithProviders(
      <RegionConfigProvider value={REGION_BD_BN}>
        <ReportChart result={run()} layout={bar} />
      </RegionConfigProvider>,
      { locale: 'bn' },
    );
    await act(async () => {
      await view.localeReady;
    });
    expect(
      await screen.findByRole('img', {
        name: 'সবচেয়ে বেশি: Six (৪০)। সবচেয়ে কম: Eight (২০)।',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ছক হিসেবে দেখুন' })).toBeTruthy();
  });

  it('never draws a hidden count as 0: the table says dash and the summary says why', async () => {
    const result = run({
      suppressed: true,
      rows: [
        { class: 'Six', boys: null, girls: 38 },
        { class: 'Seven', boys: 35, girls: 30 },
        { class: 'Eight', boys: 20, girls: 25 },
      ],
    });
    const { user } = await renderEn(<ReportChart result={result} layout={bar} />);
    const note = 'Numbers under 5 are not shown, to protect privacy';
    expect((await screen.findByRole('img')).getAttribute('aria-label')).toContain(note);
    await user.click(screen.getByRole('button', { name: 'See as table' }));
    const six = screen.getByRole('row', { name: /^Six/ });
    expect(within(six).getByRole('cell').textContent).toBe('—');

    // A line leaves the point out instead of dropping it to 0.
    const { container } = await renderEn(<ReportChart result={result} layout={line} />);
    expect(container.querySelectorAll('[data-x-label]')).toHaveLength(2);
  });

  it('says what to change when there is nothing to draw', async () => {
    await renderEn(<ReportChart result={run({ rows: [] })} layout={bar} />);
    expect(await screen.findByText('Nobody matches these choices')).toBeTruthy();
    await renderEn(<ReportChart result={run()} layout={{}} />);
    expect(await screen.findAllByText('Nobody matches these choices')).toHaveLength(2);
  });

  it('the switch is keyboard operable and the page is axe clean in both views', async () => {
    const { container, user } = await renderEn(<ReportChart result={run()} layout={bar} />);
    const toggle = await screen.findByRole('button', { name: 'See as table' });
    await expect(container).toHaveNoViolations();
    await expectKeyboardOperable(toggle, { keys: ['Enter', 'Space'] });
    // Two activations (Enter, Space) land back on the chart.
    expect(screen.getByRole('img')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'See as table' }));
    await expect(container).toHaveNoViolations();
  });
});

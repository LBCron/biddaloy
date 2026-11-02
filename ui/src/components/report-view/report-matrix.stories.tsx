/**
 * [8.15.27] Stories for `ReportCrosstab` (the "table of counts") and `ReportChart`. Every story
 * reads from the toolbar's locale, so the Bangla and English stories pin it with `globals`.
 *
 * Categories: default (Bangla, English), empty, phone (a table too wide opens as a list), hidden
 * counts, chart and its table view, RTL. No loading state (the renderers draw rows that already
 * arrived), no error state (the runner screen owns `ErrorState`, [8.15.29]), no disabled state
 * (the only control is the table/list switch, which is never disabled).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../../.storybook/rtl-decorator';
import { RegionConfigProvider } from '../../i18n';

import { ReportChart } from './report-chart';
import { ReportCrosstab } from './report-crosstab';
import type { ReportColumn, ReportLayoutProps, ReportRunResult } from './types';

const meta: Meta = {
  title: 'Components/ReportMatrix',
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <RegionConfigProvider>
        <div className="max-w-3xl">
          <Story />
        </div>
      </RegionConfigProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj;

const dim = (key: string, label_en: string, label_bn: string): ReportColumn => ({
  key,
  label_en,
  label_bn,
  type: 'TEXT',
  kind: 'dimension',
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

// The BANBEIS shape: class by gender by religion. Gender and religion values are the school's data.
const rows = ['Six', 'Seven', 'Eight'].flatMap((cls, c) =>
  ['ছাত্র', 'ছাত্রী'].flatMap((gender, g) =>
    ['ইসলাম', 'হিন্দু'].map((religion, r) => ({
      class: cls,
      gender,
      religion,
      students: 40 - c * 4 - g * 3 - r * 25 + (r === 1 ? 2 : 0),
    })),
  ),
);

function result(overrides: Partial<ReportRunResult> = {}): ReportRunResult {
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
    run_id: 'story-run',
    ...overrides,
  };
}

const crosstab: ReportLayoutProps = {
  rows: ['class'],
  columns: ['gender', 'religion'],
  cell_measure: 'students',
  totals: true,
};
const hiddenRun = result({
  suppressed: true,
  rows: rows.map((r, i) => (i === 3 ? { ...r, students: null } : r)),
});
const empty = result({ rows: [], total_rows: 0 });

const chartRows = ['Six', 'Seven', 'Eight', 'Nine', 'Ten'].map((cls, i) => ({
  class: cls,
  boys: 40 - i * 3,
  girls: 38 - i * 2,
}));
const chartColumns: ReportColumn[] = [
  dim('class', 'Class', 'শ্রেণি'),
  { key: 'boys', type: 'NUMBER', kind: 'measure', label_en: 'Boys', label_bn: 'ছাত্র' },
  { key: 'girls', type: 'NUMBER', kind: 'measure', label_en: 'Girls', label_bn: 'ছাত্রী' },
];
const chartRun = result({ columns: chartColumns, rows: chartRows, total_rows: chartRows.length });

export const CrosstabBangla: Story = {
  globals: { locale: 'bn' },
  render: () => (
    <ReportCrosstab
      result={result()}
      layout={crosstab}
      caption="ছাত্রছাত্রীর সংখ্যা"
      view="table"
    />
  ),
};
export const CrosstabEnglish: Story = {
  globals: { locale: 'en' },
  render: () => (
    <ReportCrosstab result={result()} layout={crosstab} caption="Students" view="table" />
  ),
};
export const CrosstabHiddenCounts: Story = {
  globals: { locale: 'bn' },
  render: () => (
    <ReportCrosstab
      result={hiddenRun}
      layout={crosstab}
      caption="ছাত্রছাত্রীর সংখ্যা"
      view="table"
    />
  ),
};
/** In a 390 px box the table would need sideways scrolling, so it opens as a list. */
export const CrosstabPhone: Story = {
  globals: { locale: 'bn' },
  decorators: [
    (Story) => (
      <div className="w-[390px] max-w-full">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <ReportCrosstab result={result()} layout={crosstab} caption="ছাত্রছাত্রীর সংখ্যা" />
  ),
};
export const CrosstabListEnglish: Story = {
  globals: { locale: 'en' },
  render: () => (
    <ReportCrosstab result={result()} layout={crosstab} caption="Students" view="list" />
  ),
};
export const CrosstabEmpty: Story = {
  globals: { locale: 'bn' },
  render: () => <ReportCrosstab result={empty} layout={crosstab} />,
};

export const ChartBars: Story = {
  globals: { locale: 'bn' },
  render: () => (
    <ReportChart
      result={chartRun}
      layout={{ chart: { kind: 'bar', x: 'class', y: ['boys'] } }}
      caption="শ্রেণিভিত্তিক ছাত্র"
    />
  ),
};
export const ChartStackedEnglish: Story = {
  globals: { locale: 'en' },
  render: () => (
    <ReportChart
      result={chartRun}
      layout={{ chart: { kind: 'bar', x: 'class', y: ['boys', 'girls'] } }}
      caption="Students by class"
    />
  ),
};
export const ChartLine: Story = {
  globals: { locale: 'bn' },
  render: () => (
    <ReportChart
      result={chartRun}
      layout={{ chart: { kind: 'line', x: 'class', y: ['boys', 'girls'] } }}
      caption="শ্রেণিভিত্তিক ছাত্রছাত্রী"
    />
  ),
};
/** The text view of the same numbers, reached with "ছক হিসেবে দেখুন". */
export const ChartAsTable: Story = {
  globals: { locale: 'bn' },
  render: () => (
    <ReportChart
      result={chartRun}
      layout={{ chart: { kind: 'bar', x: 'class', y: ['boys', 'girls'] } }}
      caption="শ্রেণিভিত্তিক ছাত্রছাত্রী"
      defaultView="table"
    />
  ),
};
export const ChartEmpty: Story = {
  globals: { locale: 'bn' },
  render: () => (
    <ReportChart
      result={result({ columns: chartColumns, rows: [] })}
      layout={{ chart: { kind: 'bar', x: 'class', y: ['boys'] } }}
    />
  ),
};
export const RightToLeft: Story = {
  decorators: [rtlDecorator],
  render: () => (
    <ReportCrosstab result={result()} layout={crosstab} caption="Students" view="table" />
  ),
};

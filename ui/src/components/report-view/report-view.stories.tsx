/**
 * [8.15.26] Stories for `ReportTable` and `ReportGrouped`. Every story reads from the toolbar's
 * locale, so the Bangla and English stories pin it with `globals`.
 *
 * Categories: default (Bangla, English), loading (table only: the grouped view is drawn from rows
 * that already arrived, so it has no loading state of its own), empty, phone (cards), hidden
 * counts, RTL. There is no disabled state (nothing here is a control) and no error state: a failed
 * run is the runner screen's `ErrorState` ([8.15.29]), not this renderer's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../../.storybook/rtl-decorator';
import { RegionConfigProvider } from '../../i18n';

import { ReportGrouped } from './report-grouped';
import { ReportTable } from './report-table';
import type { ReportColumn, ReportLayoutProps, ReportRunResult } from './types';

const meta: Meta = {
  title: 'Components/ReportView',
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

const columns: ReportColumn[] = [
  { key: 'class', type: 'TEXT', kind: 'dimension', label_en: 'Class', label_bn: 'শ্রেণি' },
  { key: 'section', type: 'TEXT', kind: 'dimension', label_en: 'Section', label_bn: 'শাখা' },
  {
    key: 'students',
    type: 'NUMBER',
    kind: 'measure',
    label_en: 'Students',
    label_bn: 'ছাত্রছাত্রী',
  },
  { key: 'charged', type: 'MONEY', kind: 'measure', label_en: 'Charged', label_bn: 'বিল' },
  { key: 'paid', type: 'MONEY', kind: 'measure', label_en: 'Paid', label_bn: 'জমা' },
];

// Three groups. The class names are data, so they stay as the school wrote them.
const rows = [
  { class: 'Six', section: 'A', students: 40, charged: 120000, paid: 98000.5 },
  { class: 'Six', section: 'B', students: 38, charged: 114000, paid: 100000 },
  { class: 'Seven', section: 'A', students: 35, charged: 122500, paid: 90000 },
  { class: 'Seven', section: 'B', students: 30, charged: 105000, paid: 105000 },
  { class: 'Eight', section: 'A', students: 28, charged: 112000, paid: 56000.25 },
  { class: 'Eight', section: 'B', students: 25, charged: 100000, paid: 75000 },
];

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

const hiddenRun = result({
  suppressed: true,
  rows: rows.map((r, i) => (i === 1 || i === 4 ? { ...r, students: null } : r)),
});
const grouped: ReportLayoutProps = { group_by: ['class'], subtotals: true, totals: true };
const empty = result({ rows: [], total_rows: 0 });

export const TableBangla: Story = {
  globals: { locale: 'bn' },
  render: () => <ReportTable result={result()} caption="ফি-র হিসাব" layout="table" />,
};
export const TableEnglish: Story = {
  globals: { locale: 'en' },
  render: () => <ReportTable result={result()} caption="Fee summary" layout="table" />,
};
export const TableHiddenCounts: Story = {
  globals: { locale: 'bn' },
  render: () => <ReportTable result={hiddenRun} caption="ফি-র হিসাব" layout="table" />,
};
export const TablePhoneCards: Story = {
  globals: { locale: 'bn' },
  decorators: [
    (Story) => (
      <div className="w-[390px] max-w-full">
        <Story />
      </div>
    ),
  ],
  render: () => <ReportTable result={result()} caption="ফি-র হিসাব" />,
};
export const TableLoading: Story = {
  render: () => <ReportTable result={empty} layout="table" loading />,
};
export const TableEmpty: Story = {
  globals: { locale: 'bn' },
  render: () => <ReportTable result={empty} layout="table" />,
};

export const GroupedBangla: Story = {
  globals: { locale: 'bn' },
  render: () => (
    <ReportGrouped result={result()} layout={grouped} caption="ফি-র হিসাব" view="table" />
  ),
};
export const GroupedEnglish: Story = {
  globals: { locale: 'en' },
  render: () => (
    <ReportGrouped result={result()} layout={grouped} caption="Fee summary" view="table" />
  ),
};
export const GroupedHiddenCounts: Story = {
  globals: { locale: 'bn' },
  render: () => (
    <ReportGrouped result={hiddenRun} layout={grouped} caption="ফি-র হিসাব" view="table" />
  ),
};
export const GroupedPhoneCards: Story = {
  globals: { locale: 'bn' },
  decorators: [
    (Story) => (
      <div className="w-[390px] max-w-full">
        <Story />
      </div>
    ),
  ],
  render: () => <ReportGrouped result={result()} layout={grouped} caption="ফি-র হিসাব" />,
};
export const GroupedEmpty: Story = {
  globals: { locale: 'bn' },
  render: () => <ReportGrouped result={empty} layout={grouped} />,
};
export const RightToLeft: Story = {
  decorators: [rtlDecorator],
  render: () => (
    <ReportGrouped result={result()} layout={grouped} caption="Fee summary" view="table" />
  ),
};

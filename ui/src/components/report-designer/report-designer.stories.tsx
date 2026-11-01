/**
 * [8.15.39] Stories for the report designer's building blocks: `FieldPicker`, `FilterBuilder`,
 * `LayoutSwitcher`, `FormatRulesEditor` and `ParamEditor`, plus one `Designer` story that puts them
 * together the way the designer screen ([8.15.40]) will. One file for all five, since they are one
 * set of pieces that share a fixture and one list of words (`designer.*` in `reports.json`).
 *
 * Categories: default (Bangla first, English), empty (nothing picked, no conditions, no match),
 * error (a typed value that is not a number, said beside the box), phone, RTL. There is no
 * loading story (props only: nothing is fetched here, the screen shows its own skeleton while
 * `GET /reports/meta` loads) and no disabled story (every control here is live while a person is
 * designing; a report they may not edit never opens the designer).
 *
 * Every story reads its words from the toolbar's locale, so the Bangla stories pin it with
 * `globals`. The `@storybook/addon-a11y` panel runs axe on each one.
 */
import type { ReportFilter, ReportFormatRule, ReportParameter } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../../.storybook/rtl-decorator';
import { REGION_BD_BN, REGION_BD_EN } from '../../i18n/region-config';
import { RegionConfigProvider } from '../../i18n/region-config-provider';

import {
  EMPTY_PICKS,
  FieldPicker,
  fieldsFromMeta,
  type FieldPickerValue,
  type MetaAreaLike,
} from './field-picker';
import { FilterBuilder, type FilterBuilderValue } from './filter-builder';
import { FormatRulesEditor } from './format-rules-editor';
import { useDesignerLabels } from './labels';
import { LayoutSwitcher } from './layout-switcher';
import { ParamEditor } from './param-editor';
import { suggestLayout } from './suggest-layout';

const base = { sensitivity: 'PUBLIC', filterable: true, groupable: true };

/** The shape `GET /reports/meta` sends for the fees area, trimmed to what the stories need. */
const feesArea: MetaAreaLike = {
  key: 'FEES',
  fields: [
    {
      ...base,
      key: 'name',
      label_en: 'Student name',
      label_bn: 'ছাত্রের নাম',
      type: 'TEXT',
      sensitivity: 'PERSONAL',
      groupable: false,
    },
    {
      ...base,
      key: 'registration_number',
      label_en: 'Registration number',
      label_bn: 'রেজিস্ট্রেশন নম্বর',
      type: 'TEXT',
      groupable: false,
    },
    { ...base, key: 'roll', label_en: 'Roll', label_bn: 'রোল', type: 'NUMBER' },
    { ...base, key: 'class', label_en: 'Class', label_bn: 'শ্রেণি', type: 'TEXT' },
    { ...base, key: 'section', label_en: 'Section', label_bn: 'শাখা', type: 'TEXT' },
    {
      ...base,
      key: 'guardian_name',
      label_en: 'Guardian name',
      label_bn: 'অভিভাবকের নাম',
      type: 'TEXT',
      sensitivity: 'CONTACT',
      groupable: false,
    },
    {
      ...base,
      key: 'guardian_phone',
      label_en: 'Guardian phone',
      label_bn: 'অভিভাবকের ফোন',
      type: 'TEXT',
      sensitivity: 'CONTACT',
      groupable: false,
    },
    { ...base, key: 'fee_name', label_en: 'Fee', label_bn: 'ফি', type: 'TEXT' },
    { ...base, key: 'due_date', label_en: 'Due date', label_bn: 'শেষ তারিখ', type: 'DATE' },
    {
      ...base,
      key: 'status',
      label_en: 'Status',
      label_bn: 'অবস্থা',
      type: 'ENUM',
      enum_values: ['PAID', 'PARTIALLY_PAID', 'OVERDUE'],
    },
  ],
  measures: [
    {
      key: 'bills',
      label_en: 'Bills',
      label_bn: 'বিলের সংখ্যা',
      type: 'NUMBER',
      sensitivity: 'PUBLIC',
    },
    {
      key: 'billed',
      label_en: 'Charged',
      label_bn: 'বিল',
      type: 'MONEY',
      sensitivity: 'FINANCIAL',
    },
    { key: 'paid', label_en: 'Paid', label_bn: 'জমা', type: 'MONEY', sensitivity: 'FINANCIAL' },
    {
      key: 'outstanding',
      label_en: 'Still owed',
      label_bn: 'বাকি',
      type: 'MONEY',
      sensitivity: 'FINANCIAL',
    },
  ],
};
const fields = fieldsFromMeta(feesArea);

const STATUS_NAMES: Record<string, { label_en: string; label_bn: string }> = {
  PAID: { label_en: 'Paid', label_bn: 'জমা' },
  PARTIALLY_PAID: { label_en: 'Part paid', label_bn: 'আংশিক জমা' },
  OVERDUE: { label_en: 'Overdue', label_bn: 'মেয়াদ পেরিয়েছে' },
};
const enumLabel = (_field: string, value: string) =>
  STATUS_NAMES[value] ?? { label_en: value, label_bn: value };

function PickerDemo({
  initial = EMPTY_PICKS,
  hideFields = false,
}: {
  initial?: FieldPickerValue;
  hideFields?: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  const labels = useDesignerLabels();
  return (
    <FieldPicker
      fields={hideFields ? [] : fields}
      value={value}
      onChange={setValue}
      labels={labels.picker}
    />
  );
}

function FilterDemo({
  initial = [],
  parameters = [],
}: {
  initial?: ReportFilter[];
  parameters?: ReportParameter[];
}) {
  const [value, setValue] = React.useState<FilterBuilderValue>({ filters: initial, parameters });
  const labels = useDesignerLabels();
  return (
    <FilterBuilder
      {...value}
      fields={fields}
      onChange={setValue}
      labels={labels.filter}
      enumLabel={enumLabel}
    />
  );
}

const bad: ReportFormatRule = {
  field: 'outstanding',
  when: { field: 'outstanding', op: 'GT', value: 5000 },
  style: { tone: 'bad' },
};

function FormatDemo({ initial = [bad] }: { initial?: ReportFormatRule[] }) {
  const [rules, setRules] = React.useState(initial);
  const labels = useDesignerLabels();
  return (
    <FormatRulesEditor
      rules={rules}
      fields={fields}
      onChange={setRules}
      labels={labels.format}
      enumLabel={enumLabel}
    />
  );
}

const classQuestion: ReportParameter = {
  key: 'p_class',
  type: 'CLASS',
  label_en: 'Class',
  label_bn: 'শ্রেণি',
  required: false,
};
const sectionQuestion: ReportParameter = {
  key: 'p_section',
  type: 'SECTION',
  label_en: 'Section',
  label_bn: 'শাখা',
  required: false,
};

function ParamDemo() {
  const [value, setValue] = React.useState(sectionQuestion);
  const labels = useDesignerLabels();
  return (
    <ParamEditor
      parameter={value}
      onChange={setValue}
      siblings={[classQuestion, sectionQuestion]}
      labels={labels.filter.params}
    />
  );
}

function SwitcherDemo({ picks }: { picks: Parameters<typeof suggestLayout>[0] }) {
  const suggestion = suggestLayout(picks);
  const [value, setValue] = React.useState(suggestion.layout);
  const labels = useDesignerLabels();
  return (
    <LayoutSwitcher
      value={value}
      onChange={setValue}
      suggestion={suggestion}
      labels={labels.layout}
    />
  );
}

/** The pieces together, as the designer screen will lay them out. */
function Designer() {
  const [picks, setPicks] = React.useState<FieldPickerValue>({
    show: [],
    split: ['class', 'section'],
    count: ['outstanding'],
  });
  const [filters, setFilters] = React.useState<FilterBuilderValue>({
    filters: [{ field: 'class', op: 'IN', value: ['6', '7'] }],
    parameters: [],
  });
  const [rules, setRules] = React.useState<ReportFormatRule[]>([bad]);
  const labels = useDesignerLabels();
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const suggestion = suggestLayout({
    splitBy: picks.split.map((key) => ({ key, isDate: byKey.get(key)?.type === 'DATE' })),
    counts: picks.count,
  });
  const [layout, setLayout] = React.useState(suggestion.layout);
  // Until the person chooses another layout, the picture follows the suggestion.
  const [manual, setManual] = React.useState(false);
  const shown = manual ? layout : suggestion.layout;
  return (
    <div className="flex flex-col gap-8">
      <FieldPicker fields={fields} value={picks} onChange={setPicks} labels={labels.picker} />
      <FilterBuilder
        {...filters}
        fields={fields}
        onChange={setFilters}
        labels={labels.filter}
        enumLabel={enumLabel}
      />
      <LayoutSwitcher
        value={shown}
        suggestion={suggestion}
        onChange={(next) => {
          setLayout(next);
          setManual(next !== suggestion.layout);
        }}
        labels={labels.layout}
      />
      <FormatRulesEditor
        rules={rules}
        fields={fields}
        onChange={setRules}
        labels={labels.format}
        enumLabel={enumLabel}
      />
    </div>
  );
}

const meta: Meta = {
  title: 'Components/ReportDesigner',
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <RegionConfigProvider value={REGION_BD_EN}>
        <div className="max-w-4xl p-4">
          <Story />
        </div>
      </RegionConfigProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj;

const bangla: Pick<Story, 'globals' | 'decorators'> = {
  globals: { locale: 'bn' },
  decorators: [
    (Story) => (
      <RegionConfigProvider value={REGION_BD_BN}>
        <div className="max-w-4xl p-4">
          <Story />
        </div>
      </RegionConfigProvider>
    ),
  ],
};

// ---- FieldPicker -------------------------------------------------------------------------------

/** Fields by everyday topic; each goes into a tray. A count or an amount can only be counted. */
export const FieldPickerDefault: Story = { render: () => <PickerDemo /> };

export const FieldPickerBangla: Story = { ...bangla, render: () => <PickerDemo /> };

export const FieldPickerPicked: Story = {
  render: () => (
    <PickerDemo initial={{ show: ['name', 'class'], split: ['class'], count: ['outstanding'] }} />
  ),
};

/** Nothing to pick from: the screen has not got the fields yet, or the area has none. */
export const FieldPickerEmpty: Story = { render: () => <PickerDemo hideFields /> };

/** Typing finds a field by its Bangla or English name; no match says so in words. */
export const FieldPickerSearch: Story = {
  render: () => <PickerDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('searchbox'), 'zzz');
    await expect(await canvas.findByText('Nothing found. Try another word.')).toBeTruthy();
  },
};

export const FieldPickerPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <PickerDemo />,
};

export const FieldPickerRtl: Story = { decorators: [rtlDecorator], render: () => <PickerDemo /> };

// ---- FilterBuilder -----------------------------------------------------------------------------

export const FilterBuilderDefault: Story = {
  render: () => <FilterDemo initial={[{ field: 'class', op: 'IN', value: ['6', '7'] }]} />,
};

export const FilterBuilderBangla: Story = {
  ...bangla,
  render: () => <FilterDemo initial={[{ field: 'class', op: 'IN', value: ['6', '7'] }]} />,
};

export const FilterBuilderEmpty: Story = { render: () => <FilterDemo /> };

/** A condition turned into a question: its value gives way to the question's own editor. */
export const FilterBuilderAskWhenRunning: Story = {
  render: () => (
    <FilterDemo
      initial={[{ field: 'class', op: 'IN', value: { param: 'p_class' } }]}
      parameters={[classQuestion]}
    />
  ),
};

/** A typed value that is not a number is named beside the box, not in a toast. */
export const FilterBuilderNotANumber: Story = {
  render: () => <FilterDemo initial={[{ field: 'roll', op: 'GT' }]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Value' }), 'abc');
    await expect(await canvas.findByText('Write a number')).toBeTruthy();
  },
};

export const FilterBuilderPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <FilterDemo initial={[{ field: 'class', op: 'IN', value: ['6', '7'] }]} />,
};

export const FilterBuilderRtl: Story = {
  decorators: [rtlDecorator],
  render: () => <FilterDemo initial={[{ field: 'class', op: 'IN', value: ['6', '7'] }]} />,
};

// ---- LayoutSwitcher ----------------------------------------------------------------------------

const cls = { key: 'class', isDate: false };
const section = { key: 'section', isDate: false };

export const LayoutSwitcherTableOfCounts: Story = {
  render: () => <SwitcherDemo picks={{ splitBy: [cls, section], counts: ['bills'] }} />,
};

export const LayoutSwitcherBangla: Story = {
  ...bangla,
  render: () => <SwitcherDemo picks={{ splitBy: [cls, section], counts: ['bills'] }} />,
};

export const LayoutSwitcherNothingSplit: Story = {
  render: () => <SwitcherDemo picks={{ splitBy: [], counts: [] }} />,
};

export const LayoutSwitcherChart: Story = {
  render: () => (
    <SwitcherDemo picks={{ splitBy: [{ key: 'due_date', isDate: true }], counts: ['billed'] }} />
  ),
};

export const LayoutSwitcherPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <SwitcherDemo picks={{ splitBy: [cls], counts: ['bills'] }} />,
};

export const LayoutSwitcherRtl: Story = {
  decorators: [rtlDecorator],
  render: () => <SwitcherDemo picks={{ splitBy: [cls, section], counts: ['bills'] }} />,
};

// ---- FormatRulesEditor -------------------------------------------------------------------------

export const FormatRulesDefault: Story = { render: () => <FormatDemo /> };

export const FormatRulesBangla: Story = { ...bangla, render: () => <FormatDemo /> };

export const FormatRulesEmpty: Story = { render: () => <FormatDemo initial={[]} /> };

/** Four tones, each with its own icon and word. Grey-scale proves the icon carries the meaning. */
export const FormatRulesEveryTone: Story = {
  decorators: [
    (Story) => (
      <div style={{ filter: 'grayscale(1)' }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <FormatDemo
      initial={(['good', 'warn', 'bad', 'muted'] as const).map((tone) => ({
        ...bad,
        style: { tone },
      }))}
    />
  ),
};

export const FormatRulesPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <FormatDemo />,
};

export const FormatRulesRtl: Story = { decorators: [rtlDecorator], render: () => <FormatDemo /> };

// ---- ParamEditor -------------------------------------------------------------------------------

export const ParamEditorDefault: Story = { render: () => <ParamDemo /> };

export const ParamEditorBangla: Story = { ...bangla, render: () => <ParamDemo /> };

export const ParamEditorRtl: Story = { decorators: [rtlDecorator], render: () => <ParamDemo /> };

// ---- All together ------------------------------------------------------------------------------

export const DesignerBangla: Story = { ...bangla, render: () => <Designer /> };

export const DesignerEnglish: Story = { render: () => <Designer /> };

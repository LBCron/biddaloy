/**
 * [8.15.28] Stories for `ReportPrompts` and `PromptSummary`. Covered: default (desktop, the prompts
 * of a student list), collapsed (the one-line summary), required (a class that must be chosen),
 * running (the report is on its way), phone (the bottom sheet), Bangla, RTL.
 * There is no empty or error story: the prompts have no data of their own to be empty, and a failed
 * run is the runner screen's message, not this form's. "Disabled" is the running story.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { REGION_BD_BN, REGION_BD_EN } from '../i18n/region-config';
import { RegionConfigProvider } from '../i18n/region-config-provider';

import {
  defaultPromptValues,
  PromptSummary,
  ReportPrompts,
  type PromptChoices,
  type PromptParameter,
  type PromptValues,
} from './report-prompts';

const choices: PromptChoices = {
  classes: [{ name: 'Class 6' }, { name: 'Class 7' }, { name: 'Class 8' }],
  sections: [
    { name: 'A', className: 'Class 6' },
    { name: 'B', className: 'Class 6' },
    { name: 'A', className: 'Class 7' },
  ],
  academicYears: [{ name: '2025' }, { name: '2026', isCurrent: true }],
};

const parameters: PromptParameter[] = [
  {
    key: 'year',
    type: 'ACADEMIC_YEAR',
    label_en: 'Academic year',
    label_bn: 'শিক্ষাবর্ষ',
    required: true,
  },
  { key: 'class', type: 'CLASS', label_en: 'Class', label_bn: 'শ্রেণি', required: false },
  {
    key: 'section',
    type: 'SECTION',
    label_en: 'Section',
    label_bn: 'শাখা',
    required: false,
    depends_on: 'class',
  },
];

interface PlaygroundProps {
  parameters?: PromptParameter[];
  startOpen?: boolean;
  running?: boolean;
  initial?: PromptValues;
}

function Playground({
  parameters: params = parameters,
  startOpen = true,
  running = false,
  initial,
}: PlaygroundProps) {
  const [value, setValue] = React.useState<PromptValues>(
    initial ?? defaultPromptValues(params, choices),
  );
  const [open, setOpen] = React.useState(startOpen);
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <PromptSummary
        parameters={params}
        value={value}
        expanded={open}
        onToggle={() => setOpen((o) => !o)}
      />
      <ReportPrompts
        parameters={params}
        value={value}
        onChange={setValue}
        onRun={() => setOpen(false)}
        choices={choices}
        running={running}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

const meta: Meta<typeof Playground> = {
  title: 'Components/ReportPrompts',
  component: Playground,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <RegionConfigProvider value={REGION_BD_EN}>
        <div className="min-h-64 p-4">
          <Story />
        </div>
      </RegionConfigProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Playground>;

/** Opened: every prompt has an answer already, so "Show report" works at once. */
export const Default: Story = {};

/** Collapsed to the line the runner shows above a result; press it to change the answers. */
export const Collapsed: Story = {
  args: { startOpen: false, initial: { year: '2026', class: ['Class 6'], section: [] } },
};

/** A class that must be chosen: pressing the button names what is missing, beside the field. */
export const RequiredClass: Story = {
  args: {
    parameters: [{ ...parameters[1]!, required: true }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Show report' }));
    await expect(await canvas.findByText('Pick a class')).toBeTruthy();
  },
};

/** The report is on its way: the button is busy and a second press does nothing. */
export const Running: Story = { args: { running: true } };

/** On a phone the opened prompts are a bottom sheet. */
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

export const Bangla: Story = {
  globals: { locale: 'bn' },
  decorators: [
    (Story) => (
      <RegionConfigProvider value={REGION_BD_BN}>
        <Story />
      </RegionConfigProvider>
    ),
  ],
};

export const RightToLeft: Story = { decorators: [rtlDecorator] };

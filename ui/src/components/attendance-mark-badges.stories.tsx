import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { AttendanceMarkBadges } from './attendance-mark-badges';
import { TooltipProvider } from './tooltip';

const meta: Meta<typeof AttendanceMarkBadges> = {
  title: 'Components/AttendanceMarkBadges',
  component: AttendanceMarkBadges,
  tags: ['autodocs'],
  args: {
    scannedLabel: (time: string) => `Scanned ${time}`,
    scannedHint: 'A card reader marked this row',
    fromSheetLabel: 'From sheet',
    fromSheetHint: 'This row came from an uploaded sheet',
  },
  decorators: [
    (StoryFn) => (
      <TooltipProvider>
        <StoryFn />
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AttendanceMarkBadges>;

export const Scanned: Story = { args: { scanned_at: '2026-11-02T01:55:00.000Z' } };
export const FromSheet: Story = { args: { source: 'IMPORT' } };
export const Both: Story = {
  args: { scanned_at: '2026-11-02T01:55:00.000Z', source: 'IMPORT' },
};
export const Neither: Story = { args: { scanned_at: null, source: 'MANUAL' } };
export const PhoneWidth: Story = {
  args: { scanned_at: '2026-11-02T01:55:00.000Z', source: 'IMPORT' },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const RightToLeft: Story = { ...Both, decorators: [rtlDecorator] };

import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatTile } from './stat-tile';

const meta: Meta<typeof StatTile> = {
  title: 'Dashboard/StatTile',
  component: StatTile,
  tags: ['autodocs'],
  args: { label: 'Cash collected', value: '৳ 4,20,000' },
};
export default meta;
type Story = StoryObj<typeof StatTile>;

export const Plain: Story = { args: { note: 'this month' } };
export const TrendUpGood: Story = {
  args: { trend: { direction: 'up', text: '+4% vs last month', tone: 'good' } },
};
export const TrendDownBad: Story = {
  args: { trend: { direction: 'down', text: '-6% vs last month', tone: 'bad' } },
};
export const WithPlaceholderChild: Story = {
  args: {
    children: (
      <div className="mt-2 h-6 rounded bg-chart-cat-1" role="img" aria-label="Sample meter" />
    ),
  },
};
export const TwoColumnPhone: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-3">
      <StatTile
        label="Dues"
        value="৳ 82k"
        trend={{ direction: 'down', text: '-6%', tone: 'bad' }}
      />
      <StatTile
        label="Collected"
        value="৳ 4.2L"
        trend={{ direction: 'up', text: '+4%', tone: 'good' }}
      />
    </div>
  ),
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const SignalLevels: StoryObj<typeof StatTile> = {
  render: () => (
    <div className="grid max-w-xl grid-cols-2 gap-3">
      {(['critical', 'warn', 'ok', 'neutral'] as const).map((signal) => (
        <StatTile key={signal} label={signal} value="12" signal={signal} signalLabel={signal} />
      ))}
    </div>
  ),
};
export const SignalLevelsDark: StoryObj<typeof StatTile> = {
  ...SignalLevels,
  globals: { theme: 'dark' },
};

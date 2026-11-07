import type { Meta, StoryObj } from '@storybook/react-vite';
import { TableIcon } from 'lucide-react';

import { Button } from '../button';
import { HelpProvider } from '../help-hint';
import { MenuItem } from '../menu';

import { WidgetCard } from './widget-card';

const meta: Meta<typeof WidgetCard> = {
  title: 'Dashboard/WidgetCard',
  component: WidgetCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'Student attendance',
    updatedLabel: 'Updated 2 minutes ago',
    value: '91.4%',
    unit: 'present today',
    summary: 'Class 7 B is lowest at 78%.',
  },
};
export default meta;
type Story = StoryObj<typeof WidgetCard>;

const chart = (
  <svg role="img" aria-label="Sample chart" viewBox="0 0 100 20" className="h-32 w-full">
    <rect width="60" height="20" className="fill-chart-cat-2 stroke-chart-seq-2" />
  </svg>
);
const footer = (
  <>
    <a href="#all" className="text-primary underline">
      All classes ›
    </a>
    <Button variant="ghost" size="sm">
      <TableIcon aria-hidden="true" /> View table
    </Button>
  </>
);

export const Full: Story = { args: { children: chart } };
export const FullWithMenuAndFooter: Story = {
  args: {
    children: chart,
    footer,
    menuLabel: 'More actions',
    menu: (
      <>
        <MenuItem>Export</MenuItem>
        <MenuItem>Hide widget</MenuItem>
      </>
    ),
  },
};
export const Compact: Story = {
  args: { variant: 'compact', children: chart, footer },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const CompactExpanded: Story = {
  args: { variant: 'compact', children: chart, footer, defaultExpanded: true },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const Loading: Story = { args: { loading: true, loadingLabel: 'Loading attendance' } };
export const Error: Story = {
  args: {
    error: {
      message: 'Could not load attendance.',
      retryLabel: 'Try again',
      onRetry: () => {},
    },
  },
};
export const Empty: Story = {
  render: ({ title, empty }) => <WidgetCard title={title} {...(empty && { empty })} />,
  args: {
    empty: {
      reason: 'No attendance taken yet today.',
      action: (
        <a href="#take" className="text-primary underline">
          Take attendance ›
        </a>
      ),
    },
  },
};
export const Bangla: Story = {
  args: {
    title: 'শিক্ষার্থীর উপস্থিতি',
    updatedLabel: '২ মিনিট আগে আপডেট',
    value: '৯১.৪%',
    unit: 'উপস্থিত',
    summary: 'সপ্তম শ্রেণি, খ শাখায় সবচেয়ে কম, ৭৮%।',
    children: chart,
    footer: (
      <>
        <a href="#all" className="text-primary underline">
          সব শ্রেণি ›
        </a>
        <Button variant="ghost" size="sm">
          <TableIcon aria-hidden="true" /> টেবিল দেখুন
        </Button>
      </>
    ),
  },
  globals: { locale: 'bn' },
};
export const Dark: Story = { args: { children: chart, footer }, globals: { theme: 'dark' } };

export const WithHelp: Story = {
  args: { helpId: 'widget.attendance-today' },
  decorators: [
    (Story) => (
      <HelpProvider
        lang="en"
        baseUrl="https://guide.example"
        index={{
          'widget.attendance-today': {
            title: { bn: 'আজকের হাজিরা', en: 'Attendance today' },
            summary: { bn: 'আজ কতজন উপস্থিত।', en: 'How many are present today.' },
            path: 'dashboard/widgets',
            anchor: 'widget.attendance-today',
            knownIssues: 0,
          },
        }}
      >
        <Story />
      </HelpProvider>
    ),
  ],
};

const levels = [
  ['critical', 'Needs action'],
  ['warn', 'Watch'],
  ['ok', 'Healthy'],
  ['neutral', 'No signal'],
] as const;

const SignalGrid = ({ variant }: { variant: 'full' | 'compact' }) => (
  <div className="grid max-w-3xl gap-3 md:grid-cols-2">
    {levels.map(([signal, signalLabel]) => (
      <WidgetCard
        key={signal}
        title={`Fee collection (${signal})`}
        variant={variant}
        value="64%"
        signal={signal}
        signalLabel={signalLabel}
      />
    ))}
  </div>
);

export const SignalLevels: Story = { render: () => <SignalGrid variant="full" /> };
export const SignalLevelsCompact: Story = { render: () => <SignalGrid variant="compact" /> };
export const SignalLevelsDark: Story = {
  render: () => <SignalGrid variant="full" />,
  globals: { theme: 'dark' },
};

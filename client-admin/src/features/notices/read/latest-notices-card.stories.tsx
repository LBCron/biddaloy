import type { Meta, StoryObj } from '@storybook/react-vite';

import { LatestNoticesCardView } from './latest-notices-card';

const n = (i: number, over: Record<string, unknown> = {}) => ({
  id: `id-${i}`,
  title: ['Winter break', 'Annual sports day', 'Fee due date'][i - 1] ?? `Notice ${i}`,
  important: false,
  pinned: false,
  published_at: '2026-11-20T04:00:00.000Z',
  expires_on: null,
  edited: false,
  seen: false,
  acknowledged: false,
  forStudents: [],
  ...over,
});

const meta: Meta<typeof LatestNoticesCardView> = {
  title: 'Notices/LatestNoticesCard',
  component: LatestNoticesCardView,
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  args: {
    variant: 'full',
    listHref: '/portal/notices',
    items: [n(1, { important: true }), n(2, { seen: true }), n(3)],
  },
};
export default meta;
type Story = StoryObj<typeof LatestNoticesCardView>;

export const Populated: Story = {};
export const Compact: Story = { args: { variant: 'compact' } };
export const Loading: Story = { args: { loading: true, items: [] } };
export const Empty: Story = { args: { items: [] } };
export const Failed: Story = { args: { failed: true, items: [], onRetry: () => undefined } };

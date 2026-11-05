import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

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
    // Rows and "সব নোটিশ" are router links.
    withMemoryRouter(['/']),
  ],
  args: {
    variant: 'full',
    portalLinks: true,
    items: [n(1, { important: true }), n(2, { seen: true }), n(3)],
  },
};
export default meta;
type Story = StoryObj<typeof LatestNoticesCardView>;

export const Populated: Story = {};
export const Compact: Story = { args: { variant: 'compact' } };
/** The staff dashboard widget: plain rows, no link (#3448). */
export const Staff: Story = { args: { portalLinks: false } };
export const Loading: Story = { args: { loading: true, items: [] } };
export const Empty: Story = { args: { items: [] } };
export const Failed: Story = { args: { failed: true, items: [], onRetry: () => undefined } };

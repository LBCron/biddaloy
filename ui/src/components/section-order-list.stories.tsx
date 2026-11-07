import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { SectionOrderList, type SectionOrderItem } from './section-order-list';

const labels = {
  toggle: (n: string) => `${n} সাইটে দেখাও`,
  up: (n: string, p: number) => `${n} উপরে নিন (${p})`,
  down: (n: string, p: number) => `${n} নিচে নিন (${p})`,
  edit: () => 'সম্পাদনা',
  pinned: 'জায়গা ঠিক করা',
};

const initial: SectionOrderItem[] = [
  { key: 'hero', name: 'প্রচ্ছদ', enabled: true, pinned: true },
  { key: 'about', name: 'আমাদের কথা', enabled: true },
  { key: 'teachers', name: 'শিক্ষক', enabled: true },
  { key: 'blog', name: 'সংবাদ', enabled: false },
  { key: 'footer', name: 'পাদচরণ', enabled: true, pinned: true },
];

function Demo() {
  const [rows, setRows] = React.useState(initial);
  return (
    <SectionOrderList
      sections={rows}
      labels={labels}
      onEdit={() => {}}
      onToggle={(key, enabled) =>
        setRows((r) => r.map((s) => (s.key === key ? { ...s, enabled } : s)))
      }
      onMove={(from, to) =>
        setRows((r) => {
          const next = [...r];
          const [m] = next.splice(from, 1);
          if (m) next.splice(to, 0, m);
          return next;
        })
      }
    />
  );
}

const meta: Meta<typeof SectionOrderList> = {
  title: 'Components/SectionOrderList',
  component: SectionOrderList,
  render: () => <Demo />,
};
export default meta;
type Story = StoryObj<typeof SectionOrderList>;

export const Default: Story = {};
export const Dark: Story = { decorators: [darkDecorator], parameters: darkDecoratorParameters };
export const Phone390: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

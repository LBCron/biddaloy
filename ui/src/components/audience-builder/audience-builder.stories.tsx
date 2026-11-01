import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import type { DataTableColumn } from '../data-table';

import { AudienceBuilder, type AudienceBuilderProps } from './audience-builder';

interface Person {
  id: string;
  name: string;
  className: string;
}
const people = (n: number, from = 0): Person[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(from + i),
    name: `Student ${from + i + 1}`,
    className: `Class ${((from + i) % 10) + 1}`,
  }));
const COLUMNS: DataTableColumn<Person>[] = [
  { id: 'name', header: 'Name', accessorFn: (r) => r.name, card: 'title' },
  { id: 'className', header: 'Class', accessorFn: (r) => r.className },
];

const meta: Meta<typeof AudienceBuilder<Person>> = {
  title: 'Components/AudienceBuilder',
  component: AudienceBuilder<Person>,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof AudienceBuilder<Person>>;

function Harness(over: Partial<AudienceBuilderProps<Person>>) {
  const [tab, setTab] = useState('class');
  const base: AudienceBuilderProps<Person> = {
    tabs: [
      { key: 'class', label: 'By class', filters: <span>Class filters</span> },
      { key: 'staff', label: 'Staff', filters: <span>Staff filters</span> },
    ],
    activeTab: tab,
    onTabChange: setTab,
    matches: { rows: people(10), total: 143, page: 1, pageSize: 25 },
    onPageChange: () => {},
    onRetry: () => {},
    rowKey: (r) => r.id,
    columns: COLUMNS,
    onAddSelected: () => {},
    onAddAll: () => {},
    chosen: { rows: people(3, 100), total: 3, page: 1 },
    onChosenPage: () => {},
    onRemove: () => {},
    max: 500,
    layout: 'desktop',
    ...over,
  };
  return <AudienceBuilder {...base} />;
}

export const Desktop: Story = { render: () => <Harness /> };
export const Phone: Story = {
  render: () => <Harness layout="phone" />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const Loading: Story = {
  render: () => <Harness matches={{ rows: [], total: 0, page: 1, pageSize: 25, loading: true }} />,
};
export const Empty: Story = {
  render: () => <Harness matches={{ rows: [], total: 0, page: 1, pageSize: 25 }} />,
};
export const ErrorState: Story = {
  render: () => (
    <Harness
      matches={{ rows: [], total: 0, page: 1, pageSize: 25, error: 'Could not load people.' }}
    />
  ),
};
export const ChosenListAtMax: Story = {
  render: () => <Harness max={50} chosen={{ rows: people(25, 200), total: 50, page: 1 }} />,
};

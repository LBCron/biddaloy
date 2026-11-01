import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { DataTable, type DataTableColumn } from '../components/data-table';
import { Input } from '../components/input';
import { Label } from '../components/label';

import { FullPageShell } from './full-page-shell';

const meta: Meta<typeof FullPageShell> = {
  title: 'Shells/FullPageShell',
  component: FullPageShell,
  tags: ['autodocs'],
  decorators: [withMemoryRouter(['/'])],
  args: {
    title: 'নতুন শিক্ষার্থী',
    onClose: () => {},
    primary: { label: 'Save', onClick: () => {} },
    secondary: { label: 'Cancel', onClick: () => {} },
  },
};

export default meta;
type Story = StoryObj<typeof FullPageShell>;

export const Form: Story = {
  args: { size: 'form' },
  render: (args) => (
    <FullPageShell {...args}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fps-name">Name</Label>
        <Input id="fps-name" className="w-full" />
      </div>
    </FullPageShell>
  ),
};

interface Row {
  id: string;
  name: string;
}
const ROWS: Row[] = [
  { id: '1', name: 'রহিম উদ্দিন' },
  { id: '2', name: 'ফাতেমা বেগম' },
];
const COLUMNS: DataTableColumn<Row>[] = [{ id: 'name', header: 'Name', accessorFn: (r) => r.name }];

export const Wide: Story = {
  args: { size: 'wide' },
  render: (args) => (
    <FullPageShell {...args}>
      <DataTable
        tableId="full-page-shell-story"
        caption="Students"
        columns={COLUMNS}
        data={ROWS}
        getRowId={(r) => r.id}
        sorting={null}
        onSortingChange={() => {}}
        totalCount={ROWS.length}
        paginated={false}
      />
    </FullPageShell>
  ),
};

/** Escape on a dirty form asks before discarding. */
export const Dirty: Story = {
  args: { dirty: true },
  render: (args) => (
    <FullPageShell {...args}>
      <p className="text-body">Unsaved changes.</p>
    </FullPageShell>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.keyboard('{Escape}');
    await expect(
      await within(canvasElement.ownerDocument.body).findByRole('alertdialog'),
    ).toBeVisible();
  },
};

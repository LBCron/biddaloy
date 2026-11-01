/**
 * [8.15.17] `ExportMenu` stories. Covered: default (everything matches, ticked rows, no row
 * selection), loading (the download in flight), error (a failed download and the "too large"
 * sentence), disabled (no matches; no permission for "everything"), Bangla digits, RTL.
 * "Empty" is the no-matches story: the button is disabled rather than downloading an empty file.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { REGION_BD_BN, REGION_BD_EN } from '../i18n/region-config';
import { RegionConfigProvider } from '../i18n/region-config-provider';

import { ExportMenu } from './export-menu';

const meta: Meta<typeof ExportMenu> = {
  title: 'Components/ExportMenu',
  component: ExportMenu,
  tags: ['autodocs'],
  args: {
    totalCount: 1234,
    selectedCount: 0,
    canExportAll: true,
    unit: 'people',
    onExportAll: () => Promise.resolve(),
    onExportSelected: () => undefined,
  },
  decorators: [
    (Story) => (
      <RegionConfigProvider value={REGION_BD_EN}>
        <div className="flex min-h-40 justify-end p-4">
          <Story />
        </div>
      </RegionConfigProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ExportMenu>;

/** One click downloads everything that matches. The arrow holds the rest. */
export const Default: Story = {};

export const WithTickedRows: Story = {
  args: { selectedCount: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'More ways to download' }));
    const menu = within(canvasElement.ownerDocument.body);
    await expect(await menu.findByRole('menuitem', { name: 'Only the 3 you ticked' })).toBeTruthy();
  },
};

/** A list with no row selection (guardians, invoices, payments, audit logs). */
export const WithoutRowSelection: Story = {
  args: { selectedCount: 3 },
  render: (args) => (
    <ExportMenu
      totalCount={args.totalCount}
      selectedCount={args.selectedCount ?? 0}
      canExportAll={args.canExportAll}
      onExportAll={args.onExportAll}
      unit="people"
    />
  ),
};

/** The download is in flight: busy, and a second click does nothing. */
export const Loading: Story = {
  args: { onExportAll: () => new Promise<void>(() => undefined) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Download to Excel/ }));
    await expect(canvas.getByRole('button', { name: /Download to Excel/ })).toBeDisabled();
  },
};

/** More matches than one download holds: an inline sentence, never a silent no-op. */
export const TooLarge: Story = {
  args: {
    totalCount: 12400,
    narrowByClass: true,
    onExportAll: () =>
      Promise.reject(
        Object.assign(new Error('too large'), { code: 'EXPORT_TOO_LARGE', rows: 5000 }),
      ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Download to Excel/ }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Cannot download more than');
  },
};

export const Failed: Story = {
  args: { onExportAll: () => Promise.reject(new Error('network')) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Download to Excel/ }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('could not be downloaded');
  },
};

/** Stands in for "empty": nothing matches, so there is nothing to download. */
export const NothingMatches: Story = {
  args: { totalCount: 0 },
};

/** No `REPORTS_EXPORT`: the "everything" items are hidden; ticked rows still download. */
export const NoPermissionWithTickedRows: Story = {
  args: { canExportAll: false, selectedCount: 3 },
};

/** Renders nothing at all: no permission and no ticked rows. */
export const NoPermission: Story = {
  args: { canExportAll: false },
};

/** Bangla labels and Bangla digits with a thousands separator ("১,২৩৪ জন"). */
export const Bangla: Story = {
  args: { selectedCount: 3 },
  globals: { locale: 'bn' },
  decorators: [
    (Story) => (
      <RegionConfigProvider value={REGION_BD_BN}>
        <Story />
      </RegionConfigProvider>
    ),
  ],
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};

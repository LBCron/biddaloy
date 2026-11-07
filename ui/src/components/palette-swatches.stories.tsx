import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { PaletteSwatches } from './palette-swatches';

const palettes = [
  { id: 'green', name: { bn: 'সবুজ', en: 'Green' }, colors: ['#14532d', '#16a34a', '#bbf7d0', '#f0fdf4', '#1f2937'] },
  { id: 'blue', name: { bn: 'নীল', en: 'Blue' }, colors: ['#1e3a8a', '#2563eb', '#bfdbfe', '#eff6ff', '#111827'] },
  { id: 'maroon', name: { bn: 'মেরুন', en: 'Maroon' }, colors: ['#7f1d1d', '#dc2626', '#fecaca', '#fef2f2', '#1f2937'] },
];

function Controlled(args: React.ComponentProps<typeof PaletteSwatches>) {
  const [value, setValue] = React.useState(args.value);
  return <PaletteSwatches {...args} value={value} onChange={setValue} />;
}

const meta: Meta<typeof PaletteSwatches> = {
  title: 'Components/PaletteSwatches',
  component: PaletteSwatches,
  args: { palettes, value: 'green', lang: 'bn', label: 'রং', onChange: () => {} },
  render: (args) => <Controlled {...args} />,
};
export default meta;
type Story = StoryObj<typeof PaletteSwatches>;

export const Default: Story = {};
export const English: Story = { args: { lang: 'en', label: 'Colours' } };
export const Phone390: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Dark: Story = { decorators: [darkDecorator], parameters: darkDecoratorParameters };

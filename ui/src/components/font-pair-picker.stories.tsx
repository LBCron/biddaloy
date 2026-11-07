import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { FontPairPicker } from './font-pair-picker';

// Stories have no font files; the families fall back to system fonts.
const options = [
  {
    id: 'classic',
    heading: { family: 'Noto Serif Bengali', url: '/fonts/noto-serif-bengali.woff2' },
    body: { family: 'Hind Siliguri', url: '/fonts/hind-siliguri.woff2' },
  },
  {
    id: 'modern',
    heading: { family: 'Baloo Da 2', url: '/fonts/baloo-da-2.woff2' },
    body: { family: 'Noto Sans Bengali', url: '/fonts/noto-sans-bengali.woff2' },
  },
];

function Controlled(args: React.ComponentProps<typeof FontPairPicker>) {
  const [value, setValue] = React.useState(args.value);
  return <FontPairPicker {...args} value={value} onChange={setValue} />;
}

const meta: Meta<typeof FontPairPicker> = {
  title: 'Components/FontPairPicker',
  component: FontPairPicker,
  args: { options, value: 'classic', lang: 'bn', label: 'লেখার ধরন', onChange: () => {} },
  render: (args) => <Controlled {...args} />,
};
export default meta;
type Story = StoryObj<typeof FontPairPicker>;

export const Default: Story = {};
export const English: Story = { args: { lang: 'en', label: 'Text style' } };
export const Dark: Story = { decorators: [darkDecorator], parameters: darkDecoratorParameters };

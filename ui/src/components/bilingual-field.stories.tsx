import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { BilingualField } from './bilingual-field';

function Controlled(args: React.ComponentProps<typeof BilingualField>) {
  const [value, setValue] = React.useState(args.value);
  return <BilingualField {...args} value={value} onChange={setValue} />;
}

const meta: Meta<typeof BilingualField> = {
  title: 'Components/BilingualField',
  component: BilingualField,
  args: { label: 'Headline', value: { bn: 'স্বাগতম', en: '' }, onChange: () => {}, required: true },
  render: (args) => <Controlled {...args} />,
};
export default meta;
type Story = StoryObj<typeof BilingualField>;

export const Default: Story = {};
export const Multiline: Story = { args: { label: 'About us', multiline: true } };
export const Phone390: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Dark: Story = { decorators: [darkDecorator], parameters: darkDecoratorParameters };

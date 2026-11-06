import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { ScanCardField, type ScanCardFieldProps } from './scan-card-field';

const meta: Meta<typeof ScanCardField> = {
  title: 'Components/ScanCardField',
  component: ScanCardField,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ScanCardField>;

function Controlled(props: Partial<ScanCardFieldProps> & { initial?: string }) {
  const [value, setValue] = React.useState(props.initial ?? '');
  return (
    <div className="max-w-md">
      <ScanCardField
        label="Card number"
        scanLabel="Scan card"
        scanHint="Tap the card on the reader"
        {...props}
        value={value}
        onChange={setValue}
      />
    </div>
  );
}

export const Empty: Story = { render: () => <Controlled /> };
export const Filled: Story = { render: () => <Controlled initial="CARD-0042" /> };
export const WithError: Story = {
  render: () => <Controlled initial="CARD-0042" error="This card is already linked to someone" />,
};
export const PhoneWidth: Story = {
  render: () => <Controlled initial="CARD-0042" />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const RightToLeft: Story = { render: () => <Controlled />, decorators: [rtlDecorator] };

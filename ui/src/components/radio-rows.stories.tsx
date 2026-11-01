import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { HelpProvider } from './help-hint';
import { RadioRows } from './radio-rows';

const meta: Meta<typeof RadioRows> = {
  title: 'Components/RadioRows',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof RadioRows>;

const options = [
  { value: 'a', title: 'Class 6 Mathematics', caption: '42 lessons · last used 2026' },
  { value: 'b', title: 'Class 6 English', caption: '36 lessons' },
  { value: 'c', title: 'Archived template', caption: 'No longer available', disabled: true },
];

function Controlled(props: { legendHidden?: boolean; bangla?: boolean }) {
  const [value, setValue] = React.useState('a');
  return (
    <RadioRows
      value={value}
      onValueChange={setValue}
      legend={props.bangla ? 'টেমপ্লেট বেছে নিন' : 'Choose a template'}
      options={
        props.bangla
          ? [
              { value: 'a', title: 'ষষ্ঠ শ্রেণি গণিত', caption: '৪২টি পাঠ' },
              { value: 'b', title: 'ষষ্ঠ শ্রেণি ইংরেজি', caption: '৩৬টি পাঠ' },
            ]
          : options
      }
      {...(props.legendHidden ? { legendHidden: true } : {})}
    />
  );
}

export const Default: Story = { render: () => <Controlled /> };
export const LegendHidden: Story = { render: () => <Controlled legendHidden /> };
export const Bangla: Story = { render: () => <Controlled bangla /> };

function WithHelpRows() {
  return (
    <HelpProvider
      index={{
        'story.field.template': {
          title: { bn: 'টেমপ্লেট', en: 'Template' },
          summary: { bn: '', en: '' },
          path: 'story/template',
          anchor: '',
          knownIssues: 0,
          field: { ns: 'storyFieldNs', key: 'template' },
        },
      }}
      lang="en"
      baseUrl="https://schoolmanagerp.gitbook.io/schoolmanagerp-docs"
    >
      <RadioRows
        value="a"
        onValueChange={() => undefined}
        legend="Choose a template"
        options={options}
        helpId="story.field.template"
      />
    </HelpProvider>
  );
}

/** A (?) beside the legend, outside it: the group's name stays the legend alone. */
export const WithHelp: Story = { render: () => <WithHelpRows /> };

/** Phone width: the 44px (?) and the legend text share one centre line. */
export const WithHelpPhone: Story = {
  render: () => <WithHelpRows />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

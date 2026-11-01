import type { Meta, StoryObj } from '@storybook/react-vite';

import { HelpProvider } from './help-hint';
import { Input } from './input';
import { Label } from './label';

const meta: Meta<typeof Label> = {
  title: 'Components/Label',
  component: Label,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Label>;

export const Default: Story = {
  render: () => (
    <div className="grid max-w-xs gap-1.5">
      <Label htmlFor="n">Name</Label>
      <Input id="n" />
    </div>
  ),
};

/** `helpId` adds a (?) beside the label, named after the label text. */
export const WithHelp: Story = {
  render: () => (
    <HelpProvider
      index={{
        'story.field.name': {
          title: { bn: 'নাম', en: 'Name' },
          summary: { bn: '', en: '' },
          path: 'story/name',
          anchor: '',
          knownIssues: 0,
          field: { ns: 'storyFieldNs', key: 'name' },
        },
      }}
      lang="en"
      baseUrl="https://schoolmanagerp.gitbook.io/schoolmanagerp-docs"
    >
      <div className="grid max-w-xs gap-1.5">
        <Label htmlFor="n2" helpId="story.field.name">
          Name
        </Label>
        <Input id="n2" />
      </div>
    </HelpProvider>
  ),
};

/** The hint does not resolve: the label keeps its DOM, no wrapper, no (?). */
export const HelpUnresolved: Story = {
  render: () => (
    <div className="grid max-w-xs gap-1.5">
      <Label htmlFor="n3" helpId="story.field.missing">
        Name
      </Label>
      <Input id="n3" />
    </div>
  ),
};

import { DEFAULT_CONDUCT_ITEMS } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { NotesGrid, type NoteDraft, type NotesGridProps } from './-notes-grid';

const rows = [
  ['s1', 'Nusrat Jahan', 1],
  ['s2', 'Rafi Ahmed', 2],
  ['s3', 'Mina Akter', 3],
].map(([id, name, roll]) => ({
  student_id: String(id),
  full_name: String(name),
  full_name_bn: null,
  roll_number: Number(roll),
  remark: null,
  conduct: {},
}));

const filled: Record<string, NoteDraft> = {
  s1: {
    remark: 'Attentive and helpful in class.',
    conduct: { discipline: 'A', neatness: 'A', punctuality: 'B', sports: 'A' },
  },
  s2: { remark: '', conduct: { discipline: 'B' } },
  s3: { remark: '', conduct: {} },
};

function Controlled(props: Omit<NotesGridProps, 'drafts' | 'onChange'>) {
  const [drafts, setDrafts] = React.useState(filled);
  return (
    <NotesGrid
      {...props}
      drafts={drafts}
      onChange={(id, n) => setDrafts((d) => ({ ...d, [id]: n }))}
    />
  );
}

const meta: Meta<typeof Controlled> = {
  title: 'MyClass/NotesGrid',
  component: Controlled,
  args: { rows, items: DEFAULT_CONDUCT_ITEMS },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof Controlled>;

/** Mixed: one student done, one half done, one blank (shown as a dash). */
export const Editing: Story = {};

/** The result is published, so every field is read-only. */
export const Locked: Story = { args: { disabled: true } };

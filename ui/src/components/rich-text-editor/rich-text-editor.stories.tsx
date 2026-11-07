import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { darkDecorator, darkDecoratorParameters } from '../../../.storybook/dark-decorator';

import { RichTextEditor, type RichTextEditorLabels } from './rich-text-editor';
import type { RichTextValue } from './types';

const labels: RichTextEditorLabels = {
  editor: 'পোস্টের লেখা',
  toolbar: 'লেখার ধরন',
  bold: 'গাঢ়',
  italic: 'বাঁকা',
  paragraph: 'অনুচ্ছেদ',
  heading2: 'বড় শিরোনাম',
  heading3: 'ছোট শিরোনাম',
  bulleted: 'বুলেট তালিকা',
  numbered: 'নম্বর তালিকা',
  quote: 'উদ্ধৃতি',
  table: 'ছক',
  addRow: 'সারি যোগ করুন',
  addColumn: 'কলাম যোগ করুন',
  deleteTable: 'ছক মুছুন',
  image: 'ছবি',
  imageAlt: 'ছবির বর্ণনা',
  link: 'লিংক',
  linkUrl: 'ওয়েব ঠিকানা',
  linkApply: 'লিংক দিন',
  linkRemove: 'লিংক সরান',
  linkInvalid: 'http বা https ঠিকানা দিন।',
  imageUpload: {
    choose: 'ছবি বাছুন',
    zoom: 'বড় করুন',
    save: 'ছবি রাখুন',
    svgRefused: 'SVG ছবি নেওয়া যায় না।',
    tooLarge: 'ছবিটি ২০ MB-এর বেশি।',
    unreadable: 'ছবিটি পড়া যায়নি।',
    pan: 'তীর চাপলে ছবি সরবে।',
  },
};

const sample: RichTextValue = [
  { type: 'heading-two', children: [{ text: 'বার্ষিক ক্রীড়া প্রতিযোগিতা' }] },
  {
    type: 'paragraph',
    children: [
      { text: 'আগামী শুক্রবার ' },
      { text: 'সকাল ৯টায়', bold: true },
      { text: ' মাঠে প্রতিযোগিতা শুরু হবে।' },
    ],
  },
  {
    type: 'bulleted-list',
    children: [
      { type: 'list-item', children: [{ text: 'দৌড়' }] },
      { type: 'list-item', children: [{ text: 'লং জাম্প' }] },
    ],
  },
];

function Demo() {
  const [v, setV] = React.useState(sample);
  return (
    <RichTextEditor
      value={v}
      onChange={setV}
      lang="bn"
      labels={labels}
      onUploadImage={() => Promise.resolve({ mediaId: 'demo' })}
    />
  );
}

const meta: Meta<typeof RichTextEditor> = {
  title: 'Components/RichTextEditor',
  component: RichTextEditor,
  render: () => <Demo />,
};
export default meta;
type Story = StoryObj<typeof RichTextEditor>;

export const Default: Story = {};
export const Dark: Story = { decorators: [darkDecorator], parameters: darkDecoratorParameters };
export const Phone390: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

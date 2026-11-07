import type { Meta, StoryObj } from '@storybook/react-vite';

import { darkDecorator, darkDecoratorParameters } from '../../../.storybook/dark-decorator';

import { GalleryPhotoUploader, type GalleryPhotoUploaderLabels } from './gallery-photo-uploader';

const labels: GalleryPhotoUploaderLabels = {
  choose: 'ছবি বেছে নিন',
  hint: 'একসাথে অনেক ছবি বেছে নিন। ছবির মাপ আমরা ঠিক করে দেব।',
  pickerLabel: 'যে ছবিগুলো যোগ করবেন',
  waiting: 'অপেক্ষায়',
  uploading: 'পাঠানো হচ্ছে',
  done: 'হয়েছে',
  failed: 'হয়নি',
  notPhoto: 'এটি ব্যবহার করার মতো ছবি নয়',
  notAdded: 'যোগ হয়নি, এই বিভাগ ভরে গেছে',
  storageFull: 'অপেক্ষায়, ছবির জায়গা ভরে গেছে',
  retry: 'আবার চেষ্টা করুন',
  summary: (done, total) => `${total}টির মধ্যে ${done}টি হয়েছে`,
};

const meta: Meta<typeof GalleryPhotoUploader> = {
  title: 'Components/GalleryPhotoUploader',
  component: GalleryPhotoUploader,
  args: { remaining: 60, labels, onUpload: () => Promise.resolve() },
};
export default meta;
type Story = StoryObj<typeof GalleryPhotoUploader>;

/** Empty: choose photos to start. Pick files to see the queue (done, sending, failed). */
export const Default: Story = {};
/** Nothing more fits: the drop area is off. */
export const Full: Story = { args: { remaining: 0 } };
/** Every upload fails with a fixed sentence and a per-photo retry. */
export const FailsWithRetry: Story = {
  args: {
    onUpload: () => Promise.reject(new Error('fail')),
    errorText: () => 'এই ছবি পাঠানো যায়নি। আবার চেষ্টা করুন।',
  },
};
/** The first upload says space is full: the rest wait. */
export const StorageFull: Story = {
  args: { onUpload: () => Promise.reject(new Error('full')), isStorageFull: () => true },
};
export const Phone390: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Dark: Story = { decorators: [darkDecorator], parameters: darkDecoratorParameters };

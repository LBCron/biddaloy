import { SiteMediaSlot } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { darkDecorator, darkDecoratorParameters } from '../../../.storybook/dark-decorator';

import { ImageSlotUpload } from './image-slot-upload';

const labels = {
  choose: 'ছবি বাছুন',
  zoom: 'বড় করুন',
  save: 'ছবি রাখুন',
  svgRefused: 'SVG ছবি নেওয়া যায় না। PNG বা JPG দিন।',
  tooLarge: 'ছবিটি ২০ MB-এর বেশি। ছোট ছবি দিন।',
  unreadable: 'ছবিটি পড়া যায়নি।',
  pan: 'তীর চাপলে ছবি সরবে, + ও - চাপলে বড়-ছোট হবে।',
};

const meta: Meta<typeof ImageSlotUpload> = {
  title: 'Components/ImageSlotUpload',
  component: ImageSlotUpload,
  args: { slot: SiteMediaSlot.HERO, labels, onUpload: () => {} },
};
export default meta;
type Story = StoryObj<typeof ImageSlotUpload>;

export const Hero: Story = {};
export const Logo: Story = { args: { slot: SiteMediaSlot.LOGO } };
export const Disabled: Story = { args: { disabled: true } };
export const Phone390: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Dark: Story = { decorators: [darkDecorator], parameters: darkDecoratorParameters };

/** [53.5.03] Notice alert row actions: important ("পড়েছি"), busy, and the SMS approval task. */
import { AlertCategory, AlertSource } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { alertItemFactory } from '../../test/factories/attention.factory';

import {
  AttentionNoticeItem,
  NOTICE_IMPORTANT,
  NOTICE_SMS_APPROVAL,
} from './attention-notice-item';

const meta: Meta<typeof AttentionNoticeItem> = {
  title: 'Attention/AttentionNoticeItem',
  component: AttentionNoticeItem,
  tags: ['autodocs'],
  args: { onAcknowledge: () => {} },
};

export default meta;
type Story = StoryObj<typeof AttentionNoticeItem>;

const base = { source: AlertSource.NOTICE, category: AlertCategory.NOTICE };

export const Important: Story = {
  args: {
    item: alertItemFactory({
      ...base,
      ruleKey: NOTICE_IMPORTANT,
      title: 'পরীক্ষার রুটিন প্রকাশিত',
      actionUrl: '/communications/notices/n-1',
    }),
  },
};

export const ImportantBusy: Story = { args: { ...Important.args, busy: true } };

export const ImportantBangla: Story = { ...Important, globals: { locale: 'bn' } };

export const SmsApproval: Story = {
  args: {
    item: alertItemFactory({
      ...base,
      ruleKey: NOTICE_SMS_APPROVAL,
      title: 'পরীক্ষার রুটিন প্রকাশিত',
      actionUrl: '/communications/notices/n-1?sms=1',
    }),
  },
};

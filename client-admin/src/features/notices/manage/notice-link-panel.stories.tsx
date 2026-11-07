import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { NoticeLinkPanel, NoticeSmsPanel } from './notice-link-panel';
import type { Notice } from './use-notices';

/**
 * [53.6.01] The two panels under a published notice's header: the public link and the SMS status.
 * Fake school data only. client-admin stories are in no Storybook build; `notices.stories.test.tsx`
 * renders each once.
 */
const notice = (over: Partial<Notice> = {}): Notice => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'পরীক্ষার রুটিন',
  pinnedOnWebsite: false,
  body: 'প্রথম সাময়িক পরীক্ষা শুরু হবে রবিবার।',
  status: 'PUBLISHED',
  important: true,
  pinned: false,
  isPublic: true,
  expiresOn: null,
  authorUserId: '22222222-2222-4222-8222-222222222222',
  authorName: 'করিম হোসেন',
  publishedAt: '2026-10-09T05:00:00.000Z',
  editedAt: null,
  withdrawnAt: null,
  smsStatus: 'NONE',
  recipientCount: 40,
  seenCount: 31,
  createdAt: '2026-10-08T05:00:00.000Z',
  ...over,
});

const meta: Meta<typeof NoticeLinkPanel> = {
  component: NoticeLinkPanel,
  args: { notice: notice() },
};
export default meta;
type Story = StoryObj<typeof NoticeLinkPanel>;

/** A public notice: the link is shown once after "New link"; until then, the panel says so. */
export const PublicLink: Story = {};

/** A notice only its people can read: no link buttons. */
export const OnlyItsPeople: Story = { args: { notice: notice({ isPublic: false }) } };

type SmsStory = StoryObj<typeof NoticeSmsPanel>;
// The SMS panel opens the approval page through `?sms=1`, so it needs a router.
const sms = (over: Partial<Notice>, canApprove = false): SmsStory => ({
  render: () => <NoticeSmsPanel notice={notice(over)} canApprove={canApprove} />,
  decorators: [withMemoryRouter(['/'])],
});

/** No SMS asked yet: the author can ask for one. */
export const SmsNotAsked = sms({ smsStatus: 'NONE' });

/** Waiting, seen by an approver: the "review" button opens the approval page. */
export const SmsWaitingApprover = sms({ smsStatus: 'PENDING' }, true);

/** Waiting, seen by someone who cannot approve: status only. */
export const SmsWaiting = sms({ smsStatus: 'PENDING' });

/** Approved and sent. */
export const SmsSent = sms({ smsStatus: 'APPROVED' });

/** Declined. */
export const SmsDeclined = sms({ smsStatus: 'DECLINED' });

import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';
import { withSession } from '../../../../../ui/.storybook/session-decorator';

import { NoticeCompose } from './notice-compose';
import { PublishConfirmDialog } from './publish-confirm-dialog';

/**
 * [53.3.g2.01] The notice compose page and its publish confirm. Fake people only.
 * Same "client-admin isn't globbed into a running Storybook yet" gap the applications stories note.
 */
const meta: Meta<typeof NoticeCompose> = {
  component: NoticeCompose,
  args: { onClose: () => undefined, onPublished: () => undefined },
  decorators: [withMemoryRouter(['/']), withSession('ADMIN')],
};
export default meta;
type Story = StoryObj<typeof NoticeCompose>;

const ID = '11111111-1111-4111-8111-111111111111';
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 25 });
const handlers = [
  http.get('/api/v1/notices/:id', () =>
    HttpResponse.json({
      id: ID,
      title: 'শীতকালীন ছুটি',
      body: 'রবিবার থেকে স্কুল বন্ধ থাকবে।',
      status: 'DRAFT',
      important: true,
      pinned: false,
      isPublic: false,
      expiresOn: null,
      smsStatus: 'NONE',
      recipientCount: 2,
      seenCount: 0,
    }),
  ),
  http.get('/api/v1/notices/:id/recipients', () =>
    HttpResponse.json(
      page([
        {
          id: 'r1',
          kind: 'GUARDIAN',
          name: 'করিম হোসেন',
          forStudent: 'রহিম উদ্দিন',
          hasLogin: true,
          unreachable: false,
        },
        {
          id: 'r2',
          kind: 'GUARDIAN',
          name: 'সালমা খাতুন',
          forStudent: 'আয়েশা আক্তার',
          hasLogin: false,
          unreachable: false,
        },
      ]),
    ),
  ),
  http.get('/api/v1/audience/people', () =>
    HttpResponse.json(
      page([
        {
          kind: 'GUARDIAN',
          userId: 'u1',
          studentId: null,
          guardianId: 'g1',
          name: 'নাসির আহমেদ',
          detail: 'ষষ্ঠ · ক',
          hasLogin: true,
          hasPhone: true,
        },
      ]),
    ),
  ),
  http.get('/api/v1/classes', () =>
    HttpResponse.json({
      data: [{ id: 'c1', name: 'ষষ্ঠ' }],
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    }),
  ),
  http.get('/api/v1/classes/c1/sections', () =>
    HttpResponse.json([{ id: 's1', section_name: 'ক', class_id: 'c1', enrolled_count: 30 }]),
  ),
];

/** A new notice: nothing written yet. */
export const Empty: Story = { parameters: { msw: { handlers } } };

/** An existing draft, filled in. */
export const Filled: Story = { args: { noticeId: ID }, parameters: { msw: { handlers } } };

/** The same page on a phone. */
export const Phone: Story = {
  args: { noticeId: ID },
  parameters: { msw: { handlers }, viewport: { defaultViewport: 'mobile1' } },
};

/** The publish confirm with SMS ticked: it says the request goes to an admin. */
export const PublishConfirm: StoryObj<typeof PublishConfirmDialog> = {
  render: () => (
    <PublishConfirmDialog
      open
      onOpenChange={() => undefined}
      counts={{ app: 120, smsOnly: 8, unreachable: 2 }}
      sms
      busy={false}
      onConfirm={() => undefined}
    />
  ),
};

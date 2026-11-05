import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';
import { withSession } from '../../../../../ui/.storybook/session-decorator';

import { NoticeSmsPage } from './notice-sms-page';

/**
 * [53.6.01] The SMS approval page (`?sms=1` on a notice): who gets it, the text, the credit cost,
 * Decline / Approve. Fake people and masked phones only. client-admin stories are in no Storybook
 * build; `notices.stories.test.tsx` renders each once.
 */
const ID = '11111111-1111-4111-8111-111111111111';

const row = (id: string, guardianName: string, forStudent: string | null, over = {}) => ({
  id,
  guardianName,
  forStudent,
  reachable: true,
  smsWanted: true,
  phone: '01•••••234',
  ...over,
});

const view = (over: Record<string, unknown> = {}) => ({
  status: 'PENDING',
  requester: 'করিম হোসেন',
  requestedAt: '2026-10-09T05:00:00.000Z',
  live: true,
  items: [
    row('33333333-3333-4333-8333-333333333331', 'রহিমা বেগম', 'সুমি, ৬ষ্ঠ ক'),
    // One guardian, two children: two rows, two different tick-box names (#3486).
    row('33333333-3333-4333-8333-333333333332', 'রহিমা বেগম', 'রাফি, ৮ম খ'),
    row('33333333-3333-4333-8333-333333333333', 'নাসির আহমেদ', 'আয়েশা, ৬ষ্ঠ ক', {
      smsWanted: false,
    }),
    row('33333333-3333-4333-8333-333333333334', 'সালমা খাতুন', 'রহিম, ৭ম ক', {
      reachable: false,
      phone: null,
    }),
  ],
  total: 4,
  page: 1,
  limit: 25,
  counts: { willSend: 2, optedOut: 1, noPhone: 1 },
  sms: {
    text: 'পরীক্ষার রুটিন: https://demo.example/n/…',
    length: 42,
    segments: 1,
    encoding: 'UCS_2',
    creditCost: 2,
  },
  ...over,
});

const smsGet = (body: unknown, status = 200) => [
  http.get(`/api/v1/notices/${ID}/sms`, () => HttpResponse.json(body as object, { status })),
];

const meta: Meta<typeof NoticeSmsPage> = {
  component: NoticeSmsPage,
  args: { noticeId: ID, onClose: () => undefined },
  decorators: [withMemoryRouter(['/?sms=1']), withSession('ADMIN')],
  parameters: { msw: { handlers: smsGet(view()) } },
};
export default meta;
type Story = StoryObj<typeof NoticeSmsPage>;

/** Waiting for an approver. */
export const Waiting: Story = {};

/** The same page on a phone. */
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

/** Already approved: read only, no buttons, no ticking. */
export const Decided: Story = {
  parameters: { msw: { handlers: smsGet(view({ status: 'APPROVED' })) } },
};

/** The notice was withdrawn or ended while the request waited. */
export const NotLive: Story = {
  parameters: { msw: { handlers: smsGet(view({ live: false })) } },
};

/** Someone who cannot approve (the server answers 403). */
export const NoAccess: Story = {
  parameters: {
    msw: {
      handlers: smsGet(
        {
          statusCode: 403,
          message: 'Forbidden',
          timestamp: '2026-10-09T05:00:00.000Z',
          path: `/api/v1/notices/${ID}/sms`,
          requestId: 'story',
        },
        403,
      ),
    },
  },
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';
import { withSession } from '../../../../../ui/.storybook/session-decorator';

import { NoticeDetail } from './notice-detail';
import { NoticeList } from './notice-list';

/**
 * [53.3.g1.01] Staff notice list and detail (the "Who has read it" tab is the Report story).
 * Fake school data only. Same "client-admin isn't globbed into a running Storybook yet" gap as
 * `application-forms.stories.tsx`.
 */
const ID = '11111111-1111-4111-8111-111111111111';

const notice = (over: Record<string, unknown>) => ({
  id: ID,
  title: 'পরীক্ষার রুটিন',
  body: 'প্রথম সাময়িক পরীক্ষা শুরু হবে রবিবার।\nসবাই সময়মতো আসবে।',
  status: 'PUBLISHED',
  important: true,
  pinned: false,
  isPublic: false,
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

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 25 });

const report = {
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      kind: 'GUARDIAN',
      name: 'রহিম উদ্দিন',
      forStudent: 'সুমি, ৬ ক',
      hasLogin: true,
      seenAt: '2026-10-09T06:00:00.000Z',
      linkOpenedAt: null,
      acknowledgedAt: '2026-10-09T07:00:00.000Z',
      unreachable: false,
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
  totals: { people: 40, seen: 31, linkOpened: 6, acknowledged: 20, unreachable: 2 },
};

const meta: Meta<typeof NoticeList> = {
  component: NoticeList,
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/notices', () =>
          HttpResponse.json(
            page([
              notice({}),
              notice({
                id: '33333333-3333-4333-8333-333333333333',
                title: 'ছুটির নোটিশ',
                status: 'DRAFT',
                publishedAt: null,
                important: false,
              }),
            ]),
          ),
        ),
      ],
    },
  },
};

export default meta;
type Story = StoryObj<typeof NoticeList>;

// The list and the detail each need a router (links, `?tab=`); per story, so Report can start on its tab.
const atRoot = [withMemoryRouter(['/']), withSession('ADMIN')];

export const List: Story = { decorators: atRoot };

export const Empty: Story = {
  decorators: atRoot,
  parameters: {
    msw: { handlers: [http.get('/api/v1/notices', () => HttpResponse.json(page([])))] },
  },
};

export const Phone: Story = {
  decorators: atRoot,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

const detailHandlers = [
  http.get(`/api/v1/notices/${ID}`, () => HttpResponse.json(notice({}))),
  http.get(`/api/v1/notices/${ID}/report`, () => HttpResponse.json(report)),
];

export const Detail: StoryObj<typeof NoticeDetail> = {
  render: () => <NoticeDetail noticeId={ID} />,
  decorators: atRoot,
  parameters: { msw: { handlers: detailHandlers } },
};

export const Report: StoryObj<typeof NoticeDetail> = {
  render: () => <NoticeDetail noticeId={ID} />,
  decorators: [withMemoryRouter(['/?tab=report']), withSession('ADMIN')],
  parameters: { msw: { handlers: detailHandlers } },
};

export const DetailPhone: StoryObj<typeof NoticeDetail> = {
  ...Detail,
  parameters: { ...Detail.parameters, viewport: { defaultViewport: 'mobile1' } },
};

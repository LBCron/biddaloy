import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';
import { withSession } from '../../../../../ui/.storybook/session-decorator';

import { MyNoticeDetailView, MyNoticePage } from './my-notice-detail';
import { MyNoticesList } from './my-notices-list';
import type { MyNoticeDetail } from './use-my-notices';

/**
 * [53.3.03] The reader's side (guardians, students): the notice list with its চলতি · পুরনো tabs,
 * one notice, and the full page `/portal/notices/<id>`. Fake school data only. client-admin
 * stories are in no Storybook build; `notices.stories.test.tsx` renders each once.
 */
const ID = '11111111-1111-4111-8111-111111111111';

const item = (i: number, over: Record<string, unknown> = {}) => ({
  id: `11111111-1111-4111-8111-11111111111${i}`,
  title: ['শীতকালীন ছুটি', 'বার্ষিক ক্রীড়া', 'বেতনের শেষ তারিখ'][i - 1] ?? `নোটিশ ${i}`,
  important: false,
  pinned: false,
  published_at: '2026-11-20T04:00:00.000Z',
  expires_on: null,
  edited: false,
  seen: true,
  acknowledged: false,
  forStudents: ['সুমি, ৬ষ্ঠ ক'],
  ...over,
});

const detail = (over: Partial<MyNoticeDetail> = {}): MyNoticeDetail => ({
  ...item(1, { important: true, seen: true }),
  id: ID,
  body: 'রবিবার থেকে স্কুল বন্ধ থাকবে।\nজানুয়ারির ২ তারিখে আবার খুলবে।',
  // A PDF, not an image: an image would fetch its blob through the authed API.
  files: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      original_name: 'ছুটির-তালিকা.pdf',
      mime_type: 'application/pdf',
      size_bytes: 120_000,
    },
  ],
  ...over,
});

const list = (rows: unknown[]) =>
  http.get('/api/v1/notices/mine', () =>
    HttpResponse.json({ data: rows, total: rows.length, page: 1, limit: 20 }),
  );

const meta: Meta<typeof MyNoticesList> = {
  component: MyNoticesList,
  decorators: [withMemoryRouter(['/']), withSession('PARENT')],
  parameters: {
    msw: {
      handlers: [
        list([
          item(1, { important: true, seen: false }),
          item(2, { edited: true }),
          item(3, { forStudents: ['সুমি, ৬ষ্ঠ ক', 'রাফি, ৮ম খ'] }),
        ]),
      ],
    },
  },
};
export default meta;
type Story = StoryObj<typeof MyNoticesList>;

/** Current notices: unread is bold, জরুরি and সম্পাদিত are `StatusBadge`s, the child line for guardians. */
export const List: Story = {};

/** Nothing current. */
export const Empty: Story = { parameters: { msw: { handlers: [list([])] } } };

/** The list on a phone (cards, not a table). */
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

type DetailStory = StoryObj<typeof MyNoticeDetailView>;

/** One important notice not yet acknowledged: the filled "পড়েছি" button shows. */
export const Detail: DetailStory = {
  render: () => <MyNoticeDetailView notice={detail()} onAcknowledge={() => undefined} />,
};

/** Already acknowledged, and edited after it was published. */
export const DetailAcknowledged: DetailStory = {
  render: () => (
    <MyNoticeDetailView
      notice={detail({ acknowledged: true, edited: true })}
      onAcknowledge={() => undefined}
    />
  ),
};

/** The full page: the notice title is the page h1, with a link back to the list (#3438). */
export const Page: StoryObj<typeof MyNoticePage> = {
  render: () => <MyNoticePage id={ID} />,
  parameters: {
    msw: { handlers: [http.get(`/api/v1/notices/mine/${ID}`, () => HttpResponse.json(detail()))] },
  },
};

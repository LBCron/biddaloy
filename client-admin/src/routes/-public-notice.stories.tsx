import { AuthLayout } from '@biddaloy/ui/components';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { PublicNotice } from './-public-notice';

/**
 * [53.6.01] The public notice page `/n/<token>`, inside the same `AuthLayout` the route uses.
 * Fake school data only. client-admin stories are in no Storybook build;
 * `features/notices/notices.stories.test.tsx` renders each once.
 */
const TOKEN = 'demo-token';

const live = [
  http.get('/api/v1/public/notices/:token', () =>
    HttpResponse.json({
      schoolName: 'অনন্ত উচ্চ বিদ্যালয়',
      title: 'বার্ষিক ক্রীড়া প্রতিযোগিতা',
      body: 'আগামী বৃহস্পতিবার সকাল ৯টায় মাঠে।\nঅভিভাবকরা আমন্ত্রিত।',
      publishedAt: '2026-10-09T05:00:00.000Z',
      editedAt: '2026-10-10T05:00:00.000Z',
      files: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          mimeType: 'application/pdf',
          name: 'সূচি.pdf',
        },
      ],
    }),
  ),
  // Opening the page tells the server the link was opened.
  http.post('/api/v1/public/notices/:token/opened', () => new HttpResponse(null, { status: 204 })),
];

const meta: Meta<typeof PublicNotice> = {
  component: PublicNotice,
  args: { token: TOKEN },
  decorators: [
    (Story) => (
      <AuthLayout>
        <Story />
      </AuthLayout>
    ),
  ],
  parameters: { msw: { handlers: live } },
};
export default meta;
type Story = StoryObj<typeof PublicNotice>;

/** A live link: title, dates, text and the file link. */
export const Live: Story = {};

/** The same page on a phone. */
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

/** Turned off, renewed, withdrawn or expired: one fixed message that never repeats the token. */
export const DeadLink: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/public/notices/:token', () => new HttpResponse(null, { status: 404 })),
      ],
    },
  },
};

/** A dropped connection: this one can be tried again. */
export const Failed: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/public/notices/:token', () => new HttpResponse(null, { status: 500 })),
      ],
    },
  },
};

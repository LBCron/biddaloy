import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoticeCompose } from './notice-compose';

const ID = '11111111-1111-4111-8111-111111111111';
const notice = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  title: 'Winter break',
  body: 'School is closed from Sunday.',
  status: 'DRAFT',
  important: false,
  pinned: false,
  isPublic: false,
  expiresOn: null,
  smsStatus: 'NONE',
  recipientCount: 1,
  seenCount: 0,
  ...extra,
});
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, limit: 25 });
const guardian = {
  id: 'r1',
  kind: 'GUARDIAN',
  name: 'Karim Hossain',
  forStudent: 'Rahim Uddin',
  hasLogin: true,
  unreachable: false,
  seenAt: null,
  linkOpenedAt: null,
  acknowledgedAt: null,
};

function mock(opts: { onPublish?: () => void; created?: () => void } = {}) {
  server.use(
    http.get('/api/v1/notices/:id', () => HttpResponse.json(notice())),
    http.post('/api/v1/notices', () => {
      opts.created?.();
      return HttpResponse.json(notice(), { status: 201 });
    }),
    http.patch('/api/v1/notices/:id', () => HttpResponse.json(notice())),
    http.get('/api/v1/notices/:id/recipients', () => HttpResponse.json(page([guardian]))),
    http.get('/api/v1/audience/people', () => HttpResponse.json(page([]))),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.post('/api/v1/notices/:id/publish', async () => {
      opts.onPublish?.();
      await delay(50);
      return HttpResponse.json(notice({ status: 'PUBLISHED' }));
    }),
  );
}

function mount(
  props: { noticeId?: string; onClose?: () => void; onPublished?: (id: string) => void } = {},
  role = 'ADMIN',
  locale: 'en' | 'bn' = 'en',
) {
  return renderWithRouter(
    createRootRoute({
      component: () => (
        <NoticeCompose
          noticeId={props.noticeId}
          onClose={props.onClose ?? (() => {})}
          onPublished={props.onPublished ?? (() => {})}
        />
      ),
    }),
    { tenantId: 'tenant-1', role, locale },
  );
}

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const png = (name: string) => new File(['x'], name, { type: 'image/png' });

/** Edit mode with a saved draft: walk to the check step. */
async function toReview(
  user: ReturnType<typeof userEvent.setup>,
  next = 'Next step',
  publish = 'Publish',
) {
  await screen.findByDisplayValue('Winter break');
  await user.click(screen.getByRole('button', { name: next }));
  await screen.findAllByRole('tab');
  await user.click(screen.getByRole('button', { name: next }));
  await waitFor(() => expect(document.querySelector('#notice-review')).toBeTruthy());
  // The publish button stays disabled until the Chosen-list totals have loaded.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: publish }).hasAttribute('disabled')).toBe(false),
  );
}

afterEach(() => cleanupTestState());

describe('NoticeCompose', () => {
  it('shows validation messages next to their field', async () => {
    mock();
    const user = userEvent.setup();
    const { localeReady } = mount();
    await localeReady;
    await user.click(await screen.findByRole('button', { name: 'Next step' }));
    expect(
      (await screen.findByText('Write a title')).closest('div')?.querySelector('#notice-title'),
    ).toBeTruthy();
    expect(
      screen.getByText('Write the notice text').closest('div')?.querySelector('#notice-body'),
    ).toBeTruthy();
  });

  it('refuses the 4th file', async () => {
    mock();
    const user = userEvent.setup();
    const { localeReady } = mount();
    await localeReady;
    await screen.findByLabelText('Title');
    await user.upload(fileInput(), [png('a.png'), png('b.png'), png('c.png'), png('d.png')]);
    expect(await screen.findByText('At most 3 files')).toBeTruthy();
    expect(screen.queryByText('d.png')).toBeNull();
  });

  it('asks for JPG on a HEIC file (bn)', async () => {
    mock();
    const user = userEvent.setup({ applyAccept: false });
    const { localeReady } = mount({}, 'ADMIN', 'bn');
    await localeReady;
    await screen.findByLabelText('শিরোনাম');
    await user.upload(fileInput(), new File(['x'], 'photo.heic', { type: 'image/heic' }));
    expect((await screen.findByRole('alert')).textContent).toContain('JPG করে দিন');
  });

  it('sends one publish request on a double-click', async () => {
    const onPublish = vi.fn();
    const onPublished = vi.fn();
    mock({ onPublish });
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID, onPublished });
    await localeReady;
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.dblClick(await screen.findByRole('button', { name: 'Yes, publish' }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(ID));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('SMS ticked: the confirm says it goes to an admin, never "sent"', async () => {
    mock();
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID });
    await localeReady;
    await screen.findByDisplayValue('Winter break');
    await user.click(screen.getByRole('checkbox', { name: /SMS/ }));
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(
      await screen.findByText('The SMS request will go to an admin for approval.'),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b(sent|delivered)\b/i);
  });

  it('SMS ticked (bn): approval sentence, no "sent" wording', async () => {
    mock();
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID }, 'ADMIN', 'bn');
    await localeReady;
    await screen.findByDisplayValue('Winter break');
    await user.click(screen.getByRole('checkbox', { name: /SMS/ }));
    await toReview(user, 'পরের ধাপ', 'প্রকাশ করুন');
    await user.click(screen.getByRole('button', { name: 'প্রকাশ করুন' }));
    expect(await screen.findByText('SMS অনুমোদনের জন্য অ্যাডমিনের কাছে যাবে')).toBeTruthy();
    expect(document.body.textContent).not.toContain('পাঠানো হয়েছে');
  });

  it('a teacher sees only the student and guardian tabs', async () => {
    mock();
    const user = userEvent.setup();
    const { localeReady } = mount({}, 'TEACHER');
    await localeReady;
    await user.type(await screen.findByLabelText('Title'), 'Class test');
    await user.type(screen.getByLabelText('Notice text'), 'Test on Monday.');
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(await screen.findByRole('tab', { name: 'Guardians' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Students' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'All teachers and staff' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'By name' })).toBeNull();
  });

  it('an admin sees all four tabs, staff second', async () => {
    mock();
    const user = userEvent.setup();
    const { localeReady } = mount();
    await localeReady;
    await user.type(await screen.findByLabelText('Title'), 'Fees');
    await user.type(screen.getByLabelText('Notice text'), 'Pay by Friday.');
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual([
      'Guardians',
      'All teachers and staff',
      'Students',
      'By name',
    ]);
  });

  it('asks before closing a dirty form', async () => {
    mock();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = mount({ onClose });
    await localeReady;
    await user.type(await screen.findByLabelText('Title'), 'Draft');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  // No per-notice glossary exists yet (the Epic 84 one is for arrival notices), so this is the
  // list of words that would claim an SMS already went out. Nothing is sent before approval.
  it.each([
    ['en', 'Next step', 'Publish', /\b(sent|delivered|dispatched)\b/i],
    ['bn', 'পরের ধাপ', 'প্রকাশ করুন', /পাঠানো হয়েছে|পাঠিয়ে দেওয়া হয়েছে|ডেলিভার/],
  ] as const)('uses no never-say words on any step (%s)', async (locale, next, publish, never) => {
    mock();
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID }, 'ADMIN', locale);
    await localeReady;
    await screen.findByDisplayValue('Winter break');
    await user.click(screen.getByRole('checkbox', { name: /SMS/ }));
    expect(document.body.textContent).not.toMatch(never);
    await user.click(screen.getByRole('button', { name: next }));
    await screen.findAllByRole('tab');
    expect(document.body.textContent).not.toMatch(never);
    await user.click(screen.getByRole('button', { name: next }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: publish }).hasAttribute('disabled')).toBe(false),
    );
    expect(document.body.textContent).not.toMatch(never);
    await user.click(screen.getByRole('button', { name: publish }));
    await screen.findByRole('button', { name: /,/ });
    expect(document.body.textContent).not.toMatch(never);
  });

  it('shows an error, not the form, when the notice cannot load', async () => {
    mock();
    server.use(http.get('/api/v1/notices/:id', () => HttpResponse.json({}, { status: 500 })));
    const { localeReady } = mount({ noticeId: ID });
    await localeReady;
    expect(await screen.findByText('Could not load the notice')).toBeTruthy();
    expect(screen.queryByLabelText('Title')).toBeNull();
  });
});

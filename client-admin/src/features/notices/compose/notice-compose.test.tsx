import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
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

const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const FATHER = '44444444-4444-4444-8444-444444444441';
const MOTHER = '44444444-4444-4444-8444-444444444442';
/** A father and a mother of one child, neither with a login: one row each, same student id. */
const parentRow = (guardianId: string, name: string) => ({
  kind: 'GUARDIAN',
  userId: null,
  studentId: STUDENT,
  guardianId,
  name,
  detail: 'Class 6',
  hasLogin: false,
  hasPhone: true,
});

/** People requests as the server would answer: CLASS with no class is a 400 (NEED_PICK). */
function mockPeople(seen: URL[]) {
  server.use(
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: CLASS_ID, name: 'Class 6' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes/:id/sections', () => HttpResponse.json([])),
    http.get('/api/v1/audience/people', ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      if (url.searchParams.get('tab') === 'CLASS' && !url.searchParams.get('classIds'))
        return HttpResponse.json({ message: 'Pick a class' }, { status: 400 });
      if (url.searchParams.get('tab') === 'ROLE' && !url.searchParams.get('roles'))
        return HttpResponse.json({ message: 'Pick a role' }, { status: 400 });
      return HttpResponse.json(
        page([parentRow(FATHER, 'Father A'), parentRow(MOTHER, 'Mother A')]),
      );
    }),
  );
}

async function toAudience(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByDisplayValue('Winter break');
  await user.click(screen.getByRole('button', { name: 'Next step' }));
  await screen.findAllByRole('tab');
}

describe('NoticeCompose audience (#3430)', () => {
  it('guardians wait for a class (no 400), then send classIds without brackets; parents of one child are two rows', async () => {
    mock();
    const seen: URL[] = [];
    mockPeople(seen);
    let added: unknown;
    server.use(
      http.post('/api/v1/notices/:id/recipients', async ({ request }) => {
        added = await request.json();
        return HttpResponse.json({ added: 1, total: 2 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID });
    await localeReady;
    await toAudience(user);

    // Finding 1: no request and no error before a class is picked, only the hint.
    expect(await screen.findByText('Pick a class to see people.')).toBeTruthy();
    expect(screen.queryByText('Could not load people')).toBeNull();
    expect(seen).toEqual([]);

    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 6' }));
    expect((await screen.findAllByText('Father A')).length).toBeGreaterThan(0);
    // Finding 0: `classIds=<id>`, never axios's `classIds[]=<id>` (a 400 on the server).
    const last = seen[seen.length - 1]!;
    expect(last.searchParams.get('classIds')).toBe(CLASS_ID);
    expect(last.search).not.toContain('%5B%5D');
    expect(last.search).not.toContain('[]');
    expect(screen.queryByText('Pick a class to see people.')).toBeNull();

    // Finding 2: ticking the father adds only the father, not the mother who shares his child.
    const table = screen.getByRole('table', { name: 'Matching people' });
    const boxes = within(table).getAllByRole('checkbox');
    await user.click(boxes[boxes.length - 2]!);
    await user.click(screen.getByRole('button', { name: 'Add to chosen list (1)' }));
    await waitFor(() =>
      expect(added).toEqual({
        items: [{ kind: 'GUARDIAN', userId: null, studentId: STUDENT, guardianId: FATHER }],
      }),
    );
  });

  it('the staff tab waits for a role (no 400), then asks with roles', async () => {
    mock();
    const seen: URL[] = [];
    mockPeople(seen);
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID });
    await localeReady;
    await toAudience(user);
    await user.click(screen.getByRole('tab', { name: 'All teachers and staff' }));

    expect(await screen.findByText('Pick a role to see people.')).toBeTruthy();
    expect(screen.queryByText('Could not load people')).toBeNull();
    expect(seen.filter((u) => u.searchParams.get('tab') === 'ROLE')).toEqual([]);

    await user.click(screen.getByRole('combobox', { name: 'Roles' }));
    await user.click(await screen.findByRole('option', { name: 'Teacher' }));
    await waitFor(() =>
      expect(seen.some((u) => u.searchParams.get('roles') === 'TEACHER')).toBe(true),
    );
    expect(screen.queryByText('Pick a role to see people.')).toBeNull();
    expect(screen.queryByText('Could not load people')).toBeNull();
  });
});

describe('NoticeCompose writes (#3430)', () => {
  it('public notice: a failed link after publish never publishes again; Try again asks only for a new link', async () => {
    mock();
    let publishes = 0;
    let links = 0;
    server.use(
      http.get('/api/v1/notices/:id', () => HttpResponse.json(notice({ isPublic: true }))),
      http.post('/api/v1/notices/:id/publish', () => {
        publishes += 1;
        return HttpResponse.json(notice({ status: 'PUBLISHED', isPublic: true }));
      }),
      http.post('/api/v1/notices/:id/public-link', () => {
        links += 1;
        return links === 1
          ? HttpResponse.json({}, { status: 500 })
          : HttpResponse.json({ token: 'tok456' }, { status: 201 });
      }),
    );
    const onPublished = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID, onPublished });
    await localeReady;
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, publish' }));

    expect(
      await screen.findByText('The notice is published, but the public link could not be made.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yes, publish' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const field = await screen.findByRole('textbox', { name: 'Public link' });
    expect((field as HTMLInputElement).value).toContain('/n/tok456');
    expect(publishes).toBe(1);
    expect(links).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onPublished).toHaveBeenCalledWith(ID);
    expect(publishes).toBe(1);
  });

  it('a failed link can be left: Done goes on to the detail page', async () => {
    mock();
    server.use(
      http.get('/api/v1/notices/:id', () => HttpResponse.json(notice({ isPublic: true }))),
      http.post('/api/v1/notices/:id/publish', () =>
        HttpResponse.json(notice({ status: 'PUBLISHED', isPublic: true })),
      ),
      http.post('/api/v1/notices/:id/public-link', () => HttpResponse.json({}, { status: 500 })),
    );
    const onPublished = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID, onPublished });
    await localeReady;
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, publish' }));
    await screen.findByText('The notice is published, but the public link could not be made.');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onPublished).toHaveBeenCalledWith(ID);
  });

  it('the public-link dialog has no Close button that does nothing: Done is the only way out', async () => {
    mock();
    server.use(
      http.get('/api/v1/notices/:id', () => HttpResponse.json(notice({ isPublic: true }))),
      http.post('/api/v1/notices/:id/publish', () =>
        HttpResponse.json(notice({ status: 'PUBLISHED', isPublic: true })),
      ),
      http.post('/api/v1/notices/:id/public-link', () =>
        HttpResponse.json({ token: 'tok789' }, { status: 201 }),
      ),
    );
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID, onPublished: vi.fn() });
    await localeReady;
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, publish' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByDisplayValue(/\/n\/tok789/);
    // The dialog holds the page until the admin has seen the link once, so it ignores Close.
    // A Close button there would be read out and focused but do nothing (Epic 53 audit).
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('edit mode shows the saved files and counts them against the 3-file limit', async () => {
    mock();
    const file = (id: string, name: string) => ({
      id,
      original_name: name,
      mime_type: 'application/pdf',
      size_bytes: 10,
    });
    server.use(
      http.get('/api/v1/notices/:id', () =>
        HttpResponse.json(notice({ files: [file('f1', 'one.pdf'), file('f2', 'two.pdf')] })),
      ),
    );
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID });
    await localeReady;
    expect(await screen.findByText('one.pdf')).toBeTruthy();
    expect(screen.getByText('two.pdf')).toBeTruthy();
    await user.upload(fileInput(), [png('a.png'), png('b.png')]);
    expect(await screen.findByText('At most 3 files')).toBeTruthy();
  });

  it('the first save carries an Idempotency-Key; a resend keeps it, a changed draft gets a new one', async () => {
    mock();
    const keys: (string | null)[] = [];
    let fail = true;
    server.use(
      http.post('/api/v1/notices', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        if (fail) return HttpResponse.json({}, { status: 500 });
        return HttpResponse.json(notice(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { localeReady } = mount();
    await localeReady;
    await user.type(await screen.findByLabelText('Title'), 'Fees');
    await user.type(screen.getByLabelText('Notice text'), 'Pay by Friday.');
    await user.click(screen.getByRole('button', { name: 'Keep as draft' }));
    await screen.findByText('Could not save. Try again.');
    await user.click(screen.getByRole('button', { name: 'Keep as draft' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    fail = false;
    await user.type(screen.getByLabelText('Title'), '!');
    await user.click(screen.getByRole('button', { name: 'Keep as draft' }));
    await screen.findByText('Draft saved');
    expect(keys[2]).toBeTruthy();
    expect(keys[2]).not.toBe(keys[0]);
  });
});

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

  it('public notice: mints the link after publish (no Idempotency-Key) and shows it before leaving', async () => {
    mock();
    let linkKey: string | null | undefined;
    server.use(
      http.get('/api/v1/notices/:id', () => HttpResponse.json(notice({ isPublic: true }))),
      http.post('/api/v1/notices/:id/publish', () =>
        HttpResponse.json(notice({ status: 'PUBLISHED', isPublic: true })),
      ),
      http.post('/api/v1/notices/:id/public-link', ({ request }) => {
        linkKey = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ token: 'tok123' }, { status: 201 });
      }),
    );
    const onPublished = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = mount({ noticeId: ID, onPublished });
    await localeReady;
    await toReview(user);
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, publish' }));
    const field = await screen.findByRole('textbox', { name: 'Public link' });
    expect((field as HTMLInputElement).value).toContain('/n/tok123');
    expect(linkKey).toBeNull();
    expect(onPublished).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onPublished).toHaveBeenCalledWith(ID);
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
      'Failed an exam',
      'Fee due',
      'Low attendance',
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

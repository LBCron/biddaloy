import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const INTAKE = {
  id: 'intake-1',
  title: 'Class 1, 2026',
  seat_count: 30,
  open_date: '2026-01-01',
  close_date: '2026-12-31',
  required_document_types: ['PHOTO'],
};

/** [27.8] Public, no-login form — same "no auth call, `renderWithRouter`
 * with no session" shape as `client-admin/src/routes/i/$token.test.tsx`. */
describe('/admission/$slug public form', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the form for an open intake and submits, showing the reference number', async () => {
    server.use(
      http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([INTAKE])),
      http.post('/api/v1/public/admission/:slug/applicants', () =>
        HttpResponse.json({ reference_number: 'ADM-2026-000001', status: 'PENDING' }),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school'], locale: 'en' });

    await waitFor(() => expect(screen.getByLabelText(/Student's full name/)).toBeTruthy());

    // Native selects and date boxes are gone; the round's facts come first.
    expect(
      document.querySelector('select:not([aria-hidden="true"]), input[type="date"]'),
    ).toBeNull();
    expect(screen.getByText('Last day to apply')).toBeTruthy();
    expect(screen.getByText('Papers you need')).toBeTruthy();
    expect(screen.queryByText(/2026-12-31/)).toBeNull();

    await user.type(screen.getByLabelText(/Student's full name/), 'Rahim Ahmed');
    // DatePicker: open it, pick the 1st of the current month (always in the past or today).
    await user.click(screen.getByRole('button', { name: /^Student's date of birth, / }));
    const now = new Date();
    const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    await user.click(
      await waitFor(() => {
        const el = document.querySelector<HTMLElement>(`[data-date="${firstOfMonth}"]`);
        if (!el) throw new Error('calendar not open');
        return el;
      }),
    );
    await user.click(screen.getByRole('combobox', { name: /Student's gender/ }));
    await user.click(await screen.findByRole('option', { name: 'Boy' }));
    await user.type(screen.getByLabelText(/Parent\/guardian's name/), 'Karim Ahmed');
    await user.type(screen.getByLabelText(/Parent\/guardian's phone number/), '1712345678');

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText("Student's photo"), file);
    // the chosen file shows as a row with a labelled remove button
    expect(await screen.findByText('photo.jpg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove photo.jpg' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    await waitFor(() => expect(screen.getByTestId('reference-number')).toBeTruthy());
    expect(
      within(screen.getByTestId('reference-number')).getByText('ADM-2026-000001'),
    ).toBeTruthy();
  });

  it('submitting an empty form shows an error under each gap, focuses the first, sends nothing', async () => {
    let posts = 0;
    server.use(
      http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([INTAKE])),
      http.post('/api/v1/public/admission/:slug/applicants', () => {
        posts += 1;
        return HttpResponse.json({ reference_number: 'X', status: 'PENDING' });
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school'], locale: 'en' });
    await waitFor(() => expect(screen.getByLabelText(/Student's full name/)).toBeTruthy());

    // the button is never greyed out: pressing it explains what is missing
    const submit = screen.getByRole('button', { name: 'Submit application' });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);

    // name, date of birth, guardian name, guardian phone
    expect(await screen.findAllByText('Please fill this in.')).toHaveLength(4);
    expect(screen.getAllByText('Please add this file.')).toHaveLength(1);
    // gender only (the round is auto-picked when it is the single open round)
    expect(screen.getAllByText('Please choose one.')).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByLabelText(/Student's full name/));
    expect(screen.getByLabelText(/Student's full name/).getAttribute('aria-invalid')).toBe('true');
    expect(posts).toBe(0);

    // typing clears that field's error
    await user.type(screen.getByLabelText(/Student's full name/), 'R');
    expect(screen.getByLabelText(/Student's full name/).getAttribute('aria-invalid')).toBeNull();
  });

  async function fillValidExceptDocument(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Student's full name/), 'Rahim Ahmed');
    await user.click(screen.getByRole('button', { name: /^Student's date of birth, / }));
    const now = new Date();
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    await user.click(
      await waitFor(() => {
        const el = document.querySelector<HTMLElement>(`[data-date="${first}"]`);
        if (!el) throw new Error('calendar not open');
        return el;
      }),
    );
    await user.click(screen.getByRole('combobox', { name: /Student's gender/ }));
    await user.click(await screen.findByRole('option', { name: 'Boy' }));
    await user.type(screen.getByLabelText(/Parent\/guardian's name/), 'Karim Ahmed');
    await user.type(screen.getByLabelText(/Parent\/guardian's phone number/), '1712345678');
  }

  it('explains an invalid phone number and a bad email, focusing the first', async () => {
    server.use(http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([INTAKE])));
    const user = userEvent.setup();
    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school'], locale: 'en' });
    await waitFor(() => expect(screen.getByLabelText(/Student's full name/)).toBeTruthy());
    await fillValidExceptDocument(user);
    const phone = screen.getByLabelText(/Parent\/guardian's phone number/);
    await user.clear(phone);
    await user.type(phone, '123');
    await user.type(screen.getByLabelText(/Parent\/guardian's email/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    expect(await screen.findByText(/Enter a correct mobile number/)).toBeTruthy();
    expect(screen.getByText('Enter a correct email address.')).toBeTruthy();
    expect(document.activeElement).toBe(phone);
  });

  it('focuses the document field when it is the first gap, and keeps focus there after Remove', async () => {
    server.use(http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([INTAKE])));
    const user = userEvent.setup();
    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school'], locale: 'en' });
    await waitFor(() => expect(screen.getByLabelText(/Student's full name/)).toBeTruthy());
    await fillValidExceptDocument(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    const group = await screen.findByRole('group', { name: /Student's photo/ });
    expect(document.activeElement).toBe(group);
    expect(group.getAttribute('aria-invalid')).toBe('true');

    await user.upload(
      screen.getByLabelText("Student's photo"),
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Remove photo.jpg' }));
    expect(screen.queryByText('photo.jpg')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('group', { name: /Student's photo/ }));
  });

  it('links to the status page from the form', async () => {
    server.use(http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([INTAKE])));
    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school'], locale: 'en' });
    const link = await screen.findByRole('link', { name: 'Applied before? Check your status' });
    expect(link.getAttribute('href')).toBe('/admission/a-school/status');
  });

  it('shows a school-not-found message for an unknown slug', async () => {
    server.use(
      http.get(
        '/api/v1/public/admission/:slug',
        () =>
          new HttpResponse(
            JSON.stringify({
              statusCode: 404,
              message: 'School not found',
              timestamp: new Date().toISOString(),
              path: '/api/v1/public/admission/unknown',
              requestId: 'req-1',
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    renderWithRouter(routeTree, { initialEntries: ['/admission/unknown'], locale: 'en' });

    await waitFor(() =>
      expect(
        screen.getByText("We couldn't find this school. Please check the link and try again."),
      ).toBeTruthy(),
    );
  });

  it('shows a no-open-intakes message when the school has none open', async () => {
    server.use(http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([])));

    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school'], locale: 'en' });

    await waitFor(() =>
      expect(
        screen.getByText("This school isn't accepting new applications right now."),
      ).toBeTruthy(),
    );
  });
});

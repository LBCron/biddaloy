import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The form has a "check status" Link; there is no router in this test.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

const INTAKE: {
  id: string;
  title: string;
  seat_count: number;
  open_date: string;
  close_date: string;
  required_document_types: string[];
} = {
  id: 'intake-1',
  title: 'Class 1, 2026',
  seat_count: 30,
  open_date: '2026-01-01',
  close_date: '2026-12-31',
  required_document_types: [],
};

afterEach(async () => {
  vi.doUnmock('../registration/turnstile');
  vi.resetModules();
  await cleanupTestState();
});

/** Loads the form with the Turnstile module stubbed: `siteKey` '' means "no widget". */
async function setup(
  siteKey: string,
  {
    intake = INTAKE,
    status = 200,
    failure,
  }: {
    intake?: typeof INTAKE;
    status?: number;
    failure?: { status: number; code?: string };
  } = {},
) {
  vi.doMock('../registration/turnstile', () => ({
    TURNSTILE_SITE_KEY: siteKey,
    NO_CAPTCHA_TOKEN: 'no-captcha',
    Turnstile: ({ onToken }: { onToken: (t: string | null) => void }) => (
      <button type="button" data-testid="solve-captcha" onClick={() => onToken('tok')} />
    ),
  }));
  const { PublicAdmissionForm } = await import('./PublicAdmissionForm');
  const posted: string[] = [];
  const phones: string[] = [];
  server.use(
    http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([intake])),
    http.post('/api/v1/public/admission/:slug/applicants', async ({ request }) => {
      const fd = await request.formData();
      posted.push(fd.get('captcha_token') as string);
      phones.push(fd.get('guardian_phone') as string);
      if (failure)
        return HttpResponse.json(
          {
            statusCode: failure.status,
            message: 'refused',
            timestamp: '2026-01-01T00:00:00.000Z',
            path: '/api/v1/public/admission/a-school/applicants',
            requestId: 'req-1',
            ...(failure.code ? { details: { code: failure.code } } : {}),
          },
          { status: failure.status },
        );
      if (status === 503)
        return HttpResponse.json(
          {
            statusCode: 503,
            message: 'Registration is temporarily unavailable',
            timestamp: '2026-01-01T00:00:00.000Z',
            path: '/api/v1/public/admission/a-school/applicants',
            requestId: 'req-1',
            details: { code: 'REGISTRATION_UNAVAILABLE' },
          },
          { status: 503 },
        );
      if (status === 400)
        return HttpResponse.json(
          {
            statusCode: 400,
            message: 'Captcha verification failed',
            timestamp: '2026-01-01T00:00:00.000Z',
            path: '/api/v1/public/admission/a-school/applicants',
            requestId: 'req-1',
            details: { code: 'CAPTCHA_FAILED' },
          },
          { status: 400 },
        );
      return HttpResponse.json({ reference_number: 'ADM-2026-000001', status: 'PENDING' });
    }),
  );
  const view = renderWithProviders(<PublicAdmissionForm slug="a-school" onSubmitted={vi.fn()} />, {
    locale: 'en',
  });
  await view.localeReady;
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText(/Student's full name/)).toBeTruthy());
  return { user, posted, phones };
}

async function fillValid(user: ReturnType<typeof userEvent.setup>, phone = '1712345678') {
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
  await user.type(screen.getByLabelText(/Parent\/guardian's phone number/), phone);
}

describe('PublicAdmissionForm captcha', () => {
  it('sends the guardian phone as digits with a leading 0 (server BD_PHONE_REGEX)', async () => {
    const { user, phones } = await setup('');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(phones).toEqual(['01712345678']));
  });

  it('sends a phone typed in Bengali digits as Latin digits', async () => {
    const { user, phones } = await setup('');
    await fillValid(user, '১৭১২৩৪৫৬৭৮');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(phones).toEqual(['01712345678']));
  });

  it('blocks a submit with no token and shows the captcha message', async () => {
    const { user, posted } = await setup('test-key');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText('Please complete the check above.')).toBeTruthy();
    expect(posted).toEqual([]);
  });

  it('sends the solved token', async () => {
    const { user, posted } = await setup('test-key');
    await fillValid(user);
    await user.click(screen.getByTestId('solve-captcha'));
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(posted).toEqual(['tok']));
  });

  it('sends the no-captcha token when there is no site key', async () => {
    const { user, posted } = await setup('');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(posted).toEqual(['no-captcha']));
  });

  it('focuses a missing document before the missing captcha', async () => {
    const { user, posted } = await setup('test-key', {
      intake: { ...INTAKE, required_document_types: ['PHOTO'] },
    });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText('Please complete the check above.')).toBeTruthy();
    expect(document.activeElement?.id).toBe('doc-photo');
    expect(posted).toEqual([]);
  });

  it('focuses the captcha when it is the only error', async () => {
    const { user } = await setup('test-key');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await screen.findByText('Please complete the check above.');
    expect(document.activeElement?.id).toBe('captcha');
  });

  it('clears the captcha message once a token arrives', async () => {
    const { user } = await setup('test-key');
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await screen.findByText('Please complete the check above.');
    await user.click(screen.getByTestId('solve-captcha'));
    expect(screen.queryByText('Please complete the check above.')).toBeNull();
  });

  it('says applications are unavailable on a 503', async () => {
    const { user, posted } = await setup('', { status: 503 });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText(/Applications can't be sent right now/)).toBeTruthy();
    expect(screen.queryByText(/check your answers/)).toBeNull();
    expect(posted).toEqual(['no-captcha']);
  });

  it('asks for the check again (not the answers) when Cloudflare rejects the token', async () => {
    const { user, posted } = await setup('test-key', { status: 400 });
    await fillValid(user);
    await user.click(screen.getByTestId('solve-captcha'));
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText(/The robot check didn't go through/)).toBeTruthy();
    expect(screen.queryByText(/check your answers/)).toBeNull();
    expect(posted).toEqual(['tok']);
  });
});

describe('PublicAdmissionForm refusal reasons [2879]', () => {
  async function submitWith(failure: { status: number; code?: string }) {
    const { user } = await setup('', { failure });
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
  }

  it('a 409 DUPLICATE_APPLICATION shows the duplicate text', async () => {
    await submitWith({ status: 409, code: 'DUPLICATE_APPLICATION' });
    expect(await screen.findByText(/could not be accepted/)).toBeTruthy();
    expect(screen.queryByText(/check your answers/)).toBeNull();
  });

  it('a 400 INTAKE_FULL shows the no-seats text', async () => {
    await submitWith({ status: 400, code: 'INTAKE_FULL' });
    expect(await screen.findByText('This admission round has no seats left.')).toBeTruthy();
  });

  it('a 400 INTAKE_CLOSED shows the closed text', async () => {
    await submitWith({ status: 400, code: 'INTAKE_CLOSED' });
    expect(
      await screen.findByText('This admission round is not taking applications now.'),
    ).toBeTruthy();
  });

  it('an unknown 400 still shows the generic line', async () => {
    await submitWith({ status: 400 });
    expect(await screen.findByText(/check your answers/)).toBeTruthy();
  });
});

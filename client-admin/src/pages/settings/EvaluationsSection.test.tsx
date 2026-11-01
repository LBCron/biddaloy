import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EvaluationsSection } from './EvaluationsSection';
import { WithTestRouter } from './with-test-router';

const SERVER_TEXT = 'SERVER_SECRET_TEXT';
const failing = (path: string, method: 'patch' | 'put' | 'post' = 'patch') =>
  http[method](path, () =>
    HttpResponse.json(
      {
        statusCode: 400,
        message: SERVER_TEXT,
        timestamp: new Date().toISOString(),
        path,
        requestId: 'r',
      },
      { status: 400 },
    ),
  );

const SCHOOL_ID = 'school-1';
const LABEL = 'Send an SMS when a new incident report is filed';
const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: SCHOOL_ID };

describe('EvaluationsSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('defaults off and shows the privacy copy', async () => {
    renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection schoolId={SCHOOL_ID} evaluations={undefined} />
      </WithTestRouter>,
      opts,
    );
    const box = await screen.findByLabelText(LABEL);
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByText(
        'The SMS says only that a new report exists, never what it says. Push notifications are always on.',
      ),
    ).toBeTruthy();
  });

  it('with no provider: a warning badge, a link to Communication, and an alert when the toggle is on', async () => {
    renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection schoolId={SCHOOL_ID} evaluations={{ incidentSmsEnabled: true }} />
      </WithTestRouter>,
      opts,
    );
    expect(await screen.findByText('No SMS company added.')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Communication › add SMS company' }).getAttribute('href'),
    ).toBe('/settings?section=communication');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Incident SMS will not be sent until an SMS company is added in Communication.',
    );
  });

  // PR #3325 review round 2, finding 8: while the providers query loads (or if it fails) the
  // answer is unknown, so a school that has SMS must not see "No SMS company added." flash.
  it('with an unknown provider state (null): no badge, no link and no alert', async () => {
    renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection
          schoolId={SCHOOL_ID}
          evaluations={{ incidentSmsEnabled: true }}
          smsConfigured={null}
        />
      </WithTestRouter>,
      opts,
    );
    await screen.findByLabelText(LABEL);
    expect(screen.queryByText('No SMS company added.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Communication › add SMS company' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('with a provider: a success badge, no link and no alert', async () => {
    renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection
          schoolId={SCHOOL_ID}
          evaluations={{ incidentSmsEnabled: true }}
          smsConfigured
        />
      </WithTestRouter>,
      opts,
    );
    expect(await screen.findByText('SMS company added')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Communication › add SMS company' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('saves only the evaluations slice with the flag on', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );
    const { user } = renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection schoolId={SCHOOL_ID} evaluations={undefined} />
      </WithTestRouter>,
      opts,
    );
    await user.click(await screen.findByLabelText(LABEL));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0]).toEqual({
      version: 1,
      evaluations: { incidentSmsEnabled: true },
    });
  });

  it('renders checked from stored true and saves false after unchecking', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );
    const { user } = renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection schoolId={SCHOOL_ID} evaluations={{ incidentSmsEnabled: true }} />
      </WithTestRouter>,
      opts,
    );
    const box = await screen.findByLabelText(LABEL);
    expect(box.getAttribute('aria-checked')).toBe('true');
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0]).toEqual({
      version: 1,
      evaluations: { incidentSmsEnabled: false },
    });
  });

  it('shows a translated error, never the server text, when the save fails', async () => {
    server.use(failing('/api/v1/schools/:id/settings'));
    const { user } = renderWithProviders(
      <WithTestRouter>
        <EvaluationsSection schoolId={SCHOOL_ID} evaluations={undefined} smsConfigured />
      </WithTestRouter>,
      opts,
    );

    await user.click(await screen.findByLabelText(LABEL));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
    expect(screen.queryByText(SERVER_TEXT)).toBeNull();
  });
});

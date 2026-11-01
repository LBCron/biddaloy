import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providersHandler } from './provider-config-form.fixtures';
import { WhatsAppSection } from './WhatsAppSection';

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
const OPTS = { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID } as const;
const SAVED = {
  'meta-cloud': {
    phoneNumberId: '123456',
    apiVersion: 'v21.0',
    accessToken: { configured: true, hint: '••••oken' },
  },
};
const UNSECURED = { 'meta-cloud': { phoneNumberId: '123456', apiVersion: 'v21.0' } };

describe('WhatsAppSection', () => {
  beforeEach(() => {
    server.use(providersHandler({ WHATSAPP: true }));
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it("keeps today's labels", async () => {
    renderWithProviders(<WhatsAppSection schoolId={SCHOOL_ID} whatsapp={SAVED} />, OPTS);
    expect(await screen.findByLabelText(/^Phone number ID/)).toBeTruthy();
    expect(screen.getByText('Access token')).toBeTruthy();
    expect(screen.getByLabelText('API version (optional)')).toBeTruthy();
  });

  it('shows the masked hint for an already-configured token, never the plaintext', async () => {
    renderWithProviders(<WhatsAppSection schoolId={SCHOOL_ID} whatsapp={SAVED} />, OPTS);

    expect(await screen.findByText('Added — ends ••••oken')).toBeTruthy();
    expect(screen.queryByLabelText('Access token')).toBeNull();
  });

  it('saves a new access token typed after clicking Replace, then shows a success message', async () => {
    const { user } = renderWithProviders(
      <WhatsAppSection schoolId={SCHOOL_ID} whatsapp={SAVED} />,
      OPTS,
    );

    await user.click(await screen.findByRole('button', { name: 'Change' }));
    await user.type(await screen.findByLabelText('Access token'), 'new-token-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
  });

  it('runs a connection test and shows the result, without saving anything', async () => {
    const { user } = renderWithProviders(
      <WhatsAppSection schoolId={SCHOOL_ID} whatsapp={SAVED} />,
      OPTS,
    );

    await user.click(await screen.findByRole('button', { name: 'Test connection' }));

    await waitFor(() => {
      expect(screen.getByText('Connection works')).toBeTruthy();
    });
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('shows a translated failure badge and never the server message', async () => {
    server.use(
      http.post('/api/v1/schools/:id/settings/test', () =>
        HttpResponse.json({ success: false, message: 'bad token' }),
      ),
    );
    const { user } = renderWithProviders(
      <WhatsAppSection schoolId={SCHOOL_ID} whatsapp={UNSECURED} />,
      OPTS,
    );

    await user.click(await screen.findByRole('button', { name: 'Test connection' }));

    expect(
      await screen.findByText("Couldn't connect — check the details and try again."),
    ).toBeTruthy();
    expect(screen.queryByText('bad token')).toBeNull();
  });

  it('shows the set-up state the server reports', async () => {
    renderWithProviders(<WhatsAppSection schoolId={SCHOOL_ID} whatsapp={SAVED} />, OPTS);
    expect(await screen.findByText('Set up')).toBeTruthy();
    await cleanupTestState();

    server.use(providersHandler({ WHATSAPP: false }));
    renderWithProviders(<WhatsAppSection schoolId={SCHOOL_ID} whatsapp={UNSECURED} />, OPTS);
    expect(await screen.findByText('Not set up')).toBeTruthy();
  });

  it('shows a translated error, never the server text, when save or test fails', async () => {
    server.use(
      failing('/api/v1/schools/:id/settings'),
      failing('/api/v1/schools/:id/settings/test', 'post'),
    );
    const { user } = renderWithProviders(
      <WhatsAppSection schoolId={SCHOOL_ID} whatsapp={UNSECURED} />,
      OPTS,
    );

    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.queryByText(SERVER_TEXT)).toBeNull();
  });
});

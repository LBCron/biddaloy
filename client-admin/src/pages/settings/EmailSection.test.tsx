import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailSection } from './EmailSection';
import { providersHandler } from './provider-config-form.fixtures';

const SCHOOL_ID = 'school-1';

const CONFIGURED_EMAIL = {
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    user: 'noreply',
    from: 'noreply@example.com',
    password: { configured: true, hint: '••••pass' },
  },
};

describe('EmailSection', () => {
  beforeEach(() => {
    server.use(providersHandler({ EMAIL: true }));
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it("keeps today's labels", async () => {
    renderWithProviders(<EmailSection schoolId={SCHOOL_ID} email={CONFIGURED_EMAIL} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });
    for (const label of [
      'Send emails from',
      'Email server (SMTP)',
      'Server username',
      'Server password',
      'Port',
    ]) {
      // A text matcher, not a RegExp built from the label (CodeQL js/incomplete-sanitization).
      expect(await screen.findByText((text) => text.startsWith(label))).toBeTruthy();
    }
  });

  it('runs the connection test with the current form values', async () => {
    const testBody = vi.fn();
    server.use(
      http.post('/api/v1/schools/:id/settings/test', async ({ request }) => {
        testBody(await request.json());
        return HttpResponse.json({ success: true, message: 'Connected.' });
      }),
    );

    const { user } = renderWithProviders(
      <EmailSection schoolId={SCHOOL_ID} email={CONFIGURED_EMAIL} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await user.click(await screen.findByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(testBody).toHaveBeenCalled());
    expect(testBody.mock.calls[0]![0]).toEqual({
      medium: 'EMAIL',
      config: {
        smtp: { host: 'smtp.example.com', port: 587, user: 'noreply', from: 'noreply@example.com' },
      },
    });
  });

  it('does not run the connection test with an invalid, unsaved from address', async () => {
    const testBody = vi.fn();
    server.use(
      http.post('/api/v1/schools/:id/settings/test', async ({ request }) => {
        testBody(await request.json());
        return HttpResponse.json({ success: true, message: 'ok' });
      }),
    );
    const { user } = renderWithProviders(
      <EmailSection schoolId={SCHOOL_ID} email={CONFIGURED_EMAIL} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const from = await screen.findByLabelText(/^Send emails from/);
    await user.clear(from);
    await user.type(from, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Check this value.')).toBeTruthy();
    expect(testBody).not.toHaveBeenCalled();
  });

  it('accepts a port typed in Bangla digits', async () => {
    const testBody = vi.fn();
    server.use(
      http.post('/api/v1/schools/:id/settings/test', async ({ request }) => {
        testBody(await request.json());
        return HttpResponse.json({ success: true, message: 'ok' });
      }),
    );
    const { user } = renderWithProviders(
      <EmailSection schoolId={SCHOOL_ID} email={CONFIGURED_EMAIL} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    const port = await screen.findByLabelText('Port');
    await user.clear(port);
    await user.type(port, '৪৬৫');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(testBody).toHaveBeenCalled());
    expect(testBody.mock.calls[0]![0].config.smtp.port).toBe(465);
  });
});

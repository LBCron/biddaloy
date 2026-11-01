import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providersHandler } from './provider-config-form.fixtures';
import { SmsSection } from './SmsSection';

const SCHOOL_ID = 'school-1';
const OPTS = { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID } as const;

describe('SmsSection', () => {
  beforeEach(() => {
    server.use(providersHandler({ SMS: true }));
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it("keeps today's labels and lists OneCodeSoft as a third company", async () => {
    const { user } = renderWithProviders(
      <SmsSection
        schoolId={SCHOOL_ID}
        sms={{ provider: 'greenweb', greenweb: { apiKey: { configured: true, hint: '••••key1' } } }}
      />,
      OPTS,
    );

    expect(await screen.findByLabelText('SMS company')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'SMS' })).toBeTruthy();
    expect(screen.getByText('All SMS from this school go through this company.')).toBeTruthy();
    expect(screen.getByLabelText('SMS company')).toBeTruthy();
    expect(screen.getByText('API key')).toBeTruthy();
    expect(screen.getByLabelText('API address (optional)')).toBeTruthy();

    await user.click(screen.getByLabelText('SMS company'));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['Greenweb', 'MimSMS', 'OneCodeSoft']);
    await user.click(screen.getByRole('option', { name: 'MimSMS' }));
    expect(await screen.findByLabelText(/^Sender name \(Sender ID\)/)).toBeTruthy();
  });

  it('shows "Set up" from the server, and "Not set up" when it says not configured', async () => {
    renderWithProviders(<SmsSection schoolId={SCHOOL_ID} sms={undefined} />, OPTS);
    expect(await screen.findByText('Set up')).toBeTruthy();
    await cleanupTestState();

    server.use(providersHandler({ SMS: false }));
    renderWithProviders(<SmsSection schoolId={SCHOOL_ID} sms={undefined} />, OPTS);
    expect(await screen.findByText('Not set up')).toBeTruthy();
  });
});

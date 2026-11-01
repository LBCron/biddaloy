import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The last value the form passed to the unsaved-changes guard (finding 7 of the PR #3325 review).
const warnUnsaved = vi.hoisted(() => vi.fn());
vi.mock('@biddaloy/ui/shells', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@biddaloy/ui/shells')>()),
  useWarnUnsavedChanges: warnUnsaved,
}));

import {
  GREENWEB,
  MIMSMS,
  ONECODESOFT,
  providersHandler,
  providersResponse,
} from './provider-config-form.fixtures';
import { ProviderConfigForm, type MessagingMedium } from './ProviderConfigForm';
import { WithTestRouter } from './with-test-router';

const CARD = 'Card';
const SCHOOL_ID = 'school-1';
const OPTS = { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID } as const;

function renderForm(medium: MessagingMedium, saved: Record<string, unknown> | undefined) {
  return renderWithProviders(
    <WithTestRouter>
      <ProviderConfigForm
        medium={medium}
        schoolId={SCHOOL_ID}
        saved={saved}
        sectionId="x-section"
        title={CARD}
        description="Card description"
      />
    </WithTestRouter>,
    OPTS,
  );
}

function captureSave() {
  const body = vi.fn();
  server.use(
    http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
      body(await request.json());
      return HttpResponse.json({ version: 1, region: {}, communications: {} });
    }),
  );
  return body;
}

const SAVED_SMS = {
  provider: 'greenweb',
  greenweb: { apiKey: { configured: true, hint: '••••key1' } },
  mimsms: { senderId: 'OLD', apiKey: { configured: true, hint: '••••mim1' } },
};

describe('ProviderConfigForm', () => {
  beforeEach(() => {
    server.use(providersHandler({ SMS: true }));
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it("renders the selected company's fields from the descriptor, API address only under Advanced", async () => {
    const { container } = renderForm('SMS', SAVED_SMS);

    expect(await screen.findByLabelText('SMS company')).toBeTruthy();
    expect(screen.getByText('Added — ends ••••key1')).toBeTruthy();
    expect(screen.getByText('Set up')).toBeTruthy();
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.contains(screen.getByLabelText('API address (optional)'))).toBe(true);
    // help text is looked up from help.messaging.<company>.<field>
    expect(screen.getByText("Leave empty to use the company's own address.")).toBeTruthy();
  });

  it('offers OneCodeSoft and shows its API address help', async () => {
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByLabelText('SMS company'));
    await user.click(await screen.findByRole('option', { name: 'OneCodeSoft' }));

    expect(await screen.findByLabelText(/^API address/)).toBeTruthy();
    expect(
      screen.getByText(
        'Copy the base address from OneCodeSoft Dashboard › API. It must end with /api.',
      ),
    ).toBeTruthy();
  });

  it('omits an untouched secret, sends a typed one, and sends null for Remove', async () => {
    const body = captureSave();
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalledTimes(1));
    expect(body.mock.calls[0]![0].communications.sms).toEqual({
      provider: 'greenweb',
      greenweb: {},
    });

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.type(await screen.findByLabelText('API key'), 'typed-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalledTimes(2));
    expect(body.mock.calls[1]![0].communications.sms.greenweb.apiKey).toBe('typed-key');
  });

  it('sends null when the secret is removed', async () => {
    const body = captureSave();
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body.mock.calls[0]![0].communications.sms.greenweb.apiKey).toBeNull();
  });

  // #3331: the PATCH keeps a left-out field, so a cleared saved optional field must go out as null.
  describe('clearing a saved optional field', () => {
    const SAVED_OCS = {
      provider: 'onecodesoft',
      onecodesoft: {
        senderId: 'OLD',
        apiUrl: 'https://sms.example/api',
        apiKey: { configured: true, hint: '••••ocs1' },
      },
    };

    it('sends null for a cleared saved field, and leaves out one that was never saved', async () => {
      server.use(providersHandler({ SMS: true }, 'onecodesoft'));
      const body = captureSave();
      const { user } = renderForm('SMS', SAVED_OCS);

      await user.clear(await screen.findByLabelText(/^Sender name/));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(body).toHaveBeenCalledTimes(1));
      expect(body.mock.calls[0]![0].communications.sms).toEqual({
        provider: 'onecodesoft',
        onecodesoft: { senderId: null, apiUrl: 'https://sms.example/api' },
      });
    });

    // #3338: Remove plus clearing the saved address leaves nothing of the school's own, which the
    // server reads as "back on the platform account".
    it('Remove + clear the saved address sends a block of nulls', async () => {
      const body = captureSave();
      const { user, container } = renderForm('SMS', {
        provider: 'greenweb',
        greenweb: {
          apiKey: { configured: true, hint: '••••key1' },
          apiUrl: 'https://g.example/api',
        },
      });

      await user.click(await screen.findByRole('button', { name: 'Remove' }));
      await user.click(container.querySelector('summary')!);
      await user.clear(screen.getByLabelText('API address (optional)'));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(body).toHaveBeenCalledTimes(1));
      expect(body.mock.calls[0]![0].communications.sms).toEqual({
        provider: 'greenweb',
        greenweb: { apiKey: null, apiUrl: null },
      });
    });

    it('a value saved in this session and then cleared also goes out as null', async () => {
      server.use(providersHandler({ SMS: true }, 'onecodesoft'));
      const body = captureSave();
      const { user } = renderForm('SMS', {
        provider: 'onecodesoft',
        onecodesoft: { apiUrl: 'https://sms.example/api' },
      });

      const sender = await screen.findByLabelText(/^Sender name/);
      await user.type(sender, 'NEW');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(body).toHaveBeenCalledTimes(1));
      expect(body.mock.calls[0]![0].communications.sms.onecodesoft.senderId).toBe('NEW');

      await user.clear(sender);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(body).toHaveBeenCalledTimes(2));
      expect(body.mock.calls[1]![0].communications.sms.onecodesoft.senderId).toBeNull();
    });
  });

  // #3338: MimSMS's senderId is required, so clearing fields one by one can never empty the block.
  // "Remove saved details" drops every company of the medium, which puts the school back on the
  // platform account.
  describe('remove saved details', () => {
    it('after a confirm, sends provider null and null for every company, then closes the dialog', async () => {
      server.use(providersHandler({ SMS: true }, 'mimsms'));
      const body = captureSave();
      const { user } = renderForm('SMS', {
        provider: 'mimsms',
        mimsms: { senderId: 'OLD', apiKey: { configured: true, hint: '••••mim1' } },
      });

      await user.click(await screen.findByRole('button', { name: 'Remove saved details' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(body).not.toHaveBeenCalled();
      server.use(providersHandler({ SMS: false }, null));
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

      await waitFor(() => expect(body).toHaveBeenCalledTimes(1));
      expect(body.mock.calls[0]![0].communications.sms).toEqual({
        provider: null,
        greenweb: null,
        mimsms: null,
        onecodesoft: null,
      });
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    });

    // Review round 1 on #3347: the settings are fetched once after a removal, not twice.
    it('fetches the providers once after a removal', async () => {
      server.use(providersHandler({ SMS: true }, 'mimsms'));
      captureSave();
      const { user } = renderForm('SMS', {
        provider: 'mimsms',
        mimsms: { senderId: 'OLD', apiKey: { configured: true, hint: '••••mim1' } },
      });
      await user.click(await screen.findByRole('button', { name: 'Remove saved details' }));
      const dialog = await screen.findByRole('alertdialog');
      let gets = 0;
      server.use(
        http.get('/api/v1/schools/:id/settings/messaging/providers', () => {
          gets += 1;
          return HttpResponse.json(providersResponse({ SMS: false }, null));
        }),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      // The form remounts (its "Saved" line goes) only after the refetch has answered, so by then
      // every GET this removal caused has been made.
      await waitFor(() => expect(gets).toBeGreaterThan(0));
      await waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
      expect(gets).toBe(1);
    });

    // Review round 2 on #3347 (nit 7): when the refetch after a removal fails, the card shows the
    // load error. It never redraws the form from the old answer (the removed company as saved).
    it('shows the load error, not the old form, when the refetch after a removal fails', async () => {
      server.use(providersHandler({ SMS: true }, 'mimsms'));
      captureSave();
      const { user } = renderForm('SMS', {
        provider: 'mimsms',
        mimsms: { senderId: 'OLD', apiKey: { configured: true, hint: '••••mim1' } },
      });
      await user.click(await screen.findByRole('button', { name: 'Remove saved details' }));
      const dialog = await screen.findByRole('alertdialog');
      server.use(
        http.get('/api/v1/schools/:id/settings/messaging/providers', () =>
          HttpResponse.json({ message: 'down' }, { status: 500 }),
        ),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

      expect(
        await screen.findByText("Couldn't load the company settings. Try again."),
      ).toBeTruthy();
      expect(screen.queryByLabelText('SMS company')).toBeNull();
    });

    // Review round 1 on #3347: a failed removal says so inside the open dialog, not behind it.
    it('shows a failed removal inside the dialog and keeps it open', async () => {
      server.use(providersHandler({ SMS: true }, 'mimsms'));
      server.use(
        http.patch('/api/v1/schools/:id/settings', () =>
          HttpResponse.json({ message: 'boom' }, { status: 500 }),
        ),
      );
      const { user } = renderForm('SMS', {
        provider: 'mimsms',
        mimsms: { senderId: 'OLD', apiKey: { configured: true, hint: '••••mim1' } },
      });
      await user.click(await screen.findByRole('button', { name: 'Remove saved details' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

      expect(await within(dialog).findByText(/Couldn't save\. Try again\./)).toBeTruthy();
      expect(screen.getByRole('alertdialog')).toBe(dialog);
    });

    it('is not offered when nothing is saved', async () => {
      server.use(providersHandler({ SMS: false }, null));
      renderForm('SMS', undefined);
      expect(await screen.findByLabelText('SMS company')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Remove saved details' })).toBeNull();
    });
  });

  it('shows an inline required error and does not save', async () => {
    server.use(providersHandler({ SMS: false }, 'mimsms'));
    const body = captureSave();
    const { user } = renderForm('SMS', { provider: 'mimsms', mimsms: {} });

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Fill in this field.')).toBeTruthy();
    expect(body).not.toHaveBeenCalled();
  });

  it('sends only the chosen company, so other saved companies stay untouched', async () => {
    const body = captureSave();
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByLabelText('SMS company'));
    await user.click(await screen.findByRole('option', { name: 'MimSMS' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalled());
    const sms = body.mock.calls[0]![0].communications.sms;
    expect(sms.provider).toBe('mimsms');
    expect(sms.mimsms.senderId).toBe('OLD');
    expect(sms.greenweb).toBeUndefined();
  });

  it('keeps a typed key when switching company and back', async () => {
    const body = captureSave();
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.click(await screen.findByRole('button', { name: 'Change' }));
    await user.type(await screen.findByLabelText('API key'), 'gw-typed-key');
    await user.click(screen.getByLabelText('SMS company'));
    await user.click(await screen.findByRole('option', { name: 'MimSMS' }));
    await user.click(screen.getByLabelText('SMS company'));
    await user.click(await screen.findByRole('option', { name: 'Greenweb' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body.mock.calls[0]![0].communications.sms.greenweb.apiKey).toBe('gw-typed-key');
  });

  // PR #3325 review round 3, finding 1: a school on the platform account saved no company, and its
  // SMS goes through the platform's SMS_PROVIDER. The first listed company must not override it.
  describe('school with no saved company (platform account)', () => {
    const PLATFORM_SMS = { metering: 'PLATFORM' };
    beforeEach(() => {
      server.use(providersHandler({ SMS: false }, null));
    });
    function captureTest() {
      const body = vi.fn();
      server.use(
        http.post('/api/v1/schools/:id/settings/test', async ({ request }) => {
          body(await request.json());
          return HttpResponse.json({ success: true, message: 'ok' });
        }),
      );
      return body;
    }

    it('Test connection names no company and sends no config, so the live one is tested', async () => {
      const body = captureTest();
      const { user } = renderForm('SMS', PLATFORM_SMS);

      await user.click(await screen.findByRole('button', { name: 'Test connection' }));

      await waitFor(() => expect(body).toHaveBeenCalled());
      expect(body.mock.calls[0]![0]).toEqual({ medium: 'SMS' });
    });

    it('Save stores no company when nothing was picked or filled in', async () => {
      const body = captureSave();
      const { user } = renderForm('SMS', PLATFORM_SMS);

      await user.click(await screen.findByRole('button', { name: 'Save' }));

      await waitFor(() => expect(body).toHaveBeenCalled());
      expect(body.mock.calls[0]![0]).toEqual({ version: 1, communications: {} });
    });

    it('a typed key for the shown company names that company', async () => {
      const body = captureSave();
      const { user } = renderForm('SMS', PLATFORM_SMS);

      await user.click(await screen.findByRole('button', { name: 'Add' }));
      await user.type(await screen.findByLabelText('API key'), 'own-key');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(body).toHaveBeenCalled());
      expect(body.mock.calls[0]![0].communications.sms).toEqual({
        provider: 'greenweb',
        greenweb: { apiKey: 'own-key' },
      });
    });

    it('picking a company names it in the test', async () => {
      const body = captureTest();
      const { user } = renderForm('SMS', PLATFORM_SMS);

      await user.click(await screen.findByLabelText('SMS company'));
      await user.click(await screen.findByRole('option', { name: 'MimSMS' }));
      await user.type(screen.getByLabelText(/^Sender name/), 'SCHOOL');
      await user.click(screen.getByRole('button', { name: 'Test connection' }));

      await waitFor(() => expect(body).toHaveBeenCalled());
      expect(body.mock.calls[0]![0].config.provider).toBe('mimsms');
    });

    // CodeRabbit on PR #3325 round 3: nothing of the shown company is sent, so its required text
    // fields (MimSMS senderId here, listed first) must not block Test connection or Save.
    describe('first listed company has a required text field', () => {
      beforeEach(() => {
        const sms = {
          providers: [MIMSMS, GREENWEB, ONECODESOFT],
          configured: false,
          selected: null,
        };
        server.use(
          http.get('/api/v1/schools/:id/settings/messaging/providers', () =>
            HttpResponse.json({ ...providersResponse(), SMS: sms }),
          ),
        );
      });

      it('Test connection is not blocked and sends no config', async () => {
        const body = captureTest();
        const { user } = renderForm('SMS', PLATFORM_SMS);

        await user.click(await screen.findByRole('button', { name: 'Test connection' }));

        await waitFor(() => expect(body).toHaveBeenCalled());
        expect(body.mock.calls[0]![0]).toEqual({ medium: 'SMS' });
        expect(screen.queryByText('Fill in this field.')).toBeNull();
      });

      it('Save is not blocked and stores no company', async () => {
        const body = captureSave();
        const { user } = renderForm('SMS', PLATFORM_SMS);

        await user.click(await screen.findByRole('button', { name: 'Save' }));

        await waitFor(() => expect(body).toHaveBeenCalled());
        expect(body.mock.calls[0]![0]).toEqual({ version: 1, communications: {} });
      });

      it('a typed key names the company, and then its required field is checked', async () => {
        const body = captureSave();
        const { user } = renderForm('SMS', PLATFORM_SMS);

        await user.click(await screen.findByRole('button', { name: 'Add' }));
        await user.type(await screen.findByLabelText('API key'), 'own-key');
        await user.click(screen.getByRole('button', { name: 'Save' }));

        expect(await screen.findByText('Fill in this field.')).toBeTruthy();
        expect(body).not.toHaveBeenCalled();
      });
    });
  });

  it('sole company: no picker, nested payload without provider', async () => {
    const body = captureSave();
    const { user } = renderForm('WHATSAPP', {
      'meta-cloud': { phoneNumberId: '123', accessToken: { configured: true, hint: '••••tok' } },
    });

    expect(await screen.findByLabelText(/^Phone number ID/)).toBeTruthy();
    expect(screen.queryByLabelText('WhatsApp company')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body.mock.calls[0]![0].communications.whatsapp).toEqual({
      'meta-cloud': { phoneNumberId: '123' },
    });
  });

  it('sends a cleared optional field as null, so the saved value does not stay', async () => {
    const body = captureSave();
    const { user } = renderForm('WHATSAPP', {
      'meta-cloud': {
        phoneNumberId: '123',
        apiVersion: 'v19.0',
        accessToken: { configured: true, hint: '••••tok' },
      },
    });

    await user.clear(await screen.findByLabelText('API version (optional)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body.mock.calls[0]![0].communications.whatsapp).toEqual({
      'meta-cloud': { phoneNumberId: '123', apiVersion: null },
    });
  });

  it("remounts for another school, so a cached school never shows (or saves) the last one's values", async () => {
    const SCHOOL_B = 'school-2';
    const savedB = {
      provider: 'mimsms',
      mimsms: { senderId: 'SCHOOL-B', apiKey: { configured: true, hint: '••••b' } },
    };
    server.use(
      http.get('/api/v1/schools/:id/settings/messaging/providers', ({ params }) =>
        HttpResponse.json(
          providersResponse({ SMS: true }, params.id === SCHOOL_B ? 'mimsms' : 'greenweb'),
        ),
      ),
    );
    // The settings page keeps one card and hands it the picked school (WithTestRouter's children
    // are static, so the switch happens in here).
    let pickSchool: (id: string) => void = () => {};
    function SchoolPicker() {
      const [schoolId, setSchoolId] = useState(SCHOOL_ID);
      pickSchool = setSchoolId;
      return (
        <ProviderConfigForm
          medium="SMS"
          schoolId={schoolId}
          saved={schoolId === SCHOOL_B ? savedB : SAVED_SMS}
          sectionId="x-section"
          title={CARD}
          description="Card description"
        />
      );
    }
    const body = captureSave();
    const { user } = renderWithProviders(
      <WithTestRouter>
        <SchoolPicker />
      </WithTestRouter>,
      OPTS,
    );
    expect(await screen.findByText('Added — ends ••••key1')).toBeTruthy();

    act(() => pickSchool(SCHOOL_B));
    expect((await screen.findByLabelText<HTMLInputElement>(/^Sender name/)).value).toBe('SCHOOL-B');

    // Back to the first school: both its queries are cached, so the card never unmounts on its own.
    act(() => pickSchool(SCHOOL_ID));
    expect(await screen.findByText('Added — ends ••••key1')).toBeTruthy();
    expect(screen.queryByLabelText(/^Sender name/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body.mock.calls[0]![0].communications.sms.provider).toBe('greenweb');
  });

  it('reads the old flat saved layout of a sole company', async () => {
    renderForm('WHATSAPP', { phoneNumberId: '777' });
    expect((await screen.findByLabelText<HTMLInputElement>(/^Phone number ID/)).value).toBe('777');
  });

  it('shows the send-a-test-message row only for companies that support it', async () => {
    renderForm('WHATSAPP', undefined);
    await screen.findByLabelText(/^Phone number ID/);
    expect(screen.queryByRole('button', { name: 'Send a test message' })).toBeNull();
  });

  it('sends a test message with sendTo and an Idempotency-Key, then links to the message log', async () => {
    const seen = vi.fn();
    server.use(
      http.post('/api/v1/schools/:id/settings/test', async ({ request }) => {
        seen({ body: await request.json(), key: request.headers.get('Idempotency-Key') });
        return HttpResponse.json({
          success: true,
          message: 'Connected to Greenweb.',
          testMessage: { logId: 'log-1', status: 'SENT' },
        });
      }),
    );
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.type(await screen.findByLabelText('Phone number'), '01712345678');
    await user.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect(await screen.findByText(/Sent\./)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'See it in Message log' }).getAttribute('href'),
    ).toContain('status=SENT');
    expect(seen.mock.calls[0]![0].body.sendTo).toBe('01712345678');
    expect(seen.mock.calls[0]![0].key).toBeTruthy();
  });

  const tooMany = (details?: Record<string, unknown>) =>
    http.post('/api/v1/schools/:id/settings/test', () =>
      HttpResponse.json(
        {
          statusCode: 429,
          message: 'cap',
          ...(details ? { details } : {}),
          timestamp: new Date().toISOString(),
          path: '/x',
          requestId: 'r',
        },
        { status: 429 },
      ),
    );

  it("shows the daily-limit sentence on the cap's 429 (details.code TEST_SEND_DAILY_CAP)", async () => {
    server.use(tooMany({ code: 'TEST_SEND_DAILY_CAP' }));
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.type(await screen.findByLabelText('Phone number'), '01712345678');
    await user.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect(await screen.findByText(/limit of 20 test messages in 24 hours/)).toBeTruthy();
  });

  // Finding 8: the 3-per-minute throttle also answers 429; a minute is enough, not "tomorrow".
  it('shows the generic send error, not the daily-limit sentence, on the per-minute throttle 429', async () => {
    server.use(tooMany());
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.type(await screen.findByLabelText('Phone number'), '01712345678');
    await user.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect(await screen.findByText(/Couldn't send the test message/)).toBeTruthy();
    expect(screen.queryByText(/limit of 20 test messages/)).toBeNull();
  });

  // Review round 2, finding 2: a test send saves nothing, so its errors never say "Couldn't save".
  const failWith = (status: number, details?: Record<string, unknown>) =>
    http.post('/api/v1/schools/:id/settings/test', () =>
      HttpResponse.json(
        {
          statusCode: status,
          message: 'server text the UI never shows',
          ...(details ? { details } : {}),
          timestamp: new Date().toISOString(),
          path: '/x',
          requestId: 'r',
        },
        { status },
      ),
    );
  async function sendTestTo(to: string) {
    const { user } = renderForm('SMS', SAVED_SMS);
    await user.type(await screen.findByLabelText('Phone number'), to);
    await user.click(screen.getByRole('button', { name: 'Send a test message' }));
  }

  it('says there is not enough SMS credit on the 409 INSUFFICIENT_SMS_CREDIT', async () => {
    server.use(failWith(409, { code: 'INSUFFICIENT_SMS_CREDIT', required: 2, available: 0 }));
    await sendTestTo('01712345678');
    expect(await screen.findByText(/Not enough SMS credit to send the test message/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't save/)).toBeNull();
  });

  it("says the number or address is not valid on the server's address 400", async () => {
    server.use(failWith(400, { code: 'INVALID_TEST_ADDRESS' }));
    await sendTestTo('01712345678');
    expect(await screen.findByText(/number or address isn't valid/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't save/)).toBeNull();
  });

  // Review round 3, nit 7: a DTO 400 (say a bad config) is not about the number.
  it('shows the generic send error on any other 400', async () => {
    server.use(failWith(400));
    await sendTestTo('01712345678');
    expect(await screen.findByText(/Couldn't send the test message/)).toBeTruthy();
    expect(screen.queryByText(/number or address isn't valid/)).toBeNull();
  });

  // Review round 3, nit 7: the interceptor's in-flight 409 (no code): the first try may be sending.
  it('says the send could not be confirmed on the in-flight 409', async () => {
    server.use(failWith(409));
    await sendTestTo('01712345678');
    expect(await screen.findByText(/couldn't confirm it was sent/)).toBeTruthy();
  });

  // Review round 3, nit 8: an earlier result never stays up for another number or company.
  it('clears an earlier send result when the number or the company changes', async () => {
    server.use(
      http.post('/api/v1/schools/:id/settings/test', () =>
        HttpResponse.json({
          success: true,
          message: 'ok',
          testMessage: { logId: 'log-3', status: 'SENT' },
        }),
      ),
    );
    const { user } = renderForm('SMS', SAVED_SMS);
    const phone = await screen.findByLabelText('Phone number');
    await user.type(phone, '01712345678');
    await user.click(screen.getByRole('button', { name: 'Send a test message' }));
    expect(await screen.findByText(/Sent\./)).toBeTruthy();

    await user.type(phone, '9');
    expect(screen.queryByText(/Sent\./)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Send a test message' }));
    expect(await screen.findByText(/Sent\./)).toBeTruthy();
    await user.click(screen.getByLabelText('SMS company'));
    await user.click(await screen.findByRole('option', { name: 'MimSMS' }));
    expect(screen.queryByText(/Sent\./)).toBeNull();
  });

  it('says the send could not be confirmed on a 500, never "try again"', async () => {
    server.use(failWith(500));
    await sendTestTo('01712345678');
    const alert = await screen.findByText(/couldn't confirm it was sent/);
    expect(alert.textContent).toMatch(/Check the Message log before trying again/);
    expect(screen.queryByText(/Couldn't save/)).toBeNull();
  });

  it('says the send could not be confirmed when the reply is lost', async () => {
    server.use(http.post('/api/v1/schools/:id/settings/test', () => HttpResponse.error()));
    await sendTestTo('01712345678');
    expect(await screen.findByText(/couldn't confirm it was sent/)).toBeTruthy();
  });

  // Finding 3: the connection passed but the gateway rejected the send.
  it('shows a failure and links to the FAILED log rows when the test send was rejected', async () => {
    server.use(
      http.post('/api/v1/schools/:id/settings/test', () =>
        HttpResponse.json({
          success: true,
          message: 'Connected.',
          testMessage: { logId: 'log-2', status: 'FAILED' },
        }),
      ),
    );
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.type(await screen.findByLabelText('Phone number'), '01712345678');
    await user.click(screen.getByRole('button', { name: 'Send a test message' }));

    expect(await screen.findByText(/Couldn't send the test message/)).toBeTruthy();
    expect(screen.queryByText(/Sent\./)).toBeNull();
    expect(
      screen.getByRole('link', { name: 'See it in Message log' }).getAttribute('href'),
    ).toContain('status=FAILED');
  });

  // Finding 10: a bn keyboard types Bangla digits; the server checks ASCII ones.
  it('sends a Bangla-digit phone number as Latin digits', async () => {
    const seen = vi.fn();
    server.use(
      http.post('/api/v1/schools/:id/settings/test', async ({ request }) => {
        seen(await request.json());
        return HttpResponse.json({ success: true, message: 'ok' });
      }),
    );
    const { user } = renderForm('SMS', SAVED_SMS);

    await user.type(await screen.findByLabelText('Phone number'), '০১৭১২৩৪৫৬৭৮');
    await user.click(screen.getByRole('button', { name: 'Send a test message' }));

    await waitFor(() => expect(seen).toHaveBeenCalled());
    expect(seen.mock.calls[0]![0].sendTo).toBe('01712345678');
  });

  // Finding 7: a test saves nothing, so it must not turn off the unsaved-changes warning.
  it('keeps the unsaved-changes warning on after Test connection', async () => {
    server.use(
      http.post('/api/v1/schools/:id/settings/test', () =>
        HttpResponse.json({ success: true, message: 'ok' }),
      ),
    );
    const { user } = renderForm('EMAIL', {
      smtp: { host: 'h', user: 'u', from: 'a@x.com', password: { configured: true } },
    });

    await user.type(await screen.findByLabelText(/Server username/), '2');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Connection works')).toBeTruthy();
    expect(warnUnsaved).toHaveBeenLastCalledWith(true);
  });

  // CodeRabbit on PR #3325 round 3: `.mutate()` is not awaited, so a failed save must not count
  // as submitted; the edit is still unsaved.
  it('keeps the unsaved-changes warning on after a failed save', async () => {
    const body = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', () => {
        body();
        return HttpResponse.json({ message: 'boom' }, { status: 500 });
      }),
    );
    const { user } = renderForm('EMAIL', {
      smtp: { host: 'h', user: 'u', from: 'a@x.com', password: { configured: true } },
    });

    await user.type(await screen.findByLabelText(/Server username/), '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(warnUnsaved).toHaveBeenLastCalledWith(true);
  });

  it('turns the warning on again for an edit after a good save', async () => {
    const body = captureSave();
    const { user } = renderForm('EMAIL', {
      smtp: { host: 'h', user: 'u', from: 'a@x.com', password: { configured: true } },
    });
    const username = await screen.findByLabelText(/Server username/);

    await user.type(username, '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalled());
    await waitFor(() => expect(warnUnsaved).toHaveBeenLastCalledWith(false));

    await user.type(username, '3');
    expect(warnUnsaved).toHaveBeenLastCalledWith(true);
  });

  it('keeps the port and from-address checks', async () => {
    const body = captureSave();
    const { user } = renderForm('EMAIL', {
      smtp: { host: 'h', user: 'u', from: 'bad', password: { configured: true } },
    });

    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Check this value.')).toBeTruthy();
    expect(body).not.toHaveBeenCalled();
  });

  // The '' branch of PR #3325 round 5 guarded Number('') = 0; with null for a cleared field, a
  // cleared port must still never go out as 0.
  it('sends a cleared saved port as null, never 0', async () => {
    const body = captureSave();
    const { user } = renderForm('EMAIL', {
      smtp: { host: 'h', port: 587, user: 'u', from: 'a@x.com', password: { configured: true } },
    });

    await user.clear(await screen.findByLabelText(/^Port/));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toHaveBeenCalled());
    expect(body.mock.calls[0]![0].communications.email).toEqual({
      smtp: { host: 'h', port: null, user: 'u', from: 'a@x.com' },
    });
  });

  it('shows a loading skeleton, then the form', async () => {
    const { container } = renderForm('SMS', SAVED_SMS);
    expect(await screen.findByRole('heading', { name: CARD })).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(await screen.findByLabelText('SMS company')).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('shows an error with Retry when the providers GET fails, and recovers', async () => {
    let fail = true;
    server.use(
      http.get('/api/v1/schools/:id/settings/messaging/providers', () =>
        fail
          ? HttpResponse.json({ message: 'x' }, { status: 400 })
          : HttpResponse.json(providersResponse({ SMS: true })),
      ),
    );
    const { user } = renderForm('SMS', SAVED_SMS);
    expect(await screen.findByText(/Couldn't load the company settings/)).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByLabelText('SMS company')).toBeTruthy();
  });
});

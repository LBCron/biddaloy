import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MetaCloudProvider } from './meta-cloud.provider';

describe('MetaCloudProvider', () => {
  const sendConfig = { phoneNumberId: '1234567890', accessToken: 'token-abc', apiVersion: 'v21.0' };
  let provider: MetaCloudProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new MetaCloudProvider();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a freeform text payload when no template is given', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.1' }] }),
    });

    const result = await provider.send({ to: '01712345678', body: 'Your fee is due' }, sendConfig);

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Your fee is due');
    expect(body.to).toBe('8801712345678');
    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('wamid.1');
  });

  it('defaults the API version when the config carries none', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'w' }] }) });

    await provider.send(
      { to: '01712345678', body: 'hi' },
      { phoneNumberId: '1234567890', accessToken: 't' },
    );

    expect(fetchMock.mock.calls[0][0]).toContain('/v21.0/1234567890/messages');
  });

  it('sends a template payload when template_name is given', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.2' }] }),
    });

    await provider.send(
      {
        to: '01712345678',
        body: 'ignored',
        templateName: 'fee_reminder',
        templateLanguage: 'bn',
        templateParams: ['500', 'August'],
      },
      sendConfig,
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);

    expect(body.type).toBe('template');
    expect(body.template.name).toBe('fee_reminder');
    expect(body.template.language.code).toBe('bn');
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: '500' },
      { type: 'text', text: 'August' },
    ]);
  });

  it('returns success: false with the Meta error message on API failure', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Recipient outside the 24-hour window' } }),
    });

    const result = await provider.send({ to: '01712345678', body: 'hi' }, sendConfig);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Recipient outside the 24-hour window');
  });

  it('returns success: false instead of throwing on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await provider.send({ to: '01712345678', body: 'hi' }, sendConfig);

    expect(result.success).toBe(false);
    // Rules 23/24: a fixed sentence, never the thrown text; still AMBIGUOUS (it may have reached Meta).
    expect(result.error).toBe(
      'Could not reach the WhatsApp Cloud API; the message may or may not have been sent.',
    );
    expect(result.error).not.toContain('network down');
    expect(result.outcome).toBe('AMBIGUOUS');
  });

  // #3315: both values go into the request path, so a stored or overridden bad value must never reach fetch.
  it.each([
    ['a path-traversal phone number id', { ...sendConfig, phoneNumberId: '../me?x=' }],
    ['a non-numeric phone number id', { ...sendConfig, phoneNumberId: 'phone-id-123' }],
    ['a malformed api version', { ...sendConfig, apiVersion: 'v21' }],
    ['an api version with a path', { ...sendConfig, apiVersion: 'v21.0/../x' }],
  ])('rejects %s without calling Meta', async (_label, config) => {
    const result = await provider.send({ to: '01712345678', body: 'hi' }, config);

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('REJECTED');
    expect(result.retryable).toBe(false);
    // Rule 23: the bad value is not echoed.
    expect(result.error).not.toContain('..');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('testConnection', () => {
    const config = {
      phoneNumberId: '20002',
      accessToken: 'super-secret-token',
      apiVersion: 'v21.0',
    };

    it('fetches the phone number metadata instead of sending a message', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: '20002' }) });

      const result = await provider.testConnection(config);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.facebook.com/v21.0/20002?fields=id');
      expect(init.headers.Authorization).toBe('Bearer super-secret-token');
      expect(result).toEqual({ success: true, message: 'Connected — phone number ID verified.' });
    });

    it('never sends a message-shaped POST request', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: '20002' }) });

      await provider.testConnection(config);

      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).not.toBe('POST');
    });

    it('rejects a phone number id that is not a plain numeric Graph API id, without making a request', async () => {
      const result = await provider.testConnection({ ...config, phoneNumberId: '20002/../evil' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        message: 'Phone number ID is not a valid WhatsApp identifier.',
      });
    });

    it('rejects an api version that does not match the vN.N Graph API shape, without making a request', async () => {
      const result = await provider.testConnection({ ...config, apiVersion: 'v21.0/evil' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        message: 'API version is not a valid Graph API version.',
      });
    });

    it('reports an actionable message for an invalid token, never the raw payload', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 190, message: `Invalid token: ${config.accessToken}` },
        }),
      });

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Authentication rejected — check the access token.');
      expect(result.message).not.toContain(config.accessToken);
    });

    it('reports an actionable message when the phone number id is not found', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({ error: { code: 100, message: 'Unsupported get request' } }),
      });

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Not found — check the ID and that the token has access to it.');
    });

    it('returns success: false instead of throwing on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not reach the WhatsApp Cloud API.');
    });
  });
});

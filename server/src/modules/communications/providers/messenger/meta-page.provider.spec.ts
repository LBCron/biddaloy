import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MetaPageProvider } from './meta-page.provider';

describe('MetaPageProvider', () => {
  let provider: MetaPageProvider;

  beforeEach(() => {
    provider = new MetaPageProvider();
  });

  it('reports "not yet implemented", REJECTED and not retryable, without touching the network', async () => {
    const result = await provider.send(
      { to: 'psid-1', body: 'hi' },
      { pageId: 'page-1', accessToken: 'token-1' },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Messenger sending is not yet implemented');
    expect(result.retryable).toBe(false);
    expect(result.outcome).toBe('REJECTED');
  });
  describe('testConnection', () => {
    const config = { pageId: '10001', accessToken: 'super-secret-token' };
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('fetches the page metadata instead of sending a message', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: '10001' }) });

      const result = await provider.testConnection(config);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.facebook.com/10001?fields=id');
      expect(init.headers.Authorization).toBe('Bearer super-secret-token');
      expect(result).toEqual({ success: true, message: 'Connected — Facebook Page verified.' });
    });

    it('rejects a page id that is not a plain numeric Graph API id, without making a request', async () => {
      const result = await provider.testConnection({ ...config, pageId: '10001/../evil' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        message: 'Page ID is not a valid Facebook Page identifier.',
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

    it('returns success: false instead of throwing on a network error', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not reach the Facebook Graph API.');
    });
  });
});

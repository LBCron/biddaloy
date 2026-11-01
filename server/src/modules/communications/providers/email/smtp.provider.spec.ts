import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as nodemailer from 'nodemailer';
import { SmtpProvider } from './smtp.provider';
import {
  assertSafeSmtpDestination,
  DestinationBlockedError,
} from '../shared/outbound-destination-guard';

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(),
}));

// Destination-class validation (real vs. private-network host) is its own
// unit under test in outbound-destination-guard.spec.ts, and does a real
// DNS lookup — stub it out here so these tests stay hermetic and fast.
vi.mock('../shared/outbound-destination-guard', () => {
  class OutboundDestinationError extends Error {
    readonly publicMessage = 'This server address cannot be used — check it and try again.';
  }
  class DestinationBlockedError extends OutboundDestinationError {}
  return {
    assertSafeSmtpDestination: vi.fn().mockResolvedValue({
      addresses: [{ address: '203.0.113.5', family: 4 }],
      servername: 'smtp.example.com',
    }),
    OutboundDestinationError,
    DestinationBlockedError,
  };
});

describe('SmtpProvider', () => {
  let cfg: any;
  let sendMail: ReturnType<typeof vi.fn>;
  let verify: ReturnType<typeof vi.fn>;
  let provider: SmtpProvider;

  beforeEach(() => {
    vi.mocked(nodemailer.createTransport).mockReset();
    cfg = {
      host: 'smtp.example.com',
      port: '587',
      user: 'user-1',
      password: 'pass-1',
      from: 'noreply@example.com',
    };
    sendMail = vi.fn().mockResolvedValue({ messageId: 'msg-1', response: '250 OK' });
    verify = vi.fn().mockResolvedValue(true);
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, verify } as any);
    provider = new SmtpProvider();
  });

  it('a blank port falls back to 587; a non-numeric port is a config error', async () => {
    const ok = await provider.send({ to: 'g@example.com', body: 'x' }, { ...cfg, port: '' });
    expect(ok.error).toBeUndefined();
    expect(vi.mocked(nodemailer.createTransport).mock.calls[0][0]).toMatchObject({ port: 587 });
    const bad = await provider.send({ to: 'g@example.com', body: 'x' }, { ...cfg, port: 'abc' });
    expect(bad).toMatchObject({ success: false, outcome: 'REJECTED' });
  });

  it('builds a transporter from the tenant-resolved config and sends the message', async () => {
    const result = await provider.send({ to: 'guardian@example.com', body: 'Fee reminder' }, cfg);

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: '203.0.113.5',
      port: 587,
      secure: false,
      auth: { user: 'user-1', pass: 'pass-1' },
      tls: { servername: 'smtp.example.com' },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      to: 'guardian@example.com',
      subject: '',
      text: 'Fee reminder',
    });
    expect(result).toEqual({
      success: true,
      providerMessageId: 'msg-1',
      raw: { response: '250 OK' },
      outcome: 'ACCEPTED',
    });
  });

  it('marks the transport secure for port 465', async () => {
    cfg = {
      host: 'smtp.example.com',
      port: 465,
      user: 'user-1',
      password: 'pass-1',
      from: 'noreply@example.com',
    };

    await provider.send({ to: 'guardian@example.com', body: 'hi' }, cfg);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true }),
    );
  });

  it('builds a fresh transporter per tenant rather than reusing a cached one', async () => {
    await provider.send({ to: 'a@example.com', body: 'hi' }, cfg);

    cfg = {
      host: 'smtp.other-tenant.com',
      port: 587,
      user: 'other-user',
      password: 'other-pass',
      from: 'noreply@other-tenant.com',
    };
    vi.mocked(assertSafeSmtpDestination).mockResolvedValueOnce({
      addresses: [{ address: '198.51.100.9', family: 4 }],
      servername: 'smtp.other-tenant.com',
    });
    await provider.send({ to: 'b@example.com', body: 'hi' }, cfg);

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        host: '198.51.100.9',
        tls: { servername: 'smtp.other-tenant.com' },
      }),
    );
  });

  // Port comes from settings/env as free text; a bad one is a definite config error, never sent.
  it.each([['abc'], ['0'], ['70000'], ['58 7'], ['5e2']])(
    'rejects port %s as REJECTED / non-retryable without connecting',
    async (port) => {
      const result = await provider.send({ to: 'a@example.com', body: 'hi' }, { ...cfg, port });

      expect(result.success).toBe(false);
      expect(result.outcome).toBe('REJECTED');
      expect(result.retryable).toBe(false);
      expect(result.error).toMatch(/port must be an integer between 1 and 65535/);
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    },
  );

  it('defaults the port to 587 when the config carries none', async () => {
    const { port: _port, ...noPort } = cfg;

    await provider.send({ to: 'a@example.com', body: 'hi' }, noPort as any);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587 }));
  });

  it('returns success: false instead of throwing when sendMail rejects', async () => {
    sendMail.mockRejectedValue(new Error('SMTP connection refused'));

    const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, cfg);

    expect(result.success).toBe(false);
    // Rules 23/24: a fixed sentence, never nodemailer's text.
    expect(result.error).toBe(
      'Could not reach the SMTP server; the message may or may not have been sent.',
    );
    expect(result.error).not.toContain('refused');
    expect(result.retryable).toBeUndefined();
  });

  it('marks a destination-blocked failure as non-retryable', async () => {
    vi.mocked(assertSafeSmtpDestination).mockRejectedValueOnce(
      new DestinationBlockedError('"10.0.0.5" is a private/reserved address.'),
    );

    const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, cfg);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    // Rule 23: the stored error is the fixed sentence, never the blocked address.
    expect(result.error).toBe('This server address cannot be used — check it and try again.');
    expect(result.error).not.toContain('10.0.0.5');
  });

  it('omits tls.servername when the tenant host is already a literal IP', async () => {
    vi.mocked(assertSafeSmtpDestination).mockResolvedValueOnce({
      addresses: [{ address: '203.0.113.5', family: 4 }],
      servername: undefined,
    });

    await provider.send({ to: 'guardian@example.com', body: 'hi' }, cfg);

    const transportOptions = vi.mocked(nodemailer.createTransport).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(transportOptions).not.toHaveProperty('tls');
  });

  describe('address fallback', () => {
    // Pinning to a single literal IP short-circuits nodemailer's own DNS
    // resolution, which otherwise gives it built-in failover across
    // multiple A/AAAA records — these tests prove the provider restores
    // that resilience itself across the guard-validated address list.
    beforeEach(() => {
      vi.mocked(assertSafeSmtpDestination).mockResolvedValue({
        addresses: [
          { address: '203.0.113.5', family: 4 },
          { address: '203.0.113.6', family: 4 },
        ],
        servername: 'smtp.example.com',
      });
    });

    afterEach(() => {
      // Restore the single-address default so it doesn't leak into
      // sibling describe blocks below.
      vi.mocked(assertSafeSmtpDestination).mockResolvedValue({
        addresses: [{ address: '203.0.113.5', family: 4 }],
        servername: 'smtp.example.com',
      });
    });

    it('tries the next pinned address when the first fails with a connection-class error', async () => {
      const failingSendMail = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' }),
        );
      vi.mocked(nodemailer.createTransport)
        .mockReturnValueOnce({ sendMail: failingSendMail, verify } as any)
        .mockReturnValueOnce({ sendMail, verify } as any);

      const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, cfg);

      expect(result.success).toBe(true);
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
      expect(nodemailer.createTransport).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ host: '203.0.113.5', tls: { servername: 'smtp.example.com' } }),
      );
      expect(nodemailer.createTransport).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ host: '203.0.113.6', tls: { servername: 'smtp.example.com' } }),
      );
    });

    it('does the same fallback for testConnection', async () => {
      const failingVerify = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
      vi.mocked(nodemailer.createTransport)
        .mockReturnValueOnce({ sendMail, verify: failingVerify } as any)
        .mockReturnValueOnce({ sendMail, verify } as any);

      const result = await provider.testConnection({
        host: 'smtp.example.com',
        port: 587,
        user: 'user-1',
        password: 'pass-1',
        from: 'noreply@example.com',
      });

      expect(result).toEqual({ success: true, message: 'Connected — SMTP credentials verified.' });
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    });

    it('does not try another address after a non-connection failure, so a message is never sent twice', async () => {
      const authFailingSendMail = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('535 auth failed'), { code: 'EAUTH' }));
      vi.mocked(nodemailer.createTransport).mockReturnValueOnce({
        sendMail: authFailingSendMail,
        verify,
      } as any);

      const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, cfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Could not reach the SMTP server; the message may or may not have been sent.',
      );
      expect(result.error).not.toContain('535');
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    });

    it('surfaces the last error once every pinned address fails to connect', async () => {
      const failingSendMail = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' }),
        );
      vi.mocked(nodemailer.createTransport).mockReturnValue({
        sendMail: failingSendMail,
        verify,
      } as any);

      const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, cfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Could not reach the SMTP server; the message may or may not have been sent.',
      );
      expect(result.error).not.toContain('ECONNREFUSED');
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    });
  });

  describe('testConnection', () => {
    const config = {
      host: 'smtp.example.com',
      port: 587,
      user: 'user-1',
      password: 'super-secret-pass',
      from: 'noreply@example.com',
    };

    it('verifies the connection instead of sending mail', async () => {
      const result = await provider.testConnection(config);

      expect(verify).toHaveBeenCalledTimes(1);
      expect(sendMail).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, message: 'Connected — SMTP credentials verified.' });
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: '203.0.113.5', tls: { servername: 'smtp.example.com' } }),
      );
    });

    it('reports an authentication-rejected message for an EAUTH failure, never the raw error', async () => {
      const authError = Object.assign(
        new Error(`535 Authentication failed for ${config.password}`),
        {
          code: 'EAUTH',
        },
      );
      verify.mockRejectedValue(authError);

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'Authentication rejected — check the SMTP username and password.',
      );
      expect(result.message).not.toContain(config.password);
    });

    it('reports an unreachable-server message for a connection failure', async () => {
      verify.mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' }),
      );

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not reach the SMTP server — check the host and port.');
    });

    it('falls back to a generic message for an unrecognized error code', async () => {
      verify.mockRejectedValue(new Error('something unexpected'));

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection test failed — could not verify the credentials.');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { queueWorkers } from '../../../common/queue-workers';
import { MailpitSinkProvider } from '../../communications/providers/sink/mailpit-sink.provider';
import { ProviderNotConfiguredError } from '../../communications/config/provider-not-configured.error';
import { PlatformAlertsService } from './platform-alerts.service';

const OPENED = new Date('2026-11-02T08:02:10Z');
const CLEARED = new Date('2026-11-02T08:40:10Z');

/** SQL-routing fake: UPDATE returns `[rows, n]` like TypeORM; INSERT/SELECT return rows. */
function fakes(opts: {
  probe?: () => Promise<'ok' | 'fail'>;
  hourlyRows?: { opened_at: Date }[];
  closeRows?: { opened_at: Date; cleared_at: Date; sms_count: number }[];
  phones?: string[];
  env?: Record<string, string | undefined>;
  /** `TenantStatusService.platformTenantId()`; `null` = no platform tenant. */
  platformTenantId?: string | null;
}) {
  const sql: string[] = [];
  const dataSource = {
    query: vi.fn(async (text: string) => {
      sql.push(text);
      if (text.includes('INSERT INTO platform_alerts')) return [];
      if (text.includes('SET last_sms_at')) return [opts.hourlyRows ?? [], 0];
      if (text.includes('SET cleared_at')) return [opts.closeRows ?? [], 0];
      if (text.includes('FROM users u')) return (opts.phones ?? []).map((phone) => ({ phone }));
      return [];
    }),
  };
  const health = { probeRedis: vi.fn(opts.probe ?? (async () => 'fail' as const)) };
  const env = opts.env ?? { SMS_PROVIDER: 'p' };
  const config = { get: (k: string) => env[k] };
  const provider = { send: vi.fn().mockResolvedValue({ success: true }) };
  // Stands in for the real resolver: configured when SMS_PROVIDER or the legacy key is set.
  const resolver = {
    resolve: vi.fn(async (_m: unknown, _t: unknown, o?: { override?: unknown }) => {
      if (!env.SMS_PROVIDER && !env.PLATFORM_SMS_API_KEY) {
        throw new ProviderNotConfiguredError('SMS', 'not set');
      }
      return { provider, config: { override: o?.override } };
    }),
  };
  const tenantStatus = {
    platformTenantId: vi.fn(async () =>
      opts.platformTenantId === null ? undefined : (opts.platformTenantId ?? 'platform-tenant'),
    ),
  };
  const service = new PlatformAlertsService(
    dataSource as never,
    health as never,
    config as never,
    resolver as never,
    tenantStatus as never,
  );
  return { service, dataSource, health, provider, resolver, sql };
}

const inserts = (sql: string[]) => sql.filter((s) => s.includes('INSERT INTO platform_alerts'));

describe('PlatformAlertsService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    queueWorkers.enabled = true;
  });

  it('3 failed probes open exactly one row and text each recipient once', async () => {
    const f = fakes({
      hourlyRows: [{ opened_at: OPENED }],
      phones: ['01711111111', '01822222222'],
    });
    await f.service.tick();
    await f.service.tick();
    expect(inserts(f.sql)).toHaveLength(0); // 2 failures are not enough (D15)
    await f.service.tick();

    expect(inserts(f.sql)).toHaveLength(1);
    expect(f.provider.send).toHaveBeenCalledTimes(2);
    expect(f.provider.send.mock.calls[0][0].body).toContain('ALERT: Redis is down since 08:02 UTC');
  });

  const down = { hourlyRows: [{ opened_at: OPENED }], phones: ['01711111111'] };
  const trip = async (f: ReturnType<typeof fakes>) => {
    for (let i = 0; i < 3; i++) await f.service.tick();
  };

  it('resolves the platform SMS provider (null tenant, platform keys allowed, no override)', async () => {
    const f = fakes(down);
    await trip(f);
    expect(f.resolver.resolve).toHaveBeenCalledWith('SMS', null, {
      allowPlatformKeys: true,
      override: undefined,
    });
    expect(f.provider.send).toHaveBeenCalledTimes(1);
  });

  it('never touches BullMQ: the service has no queue dependency and sends while Redis is down', async () => {
    const f = fakes(down); // probeRedis fails every tick = Redis down
    await trip(f);
    expect(f.health.probeRedis).toHaveBeenCalledTimes(3);
    expect(f.provider.send).toHaveBeenCalledTimes(1);
  });

  it('deprecated PLATFORM_SMS_* keys map onto the override (unregistered name = registry default)', async () => {
    const f = fakes({
      ...down,
      env: {
        PLATFORM_SMS_PROVIDER: 'p',
        PLATFORM_SMS_API_KEY: 'secret-key-value',
        PLATFORM_SMS_SENDER_ID: 'sid',
        PLATFORM_SMS_API_URL: 'https://gw.example/api',
      },
    });
    await trip(f);
    expect(f.resolver.resolve).toHaveBeenCalledWith('SMS', null, {
      allowPlatformKeys: true,
      // Nested under the registry default: SMS has several providers, so flat keys are ignored.
      override: {
        provider: 'greenweb',
        greenweb: {
          apiKey: 'secret-key-value',
          senderId: 'sid',
          apiUrl: 'https://gw.example/api',
        },
      },
    });
  });

  it('SMS_PROVIDER set wins over the deprecated keys: no override', async () => {
    const f = fakes({ ...down, env: { SMS_PROVIDER: 'p', PLATFORM_SMS_API_KEY: 'k' } });
    await trip(f);
    expect(f.resolver.resolve).toHaveBeenCalledWith('SMS', null, {
      allowPlatformKeys: true,
      override: undefined,
    });
  });

  it('nothing configured: warns "not configured" and never throws out of the tick', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const f = fakes({ ...down, env: {} });
    await expect(trip(f)).resolves.toBeUndefined();
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('not configured'))).toBe(true);
  });

  it('2 failures then a success never open an alert, and the counter resets', async () => {
    let n = 0;
    const f = fakes({ probe: async () => (++n === 3 ? 'ok' : 'fail') });
    await f.service.tick();
    await f.service.tick();
    await f.service.tick(); // ok -> counter back to 0
    await f.service.tick();
    await f.service.tick(); // only 2 failures since the reset
    expect(inserts(f.sql)).toHaveLength(0);
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it('the first good probe closes the alert and sends one "recovered" text', async () => {
    const f = fakes({
      probe: async () => 'ok',
      closeRows: [{ opened_at: OPENED, cleared_at: CLEARED, sms_count: 2 }],
      phones: ['01711111111'],
    });
    await f.service.tick();
    expect(f.provider.send).toHaveBeenCalledTimes(1);
    expect(f.provider.send.mock.calls[0][0].body).toContain(
      'RECOVERED: Redis is back at 08:40 UTC after 38 min',
    );
  });

  it('a second good probe sends nothing (no open row to close)', async () => {
    const f = fakes({ probe: async () => 'ok', closeRows: [], phones: ['01711111111'] });
    await f.service.tick();
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it('sends no "recovered" text if nobody got the "down" text (sms_count = 0)', async () => {
    const f = fakes({
      probe: async () => 'ok',
      closeRows: [{ opened_at: OPENED, cleared_at: CLEARED, sms_count: 0 }],
      phones: ['01711111111'],
    });
    await f.service.tick();
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  it('sends nothing when the hourly UPDATE returns no row (another instance, or < 1 h)', async () => {
    const f = fakes({ hourlyRows: [], phones: ['01711111111'] });
    for (let i = 0; i < 4; i++) await f.service.tick();
    expect(f.provider.send).not.toHaveBeenCalled();
  });

  describe('recipients (D16)', () => {
    it('uses PLATFORM_ALERT_PHONES (trimmed, de-duplicated) when the DB has none', async () => {
      const f = fakes({ env: { PLATFORM_ALERT_PHONES: ' 01711111111, 01711111111 ,01833333333' } });
      expect(await f.service.recipients()).toEqual(['01711111111', '01833333333']);
    });

    it('ignores the env list when the DB has verified SUPER_ADMIN phones', async () => {
      const f = fakes({ phones: ['01922222222'], env: { PLATFORM_ALERT_PHONES: '01711111111' } });
      expect(await f.service.recipients()).toEqual(['01922222222']);
    });

    it('filters on the platform tenant (TenantStatusService.platformTenantId)', async () => {
      const f = fakes({ phones: ['01922222222'], platformTenantId: 'tenant-1' });
      await f.service.recipients();
      const [text, params] = f.dataSource.query.mock.calls[0] as unknown as [string, string[]];
      expect(text).toContain('ut.tenant_id = $1');
      expect(params).toEqual(['tenant-1']);
    });

    // [75.34 review r1, F-2441-2] never text school-local SUPER_ADMINs across tenants.
    it('with no platform tenant: env list only, and the users table is never queried', async () => {
      const f = fakes({
        phones: ['01922222222'],
        platformTenantId: null,
        env: { PLATFORM_ALERT_PHONES: '01711111111' },
      });
      expect(await f.service.recipients()).toEqual(['01711111111']);
      expect(f.sql.some((q) => q.includes('FROM users u'))).toBe(false);
    });
  });

  describe('test inbox (Epic 87, D23)', () => {
    const open = { hourlyRows: [{ opened_at: OPENED }], phones: ['01711111111', '01722222222'] };
    afterEach(() => {
      delete process.env.MESSAGE_SINK;
    });

    it('sends each recipient one SMS through the sink and writes no warn log, with no SMS key', async () => {
      process.env.MESSAGE_SINK = 'mailpit';
      const send = vi.spyOn(MailpitSinkProvider.prototype, 'send').mockResolvedValue({
        success: true,
        providerMessageId: 'x',
        outcome: 'ACCEPTED',
      });
      const f = fakes({ ...open, env: {} });
      for (let i = 0; i < 3; i++) await f.service.tick();
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledWith({
        to: '01711111111',
        body: expect.stringContaining('Redis is down'),
      });
      expect(Logger.prototype.warn).not.toHaveBeenCalled();
      expect(f.provider.send).not.toHaveBeenCalled();
    });

    it('never reaches a real gateway under the sink, even when a real SMS key is present', async () => {
      // Business-critical: a real PLATFORM_SMS_API_KEY copied onto staging must not send real SMS.
      process.env.MESSAGE_SINK = 'mailpit';
      const send = vi.spyOn(MailpitSinkProvider.prototype, 'send').mockResolvedValue({
        success: true,
        providerMessageId: 'x',
        outcome: 'ACCEPTED',
      });
      const f = fakes({ ...open, env: { PLATFORM_SMS_API_KEY: 'real-key' } });
      for (let i = 0; i < 3; i++) await f.service.tick();
      expect(send).toHaveBeenCalledTimes(2);
      expect(f.provider.send).not.toHaveBeenCalled();
    });

    it('is unchanged with the sink off', async () => {
      const send = vi.spyOn(MailpitSinkProvider.prototype, 'send');
      const f = fakes({ ...open, env: {} });
      for (let i = 0; i < 3; i++) await f.service.tick();
      expect(send).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });
  });

  describe('send and log', () => {
    const open = { hourlyRows: [{ opened_at: OPENED }], phones: ['01711111111'] };

    // [75.34 review r1, F-2441-3] the raw provider body can echo the full number.
    it('logs the send status only, never the raw provider response', async () => {
      const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const f = fakes(open);
      f.provider.send.mockResolvedValue({
        success: true,
        outcome: 'ACCEPTED',
        providerMessageId: 'm-1',
        raw: { to: '01711111111' },
      });
      for (let i = 0; i < 3; i++) await f.service.tick();
      const lines = log.mock.calls.map((c) => String(c[0]));
      const sent = lines.find((l) => l.startsWith('platform alert SMS to ***111'));
      expect(sent).toContain('"providerMessageId":"m-1"');
      expect(lines.join('\n')).not.toContain('01711111111');
    });

    it('logs the "not configured" line and calls no gateway when the API key is unset', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const f = fakes({ ...open, env: {} });
      for (let i = 0; i < 3; i++) await f.service.tick();
      // PR #3325 nit: one warning per alert, naming both the config problem and what was not sent.
      const lines = warn.mock.calls.map((c) => String(c[0]));
      const notConfigured = lines.filter((l) => l.startsWith('platform alert SMS not configured'));
      expect(notConfigured).toHaveLength(1);
      expect(notConfigured[0]).toContain('would text 1 phone(s):');
      expect(f.provider.send).not.toHaveBeenCalled();
    });
  });

  describe('never throws', () => {
    it('survives a gateway that rejects', async () => {
      const f = fakes({ hourlyRows: [{ opened_at: OPENED }], phones: ['01711111111'] });
      f.provider.send.mockRejectedValue(new Error('gateway down'));
      for (let i = 0; i < 3; i++) await expect(f.service.tick()).resolves.toBeUndefined();
    });

    it('survives a DataSource error', async () => {
      const f = fakes({});
      f.dataSource.query.mockRejectedValue(new Error('db down'));
      for (let i = 0; i < 3; i++) await expect(f.service.tick()).resolves.toBeUndefined();
    });

    it('an overlapping tick returns at once', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const f = fakes({ probe: async () => (await gate, 'ok') });
      const first = f.service.tick();
      await f.service.tick(); // returns immediately: first is still probing
      expect(f.health.probeRedis).toHaveBeenCalledTimes(1);
      release();
      await first;
    });
  });

  describe('loop gating', () => {
    afterEach(() => vi.useRealTimers());

    it('does not start the interval under NODE_ENV=test', () => {
      vi.useFakeTimers();
      const f = fakes({});
      f.service.onModuleInit(); // vitest runs with NODE_ENV=test
      vi.advanceTimersByTime(120_000);
      expect(f.health.probeRedis).not.toHaveBeenCalled();
    });

    it('does not start the interval when queue workers are off (scripts)', () => {
      vi.useFakeTimers();
      vi.stubEnv('NODE_ENV', 'production');
      queueWorkers.enabled = false;
      const f = fakes({});
      f.service.onModuleInit();
      vi.advanceTimersByTime(120_000);
      expect(f.health.probeRedis).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('probes every 30 s in production with workers on, and stops on destroy', async () => {
      vi.useFakeTimers();
      vi.stubEnv('NODE_ENV', 'production');
      const f = fakes({ probe: async () => 'ok' });
      f.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(f.health.probeRedis).toHaveBeenCalledTimes(2);
      f.service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(f.health.probeRedis).toHaveBeenCalledTimes(2);
      vi.unstubAllEnvs();
    });
  });

  it('listOpen returns kind and ISO opened_at', async () => {
    const f = fakes({});
    f.dataSource.query.mockResolvedValue([{ kind: 'REDIS_DOWN', opened_at: OPENED }]);
    expect(await f.service.listOpen()).toEqual({
      alerts: [{ kind: 'REDIS_DOWN', opened_at: '2026-11-02T08:02:10.000Z' }],
    });
  });
});

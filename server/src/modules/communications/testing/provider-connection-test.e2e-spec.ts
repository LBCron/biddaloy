import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import { fetchPinnedJson } from '../providers/shared/pinned-http';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { DataSource } from 'typeorm';
import { TENANT_SETTINGS_SCHEMA_VERSION, UserRole, countSmsSegments } from '@biddaloy/shared';
import { TenantSettingsCache } from '../../schools/settings/tenant-settings-cache.service';
import { SmsCreditService } from '../credits/sms-credit.service';
import { INSUFFICIENT_SMS_CREDIT } from '../credits/insufficient-sms-credit.constants';
import { TEST_SEND_DAILY_CAP } from './connection-test.service';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

// OneCodeSoft calls go through the SSRF guard + pinned undici client (not global fetch). Stub both so
// the SMS case needs no DNS or network; every other export of the guard module stays real.
// The cases mock only the body (`fetchPinnedJson`); it answers as HTTP 200 (#3320).
vi.mock('../providers/shared/pinned-http', () => {
  const fetchPinnedJson = vi.fn();
  return {
    fetchPinnedJson,
    fetchPinnedJsonWithStatus: vi.fn(async (...args: unknown[]) => ({
      status: 200,
      body: await fetchPinnedJson(...args),
    })),
  };
});
vi.mock('../providers/shared/outbound-destination-guard', async (importActual) => ({
  ...(await importActual<typeof import('../providers/shared/outbound-destination-guard')>()),
  assertSafeHttpDestination: vi.fn(async (rawUrl: string) => ({
    url: new URL(rawUrl),
    addresses: [{ address: '203.0.113.5', family: 4 }],
  })),
}));

/**
 * E2E coverage for POST /schools/:id/settings/test (#8.7.12) — proves the
 * whole pipeline end to end (auth guard, tenant-scope permission check,
 * DTO validation, the real provider call) rather than just the unit-level
 * pieces `connection-test.service.spec.ts` and each provider's own spec
 * already cover. Only WhatsApp is exercised here (a single stubbed
 * `fetch`, straightforward to intercept across the whole app's module
 * graph); the other 3 media's provider-level behavior is already covered
 * by their own unit specs.
 */
describe('Provider connection test E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let teacherToken: string;
  let tenantBAdminToken: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  const TENANT_ID = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000299';
  const TEACHER_USER_ID = '00000000-0000-4000-8000-000000000298';
  const TEACHER_EMAIL = 'teacher@provider-connection-test.example';
  const TENANT_B_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000297';
  const TENANT_B_ADMIN_EMAIL = 'admin-b@provider-connection-test.example';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // A real TEACHER membership in TENANT_ID — authenticated, but not in
    // @Roles(SUPER_ADMIN, ADMIN), so RolesGuard (not just "no token at
    // all") is what should reject it.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ('${TEACHER_USER_ID}', '${TEACHER_EMAIL}', '${SEED_ADMIN_PASSWORD_HASH}', 'Connection Test Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${TEACHER_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    // A second school, with a real ADMIN membership only there — for the
    // tenant-isolation case (an admin of one school testing another's
    // provider config).
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ('${TENANT_B}', 'Connection Test School B', 'connection-test-school-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ('${TENANT_B_ADMIN_USER_ID}', '${TENANT_B_ADMIN_EMAIL}', '${SEED_ADMIN_PASSWORD_HASH}', 'Connection Test Admin B', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${TENANT_B_ADMIN_USER_ID}', '${TENANT_B}', '${UserRole.ADMIN}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;

    const teacherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: TEACHER_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;

    const tenantBAdminLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: TENANT_B_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    tenantBAdminToken = tenantBAdminLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tests unsaved WhatsApp config without persisting it or leaking the token on failure', async () => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: { code: 190, message: 'Invalid OAuth access token: super-secret-token-value' },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        medium: 'WHATSAPP',
        config: { phoneNumberId: '99999', accessToken: 'super-secret-token-value' },
      })
      .expect(200);

    expect(res.body).toEqual({
      success: false,
      message: 'Authentication rejected — check the access token.',
    });
    expect(JSON.stringify(res.body)).not.toContain('super-secret-token-value');

    // Config was never saved — a plain settings read afterward shows
    // nothing new was persisted from the test call.
    const school = await dataSource.query('SELECT settings FROM schools WHERE id = $1', [
      TENANT_ID,
    ]);
    const settingsText = JSON.stringify(school[0]?.settings ?? {});
    expect(settingsText).not.toContain('super-secret-token-value');
    expect(settingsText).not.toContain('99999');
  });

  it('tests unsaved OneCodeSoft SMS config: connected on success, a fixed sentence on a bad key', async () => {
    const test = (apiKey: string) =>
      supertest(app.getHttpServer())
        .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          medium: 'SMS',
          config: {
            provider: 'onecodesoft',
            onecodesoft: { apiKey, apiUrl: 'https://sms.example.com/api' },
          },
        })
        .expect(200);

    vi.mocked(fetchPinnedJson).mockResolvedValueOnce({ status: 'success', data: { balance: 250 } });
    const ok = await test('good-key-value');
    // No balance amount: with no school block this could be the platform's own account.
    expect(ok.body).toEqual({ success: true, message: 'Connected to OneCodeSoft.' });

    vi.mocked(fetchPinnedJson).mockResolvedValueOnce({ message: 'Unauthenticated.' });
    const bad = await test('bad-key-value');
    // A refused key is named as such (not "could not reach"), in a fixed sentence (Rule 23).
    expect(bad.body).toEqual({
      success: false,
      message: 'OneCodeSoft rejected the API key — check it and try again.',
    });
    expect(JSON.stringify(bad.body)).not.toContain('bad-key-value');
  });

  // PR #3325 review round 2, finding 1: the settings form sends the saved apiUrl back with the
  // secret left out. The same apiUrl uses the stored key; a different one never gets it.
  it('tests a saved OneCodeSoft config when the override repeats the stored apiUrl', async () => {
    const apiUrl = 'https://sms.example.com/api';
    const http = supertest(app.getHttpServer());
    await http
      .patch(`/api/v1/schools/${TENANT_ID}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: {
          sms: { provider: 'onecodesoft', onecodesoft: { apiKey: 'stored-key-value', apiUrl } },
        },
      })
      .expect(200);
    const test = (url: string) =>
      http
        .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ medium: 'SMS', config: { provider: 'onecodesoft', onecodesoft: { apiUrl: url } } })
        .expect(200);
    try {
      vi.mocked(fetchPinnedJson).mockClear();
      vi.mocked(fetchPinnedJson).mockResolvedValueOnce({ status: 'success', data: { balance: 9 } });
      const same = await test(apiUrl);
      expect(same.body.success).toBe(true);
      // The stored (decrypted) key went to the stored host.
      const [, calledUrl, init] = vi.mocked(fetchPinnedJson).mock.calls[0];
      expect(String(calledUrl)).toContain('sms.example.com');
      expect(JSON.stringify(init)).toContain('stored-key-value');

      vi.mocked(fetchPinnedJson).mockClear();
      const other = await test('https://other.example.com/api');
      expect(other.body.success).toBe(false);
      expect(other.body.message).toMatch(/Testing a new destination requires/);
      expect(JSON.stringify(other.body)).not.toContain('stored-key-value');
      expect(vi.mocked(fetchPinnedJson)).not.toHaveBeenCalled();
    } finally {
      await dataSource.query(`UPDATE schools SET settings = NULL WHERE id = $1`, [TENANT_ID]);
      app.get(TenantSettingsCache).invalidate(TENANT_ID);
    }
  });

  // 97.3.04: "Send a test message". Throttle is skipped under NODE_ENV=test, so the 3/min 429 is
  // covered by app-throttler.guard.e2e-spec.ts and the route's @Throttle metadata, not here.
  describe('send a test message (sendTo)', () => {
    const smsBody = (sendTo?: string) => ({
      medium: 'SMS',
      ...(sendTo ? { sendTo } : {}),
      config: {
        provider: 'onecodesoft',
        onecodesoft: { apiKey: 'good-key-value', apiUrl: 'https://sms.example.com/api' },
      },
    });
    const post = (body: object, key?: string, tenant = TENANT_ID, bearer = token) => {
      const req = supertest(app.getHttpServer())
        .post(`/api/v1/schools/${tenant}/settings/test`)
        .set('Authorization', `Bearer ${bearer}`)
        .set('X-Tenant-ID', tenant);
      return (key ? req.set('Idempotency-Key', key) : req).send(body);
    };
    const mockBalanceThenSent = () => {
      vi.mocked(fetchPinnedJson)
        .mockResolvedValueOnce({ status: 'success', data: { balance: 250 } })
        .mockResolvedValueOnce({
          status: 'success',
          data: { results: [{ status: 'sent', message_id: 'm-1', sms_count: 2 }] },
        });
    };

    it('creates a logged test message visible on GET /communications/logs', async () => {
      mockBalanceThenSent();
      const res = await post(smsBody('01712345678'), 'test-send-1').expect(200);
      expect(res.body).toMatchObject({ success: true });
      expect(res.body.testMessage).toEqual({ logId: expect.any(String), status: 'SENT' });

      const list = await supertest(app.getHttpServer())
        .get('/api/v1/communications/logs')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
      const row = list.body.data.find((r: { id: string }) => r.id === res.body.testMessage.logId);
      expect(row).toBeDefined();
      expect(row.recipient_name).toBe('Test');
      // The list DTO does not expose `metadata` (follow-up: the UI badge ticket must); check the row.
      const [{ metadata }] = await dataSource.query(
        'SELECT metadata FROM communication_logs WHERE id = $1 AND tenant_id = $2',
        [res.body.testMessage.logId, TENANT_ID],
      );
      expect(metadata.test).toBe(true);
      // The unsaved key reached the gateway call but was never saved.
      const [{ settings }] = await dataSource.query('SELECT settings FROM schools WHERE id = $1', [
        TENANT_ID,
      ]);
      expect(JSON.stringify(settings ?? {})).not.toContain('good-key-value');
    });

    // PR #3325 review round 2, finding 1: the form sends the saved apiUrl back and leaves the saved
    // key out. Send a test message must still work from the saved config, with the stored key.
    it('sends a test message from a saved OneCodeSoft config when the override repeats the apiUrl', async () => {
      const apiUrl = 'https://sms.example.com/api';
      await supertest(app.getHttpServer())
        .patch(`/api/v1/schools/${TENANT_ID}/settings`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          version: TENANT_SETTINGS_SCHEMA_VERSION,
          communications: {
            sms: { provider: 'onecodesoft', onecodesoft: { apiKey: 'saved-key-value', apiUrl } },
          },
        })
        .expect(200);
      try {
        vi.mocked(fetchPinnedJson).mockClear();
        mockBalanceThenSent();
        const res = await post(
          {
            medium: 'SMS',
            sendTo: '01712345670',
            config: { provider: 'onecodesoft', onecodesoft: { apiUrl } },
          },
          'test-send-saved-config',
        ).expect(200);
        expect(res.body.testMessage).toEqual({ logId: expect.any(String), status: 'SENT' });
        // Both vendor calls (balance, then send) carried the saved key to the saved host.
        for (const [, url, init] of vi.mocked(fetchPinnedJson).mock.calls) {
          expect(String(url)).toContain('sms.example.com');
          expect(JSON.stringify(init)).toContain('saved-key-value');
        }
        expect(JSON.stringify(res.body)).not.toContain('saved-key-value');
      } finally {
        await dataSource.query(`UPDATE schools SET settings = NULL WHERE id = $1`, [TENANT_ID]);
        app.get(TenantSettingsCache).invalidate(TENANT_ID);
      }
    });

    it('replays a repeated Idempotency-Key without a second send', async () => {
      mockBalanceThenSent();
      const first = await post(smsBody('01712345679'), 'test-send-replay').expect(200);
      const calls = vi.mocked(fetchPinnedJson).mock.calls.length;
      const second = await post(smsBody('01712345679'), 'test-send-replay').expect(200);
      expect(second.body.testMessage.logId).toBe(first.body.testMessage.logId);
      expect(vi.mocked(fetchPinnedJson).mock.calls.length).toBe(calls);
    });

    // #3326: two sends in flight at 19/20 used both passed the count, ending at 21. Both requests
    // are held at the vendor connection check (after the early count), then released together:
    // exactly one may send, the other gets the daily-cap 429. A latch, not timing.
    it('two concurrent test sends at 19/20 used: exactly one is sent, the other gets the cap 429', async () => {
      const usedSql = `SELECT count(*)::int AS n FROM communication_logs
        WHERE tenant_id = $1 AND metadata->>'test' = 'true' AND created_at > now() - interval '24 hours'`;
      const [{ n: used }] = await dataSource.query(usedSql, [TENANT_ID]);
      expect(used).toBeLessThanOrEqual(19);
      for (let i = used; i < 19; i++) {
        await dataSource.query(
          `INSERT INTO communication_logs
             (tenant_id, medium, recipient_address, recipient_name, message_body, status, trigger, metadata)
           VALUES ($1, 'SMS', '01712340000', 'Test', 'filler', 'SENT', 'MANUAL', $2)`,
          [TENANT_ID, JSON.stringify({ test: true, filler: 'cap-race' })],
        );
      }
      let arrived = 0;
      let bothArrived!: () => void;
      let release!: () => void;
      const bothAtCheck = new Promise<void>((r) => (bothArrived = r));
      const gate = new Promise<void>((r) => (release = r));
      let sends = 0;
      vi.mocked(fetchPinnedJson).mockImplementation(async (_dest, url) => {
        if (String(url).includes('/v3/balance')) {
          if (++arrived === 2) bothArrived();
          await gate;
          return { status: 'success', data: { balance: 250 } };
        }
        sends += 1;
        return {
          status: 'success',
          data: { results: [{ status: 'sent', message_id: `race-${sends}`, sms_count: 1 }] },
        };
      });
      try {
        // Two keys: one key twice would get the interceptor's 409, which proves nothing here.
        const a = post(smsBody('01712345601'), 'cap-race-a').then((r) => r);
        const b = post(smsBody('01712345602'), 'cap-race-b').then((r) => r);
        await bothAtCheck;
        release();
        const results = await Promise.all([a, b]);

        expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
        const capped = results.find((r) => r.status === 429)!;
        expect(capped.body.details).toEqual({ code: TEST_SEND_DAILY_CAP });
        expect(sends).toBe(1);
        const [{ n: after }] = await dataSource.query(usedSql, [TENANT_ID]);
        expect(after).toBe(20);
      } finally {
        vi.mocked(fetchPinnedJson).mockReset();
        await dataSource.query(
          `DELETE FROM communication_logs WHERE tenant_id = $1 AND metadata->>'test' = 'true'
             AND (metadata->>'filler' = 'cap-race' OR recipient_address IN ('01712345601', '01712345602'))`,
          [TENANT_ID],
        );
      }
    });

    it('rejects sendTo without an Idempotency-Key (400)', async () => {
      const res = await post(smsBody('01712345678')).expect(400);
      expect(res.body.message).toMatch(/Idempotency-Key/);
    });

    it('rejects a malformed number with a fixed sentence (400)', async () => {
      const res = await post(smsBody('12345-secret'), 'test-send-bad').expect(400);
      expect(JSON.stringify(res.body)).not.toContain('12345-secret');
    });

    it('rejects sendTo for a medium whose provider cannot send a test (400)', async () => {
      await post(
        {
          medium: 'WHATSAPP',
          sendTo: '01712345678',
          config: { phoneNumberId: '99999', accessToken: 'x' },
        },
        'test-send-wa',
      ).expect(400);
    });

    it('rejects a missing or invalid X-Tenant-ID, and another school (401/403)', async () => {
      await supertest(app.getHttpServer())
        .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'test-send-nt')
        .send(smsBody('01712345678'))
        .expect(401);
      await supertest(app.getHttpServer())
        .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', 'not-a-uuid')
        .set('Idempotency-Key', 'test-send-nt')
        .send(smsBody('01712345678'))
        .expect(401);
      await post(smsBody('01712345678'), 'test-send-xt', TENANT_ID, tenantBAdminToken).expect(401);
    });

    describe('PLATFORM-metered school', () => {
      const credits = () => app.get(SmsCreditService);
      const segmentsOfTestBody = async () => {
        const [{ name }] = await dataSource.query('SELECT name FROM schools WHERE id = $1', [
          TENANT_ID,
        ]);
        return countSmsSegments(`Biddaloy test message from ${name} — সব ঠিক আছে / all good`)
          .segments;
      };
      const settleRows = (logId: string) =>
        dataSource.query(
          `SELECT kind, units FROM sms_credit_ledger
            WHERE tenant_id = $1 AND idempotency_key = $2`,
          [TENANT_ID, `log:${logId}:settle`],
        );

      // Platform credit pays for a send through the PLATFORM's gateway: the school has no SMS
      // config of its own and the override only picks the provider, so the keys come from env.
      const platformBody = (sendTo: string) => ({
        medium: 'SMS',
        sendTo,
        config: { provider: 'onecodesoft' },
      });
      const PLATFORM_ENV = {
        ONECODESOFT_API_KEY: 'platform-key-value',
        ONECODESOFT_API_URL: 'https://platform-sms.example.com/api',
      };
      // Raw SQL bypasses the settings write path, so the resolver's cached copy is dropped by hand.
      const invalidate = () => app.get(TenantSettingsCache).invalidate(TENANT_ID);

      beforeEach(async () => {
        Object.assign(process.env, PLATFORM_ENV);
        await dataSource.query(`UPDATE schools SET settings = $2 WHERE id = $1`, [
          TENANT_ID,
          JSON.stringify({ version: 1, communications: { sms: { metering: 'PLATFORM' } } }),
        ]);
        await dataSource.query(`DELETE FROM sms_credit_balance WHERE tenant_id = $1`, [TENANT_ID]);
        invalidate();
      });
      afterEach(async () => {
        for (const k of Object.keys(PLATFORM_ENV)) delete process.env[k];
        await dataSource.query(`UPDATE schools SET settings = NULL WHERE id = $1`, [TENANT_ID]);
        await dataSource.query(`DELETE FROM sms_credit_balance WHERE tenant_id = $1`, [TENANT_ID]);
        invalidate();
      });

      it('debits exactly the segment count and writes a DEBIT row keyed log:<id>', async () => {
        const segments = await segmentsOfTestBody();
        await credits().grant(TENANT_ID, 10, { idempotencyKey: 'test-send-grant' });
        mockBalanceThenSent();
        const res = await post(platformBody('01712345678'), 'test-send-credit').expect(200);
        expect(res.body.testMessage.status).toBe('SENT');
        const balance = await credits().getBalance(TENANT_ID);
        expect(balance.available).toBe(10 - segments);
        expect(balance.reserved).toBe(0);
        expect(await settleRows(res.body.testMessage.logId)).toEqual([
          { kind: 'DEBIT', units: segments },
        ]);
      });

      // PR #3325 review round 3, finding 1: the settings form names no company for a school that
      // saved none, so the test goes to SMS_PROVIDER on the platform keys, not the first company.
      it('with no company named, sends through SMS_PROVIDER on the platform keys', async () => {
        process.env.SMS_PROVIDER = 'onecodesoft';
        try {
          await credits().grant(TENANT_ID, 10, { idempotencyKey: 'test-send-grant-env' });
          mockBalanceThenSent();
          const before = vi.mocked(fetchPinnedJson).mock.calls.length;
          const res = await post({ medium: 'SMS', sendTo: '01712345678' }, 'test-send-env').expect(
            200,
          );
          expect(res.body.testMessage.status).toBe('SENT');
          const urls = vi
            .mocked(fetchPinnedJson)
            .mock.calls.slice(before)
            .map((c) => String(c[1]));
          expect(urls).toHaveLength(2);
          expect(urls.every((u) => u.startsWith('https://platform-sms.example.com/api'))).toBe(
            true,
          );
        } finally {
          delete process.env.SMS_PROVIDER;
        }
      });

      it('releases the reservation (RELEASE row, balance unchanged) when the gateway rejects', async () => {
        await credits().grant(TENANT_ID, 10, { idempotencyKey: 'test-send-grant-rej' });
        vi.mocked(fetchPinnedJson)
          .mockResolvedValueOnce({ status: 'success', data: { balance: 250 } })
          .mockResolvedValueOnce({ status: 'error', message: 'Invalid number' });
        const res = await post(platformBody('01712345678'), 'test-send-reject').expect(200);
        const segments = await segmentsOfTestBody();
        expect(res.body.testMessage.status).toBe('FAILED');
        const balance = await credits().getBalance(TENANT_ID);
        expect(balance.available).toBe(10);
        expect(balance.reserved).toBe(0);
        expect(await settleRows(res.body.testMessage.logId)).toEqual([
          { kind: 'RELEASE', units: segments },
        ]);
      });

      it('answers 409 with the insufficient-credit code at zero balance and calls no vendor', async () => {
        const before = vi.mocked(fetchPinnedJson).mock.calls.length;
        const res = await post(platformBody('01712345678'), 'test-send-nocredit').expect(409);
        expect(res.body.details?.code ?? res.body.message?.details?.code).toBe(
          INSUFFICIENT_SMS_CREDIT,
        );
        // PR #3325 finding 9: the credit check runs before the connection test, so nothing went out.
        expect(vi.mocked(fetchPinnedJson).mock.calls.length - before).toBe(0);
      });

      // PR #3325 finding 1: an unsaved key of the school's own sends through its own gateway, so
      // the school is not charged platform credit for it as well.
      it("never debits platform credit for a send through the school's own unsaved gateway", async () => {
        await credits().grant(TENANT_ID, 10, { idempotencyKey: 'test-send-grant-own' });
        mockBalanceThenSent();
        const res = await post(smsBody('01712345678'), 'test-send-own-gateway').expect(200);
        expect(res.body.testMessage.status).toBe('SENT');
        const balance = await credits().getBalance(TENANT_ID);
        expect(balance.available).toBe(10);
        expect(balance.reserved).toBe(0);
        expect(await settleRows(res.body.testMessage.logId)).toEqual([]);
      });

      it('an override senderId alone is refused, never sent under the platform key', async () => {
        const before = vi.mocked(fetchPinnedJson).mock.calls.length;
        const res = await post(
          {
            medium: 'SMS',
            sendTo: '01712345678',
            config: { provider: 'onecodesoft', onecodesoft: { senderId: 'ANYBANK' } },
          },
          'test-send-senderid',
        ).expect(200);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/never combined with the platform account/);
        expect(res.body.testMessage).toBeUndefined();
        expect(vi.mocked(fetchPinnedJson).mock.calls.length - before).toBe(0);
      });
    });

    // PR #3325 finding 1: the platform SMTP login never sends under a caller-chosen `from`.
    describe('platform SMTP keys set', () => {
      const SMTP_ENV = {
        SMTP_HOST: 'platform-smtp.example.com',
        SMTP_USER: 'platform-user',
        SMTP_PASSWORD: 'platform-password-value',
        SMTP_FROM: 'noreply@platform.example.com',
      };
      beforeEach(() => {
        Object.assign(process.env, SMTP_ENV);
      });
      afterEach(() => {
        for (const k of Object.keys(SMTP_ENV)) delete process.env[k];
      });

      it('an override `from` with sendTo is refused with the fixed sentence, and logs nothing', async () => {
        const res = await post(
          {
            medium: 'EMAIL',
            sendTo: 'victim@example.com',
            config: { smtp: { from: 'ceo@bank.example' } },
          },
          'test-send-from-only',
        ).expect(200);
        expect(res.body.success).toBe(false);
        // The exact resolver refusal, not a DNS failure that would also be success: false.
        expect(res.body.message).toMatch(/must carry .* themselves .* never combined/);
        expect(JSON.stringify(res.body)).not.toMatch(/platform-password-value|ceo@bank/);
        const rows = await dataSource.query(
          `SELECT id FROM communication_logs WHERE tenant_id = $1 AND recipient_address = $2`,
          [TENANT_ID, 'victim@example.com'],
        );
        expect(rows).toEqual([]);
      });
    });
  });

  it('returns the fixed test-site message when the message sink is on', async () => {
    process.env.MESSAGE_SINK = 'mailpit';
    try {
      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
        .expect(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Test site: messages go to the test inbox',
      });
    } finally {
      delete process.env.MESSAGE_SINK;
    }
  });

  it('rejects an unauthenticated request', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(401);
  });

  // Distinct from the unauthenticated case above: a real, valid session
  // for a role without SETTINGS_MANAGE. PermissionsGuard answers 403.
  it('rejects an authenticated caller whose role lacks SETTINGS_MANAGE', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(403);
  });

  it('rejects an admin of one school testing another school outside their membership', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${tenantBAdminToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(403);
  });

  it('rejects a request with a missing or invalid X-Tenant-ID', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${token}`)
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(401);

    await supertest(app.getHttpServer())
      .post(`/api/v1/schools/${TENANT_ID}/settings/test`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', '00000000-0000-4000-8000-000000000fff')
      .send({ medium: 'WHATSAPP', config: { accessToken: 'x' } })
      .expect(401);
  });
});

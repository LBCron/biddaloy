import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { AuthService } from '../auth/auth.service';
import { AuthTokenService, INVITE_TTL_MS } from './auth-token.service';
import { OTP_REDIS } from './otp.service';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { AuthTokenPurpose } from '@biddaloy/shared';
import { OnecodesoftProvider } from '../communications/providers/sms/onecodesoft.provider';

function extractRefreshCookie(res: supertest.Response): string {
  const headers = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const header = headers.find((c) => c.startsWith('__Host-refresh_token='));
  if (!header) throw new Error('No refresh_token cookie was set on this response');
  const match = header.match(/^__Host-refresh_token=([^;]+)/);
  return decodeURIComponent(match![1]);
}

describe('AccountAccessController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authTokens: AuthTokenService;

  const USER_ID = '00000000-0000-4000-8000-0000000004a1';
  const USER_EMAIL = 'activate-e2e@testschool.com';

  const PHONE_USER_ID = '00000000-0000-4000-8000-0000000004a2';
  const PHONE_NUMBER = '01799990000';

  const FP_USER_ID = '00000000-0000-4000-8000-0000000004a3';
  const FP_EMAIL = 'first-password-e2e@testschool.com';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    // D6: makes forgot-password echo the real OTP/token back in the
    // response, so this e2e spec can complete the recovery flow without
    // scraping a delivery provider's logs.
    process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    moduleFixture.get(AuthService);

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.use(cookieParser());
    await app.init();

    dataSource = app.get(DataSource);
    authTokens = app.get(AuthTokenService);

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status)
       VALUES ($1, $2, NULL, 'Activation Invitee', 'INACTIVE')
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email, password_hash = NULL, status = 'INACTIVE'`,
      [USER_ID, USER_EMAIL],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'TEACHER')
       ON CONFLICT DO NOTHING`,
      [USER_ID, SEED_TENANT_ID],
    );

    // Phone-only guardian for the "recover with only a phone" AC — no
    // email on file at all, so success here proves the SMS/OTP branch
    // works end to end, not the email/link one.
    await dataSource.query(
      `INSERT INTO users (id, phone, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'Phone-only Guardian', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE
         SET phone = EXCLUDED.phone, password_hash = EXCLUDED.password_hash, status = 'ACTIVE'`,
      [PHONE_USER_ID, PHONE_NUMBER, '$2b$10$rGV9zEDpgnc/spXBlHqA9O5IjpBvndIyZE78fIhV8ZV4.5GAUfPJ.'],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'PARENT')
       ON CONFLICT DO NOTHING`,
      [PHONE_USER_ID, SEED_TENANT_ID],
    );

    // [13.2.2] A staff user with no password and an email: first sign-in by emailed code.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status)
       VALUES ($1, $2, NULL, 'First Password Teacher', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email, password_hash = NULL, status = 'ACTIVE'`,
      [FP_USER_ID, FP_EMAIL],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'TEACHER')
       ON CONFLICT DO NOTHING`,
      [FP_USER_ID, SEED_TENANT_ID],
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [USER_ID]);
    await dataSource.query(`DELETE FROM auth_tokens WHERE user_id = $1`, [USER_ID]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [USER_ID]);
    await dataSource.query(
      `UPDATE users SET password_hash = NULL, email = NULL, status = 'INACTIVE' WHERE id = $1`,
      [USER_ID],
    );
    await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [FP_USER_ID]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [FP_USER_ID]);
    await dataSource.query(
      `UPDATE users SET password_hash = NULL, email = NULL, status = 'INACTIVE' WHERE id = $1`,
      [FP_USER_ID],
    );
    await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [PHONE_USER_ID]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [PHONE_USER_ID]);
    // Not a DELETE: by the time this spec's tests run, PHONE_USER_ID has
    // logged in (password and/or OTP), so it's the `performed_by_user_id`
    // on one or more `audit_logs` rows. That table's write-only trigger
    // (migration 1784175065078) blocks UPDATE *and* DELETE unconditionally
    // — including the FK's own `ON DELETE SET NULL` cascade — so deleting
    // this user would always fail here. Reset it in place instead, same as
    // USER_ID above.
    await dataSource.query(
      `UPDATE users SET password_hash = NULL, status = 'ACTIVE' WHERE id = $1`,
      [PHONE_USER_ID],
    );
    await app.close();
  });

  it('full flow: verify -> activate -> refresh with the new cookie works', async () => {
    const { raw } = await authTokens.issue({
      userId: USER_ID,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: INVITE_TTL_MS,
    });

    const verifyRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate/verify')
      .send({ token: raw })
      .expect(200);
    expect(verifyRes.body).toEqual({
      status: 'valid',
      full_name: 'Activation Invitee',
      school_name: expect.any(String),
      password_audience: 'staff',
    });
    expect(verifyRes.body.email).toBeUndefined();
    expect(verifyRes.body.phone).toBeUndefined();

    const activateRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate')
      .send({ token: raw, password: 'A-strong-new-password1' })
      .expect(200);
    expect(activateRes.body.access_token).toBeDefined();
    const refreshCookie = extractRefreshCookie(activateRes);

    const refreshRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `__Host-refresh_token=${refreshCookie}`)
      .expect(200);
    expect(refreshRes.body.access_token).toBeDefined();
  });

  it('a used token cannot activate a second time', async () => {
    // The previous test left USER_ID with a password; an INVITE can no longer overwrite one
    // [68.1.2221], so start this case from a passwordless invitee again.
    await dataSource.query(`UPDATE users SET password_hash = NULL WHERE id = $1`, [USER_ID]);
    const { raw } = await authTokens.issue({
      userId: USER_ID,
      tenantId: SEED_TENANT_ID,
      purpose: AuthTokenPurpose.INVITE,
      ttlMs: INVITE_TTL_MS,
    });
    await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate')
      .send({ token: raw, password: 'A-strong-new-password1' })
      .expect(200);

    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate')
      .send({ token: raw, password: 'Another-strong-password1' })
      .expect(400);
    expect(res.body.message).toBe('consumed');
  });

  it('resend always returns 202, even for an unknown identifier', async () => {
    await supertest(app.getHttpServer())
      .post('/api/v1/auth/activate/resend')
      .send({ identifier: 'no-such-account@testschool.com' })
      .expect(202);
  });

  describe('forgot-password / reset-password', () => {
    // The issue's headline AC: a guardian who only has a phone on file
    // must be able to recover, end to end, with no email step at all.
    it('recovers with only a phone: forgot -> otp -> reset -> login with the new password', async () => {
      const forgotRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: PHONE_NUMBER })
        .expect(202);
      const otp = forgotRes.body.debug?.otp;
      expect(otp).toMatch(/^\d{6}$/);

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ new_password: 'A-brand-new-password1', phone: PHONE_NUMBER, otp })
        .expect(200);

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ phone: PHONE_NUMBER, password: 'A-brand-new-password1' })
        .expect(200);
    });

    // [75.2] A reset ends every session at once, access tokens included.
    it('an access token issued before a reset gets 401 afterwards; a fresh login works', async () => {
      const before = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ phone: PHONE_NUMBER, password: 'A-brand-new-password1' })
        .expect(200);
      const oldToken = before.body.access_token;
      await supertest(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(200);

      const forgot = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: PHONE_NUMBER })
        .expect(202);
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({
          new_password: 'A-brand-new-password1',
          phone: PHONE_NUMBER,
          otp: forgot.body.debug.otp,
        })
        .expect(200);

      await supertest(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ phone: PHONE_NUMBER, password: 'A-brand-new-password1' })
        .expect(200);
    });

    // D6's echo flag is ON for this whole spec (the recovery-flow test above
    // needs it), which necessarily makes `debug` differ between a known and
    // an unknown identifier — that field is exactly what the flag exists to
    // add for test observability. What must NOT differ, with or without the
    // flag, is the status code and every other field.
    it('gives an identical status and non-debug body for a known and an unknown identifier', async () => {
      const known = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: USER_EMAIL })
        .expect(202);
      const unknown = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: 'definitely-not-a-real-account@testschool.com' })
        .expect(202);

      expect(known.status).toBe(unknown.status);
      const { debug: _knownDebug, ...knownRest } = known.body;
      const { debug: _unknownDebug, ...unknownRest } = unknown.body;
      expect(knownRest).toEqual(unknownRest);
    });
  });

  describe('otp/request + otp/verify', () => {
    it('request -> verify with echo -> Set-Cookie __Host-refresh_token, and /auth/refresh succeeds with it', async () => {
      const requestRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONE_NUMBER })
        .expect(202);
      const otp = requestRes.body.debug?.otp;
      expect(otp).toMatch(/^\d{6}$/);

      const verifyRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONE_NUMBER, otp })
        .expect(200);
      expect(verifyRes.body.access_token).toBeDefined();
      const refreshCookie = extractRefreshCookie(verifyRes);

      const refreshRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `__Host-refresh_token=${refreshCookie}`)
        .expect(200);
      expect(refreshRes.body.access_token).toBeDefined();
    });

    it('password login for the same user still works', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ phone: PHONE_NUMBER, password: 'A-brand-new-password1' })
        .expect(200);
    });

    it('accepts a phone number typed with Bengali digits', async () => {
      const bengaliPhone = PHONE_NUMBER.replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'.charAt(Number(d)));

      const requestRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ phone: bengaliPhone })
        .expect(202);
      const otp = requestRes.body.debug?.otp;
      expect(otp).toMatch(/^\d{6}$/);

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ phone: bengaliPhone, otp })
        .expect(200);
    });

    // PHONE_NUMBER's LOGIN bucket in its canonical cap form (country code, no "+").
    const CAP_KEY = 'otp-cap:LOGIN:8801799990000';
    const LOGIN_COOLDOWN = `otp-cooldown:LOGIN:${PHONE_NUMBER}`;

    it("counts each sent code against the phone's hourly LOGIN budget, on real Redis", async () => {
      const redis = app.get(OTP_REDIS, { strict: false });
      const before = Number((await redis.get(CAP_KEY)) ?? 0);
      await redis.del(LOGIN_COOLDOWN);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONE_NUMBER })
        .expect(202);
      expect(res.body.debug?.otp).toMatch(/^\d{6}$/);

      expect(await redis.get(CAP_KEY)).toBe(String(before + 1));
      const ttl = await redis.pttl(CAP_KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3_600_000);
    });

    it('after 5 codes in an hour, sends nothing and answers like the cooldown', async () => {
      const redis = app.get(OTP_REDIS, { strict: false });
      const sent = async () =>
        (
          await dataSource.query(
            'SELECT count(*)::int AS n FROM communication_logs WHERE recipient_address = $1',
            [PHONE_NUMBER],
          )
        )[0].n as number;
      try {
        await redis.set(CAP_KEY, '5', 'PX', 3_600_000);
        await redis.del(LOGIN_COOLDOWN);
        const before = await sent();

        const res = await supertest(app.getHttpServer())
          .post('/api/v1/auth/otp/request')
          .send({ phone: PHONE_NUMBER })
          .expect(202);

        expect(res.body).toEqual({ debug: {} });
        expect(await sent()).toBe(before);
        expect(await redis.exists(LOGIN_COOLDOWN)).toBe(0);
      } finally {
        await redis.del(CAP_KEY);
      }
    });
  });
  // Epic 97 (#3301): the platform sender resolves OneCodeSoft from env alone (allowPlatformSms), no school keys.
  describe('OTP through the platform OneCodeSoft keys', () => {
    it('SMS_PROVIDER=onecodesoft + ONECODESOFT_* env sends the OTP through OneCodeSoft', async () => {
      vi.stubEnv('SMS_PROVIDER', 'onecodesoft');
      vi.stubEnv('ONECODESOFT_API_KEY', 'platform-key');
      vi.stubEnv('ONECODESOFT_SENDER_ID', 'Platform');
      vi.stubEnv('ONECODESOFT_API_URL', 'https://sms.example.com/api');
      const send = vi.spyOn(OnecodesoftProvider.prototype, 'send').mockResolvedValue({
        success: true,
        providerMessageId: 'm-1',
        outcome: 'ACCEPTED',
        segments: 1,
      });
      const redis = app.get(OTP_REDIS, { strict: false });
      try {
        await redis.del(`otp-cooldown:LOGIN:${PHONE_NUMBER}`, 'otp-cap:LOGIN:8801799990000');
        const res = await supertest(app.getHttpServer())
          .post('/api/v1/auth/otp/request')
          .send({ phone: PHONE_NUMBER })
          .expect(202);

        expect(send).toHaveBeenCalledTimes(1);
        const [params, config] = send.mock.calls[0];
        expect(params.body).toContain(res.body.debug.otp);
        expect(config).toMatchObject({
          apiKey: 'platform-key',
          senderId: 'Platform',
          apiUrl: 'https://sms.example.com/api',
        });
      } finally {
        send.mockRestore();
        vi.unstubAllEnvs();
        await redis.del(`otp-cooldown:LOGIN:${PHONE_NUMBER}`);
      }
    });
  });

  describe('email code sign-in and first password [13.2.2]', () => {
    it('emailed code signs in; first password follows the staff rules and can be set once', async () => {
      const requestRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ identifier: FP_EMAIL })
        .expect(202);
      const otp = requestRes.body.debug?.otp;
      expect(otp).toMatch(/^\d{6}$/);

      const verifyRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ identifier: FP_EMAIL, otp })
        .expect(200);
      expect(verifyRes.body).toMatchObject({ needs_password: true, password_required: true });
      const auth = { Authorization: `Bearer ${verifyRes.body.access_token}` };

      // No token -> 401.
      await supertest(app.getHttpServer())
        .post('/api/v1/account/first-password')
        .send({ password: 'Str0ng-pass' })
        .expect(401);

      // A TEACHER needs all five rules.
      const weak = await supertest(app.getHttpServer())
        .post('/api/v1/account/first-password')
        .set(auth)
        .send({ password: 'password1234' })
        .expect(400);
      expect(weak.body.details).toMatchObject({
        code: 'PASSWORD_TOO_WEAK',
        failed: ['upper', 'special'],
      });

      await supertest(app.getHttpServer())
        .post('/api/v1/account/first-password')
        .set(auth)
        .send({ password: 'Str0ng-pass' })
        .expect(204);

      const again = await supertest(app.getHttpServer())
        .post('/api/v1/account/first-password')
        .set(auth)
        .send({ password: 'Another-Str0ng-pass' })
        .expect(409);
      expect(again.body.details).toMatchObject({ code: 'PASSWORD_ALREADY_SET' });

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: FP_EMAIL, password: 'Str0ng-pass' })
        .expect(200);
    });

    it('a request with neither identifier nor phone is a 400', async () => {
      await supertest(app.getHttpServer()).post('/api/v1/auth/otp/request').send({}).expect(400);
    });

    it('unknown email gets the same 202 and no debug code', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ identifier: 'nobody-at-all@testschool.com' })
        .expect(202);
      expect(res.body.debug?.otp).toBeUndefined();
    });
  });

  // TEN-09 / D28: a user in 2+ schools has platform-level auth events and
  // platform-sent account messages; a one-school user keeps the old behaviour.
  describe('shared-user platform sender [TEN-09]', () => {
    const TENANT_B = '00000000-0000-4000-8000-0000000004b0';
    const SHARED_ID = '00000000-0000-4000-8000-0000000004b1';
    const SHARED_EMAIL = 'ten09-shared@testschool.com';
    const SHARED_PHONE = '01799991001';
    const SINGLE_ID = '00000000-0000-4000-8000-0000000004b2';
    const SINGLE_EMAIL = 'ten09-single@testschool.com';
    const SINGLE_PHONE = '01799991002';
    const NONE_ID = '00000000-0000-4000-8000-0000000004b3';
    const NONE_PHONE = '01799991003';
    // One school, two roles (TEACHER + PARENT, i.e. guardian): still a one-school user (F1).
    const MULTI_ID = '00000000-0000-4000-8000-0000000004b4';
    const MULTI_EMAIL = 'ten09-multi@testschool.com';
    const MULTI_PHONE = '01799991004';
    const ALL_IDS = [SHARED_ID, SINGLE_ID, NONE_ID, MULTI_ID];

    const commLogCount = async (tenantId: string, to: string): Promise<number> =>
      Number(
        (
          await dataSource.query(
            `SELECT COUNT(*)::int AS n FROM communication_logs WHERE tenant_id = $1 AND recipient_address = $2`,
            [tenantId, to],
          )
        )[0].n,
      );
    const auditTenants = async (userId: string, action: string): Promise<(string | null)[]> =>
      (
        await dataSource.query(
          `SELECT tenant_id FROM audit_logs WHERE entity_id = $1 AND action = $2`,
          [userId, action],
        )
      ).map((r: { tenant_id: string | null }) => r.tenant_id);

    beforeAll(async () => {
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'TEN-09 Second School', 'ten09-second-school', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [TENANT_B],
      );
      for (const [id, email, phone] of [
        [SHARED_ID, SHARED_EMAIL, SHARED_PHONE],
        [SINGLE_ID, SINGLE_EMAIL, SINGLE_PHONE],
        [NONE_ID, null, NONE_PHONE],
        [MULTI_ID, MULTI_EMAIL, MULTI_PHONE],
      ]) {
        await dataSource.query(
          `INSERT INTO users (id, email, phone, password_hash, full_name, status)
           VALUES ($1, $2, $3, $4, 'TEN-09 User', 'ACTIVE')
           ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'ACTIVE'`,
          [id, email, phone, SEED_ADMIN_PASSWORD_HASH],
        );
      }
      for (const [uid, tid, role] of [
        [SHARED_ID, SEED_TENANT_ID, 'TEACHER'],
        [SHARED_ID, TENANT_B, 'TEACHER'],
        [SINGLE_ID, SEED_TENANT_ID, 'TEACHER'],
        [MULTI_ID, SEED_TENANT_ID, 'TEACHER'],
        [MULTI_ID, SEED_TENANT_ID, 'PARENT'],
      ]) {
        await dataSource.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [uid, tid, role],
        );
      }
    }, 30000);

    afterAll(async () => {
      // audit_logs is write-only (trigger), so users are reset, not deleted.
      await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1)`, [ALL_IDS]);
      await dataSource.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [ALL_IDS]);
      await dataSource.query(`UPDATE users SET password_hash = NULL WHERE id = ANY($1)`, [ALL_IDS]);
      // Don't leak an extra ACTIVE school into later suites on this DB. If a
      // row still points at it, park it as SUSPENDED (nightly sweeps skip it).
      try {
        await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
      } catch {
        await dataSource.query(`UPDATE schools SET status = 'SUSPENDED' WHERE id = $1`, [TENANT_B]);
      }
    });

    it('shared user: failed login and login audit rows have tenant_id NULL', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SHARED_EMAIL, password: 'wrong-password-1' })
        .expect(401);
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SHARED_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);

      // Wrong password: no resolved user, so the row is keyed by identifier (weak claim; see SUSPENDED test).
      const failed = await dataSource.query(
        `SELECT tenant_id FROM audit_logs WHERE action = 'LOGIN_FAILED' AND new_values->>'identifier' = $1`,
        [SHARED_EMAIL],
      );
      expect(failed.map((r: { tenant_id: string | null }) => r.tenant_id)).toEqual([null]);
      expect(await auditTenants(SHARED_ID, 'LOGIN')).toEqual([null]);
    });

    it('suspended shared user: LOGIN_FAILED row carries the user id and tenant_id NULL; single-school control keeps its school', async () => {
      try {
        await dataSource.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = ANY($1)`, [
          [SHARED_ID, SINGLE_ID],
        ]);
        for (const email of [SHARED_EMAIL, SINGLE_EMAIL]) {
          await supertest(app.getHttpServer())
            .post('/api/v1/auth/login')
            .send({ email, password: SEED_ADMIN_PASSWORD })
            .expect(401);
        }
        expect(await auditTenants(SHARED_ID, 'LOGIN_FAILED')).toEqual([null]);
        expect(await auditTenants(SINGLE_ID, 'LOGIN_FAILED')).toEqual([SEED_TENANT_ID]);
      } finally {
        await dataSource.query(`UPDATE users SET status = 'ACTIVE' WHERE id = ANY($1)`, [
          [SHARED_ID, SINGLE_ID],
        ]);
      }
    });

    it('shared user: forgot-password writes no school communication log and the OTP still resets', async () => {
      const beforeA = await commLogCount(SEED_TENANT_ID, SHARED_PHONE);
      const beforeB = await commLogCount(TENANT_B, SHARED_PHONE);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: SHARED_PHONE })
        .expect(202);
      const otp = res.body.debug?.otp;
      expect(otp).toMatch(/^\d{6}$/);

      expect(await commLogCount(SEED_TENANT_ID, SHARED_PHONE)).toBe(beforeA);
      expect(await commLogCount(TENANT_B, SHARED_PHONE)).toBe(beforeB);
      expect(await auditTenants(SHARED_ID, 'PASSWORD_RESET_REQUESTED')).toEqual([null]);

      await supertest(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ new_password: 'Shared-new-password1', phone: SHARED_PHONE, otp })
        .expect(200);
    });

    it('shared user: emailed reset link is platform-sent, with a NULL-tenant token', async () => {
      // The phone reset above verified the phone; a verified email keeps
      // recovery on the email (link) branch instead of switching to the phone.
      await dataSource.query(`UPDATE users SET email_verified_at = NOW() WHERE id = $1`, [
        SHARED_ID,
      ]);
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: SHARED_EMAIL })
        .expect(202);
      expect(res.body.debug?.token).toEqual(expect.any(String));

      expect(await commLogCount(SEED_TENANT_ID, SHARED_EMAIL)).toBe(0);
      expect(await commLogCount(TENANT_B, SHARED_EMAIL)).toBe(0);
      const tokens = await dataSource.query(
        `SELECT tenant_id FROM auth_tokens WHERE user_id = $1 AND purpose = 'PASSWORD_RESET'`,
        [SHARED_ID],
      );
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every((t: { tenant_id: string | null }) => t.tenant_id === null)).toBe(true);
    });

    it('shared user is not locked out of sign-in by code', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ phone: SHARED_PHONE })
        .expect(202);
      const otp = res.body.debug?.otp;
      expect(otp).toMatch(/^\d{6}$/);
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ phone: SHARED_PHONE, otp })
        .expect(200);
    });

    it('single-school user: LOGIN row is that school and forgot-password logs one row naming it', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SINGLE_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      expect(await auditTenants(SINGLE_ID, 'LOGIN')).toEqual([SEED_TENANT_ID]);

      const before = await commLogCount(SEED_TENANT_ID, SINGLE_PHONE);
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: SINGLE_PHONE })
        .expect(202);
      expect(res.body.debug?.otp).toMatch(/^\d{6}$/);
      expect(await commLogCount(SEED_TENANT_ID, SINGLE_PHONE)).toBe(before + 1);
      const [{ name }] = await dataSource.query(`SELECT name FROM schools WHERE id = $1`, [
        SEED_TENANT_ID,
      ]);
      const [{ message_body }] = await dataSource.query(
        `SELECT message_body FROM communication_logs WHERE tenant_id = $1 AND recipient_address = $2 ORDER BY created_at DESC LIMIT 1`,
        [SEED_TENANT_ID, SINGLE_PHONE],
      );
      expect(message_body).toContain(name);
    });

    // Money + isolation (F1): two roles in ONE school is still a one-school
    // user. Their codes go out on the school's gateway (logged under it) and
    // their LOGIN row stays visible to that school's admin.
    it("one school, two roles (TEACHER + PARENT): LOGIN row and comm log are the school's", async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: MULTI_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      expect(await auditTenants(MULTI_ID, 'LOGIN')).toEqual([SEED_TENANT_ID]);

      const before = await commLogCount(SEED_TENANT_ID, MULTI_PHONE);
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: MULTI_PHONE })
        .expect(202);
      expect(res.body.debug?.otp).toMatch(/^\d{6}$/);
      expect(await commLogCount(SEED_TENANT_ID, MULTI_PHONE)).toBe(before + 1);
      expect(await auditTenants(MULTI_ID, 'PASSWORD_RESET_REQUESTED')).toEqual([SEED_TENANT_ID]);
    });

    it('user with no membership: nothing sent, same 202, no code echoed (non-enumerating)', async () => {
      const forgot = await supertest(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ identifier: NONE_PHONE })
        .expect(202);
      expect(forgot.body.debug?.otp).toBeUndefined();
      const otpReq = await supertest(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ phone: NONE_PHONE })
        .expect(202);
      expect(otpReq.body.debug?.otp).toBeUndefined();
    });
  });
});

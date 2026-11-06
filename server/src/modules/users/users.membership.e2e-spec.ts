import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AuthTokenPurpose, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { AuthTokenService } from '../account-access/auth-token.service';
import { CommunicationProviderRegistryService } from '../communications/providers/communication-provider.registry';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** [13.2.1] A teacher leaves a school; their next token refresh no longer lists it. */
describe('POST /users/me/leave (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const OTHER_TENANT = '00000000-0000-4000-8000-000000000391';
  const TEACHER_ID = '00000000-0000-4000-8000-000000000392';
  const EMAIL = 'leaver-1321@example.com';
  // Stays a member throughout: used for the denied-role checks.
  const STAFF_ID = '00000000-0000-4000-8000-000000000393';
  const STAFF_EMAIL = 'staff-1321@example.com';
  const PARENT_ID = '00000000-0000-4000-8000-000000000394';
  const FORMER_ID = '00000000-0000-4000-8000-000000000395';
  const REMOVED_ID = '00000000-0000-4000-8000-000000000396';
  const REMOVED_EMAIL = 'removed-2297@example.com';
  const REMOVED2_ID = '00000000-0000-4000-8000-000000000397';
  const REMOVED2_EMAIL = 'removed2-2297@example.com';
  const REMOVED3_ID = '00000000-0000-4000-8000-000000000398';
  const REMOVED3_EMAIL = 'removed3-2310@example.com';
  const PARENT_EMAIL = 'parent-1321@example.com';

  async function tokenFor(email: string): Promise<string> {
    const res = await request()
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  const request = () => supertest(app.getHttpServer());

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.use(cookieParser()); // refresh reads its token from the cookie
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Leave E2E Other School', 'leave-e2e-other', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_TENANT],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Leaving Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [TEACHER_ID, EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    for (const [id, email, role] of [
      [STAFF_ID, STAFF_EMAIL, UserRole.TEACHER],
      [PARENT_ID, PARENT_EMAIL, UserRole.PARENT],
      [REMOVED_ID, REMOVED_EMAIL, UserRole.ACCOUNTANT],
      [REMOVED2_ID, REMOVED2_EMAIL, UserRole.ACCOUNTANT],
      [REMOVED3_ID, REMOVED3_EMAIL, UserRole.ACCOUNTANT],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Denied Role', 'ACTIVE', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
    }
    for (const tenant of [SEED_TENANT_ID, OTHER_TENANT]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [TEACHER_ID, tenant, UserRole.TEACHER],
      );
    }
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [REMOVED2_ID, OTHER_TENANT, UserRole.ACCOUNTANT],
    );
  }, 60000);

  afterAll(async () => {
    // Best-effort: audit_logs is append-only, so the school and user may stay behind.
    const ids = [TEACHER_ID, STAFF_ID, PARENT_ID, FORMER_ID, REMOVED_ID, REMOVED2_ID, REMOVED3_ID];
    await dataSource.query('DELETE FROM user_tenants WHERE user_id = ANY($1)', [ids]);
    await dataSource.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [ids]);
    await app.close();
  });

  it('leaving a school drops it from the next refreshed token, the other school stays', async () => {
    const login = await request()
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    expect(login.body.memberships.map((m: { tenantId: string }) => m.tenantId).sort()).toEqual(
      [SEED_TENANT_ID, OTHER_TENANT].sort(),
    );
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('__Host-refresh_token='),
    )!;
    const refreshCookie = `__Host-refresh_token=${decodeURIComponent(cookie.split(';')[0].split('=')[1])}`;

    await request()
      .post('/api/v1/users/me/leave')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(204);

    const refreshed = await request()
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    expect(refreshed.body.memberships.map((m: { tenantId: string }) => m.tenantId)).toEqual([
      OTHER_TENANT,
    ]);
  });

  // [68.4 AUTH-07] Removal is immediate: the removed user's live access token dies at once.
  it('removing a member makes their existing access token 401; others and a fresh login are fine', async () => {
    const removedToken = await tokenFor(REMOVED_EMAIL);
    const bystanderToken = await tokenFor(STAFF_EMAIL);
    const adminToken = await tokenFor(SEED_ADMIN_EMAIL);
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${removedToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    await request()
      .delete(`/api/v1/users/${REMOVED_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${removedToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
    // Another user's live token in the same school is untouched.
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${bystanderToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);
    // A fresh login no longer lists the school, and its token is refused there
    // (401: ContextGuard treats a non-member as unauthenticated, not 403).
    const fresh = await request()
      .post('/api/v1/auth/login')
      .send({ email: REMOVED_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const tenants = fresh.body.memberships.map((m: { tenantId: string }) => m.tenantId);
    expect(tenants).not.toContain(SEED_TENANT_ID);
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${fresh.body.access_token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });

  // [75.2, D12] The DB cut-off alone refuses the token: wipe the Redis user cut-off
  // (best-effort, fail-open) and the old token is still 401.
  it('a removed member stays cut off without Redis (users.tokens_valid_after)', async () => {
    const token = await tokenFor(REMOVED3_EMAIL);
    const adminToken = await tokenFor(SEED_ADMIN_EMAIL);
    await request()
      .delete(`/api/v1/users/${REMOVED3_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    await redis.del(`access-denylist:user:${REMOVED3_ID}`);
    redis.disconnect();

    const [{ tokens_valid_after }] = await dataSource.query(
      'SELECT tokens_valid_after FROM users WHERE id = $1',
      [REMOVED3_ID],
    );
    expect(tokens_valid_after).not.toBeNull();
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });

  // The cut-off is per user, so the old token also dies for the user's other school;
  // the client refreshes on 401 and carries on there.
  it('a removed user keeps working in their other school after one refresh', async () => {
    const login = await request()
      .post('/api/v1/auth/login')
      .send({ email: REMOVED2_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('__Host-refresh_token='),
    )!;
    const refreshCookie = `__Host-refresh_token=${decodeURIComponent(cookie.split(';')[0].split('=')[1])}`;
    const adminToken = await tokenFor(SEED_ADMIN_EMAIL);

    await request()
      .delete(`/api/v1/users/${REMOVED2_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .set('X-Tenant-ID', OTHER_TENANT)
      .expect(401);
    const refreshed = await request()
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${refreshed.body.access_token}`)
      .set('X-Tenant-ID', OTHER_TENANT)
      .expect(200);
  });

  it('a TEACHER cannot restore a member (403)', async () => {
    const bearer1 = await tokenFor(STAFF_EMAIL);
    await request()
      .post(`/api/v1/users/${TEACHER_ID}/restore`)
      .set('Authorization', `Bearer ${bearer1}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('a TEACHER cannot remove a member (403) and the target token keeps working', async () => {
    const targetToken = await tokenFor(PARENT_EMAIL);

    const bearer2 = await tokenFor(STAFF_EMAIL);
    await request()
      .delete(`/api/v1/users/${PARENT_ID}`)
      .set('Authorization', `Bearer ${bearer2}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);

    // Denied path: no cut-off was set.
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${targetToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);
  });

  it('a PARENT cannot leave (403)', async () => {
    const bearer3 = await tokenFor(PARENT_EMAIL);
    await request()
      .post('/api/v1/users/me/leave')
      .set('Authorization', `Bearer ${bearer3}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('an admin cannot restore someone who left a DIFFERENT school (404, tenant isolation)', async () => {
    // FORMER_ID has a soft-deleted row in OTHER_TENANT only.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'former-1321@example.com', $2, 'Former Elsewhere', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [FORMER_ID, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [FORMER_ID, OTHER_TENANT, UserRole.TEACHER],
    );
    const bearer4 = await tokenFor(SEED_ADMIN_EMAIL);
    await request()
      .post(`/api/v1/users/${FORMER_ID}/restore`)
      .set('Authorization', `Bearer ${bearer4}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(404);
  });
});

/** [68.1.#2209] One login, many schools: a school may not retarget a shared person's login. */
describe('shared identity (68.1.#2209) (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const OTHER_TENANT = '00000000-0000-4000-8000-000000002091';
  const SHARED_ID = '00000000-0000-4000-8000-000000002092';
  const SOLO_ID = '00000000-0000-4000-8000-000000002093';
  const ELSEWHERE_ID = '00000000-0000-4000-8000-000000002094';
  const SHARED_EMAIL = 'shared-2209@example.com';
  const ACCOUNTANT_ID = '00000000-0000-4000-8000-000000002095';
  const ACCOUNTANT_EMAIL = 'accountant-2309@example.com';
  const ids = [SHARED_ID, SOLO_ID, ELSEWHERE_ID, ACCOUNTANT_ID];

  const request = () => supertest(app.getHttpServer());
  const adminToken = async () =>
    (
      await request()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
  const count = async (sql: string, params: unknown[]) =>
    Number((await dataSource.query(sql, params))[0].n);

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    // D6: the approval and sign-in endpoints echo the codes they send, so the spec can use them.
    process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';
    // Review R1: a proposal whose link (or code) was not delivered is a 503, and CI has no
    // SMTP/SMS gateway, so this block's sends go to a gateway that accepts everything.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CommunicationProviderRegistryService)
      .useValue({
        resolve: () => ({ send: async () => ({ success: true, providerMessageId: 'e2e' }) }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Shared Identity Other School', 'shared-identity-2209', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_TENANT],
    );
    for (const [id, email] of [
      [SHARED_ID, SHARED_EMAIL],
      [SOLO_ID, 'solo-2209@example.com'],
      [ELSEWHERE_ID, 'elsewhere-2209@example.com'],
      [ACCOUNTANT_ID, ACCOUNTANT_EMAIL],
    ]) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Identity Person', 'ACTIVE', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
    }
    for (const [id, tenant, role] of [
      [SHARED_ID, SEED_TENANT_ID, UserRole.TEACHER],
      [SHARED_ID, OTHER_TENANT, UserRole.ADMIN],
      [SOLO_ID, SEED_TENANT_ID, UserRole.TEACHER],
      [ELSEWHERE_ID, OTHER_TENANT, UserRole.TEACHER],
      [ACCOUNTANT_ID, SEED_TENANT_ID, UserRole.ACCOUNTANT],
    ]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, tenant, role],
      );
    }
  }, 60000);

  afterAll(async () => {
    delete process.env.ACCOUNT_ACCESS_ECHO_SECRETS;
    await dataSource.query('DELETE FROM user_tenants WHERE user_id = ANY($1)', [ids]);
    await dataSource.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [ids]);
    await app.close();
  });

  const get = (token: string) =>
    request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);
  const login = async (email: string) =>
    (
      await request()
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
  const patch = async (id: string, body: object) => {
    const bearer5 = await adminToken();
    return request()
      .patch(`/api/v1/users/${id}`)
      .set('Authorization', `Bearer ${bearer5}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send(body)
      .expect(200);
  };

  // [75.1] Was a 409 under #2209: now the change is held until the person approves it.
  it('B admin PATCH of a shared user email is pending: 200, DB unchanged, one ADMIN_PROPOSAL token', async () => {
    const res = await patch(SHARED_ID, { email: 'attacker@evil.test' });
    expect(res.body.pending_contact_change).toBe('email');
    expect(res.body.email).toBe(SHARED_EMAIL);
    const [row] = await dataSource.query('SELECT email FROM users WHERE id = $1', [SHARED_ID]);
    expect(row.email).toBe(SHARED_EMAIL);
    const tokens = await dataSource.query(
      `SELECT metadata FROM auth_tokens
        WHERE user_id = $1 AND purpose = 'EMAIL_VERIFY' AND revoked_at IS NULL AND consumed_at IS NULL`,
      [SHARED_ID],
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0].metadata.kind).toBe('ADMIN_PROPOSAL');
  });

  it('a name change in the same request is saved now; the phone stays pending', async () => {
    const res = await patch(SHARED_ID, { full_name: 'Renamed Person', phone: '+8801700000999' });
    expect(res.body.pending_contact_change).toBe('phone');
    const [row] = await dataSource.query('SELECT full_name, phone FROM users WHERE id = $1', [
      SHARED_ID,
    ]);
    expect(row.full_name).toBe('Renamed Person');
    expect(row.phone).toBeNull();
  });

  /** The raw link only ever reaches the person's inbox; mint the same token the way the server
   * did (copying the stored proposal) to drive the public verify-email route. */
  const proposalLink = async () => {
    const [live] = await dataSource.query(
      `SELECT metadata, tenant_id, created_by_user_id FROM auth_tokens
        WHERE user_id = $1 AND purpose = 'EMAIL_VERIFY' AND revoked_at IS NULL AND consumed_at IS NULL
          AND metadata->>'kind' = 'ADMIN_PROPOSAL'`,
      [SHARED_ID],
    );
    return (
      await app.get(AuthTokenService).issue({
        userId: SHARED_ID,
        tenantId: live.tenant_id,
        purpose: AuthTokenPurpose.EMAIL_VERIFY,
        ttlMs: 3_600_000,
        createdByUserId: live.created_by_user_id,
        metadata: live.metadata,
      })
    ).raw;
  };
  const verifyEmail = (body: object) =>
    request().post('/api/v1/auth/verify-email').send(body).expect(200);

  // D23 (review M1): approving is consent; the NEW phone must still prove itself with a code.
  it('approving sends a code to the new phone; only that code applies the change, and old tokens get 401', async () => {
    const oldToken = await login(SHARED_EMAIL);
    await get(oldToken).expect(200);
    await patch(SHARED_ID, { phone: '+8801700000998' });
    const raw = await proposalLink();

    // Opening the link only shows the proposal, in full (D25); nothing changes yet.
    const peek = await verifyEmail({ token: raw });
    expect(peek.body.status).toBe('proposal');
    expect(peek.body.proposal.new_phone).toBe('+8801700000998');

    const asked = await verifyEmail({ token: raw, action: 'approve' });
    expect(asked.body.status).toBe('confirm');
    const [pending] = await dataSource.query('SELECT phone FROM users WHERE id = $1', [SHARED_ID]);
    expect(pending.phone).not.toBe('+8801700000998');
    await get(oldToken).expect(200);

    const res = await verifyEmail({
      token: raw,
      action: 'approve',
      phone_code: asked.body.debug.phone_code,
    });
    expect(res.body.status).toBe('valid');

    const [row] = await dataSource.query(
      'SELECT phone, phone_verified_at FROM users WHERE id = $1',
      [SHARED_ID],
    );
    expect(row.phone).toBe('+8801700000998');
    expect(row.phone_verified_at).not.toBeNull();
    await get(oldToken).expect(401);
  });

  // The review's M1 repro: the person asked for one address, a malicious admin typed their own,
  // and the (then masked) approval page looked the same. Approving must not hand the admin a login.
  it('a malicious admin cannot redirect sign-in or recovery: an approved but unconfirmed email is never a login', async () => {
    const ATTACKER = 'jack-2309@evil.test';
    await patch(SHARED_ID, { email: ATTACKER });
    const raw = await proposalLink();
    // D25: the person's page shows the address in full, so they can see it is not theirs.
    expect((await verifyEmail({ token: raw })).body.proposal.new_email).toBe(ATTACKER);
    const asked = await verifyEmail({ token: raw, action: 'approve' });
    expect(asked.body.status).toBe('confirm');
    // The code went to the attacker's inbox (echoed here). Without the person's link it is useless.
    const stolenCode = asked.body.debug.email_code as string;

    const [row] = await dataSource.query('SELECT email FROM users WHERE id = $1', [SHARED_ID]);
    expect(row.email).toBe(SHARED_EMAIL);
    // Sign-in by code and password recovery find no account at the attacker's address.
    const otp = await request()
      .post('/api/v1/auth/otp/request')
      .send({ identifier: ATTACKER })
      .expect(202);
    expect(otp.body.debug).toBeUndefined();
    const forgot = await request()
      .post('/api/v1/auth/forgot-password')
      .send({ identifier: ATTACKER })
      .expect(202);
    expect(forgot.body.debug).toBeUndefined();
    // Nor does the code the attacker received sign anyone in.
    const signIn = await request()
      .post('/api/v1/auth/otp/verify')
      .send({ identifier: ATTACKER, otp: stolenCode });
    expect(signIn.status).toBeGreaterThanOrEqual(400);
    expect(signIn.body.access_token).toBeUndefined();
    // The person's own address still signs in.
    await login(SHARED_EMAIL);

    // The person declines once they see the code never reached them.
    expect((await verifyEmail({ token: raw, action: 'decline' })).body.status).toBe('declined');
    const [after] = await dataSource.query('SELECT email FROM users WHERE id = $1', [SHARED_ID]);
    expect(after.email).toBe(SHARED_EMAIL);
  });

  it('declining the proposal cancels it: nothing changes and the link is spent', async () => {
    await patch(SHARED_ID, { phone: '+8801700000997' });
    const [live] = await dataSource.query(
      `SELECT metadata, tenant_id, created_by_user_id FROM auth_tokens
        WHERE user_id = $1 AND purpose = 'EMAIL_VERIFY' AND revoked_at IS NULL AND consumed_at IS NULL`,
      [SHARED_ID],
    );
    const { raw } = await app.get(AuthTokenService).issue({
      userId: SHARED_ID,
      tenantId: live.tenant_id,
      purpose: AuthTokenPurpose.EMAIL_VERIFY,
      ttlMs: 3_600_000,
      createdByUserId: live.created_by_user_id,
      metadata: live.metadata,
    });

    const res = await request()
      .post('/api/v1/auth/verify-email')
      .send({ token: raw, action: 'decline' })
      .expect(200);

    expect(res.body.status).toBe('declined');
    const [row] = await dataSource.query('SELECT phone FROM users WHERE id = $1', [SHARED_ID]);
    expect(row.phone).not.toBe('+8801700000997');
    const again = await request()
      .post('/api/v1/auth/verify-email')
      .send({ token: raw, action: 'approve' })
      .expect(200);
    expect(again.body.status).toBe('consumed');
  });

  it('an ACCOUNTANT cannot PATCH a user contact (403); nothing is proposed or changed', async () => {
    const accountantToken = await login(ACCOUNTANT_EMAIL);
    const before = await count(
      `SELECT count(*) n FROM auth_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
      [SHARED_ID],
    );
    await request()
      .patch(`/api/v1/users/${SHARED_ID}`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ phone: '+8801700000996' })
      .expect(403);
    expect(
      await count(`SELECT count(*) n FROM auth_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [
        SHARED_ID,
      ]),
    ).toBe(before);
  });

  it('B admin gets 409 on reset-password of a shared user: no token, no log, no session revoked', async () => {
    // Earlier cases (the approval) revoked this user's sessions; start from none.
    await dataSource.query('DELETE FROM refresh_tokens WHERE user_id = $1', [SHARED_ID]);
    await dataSource.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, created_at)
       VALUES ($1, gen_random_uuid(), 'hash-2209', NOW() + interval '1 day', NOW())`,
      [SHARED_ID],
    );
    const tokens = 'SELECT count(*) n FROM auth_tokens WHERE user_id = $1';
    const logs = 'SELECT count(*) n FROM communication_logs WHERE recipient_address = $1';
    const tokensBefore = await count(tokens, [SHARED_ID]);
    const logsBefore = await count(logs, [SHARED_EMAIL]);
    const bearer6 = await adminToken();
    await request()
      .post(`/api/v1/users/${SHARED_ID}/reset-password`)
      .set('Authorization', `Bearer ${bearer6}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(409);
    expect(await count(tokens, [SHARED_ID])).toBe(tokensBefore);
    expect(await count(logs, [SHARED_EMAIL])).toBe(logsBefore);
    expect(
      await count(
        'SELECT count(*) n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NOT NULL',
        [SHARED_ID],
      ),
    ).toBe(0);
  });

  it('B admin PATCH of the email of a user who belongs only to B: 200, applied, old token 401', async () => {
    const oldToken = await login('solo-2209@example.com');
    await get(oldToken).expect(200);
    await new Promise((r) => setTimeout(r, 20));

    const res = await patch(SOLO_ID, { email: 'solo-2209-new@example.com' });

    expect(res.body.pending_contact_change).toBeUndefined();
    expect(res.body.email).toBe('solo-2209-new@example.com');
    await get(oldToken).expect(401);
  });

  it('a name-only edit of a single-school user signs nobody out', async () => {
    const token = await login('solo-2209-new@example.com');
    await patch(SOLO_ID, { full_name: 'Solo Renamed' });
    await get(token).expect(200);
  });

  it('B admin gets 404 on PATCH of a user with no membership in B', async () => {
    const bearer7 = await adminToken();
    await request()
      .patch(`/api/v1/users/${ELSEWHERE_ID}`)
      .set('Authorization', `Bearer ${bearer7}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ email: 'x-2209@example.com' })
      .expect(404);
  });
});

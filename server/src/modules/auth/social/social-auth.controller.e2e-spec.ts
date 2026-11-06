import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import { DataSource } from 'typeorm';
import { SocialProvider } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { AuthService } from '../auth.service';
import { SOCIAL_PROVIDERS, type SocialProviderClient } from './providers/social-provider';
import { SocialTicketService } from './social-ticket.service';
import { SocialIdentityService } from './social-identity.service';

const API = '/api/v1';

/** Stands in for Google/Facebook: no network, subject chosen by the test. */
function stubProvider(name: SocialProvider): SocialProviderClient & {
  configured: boolean;
  nextSubject: string;
  nextEmail: string | null;
} {
  return {
    name,
    configured: true,
    nextSubject: 'sub-default',
    nextEmail: 'person@example.com' as string | null,
    isConfigured() {
      return this.configured;
    },
    authorizeUrl: ({ state }) => `https://provider.test/auth?state=${state}`,
    async exchange() {
      return { subject: this.nextSubject, email: this.nextEmail, name: 'Person' };
    },
  };
}

/** E2E for /auth/social/* [13.2.4] with the provider stubbed. */
describe('SocialAuthController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const google = stubProvider(SocialProvider.GOOGLE);
  const facebook = stubProvider(SocialProvider.FACEBOOK);

  const NOLOGIN_ID = '00000000-0000-4000-8000-0000000013a1';
  const ABROAD_ID = '00000000-0000-4000-8000-0000000013a2';
  // Not deleted in afterAll: its disconnect writes an audit row, and audit_logs
  // is append-only (the test reset truncates it between runs).
  const TWO_WAYS_ID = '00000000-0000-4000-8000-0000000013a3';
  const NO_SCHOOL_ID = '00000000-0000-4000-8000-0000000013a4';
  const FB_DELETE_ID = '00000000-0000-4000-8000-0000000013a5';
  const FB_OTHER_ID = '00000000-0000-4000-8000-0000000013a6';
  const SUB_PREFIX = 'e2e-social-';

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SOCIAL_PROVIDERS)
      .useValue([google, facebook])
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    google.configured = true;
    await dataSource.query(`DELETE FROM user_identities WHERE subject LIKE $1`, [`${SUB_PREFIX}%`]);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM user_identities WHERE subject LIKE $1`, [`${SUB_PREFIX}%`]);
    await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [NOLOGIN_ID, ABROAD_ID, NO_SCHOOL_ID, FB_DELETE_ID, FB_OTHER_ID],
    ]);
    await app.close();
  });

  const http = () => supertest(app.getHttpServer());
  const stateOf = (location: string) => new URL(location).searchParams.get('state') as string;

  async function adminToken(): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function startLogin(provider = 'google', intent = 'login'): Promise<string> {
    const res = await http()
      .get(`${API}/auth/social/${provider}/start?intent=${intent}`)
      .expect(302);
    return stateOf(res.headers.location);
  }

  const callback = (state: string, provider = 'google', cookie: string | null = state) =>
    http()
      .get(`${API}/auth/social/${provider}/callback?code=abc&state=${state}`)
      .set('Cookie', cookie ? [`social_state=${cookie}`] : []);

  async function sessionFor(userId: string): Promise<string> {
    const user = await dataSource.getRepository('User').findOneByOrFail({ id: userId });
    const session = await app
      .get(AuthService)
      .startSession(user as never, { ip: null, userAgent: null });
    return session.access_token;
  }

  async function connect(
    subject: string,
    token: string,
    password = SEED_ADMIN_PASSWORD,
  ): Promise<string> {
    google.nextSubject = subject;
    const res = await http()
      .post(`${API}/auth/social/google/link-start`)
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: password })
      .expect(200);
    const state = stateOf(res.body.url);
    return (await callback(state)).headers.location;
  }

  it('lists no provider when none is configured, and 404s the routes', async () => {
    google.configured = false;
    facebook.configured = false;
    const list = await http().get(`${API}/auth/social/providers`).expect(200);
    expect(list.body.providers).toEqual([]);
    await http().get(`${API}/auth/social/google/start?intent=login`).expect(404);
    facebook.configured = true;
  });

  describe('POST /auth/social/facebook/data-deletion', () => {
    const FB_SECRET = 'e2e-facebook-secret';
    const signedFor = (payload: Record<string, unknown>, secret = FB_SECRET) => {
      const issued = { issued_at: Math.floor(Date.now() / 1000), ...payload };
      const body = Buffer.from(JSON.stringify(issued)).toString('base64url');
      return `${createHmac('sha256', secret).update(body).digest('base64url')}.${body}`;
    };
    const post = (signed: string | undefined) =>
      http()
        .post(`${API}/auth/social/facebook/data-deletion`)
        .type('form')
        .send(signed === undefined ? {} : { signed_request: signed });

    beforeEach(() => {
      process.env.FACEBOOK_OAUTH_CLIENT_SECRET = FB_SECRET;
    });
    afterAll(() => {
      delete process.env.FACEBOOK_OAUTH_CLIENT_SECRET;
    });

    it('removes only the Facebook identity; the user and other identities stay', async () => {
      await dataSource.query(
        `INSERT INTO users (id, full_name, status) VALUES ($1, 'FB Delete', 'ACTIVE'), ($2, 'FB Other', 'ACTIVE')
         ON CONFLICT (id) DO NOTHING`,
        [FB_DELETE_ID, FB_OTHER_ID],
      );
      const inserted: Array<{ id: string; subject: string }> = await dataSource.query(
        `INSERT INTO user_identities (user_id, provider, subject)
         VALUES ($1, 'google', $2), ($1, 'facebook', $3), ($4, 'facebook', $5)
         RETURNING id, subject`,
        [
          FB_DELETE_ID,
          `${SUB_PREFIX}del-g`,
          `${SUB_PREFIX}del-f`,
          FB_OTHER_ID,
          `${SUB_PREFIX}other-f`,
        ],
      );
      const deleted = inserted.find((row) => row.subject === `${SUB_PREFIX}del-f`)!;
      const res = await post(
        signedFor({ algorithm: 'HMAC-SHA256', user_id: `${SUB_PREFIX}del-f` }),
      ).expect(200);
      expect(res.body.confirmation_code).toEqual(expect.any(String));
      expect(res.body.url).toContain(res.body.confirmation_code);

      const left = await dataSource.query(
        `SELECT provider FROM user_identities WHERE user_id = $1`,
        [FB_DELETE_ID],
      );
      expect(left).toEqual([{ provider: 'google' }]);
      const users = await dataSource.query(`SELECT id FROM users WHERE id = $1`, [FB_DELETE_ID]);
      expect(users).toHaveLength(1);
      // Another person's Facebook identity is untouched.
      const other = await dataSource.query(`SELECT 1 FROM user_identities WHERE user_id = $1`, [
        FB_OTHER_ID,
      ]);
      expect(other).toHaveLength(1);
      // The deletion is audited against the deleted row, with the code handed to Meta.
      const audit = await dataSource.query(
        `SELECT entity_id, tenant_id FROM audit_logs WHERE action = 'DELETE'
         AND entity_type = 'UserIdentity' AND old_values->>'confirmation_code' = $1`,
        [res.body.confirmation_code],
      );
      // This user has no school, so the primary tenant is null.
      expect(audit).toEqual([{ entity_id: deleted.id, tenant_id: null }]);
    });

    it('answers 200 for an unknown Facebook user and still records the code', async () => {
      const res = await post(signedFor({ algorithm: 'HMAC-SHA256', user_id: 'nobody' })).expect(
        200,
      );
      const audit = await dataSource.query(
        `SELECT entity_id FROM audit_logs WHERE old_values->>'confirmation_code' = $1`,
        [res.body.confirmation_code],
      );
      expect(audit).toEqual([{ entity_id: null }]);
    });

    it('the returned url opens a plain, script-free confirmation page', async () => {
      const res = await post(signedFor({ algorithm: 'HMAC-SHA256', user_id: 'nobody' })).expect(
        200,
      );
      const url = new URL(res.body.url);
      expect(url.pathname).toBe(`${API}/auth/social/facebook/data-deletion/status`);
      const page = await http().get(`${url.pathname}${url.search}`).expect(200);
      expect(page.headers['content-type']).toContain('text/html');
      expect(page.headers['content-security-policy']).toContain("default-src 'none'");
      expect(page.text).toContain(res.body.confirmation_code);
      expect(page.text).toContain('lang="bn"');
      expect(page.text).not.toContain('<script');
    });

    it('400s the status page for a code that is not a UUID', async () => {
      await http()
        .get(`${API}/auth/social/facebook/data-deletion/status?code=<script>alert(1)</script>`)
        .expect(400);
    });

    it('400s a replayed (stale) signed_request', async () => {
      const stale = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
      await post(signedFor({ algorithm: 'HMAC-SHA256', user_id: 'x', issued_at: stale })).expect(
        400,
      );
    });

    it('400s a bad signature, a wrong algorithm, and a missing body', async () => {
      await post(signedFor({ algorithm: 'HMAC-SHA256', user_id: 'x' }, 'wrong')).expect(400);
      await post(signedFor({ algorithm: 'HMAC-SHA1', user_id: 'x' })).expect(400);
      await post(undefined).expect(400);
    });

    it('404s when Facebook is not configured on this server', async () => {
      delete process.env.FACEBOOK_OAUTH_CLIENT_SECRET;
      await post(signedFor({ algorithm: 'HMAC-SHA256', user_id: 'x' })).expect(404);
    });

    it('still answers when sign-in is off (no client id) but the secret is set', async () => {
      facebook.configured = false;
      try {
        await post(signedFor({ algorithm: 'HMAC-SHA256', user_id: 'x' })).expect(200);
      } finally {
        facebook.configured = true;
      }
    });
  });

  it('lists configured providers', async () => {
    const list = await http().get(`${API}/auth/social/providers`).expect(200);
    expect(list.body.providers).toEqual(['google', 'facebook']);
  });

  it('login with a subject that is not connected goes to not_linked and sets no session', async () => {
    google.nextSubject = `${SUB_PREFIX}unknown`;
    const res = await callback(await startLogin());
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?social=not_linked');
    expect(res.headers['set-cookie']?.join(';') ?? '').not.toContain('refresh_token');
  });

  it('connects on purpose, then login with that identity signs the user in', async () => {
    const token = await adminToken();
    expect(await connect(`${SUB_PREFIX}admin`, token)).toContain('/security?linked=google');

    google.nextSubject = `${SUB_PREFIX}admin`;
    const res = await callback(await startLogin());
    expect(res.headers.location).toContain('/auth/social/done');
    expect(res.headers['set-cookie'].join(';')).toContain('refresh_token');

    const identities = await http()
      .get(`${API}/auth/social/identities`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(identities.body).toHaveLength(1);
    expect(identities.body[0].provider).toBe('google');
  });

  it('connects a phone-only account (no email from the provider) and stores email NULL', async () => {
    google.nextEmail = null;
    expect(await connect(`${SUB_PREFIX}no-email`, await adminToken())).toContain(
      '/security?linked=google',
    );
    google.nextEmail = 'person@example.com';
    const rows = await dataSource.query(`SELECT email FROM user_identities WHERE subject = $1`, [
      `${SUB_PREFIX}no-email`,
    ]);
    expect(rows).toEqual([{ email: null }]);
  });

  it('never connects by matching email: same email, unknown subject stays unlinked', async () => {
    // The provider vouches for the admin's own address, but the subject is new.
    google.nextEmail = SEED_ADMIN_EMAIL;
    google.nextSubject = `${SUB_PREFIX}same-email`;
    const res = await callback(await startLogin());
    expect(res.headers.location).toContain('not_linked');
    const rows = await dataSource.query(`SELECT 1 FROM user_identities WHERE subject = $1`, [
      `${SUB_PREFIX}same-email`,
    ]);
    expect(rows).toHaveLength(0);
    google.nextEmail = 'person@example.com';
  });

  it('link conflict: a subject already connected to another user', async () => {
    const token = await adminToken();
    expect(await connect(`${SUB_PREFIX}shared`, token)).toContain('linked=google');
    await dataSource.query(
      `INSERT INTO users (id, full_name, status, password_hash) VALUES ($1, 'No Login', 'ACTIVE', $2)
       ON CONFLICT (id) DO UPDATE SET password_hash = $2`,
      [NOLOGIN_ID, SEED_ADMIN_PASSWORD_HASH],
    );
    const other = await app
      .get(AuthService)
      .startSession(
        (await dataSource.getRepository('User').findOneByOrFail({ id: NOLOGIN_ID })) as never,
        { ip: null, userAgent: null },
      );
    expect(await connect(`${SUB_PREFIX}shared`, other.access_token)).toContain(
      '/security?social=conflict',
    );
  });

  it('register intent sets the ticket cookie and keeps the ticket id out of the URL', async () => {
    google.nextSubject = `${SUB_PREFIX}new`;
    const res = await callback(await startLogin('google', 'register'));
    expect(res.headers.location).toContain('/register?social=google');
    expect(res.headers.location).not.toContain('ticket');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('social_ticket='),
    ) as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth');
    const ticketId = cookie.split(';')[0].split('=')[1];
    const ticket = await app.get(SocialTicketService).consume(ticketId);
    expect(ticket?.subject).toBe(`${SUB_PREFIX}new`);
    expect(await app.get(SocialTicketService).consume(ticketId)).toBeNull(); // read-once
  });

  it('a replayed state is refused: back to login, no session', async () => {
    const state = await startLogin();
    await callback(state).expect(302);
    const res = await callback(state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?social=failed');
    expect(res.headers['set-cookie']?.join(';') ?? '').not.toContain('refresh_token');
  });

  it('a state started for another provider is refused', async () => {
    const state = await startLogin('facebook');
    const res = await callback(state, 'google');
    expect(res.headers.location).toContain('social=failed');
  });

  it('a state without the matching browser cookie is refused', async () => {
    const state = await startLogin();
    const res = await callback(state, 'google', null);
    expect(res.headers.location).toContain('social=failed');
  });

  it('a provider error redirects with social=cancelled', async () => {
    const state = await startLogin();
    const res = await http()
      .get(`${API}/auth/social/google/callback?error=access_denied&state=${state}`)
      .set('Cookie', [`social_state=${state}`]);
    expect(res.headers.location).toContain('/login?social=cancelled');
  });

  it('start with intent=link is a 400; link-start without a bearer is a 401', async () => {
    await http().get(`${API}/auth/social/google/start?intent=link`).expect(400);
    await http().post(`${API}/auth/social/google/link-start`).expect(401);
  });

  describe('link-start password gate', () => {
    const post = (token: string) =>
      http().post(`${API}/auth/social/google/link-start`).set('Authorization', `Bearer ${token}`);

    it('400s with no body', async () => {
      await post(await adminToken()).expect(400);
    });

    it('403s on a wrong password and sets no state cookie', async () => {
      const res = await post(await adminToken())
        .send({ current_password: 'not-the-password' })
        .expect(403);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('200s with the right password, a url and the state cookie', async () => {
      const res = await post(await adminToken())
        .send({ current_password: SEED_ADMIN_PASSWORD })
        .expect(200);
      expect(res.body.url).toContain('state=');
      expect(String(res.headers['set-cookie'])).toContain('social_state=');
    });

    it('400 NO_PASSWORD for a passwordless account', async () => {
      await dataSource.query(
        `INSERT INTO users (id, full_name, status, password_hash) VALUES ($1, 'No Login', 'ACTIVE', NULL)
         ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', password_hash = NULL`,
        [NOLOGIN_ID],
      );
      const res = await post(await sessionFor(NOLOGIN_ID))
        .send({ current_password: SEED_ADMIN_PASSWORD })
        .expect(400);
      expect(res.body.details?.code).toBe('NO_PASSWORD');
    });

    it("another user's password does not unlock the bearer's own link-start", async () => {
      // NOLOGIN has a password hash, but it is checked against the bearer's own user (the
      // admin), so a password that is only the other user's is refused.
      await dataSource.query(
        `INSERT INTO users (id, full_name, status, password_hash) VALUES ($1, 'No Login', 'ACTIVE', $2)
         ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', password_hash = $2`,
        [NOLOGIN_ID, await bcrypt.hash('only-nologin-knows', 4)],
      );
      await post(await adminToken())
        .send({ current_password: 'only-nologin-knows' })
        .expect(403);
    });
  });

  it('an inactive user with a connected identity gets not_linked and no session', async () => {
    await dataSource.query(
      `INSERT INTO users (id, full_name, status) VALUES ($1, 'No Login', 'INACTIVE')
       ON CONFLICT (id) DO UPDATE SET status = 'INACTIVE'`,
      [NOLOGIN_ID],
    );
    await dataSource.query(
      `INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`,
      [NOLOGIN_ID, `${SUB_PREFIX}inactive`],
    );
    google.nextSubject = `${SUB_PREFIX}inactive`;
    const res = await callback(await startLogin());
    expect(res.headers.location).toContain('/login?social=not_linked');
    expect(res.headers['set-cookie']?.join(';') ?? '').not.toContain('refresh_token');
    await dataSource.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [NOLOGIN_ID]);
  });

  it('can still disconnect after the provider is no longer configured', async () => {
    const token = await adminToken();
    await connect(`${SUB_PREFIX}gone`, token);
    google.configured = false;
    await http()
      .delete(`${API}/auth/social/identities/google`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  it('refuses to remove the last sign-in method, allows it when a password remains', async () => {
    // A user with no password, email or phone: the identity is their only way in.
    await dataSource.query(
      `INSERT INTO users (id, full_name, status) VALUES ($1, 'No Login', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET password_hash = NULL`,
      [NOLOGIN_ID],
    );
    await dataSource.query(
      `INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`,
      [NOLOGIN_ID, `${SUB_PREFIX}only`],
    );
    const lone = await app
      .get(AuthService)
      .startSession(
        (await dataSource.getRepository('User').findOneByOrFail({ id: NOLOGIN_ID })) as never,
        { ip: null, userAgent: null },
      );
    const refused = await http()
      .delete(`${API}/auth/social/identities/google`)
      .set('Authorization', `Bearer ${lone.access_token}`)
      .expect(409);
    expect(refused.body.details.code).toBe('LAST_SIGN_IN_METHOD');

    const token = await adminToken();
    await connect(`${SUB_PREFIX}removable`, token);
    await http()
      .delete(`${API}/auth/social/identities/google`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });
  it('a callback with no state lands on the failure page, not raw JSON', async () => {
    const res = await http().get(`${API}/auth/social/google/callback?code=abc`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?social=failed');
  });

  it('does not connect for a user suspended between link-start and the callback', async () => {
    await dataSource.query(
      `INSERT INTO users (id, full_name, status, password_hash) VALUES ($1, 'No Login', 'ACTIVE', $2)
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', password_hash = $2`,
      [NOLOGIN_ID, SEED_ADMIN_PASSWORD_HASH],
    );
    google.nextSubject = `${SUB_PREFIX}suspended`;
    const bearer1 = await sessionFor(NOLOGIN_ID);
    const started = await http()
      .post(`${API}/auth/social/google/link-start`)
      .set('Authorization', `Bearer ${bearer1}`)
      .send({ current_password: SEED_ADMIN_PASSWORD })
      .expect(200);
    await dataSource.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [NOLOGIN_ID]);

    const res = await callback(stateOf(started.body.url));
    expect(res.headers.location).toContain('/security?social=failed');
    const rows = await dataSource.query(`SELECT 1 FROM user_identities WHERE subject = $1`, [
      `${SUB_PREFIX}suspended`,
    ]);
    expect(rows).toHaveLength(0);
    await dataSource.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [NOLOGIN_ID]);
  });

  it('a phone that code sign-in cannot reach does not count as a way in', async () => {
    // Foreign number, no email: no code can be sent (D31), so Google is the last way in.
    await dataSource.query(
      `INSERT INTO users (id, full_name, status, phone) VALUES ($1, 'Abroad', 'ACTIVE', '+14155550199')
       ON CONFLICT (id) DO NOTHING`,
      [ABROAD_ID],
    );
    await dataSource.query(
      `INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`,
      [ABROAD_ID, `${SUB_PREFIX}abroad`],
    );
    const bearer2 = await sessionFor(ABROAD_ID);
    const refused = await http()
      .delete(`${API}/auth/social/identities/google`)
      .set('Authorization', `Bearer ${bearer2}`)
      .expect(409);
    expect(refused.body.details.code).toBe('LAST_SIGN_IN_METHOD');
  });

  it('another connected account counts as a way in', async () => {
    // No password, email or phone: only the second (Facebook) account remains.
    await dataSource.query(
      `INSERT INTO users (id, full_name, status) VALUES ($1, 'Two Ways', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [TWO_WAYS_ID],
    );
    await dataSource.query(
      `INSERT INTO user_identities (user_id, provider, subject)
       VALUES ($1, 'google', $2), ($1, 'facebook', $3)`,
      [TWO_WAYS_ID, `${SUB_PREFIX}two-g`, `${SUB_PREFIX}two-f`],
    );
    const bearer3 = await sessionFor(TWO_WAYS_ID);
    await http()
      .delete(`${API}/auth/social/identities/google`)
      .set('Authorization', `Bearer ${bearer3}`)
      .expect(204);
  });

  it('an email with no live school membership does not count as a way in', async () => {
    // Code sign-in sends nothing to a user with no live membership, so the
    // email alone must not let them remove their only connected account.
    await dataSource.query(
      `INSERT INTO users (id, full_name, status, email)
       VALUES ($1, 'No School', 'ACTIVE', 'no-school@e2e-social.example')
       ON CONFLICT (id) DO NOTHING`,
      [NO_SCHOOL_ID],
    );
    await dataSource.query(
      `INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`,
      [NO_SCHOOL_ID, `${SUB_PREFIX}no-school`],
    );
    const bearer4 = await sessionFor(NO_SCHOOL_ID);
    const refused = await http()
      .delete(`${API}/auth/social/identities/google`)
      .set('Authorization', `Bearer ${bearer4}`)
      .expect(409);
    expect(refused.body.details.code).toBe('LAST_SIGN_IN_METHOD');
  });

  it('a server error while connecting lands back on /security, not /login', async () => {
    const spy = vi
      .spyOn(app.get(SocialIdentityService), 'link')
      .mockRejectedValueOnce(new Error('db down'));
    try {
      const location = await connect(`${SUB_PREFIX}fault`, await adminToken());
      expect(location).toContain('/security?social=failed');
    } finally {
      spy.mockRestore();
    }
  });
});

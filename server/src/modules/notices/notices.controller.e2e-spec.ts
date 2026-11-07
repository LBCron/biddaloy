import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { NoticesService } from './notices.service';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** [53.2.04] Notice authoring over HTTP: permissions, headers, validation, idempotency, delete guard. */
describe('Notices API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let otherToken: string; // a second user (TEACHER) so "another author" is a real different person
  let otherUserId: string;
  const extra: string[] = [];
  const api = () => supertest(app.getHttpServer());
  const tag = randomUUID().slice(0, 8);

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    o: {
      role?: UserRole;
      token?: string;
      tenant?: string | null;
      body?: object;
      key?: string;
    } = {},
  ) => {
    let r = api()
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${o.token ?? adminToken}`);
    r = r.set('X-Role', o.role ?? UserRole.ADMIN);
    const tenant = o.tenant === undefined ? SEED_TENANT_ID : o.tenant;
    if (tenant) r = r.set('X-Tenant-ID', tenant);
    if (o.key) r = r.set('Idempotency-Key', o.key);
    return o.body ? r.send(o.body) : r;
  };
  const mk = async (o: Parameters<typeof call>[2] = {}) =>
    (
      await call('post', '/notices', {
        ...o,
        body: { title: `E2E ${tag}`, body: 'hello' },
      }).expect(201)
    ).body;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    for (const role of [
      UserRole.OFFICE_STAFF,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ]) {
      const rows = await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING id`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
      if (rows[0]) extra.push(rows[0].id);
    }
    adminToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;

    const email = `notices-other-${tag}@e2e.example`;
    [{ id: otherUserId }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,'Other Teacher','ACTIVE',NOW(),NOW()) RETURNING id`,
      [email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
      [otherUserId, SEED_TENANT_ID],
    );
    otherToken = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  // the push fan-out after publish is detached; let it finish before the next test
  afterEach(() => app.get(NoticesService).idle());

  afterAll(async () => {
    await ds.query(`DELETE FROM notice_recipients WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM notices WHERE tenant_id = $1 AND title = $2`, [
      SEED_TENANT_ID,
      `E2E ${tag}`,
    ]);
    await ds.query(`DELETE FROM user_tenants WHERE id = ANY($1::uuid[])`, [extra]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = $1`, [otherUserId]);
    await app.close();
  });

  it('permission matrix: ADMIN, OFFICE_STAFF and TEACHER can post; PARENT and STUDENT get 403', async () => {
    for (const role of [UserRole.ADMIN, UserRole.OFFICE_STAFF, UserRole.TEACHER]) {
      await call('post', '/notices', { role, body: { title: `E2E ${tag}`, body: 'x' } }).expect(
        201,
      );
    }
    for (const role of [UserRole.PARENT, UserRole.STUDENT]) {
      await call('post', '/notices', { role, body: { title: 'x', body: 'x' } }).expect(403);
      await call('get', '/notices', { role }).expect(403);
    }
  });

  // The context guard answers before any handler: a missing or foreign tenant is 401 on EVERY route.
  const ID = '00000000-0000-4000-8000-0000000000bb';
  const BOGUS_TENANT = '00000000-0000-4000-8000-00000000dead';
  const tenantRejected = async (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) => {
    await call(method, path, { tenant: null, body }).expect(401);
    await call(method, path, { tenant: BOGUS_TENANT, body }).expect(401);
  };

  it('POST /notices: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('post', '/notices', { title: 'x', body: 'x' }));

  it('GET /notices: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('get', '/notices'));

  it('GET /notices/:id: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('get', `/notices/${ID}`));

  it('PATCH /notices/:id: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('patch', `/notices/${ID}`, { title: 'x' }));

  it('DELETE /notices/:id: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('delete', `/notices/${ID}`));

  it('POST /notices/:id/copy: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('post', `/notices/${ID}/copy`));

  it('GET /notices/:id/recipients: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('get', `/notices/${ID}/recipients`));

  it('POST /notices/:id/recipients: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('post', `/notices/${ID}/recipients`, { items: [{ kind: 'STAFF' }] }));

  it('POST /notices/:id/recipients/matching: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('post', `/notices/${ID}/recipients/matching`, { target: 'STAFF', tab: 'ROLE' }));

  it('DELETE /notices/:id/recipients: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('delete', `/notices/${ID}/recipients`, {
      ids: ['00000000-0000-4000-8000-0000000000aa'],
    }));

  it('POST /notices/:id/publish: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('post', `/notices/${ID}/publish`, {}));

  it('POST /notices/:id/withdraw: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('post', `/notices/${ID}/withdraw`));

  it('POST /notices/:id/sms/request: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('post', `/notices/${ID}/sms/request`));

  it('POST /notices/:id/public-link: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('post', `/notices/${ID}/public-link`));

  it('DELETE /notices/:id/public-link: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('delete', `/notices/${ID}/public-link`));

  it('GET /notices/:id/report: missing or foreign X-Tenant-ID is 401', () =>
    tenantRejected('get', `/notices/${ID}/report`));

  it('a non-UUID id is 400 on every id route', async () => {
    await call('get', '/notices/not-a-uuid').expect(400);
    await call('patch', '/notices/not-a-uuid', { body: { title: 'x' } }).expect(400);
    await call('delete', '/notices/not-a-uuid').expect(400);
    await call('post', '/notices/not-a-uuid/publish', { body: {} }).expect(400);
    await call('post', '/notices/not-a-uuid/withdraw').expect(400);
    await call('get', '/notices/not-a-uuid/recipients').expect(400);
    await call('get', '/notices/not-a-uuid/report').expect(400);
  });

  it('limit 101 is 400 on list, recipients and report; bad bodies are 400', async () => {
    const n = await mk();
    await call('get', '/notices?limit=101').expect(400);
    await call('get', `/notices/${n.id}/recipients?limit=101`).expect(400);
    await call('get', `/notices/${n.id}/report?limit=101`).expect(400);
    await call('post', '/notices', { body: { title: 'x'.repeat(141), body: 'x' } }).expect(400);
    await call('post', '/notices', { body: { title: 'x', body: 'y'.repeat(5001) } }).expect(400);
    await call('post', '/notices', {
      body: { title: 'x', body: 'x', expiresOn: '2000-01-01' },
    }).expect(400);
    await call('post', `/notices/${n.id}/recipients`, {
      body: { items: [{ kind: 'STUDENT', studentId: 'nope' }] },
    }).expect(400);
  });

  it("a teacher cannot read, edit, publish or delete another author's notice: 404", async () => {
    const n = await mk(); // authored by the seed admin
    const t = { token: otherToken, role: UserRole.TEACHER };
    await call('get', `/notices/${n.id}`, t).expect(404);
    await call('patch', `/notices/${n.id}`, { ...t, body: { title: 'hijack' } }).expect(404);
    await call('delete', `/notices/${n.id}`, t).expect(404);
    await call('post', `/notices/${n.id}/publish`, { ...t, body: {} }).expect(404);
    await call('post', `/notices/${n.id}/copy`, t).expect(404);
    await call('get', `/notices/${n.id}/report`, t).expect(404);
    // their own list is empty of it; the admin (NOTICE_MANAGE) still reads it
    const mine = await call('get', `/notices?q=${tag}`, t).expect(200);
    expect(mine.body.items.map((i: { id: string }) => i.id)).not.toContain(n.id);
    await call('get', `/notices/${n.id}`).expect(200);
  });

  it('full flow: choose, publish (idempotent), no re-publish without the key, delete is 409', async () => {
    const n = await mk();
    // add staff by ref, read the Chosen list back
    const added = await call('post', `/notices/${n.id}/recipients`, {
      body: { items: [{ kind: 'STAFF', userId: SEED_ADMIN_USER_ID }] },
    }).expect(201);
    expect(added.body).toEqual({ added: 1, total: 1 });
    const list = await call('get', `/notices/${n.id}/recipients`).expect(200);
    expect(list.body.total).toBe(1);

    const key = `pub-${tag}`;
    const first = await call('post', `/notices/${n.id}/publish`, { body: {}, key }).expect(200);
    const second = await call('post', `/notices/${n.id}/publish`, { body: {}, key }).expect(200);
    // the second answer is the replay of the first: one publish, same timestamp
    expect(second.body.publishedAt).toBe(first.body.publishedAt);
    const audits = await ds.query(
      `SELECT 1 FROM audit_logs WHERE entity_id = $1 AND new_values->>'event' = 'PUBLISH'`,
      [n.id],
    );
    expect(audits).toHaveLength(1);
    // without the key a second publish is refused
    await call('post', `/notices/${n.id}/publish`, { body: {} }).expect(409);

    // delete a published notice: 409 with the fixed sentence
    const del = await call('delete', `/notices/${n.id}`).expect(409);
    expect(del.body.message).toBe('প্রকাশিত নোটিশ মুছে ফেলা যায় না, তুলে নিন');
    // recipients are frozen
    await call('post', `/notices/${n.id}/recipients`, {
      body: { items: [{ kind: 'STAFF', userId: SEED_ADMIN_USER_ID }] },
    }).expect(409);

    const rep = await call('get', `/notices/${n.id}/report`).expect(200);
    expect(rep.body.totals.people).toBe(1);

    await call('post', `/notices/${n.id}/withdraw`).expect(200);
    await call('post', `/notices/${n.id}/withdraw`).expect(409);
  });

  it('publish of a public notice never returns the raw token, so the idempotency cache never holds it (M3)', async () => {
    const n = (
      await call('post', '/notices', {
        body: { title: `E2E ${tag}`, body: 'hello', isPublic: true },
      }).expect(201)
    ).body;
    await call('post', `/notices/${n.id}/recipients`, {
      body: { items: [{ kind: 'STAFF', userId: SEED_ADMIN_USER_ID }] },
    }).expect(201);
    const key = `pubtok-${tag}`;
    const first = await call('post', `/notices/${n.id}/publish`, { body: {}, key }).expect(200);
    const replay = await call('post', `/notices/${n.id}/publish`, { body: {}, key }).expect(200);
    // the interceptor stores exactly this body in Redis for 24 h
    expect(first.body).not.toHaveProperty('publicLinkToken');
    expect(replay.body).not.toHaveProperty('publicLinkToken');
    expect(first.body.isPublic).toBe(true);
    // the token comes from the uncached route instead
    const link = await call('post', `/notices/${n.id}/public-link`).expect(201);
    expect(typeof link.body.token).toBe('string');
  });

  it('PATCH with null on a NOT NULL field is 400, not 500 (m2)', async () => {
    const n = await mk();
    for (const k of ['title', 'body', 'important', 'pinned', 'isPublic'])
      await call('patch', `/notices/${n.id}`, { body: { [k]: null } }).expect(400);
    await call('patch', `/notices/${n.id}`, { body: { expiresOn: null } }).expect(200);
  });

  it('a draft can be edited, copied, emptied and deleted; publishing it empty is 400', async () => {
    const n = await mk();
    await call('post', `/notices/${n.id}/publish`, { body: {} }).expect(400);
    await call('patch', `/notices/${n.id}`, { body: { title: `E2E ${tag}`, pinned: true } }).expect(
      200,
    );
    const copy = await call('post', `/notices/${n.id}/copy`).expect(201);
    expect(copy.body.id).not.toBe(n.id);
    await call('delete', `/notices/${copy.body.id}`).expect(204);
    await call('get', `/notices/${copy.body.id}`).expect(404);
    await call('delete', `/notices/${n.id}`).expect(204);
  });

  it('select-all with an invalid tab combo is 400; recipient removal takes a body of ids', async () => {
    const n = await mk();
    await call('post', `/notices/${n.id}/recipients/matching`, {
      body: { target: 'STAFF', tab: 'FEE_DUE' },
    }).expect(400);
    const added = await call('post', `/notices/${n.id}/recipients`, {
      body: { items: [{ kind: 'STAFF', userId: SEED_ADMIN_USER_ID }] },
    }).expect(201);
    expect(added.body.added).toBe(1);
    const [row] = (await call('get', `/notices/${n.id}/recipients`).expect(200)).body.items;
    await call('delete', `/notices/${n.id}/recipients`, { body: { ids: [row.id] } }).expect(204);
    expect((await call('get', `/notices/${n.id}/recipients`).expect(200)).body.total).toBe(0);
  });

  it('[40.3.02] pinnedOnWebsite is saved on create and update; ?isPublic filters the list', async () => {
    const title = `E2E ${tag}`;
    const pub = (
      await call('post', '/notices', {
        body: { title, body: 'x', isPublic: true, pinnedOnWebsite: true },
        key: randomUUID(),
      }).expect(201)
    ).body;
    const priv = (
      await call('post', '/notices', { body: { title, body: 'x' }, key: randomUUID() }).expect(201)
    ).body;
    expect(pub.pinnedOnWebsite).toBe(true);
    expect(priv.pinnedOnWebsite).toBe(false);

    const upd = await call('patch', `/notices/${priv.id}`, {
      body: { pinnedOnWebsite: true },
    }).expect(200);
    expect(upd.body.pinnedOnWebsite).toBe(true);
    await call('patch', `/notices/${priv.id}`, { body: { pinnedOnWebsite: null } }).expect(400);

    const ids = async (q: string) =>
      (await call('get', `/notices?limit=100${q}`).expect(200)).body.items.map(
        (n: { id: string }) => n.id,
      );
    const onlyPublic = await ids('&isPublic=true');
    expect(onlyPublic).toContain(pub.id);
    expect(onlyPublic).not.toContain(priv.id);
    const onlyPrivate = await ids('&isPublic=false');
    expect(onlyPrivate).toContain(priv.id);
    expect(onlyPrivate).not.toContain(pub.id);
    await call('get', '/notices?isPublic=maybe').expect(400);
  });

  it('GET /notices/mine (reader route) is still reachable and not swallowed by :id', async () => {
    await call('get', '/notices/mine', { role: UserRole.PARENT }).expect(200);
  });
});

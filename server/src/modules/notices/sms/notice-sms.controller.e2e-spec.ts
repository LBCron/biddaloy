import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { COMMUNICATIONS_QUEUE } from '../../communications/communications.constants';
import { FailOpenThrottlerStorage } from '../../../common/rate-limit/fail-open-throttler-storage';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
} from '@test/constants';

/** [53.5.01] Notice SMS approval over HTTP: permissions, headers, Redis-down answer, masked phones. */
describe('Notice SMS API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  const extra: string[] = [];
  const api = () => supertest(app.getHttpServer());
  const sfx = randomUUID().slice(0, 8);
  const PHONE = '01712345234';
  let redisDown = false;
  // (class_section_id, roll_number) is unique: a counter, never a random pick that can repeat.
  let roll = 8000;

  const call = (
    method: 'get' | 'post' | 'patch',
    path: string,
    o: { role?: UserRole; tenant?: string | null; body?: object; key?: string } = {},
  ) => {
    let r = api()
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', o.role ?? UserRole.ADMIN);
    const tenant = o.tenant === undefined ? SEED_TENANT_ID : o.tenant;
    if (tenant) r = r.set('X-Tenant-ID', tenant);
    if (o.key) r = r.set('Idempotency-Key', o.key);
    return o.body ? r.send(o.body) : r;
  };

  /** A PUBLISHED notice with a PENDING SMS request and one reachable guardian. */
  const pending = async () => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO notices (id, tenant_id, author_user_id, title, body, status, published_at, sms_status,
                            sms_requested_by_user_id, sms_requested_at)
       VALUES ($1,$2,$3,$4,'b','PUBLISHED',NOW(),'PENDING',$3,NOW())`,
      [id, SEED_TENANT_ID, SEED_ADMIN_USER_ID, `E2E SMS ${sfx}`],
    );
    const g = (
      await ds.query(
        `INSERT INTO guardians (full_name, relationship, phone, tenant_id, preferred_communication,
                                is_primary_contact, notifications_enabled, created_at, updated_at)
         VALUES ('G E2E','FATHER',$1,$2,'SMS',true,true,NOW(),NOW()) RETURNING id`,
        [PHONE, SEED_TENANT_ID],
      )
    )[0].id;
    const s = (
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                               enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ('Kid E2E',$1,$2,$3,$4,'ACTIVE','SMS',NOW(),NOW()) RETURNING id`,
        [
          `NS-${randomUUID().slice(0, 10)}`,
          roll++,
          SEED_SECTION_1_ID,
          SEED_TENANT_ID,
        ],
      )
    )[0].id;
    await ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, guardian_id, student_id)
       VALUES ($1,$2,'GUARDIAN',$3,$4)`,
      [SEED_TENANT_ID, id, g, s],
    );
    return id;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Lets one test pretend the rate-limit store (Redis) is down.
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async (...a: unknown[]) => {
          if (redisDown)
            return new FailOpenThrottlerStorage({
              increment: () => Promise.reject(new Error('ECONNREFUSED')),
            }).increment(...(a as [string, number, number, number, string]));
          return { totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 };
        },
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    vi.spyOn(app.get(getQueueToken(COMMUNICATIONS_QUEUE)), 'add').mockResolvedValue({} as never);
    for (const role of [UserRole.OFFICE_STAFF, UserRole.TEACHER, UserRole.EXECUTIVE]) {
      const rows = await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING id`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
      if (rows[0]) extra.push(rows[0].id);
    }
    token = (
      await api()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 90000);

  afterAll(async () => {
    if (ds) {
      await ds.query(
        `DELETE FROM notice_recipients WHERE notice_id IN (SELECT id FROM notices WHERE title = $1)`,
        [`E2E SMS ${sfx}`],
      );
      await ds.query(`DELETE FROM communication_logs WHERE recipient_address = $1`, [PHONE]);
      await ds.query(`DELETE FROM notices WHERE title = $1`, [`E2E SMS ${sfx}`]);
      await ds.query(`DELETE FROM students WHERE full_name = 'Kid E2E'`);
      await ds.query(`DELETE FROM guardians WHERE full_name = 'G E2E'`);
      if (extra.length)
        await ds.query(`DELETE FROM user_tenants WHERE id = ANY($1::uuid[])`, [extra]);
    }
    await app?.close();
  });

  it('permission matrix: ADMIN can read; OFFICE_STAFF and TEACHER get 403 on every route', async () => {
    const id = await pending();
    await call('get', `/notices/${id}/sms`).expect(200);
    for (const role of [UserRole.OFFICE_STAFF, UserRole.TEACHER]) {
      await call('get', `/notices/${id}/sms`, { role }).expect(403);
      await call('patch', `/notices/${id}/sms/recipients`, {
        role,
        body: { ids: [randomUUID()], smsWanted: false },
      }).expect(403);
      await call('post', `/notices/${id}/sms/approve`, { role }).expect(403);
      await call('post', `/notices/${id}/sms/decline`, { role }).expect(403);
    }
    // the refused calls changed nothing
    const [{ sms_status }] = await ds.query(`SELECT sms_status FROM notices WHERE id = $1`, [id]);
    expect(sms_status).toBe('PENDING');
  });

  it('EXECUTIVE (holds NOTICE_SMS_APPROVE) can read the request too', async () => {
    const id = await pending();
    await call('get', `/notices/${id}/sms`, { role: UserRole.EXECUTIVE }).expect(200);
  });

  it('ADMIN and EXECUTIVE can untick and re-tick a person while the request is pending', async () => {
    const id = await pending();
    const [{ id: rid }] = await ds.query(`SELECT id FROM notice_recipients WHERE notice_id = $1`, [
      id,
    ]);
    const wanted = async () =>
      (await ds.query(`SELECT sms_wanted FROM notice_recipients WHERE id = $1`, [rid]))[0]
        .sms_wanted;
    const off = await call('patch', `/notices/${id}/sms/recipients`, {
      body: { ids: [rid], smsWanted: false },
    }).expect(200);
    expect(off.body).toEqual({ updated: 1 });
    expect(await wanted()).toBe(false);
    const on = await call('patch', `/notices/${id}/sms/recipients`, {
      role: UserRole.EXECUTIVE,
      body: { ids: [rid], smsWanted: true },
    }).expect(200);
    expect(on.body).toEqual({ updated: 1 });
    expect(await wanted()).toBe(true);
  });

  it('ADMIN approves; the answer is 200 with the queued count', async () => {
    const id = await pending();
    const res = await call('post', `/notices/${id}/sms/approve`, {
      key: `k-${randomUUID()}`,
    }).expect(200);
    expect(res.body).toEqual({ status: 'APPROVED', queued: 1 });
  });

  it('same Idempotency-Key replays the first answer and queues nothing more', async () => {
    const id = await pending();
    const queue = app.get(getQueueToken(COMMUNICATIONS_QUEUE));
    const before = (queue.add as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const key = `k-${randomUUID()}`;
    const first = await call('post', `/notices/${id}/sms/approve`, { key }).expect(200);
    const second = await call('post', `/notices/${id}/sms/approve`, { key }).expect(200);
    expect(second.body).toEqual(first.body);
    expect((queue.add as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
    // a different key is a real second approve and is refused
    await call('post', `/notices/${id}/sms/approve`, { key: `k-${randomUUID()}` }).expect(409);
  });

  it('ADMIN declines; a later approve is 409', async () => {
    const id = await pending();
    await call('post', `/notices/${id}/sms/decline`).expect(200);
    const res = await call('post', `/notices/${id}/sms/approve`).expect(409);
    // the page tells "already decided" apart from an in-flight duplicate (no code) by this
    expect(res.body.details).toEqual({ code: 'NOTICE_SMS_NOT_PENDING' });
  });

  it('approve on an expired notice is 409 and the request is DECLINED after the response', async () => {
    const id = await pending();
    await ds.query(`UPDATE notices SET expires_on = '2000-01-01' WHERE id = $1`, [id]);
    const res = await call('post', `/notices/${id}/sms/approve`).expect(409);
    expect(JSON.stringify(res.body)).not.toContain('2000-01-01');
    expect(res.body.details).toEqual({ code: 'NOTICE_SMS_NOT_LIVE' });
    // the close commits on its own, so it survives the 409
    const [n] = await ds.query(`SELECT sms_status FROM notices WHERE id = $1`, [id]);
    expect(n.sms_status).toBe('DECLINED');
    const v = await call('get', `/notices/${id}/sms`).expect(200);
    expect([v.body.live, v.body.status]).toEqual([false, 'DECLINED']);
  });

  it('missing, foreign or malformed X-Tenant-ID is 401 on every route', async () => {
    const id = randomUUID();
    const bogus = '00000000-0000-4000-8000-00000000dead';
    // 'not-a-uuid': same 401 the context guard gives elsewhere (staff-attendance.e2e-spec.ts)
    for (const tenant of [null, bogus, 'not-a-uuid']) {
      await call('get', `/notices/${id}/sms`, { tenant }).expect(401);
      await call('patch', `/notices/${id}/sms/recipients`, {
        tenant,
        body: { ids: [id], smsWanted: true },
      }).expect(401);
      await call('post', `/notices/${id}/sms/approve`, { tenant }).expect(401);
      await call('post', `/notices/${id}/sms/decline`, { tenant }).expect(401);
    }
  });

  it('a non-UUID id is 400', async () => {
    await call('get', '/notices/not-a-uuid/sms').expect(400);
    await call('post', '/notices/not-a-uuid/sms/approve').expect(400);
  });

  it('approve with Redis down answers 503 with the fixed sentence and sends nothing', async () => {
    const id = await pending();
    redisDown = true;
    // The app skips rate limiting when NODE_ENV is 'test'; turn that off for this one request.
    const cfg = app.get(ConfigService);
    const realGet = cfg.get.bind(cfg) as (k: string) => unknown;
    const spy = vi
      .spyOn(cfg, 'get')
      .mockImplementation(((k: string) =>
        k === 'NODE_ENV' ? 'development' : realGet(k)) as never);
    try {
      const res = await call('post', `/notices/${id}/sms/approve`).expect(503);
      expect(res.body.message).toBe(
        'This action is temporarily unavailable. Please try again in a few minutes.',
      );
    } finally {
      redisDown = false;
      spy.mockRestore();
    }
    const [{ sms_status }] = await ds.query(`SELECT sms_status FROM notices WHERE id = $1`, [id]);
    expect(sms_status).toBe('PENDING');
  });

  it('responses carry masked phones only', async () => {
    const id = await pending();
    const res = await call('get', `/notices/${id}/sms`).expect(200);
    expect(res.body.items[0].phone).toBe('01•••••234');
    expect(JSON.stringify(res.body)).not.toContain(PHONE);
  });
});

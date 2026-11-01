import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Readable } from 'node:stream';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { StorageService } from '../../storage/storage.service';
import { PUBLIC_NOTICE_RATE_LIMIT } from '../../../rate-limit';
import { NoticeLinksModule } from './notice-links.module';
import { NoticeLinksService } from './notice-links.service';
import { PublicNoticeController, NOTICE_LINK_NOT_FOUND } from './public-notice.controller';

/** [53.2.02] `/public/notices/*`: no auth header, no tenant header. */
describe('Public Notice links E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let links: NoticeLinksService;
  const base = '/api/v1/public/notices';

  async function notice(
    over: Record<string, unknown> = {},
  ): Promise<{ id: string; tenant_id: string }> {
    const [r] = await ds.query(
      `INSERT INTO notices (tenant_id, author_user_id, title, body, status, published_at)
       VALUES ($1,$2,'Exam notice','Body text','PUBLISHED',NOW()) RETURNING id, tenant_id`,
      [SEED_TENANT_ID, SEED_ADMIN_USER_ID],
    );
    if (over.status)
      await ds.query(`UPDATE notices SET status = $2 WHERE id = $1`, [r.id, over.status]);
    return r;
  }

  async function file(noticeId: string): Promise<string> {
    const [r] = await ds.query(
      `INSERT INTO notice_attachments (tenant_id, notice_id, storage_key, mime_type, size_bytes, original_name)
       VALUES ($1,$2,$3,'application/pdf',10,'a.pdf') RETURNING id`,
      [SEED_TENANT_ID, noticeId, `tenants/${SEED_TENANT_ID}/notices/a.pdf`],
    );
    return r.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, NoticeLinksModule],
    })
      .overrideProvider(StorageService)
      .useValue({
        getForTenant: async () => ({ body: Readable.from(['%PDF-fake']), contentType: 'x' }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    links = app.get(NoticeLinksService);
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM notice_recipients WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM notice_attachments WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM notices WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await app.close();
  });

  it('opens with no auth header and returns no author or recipient data', async () => {
    const n = await notice();
    const fid = await file(n.id);
    const token = await links.createPublicLink(n);
    const res = await supertest(app.getHttpServer()).get(`${base}/${token}`).expect(200);
    expect(res.body).toMatchObject({ title: 'Exam notice', body: 'Body text' });
    expect(res.body.files).toEqual([{ id: fid, mimeType: 'application/pdf', name: 'a.pdf' }]);
    expect(Object.keys(res.body).sort()).toEqual(
      ['body', 'editedAt', 'files', 'publishedAt', 'schoolName', 'title'].sort(),
    );
    // `/api/*` no-store (Rule 14) is set in main.ts, not in this test app.
  });

  it('unknown and turned-off tokens get the same 404 body', async () => {
    const n = await notice();
    const token = await links.createPublicLink(n);
    await links.turnOffPublicLink(n);
    const off = await supertest(app.getHttpServer()).get(`${base}/${token}`).expect(404);
    const unknown = await supertest(app.getHttpServer()).get(`${base}/nope-nope`).expect(404);
    expect(off.body).toEqual(unknown.body);
    expect(off.body.message).toBe(NOTICE_LINK_NOT_FOUND);
    // The error never echoes what was sent.
    expect(JSON.stringify(unknown.body)).not.toContain('nope-nope');
  });

  it('streams the file inline with no-store and safe headers', async () => {
    const n = await notice();
    const fid = await file(n.id);
    const token = await links.createPublicLink(n);
    const res = await supertest(app.getHttpServer())
      .get(`${base}/${token}/files/${fid}`)
      .expect(200);
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  it("another notice's file id is a 404 with the same sentence; non-UUID is 400", async () => {
    const a = await notice();
    const b = await notice();
    const bFile = await file(b.id);
    const token = await links.createPublicLink(a);
    const res = await supertest(app.getHttpServer())
      .get(`${base}/${token}/files/${bFile}`)
      .expect(404);
    expect(res.body.message).toBe(NOTICE_LINK_NOT_FOUND);
    await supertest(app.getHttpServer()).get(`${base}/${token}/files/not-a-uuid`).expect(400);
  });

  it('POST opened: 204 for personal and public tokens, 404 for a dead one', async () => {
    const n = await notice();
    const [r] = await ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id) VALUES ($1,$2,'STAFF',$3) RETURNING id`,
      [SEED_TENANT_ID, n.id, SEED_ADMIN_USER_ID],
    );
    const [p] = await links.createPersonalLinks(n.id, [r.id]);
    await supertest(app.getHttpServer()).post(`${base}/${p.token}/opened`).expect(204);
    const [row] = await ds.query(`SELECT seen_at FROM notice_recipients WHERE id = $1`, [r.id]);
    expect(row.seen_at).not.toBeNull();
    const pub = await links.createPublicLink(n);
    await supertest(app.getHttpServer()).post(`${base}/${pub}/opened`).expect(204);
    const dead = await supertest(app.getHttpServer()).post(`${base}/nope/opened`).expect(404);
    expect(dead.body.message).toBe(NOTICE_LINK_NOT_FOUND);
  });

  it('withdrawn notice link is a 404', async () => {
    const n = await notice();
    const token = await links.createPublicLink(n);
    await ds.query(`UPDATE notices SET status = 'WITHDRAWN', withdrawn_at = NOW() WHERE id = $1`, [
      n.id,
    ]);
    await supertest(app.getHttpServer()).get(`${base}/${token}`).expect(404);
  });

  // The e2e stack turns throttling off when NODE_ENV=test (same as the invoice
  // spec), so a real 429 cannot be provoked. Assert the tier and that every
  // route carries it.
  it('applies the 30/min PUBLIC_NOTICE_RATE_LIMIT tier to every route', () => {
    expect(PUBLIC_NOTICE_RATE_LIMIT).toEqual({ limit: 30, ttl: 60_000 });
    const proto = PublicNoticeController.prototype;
    for (const handler of [proto.get, proto.file, proto.opened]) {
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(30);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
    }
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Readable } from 'node:stream';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { Permission, roleHasPermission, UserRole } from '@biddaloy/shared';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH, SEED_TENANT_ID } from '@test/constants';
import { StorageService } from '../../storage/storage.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = Buffer.from('%PDF-1.4 test');
const EXE = Buffer.from('MZ\x90\x00 not a pdf');

/**
 * [53.2.02] Notice reader + files over HTTP. Cast (tenant A): ADMIN (NOTICE_MANAGE), TEACHER author,
 * another TEACHER, PARENT recipient, PARENT outsider. Storage is faked (spied).
 */
describe('Notice access E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  const API = '/api/v1/notices';
  const sfx = randomUUID().slice(0, 8);
  const ids = {
    admin: randomUUID(),
    author: randomUUID(),
    other: randomUUID(),
    reader: randomUUID(),
    outsider: randomUUID(),
  };
  const roles: Record<keyof typeof ids, UserRole> = {
    admin: UserRole.ADMIN,
    author: UserRole.TEACHER,
    other: UserRole.TEACHER,
    reader: UserRole.PARENT,
    outsider: UserRole.PARENT,
  };
  const tok: Record<string, string> = {};
  const TENANT_B = randomUUID();
  let noticeId: string; // published, authored by `author`, addressed to `reader`
  let draftId: string; // draft by `author`
  const addFile = async (): Promise<string> =>
    (await upload(noticeId, 'author', [[PDF, 'x.pdf', 'application/pdf']]).expect(201)).body[0].id;
  const stored = new Map<string, Buffer>();

  const email = (k: string) => `na-e2e-${k}-${sfx}@test.com`;
  const call = (
    method: 'get' | 'post' | 'delete',
    path: string,
    who: string,
    tenant: string | null = SEED_TENANT_ID,
  ) => {
    const r = supertest(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${tok[who]}`);
    return tenant ? r.set('X-Tenant-ID', tenant) : r;
  };
  const upload = (id: string, who: string, parts: Array<[Buffer, string, string]>) => {
    const r = call('post', `${API}/${id}/files`, who);
    for (const [buf, name, type] of parts)
      r.attach('files', buf, { filename: name, contentType: type });
    return r;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    const storage = app.get(StorageService);
    vi.spyOn(storage, 'put').mockImplementation(async (k, b) => void stored.set(k, b));
    vi.spyOn(storage, 'deleteForTenant').mockImplementation(async (k) => void stored.delete(k));
    vi.spyOn(storage, 'getForTenant').mockImplementation(
      async (k) =>
        ({ body: Readable.from(stored.get(k) ?? Buffer.alloc(0)), contentType: 'x' }) as never,
    );

    for (const k of Object.keys(ids) as Array<keyof typeof ids>) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'ACTIVE',NOW(),NOW())`,
        [ids[k], email(k), SEED_ADMIN_PASSWORD_HASH, `NA ${k}`],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1,$2,$3,NOW(),NOW())`,
        [ids[k], SEED_TENANT_ID, roles[k]],
      );
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: email(k), password: SEED_ADMIN_PASSWORD })
        .expect(200);
      tok[k] = res.body.access_token;
    }
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,'NA E2E B',$2,NOW(),NOW())`,
      [TENANT_B, `na-e2e-b-${sfx}`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1,$2,'ADMIN',NOW(),NOW())`,
      [ids.admin, TENANT_B],
    );
  }, 120000);

  // Notice tables are cleared before every test, so seed them fresh each time.
  beforeEach(async () => {
    stored.clear();
    const mk = async (status: string) =>
      (
        await ds.query(
          `INSERT INTO notices (tenant_id, author_user_id, title, body, status, important, published_at)
           VALUES ($1,$2,$3,'b',$4::varchar,true, CASE WHEN $4::varchar='PUBLISHED' THEN now() END) RETURNING id`,
          [SEED_TENANT_ID, ids.author, `na-e2e-${sfx}-${status}`, status],
        )
      )[0].id;
    noticeId = await mk('PUBLISHED');
    draftId = await mk('DRAFT');
    await ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id) VALUES ($1,$2,'STAFF',$3)`,
      [SEED_TENANT_ID, noticeId, ids.reader],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM notice_attachments WHERE notice_id = ANY($1)`, [
      [noticeId, draftId],
    ]);
    await ds.query(`DELETE FROM notice_recipients WHERE notice_id = $1`, [noticeId]);
    await ds.query(`DELETE FROM notices WHERE id = ANY($1)`, [[noticeId, draftId]]);
    await ds.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [TENANT_B]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await app.close();
  });

  describe('permission matrix', () => {
    it('reader routes: every role with NOTICE_READ gets 200/404, no token gets 401', async () => {
      for (const who of ['admin', 'author', 'reader']) {
        await call('get', `${API}/mine`, who).expect(200);
      }
      await supertest(app.getHttpServer())
        .get(`${API}/mine`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .expect(401);
    }, 30000); // first request warms the app; slow when run beside other e2e files

    it('upload and delete need NOTICE_POST: a parent gets 403', async () => {
      await upload(noticeId, 'reader', [[PDF, 'a.pdf', 'application/pdf']]).expect(403);
      await call('delete', `${API}/${noticeId}/files/${randomUUID()}`, 'reader').expect(403);
    });

    it('another teacher is not the author: 404 on upload and delete', async () => {
      await upload(draftId, 'other', [[PDF, 'a.pdf', 'application/pdf']]).expect(404);
      await call('delete', `${API}/${draftId}/files/${randomUUID()}`, 'other').expect(404);
    });
  });

  describe('tenant header and ids', () => {
    // ContextGuard answers 401 for a missing, malformed or foreign tenant header.
    it('missing X-Tenant-ID is rejected', async () => {
      await call('get', `${API}/mine`, 'reader', null).expect(401);
    });
    it('invalid X-Tenant-ID is rejected', async () => {
      await call('get', `${API}/mine`, 'reader', 'not-a-uuid').expect(401);
    });
    it('a tenant the user does not belong to is rejected', async () => {
      await call('get', `${API}/mine`, 'reader', TENANT_B).expect(401);
    });
    it('non-UUID ids are 400 on every :id route', async () => {
      await call('get', `${API}/mine/nope`, 'reader').expect(400);
      await call('post', `${API}/mine/nope/acknowledge`, 'reader').expect(400);
      await call('post', `${API}/nope/files`, 'author').expect(400);
      await call('get', `${API}/${noticeId}/files/nope`, 'reader').expect(400);
      await call('delete', `${API}/${noticeId}/files/nope`, 'author').expect(400);
    });
    it('limit above 100 is a 400', async () => {
      await call('get', `${API}/mine?limit=101`, 'reader').expect(400);
    });
    it('the same notice id used from tenant B is not found', async () => {
      // The admin is an ADMIN in tenant B too, but the notice lives in tenant A.
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,'NA E2E B',$2,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [TENANT_B, `na-e2e-b-${sfx}`],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1,$2,'ADMIN',NOW(),NOW()) ON CONFLICT DO NOTHING`,
        [ids.admin, TENANT_B],
      );
      // Fresh login: the token lists memberships at mint time.
      const login = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: email('admin'), password: SEED_ADMIN_PASSWORD })
        .expect(200);
      tok.admin = login.body.access_token;
      await call('get', `${API}/mine/${noticeId}`, 'admin', TENANT_B).expect(404);
    });
  });

  describe('reader', () => {
    it('lists the notice for its recipient and not for an outsider', async () => {
      const mine = await call('get', `${API}/mine?q=${sfx}`, 'reader').expect(200);
      expect(mine.body.data.map((n: { id: string }) => n.id)).toContain(noticeId);
      const out = await call('get', `${API}/mine?q=${sfx}`, 'outsider').expect(200);
      expect(out.body.data).toEqual([]);
    });
    it('a non-recipient gets 404 on detail and acknowledge', async () => {
      await call('get', `${API}/mine/${noticeId}`, 'outsider').expect(404);
      await call('post', `${API}/mine/${noticeId}/acknowledge`, 'outsider').expect(404);
    });
    it('acknowledge answers 204 for a recipient', async () => {
      await call('post', `${API}/mine/${noticeId}/acknowledge`, 'reader').expect(204);
    });
  });

  describe('files', () => {
    it('a PDF and a PNG upload OK (author, published notice)', async () => {
      const res = await upload(noticeId, 'author', [
        [PDF, 'my secret name.pdf', 'application/pdf'],
        [PNG, 'pic.png', 'image/png'],
      ]).expect(201);
      expect(res.body).toHaveLength(2);
      const [n] = await ds.query(`SELECT edited_at FROM notices WHERE id = $1`, [noticeId]);
      expect(n.edited_at).not.toBeNull(); // D5: published notice with changed files is "edited"
    });

    it('a renamed .exe declared as PDF gets 400 and the file name is not echoed', async () => {
      const res = await upload(draftId, 'author', [
        [EXE, 'evil-name-xyz.pdf', 'application/pdf'],
      ]).expect(400);
      expect(JSON.stringify(res.body)).not.toContain('evil-name-xyz');
      // Rule 6: a refused upload stores nothing, in storage or in the table
      expect(stored.size).toBe(0);
      const rows = await ds.query(`SELECT 1 FROM notice_attachments WHERE notice_id = $1`, [
        draftId,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('the same Idempotency-Key twice stores the file once and replays the first answer', async () => {
      const key = `na-files-${randomUUID()}`;
      const send = () =>
        upload(draftId, 'author', [[PDF, 'once.pdf', 'application/pdf']]).set(
          'Idempotency-Key',
          key,
        );
      const first = await send().expect(201);
      const again = await send().expect(201);
      expect(again.body).toEqual(first.body);
      const rows = await ds.query(`SELECT 1 FROM notice_attachments WHERE notice_id = $1`, [
        draftId,
      ]);
      expect(rows).toHaveLength(1);
      expect(stored.size).toBe(1);
    });

    it('HEIC gets the JPG sentence and no file name', async () => {
      const res = await upload(draftId, 'author', [[PNG, 'IMG_1234.heic', 'image/heic']]).expect(
        400,
      );
      expect(res.body.message).toContain('ছবিটি JPG করে দিন');
      expect(JSON.stringify(res.body)).not.toContain('IMG_1234');
    });

    it('a 6 MB file is refused (multer limit answers 413) and stores nothing', async () => {
      const big = Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]);
      const res = await upload(draftId, 'author', [[big, 'big-name-abc.pdf', 'application/pdf']]);
      expect(res.status).toBe(413);
      expect(stored.size).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain('big-name-abc');
    });

    it('a 4th file gets 400', async () => {
      const three: Array<[Buffer, string, string]> = [1, 2, 3].map(
        (i) => [PDF, `f${i}.pdf`, 'application/pdf'] as [Buffer, string, string],
      );
      await upload(noticeId, 'author', three).expect(201);
      const res = await upload(noticeId, 'author', [
        [PDF, 'fourth-name.pdf', 'application/pdf'],
      ]).expect(400);
      expect(JSON.stringify(res.body)).not.toContain('fourth-name');
    });

    it('a recipient streams the file, no-store; an outsider gets 404', async () => {
      const fileId = await addFile();
      const ok = await call('get', `${API}/${noticeId}/files/${fileId}`, 'reader').expect(200);
      expect(ok.headers['cache-control']).toBe('no-store');
      await call('get', `${API}/${noticeId}/files/${fileId}`, 'outsider').expect(404);
    });

    it('a recipient cannot delete; the author can', async () => {
      const fileId = await addFile();
      await call('delete', `${API}/${noticeId}/files/${fileId}`, 'reader').expect(403);
      await call('delete', `${API}/${noticeId}/files/${fileId}`, 'author').expect(204);
      await call('get', `${API}/${noticeId}/files/${fileId}`, 'author').expect(404);
    });

    it('D20: an ADMIN who is not the author uploads, streams and deletes', async () => {
      const up = await upload(noticeId, 'admin', [[PDF, 'adm.pdf', 'application/pdf']]).expect(201);
      const id = up.body[0].id;
      await call('get', `${API}/${noticeId}/files/${id}`, 'admin').expect(200);
      await call('delete', `${API}/${noticeId}/files/${id}`, 'admin').expect(204);
    });

    it('delete on a published notice sets edited_at', async () => {
      const id = await addFile();
      await ds.query(`UPDATE notices SET edited_at = NULL WHERE id = $1`, [noticeId]);
      await call('delete', `${API}/${noticeId}/files/${id}`, 'author').expect(204);
      const [n] = await ds.query(`SELECT edited_at FROM notices WHERE id = $1`, [noticeId]);
      expect(n.edited_at).not.toBeNull();
    });

    it('a recipient cannot read a file of a DRAFT or WITHDRAWN notice (404)', async () => {
      const draftFile = (
        await upload(draftId, 'author', [[PDF, 'd.pdf', 'application/pdf']]).expect(201)
      ).body[0].id;
      // The reader is (wrongly) addressed on the draft: still no access until it is published.
      await ds.query(
        `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id) VALUES ($1,$2,'STAFF',$3)`,
        [SEED_TENANT_ID, draftId, ids.reader],
      );
      await call('get', `${API}/${draftId}/files/${draftFile}`, 'reader').expect(404);

      const fileId = await addFile();
      await ds.query(
        `UPDATE notices SET status = 'WITHDRAWN', withdrawn_at = now() WHERE id = $1`,
        [noticeId],
      );
      await call('get', `${API}/${noticeId}/files/${fileId}`, 'reader').expect(404);
    });

    it('a tenant-B header on the file route is rejected (ContextGuard: 401)', async () => {
      const fileId = await addFile();
      await call('get', `${API}/${noticeId}/files/${fileId}`, 'reader', TENANT_B).expect(401);
    });
  });

  it('invariant: every role with NOTICE_MANAGE also has NOTICE_POST (upload routes rely on it)', () => {
    for (const role of Object.values(UserRole)) {
      if (roleHasPermission(role, Permission.NOTICE_MANAGE)) {
        expect(roleHasPermission(role, Permission.NOTICE_POST)).toBe(true);
      }
    }
  });
});

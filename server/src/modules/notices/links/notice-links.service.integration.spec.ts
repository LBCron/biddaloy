import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { SchoolsService } from '../../schools/schools.service';
import { StorageService } from '../../storage/storage.service';
import { NoticeLinksService } from './notice-links.service';

/** [53.2.02] Notice links: hash-only storage, dead-link cases, read-only resolve, tenant isolation. */
describe('NoticeLinksService (integration)', () => {
  let ds: DataSource;
  let svc: NoticeLinksService;
  const TENANT_B = 'b2b2b2b2-0000-4000-8000-000000000053';
  const sha = (t: string) => createHash('sha256').update(t).digest('hex');
  const dayOffset = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      NoticeLinksService,
      // the school's "today" is pinned to the same day dayOffset counts from
      { provide: SchoolsService, useValue: { todayFor: async () => dayOffset(0) } },
      {
        provide: StorageService,
        useValue: {
          // Same ownership rule as the real StorageService.assertOwnKey.
          getForTenant: async (key: string, tenantId: string) => {
            if (!key.startsWith(`tenants/${tenantId}/`) || key.includes('..')) {
              throw new Error('not found');
            }
            return { body: Readable.from(['x']), contentType: 'text/plain' };
          },
        },
      },
    ]);
    ds = module.get(DataSource);
    svc = module.get(NoticeLinksService);
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM notice_recipients WHERE tenant_id IN ($1,$2)`, [
      SEED_TENANT_ID,
      TENANT_B,
    ]);
    await ds.query(`DELETE FROM notice_attachments WHERE tenant_id IN ($1,$2)`, [
      SEED_TENANT_ID,
      TENANT_B,
    ]);
    await ds.query(`DELETE FROM notices WHERE tenant_id IN ($1,$2)`, [SEED_TENANT_ID, TENANT_B]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await ds.destroy();
  });

  async function notice(over: Record<string, unknown> = {}) {
    const row: Record<string, unknown> = {
      tenant_id: SEED_TENANT_ID,
      author_user_id: SEED_ADMIN_USER_ID,
      title: 'T',
      body: 'B',
      status: 'PUBLISHED',
      published_at: new Date(),
      is_public: true,
      ...over,
    };
    const cols = Object.keys(row);
    const [r] = await ds.query(
      `INSERT INTO notices (${cols.map((c) => `"${c}"`).join(',')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id, tenant_id`,
      cols.map((c) => row[c]),
    );
    return r as { id: string; tenant_id: string };
  }

  async function recipient(noticeId: string, tenantId = SEED_TENANT_ID): Promise<string> {
    const [r] = await ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id)
       VALUES ($1,$2,'STAFF',$3) RETURNING id`,
      [tenantId, noticeId, SEED_ADMIN_USER_ID],
    );
    return r.id;
  }

  async function file(noticeId: string, tenantId = SEED_TENANT_ID): Promise<string> {
    const [r] = await ds.query(
      `INSERT INTO notice_attachments (tenant_id, notice_id, storage_key, mime_type, size_bytes, original_name)
       VALUES ($1,$2,$3,'application/pdf',10,'a.pdf') RETURNING id`,
      [tenantId, noticeId, `tenants/${tenantId}/notices/a.pdf`],
    );
    return r.id;
  }

  async function row(noticeId: string) {
    const [r] = await ds.query(`SELECT * FROM notices WHERE id = $1`, [noticeId]);
    return r;
  }

  it('stores only the sha256 of the public token', async () => {
    const n = await notice();
    const token = await svc.createPublicLink(n);
    const r = await row(n.id);
    expect(r.public_token_hash).toBe(sha(token));
    expect(JSON.stringify(r)).not.toContain(token);
    expect(r.public_token_created_at).not.toBeNull();
    expect((await svc.resolve(token))?.notice.id).toBe(n.id);
  });

  it('stores only the hash of a personal token and returns {recipientId, token}', async () => {
    const n = await notice();
    const rid = await recipient(n.id);
    const [link] = await svc.createPersonalLinks(n.id, [rid]);
    expect(link.recipientId).toBe(rid);
    const [r] = await ds.query(`SELECT link_token_hash FROM notice_recipients WHERE id = $1`, [
      rid,
    ]);
    expect(r.link_token_hash).toBe(sha(link.token));
    expect((await svc.resolve(link.token))?.recipientId).toBe(rid);
  });

  it('createPersonalLinks skips recipients of another notice', async () => {
    const a = await notice();
    const b = await notice();
    const foreign = await recipient(b.id);
    expect(await svc.createPersonalLinks(a.id, [foreign])).toEqual([]);
    const [r] = await ds.query(`SELECT link_token_hash FROM notice_recipients WHERE id = $1`, [
      foreign,
    ]);
    expect(r.link_token_hash).toBeNull();
  });

  it('turning off the public link makes resolve null', async () => {
    const n = await notice();
    const token = await svc.createPublicLink(n);
    await svc.turnOffPublicLink(n);
    expect(await svc.resolve(token)).toBeNull();
  });

  it('a public hash left behind while is_public is off resolves null (m3)', async () => {
    const n = await notice();
    const token = await svc.createPublicLink(n);
    // e.g. the edit committed is_public = false but the hash clean-up failed
    await ds.query(`UPDATE notices SET is_public = false WHERE id = $1`, [n.id]);
    expect(await svc.resolve(token)).toBeNull();
    // a personal link does not depend on the public flag
    const [p] = await svc.createPersonalLinks(n.id, [await recipient(n.id)]);
    expect(await svc.resolve(p.token)).not.toBeNull();
  });

  it('killAll kills the public and every personal link of that notice only', async () => {
    const n = await notice();
    const other = await notice();
    const pub = await svc.createPublicLink(n);
    const [p] = await svc.createPersonalLinks(n.id, [await recipient(n.id)]);
    const [keep] = await svc.createPersonalLinks(other.id, [await recipient(other.id)]);
    await svc.killAll(n.id);
    expect(await svc.resolve(pub)).toBeNull();
    expect(await svc.resolve(p.token)).toBeNull();
    expect(await svc.resolve(keep.token)).not.toBeNull();
  });

  it('draft, withdrawn and expired notices resolve null; today and open-ended still resolve', async () => {
    const draft = await notice({ status: 'DRAFT' });
    const withdrawn = await notice({ status: 'WITHDRAWN', withdrawn_at: new Date() });
    const expired = await notice({ expires_on: dayOffset(-2) });
    const lastDay = await notice({ expires_on: dayOffset(0) });
    for (const n of [draft, withdrawn, expired]) {
      expect(await svc.resolve(await svc.createPublicLink(n))).toBeNull();
    }
    expect(await svc.resolve(await svc.createPublicLink(lastDay))).not.toBeNull();
  });

  it('rejects empty, unknown and over-long tokens without error', async () => {
    expect(await svc.resolve('')).toBeNull();
    expect(await svc.resolve('nope')).toBeNull();
    expect(await svc.resolve('x'.repeat(5000))).toBeNull();
  });

  it('GET path (resolve/getPage/getFile) never writes', async () => {
    const n = await notice();
    const rid = await recipient(n.id);
    const fid = await file(n.id);
    const [p] = await svc.createPersonalLinks(n.id, [rid]);
    await svc.resolve(p.token);
    expect((await svc.getPage(p.token))?.files).toHaveLength(1);
    expect(await svc.getFile(p.token, fid)).not.toBeNull();
    const [r] = await ds.query(
      `SELECT link_opened_at, seen_at FROM notice_recipients WHERE id = $1`,
      [rid],
    );
    expect(r.link_opened_at).toBeNull();
    expect(r.seen_at).toBeNull();
  });

  it('markOpened with a personal token sets both times once and keeps the first', async () => {
    const n = await notice();
    const rid = await recipient(n.id);
    const [p] = await svc.createPersonalLinks(n.id, [rid]);
    expect(await svc.markOpened(p.token)).toBe(true);
    const sel = () =>
      ds.query(`SELECT link_opened_at, seen_at FROM notice_recipients WHERE id = $1`, [rid]);
    const [first] = await sel();
    expect(first.link_opened_at).not.toBeNull();
    expect(first.seen_at).not.toBeNull();
    await svc.markOpened(p.token);
    const [second] = await sel();
    expect(second.link_opened_at.getTime()).toBe(first.link_opened_at.getTime());
    expect(second.seen_at.getTime()).toBe(first.seen_at.getTime());
  });

  it('markOpened with the public token is valid and writes nothing; dead token is false', async () => {
    const n = await notice();
    const rid = await recipient(n.id);
    const pub = await svc.createPublicLink(n);
    expect(await svc.markOpened(pub)).toBe(true);
    const [r] = await ds.query(`SELECT seen_at FROM notice_recipients WHERE id = $1`, [rid]);
    expect(r.seen_at).toBeNull();
    expect(await svc.markOpened('unknown')).toBe(false);
  });

  it("a token from tenant A cannot reach tenant B's files", async () => {
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Notice Tenant B', 'notice-tenant-b-5304', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    const a = await notice();
    const b = await notice({ tenant_id: TENANT_B });
    const bFile = await file(b.id, TENANT_B);
    const aFile = await file(a.id);
    const tokenA = await svc.createPublicLink(a);
    expect(await svc.getFile(tokenA, bFile)).toBeNull();
    expect(await svc.getFile(tokenA, aFile)).not.toBeNull();
    // B's own token still works for B's file.
    const tokenB = await svc.createPublicLink(b);
    expect(await svc.getFile(tokenB, bFile)).not.toBeNull();
    expect((await svc.getPage(tokenA))?.files.map((f) => f.id)).toEqual([aFile]);
  });

  it("a file row of tenant A's notice pointing at tenant B's storage key is never streamed", async () => {
    const a = await notice();
    const fid = await file(a.id);
    // Corrupt row: key lives under another tenant's prefix.
    await ds.query(`UPDATE notice_attachments SET storage_key = $1 WHERE id = $2`, [
      `tenants/${TENANT_B}/notices/secret.pdf`,
      fid,
    ]);
    const token = await svc.createPublicLink(a);
    expect(await svc.getFile(token, fid)).toBeNull();
  });
});

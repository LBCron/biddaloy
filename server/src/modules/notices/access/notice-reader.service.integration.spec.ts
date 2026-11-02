import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_PASSWORD_HASH, SEED_SECTION_1_ID, SEED_TENANT_ID } from '@test/constants';
import { AuthModule } from '../../auth/auth.module';
import { AlertWriterService } from '../../attention/engine/alert-writer.service';
import { NoticeAccessModule } from './notice-access.module';
import { NoticeReaderService } from './notice-reader.service';

/**
 * [53.2.02] Reader side against the real test DB. Cast: author (staff), guardian G1 (two children),
 * guardian G2 (other person), and a notice in tenant B addressed to a user that also exists in A.
 */
describe('NoticeReaderService (integration)', () => {
  let service: NoticeReaderService;
  let ds: DataSource;
  let invalidate: ReturnType<typeof vi.spyOn>;
  const T = SEED_TENANT_ID;
  const TENANT_B = randomUUID();
  const sfx = randomUUID().slice(0, 8);
  let roll = 900000 + (parseInt(sfx, 16) % 90000);
  const u = { author: randomUUID(), g1: randomUUID(), g2: randomUUID() };
  let kid1: string;
  let kid2: string;
  let g1Guardian: string;

  const mkNotice = async (
    o: {
      tenant?: string;
      status?: string;
      expires?: string | null;
      important?: boolean;
      pinned?: boolean;
      title?: string;
      publishedAgo?: number;
    } = {},
  ): Promise<string> => {
    const status = o.status ?? 'PUBLISHED';
    const [r] = await ds.query(
      `INSERT INTO notices (tenant_id, author_user_id, title, body, status, important, pinned,
                            expires_on, published_at, withdrawn_at)
       VALUES ($1, $2, $3, 'body text', $4::varchar, $5, $6, $7,
               now() - ($8 || ' minutes')::interval, CASE WHEN $4::varchar = 'WITHDRAWN' THEN now() END)
       RETURNING id`,
      [
        o.tenant ?? T,
        u.author,
        o.title ?? `N-${sfx}-${randomUUID().slice(0, 6)}`,
        status,
        o.important ?? false,
        o.pinned ?? false,
        o.expires ?? null,
        String(o.publishedAgo ?? 1),
      ],
    );
    return r.id;
  };
  const staffRow = (notice: string, user: string, tenant = T) =>
    ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id) VALUES ($1,$2,'STAFF',$3)`,
      [tenant, notice, user],
    );
  const guardianRow = (notice: string, student: string, guardian: string, user: string | null) =>
    ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id, guardian_id, student_id)
       VALUES ($1,$2,'GUARDIAN',$3,$4,$5)`,
      [T, notice, user, guardian, student],
    );
  const recipient = async (notice: string, user: string) =>
    (
      await ds.query(
        `SELECT seen_at, acknowledged_at FROM notice_recipients WHERE notice_id=$1 AND user_id=$2`,
        [notice, user],
      )
    )[0];

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), NoticeAccessModule, AuthModule],
    );
    service = module.get(NoticeReaderService);
    invalidate = vi.spyOn(module.get(AlertWriterService), 'invalidateSummary');
    ds = module.get<DataSource>(getDataSourceToken());
    for (const [name, id] of Object.entries(u)) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'ACTIVE',NOW(),NOW())`,
        [id, `na-${name}-${sfx}@test.com`, SEED_ADMIN_PASSWORD_HASH, `Name ${name}`],
      );
    }
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,'Notice Access B',$2,NOW(),NOW())`,
      [TENANT_B, `notice-access-b-${sfx}`],
    );
  }, 90000);

  // Students and guardians are cleared between tests, so make them fresh each time.
  beforeEach(async () => {
    const mkStudent = async (name: string) =>
      (
        await ds.query(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                                 enrollment_status, preferred_communication, created_at, updated_at)
           VALUES ($1,$2,$5,$3,$4,'ACTIVE','SMS',NOW(),NOW()) RETURNING id`,
          [
            name,
            `NA-${randomUUID().slice(0, 10)}`,
            SEED_SECTION_1_ID,
            T,
            roll++, // deterministic from the stamp; unique per section
          ],
        )
      )[0].id;
    kid1 = await mkStudent(`Kid One ${sfx}`);
    kid2 = await mkStudent(`Kid Two ${sfx}`);
    g1Guardian = (
      await ds.query(
        `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                                preferred_communication, is_primary_contact, created_at, updated_at)
         VALUES ('G One','FATHER','+8801700000091',$1,$2,$3,'SMS',true,NOW(),NOW()) RETURNING id`,
        [`g1-${randomUUID()}@test.com`, T, u.g1],
      )
    )[0].id;
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it("lists only my notices, not another person's and not tenant B's", async () => {
    const mine = await mkNotice({ title: `mine-${sfx}` });
    const theirs = await mkNotice({ title: `theirs-${sfx}` });
    const inB = await mkNotice({ tenant: TENANT_B, title: `inb-${sfx}` });
    await staffRow(mine, u.g2);
    await staffRow(theirs, u.g1);
    await staffRow(inB, u.g2, TENANT_B);
    const res = await service.list(T, u.g2, { q: sfx });
    const ids = res.data.map((n) => n.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs); // addressed to someone else
    expect(ids).not.toContain(inB); // other tenant
  });

  it('splits current and archive by expiry', async () => {
    const live = await mkNotice({ expires: '2999-01-01', title: `live-${sfx}` });
    const open = await mkNotice({ title: `open-${sfx}` });
    const old = await mkNotice({ expires: '2000-01-01', title: `old-${sfx}` });
    for (const n of [live, open, old]) await staffRow(n, u.author);
    const cur = (await service.list(T, u.author, { tab: 'current', q: sfx })).data.map((n) => n.id);
    const arc = (await service.list(T, u.author, { tab: 'archive', q: sfx })).data.map((n) => n.id);
    expect(cur).toEqual(expect.arrayContaining([live, open]));
    expect(cur).not.toContain(old);
    expect(arc).toContain(old);
    expect(arc).not.toContain(live);
  });

  it('hides withdrawn notices from both tabs and from the detail', async () => {
    const w = await mkNotice({ status: 'WITHDRAWN', title: `wd-${sfx}` });
    await staffRow(w, u.author);
    for (const tab of ['current', 'archive'] as const) {
      const ids = (await service.list(T, u.author, { tab, q: sfx })).data.map((n) => n.id);
      expect(ids).not.toContain(w);
    }
    await expect(service.open(T, u.author, w)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('puts pinned first', async () => {
    const q = `pin${randomUUID().slice(0, 6)}`;
    const plain = await mkNotice({ title: `${q} plain`, publishedAgo: 1 });
    const pinned = await mkNotice({ title: `${q} pinned`, pinned: true, publishedAgo: 50 });
    await staffRow(plain, u.author);
    await staffRow(pinned, u.author);
    const ids = (await service.list(T, u.author, { q })).data.map((n) => n.id);
    expect(ids).toEqual([pinned, plain]);
  });

  it('sets seen once and returns 404 for a notice that is not mine', async () => {
    const n = await mkNotice();
    await staffRow(n, u.author);
    expect((await recipient(n, u.author)).seen_at).toBeNull();
    await service.open(T, u.author, n);
    const first = (await recipient(n, u.author)).seen_at;
    expect(first).not.toBeNull();
    await service.open(T, u.author, n);
    expect((await recipient(n, u.author)).seen_at).toEqual(first); // not overwritten
    await expect(service.open(T, u.g2, n)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.open(TENANT_B, u.author, n)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('acknowledge writes acknowledged_at, only for important notices', async () => {
    const imp = await mkNotice({ important: true });
    const normal = await mkNotice();
    await staffRow(imp, u.author);
    await staffRow(normal, u.author);
    invalidate.mockClear();
    await service.acknowledge(T, u.author, imp);
    expect((await recipient(imp, u.author)).acknowledged_at).not.toBeNull();
    // the amber bar drops at once: the summary cache is cleared for the acknowledging user
    expect(invalidate).toHaveBeenCalledWith(T, [u.author]);
    await expect(service.acknowledge(T, u.author, normal)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.acknowledge(T, u.g2, imp)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shows a guardian with two children the notice once, with both names', async () => {
    const n = await mkNotice({ title: `two-${sfx}` });
    await guardianRow(n, kid1, g1Guardian, u.g1);
    await guardianRow(n, kid2, g1Guardian, u.g1);
    const res = await service.list(T, u.g1, { q: `two-${sfx}` });
    expect(res.total).toBe(1);
    expect(res.data).toHaveLength(1);
    expect([...res.data[0].forStudents].sort()).toEqual([`Kid One ${sfx}`, `Kid Two ${sfx}`]);
  });

  it('a guardian who gets a login after publish sees, opens and acknowledges the notice (M2)', async () => {
    const n = await mkNotice({ important: true, title: `late-${sfx}` });
    const [{ id: late }] = await ds.query(
      `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                              preferred_communication, is_primary_contact, created_at, updated_at)
       VALUES ('G Late','MOTHER','+8801700000093',$1,$2,NULL,'SMS',true,NOW(),NOW()) RETURNING id`,
      [`glate-${randomUUID()}@test.com`, T],
    );
    // published while the guardian had no login: the row has no user_id
    await guardianRow(n, kid1, late, null);
    // a draft addressed to the same guardian is never claimed (R2-m1: no write-lock on drafts)
    const draft = await mkNotice({ status: 'DRAFT', title: `late-draft-${sfx}` });
    await guardianRow(draft, kid1, late, null);
    expect((await service.list(T, u.g2, { q: `late-${sfx}` })).total).toBe(0);

    // the school invites the guardian later
    await ds.query(`UPDATE guardians SET user_id = $1 WHERE id = $2`, [u.g2, late]);
    const res = await service.list(T, u.g2, { q: `late-${sfx}` });
    expect(res.data.map((x) => x.id)).toEqual([n]);
    expect((await service.open(T, u.g2, n)).id).toBe(n);
    await service.acknowledge(T, u.g2, n);
    expect((await recipient(n, u.g2)).acknowledged_at).not.toBeNull();
    expect(await recipient(draft, u.g2)).toBeUndefined();
  });
});

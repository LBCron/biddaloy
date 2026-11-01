import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID, SEED_SECTION_1_ID } from '@test/constants';
import { Student } from '../../students/entities/student.entity';
import { Guardian } from '../../students/entities/guardian.entity';
import { Notices1791900002100 } from '../../../migrations/1791900002100-Notices';

/**
 * [53.1.02] Notices schema: CHECKs, partial uniques, RESTRICT FKs and the
 * migration round trip. Builds its own fixtures; the suite ends with `up()` applied.
 */
describe('Notices schema (integration)', () => {
  let ds: DataSource;
  let seq = 0;
  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  }, 60000);

  // The suite's per-test reset can clear students/guardians, so fixtures are built inside each test.
  async function mkStudent(): Promise<string> {
    seq += 1;
    const s = await ds.getRepository(Student).save({
      tenant_id: SEED_TENANT_ID,
      full_name: 'Notice Student',
      registration_number: `NOTICE-${Date.now()}-${seq}`,
      roll_number: 9500 + seq,
      class_section_id: SEED_SECTION_1_ID,
    });
    return s.id;
  }

  async function mkGuardian(): Promise<string> {
    const g = await ds.getRepository(Guardian).save({
      tenant_id: SEED_TENANT_ID,
      full_name: 'Notice Guardian',
      relationship: 'Father',
    } as Partial<Guardian>);
    return g.id;
  }

  afterAll(async () => {
    await ds.query(`DELETE FROM notice_recipients WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM notice_attachments WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM notices WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.destroy();
  });

  async function notice(over: Record<string, unknown> = {}): Promise<string> {
    const row: Record<string, unknown> = {
      tenant_id: SEED_TENANT_ID,
      author_user_id: SEED_ADMIN_USER_ID,
      title: 'T',
      body: 'B',
      ...over,
    };
    const cols = Object.keys(row);
    const [r] = await ds.query(
      `INSERT INTO notices (${cols.map((c) => `"${c}"`).join(',')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      cols.map((c) => row[c]),
    );
    return r.id;
  }

  function recipient(noticeId: string, over: Record<string, unknown>): Promise<unknown> {
    const row: Record<string, unknown> = {
      tenant_id: SEED_TENANT_ID,
      notice_id: noticeId,
      ...over,
    };
    const cols = Object.keys(row);
    return ds.query(
      `INSERT INTO notice_recipients (${cols.map((c) => `"${c}"`).join(',')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      cols.map((c) => row[c]),
    );
  }

  function attachment(noticeId: string, over: Record<string, unknown>): Promise<unknown> {
    const row = {
      tenant_id: SEED_TENANT_ID,
      notice_id: noticeId,
      storage_key: 'k',
      mime_type: 'application/pdf',
      size_bytes: 1000,
      original_name: 'a.pdf',
      ...over,
    };
    return ds.query(
      `INSERT INTO notice_attachments (tenant_id, notice_id, storage_key, mime_type, size_bytes, original_name)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        row.tenant_id,
        row.notice_id,
        row.storage_key,
        row.mime_type,
        row.size_bytes,
        row.original_name,
      ],
    );
  }

  describe('notices CHECKs', () => {
    it('rejects a published notice without published_at', async () => {
      await expect(notice({ status: 'PUBLISHED' })).rejects.toThrow(/CHK_notices_published_at/);
    });
    it('rejects a withdrawn notice without withdrawn_at', async () => {
      await expect(notice({ status: 'WITHDRAWN', published_at: new Date() })).rejects.toThrow(
        /CHK_notices_withdrawn_at/,
      );
    });
    it('rejects a body over 5000 characters', async () => {
      await expect(notice({ body: 'x'.repeat(5001) })).rejects.toThrow(/CHK_notices_body_len/);
    });
    it('accepts a draft and a published notice', async () => {
      await notice();
      await notice({ status: 'PUBLISHED', published_at: new Date() });
    });
  });

  describe('attachment CHECKs', () => {
    it('rejects a 6 MB file', async () => {
      const id = await notice();
      await expect(attachment(id, { size_bytes: 6 * 1024 * 1024 })).rejects.toThrow(
        /CHK_notice_attachments_size/,
      );
    });
    it('rejects a GIF', async () => {
      const id = await notice();
      await expect(attachment(id, { mime_type: 'image/gif' })).rejects.toThrow(
        /CHK_notice_attachments_mime/,
      );
    });
  });

  describe('recipient CHECKs and uniques', () => {
    it('rejects a guardian row without student_id', async () => {
      const id = await notice();
      const guardianId = await mkGuardian();
      await expect(recipient(id, { kind: 'GUARDIAN', guardian_id: guardianId })).rejects.toThrow(
        /CHK_notice_recipients_target/,
      );
    });
    it('rejects a staff row without user_id', async () => {
      const id = await notice();
      await expect(recipient(id, { kind: 'STAFF' })).rejects.toThrow(
        /CHK_notice_recipients_target/,
      );
    });
    it('rejects a duplicate STAFF row', async () => {
      const id = await notice();
      await recipient(id, { kind: 'STAFF', user_id: SEED_ADMIN_USER_ID });
      await expect(recipient(id, { kind: 'STAFF', user_id: SEED_ADMIN_USER_ID })).rejects.toThrow(
        /UQ_notice_recipients_staff/,
      );
    });
    it('rejects a duplicate (guardian, student) row but allows the same guardian for another student', async () => {
      const id = await notice();
      const studentA = await mkStudent();
      const studentB = await mkStudent();
      const g = { kind: 'GUARDIAN', guardian_id: await mkGuardian() };
      await recipient(id, { ...g, student_id: studentA });
      await expect(recipient(id, { ...g, student_id: studentA })).rejects.toThrow(
        /UQ_notice_recipients_guardian/,
      );
      await recipient(id, { ...g, student_id: studentB });
    });
  });

  describe('delete guard (D27)', () => {
    it('refuses to delete a notice that still has recipients', async () => {
      const id = await notice();
      await recipient(id, { kind: 'STAFF', user_id: SEED_ADMIN_USER_ID });
      await expect(ds.query(`DELETE FROM notices WHERE id = $1`, [id])).rejects.toThrow(
        /FK_notice_recipients_notice_id/,
      );
    });
    it('refuses to delete a notice that still has attachments', async () => {
      const id = await notice();
      await attachment(id, {});
      await expect(ds.query(`DELETE FROM notices WHERE id = $1`, [id])).rejects.toThrow(
        /FK_notice_attachments_notice_id/,
      );
    });
  });

  // Last: the other tests' rows are cleared first so down() can drop the tables.
  describe('migration round trip', () => {
    it('down then up leaves the tables in place', async () => {
      await ds.query(`DELETE FROM notice_recipients`);
      await ds.query(`DELETE FROM notice_attachments`);
      await ds.query(`DELETE FROM notices`);
      const qr: QueryRunner = ds.createQueryRunner();
      const m = new Notices1791900002100();
      try {
        await m.down(qr);
        const gone = await ds.query(`SELECT to_regclass('public.notices') AS t`);
        expect(gone[0].t).toBeNull();
        await m.up(qr);
        const back = await ds.query(`SELECT to_regclass('public.notice_recipients') AS t`);
        expect(back[0].t).not.toBeNull();
      } finally {
        await qr.release();
      }
    });
  });
});

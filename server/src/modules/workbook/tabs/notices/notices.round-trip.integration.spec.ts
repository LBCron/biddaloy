/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import type { TestingModule } from '@nestjs/testing';
import { UserRole } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { Student } from '../../../students/entities/student.entity';
import { Guardian } from '../../../students/entities/guardian.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Notice } from '../../../notices/entities/notice.entity';
import { NoticeAttachment } from '../../../notices/entities/notice-attachment.entity';
import { NoticeRecipient } from '../../../notices/entities/notice-recipient.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { cellText, toCell } from '../../codec/cell-format';
import type { ImportContext, RowError, TabSpec } from '../../codec/tab-spec';
import { guardiansTab } from '../people/guardians.tab';
import { studentsTab } from '../people/students.tab';
import { usersTab } from '../people/users.tab';
import { noticeAttachmentsTab, noticeRecipientsTab, noticesTab } from './index';
import { AuditService } from '../../../audit/audit.service';
import { AuditLog } from '../../../audit/entities/audit-log.entity';
import { ImportStagingService } from '../../../bulk-import/import-staging.service';
import { ValidationService } from '../../import/validation.service';
import { ExportProcessor } from '../../export/export.processor';
import { RestoreProcessor } from '../../restore/restore.processor';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../../jobs/workbook-job.entity';

vi.mock('@sentry/node', () => ({
  withScope: (fn: (scope: any) => void) => fn({ setTags: vi.fn() }),
  captureException: vi.fn(),
}));

class FakeStorage {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }
  async get(key: string): Promise<{ body: AsyncIterable<Buffer> }> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`FakeStorage: no object at "${key}"`);
    return {
      body: (async function* () {
        yield body;
      })(),
    };
  }
}

class FakeRedis {
  private readonly store = new Map<string, string>();
  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async getdel(key: string): Promise<string | null> {
    const value = this.store.get(key) ?? null;
    this.store.delete(key);
    return value;
  }
}

/** Export -> wipe notice rows -> restore on a real Postgres, with a second school alongside. */
describe('notices workbook tabs (round trip)', () => {
  let module: TestingModule;
  let ds: DataSource;
  const A = 'a5360000-0000-4000-8000-0000000000a1';
  const B = 'a5360000-0000-4000-8000-0000000000b1';
  const TOKEN_A = 'a'.repeat(64);
  const LINK_A = 'b'.repeat(64);
  const TOKEN_B = 'c'.repeat(64);
  const LINK_B = 'd'.repeat(64);
  const KEY_A = `tenants/${A}/notice-files/11111111-1111-4111-8111-111111111111.pdf`;
  const KEY_B = `tenants/${B}/notice-files/22222222-2222-4222-8222-222222222222.pdf`;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  });
  afterAll(async () => {
    await module?.close();
  });

  async function seedTenant(id: string, slug: string, tag: string) {
    // FK order: notice children, notices, memberships, then the school (cascades the rest).
    for (const t of ['notice_recipients', 'notice_attachments', 'notices']) {
      await ds.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [id]);
    }
    await ds.query(`DELETE FROM schools WHERE id = $1`, [id]);
    await ds.query(`DELETE FROM users WHERE email = $1`, [`staff-${tag}@notices-5360.test`]);
    await ds.getRepository(School).save({ id, name: slug, slug });
    const user = await ds.getRepository(User).save({
      email: `staff-${tag}@notices-5360.test`,
      phone: null,
      full_name: 'Staff',
      password_hash: null,
    } as any);
    await ds
      .getRepository(UserTenant)
      .save({ user_id: user.id, tenant_id: id, role: UserRole.ADMIN } as any);
    const year = await ds.getRepository(AcademicYear).save({
      tenant_id: id,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
    } as any);
    const klass = await ds
      .getRepository(Class)
      .save({ tenant_id: id, name: 'Six', numeric_grade: 6, academic_year_id: year.id } as any);
    const section = await ds
      .getRepository(ClassSection)
      .save({ tenant_id: id, class_id: klass.id, section_name: 'A', capacity: null } as any);
    const student = await ds.getRepository(Student).save({
      tenant_id: id,
      full_name: 'Kid',
      registration_number: `REG-${tag}`,
      roll_number: 1,
      class_section_id: section.id,
    } as any);
    const guardian = await ds.getRepository(Guardian).save({
      tenant_id: id,
      full_name: 'Parent',
      relationship: 'Father',
      phone: `0190000${tag === 'a' ? '0001' : '0002'}`,
    } as any);
    return { user, student, guardian };
  }

  async function seedNotice(
    id: string,
    f: { user: User; student: Student; guardian: Guardian },
    tokens: { pub: string; link: string; key: string },
  ) {
    const notice = await ds.getRepository(Notice).save({
      tenant_id: id,
      author_user_id: f.user.id,
      title: `Exam week ${id.slice(-2)}`,
      body: 'Bring your admit card.',
      status: 'PUBLISHED',
      important: true,
      is_public: true,
      published_at: new Date('2026-05-01T08:00:00.000Z'),
      public_token_hash: tokens.pub,
      public_token_created_at: new Date('2026-05-01T08:00:00.000Z'),
      recipient_count: 2,
    } as any);
    await ds.getRepository(NoticeAttachment).save({
      tenant_id: id,
      notice_id: notice.id,
      storage_key: tokens.key,
      mime_type: 'application/pdf',
      size_bytes: 1234,
      original_name: 'schedule.pdf',
      sort: 0,
    } as any);
    await ds.getRepository(NoticeRecipient).save({
      tenant_id: id,
      notice_id: notice.id,
      kind: 'STAFF',
      user_id: f.user.id,
      seen_at: new Date('2026-05-02T09:00:00.000Z'),
      acknowledged_at: new Date('2026-05-02T09:05:00.000Z'),
    } as any);
    await ds.getRepository(NoticeRecipient).save({
      tenant_id: id,
      notice_id: notice.id,
      kind: 'GUARDIAN',
      guardian_id: f.guardian.id,
      student_id: f.student.id,
      link_token_hash: tokens.link,
      link_opened_at: new Date('2026-05-03T10:00:00.000Z'),
      sms_sent_at: new Date('2026-05-01T08:01:00.000Z'),
    } as any);
    return notice;
  }

  const parents = [usersTab, studentsTab, guardiansTab] as TabSpec<any, any>[];

  async function exportTab(tab: TabSpec<any, any>, tenant: string) {
    const keyOf = new Map<string, Map<string, string>>();
    for (const t of [...parents, noticesTab]) {
      const es = await t.load(tenant, ds.manager);
      keyOf.set(t.name, new Map(es.map((e: any) => [e.id, t.keyOf(e)])));
    }
    const ctx = { keyOf: (t: string, i: string) => keyOf.get(t)!.get(i)! };
    return (await tab.load(tenant, ds.manager)).map((e: any) => {
      const row = tab.toRow(e, ctx);
      return Object.fromEntries(
        tab.columns.map((c) => {
          const cell = toCell(c.type, row[c.key]);
          return [c.key, cellText(cell === null ? '' : String(cell))];
        }),
      );
    });
  }

  /** Imports one tab's cells the way the restore engine does: match by key, upsert, remember ids. */
  async function importTab(
    tab: TabSpec<any, any>,
    cells: Record<string, string>[],
    tenant: string,
    ids: Record<string, Record<string, string>>,
    warnings: RowError[] = [],
  ) {
    const existing = new Map(
      (await tab.load(tenant, ds.manager)).map((e: any) => [tab.keyOf(e), e]),
    );
    ids[tab.name] ??= {};
    const ctx: ImportContext = {
      tenantId: tenant,
      ref: (t, k) => ids[t]?.[k],
      warn: (w) => warnings.push(w),
    };
    for (const [i, c] of cells.entries()) {
      const res = tab.fromRow(c, i + 2, ctx);
      if ('errors' in res) throw new Error(JSON.stringify(res.errors));
      const saved = await tab.upsert(
        res.row,
        existing.get(tab.keyOf(res.row)) ?? null,
        tenant,
        ds.manager,
      );
      ids[tab.name][tab.keyOf(res.row)] = saved.id;
    }
  }

  async function idMap(tenant: string) {
    const ids: Record<string, Record<string, string>> = {};
    for (const t of parents) {
      ids[t.name] = Object.fromEntries(
        (await t.load(tenant, ds.manager)).map((e: any) => [t.keyOf(e), e.id]),
      );
    }
    return ids;
  }

  async function exportAll(tenant: string) {
    return {
      notices: await exportTab(noticesTab, tenant),
      attachments: await exportTab(noticeAttachmentsTab, tenant),
      recipients: await exportTab(noticeRecipientsTab, tenant),
    };
  }

  async function restoreAll(tenant: string, cells: Awaited<ReturnType<typeof exportAll>>) {
    const ids = await idMap(tenant);
    await importTab(noticesTab, cells.notices, tenant, ids);
    await importTab(noticeAttachmentsTab, cells.attachments, tenant, ids);
    await importTab(noticeRecipientsTab, cells.recipients, tenant, ids);
  }

  it('restores notices, files and recipients; keeps timestamps; drops tokens; leaves school B alone', async () => {
    const a = await seedTenant(A, 'notices-a-5360', 'a');
    const b = await seedTenant(B, 'notices-b-5360', 'b');
    await seedNotice(A, a, { pub: TOKEN_A, link: LINK_A, key: KEY_A });
    await seedNotice(B, b, { pub: TOKEN_B, link: LINK_B, key: KEY_B });

    const cells = await exportAll(A);
    // Tenant isolation: only school A's rows are exported.
    expect(cells.notices).toHaveLength(1);
    expect(cells.attachments.map((c) => c.storage_key)).toEqual([KEY_A]);
    expect(cells.recipients).toHaveLength(2);
    // D28: no token hash of either school appears anywhere in the workbook.
    const text = JSON.stringify(cells);
    for (const secret of [TOKEN_A, LINK_A, TOKEN_B, LINK_B, KEY_B]) {
      expect(text).not.toContain(secret);
    }
    const originalId = (await ds.getRepository(Notice).findOneByOrFail({ tenant_id: A })).id;

    // Wipe school A's notice rows, children first (FK RESTRICT), then restore.
    for (const t of ['notice_recipients', 'notice_attachments', 'notices']) {
      await ds.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [A]);
    }
    await restoreAll(A, cells);

    const notice = await ds.getRepository(Notice).findOneByOrFail({ tenant_id: A });
    expect(notice).toMatchObject({
      title: 'Exam week a1',
      status: 'PUBLISHED',
      important: true,
      is_public: true,
      recipient_count: 2,
      author_user_id: a.user.id,
      public_token_hash: null, // links do not survive a restore
      public_token_created_at: null,
      alert_id: null, // derived alert left off
    });
    expect(notice.id).not.toBe(originalId);
    expect(notice.published_at?.toISOString()).toBe('2026-05-01T08:00:00.000Z');

    const files = await ds.getRepository(NoticeAttachment).find({ where: { tenant_id: A } });
    expect(files).toHaveLength(1);
    // Same key: the bytes in storage are found again. Parent is the restored notice.
    expect(files[0]).toMatchObject({ storage_key: KEY_A, notice_id: notice.id, size_bytes: 1234 });

    const recipients = await ds.getRepository(NoticeRecipient).find({ where: { tenant_id: A } });
    expect(recipients).toHaveLength(2);
    const staff = recipients.find((r) => r.kind === 'STAFF')!;
    expect(staff.seen_at?.toISOString()).toBe('2026-05-02T09:00:00.000Z');
    expect(staff.acknowledged_at?.toISOString()).toBe('2026-05-02T09:05:00.000Z');
    const guardian = recipients.find((r) => r.kind === 'GUARDIAN')!;
    expect(guardian).toMatchObject({ student_id: a.student.id, guardian_id: a.guardian.id });
    expect(guardian.link_token_hash).toBeNull(); // personal link is gone
    expect(guardian.link_opened_at?.toISOString()).toBe('2026-05-03T10:00:00.000Z');
    // No row is orphaned: every child points at a notice of school A.
    for (const r of [...files, ...recipients]) expect(r.notice_id).toBe(notice.id);

    // School B is untouched, token hashes included.
    const bNotice = await ds.getRepository(Notice).findOneByOrFail({ tenant_id: B });
    expect(bNotice.public_token_hash).toBe(TOKEN_B);
    expect(await ds.getRepository(NoticeAttachment).count({ where: { tenant_id: B } })).toBe(1);
    const bRecipients = await ds.getRepository(NoticeRecipient).find({ where: { tenant_id: B } });
    expect(bRecipients).toHaveLength(2);
    expect(bRecipients.map((r) => r.notice_id)).toEqual([bNotice.id, bNotice.id]);
    expect(bRecipients.some((r) => r.link_token_hash === LINK_B)).toBe(true);
  });

  it('restoring over live rows changes nothing and keeps links', async () => {
    const a = await seedTenant(A, 'notices-a-5360', 'a');
    await seedNotice(A, a, { pub: TOKEN_A, link: LINK_A, key: KEY_A });
    const before = await ds.getRepository(Notice).findOneByOrFail({ tenant_id: A });

    await restoreAll(A, await exportAll(A));

    expect(await ds.getRepository(Notice).count({ where: { tenant_id: A } })).toBe(1);
    expect(await ds.getRepository(NoticeRecipient).count({ where: { tenant_id: A } })).toBe(2);
    expect(await ds.getRepository(NoticeAttachment).count({ where: { tenant_id: A } })).toBe(1);
    const after = await ds.getRepository(Notice).findOneByOrFail({ tenant_id: A });
    expect(after.id).toBe(before.id);
    expect(after.public_token_hash).toBe(TOKEN_A); // a same-school restore keeps the live link
    const link = await ds
      .getRepository(NoticeRecipient)
      .findOneByOrFail({ tenant_id: A, kind: 'GUARDIAN' as any });
    expect(link.link_token_hash).toBe(LINK_A);
  });

  it("never keeps another school's file key, and rejects keys outside notice-files", async () => {
    const warnings: RowError[] = [];
    const base = {
      id: '33333333-3333-4333-8333-333333333333',
      notice: 'n',
      mime_type: 'application/pdf',
      size_bytes: '10',
      original_name: 'x.pdf',
      sort: '0',
    };
    const ctx: ImportContext = { tenantId: A, ref: () => 'nid', warn: (w) => warnings.push(w) };

    const moved = noticeAttachmentsTab.fromRow({ ...base, storage_key: KEY_B }, 2, ctx);
    expect('row' in moved && moved.row.storage_key).toBe(
      `tenants/${A}/notice-files/22222222-2222-4222-8222-222222222222.pdf`,
    );
    expect(warnings).toHaveLength(1);

    const other = noticeAttachmentsTab.fromRow(
      { ...base, storage_key: `tenants/${A}/workbooks/backup.xlsx` },
      3,
      ctx,
    );
    expect('errors' in other && other.errors[0].column).toBe('storage_key');
  });

  /**
   * #3388 blocker: a notice deleted from the workbook is removed by
   * `deleteByAbsence` in the notices tab, which runs before its file and
   * recipient tabs. Both child FKs are ON DELETE RESTRICT, so a bare delete
   * of the notice failed the restore half-way. One recipient points at a
   * soft-deleted guardian, so it is not in the export at all: only a delete
   * by notice id can clear it.
   */
  it('real restore deletes a notice the file no longer has, with its files and hidden recipients', async () => {
    const T = randomUUID();
    const tag = `r${T.slice(0, 6)}`;
    const f = await seedTenant(T, `notices-r-${tag}`, tag);
    const operator = f.user; // an ADMIN member of T
    const notice = await seedNotice(T, f, {
      pub: 'e'.repeat(64),
      link: 'f'.repeat(64),
      key: `tenants/${T}/notice-files/33333333-3333-4333-8333-333333333333.pdf`,
    });
    const gone = await ds.getRepository(Guardian).save({
      tenant_id: T,
      full_name: 'Left parent',
      relationship: 'Mother',
      phone: '01900009999',
    } as any);
    await ds.getRepository(NoticeRecipient).save({
      tenant_id: T,
      notice_id: notice.id,
      kind: 'GUARDIAN',
      guardian_id: gone.id,
      student_id: f.student.id,
    } as any);
    await ds.getRepository(Guardian).softDelete({ id: gone.id });

    const audit = new AuditService(ds.getRepository(AuditLog));
    const storage = new FakeStorage();
    const staging = new ImportStagingService(new FakeRedis() as any);
    const jobs = ds.getRepository(WorkbookJob);
    const exporter = new ExportProcessor(
      jobs,
      ds,
      storage as any,
      audit,
      { emitFinished: vi.fn() } as any,
      { enforce: vi.fn().mockResolvedValue(undefined) } as any,
      { isRestoring: vi.fn().mockResolvedValue(false) } as any,
    );
    const restorer = new RestoreProcessor(
      jobs,
      ds,
      storage as any,
      staging,
      new ValidationService(),
      { issueAndSend: vi.fn().mockResolvedValue({ status: 'SENT' }) } as any,
      audit,
      { emitFinished: vi.fn() } as any,
      { release: vi.fn().mockResolvedValue(undefined) } as any,
      { isActive: vi.fn().mockResolvedValue(true) } as any,
    );

    const exportJob = await jobs.save(
      jobs.create({
        tenant_id: T,
        kind: WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: null,
      }),
    );
    await exporter.process({
      data: { jobId: exportJob.id, tenantId: T },
      opts: { attempts: 2 },
      attemptsMade: 0,
    } as any);
    const exported = await jobs.findOneOrFail({ where: { id: exportJob.id } });
    expect(exported.status).toBe(WorkbookJobStatus.DONE);

    // The admin deletes the notice (and so its file and recipient rows) from the workbook.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(storage.objects.get(exported.storage_key as string) as any);
    for (const name of ['notices', 'notice_attachments', 'notice_recipients']) {
      const sheet = wb.getWorksheet(name)!;
      for (let r = sheet.rowCount; r >= 2; r--) sheet.spliceRows(r, 1);
    }
    const stagingKey = `staging/${randomUUID()}.xlsx`;
    await storage.put(stagingKey, Buffer.from(await wb.xlsx.writeBuffer()));
    const { stagingId } = await staging.stage(T, operator.id, {
      workbook_storage_key: stagingKey,
      meta: {},
      tabs: [],
      totals: { creates: 0, updates: 0, unchanged: 0, deletes: 0 },
      hardErrorCount: 0,
      isEmptyTenant: false,
      errors: [],
      warnings: [],
    } as any);
    const snapshot = await jobs.save(
      jobs.create({
        tenant_id: T,
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        status: WorkbookJobStatus.DONE,
        requested_by_user_id: operator.id,
      }),
    );
    const restoreJob = await jobs.save(
      jobs.create({
        tenant_id: T,
        kind: WorkbookJobKind.RESTORE,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: operator.id,
        staging_id: stagingId,
        snapshot_job_id: snapshot.id,
      }),
    );
    await restorer.process({ data: { jobId: restoreJob.id, inviteUsers: false } } as any);

    const done = await jobs.findOneOrFail({ where: { id: restoreJob.id } });
    expect({ status: done.status, error: done.error }).toEqual({
      status: WorkbookJobStatus.DONE,
      error: null,
    });
    // Notice, its file row and both recipients (the hidden one too) are gone.
    expect(await ds.getRepository(Notice).count({ where: { tenant_id: T } })).toBe(0);
    expect(await ds.getRepository(NoticeAttachment).count({ where: { tenant_id: T } })).toBe(0);
    expect(await ds.getRepository(NoticeRecipient).count({ where: { tenant_id: T } })).toBe(0);
  }, 60_000);
});

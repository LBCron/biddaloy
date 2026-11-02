import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { countSmsSegments } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_PASSWORD_HASH, SEED_SECTION_1_ID, SEED_TENANT_ID } from '@test/constants';
import { COMMUNICATIONS_QUEUE } from '../../communications/communications.constants';
import { CommunicationLog } from '../../communications/entities/communication-log.entity';
import { NoticeAlertsService } from '../../attention/notice/notice-alerts.service';
import { AuditService } from '../../audit/audit.service';
import { NoticeLinksService } from '../links/notice-links.service';
import { NoticeSmsModule } from './notice-sms.module';
import { NoticeSmsService, maskSmsPhone } from './notice-sms.service';

/** [53.5.01] Real DB: approve reserves credit, makes links, queues one SMS per phone; nothing sends otherwise. */
describe('NoticeSmsService (integration)', () => {
  let svc: NoticeSmsService;
  let ds: DataSource;
  let add: ReturnType<typeof vi.fn>;
  let audit: ReturnType<typeof vi.spyOn>;
  let alerts: NoticeAlertsService;
  const T = SEED_TENANT_ID;
  const sfx = randomUUID().slice(0, 8);
  const author = randomUUID();
  const approver = randomUUID();
  let oldSettings: unknown;
  let roll = 9000;

  const guardian = async (phone: string | null, optIn = true, tenant = T) =>
    (
      await ds.query(
        `INSERT INTO guardians (full_name, relationship, phone, tenant_id, preferred_communication,
                                is_primary_contact, notifications_enabled, created_at, updated_at)
         VALUES ($1,'FATHER',$2,$3,'SMS',true,$4,NOW(),NOW()) RETURNING id`,
        [`G ${sfx}`, phone, tenant, optIn],
      )
    )[0].id as string;
  const student = async () =>
    (
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                               enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE','SMS',NOW(),NOW()) RETURNING id`,
        [`Kid ${sfx}`, `NS-${randomUUID().slice(0, 10)}`, roll++, SEED_SECTION_1_ID, T],
      )
    )[0].id as string;
  /** A published notice with a PENDING SMS request and one GUARDIAN row per given guardian. */
  const notice = async (
    guardians: string[],
    o: { status?: string; sms?: string; expires?: string | null; tenant?: string } = {},
  ) => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO notices (id, tenant_id, author_user_id, title, body, status, published_at, withdrawn_at,
                            expires_on, sms_status, sms_requested_by_user_id, sms_requested_at)
       VALUES ($1,$2,$3,$4,'b',$5,NOW(),$6,$7,$8,$3,NOW())`,
      [
        id,
        o.tenant ?? T,
        author,
        `Title ${sfx}`,
        o.status ?? 'PUBLISHED',
        o.status === 'WITHDRAWN' ? new Date() : null,
        o.expires ?? null,
        o.sms ?? 'PENDING',
      ],
    );
    const sid = await student();
    for (const g of guardians)
      await ds.query(
        `INSERT INTO notice_recipients (tenant_id, notice_id, kind, guardian_id, student_id)
         VALUES ($1,$2,'GUARDIAN',$3,$4)`,
        [o.tenant ?? T, id, g, sid],
      );
    return id;
  };
  const row = async (id: string) =>
    (await ds.query(`SELECT * FROM notices WHERE id = $1`, [id]))[0];
  const logsOf = (id: string) =>
    ds.query(
      `SELECT l.* FROM communication_logs l JOIN notice_recipients r ON r.communication_log_id = l.id
        WHERE r.notice_id = $1`,
      [id],
    );
  const meter = async (available: number | null) => {
    await ds.query(`UPDATE schools SET settings = $2::jsonb WHERE id = $1`, [
      T,
      JSON.stringify({
        version: 1,
        communications: { sms: { metering: 'PLATFORM', provider: 'test' } },
        region: { timezone: 'Asia/Dhaka' },
      }),
    ]);
    await ds.query(`DELETE FROM sms_credit_balance WHERE tenant_id = $1`, [T]);
    if (available !== null)
      await ds.query(
        `INSERT INTO sms_credit_balance (tenant_id, available, reserved, updated_at) VALUES ($1,$2,0,now())`,
        [T, available],
      );
  };
  /** Ledger rows written after `mark()`: the ledger is never cleared between tests. */
  const ledgerIds = async (): Promise<string[]> =>
    (await ds.query(`SELECT id FROM sms_credit_ledger WHERE tenant_id = $1`, [T])).map(
      (r: any) => r.id,
    );
  const newLedger = (before: string[]) =>
    ds.query(
      `SELECT kind, units, idempotency_key FROM sms_credit_ledger
        WHERE tenant_id = $1 AND NOT (id = ANY($2::uuid[])) ORDER BY kind`,
      [T, before],
    );
  const balance = async () => {
    const [b] = await ds.query(
      `SELECT available, reserved FROM sms_credit_balance WHERE tenant_id = $1`,
      [T],
    );
    return [b.available, b.reserved];
  };
  /** Raises the real SMS approval task for a notice and links it, as NoticesService does. */
  const withTask = async (id: string) => {
    const taskId = await ds.transaction((tx) =>
      alerts.raiseSmsApprovalTask(tx, { id, tenantId: T, title: 't', body: 'b', expiresOn: null }),
    );
    await ds.query(`UPDATE notices SET sms_task_alert_id = $2 WHERE id = $1`, [id, taskId]);
    return taskId;
  };
  const taskStatus = async (taskId: string) =>
    (await ds.query(`SELECT status FROM alerts WHERE id = $1`, [taskId]))[0].status;
  const unmeter = async () => {
    await ds.query(`UPDATE schools SET settings = $2::jsonb WHERE id = $1`, [
      T,
      JSON.stringify(oldSettings),
    ]);
    await ds.query(`DELETE FROM sms_credit_balance WHERE tenant_id = $1`, [T]);
  };

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), NoticeSmsModule],
    );
    svc = module.get(NoticeSmsService);
    ds = module.get<DataSource>(getDataSourceToken());
    add = vi.spyOn(module.get(getQueueToken(COMMUNICATIONS_QUEUE)), 'add') as never;
    audit = vi.spyOn(module.get(AuditService), 'record');
    alerts = module.get(NoticeAlertsService);
    oldSettings = (await ds.query(`SELECT settings FROM schools WHERE id = $1`, [T]))[0].settings;
    for (const [id, n] of [
      [author, 'author'],
      [approver, 'approver'],
    ])
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'ACTIVE',NOW(),NOW())`,
        [id, `ns-${n}-${sfx}@test.com`, SEED_ADMIN_PASSWORD_HASH, `Name ${n}`],
      );
  }, 90000);

  beforeEach(async () => {
    add.mockReset().mockResolvedValue({});
    audit.mockClear();
    await unmeter();
  });

  afterAll(async () => {
    if (ds) {
      await unmeter();
      await ds.destroy();
    }
  });

  it('masks a phone as 01•••••234', () => {
    expect(maskSmsPhone('01712345234')).toBe('01•••••234');
    expect(maskSmsPhone('01712345234')).not.toContain('7123');
  });

  it('approve: 2 reachable, 1 opted out, 1 no phone -> 2 logs, 2 jobs, personal links, APPROVED', async () => {
    const id = await notice([
      await guardian('01711111111'),
      await guardian('01722222222'),
      await guardian('01733333333', false),
      await guardian(null),
    ]);
    const res = await svc.approve(T, id, approver);
    expect(res).toEqual({ status: 'APPROVED', queued: 2 });
    const logs = await logsOf(id);
    expect(logs).toHaveLength(2);
    // each SMS carries its own personal link, so the two bodies differ
    expect(new Set(logs.map((l: any) => l.message_body)).size).toBe(2);
    expect(logs[0].message_body).toContain('/n/');
    expect(add).toHaveBeenCalledTimes(2);
    const n = await row(id);
    expect(n.sms_status).toBe('APPROVED');
    expect(n.sms_decided_by_user_id).toBe(approver);
    const linked = await ds.query(
      `SELECT count(*)::int c FROM notice_recipients WHERE notice_id = $1 AND link_token_hash IS NOT NULL`,
      [id],
    );
    expect(linked[0].c).toBe(2);
  });

  it('two guardian rows with the same phone get one SMS', async () => {
    const id = await notice([await guardian('01744444444'), await guardian('01744444444')]);
    expect((await svc.approve(T, id, approver)).queued).toBe(1);
  });

  it('unticked people get nothing', async () => {
    const a = await guardian('01755555555');
    const b = await guardian('01766666666');
    const id = await notice([a, b]);
    const [first] = await ds.query(
      `SELECT id FROM notice_recipients WHERE notice_id = $1 AND guardian_id = $2`,
      [id, a],
    );
    expect(await svc.setWanted(T, id, [first.id], false)).toEqual({ updated: 1 });
    expect((await svc.approve(T, id, approver)).queued).toBe(1);
  });

  it('nobody reachable: approves, queues nothing, reserves nothing', async () => {
    await meter(5);
    const id = await notice([await guardian('01777777777', false), await guardian(null)]);
    expect(await svc.approve(T, id, approver)).toEqual({ status: 'APPROVED', queued: 0 });
    expect(add).not.toHaveBeenCalled();
    const [{ available }] = await ds.query(
      `SELECT available FROM sms_credit_balance WHERE tenant_id = $1`,
      [T],
    );
    expect(available).toBe(5);
  });

  it('second approve with a new key is 409 (not PENDING) and sends nothing more', async () => {
    const id = await notice([await guardian('01788888888')]);
    await svc.approve(T, id, approver);
    add.mockClear();
    await expect(svc.approve(T, id, approver)).rejects.toBeInstanceOf(ConflictException);
    expect(add).not.toHaveBeenCalled();
  });

  it('decline sends nothing and a later approve is 409', async () => {
    const id = await notice([await guardian('01799999999')]);
    expect(await svc.decline(T, id, approver)).toEqual({ status: 'DECLINED', queued: 0 });
    expect(add).not.toHaveBeenCalled();
    expect(await logsOf(id)).toHaveLength(0);
    await expect(svc.approve(T, id, approver)).rejects.toBeInstanceOf(ConflictException);
  });

  it('approve on a withdrawn notice is 409', async () => {
    const id = await notice([await guardian('01711000001')], { status: 'WITHDRAWN' });
    await expect(svc.approve(T, id, approver)).rejects.toBeInstanceOf(ConflictException);
    expect(add).not.toHaveBeenCalled();
  });

  it('approve on an expired notice is 409 notLive and the request is closed as DECLINED', async () => {
    await meter(10);
    const id = await notice([await guardian('01711000002')], { expires: '2000-01-01' });
    const taskId = await withTask(id);
    const before = await ledgerIds();
    // the notLive sentence itself: a notPending 409 here would mean the close ran too early
    await expect(svc.approve(T, id, approver)).rejects.toThrow(
      'নোটিশটি প্রকাশিত নেই, তুলে নেওয়া হয়েছে বা মেয়াদ শেষ',
    );
    // the close committed on its own, after the 409's rollback
    const n = await row(id);
    expect(n.sms_status).toBe('DECLINED');
    // declined by the system, not by the caller
    expect(n.sms_decided_by_user_id).toBeNull();
    expect(await taskStatus(taskId)).toBe('RESOLVED');
    // money: nothing was reserved, so nothing moves
    expect(await newLedger(before)).toEqual([]);
    expect(await balance()).toEqual([10, 0]);
    expect(add).not.toHaveBeenCalled();
    // a second approve is now plainly notPending
    await expect(svc.approve(T, id, approver)).rejects.toThrow(
      'এই নোটিশের এসএমএস অনুরোধ এখন অপেক্ষায় নেই',
    );
  });

  it('view on an expired PENDING request says live:false, declines it and closes the task once', async () => {
    const id = await notice([await guardian('01711000030')], { expires: '2000-01-01' });
    const taskId = await withTask(id);
    // another tenant cannot trigger the close
    await expect(svc.view(randomUUID(), id, 1, 20)).rejects.toBeInstanceOf(NotFoundException);
    expect((await row(id)).sms_status).toBe('PENDING');

    const v = await svc.view(T, id, 1, 20);
    expect(v.live).toBe(false);
    expect(v.status).toBe('DECLINED');
    expect((await row(id)).sms_status).toBe('DECLINED');
    expect(await taskStatus(taskId)).toBe('RESOLVED');
    const recips = await ds.query(
      `SELECT DISTINCT state FROM alert_recipients WHERE alert_id = $1`,
      [taskId],
    );
    expect(recips.map((r: any) => r.state)).toEqual(['RESOLVED']);
    const audits = audit.mock.calls.length;
    // idempotent: closing an already-closed request is a no-op
    expect((await svc.view(T, id, 1, 20)).status).toBe('DECLINED');
    expect(audit.mock.calls.length).toBe(audits);
  });

  it('setWanted on an expired PENDING request is 409 notLive, changes no tick and closes the request', async () => {
    const id = await notice([await guardian('01711000032')], { expires: '2000-01-01' });
    const taskId = await withTask(id);
    const [r] = await ds.query(`SELECT id FROM notice_recipients WHERE notice_id = $1`, [id]);
    await expect(svc.setWanted(T, id, [r.id], false)).rejects.toThrow(
      'নোটিশটি প্রকাশিত নেই, তুলে নেওয়া হয়েছে বা মেয়াদ শেষ',
    );
    const [after] = await ds.query(`SELECT sms_wanted FROM notice_recipients WHERE id = $1`, [
      r.id,
    ]);
    expect(after.sms_wanted).toBe(true);
    const n = await row(id);
    expect(n.sms_status).toBe('DECLINED');
    expect(n.sms_decided_by_user_id).toBeNull();
    expect(await taskStatus(taskId)).toBe('RESOLVED');
    // now plainly not pending
    await expect(svc.setWanted(T, id, [r.id], false)).rejects.toThrow(
      'এই নোটিশের এসএমএস অনুরোধ এখন অপেক্ষায় নেই',
    );
  });

  it('view on a live PENDING request touches nothing', async () => {
    const id = await notice([await guardian('01711000031')]);
    const taskId = await withTask(id);
    const v = await svc.view(T, id, 1, 20);
    expect([v.live, v.status]).toEqual([true, 'PENDING']);
    expect((await row(id)).sms_status).toBe('PENDING');
    expect(await taskStatus(taskId)).toBe('ACTIVE');
    expect(audit).not.toHaveBeenCalled();
  });

  it('metered: reserves whole segments x unique phones, jobs add up to exactly the reservation', async () => {
    await meter(100);
    const id = await notice([
      await guardian('01711000003'),
      await guardian('01711000004'),
      await guardian('01711000004'), // same phone: one SMS, one share of credit
    ]);
    // Bangla title: UCS-2, so the body is several segments, not one
    await ds.query(`UPDATE notices SET title = $2 WHERE id = $1`, [id, 'নোটিশ '.repeat(20)]);
    expect((await svc.approve(T, id, approver)).queued).toBe(2);
    const logs = await logsOf(id);
    const s = countSmsSegments(logs[0].message_body).segments;
    expect(s).toBeGreaterThan(1);
    const [led] = await ds.query(
      `SELECT kind, units FROM sms_credit_ledger WHERE tenant_id = $1 AND idempotency_key = $2`,
      [T, `batch:${add.mock.calls[0][1].batchId}`],
    );
    expect(led.kind).toBe('RESERVE');
    // money: units = segments x unique phones
    expect(led.units).toBe(s * 2);
    const jobs = add.mock.calls.map((c) => c[1]);
    expect(jobs.every((j) => j.segments === s)).toBe(true);
    expect(jobs.reduce((sum, j) => sum + j.segments, 0)).toBe(led.units);
    const [{ available, reserved }] = await ds.query(
      `SELECT available, reserved FROM sms_credit_balance WHERE tenant_id = $1`,
      [T],
    );
    expect([available, reserved]).toEqual([100 - s * 2, s * 2]);
  });

  it('a failure after createPersonalLinks clears every new link hash and releases all credit', async () => {
    await meter(10);
    const id = await notice([await guardian('01711000020'), await guardian('01711000021')]);
    const before = await ledgerIds();
    const links = vi.spyOn(
      (svc as unknown as { links: NoticeLinksService }).links,
      'createPersonalLinks',
    );
    const realSave = EntityManager.prototype.save;
    const save = vi.spyOn(EntityManager.prototype, 'save').mockImplementation(function (
      this: EntityManager,
      ...a: unknown[]
    ) {
      // only the communication-log insert fails: it runs after the links were written
      if (a[0] === CommunicationLog) return Promise.reject(new Error('log insert down'));
      return (realSave as (...x: unknown[]) => Promise<unknown>).apply(this, a);
    } as never);
    let made: unknown[] = [];
    try {
      await expect(svc.approve(T, id, approver)).rejects.toThrow('log insert down');
      // read before mockRestore, which wipes mock.results
      made = await Promise.all(links.mock.results.map((r) => r.value));
    } finally {
      save.mockRestore();
      links.mockRestore();
    }
    // the links really were made before the failure, so the cleanup below is real
    expect(made).toHaveLength(1);
    expect(made[0]).toHaveLength(2);
    const linked = await ds.query(
      `SELECT count(*)::int c FROM notice_recipients WHERE notice_id = $1 AND link_token_hash IS NOT NULL`,
      [id],
    );
    expect(linked[0].c).toBe(0);
    expect(await balance()).toEqual([10, 0]);
    const ledger = await newLedger(before);
    // one reservation, given back in full
    expect(ledger.map((l: any) => l.kind).sort()).toEqual(['RELEASE', 'RESERVE']);
    expect(ledger[0].units).toBe(ledger[1].units);
    expect(ledger[1].units).toBeGreaterThan(0);
    expect((await row(id)).sms_status).toBe('PENDING');
    expect(await logsOf(id)).toHaveLength(0);
  });

  it('a missing personal link rolls the whole approve back: no credit stranded, request stays PENDING', async () => {
    await meter(10);
    const id = await notice([await guardian('01711000022'), await guardian('01711000023')]);
    const before = await ledgerIds();
    const service = (svc as unknown as { links: NoticeLinksService }).links;
    const real = service.createPersonalLinks.bind(service);
    // one real link is written, the other recipient's token is missing from the answer
    const links = vi
      .spyOn(service, 'createPersonalLinks')
      .mockImplementation(async (...a) => (await real(...a)).slice(0, 1));
    try {
      await expect(svc.approve(T, id, approver)).rejects.toThrow('personal link missing');
    } finally {
      links.mockRestore();
    }
    // money: the reservation was sized for both phones, so it must come back in full
    expect(await balance()).toEqual([10, 0]);
    const ledger = await newLedger(before);
    expect(ledger.map((l: any) => l.kind).sort()).toEqual(['RELEASE', 'RESERVE']);
    expect(ledger[0].units).toBe(ledger[1].units);
    // still PENDING, so the approver can try again
    expect((await row(id)).sms_status).toBe('PENDING');
    const linked = await ds.query(
      `SELECT count(*)::int c FROM notice_recipients WHERE notice_id = $1 AND link_token_hash IS NOT NULL`,
      [id],
    );
    expect(linked[0].c).toBe(0);
    expect(await logsOf(id)).toHaveLength(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('createPersonalLinks throwing midway clears the hash it already wrote and releases all credit', async () => {
    await meter(10);
    const id = await notice([await guardian('01711000024'), await guardian('01711000025')]);
    const before = await ledgerIds();
    const service = (svc as unknown as { links: NoticeLinksService }).links;
    const real = service.createPersonalLinks.bind(service);
    let writtenBeforeThrow = -1;
    // writes the first recipient's hash for real, then dies before returning any token
    const links = vi
      .spyOn(service, 'createPersonalLinks')
      .mockImplementation(async (noticeId, ids) => {
        await real(noticeId, ids.slice(0, 1));
        const [{ c }] = await ds.query(
          `SELECT count(*)::int c FROM notice_recipients WHERE notice_id = $1 AND link_token_hash IS NOT NULL`,
          [noticeId],
        );
        writtenBeforeThrow = c;
        throw new Error('link write down');
      });
    try {
      await expect(svc.approve(T, id, approver)).rejects.toThrow('link write down');
    } finally {
      links.mockRestore();
    }
    // the half-written hash was real, so the cleanup below is real
    expect(writtenBeforeThrow).toBe(1);
    const linked = await ds.query(
      `SELECT count(*)::int c FROM notice_recipients WHERE notice_id = $1 AND link_token_hash IS NOT NULL`,
      [id],
    );
    expect(linked[0].c).toBe(0);
    // money: the reservation was sized for both phones, so it must come back in full
    expect(await balance()).toEqual([10, 0]);
    const ledger = await newLedger(before);
    expect(ledger.map((l: any) => l.kind).sort()).toEqual(['RELEASE', 'RESERVE']);
    expect(ledger[0].units).toBe(ledger[1].units);
    expect(ledger[1].units).toBeGreaterThan(0);
    // still PENDING, so the approver can try again
    expect((await row(id)).sms_status).toBe('PENDING');
    expect(await logsOf(id)).toHaveLength(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('metered with too little credit: 409 INSUFFICIENT_SMS_CREDIT, notice stays PENDING, no logs, no reserve', async () => {
    await meter(1);
    const id = await notice([await guardian('01711000005'), await guardian('01711000006')]);
    const err: any = await svc.approve(T, id, approver).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('INSUFFICIENT_SMS_CREDIT');
    expect((await row(id)).sms_status).toBe('PENDING');
    expect(await logsOf(id)).toHaveLength(0);
    expect(add).not.toHaveBeenCalled();
    const [{ available, reserved }] = await ds.query(
      `SELECT available, reserved FROM sms_credit_balance WHERE tenant_id = $1`,
      [T],
    );
    expect([available, reserved]).toEqual([1, 0]);
    // nothing was linked: the hashes are still empty
    const linked = await ds.query(
      `SELECT count(*)::int c FROM notice_recipients WHERE notice_id = $1 AND link_token_hash IS NOT NULL`,
      [id],
    );
    expect(linked[0].c).toBe(0);
  });

  it('a rolled-back approve frees its credit, and the retry reserves again under a new batch', async () => {
    await meter(10);
    const id = await notice([await guardian('01711000010')]);
    audit.mockRejectedValueOnce(new Error('audit down'));
    await expect(svc.approve(T, id, approver)).rejects.toThrow('audit down');
    const bal = () =>
      ds.query(`SELECT available, reserved FROM sms_credit_balance WHERE tenant_id = $1`, [T]);
    expect((await bal())[0]).toMatchObject({ available: 10, reserved: 0 });
    expect((await row(id)).sms_status).toBe('PENDING');
    // the failed attempt left no link behind
    const linked = await ds.query(
      `SELECT count(*)::int c FROM notice_recipients WHERE notice_id = $1 AND link_token_hash IS NOT NULL`,
      [id],
    );
    expect(linked[0].c).toBe(0);
    await svc.approve(T, id, approver);
    expect((await bal())[0].available).toBeLessThan(10);
    const reserves = await ds.query(
      `SELECT count(*)::int c FROM sms_credit_ledger WHERE tenant_id = $1 AND kind = 'RESERVE' AND idempotency_key = $2`,
      [T, `batch:${add.mock.calls[0][1].batchId}`],
    );
    expect(reserves[0].c).toBe(1);
  });

  it('one guardian with two children gets one SMS', async () => {
    const g = await guardian('01711000011');
    const id = await notice([g]);
    await ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, guardian_id, student_id)
       VALUES ($1,$2,'GUARDIAN',$3,$4)`,
      [T, id, g, await student()],
    );
    const v = await svc.view(T, id, 1, 25);
    expect(v.counts.willSend).toBe(1);
    expect((await svc.approve(T, id, approver)).queued).toBe(1);
  });

  it('enqueue failure gives that credit back and fails that log only', async () => {
    await meter(10);
    const id = await notice([await guardian('01711000007'), await guardian('01711000008')]);
    const before = await ledgerIds();
    // the FIRST add rejects, the second goes through
    add.mockRejectedValueOnce(new Error('redis down'));
    await svc.approve(T, id, approver);
    const failedId = add.mock.calls[0][1].logId;
    const okId = add.mock.calls[1][1].logId;
    const s = add.mock.calls[0][1].segments;
    const status = Object.fromEntries((await logsOf(id)).map((l: any) => [l.id, l.status]));
    expect(status).toEqual({ [failedId]: 'FAILED', [okId]: 'QUEUED' });
    const ledger = await newLedger(before);
    // money: only the failed log's share comes back; the other stays reserved for its send
    expect(ledger.find((l: any) => l.idempotency_key === `log:${failedId}:settle`)).toMatchObject({
      kind: 'RELEASE',
      units: s,
    });
    expect(ledger.some((l: any) => l.idempotency_key === `log:${okId}:settle`)).toBe(false);
    expect(ledger.filter((l: any) => l.kind === 'RESERVE')).toEqual([
      expect.objectContaining({ units: 2 * s }),
    ]);
    expect(await balance()).toEqual([10 - s, s]);
  });

  it('two approves racing on one notice: one sends, the other gets 409, credit reserved once', async () => {
    await meter(10);
    const id = await notice([await guardian('01711000040')]);
    const before = await ledgerIds();
    // Hold the first approve inside its transaction (row lock taken) until the second is waiting.
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    audit.mockImplementationOnce(async () => {
      entered();
      await gate;
    });
    try {
      const first = svc.approve(T, id, approver);
      await inside;
      const second = svc.approve(T, id, approver);
      // wait for the second to block on the first's row lock (a condition, not a sleep);
      // each worker has its own database, so this only sees this file's sessions
      await expect
        .poll(async () => {
          const rows = await ds.query(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND pid <> pg_backend_pid()`,
          );
          return rows[0].n;
        })
        .toBeGreaterThan(0);
      open();
      const [a, b] = await Promise.allSettled([first, second]);
      expect(a).toEqual({ status: 'fulfilled', value: { status: 'APPROVED', queued: 1 } });
      expect(b.status).toBe('rejected');
      expect((b as PromiseRejectedResult).reason.message).toBe(
        'এই নোটিশের এসএমএস অনুরোধ এখন অপেক্ষায় নেই',
      );
    } finally {
      open();
    }
    expect(add).toHaveBeenCalledTimes(1);
    const reserves = (await newLedger(before)).filter((l: any) => l.kind === 'RESERVE');
    expect(reserves).toHaveLength(1);
    expect(await balance()).toEqual([10 - reserves[0].units, reserves[0].units]);
  });

  it('view: masked phones, counts, text, cost; request must exist', async () => {
    const id = await notice([
      await guardian('01712345234'),
      await guardian('01733333333', false),
      await guardian(null),
    ]);
    const v = await svc.view(T, id, 1, 25);
    expect(v.counts).toEqual({ willSend: 1, optedOut: 1, noPhone: 1 });
    expect(v.requester).toBe('Name author');
    expect(v.items.map((i) => i.phone).filter(Boolean)).toContain('01•••••234');
    expect(JSON.stringify(v)).not.toContain('01712345234');
    expect(v.sms.creditCost).toBe(v.sms.segments);
    expect(v.live).toBe(true);
    const none = await notice([], { sms: 'NONE' });
    await expect(svc.view(T, none, 1, 25)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tenant isolation: another tenant cannot read, tick, approve or decline', async () => {
    const id = await notice([await guardian('01711000008')]);
    const other = randomUUID();
    await expect(svc.view(other, id, 1, 25)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.setWanted(other, id, [randomUUID()], false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.approve(other, id, approver)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.decline(other, id, approver)).rejects.toBeInstanceOf(NotFoundException);
    expect((await row(id)).sms_status).toBe('PENDING');
  });
});

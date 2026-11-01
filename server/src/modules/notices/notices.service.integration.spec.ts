import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AudienceTab, AudienceTarget, NoticeRecipientKind, UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { Teacher } from '../academics/entities/teacher.entity';
import { AuthModule } from '../auth/auth.module';
import { AlertWriterService } from '../attention/engine/alert-writer.service';
import { AudienceService } from '../audience/audience.service';
import { NoticeAlertsService } from '../attention/notice/notice-alerts.service';
import { PushService } from '../push/push.service';
import { NoticeLinksService } from './links/notice-links.service';
import { NoticesModule } from './notices.module';
import { NoticesService } from './notices.service';
import { NoticeRecipientsService } from './notice-recipients.service';

/** [53.2.04] Notice authoring against the real test DB. Push is stubbed (counted); everything else is real. */
describe('NoticesService (integration)', () => {
  let svc: NoticesService;
  let recipients: NoticeRecipientsService;
  let links: NoticeLinksService;
  let ds: DataSource;
  let push: ReturnType<typeof vi.spyOn>;
  let invalidate: ReturnType<typeof vi.spyOn>;
  let alertsSvc: NoticeAlertsService;
  let audience: AudienceService;
  const T = SEED_TENANT_ID;
  const TENANT_B = randomUUID();
  const sfx = randomUUID().slice(0, 8);
  let roll = 800000 + (parseInt(sfx, 16) % 90000);
  const u = { author: randomUUID(), staff2: randomUUID(), g1: randomUUID(), stu: randomUUID() };
  const admin = { userId: u.author, role: UserRole.ADMIN };
  const teacherOther = { userId: u.staff2, role: UserRole.TEACHER };
  let kid1: string;
  let kid2: string;
  let kid3: string;
  let kidLogin: string;
  let g1: string;

  const draft = (o: Record<string, unknown> = {}, actor = admin) =>
    svc.create(T, actor, { title: `N ${sfx}`, body: 'body', ...o });
  const staffRef = (userId: string) => ({ kind: NoticeRecipientKind.STAFF, userId });
  const studentRef = (studentId: string) => ({ kind: NoticeRecipientKind.STUDENT, studentId });
  const guardianRef = (studentId: string) => ({
    kind: NoticeRecipientKind.GUARDIAN,
    guardianId: g1,
    studentId,
  });
  const rows = (noticeId: string) =>
    ds.query(`SELECT * FROM notice_recipients WHERE notice_id = $1 ORDER BY created_at`, [
      noticeId,
    ]);
  const noticeRow = async (id: string) =>
    (await ds.query(`SELECT * FROM notices WHERE id = $1`, [id]))[0];
  const alertRow = async (id: string) =>
    (await ds.query(`SELECT * FROM alerts WHERE id = $1`, [id]))[0];

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), NoticesModule, AuthModule],
    );
    svc = module.get(NoticesService);
    recipients = module.get(NoticeRecipientsService);
    links = module.get(NoticeLinksService);
    alertsSvc = module.get(NoticeAlertsService);
    audience = module.get(AudienceService);
    ds = module.get<DataSource>(getDataSourceToken());
    push = vi.spyOn(module.get(PushService), 'sendToUser');
    invalidate = vi.spyOn(module.get(AlertWriterService), 'invalidateSummary');
    for (const [name, id] of Object.entries(u)) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'ACTIVE',NOW(),NOW())`,
        [id, `nt-${name}-${sfx}@test.com`, SEED_ADMIN_PASSWORD_HASH, `Name ${name}`],
      );
    }
    for (const id of [u.author, u.staff2])
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1,$2,'ADMIN',NOW(),NOW())`,
        [id, T],
      );
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,'Notice B',$2,NOW(),NOW())`,
      [TENANT_B, `notice-b-${sfx}`],
    );
  }, 90000);

  // Students and guardians are cleared between tests, notices too.
  beforeEach(async () => {
    push.mockReset().mockResolvedValue({ accepted: 1, transient: 0, pruned: 0 });
    invalidate.mockClear();
    const mkStudent = async (name: string, userId: string | null = null) =>
      (
        await ds.query(
          `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                                 enrollment_status, preferred_communication, user_id, created_at, updated_at)
           VALUES ($1,$2,$5,$3,$4,'ACTIVE','SMS',$6,NOW(),NOW()) RETURNING id`,
          [name, `NT-${randomUUID().slice(0, 10)}`, SEED_SECTION_1_ID, T, roll++, userId],
        )
      )[0].id;
    kid1 = await mkStudent(`Kid One ${sfx}`);
    kid2 = await mkStudent(`Kid Two ${sfx}`);
    kid3 = await mkStudent(`Kid Three ${sfx}`);
    kidLogin = await mkStudent(`Kid Login ${sfx}`);
    g1 = (
      await ds.query(
        `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                                preferred_communication, is_primary_contact, created_at, updated_at)
         VALUES ('G One','FATHER','+8801700000092',$1,$2,$3,'SMS',true,NOW(),NOW()) RETURNING id`,
        [`g1-${randomUUID()}@test.com`, T, u.g1],
      )
    )[0].id;
    for (const k of [kid1, kid2, kid3])
      await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1,$2)`, [
        k,
        g1,
      ]);
  });

  // the push fan-out is detached and writes pushed_at; never let it run into the next test's reset
  afterEach(() => svc.idle());

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it("expiresOn comes back as the school-local 'YYYY-MM-DD', not a Date (M1)", async () => {
    const n = await draft({ expiresOn: '2099-12-31' });
    expect(n.expiresOn).toBe('2099-12-31');
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    expect((await svc.publish(T, admin, n.id, false)).expiresOn).toBe('2099-12-31');
    expect(
      (await svc.list(T, admin, { page: 1, limit: 100, q: sfx })).items.find((x) => x.id === n.id)
        ?.expiresOn,
    ).toBe('2099-12-31');
  });

  it('PATCH with null on a NOT NULL field is a 400, never a DB error (m2)', async () => {
    const n = await draft();
    for (const k of ['title', 'body', 'important', 'pinned', 'isPublic'])
      await expect(svc.update(T, admin, n.id, { [k]: null } as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    // expiresOn may be cleared
    await expect(svc.update(T, admin, n.id, { expiresOn: null })).resolves.toMatchObject({
      expiresOn: null,
    });
  });

  it('publish snapshots the list: adding or removing rows afterwards is refused', async () => {
    const n = await draft();
    await recipients.add(T, admin, n.id, [staffRef(u.staff2), studentRef(kid1)]);
    const pub = await svc.publish(T, admin, n.id, false);
    expect(pub.status).toBe('PUBLISHED');
    expect(pub.recipientCount).toBe(2);
    await expect(recipients.add(T, admin, n.id, [studentRef(kid2)])).rejects.toBeInstanceOf(
      ConflictException,
    );
    const [first] = await rows(n.id);
    await expect(recipients.remove(T, admin, n.id, [first.id])).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await rows(n.id)).toHaveLength(2);
    // publishing twice is refused too
    await expect(svc.publish(T, admin, n.id, false)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an empty Chosen list', async () => {
    const n = await draft();
    await expect(svc.publish(T, admin, n.id, false)).rejects.toBeInstanceOf(BadRequestException);
    expect((await noticeRow(n.id)).status).toBe('DRAFT');
  });

  it('select-all above 5,000 is refused with the fixed sentence and stores nothing', async () => {
    const n = await draft();
    // 5,001 DISTINCT people: the cap counts people, not rows
    vi.spyOn(audience, 'matchAll').mockResolvedValueOnce(
      Array.from({ length: 5001 }, () => ({
        kind: 'STUDENT',
        userId: null,
        studentId: randomUUID(),
        guardianId: null,
      })) as never,
    );
    const err = await recipients
      .addMatching(T, admin, n.id, {
        target: AudienceTarget.STUDENTS,
        tab: AudienceTab.CLASS,
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('সর্বোচ্চ ৫,০০০ জন (অভিভাবককে প্রতিটি সন্তানের জন্য আলাদা গোনা হয়)');
    expect(await rows(n.id)).toHaveLength(0);
  });

  it('guardians with two children count once toward the cap', async () => {
    const n = await draft();
    // 5,002 guardian rows over 2,501 distinct guardians (each with two children): under the cap
    const refs = Array.from({ length: 2501 }, () => randomUUID()).flatMap((guardianId) => [
      { kind: 'GUARDIAN', userId: null, studentId: randomUUID(), guardianId },
      { kind: 'GUARDIAN', userId: null, studentId: randomUUID(), guardianId },
    ]);
    vi.spyOn(audience, 'matchAll').mockResolvedValueOnce(refs as never);
    const res = await recipients.addMatching(T, admin, n.id, {
      target: AudienceTarget.GUARDIANS,
      tab: AudienceTab.CLASS,
    });
    // the fake ids join nothing, so nothing is stored; the point is no cap error
    expect(res.added).toBe(0);
  });

  it('select-all checks ownership and DRAFT before it runs the audience query', async () => {
    const spy = vi.spyOn(audience, 'matchAll');
    spy.mockClear();
    const n = await draft();
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, n.id, false);
    const filter = {
      target: AudienceTarget.STUDENTS,
      tab: AudienceTab.SECTION,
      sectionIds: [SEED_SECTION_1_ID],
    };
    await expect(recipients.addMatching(T, admin, n.id, filter)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(recipients.addMatching(T, admin, randomUUID(), filter)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('select-all adds every match once (re-running adds nothing)', async () => {
    const n = await draft();
    const filter = {
      target: AudienceTarget.STUDENTS,
      tab: AudienceTab.SECTION,
      sectionIds: [SEED_SECTION_1_ID],
      q: sfx,
    };
    const first = await recipients.addMatching(T, admin, n.id, filter);
    expect(first.added).toBe(4);
    const again = await recipients.addMatching(T, admin, n.id, filter);
    expect(again).toEqual({ added: 0, total: 4 });
  });

  it('unknown and foreign people are skipped, never stored', async () => {
    const n = await draft();
    const res = await recipients.add(T, admin, n.id, [
      studentRef(randomUUID()),
      staffRef(randomUUID()),
      studentRef(kid1),
    ]);
    expect(res).toEqual({ added: 1, total: 1 });
  });

  it('copy keeps the Chosen list, text and flags; not the expiry', async () => {
    const n = await draft({ important: true, pinned: true, expiresOn: '2999-01-01' });
    await recipients.add(T, admin, n.id, [staffRef(u.staff2), guardianRef(kid1)]);
    const copy = await svc.copy(T, admin, n.id);
    expect(copy.id).not.toBe(n.id);
    expect(copy).toMatchObject({
      title: n.title,
      status: 'DRAFT',
      important: true,
      pinned: true,
      expiresOn: null,
      recipientCount: 2,
    });
    expect(await rows(copy.id)).toHaveLength(2);
  });

  it('withdraw kills the links, the alert and the pending SMS task', async () => {
    const n = await draft({ important: true, isPublic: true });
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    const pub = await svc.publish(T, admin, n.id, true);
    // M3: publish never returns the raw token (its answer is cached for idempotency)
    expect(pub.publicLinkToken).toBeUndefined();
    expect(pub.smsStatus).toBe('PENDING');
    expect((await noticeRow(n.id)).public_token_hash).not.toBeNull();
    const { token } = await svc.newPublicLink(T, admin, n.id);
    const before = await noticeRow(n.id);
    expect(await links.resolve(token)).not.toBeNull();
    expect((await alertRow(before.alert_id)).status).toBe('ACTIVE');
    expect((await alertRow(before.sms_task_alert_id)).status).toBe('ACTIVE');

    const out = await svc.withdraw(T, admin, n.id);
    expect(out.status).toBe('WITHDRAWN');
    const after = await noticeRow(n.id);
    expect(after.public_token_hash).toBeNull();
    expect(await links.resolve(token)).toBeNull();
    expect((await alertRow(before.alert_id)).status).toBe('WITHDRAWN');
    expect((await alertRow(before.sms_task_alert_id)).status).toBe('RESOLVED');
    // declined by the system: no deciding user
    expect(after.sms_status).toBe('DECLINED');
    expect(after.sms_decided_by_user_id).toBeNull();
    // withdrawing twice, or editing a withdrawn notice, is refused
    await expect(svc.withdraw(T, admin, n.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.update(T, admin, n.id, { title: 'x' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('editing a published notice sets edited_at and sends no push; a draft edit does not set it', async () => {
    const n = await draft();
    await svc.update(T, admin, n.id, { title: 'draft edit' });
    expect((await noticeRow(n.id)).edited_at).toBeNull();
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, n.id, false);
    await svc.idle(); // let the publish push finish, then count from zero
    push.mockClear();
    const out = await svc.update(T, admin, n.id, { body: 'new body', pinned: true });
    await svc.idle();
    expect(out.editedAt).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('turning important on after publish raises the alert, off withdraws it; public toggles the link', async () => {
    const n = await draft();
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, n.id, false);
    await svc.update(T, admin, n.id, { important: true });
    const on = await noticeRow(n.id);
    expect((await alertRow(on.alert_id)).status).toBe('ACTIVE');
    await svc.update(T, admin, n.id, { important: false });
    expect((await alertRow(on.alert_id)).status).toBe('WITHDRAWN');
    expect((await noticeRow(n.id)).alert_id).toBeNull();

    const withLink = await svc.update(T, admin, n.id, { isPublic: true });
    expect(withLink.publicLinkToken).toBeTruthy();
    expect(await links.resolve(withLink.publicLinkToken!)).not.toBeNull();
    await svc.update(T, admin, n.id, { isPublic: false });
    expect(await links.resolve(withLink.publicLinkToken!)).toBeNull();
  });

  it('report counts match the rows', async () => {
    const n = await draft();
    await recipients.add(T, admin, n.id, [staffRef(u.staff2), studentRef(kid1), studentRef(kid2)]);
    await svc.publish(T, admin, n.id, false);
    await ds.query(
      `UPDATE notice_recipients SET seen_at = now(), acknowledged_at = now() WHERE notice_id = $1 AND user_id = $2`,
      [n.id, u.staff2],
    );
    await ds.query(
      `UPDATE notice_recipients SET link_opened_at = now(), seen_at = now() WHERE notice_id = $1 AND student_id = $2`,
      [n.id, kid1],
    );
    const rep = await svc.report(T, admin, n.id, { page: 1, limit: 25 });
    expect(rep.totals).toEqual({
      people: 3,
      seen: 2,
      linkOpened: 1,
      acknowledged: 1,
      unreachable: 2, // kid1 and kid2: no login, and a student has no phone
    });
    expect(rep.items).toHaveLength(3);
    const unseen = await svc.report(T, admin, n.id, {
      page: 1,
      limit: 25,
      status: 'UNSEEN' as never,
    });
    expect(unseen.items).toHaveLength(1);
    expect(unseen.items[0].name).toContain('Kid Two');
  });

  it('one guardian with 3 children: 3 rows, 1 person, 1 push', async () => {
    const n = await draft();
    await recipients.add(T, admin, n.id, [kid1, kid2, kid3].map(guardianRef));
    const pub = await svc.publish(T, admin, n.id, false);
    expect(await rows(n.id)).toHaveLength(3);
    expect(pub.recipientCount).toBe(1);
    await svc.idle(); // push fan-out is detached; wait for it
    const calls = push.mock.calls.filter((c: unknown[]) => c[0] === u.g1);
    expect(calls).toHaveLength(1);
    // every row of the pushed user carries pushed_at
    expect((await rows(n.id)).every((r: any) => r.pushed_at)).toBe(true);
  });

  it('publish fills user_id for a student who got a login after being added', async () => {
    const n = await draft();
    await recipients.add(T, admin, n.id, [studentRef(kid1)]);
    await ds.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [u.stu, kid1]);
    await svc.publish(T, admin, n.id, false);
    expect((await rows(n.id))[0].user_id).toBe(u.stu);
    await svc.idle();
    expect(push.mock.calls.map((c: unknown[]) => c[0])).toContain(u.stu);
  });

  it('a muted NOTICE category gets no push, unless the notice is important', async () => {
    await ds.query(
      `UPDATE users SET preferences = '{"notifications":{"mutedCategories":["NOTICE"]}}'::jsonb WHERE id = $1`,
      [u.staff2],
    );
    try {
      const plain = await draft();
      await recipients.add(T, admin, plain.id, [staffRef(u.staff2)]);
      await svc.publish(T, admin, plain.id, false);
      await svc.idle();
      expect(push).not.toHaveBeenCalled();

      const imp = await draft({ important: true });
      await recipients.add(T, admin, imp.id, [staffRef(u.staff2)]);
      await svc.publish(T, admin, imp.id, false);
      await svc.idle();
      expect(push.mock.calls.map((c: unknown[]) => c[0])).toEqual([u.staff2]);
    } finally {
      await ds.query(`UPDATE users SET preferences = NULL WHERE id = $1`, [u.staff2]);
    }
  });

  it('a push failure never fails publish (D29)', async () => {
    push.mockRejectedValue(new Error('push down'));
    const n = await draft();
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await expect(svc.publish(T, admin, n.id, false)).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    await svc.idle(); // the failing push is swallowed, not thrown
    // nobody accepted the push, so pushed_at stays empty
    expect((await rows(n.id))[0].pushed_at).toBeNull();
  });

  it('publish is all-or-nothing: a forced alert failure leaves a DRAFT, no link, no cache bust', async () => {
    const n = await draft({ important: true, isPublic: true });
    await recipients.add(T, admin, n.id, [staffRef(u.staff2), studentRef(kid1)]);
    const spy = vi
      .spyOn(alertsSvc, 'raiseImportant')
      .mockRejectedValueOnce(new Error('alert boom'));
    await expect(svc.publish(T, admin, n.id, true)).rejects.toThrow('alert boom');
    spy.mockRestore();
    const row = await noticeRow(n.id);
    expect(row).toMatchObject({
      status: 'DRAFT',
      published_at: null,
      recipient_count: 0,
      alert_id: null,
      sms_status: 'NONE',
      public_token_hash: null,
    });
    expect(await ds.query(`SELECT 1 FROM alerts WHERE subject_id = $1`, [n.id])).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
    await svc.idle();
    expect(push).not.toHaveBeenCalled();
    // and the same draft publishes fine afterwards
    await expect(svc.publish(T, admin, n.id, false)).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
  });

  it('the summary cache is invalidated after commit for the recipients who have a login', async () => {
    const n = await draft({ important: true });
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, n.id, false);
    expect(invalidate).toHaveBeenCalledWith(T, [u.staff2]);
    invalidate.mockClear();
    await svc.withdraw(T, admin, n.id);
    expect(invalidate).toHaveBeenCalledWith(T, [u.staff2]);
  });

  it('delete: a draft goes with its rows; a published notice is 409', async () => {
    const n = await draft();
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.remove(T, admin, n.id);
    expect(await noticeRow(n.id)).toBeUndefined();
    expect(await rows(n.id)).toHaveLength(0);

    const p = await draft();
    await recipients.add(T, admin, p.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, p.id, false);
    const err = await svc.remove(T, admin, p.id).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('প্রকাশিত নোটিশ মুছে ফেলা যায় না, তুলে নিন');
  });

  it('sms/request: only on a published notice, only once, and it never sends', async () => {
    const n = await draft();
    await expect(svc.requestSms(T, admin, n.id)).rejects.toBeInstanceOf(ConflictException);
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, n.id, false);
    const out = await svc.requestSms(T, admin, n.id);
    expect(out.smsStatus).toBe('PENDING');
    await expect(svc.requestSms(T, admin, n.id)).rejects.toBeInstanceOf(ConflictException);
    // no communication was queued for this notice
    expect((await rows(n.id)).every((r: any) => r.sms_sent_at === null)).toBe(true);
  });

  it("a teacher cannot touch another author's notice (404); NOTICE_MANAGE can", async () => {
    const n = await draft();
    await expect(svc.get(T, teacherOther, n.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update(T, teacherOther, n.id, { title: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const mine = await svc.list(T, teacherOther, { page: 1, limit: 100, q: sfx });
    expect(mine.items.map((i) => i.id)).not.toContain(n.id);
    const all = await svc.list(T, admin, { page: 1, limit: 100, q: sfx });
    expect(all.items.map((i) => i.id)).toContain(n.id);
    await expect(
      svc.get(T, { userId: u.staff2, role: UserRole.ADMIN }, n.id),
    ).resolves.toBeTruthy();
  });

  it('expiry in the past is refused', async () => {
    await expect(draft({ expiresOn: '2000-01-01' })).rejects.toBeInstanceOf(BadRequestException);
  });

  const audits = (id: string) =>
    ds.query(
      `SELECT new_values->>'event' AS event, performed_by_user_id FROM audit_logs
        WHERE entity_id = $1 AND tenant_id = $2 ORDER BY created_at`,
      [id, T],
    );

  it('audit rows are written for publish, withdraw and public-link on / off (D17)', async () => {
    const n = await draft({ isPublic: true });
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, n.id, false);
    await svc.newPublicLink(T, admin, n.id);
    await svc.turnOffPublicLink(T, admin, n.id);
    expect((await noticeRow(n.id)).public_token_hash).toBeNull();
    expect((await noticeRow(n.id)).is_public).toBe(false);
    await svc.withdraw(T, admin, n.id);
    const rowsOut = await audits(n.id);
    expect(rowsOut.map((r: { event: string }) => r.event)).toEqual([
      'PUBLISH',
      'PUBLIC_LINK_ON',
      'PUBLIC_LINK_OFF',
      'WITHDRAW',
    ]);
    expect(
      rowsOut.every((r: { performed_by_user_id: string }) => r.performed_by_user_id === u.author),
    ).toBe(true);
  });

  it('the SMS-approval task admins get their summary cache dropped on raise and on withdraw-close', async () => {
    const n = await draft();
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, n.id, true);
    // an ADMIN holds NOTICE_SMS_APPROVE, so the author (an ADMIN member) is among the task's recipients
    const ids = (calls: unknown[][]) => calls.flatMap((c) => c[1] as string[]);
    expect(ids(invalidate.mock.calls)).toContain(u.author);
    invalidate.mockClear();
    await svc.withdraw(T, admin, n.id);
    expect(ids(invalidate.mock.calls)).toContain(u.author);
  });

  it('editing public on after a failed link (flag set, no token) creates the link', async () => {
    const n = await draft({ isPublic: true });
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, n.id, false);
    // simulate publish having lost its link: flag is on, token is missing
    await ds.query(`UPDATE notices SET public_token_hash = NULL WHERE id = $1`, [n.id]);
    const out = await svc.update(T, admin, n.id, { isPublic: true });
    expect(out.publicLinkToken).toBeTruthy();
    expect((await noticeRow(n.id)).public_token_hash).not.toBeNull();
  });

  it('a failed link clean-up after turn-off: the old link stays dead and turn-on mints a new one (Rule 16)', async () => {
    const n = await draft({ isPublic: true });
    await recipients.add(T, admin, n.id, [staffRef(u.staff2)]);
    await svc.publish(T, admin, n.id, false);
    const { token: old } = await svc.newPublicLink(T, admin, n.id);
    const spy = vi.spyOn(links, 'turnOffPublicLink').mockRejectedValueOnce(new Error('db blip'));
    // the clean-up failure is logged, not a 500; the flag is already off
    await expect(svc.turnOffPublicLink(T, admin, n.id)).resolves.toBeUndefined();
    spy.mockRestore();
    expect((await noticeRow(n.id)).public_token_hash).not.toBeNull(); // left behind
    expect(await links.resolve(old)).toBeNull(); // still dead: is_public is false
    const on = await svc.update(T, admin, n.id, { isPublic: true });
    expect(on.publicLinkToken).toBeTruthy();
    expect(on.publicLinkToken).not.toBe(old);
    expect(await links.resolve(old)).toBeNull(); // the old token never comes back
    expect(await links.resolve(on.publicLinkToken!)).not.toBeNull();
  });

  describe('teacher scope (Rule 2, D2)', () => {
    // SEED_SECTION_1 is the teacher's; SEED_SECTION_2 is not.
    let teacherUser: string;
    let lonelyUser: string;
    let otherKid: string;
    let teacher: { userId: string; role: UserRole };
    let lonely: { userId: string; role: UserRole };

    beforeAll(async () => {
      for (const name of ['teacher', 'lonely']) {
        const [{ id }] = await ds.query(
          `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
           VALUES ($1,$2,$3,'ACTIVE',NOW(),NOW()) RETURNING id`,
          [`nt-${name}-${sfx}@test.com`, SEED_ADMIN_PASSWORD_HASH, `T ${name}`],
        );
        await ds.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
           VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
          [id, T],
        );
        if (name === 'teacher') teacherUser = id;
        else lonelyUser = id;
      }
      teacher = { userId: teacherUser, role: UserRole.TEACHER };
      lonely = { userId: lonelyUser, role: UserRole.TEACHER };
    });

    // teachers and assignments are wiped before every test
    beforeEach(async () => {
      const t = await ds.getRepository(Teacher).save({
        user_id: teacherUser,
        employee_id: `NT-${sfx}`,
        tenant_id: T,
        designations: [],
      });
      await ds.query(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
         VALUES ($1,$2,$3,'CLASS_TEACHER')`,
        [t.id, SEED_SECTION_1_ID, T],
      );
      [{ id: otherKid }] = await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                               enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ('Other Section Kid',$1,$2,$3,$4,'ACTIVE','SMS',NOW(),NOW()) RETURNING id`,
        [`NT-${randomUUID().slice(0, 10)}`, roll++, SEED_SECTION_2_ID, T],
      );
    });

    it('keeps a student of their own section and skips one of another section', async () => {
      const n = await draft({}, teacher as never);
      const res = await recipients.add(T, teacher, n.id, [studentRef(kid1), studentRef(otherKid)]);
      expect(res).toEqual({ added: 1, total: 1 });
      expect((await rows(n.id))[0].student_id).toBe(kid1);
    });

    it('a staff ref is 403 and stores nothing', async () => {
      const n = await draft({}, teacher as never);
      await expect(recipients.add(T, teacher, n.id, [staffRef(u.staff2)])).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(await rows(n.id)).toHaveLength(0);
    });

    it('a student moved to another section after adding makes publish 403 and the notice stays a DRAFT', async () => {
      const n = await draft({}, teacher as never);
      await recipients.add(T, teacher, n.id, [studentRef(kid1)]);
      await ds.query(`UPDATE students SET class_section_id = $1 WHERE id = $2`, [
        SEED_SECTION_2_ID,
        kid1,
      ]);
      await expect(svc.publish(T, teacher, n.id, false)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await noticeRow(n.id)).status).toBe('DRAFT');
    });

    it('a teacher with no assignment adds nothing', async () => {
      const n = await draft({}, lonely as never);
      const res = await recipients.add(T, lonely, n.id, [studentRef(kid1)]);
      expect(res).toEqual({ added: 0, total: 0 });
    });
  });

  describe('tenant isolation: a notice of tenant B is a 404 on every operation from tenant A', () => {
    it('never reads, changes or kills anything of tenant B', async () => {
      const [b] = await ds.query(
        `INSERT INTO notices (tenant_id, author_user_id, title, body, status, important, is_public, published_at,
                              public_token_hash, public_token_created_at, recipient_count)
         VALUES ($1,$2,'B notice','b','PUBLISHED',false,true,now(),$3,now(),1) RETURNING id`,
        [TENANT_B, u.author, `hash-${sfx}`],
      );
      await ds.query(
        `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id, link_token_hash)
         VALUES ($1,$2,'STAFF',$3,$4)`,
        [TENANT_B, b.id, u.staff2, `rhash-${sfx}`],
      );
      const id = b.id as string;
      const calls: Record<string, () => Promise<unknown>> = {
        get: () => svc.get(T, admin, id),
        update: () => svc.update(T, admin, id, { title: 'hijack' }),
        remove: () => svc.remove(T, admin, id),
        copy: () => svc.copy(T, admin, id),
        publish: () => svc.publish(T, admin, id, false),
        withdraw: () => svc.withdraw(T, admin, id),
        requestSms: () => svc.requestSms(T, admin, id),
        publicLinkNew: () => svc.newPublicLink(T, admin, id),
        publicLinkOff: () => svc.turnOffPublicLink(T, admin, id),
        report: () => svc.report(T, admin, id, { page: 1, limit: 25 }),
        listRecipients: () => svc.listRecipients(T, admin, id, 1, 25),
        addRecipients: () => recipients.add(T, admin, id, [studentRef(kid1)]),
        addMatching: () =>
          recipients.addMatching(T, admin, id, {
            target: AudienceTarget.STUDENTS,
            tab: AudienceTab.SECTION,
            sectionIds: [SEED_SECTION_1_ID],
          }),
        removeRecipients: () => recipients.remove(T, admin, id, [randomUUID()]),
      };
      for (const [name, call] of Object.entries(calls)) {
        await expect(call(), name).rejects.toBeInstanceOf(NotFoundException);
      }
      // nothing of B was touched: links alive, title unchanged, still one recipient
      const after = await noticeRow(id);
      expect(after).toMatchObject({
        title: 'B notice',
        status: 'PUBLISHED',
        is_public: true,
        public_token_hash: `hash-${sfx}`,
      });
      expect((await rows(id))[0].link_token_hash).toBe(`rhash-${sfx}`);
      // and no copy of it appeared in tenant A
      expect(
        await ds.query(`SELECT 1 FROM notices WHERE tenant_id = $1 AND title = 'B notice'`, [T]),
      ).toHaveLength(0);
      // list from A does not show it
      const list = await svc.list(T, admin, { page: 1, limit: 100, q: 'B notice' });
      expect(list.items).toHaveLength(0);
    });
  });
});

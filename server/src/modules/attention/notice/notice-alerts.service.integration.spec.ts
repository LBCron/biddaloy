import { AttentionQueryService } from '../api/attention-query.service';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { RuleContextService } from '../rules/rule-context.service';
import { NoticeAlertsService } from './notice-alerts.service';

const TZ = 'Asia/Dhaka';

describe('NoticeAlertsService (integration)', () => {
  let ds: DataSource;
  let service: NoticeAlertsService;
  let tenantB: string;
  const stamp = Date.now();
  const u: Record<string, string> = {};

  const mkUser = async (n: string) =>
    (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', $2, 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`notice-alert-${n}-${stamp}@example.com`, `Notice ${n}`],
      )
    )[0].id as string;
  const member = (userId: string, role: UserRole, tenant = SEED_TENANT_ID) =>
    ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [userId, tenant, role],
    );
  const mkNotice = async (tenant = SEED_TENANT_ID) =>
    (
      await ds.query(
        `INSERT INTO notices (tenant_id, author_user_id, title, body) VALUES ($1, $2, 'T', 'B') RETURNING id`,
        [tenant, u.admin],
      )
    )[0].id as string;
  const input = (id: string, expiresOn: string | null = null, tenantId = SEED_TENANT_ID) => ({
    id,
    tenantId,
    title: 'Closed tomorrow',
    body: 'Rain',
    expiresOn,
  });
  const inTx = <T>(fn: (em: any) => Promise<T>) => ds.transaction(fn);
  const recipients = (alertId: string) =>
    ds.query(`SELECT user_id, state, role FROM alert_recipients WHERE alert_id = $1`, [alertId]);
  /** Same filter the attention list uses: OPEN/HIDDEN recipient on an ACTIVE alert. */
  const showing = async (userId: string, alertId: string) =>
    (
      await ds.query(
        `SELECT 1 FROM alert_recipients r JOIN alerts a ON a.id = r.alert_id AND a.tenant_id = r.tenant_id
          WHERE r.user_id = $1 AND a.id = $2 AND r.state IN ('OPEN','HIDDEN') AND a.status = 'ACTIVE'`,
        [userId, alertId],
      )
    ).length === 1;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      NoticeAlertsService,
      {
        provide: RuleContextService,
        useValue: { build: async () => ({ tz: TZ }) },
      },
    ]);
    ds = module.get(DataSource);
    service = module.get(NoticeAlertsService);
    [{ id: tenantB }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Notice Other', 'notice-other-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    for (const n of ['admin', 'exec', 'office', 'teacher', 'other', 'bAdmin', 'inactive'])
      u[n] = await mkUser(n);
    await ds.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [u.inactive]);
    await member(u.admin, UserRole.ADMIN);
    await member(u.exec, UserRole.EXECUTIVE);
    await member(u.office, UserRole.OFFICE_STAFF);
    await member(u.teacher, UserRole.TEACHER);
    await member(u.inactive, UserRole.ADMIN);
    await member(u.bAdmin, UserRole.ADMIN, tenantB);
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await ds.query(`DELETE FROM notice_recipients WHERE tenant_id IN ($1, $2)`, [
      SEED_TENANT_ID,
      tenantB,
    ]);
    await ds.query(`DELETE FROM notices WHERE tenant_id IN ($1, $2)`, [SEED_TENANT_ID, tenantB]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [
      `notice-alert-%-${stamp}@example.com`,
    ]);
    await ds.destroy();
  });

  it('important alert reaches only recipients with a login, as a personal NOTICE alert', async () => {
    const id = await mkNotice();
    const alertId = await inTx((em) =>
      service.raiseImportant(em, input(id), [
        { userId: u.teacher },
        { userId: null },
        { userId: u.teacher }, // duplicate collapses
      ]),
    );
    const rows = await recipients(alertId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: u.teacher, state: 'OPEN', role: null });
    const [a] = await ds.query(
      `SELECT source, category, severity, rule_key, subject_type, subject_id, action_url, expires_at
         FROM alerts WHERE id = $1`,
      [alertId],
    );
    expect(a).toMatchObject({
      source: 'NOTICE',
      category: 'NOTICE',
      severity: 'WARNING',
      rule_key: 'notice.important',
      subject_type: 'notice',
      subject_id: id,
      action_url: `/communications/notices/${id}`,
      expires_at: null,
    });
  });

  it('uses the portal URL when every recipient is portal-only', async () => {
    const id = await mkNotice();
    const alertId = await inTx((em) =>
      service.raiseImportant(em, input(id), [{ userId: u.other, portal: true }]),
    );
    const [a] = await ds.query(`SELECT action_url FROM alerts WHERE id = $1`, [alertId]);
    expect(a.action_url).toBe(`/portal/notices/${id}`);
  });

  it('a mixed audience: staff reader gets the staff URL, a portal reader the portal URL (D16)', async () => {
    const id = await mkNotice();
    // the teacher is on the Chosen list as STAFF; u.other stands in for a guardian login
    await ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id) VALUES ($1, $2, 'STAFF', $3)`,
      [SEED_TENANT_ID, id, u.teacher],
    );
    const alertId = await inTx((em) =>
      service.raiseImportant(em, input(id), [
        { userId: u.teacher },
        { userId: u.other, portal: true },
      ]),
    );
    // hide() clears the summary cache; a no-op writer is enough here
    const writer = { invalidateSummary: async () => undefined };
    const q = new AttentionQueryService(
      ds,
      { get: () => undefined } as any,
      ...([{}, writer, {}, {}, {}, {}] as [any, any, any, any, any, any]),
    );
    // read through the real list query: the URL is chosen per reader, not stored once
    const urlFor = async (userId: string, role: UserRole) => {
      const page = await q.items(SEED_TENANT_ID, userId, role, {
        page: 1,
        pageSize: 50,
        locale: 'en',
      } as any);
      return page.items.find((i) => i.alertId === alertId)?.actionUrl;
    };
    expect(await urlFor(u.teacher, UserRole.TEACHER)).toBe(`/communications/notices/${id}`);
    expect(await urlFor(u.other, UserRole.PARENT)).toBe(`/portal/notices/${id}`);

    // Multi-role: the alert row is personal (role NULL), so it shows in every role the user
    // holds. The link follows the active role, not which notice_recipients row they have.
    // A staff recipient reading in a guardian role opens the portal page...
    expect(await urlFor(u.teacher, UserRole.PARENT)).toBe(`/portal/notices/${id}`);
    // ...and a guardian recipient reading in a staff role opens the staff page.
    expect(await urlFor(u.other, UserRole.TEACHER)).toBe(`/communications/notices/${id}`);

    // hide (and snooze, same path) answer with the active role's link too.
    const [{ id: recipientId }] = await ds.query(
      `SELECT id FROM alert_recipients WHERE alert_id = $1 AND user_id = $2`,
      [alertId, u.teacher],
    );
    const hidden = await q.hide(SEED_TENANT_ID, u.teacher, recipientId, 'en', UserRole.PARENT);
    expect(hidden.actionUrl).toBe(`/portal/notices/${id}`);
  });

  it('expires_at is the end of the expiry day in the school timezone', async () => {
    const id = await mkNotice();
    const alertId = await inTx((em) =>
      service.raiseImportant(em, input(id, '2030-01-10'), [{ userId: u.teacher }]),
    );
    const [a] = await ds.query(`SELECT expires_at FROM alerts WHERE id = $1`, [alertId]);
    // Dhaka is UTC+6: midnight starting 11 Jan local = 18:00 UTC on 10 Jan
    expect(new Date(a.expires_at).toISOString()).toBe('2030-01-10T18:00:00.000Z');
  });

  it('acknowledge resolves the alert row and stamps both tables, and is idempotent', async () => {
    const id = await mkNotice();
    await ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id) VALUES ($1,$2,'STAFF',$3)`,
      [SEED_TENANT_ID, id, u.teacher],
    );
    const alertId = await inTx((em) =>
      service.raiseImportant(em, input(id), [{ userId: u.teacher }, { userId: u.office }]),
    );
    await inTx((em) => service.acknowledge(em, SEED_TENANT_ID, id, u.teacher));
    const first = await ds.query(
      `SELECT acknowledged_at, seen_at FROM notice_recipients WHERE notice_id = $1`,
      [id],
    );
    expect(first[0].acknowledged_at).not.toBeNull();
    expect(first[0].seen_at).not.toBeNull();
    const byUser = Object.fromEntries(
      (await recipients(alertId)).map((r: any) => [r.user_id, r.state]),
    );
    expect(byUser[u.teacher]).toBe('RESOLVED');
    expect(byUser[u.office]).toBe('OPEN'); // someone else's row is untouched

    await inTx((em) => service.acknowledge(em, SEED_TENANT_ID, id, u.teacher));
    const second = await ds.query(
      `SELECT acknowledged_at FROM notice_recipients WHERE notice_id = $1`,
      [id],
    );
    expect(second[0].acknowledged_at).toEqual(first[0].acknowledged_at); // not re-stamped
  });

  it('acknowledge is atomic: a failure after it leaves neither table changed', async () => {
    const id = await mkNotice();
    await ds.query(
      `INSERT INTO notice_recipients (tenant_id, notice_id, kind, user_id) VALUES ($1,$2,'STAFF',$3)`,
      [SEED_TENANT_ID, id, u.teacher],
    );
    const alertId = await inTx((em) =>
      service.raiseImportant(em, input(id), [{ userId: u.teacher }]),
    );
    await expect(
      inTx(async (em) => {
        await service.acknowledge(em, SEED_TENANT_ID, id, u.teacher);
        throw new Error('forced');
      }),
    ).rejects.toThrow('forced');
    expect((await recipients(alertId))[0].state).toBe('OPEN');
    const [n] = await ds.query(
      `SELECT acknowledged_at FROM notice_recipients WHERE notice_id = $1`,
      [id],
    );
    expect(n.acknowledged_at).toBeNull();
  });

  it('acknowledge in tenant B cannot touch tenant A rows', async () => {
    const id = await mkNotice();
    const alertId = await inTx((em) =>
      service.raiseImportant(em, input(id), [{ userId: u.teacher }]),
    );
    await inTx((em) => service.acknowledge(em, tenantB, id, u.teacher));
    expect((await recipients(alertId))[0].state).toBe('OPEN');
  });

  it('withdraw stops the alert showing and closes recipients', async () => {
    const id = await mkNotice();
    const alertId = await inTx((em) =>
      service.raiseImportant(em, input(id), [{ userId: u.teacher }]),
    );
    expect(await showing(u.teacher, alertId)).toBe(true);
    await inTx((em) => service.withdraw(em, SEED_TENANT_ID, alertId));
    expect(await showing(u.teacher, alertId)).toBe(false);
    const [a] = await ds.query(`SELECT status FROM alerts WHERE id = $1`, [alertId]);
    expect(a.status).toBe('WITHDRAWN');
    expect((await recipients(alertId))[0].state).toBe('EXPIRED');
  });

  it('a notice alert renders its own title and body in the attention list', () => {
    // renderAlert only needs the registry; a NOTICE row must show manual_title, not the rule key
    const q = new AttentionQueryService(
      ds,
      { get: () => undefined } as any,
      ...([{}, {}, {}, {}, {}, {}] as [any, any, any, any, any, any]),
    );
    const text = q.renderAlert(
      {
        rule_key: 'notice.important',
        source: 'NOTICE',
        manual_title: 'Closed',
        manual_body: 'Rain',
      } as any,
      'en' as any,
    );
    expect(text).toMatchObject({ title: 'Closed', why: 'Rain' });
  });

  it('re-raising updates title, expiry and recipients on the same alert', async () => {
    const id = await mkNotice();
    const first = await inTx((em) => service.raiseImportant(em, input(id), [{ userId: u.admin }]));
    const again = await inTx((em) =>
      service.raiseImportant(em, { ...input(id, '2030-01-10'), title: 'Edited' }, [
        { userId: u.admin },
        { userId: u.teacher },
      ]),
    );
    expect(again).toBe(first);
    const [a] = await ds.query(`SELECT manual_title, expires_at FROM alerts WHERE id = $1`, [
      first,
    ]);
    expect(a.manual_title).toBe('Edited');
    expect(a.expires_at).not.toBeNull();
    expect(await recipients(first)).toHaveLength(2);
  });

  it('withdraw and closeTask ignore alerts that are not notice alerts', async () => {
    const [{ id: manualId }] = await ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, dedupe_key, params, escalation_level, raised_at, last_evaluated_at)
       VALUES ($1, 'manual.test', 'MANUAL', 'REMINDER', 'MANUAL', 'k-' || gen_random_uuid()::text, '{}'::jsonb, 0, now(), now()) RETURNING id`,
      [SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id) VALUES ($1,$2,$3)`,
      [SEED_TENANT_ID, manualId, u.admin],
    );
    await inTx((em) => service.withdraw(em, SEED_TENANT_ID, manualId));
    await inTx((em) => service.closeTask(em, SEED_TENANT_ID, manualId));
    expect(await showing(u.admin, manualId)).toBe(true);
  });

  it('withdraw from another tenant does nothing', async () => {
    const id = await mkNotice();
    const alertId = await inTx((em) =>
      service.raiseImportant(em, input(id), [{ userId: u.teacher }]),
    );
    await inTx((em) => service.withdraw(em, tenantB, alertId));
    expect(await showing(u.teacher, alertId)).toBe(true);
  });

  it('SMS task reaches ADMIN and EXECUTIVE only; closeTask stops it showing', async () => {
    const id = await mkNotice();
    const alertId = await inTx((em) => service.raiseSmsApprovalTask(em, input(id)));
    const ids = (await recipients(alertId)).map((r: any) => r.user_id);
    expect(ids).toEqual(expect.arrayContaining([u.admin, u.exec]));
    for (const never of [u.office, u.teacher, u.other, u.bAdmin, u.inactive])
      expect(ids).not.toContain(never); // wrong role, other tenant, or inactive user
    // every recipient (seeded admins included) is an ADMIN/EXECUTIVE of this tenant
    const bad = await ds.query(
      `SELECT 1 FROM alert_recipients r LEFT JOIN user_tenants ut
         ON ut.user_id = r.user_id AND ut.tenant_id = $2 AND ut.role::text IN ('ADMIN','EXECUTIVE')
        WHERE r.alert_id = $1 AND ut.user_id IS NULL`,
      [alertId, SEED_TENANT_ID],
    );
    expect(bad).toHaveLength(0);
    const [a] = await ds.query(`SELECT severity, action_url, rule_key FROM alerts WHERE id = $1`, [
      alertId,
    ]);
    expect(a).toMatchObject({
      severity: 'REMINDER',
      rule_key: 'notice.sms-approval',
      action_url: `/communications/notices/${id}?sms=1`,
    });
    expect(await showing(u.admin, alertId)).toBe(true);
    await inTx((em) => service.closeTask(em, SEED_TENANT_ID, alertId));
    expect(await showing(u.admin, alertId)).toBe(false);
    const [c] = await ds.query(`SELECT status FROM alerts WHERE id = $1`, [alertId]);
    expect(c.status).toBe('RESOLVED');
  });

  it('tenant B users never get a row from a tenant A notice', async () => {
    const id = await mkNotice();
    const important = await inTx((em) =>
      service.raiseImportant(em, input(id), [{ userId: u.teacher }]),
    );
    const task = await inTx((em) => service.raiseSmsApprovalTask(em, input(id)));
    for (const alertId of [important, task])
      expect((await recipients(alertId)).map((r: any) => r.user_id)).not.toContain(u.bAdmin);
  });

  it('notice alerts do not count towards the manual daily cap', async () => {
    const id = await mkNotice();
    await inTx((em) => service.raiseImportant(em, input(id), [{ userId: u.teacher }]));
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM alerts WHERE tenant_id = $1 AND source = 'MANUAL' AND manual_title = 'Closed tomorrow'`,
      [SEED_TENANT_ID],
    );
    expect(n).toBe(0); // the cap query counts source = 'MANUAL' only
  });
});

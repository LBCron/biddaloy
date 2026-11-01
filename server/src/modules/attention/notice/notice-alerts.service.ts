import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Permission, UserRole, roleHasPermission } from '@biddaloy/shared';
import { lockRule, run } from '../engine/alert-writer.service';
import { RuleContextService, endOfLocalDay } from '../rules/rule-context.service';

export interface NoticeAlertInput {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  /** ISO date (school-local); the alert ends with that day. Null = no expiry. */
  expiresOn: string | null;
}

export interface NoticeAlertRecipient {
  /** Recipients without a login (null) get no alert row. */
  userId: string | null;
  /** Student / guardian: opens the portal page instead of the staff one. */
  portal?: boolean;
}

const IMPORTANT = 'notice.important';
const SMS_TASK = 'notice.sms-approval';

/**
 * [53.2.03] Alert rows for important notices and the SMS-approval task (D11, D18, D23, D24).
 * Everything runs on the caller's transaction so publish is atomic. The manual-alert
 * 20/day and 30-day caps do not apply: rows are `source = 'NOTICE'`, which the cap query ignores.
 */
@Injectable()
export class NoticeAlertsService {
  constructor(private readonly ruleContext: RuleContextService) {}

  async raiseImportant(
    tx: EntityManager,
    notice: NoticeAlertInput,
    recipients: NoticeAlertRecipient[],
  ): Promise<string> {
    const withLogin = recipients.filter((r): r is NoticeAlertRecipient & { userId: string } =>
      Boolean(r.userId),
    );
    // one alert carries one URL: staff page unless nobody on the list is staff
    const portalOnly = withLogin.length > 0 && withLogin.every((r) => r.portal);
    const url = `${portalOnly ? '/portal' : '/communications'}/notices/${notice.id}`;
    let expiresAt: Date | null = null;
    if (notice.expiresOn) {
      const ctx = await this.ruleContext.build(notice.tenantId, new Date());
      expiresAt = endOfLocalDay(notice.expiresOn, ctx.tz);
    }
    return this.insert(tx, notice, {
      ruleKey: IMPORTANT,
      severity: 'WARNING',
      dedupeKey: `notice:${notice.id}`,
      actionUrl: url,
      expiresAt,
      userIds: withLogin.map((r) => r.userId),
    });
  }

  async withdraw(tx: EntityManager, tenantId: string, alertId: string): Promise<void> {
    await this.close(tx, tenantId, alertId, 'WITHDRAWN', 'EXPIRED');
  }

  async closeTask(tx: EntityManager, tenantId: string, alertId: string): Promise<void> {
    await this.close(tx, tenantId, alertId, 'RESOLVED', 'RESOLVED');
  }

  /** "পড়েছি": resolves the user's alert row and stamps every notice_recipients row of theirs. Idempotent. */
  async acknowledge(
    tx: EntityManager,
    tenantId: string,
    noticeId: string,
    userId: string,
  ): Promise<void> {
    await lockRule(tx, tenantId, IMPORTANT);
    await run(
      tx,
      `UPDATE alert_recipients r SET state = 'RESOLVED', resolved_at = now(), updated_at = now()
        FROM alerts a
        WHERE a.id = r.alert_id AND a.tenant_id = $1 AND r.tenant_id = $1
          AND a.rule_key = $4 AND a.subject_type = 'notice' AND a.subject_id = $2
          AND r.user_id = $3 AND r.state IN ('OPEN','HIDDEN')`,
      [tenantId, noticeId, userId, IMPORTANT],
    );
    await run(
      tx,
      `UPDATE notice_recipients
          SET acknowledged_at = COALESCE(acknowledged_at, now()), seen_at = COALESCE(seen_at, now())
        WHERE tenant_id = $1 AND notice_id = $2 AND user_id = $3`,
      [tenantId, noticeId, userId],
    );
  }

  /** One REMINDER for every ACTIVE ADMIN / EXECUTIVE of the tenant (whoever holds NOTICE_SMS_APPROVE). */
  async raiseSmsApprovalTask(tx: EntityManager, notice: NoticeAlertInput): Promise<string> {
    const roles = Object.values(UserRole).filter(
      (r) => r !== UserRole.SUPER_ADMIN && roleHasPermission(r, Permission.NOTICE_SMS_APPROVE),
    );
    const users = await run(
      tx,
      `SELECT DISTINCT ut.user_id FROM user_tenants ut
         JOIN users u ON u.id = ut.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        WHERE ut.tenant_id = $1 AND ut.deleted_at IS NULL AND ut.role::text = ANY($2::text[])`,
      [notice.tenantId, roles],
    );
    return this.insert(tx, notice, {
      ruleKey: SMS_TASK,
      severity: 'REMINDER',
      dedupeKey: `notice-sms:${notice.id}`,
      actionUrl: `/communications/notices/${notice.id}?sms=1`,
      expiresAt: null,
      userIds: users.map((r) => r.user_id),
    });
  }

  private async insert(
    tx: EntityManager,
    notice: NoticeAlertInput,
    a: {
      ruleKey: string;
      severity: string;
      dedupeKey: string;
      actionUrl: string;
      expiresAt: Date | null;
      userIds: string[];
    },
  ): Promise<string> {
    await lockRule(tx, notice.tenantId, a.ruleKey);
    const [alert] = await run(
      tx,
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, dedupe_key, subject_type, subject_id,
                           params, action_url, escalation_level, raised_at, last_evaluated_at, expires_at,
                           manual_title, manual_body)
       VALUES ($1,$2,'NOTICE',$3,'NOTICE',$4,'notice',$5,'{}'::jsonb,$6,0,now(),now(),$7,$8,$9)
       ON CONFLICT (tenant_id, rule_key, dedupe_key) WHERE status = 'ACTIVE'
       DO UPDATE SET manual_title = EXCLUDED.manual_title, manual_body = EXCLUDED.manual_body,
                     expires_at = EXCLUDED.expires_at, action_url = EXCLUDED.action_url, updated_at = now()
       RETURNING id`,
      [
        notice.tenantId,
        a.ruleKey,
        a.severity,
        a.dedupeKey,
        notice.id,
        a.actionUrl,
        a.expiresAt,
        notice.title,
        notice.body,
      ],
    );
    const userIds = [...new Set(a.userIds)];
    if (userIds.length)
      // role null = personal: shows in every role and shell, as manual alerts do (D15)
      await run(
        tx,
        `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, student_id)
         SELECT $1, $2, u, NULL, NULL FROM unnest($3::uuid[]) AS u
         ON CONFLICT (alert_id, user_id, student_id) DO NOTHING`,
        [notice.tenantId, alert.id, userIds],
      );
    return alert.id;
  }

  private async close(
    tx: EntityManager,
    tenantId: string,
    alertId: string,
    alertStatus: 'WITHDRAWN' | 'RESOLVED',
    recipientState: 'EXPIRED' | 'RESOLVED',
  ): Promise<void> {
    const [row] = await run(
      tx,
      `SELECT rule_key FROM alerts WHERE tenant_id = $1 AND id = $2 AND source = 'NOTICE'`,
      [tenantId, alertId],
    );
    if (!row) return; // not a notice alert: never touch RULE/MANUAL alerts
    await lockRule(tx, tenantId, row.rule_key);
    await run(
      tx,
      `UPDATE alerts SET status = $3, resolved_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND source = 'NOTICE' AND status = 'ACTIVE'`,
      [tenantId, alertId, alertStatus],
    );
    await run(
      tx,
      `UPDATE alert_recipients SET state = $3, resolved_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND alert_id = $2 AND state IN ('OPEN','HIDDEN')`,
      [tenantId, alertId, recipientState],
    );
  }
}

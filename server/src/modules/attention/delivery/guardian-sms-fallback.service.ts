import { randomUUID } from 'crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  ALERT_RULES,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  countSmsSegments,
} from '@biddaloy/shared';
import { COMMUNICATIONS_QUEUE } from '../../communications/communications.constants';
import { SmsCreditService } from '../../communications/credits/sms-credit.service';
import { CommunicationLog } from '../../communications/entities/communication-log.entity';
import { resolveReminderAudience } from '../../communications/reminder-recipients.util';
import { resolveAttendancePolicy } from '../../attendance/attendance-policy.util';
import { resolveTenantSettings } from '../../schools/settings/tenant-settings-resolver';
import { Guardian } from '../../students/entities/guardian.entity';
import { ATTENTION_SWEEP_DONE, attentionEvents } from '../attention.constants';
import { ATTENTION_RULE_LOCK_NAMESPACE } from '../engine/alert-writer.service';
import { RuleRegistryService } from '../rules/rule-registry.service';
import { localDateTimeToUtc, localTimeHHmm } from '../rules/rule-context.service';
import { localDate } from '../../attendance/attendance-policy.util';
import { render } from '../rules/messages';
import { isInQuietHours } from './alert-delivery.service';

const FALLBACK_RULES = ALERT_RULES.filter((r) => r.guardianSmsFallback).map((r) => r.key);
const STAFF_FALLBACK_RULES = ALERT_RULES.filter((r) => r.staffSmsFallback).map((r) => r.key);
const ABSENT_RULE = 'child.absent_today';
const PG_UNIQUE_VIOLATION = '23505';

/** Idempotency key of one fallback SMS: replays hit the (tenant_id, reference_key) unique index. */
export const fallbackReferenceKey = (alertId: string, guardianId: string) =>
  `attention:${alertId}:${guardianId}`;

/** [76.2.05] Idempotency key of one staff fallback SMS (a different prefix keeps the guardian daily cap clean). */
export const staffFallbackReferenceKey = (alertId: string, userId: string) =>
  `attention-staff:${alertId}:${userId}`;

/** Did an AUTOMATED absence-notice log from today already tell this guardian about this student? */
export function toldAboutStudent(
  logs: { guardian_id: string; student_id: string | null; metadata: any }[],
  guardianId: string,
  studentId: string,
): boolean {
  return logs.some(
    (l) =>
      l.guardian_id === guardianId &&
      (l.student_id === studentId ||
        (Array.isArray(l.metadata?.student_ids) && l.metadata.student_ids.includes(studentId))),
  );
}

interface SchoolRow {
  id: string;
  name: string;
  name_bn: string | null;
  settings: unknown;
}
interface AlertRow {
  id: string;
  rule_key: string;
  params: Record<string, string | number>;
  student_id: string | null;
}
interface GuardianRow {
  id: string;
  user_id: string | null;
  phone: string | null;
  full_name: string;
  notifications_enabled: boolean;
  is_primary_contact: boolean;
  student_id: string;
  has_push: boolean;
}

/**
 * [67.5.02] Guardian SMS fallback (D29). After every attention sweep, schools that opted in text
 * the guardians who cannot see the in-app alert (no login, or no push subscription) once per
 * alert. Credit is reserved before queueing; `reference_key` makes a replay a no-op.
 * Never touches the push path, and a failure here never fails a sweep (D12).
 */
@Injectable()
export class GuardianSmsFallbackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GuardianSmsFallbackService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(COMMUNICATIONS_QUEUE) private readonly queue: Queue,
    private readonly credits: SmsCreditService,
    private readonly registry: RuleRegistryService,
  ) {}

  private readonly onSweepDone = () => {
    void this.run(new Date()).catch((e) =>
      this.logger.error(`guardian sms fallback failed: ${String(e)}`),
    );
  };

  onModuleInit(): void {
    attentionEvents.on(ATTENTION_SWEEP_DONE, this.onSweepDone);
  }

  onModuleDestroy(): void {
    attentionEvents.off(ATTENTION_SWEEP_DONE, this.onSweepDone);
  }

  async run(now: Date): Promise<void> {
    // The setting defaults to off, so the raw JSON check is correct.
    const schools: SchoolRow[] = await this.dataSource.query(
      `SELECT id, name, name_bn, settings FROM schools
        WHERE status = 'ACTIVE'
          AND (settings->'attention'->>'guardianSmsFallback' = 'true'
            OR settings->'attention'->>'staffSmsFallback' = 'true')`,
    );
    for (const school of schools) {
      try {
        await this.withTenantLock(school.id, () => this.runTenant(school, now));
      } catch (e) {
        this.logger.error(`guardian sms fallback failed for tenant ${school.id}: ${String(e)}`);
      }
    }
  }

  /**
   * One run per tenant across every replica: a session advisory lock on a dedicated connection.
   * An overlapping run skips the tenant (the next sweep picks it up), so the daily cap and the
   * reservations are never computed twice at once.
   */
  private async withTenantLock(tenantId: string, fn: () => Promise<unknown>): Promise<void> {
    const key = [ATTENTION_RULE_LOCK_NAMESPACE, `${tenantId}:sms-fallback`];
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      const [{ ok }] = await qr.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', key);
      if (!ok) return;
      try {
        await fn();
      } finally {
        // only a dead connection fails this, and Postgres drops a dead session's locks
        await qr.query('SELECT pg_advisory_unlock($1, hashtext($2))', key);
      }
    } finally {
      await qr.release();
    }
  }

  async runTenant(school: SchoolRow, now: Date): Promise<number> {
    const settings = resolveTenantSettings(school.settings as any);
    return (
      (await this.runGuardians(school, settings, now)) +
      (await this.runStaff(school, settings, now))
    );
  }

  /** [76.2.05] D29: one SMS per CRITICAL staff-fallback alert to each ADMIN/EXECUTIVE recipient with a phone. Never guardians. */
  private async runStaff(
    school: SchoolRow,
    settings: ReturnType<typeof resolveTenantSettings>,
    now: Date,
  ): Promise<number> {
    const tenantId = school.id;
    const attention = settings.attention;
    if (!attention?.staffSmsFallback) return 0;
    if (!settings.communications?.sms?.provider) return 0;
    const tz = settings.region!.timezone;
    if (isInQuietHours(localTimeHHmm(now, tz), attention.quietHours)) return 0;
    const midnight = localDateTimeToUtc(localDate(now, tz), '00:00', tz);
    const rows: {
      id: string;
      rule_key: string;
      params: Record<string, string | number>;
      user_id: string;
      phone: string;
      full_name: string;
      sent: boolean;
    }[] = await this.dataSource.query(
      `SELECT a.id, a.rule_key, a.params, u.id AS user_id, u.phone, u.full_name,
              EXISTS (SELECT 1 FROM communication_logs l WHERE l.tenant_id = a.tenant_id
                 AND l.reference_key = 'attention-staff:' || a.id || ':' || u.id) AS sent
         FROM alerts a
         JOIN alert_recipients r ON r.alert_id = a.id AND r.tenant_id = a.tenant_id
              AND r.role IN ('ADMIN','EXECUTIVE')
         JOIN users u ON u.id = r.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
              AND NULLIF(btrim(u.phone), '') IS NOT NULL
        WHERE a.tenant_id = $1 AND a.status = 'ACTIVE' AND a.source = 'RULE'
          AND a.severity = 'CRITICAL' AND a.raised_at >= $2
          AND a.rule_key = ANY($3::text[])
        ORDER BY a.raised_at, a.id, u.id`,
      [tenantId, midnight, STAFF_FALLBACK_RULES],
    );
    const todo = rows.filter((r) => !r.sent);
    if (!todo.length) return 0;
    const metered = await this.credits.isMetered(tenantId);
    const schoolName = school.name_bn || school.name;
    let queued = 0;
    for (const r of todo) {
      const rule = this.registry.get(r.rule_key);
      if (!rule) continue;
      const text = `${schoolName}: ${render(rule.messages, 'bn', r.params).title}`;
      const segments = countSmsSegments(text).segments;
      const ref = randomUUID();
      const batchId = `attention:${r.id}:${ref}`;
      if (metered) {
        const reserved = await this.credits.reserve(tenantId, segments, `batch:${batchId}`, {
          type: 'batch',
          id: ref,
        });
        if (!reserved.ok) {
          this.logger.warn(
            `Not enough SMS credit for staff fallback of alert ${r.id} (${tenantId})`,
          );
          continue;
        }
      }
      try {
        if (await this.sendStaff(tenantId, r, text, metered ? { batchId, segments } : null))
          queued++;
      } catch (e) {
        this.logger.warn(`staff fallback sms failed for user ${r.user_id}: ${String(e)}`);
      }
    }
    return queued;
  }

  private async sendStaff(
    tenantId: string,
    r: { id: string; rule_key: string; user_id: string; phone: string; full_name: string },
    text: string,
    credit: { batchId: string; segments: number } | null,
  ): Promise<boolean> {
    const referenceKey = staffFallbackReferenceKey(r.id, r.user_id);
    const release = (partKey: string) =>
      credit
        ? this.credits
            .settlePart(tenantId, `batch:${credit.batchId}`, partKey, credit.segments, 'RELEASE')
            .catch((e) => this.logger.error(`sms credit release failed (${partKey}): ${String(e)}`))
        : undefined;
    const repo = this.dataSource.getRepository(CommunicationLog);
    let log: CommunicationLog;
    try {
      log = await repo.save(
        repo.create({
          tenant_id: tenantId,
          medium: CommunicationMedium.SMS,
          recipient_address: r.phone.trim(),
          recipient_name: r.full_name,
          message_body: text,
          subject: 'Alert',
          sent_by_user_id: null,
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.AUTOMATED,
          reference_key: referenceKey,
          metadata: { alert_id: r.id, rule_key: r.rule_key, staff_user_id: r.user_id },
        }),
      );
    } catch (e) {
      await release(`${referenceKey}:no-log`);
      if ((e as { driverError?: { code?: string } }).driverError?.code === PG_UNIQUE_VIOLATION)
        return false;
      throw e;
    }
    try {
      await this.queue.add('send', { logId: log.id, ...(credit ?? {}) });
    } catch (e) {
      await release(`log:${log.id}`);
      log.status = CommunicationStatus.FAILED;
      log.reference_key = null;
      log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
      await repo.save(log);
      throw e;
    }
    return true;
  }

  private async runGuardians(
    school: SchoolRow,
    settings: ReturnType<typeof resolveTenantSettings>,
    now: Date,
  ): Promise<number> {
    const tenantId = school.id;
    const attention = settings.attention;
    if (!attention?.guardianSmsFallback) return 0;
    if (!settings.communications?.sms?.provider) return 0;
    const tz = settings.region!.timezone;
    // Quiet hours defer for free: the next sweep outside them picks the same alerts up.
    if (isInQuietHours(localTimeHHmm(now, tz), attention.quietHours)) return 0;
    const midnight = localDateTimeToUtc(localDate(now, tz), '00:00', tz);
    const absenceNoticeOn = resolveAttendancePolicy(settings).autoAbsentNotification.enabled;

    const alerts: AlertRow[] = (
      (await this.dataSource.query(
        `SELECT a.id, a.rule_key, a.params,
                COALESCE(CASE WHEN a.subject_type = 'student' THEN a.subject_id END,
                         NULLIF(a.params->>'studentId', '')::uuid,
                         (SELECT r.student_id FROM alert_recipients r
                           WHERE r.alert_id = a.id AND r.tenant_id = a.tenant_id
                             AND r.role = 'PARENT' AND r.student_id IS NOT NULL
                           ORDER BY r.student_id LIMIT 1)) AS student_id
           FROM alerts a
          WHERE a.tenant_id = $1 AND a.status = 'ACTIVE' AND a.source = 'RULE'
            AND a.severity IN ('WARNING','CRITICAL') AND a.raised_at >= $2
            AND a.rule_key = ANY($3::text[])
          ORDER BY a.raised_at, a.id`,
        [tenantId, midnight, FALLBACK_RULES],
      )) as AlertRow[]
    ).filter(
      // The absence notice texts this guardian at cutoff the same day (D35).
      (a) => a.student_id && !(a.rule_key === ABSENT_RULE && absenceNoticeOn),
    );
    if (!alerts.length) return 0;

    const studentIds = [...new Set(alerts.map((a) => a.student_id!))];
    const guardianRows: GuardianRow[] = await this.dataSource.query(
      `SELECT g.id, g.user_id, g.phone, g.full_name, g.notifications_enabled, g.is_primary_contact,
              s.id AS student_id,
              (g.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM push_subscriptions p
                 WHERE p.user_id = g.user_id AND p.tenant_id = $1)) AS has_push
         FROM students s
         JOIN student_guardians sg ON sg.student_id = s.id
         JOIN guardians g ON g.id = sg.guardian_id AND g.tenant_id = $1 AND g.deleted_at IS NULL
        WHERE s.tenant_id = $1 AND s.id = ANY($2::uuid[])`,
      [tenantId, studentIds],
    );
    if (!guardianRows.length) return 0;
    const guardianIds = [...new Set(guardianRows.map((g) => g.id))];

    const [sentToday, told, existing] = await Promise.all([
      // SMS already sent by this engine today, per guardian (daily cap)
      this.dataSource.query(
        `SELECT guardian_id, count(*)::int AS n FROM communication_logs
          WHERE tenant_id = $1 AND guardian_id = ANY($2::uuid[]) AND reference_key LIKE 'attention:%'
            AND status <> 'FAILED' AND created_at >= $3 GROUP BY guardian_id`,
        [tenantId, guardianIds, midnight],
      ) as Promise<{ guardian_id: string; n: number }[]>,
      // D29: the absence notice already went to this guardian today, on any medium
      this.dataSource.query(
        `SELECT guardian_id, student_id, metadata FROM communication_logs
          WHERE tenant_id = $1 AND guardian_id = ANY($2::uuid[]) AND trigger = 'AUTOMATED'
            AND status <> 'FAILED' AND created_at >= $3 AND subject = 'Absence Notice'`,
        [tenantId, guardianIds, midnight],
      ) as Promise<{ guardian_id: string; student_id: string | null; metadata: any }[]>,
      this.dataSource.query(
        `SELECT reference_key FROM communication_logs
          WHERE tenant_id = $1 AND reference_key = ANY($2::text[])`,
        [
          tenantId,
          alerts.flatMap((a) =>
            guardianRows
              .filter((g) => g.student_id === a.student_id)
              .map((g) => fallbackReferenceKey(a.id, g.id)),
          ),
        ],
      ) as Promise<{ reference_key: string }[]>,
    ]);
    const cap = attention.guardianSmsDailyCap;
    const count = new Map(sentToday.map((r) => [r.guardian_id, r.n]));
    const done = new Set(existing.map((r) => r.reference_key));
    const metered = await this.credits.isMetered(tenantId);
    const schoolName = school.name_bn || school.name;
    let queued = 0;

    for (const alert of alerts) {
      const linked = guardianRows.filter((g) => g.student_id === alert.student_id);
      // Primary-or-everyone is chosen among guardians with a phone, so a primary contact without
      // one falls back to the others (as an opted-out primary does). Honours the opt-out.
      const { guardians } = resolveReminderAudience(
        linked.filter((g) => !!g.phone?.trim()) as unknown as Guardian[],
      );
      const targets = (guardians as unknown as GuardianRow[]).filter(
        (g) =>
          (!g.user_id || !g.has_push) &&
          !done.has(fallbackReferenceKey(alert.id, g.id)) &&
          (count.get(g.id) ?? 0) < cap &&
          !(alert.rule_key === ABSENT_RULE && toldAboutStudent(told, g.id, alert.student_id!)),
      );
      if (!targets.length) continue;

      const rule = this.registry.get(alert.rule_key);
      if (!rule) continue;
      const text = `${schoolName}: ${render(rule.messages, 'bn', alert.params).title}`;
      const segments = countSmsSegments(text).segments;
      // Fresh key AND reference_id per reservation: settlePart caps a settlement by summing every
      // DEBIT/RELEASE sharing the reference_id, so a second reservation for the same alert (a later
      // sweep, another replica) must not share one. The alert id stays in the log's metadata.
      const ref = randomUUID();
      const batchId = `attention:${alert.id}:${ref}`;
      if (metered) {
        const reserved = await this.credits.reserve(
          tenantId,
          segments * targets.length,
          `batch:${batchId}`,
          { type: 'batch', id: ref },
        );
        if (!reserved.ok) {
          this.logger.warn(`Not enough SMS credit for fallback of alert ${alert.id} (${tenantId})`);
          continue;
        }
      }
      for (const g of targets) {
        try {
          if (await this.send(tenantId, alert, g, text, metered ? { batchId, segments } : null)) {
            queued++;
            count.set(g.id, (count.get(g.id) ?? 0) + 1);
          }
        } catch (e) {
          this.logger.warn(`fallback sms failed for guardian ${g.id}: ${String(e)}`);
        }
      }
    }
    return queued;
  }

  /** Writes the AUTOMATED log + queues the job. Any share reserved but not used is released. */
  private async send(
    tenantId: string,
    alert: AlertRow,
    g: GuardianRow,
    text: string,
    credit: { batchId: string; segments: number } | null,
  ): Promise<boolean> {
    const referenceKey = fallbackReferenceKey(alert.id, g.id);
    const release = (partKey: string) =>
      credit
        ? this.credits
            .settlePart(tenantId, `batch:${credit.batchId}`, partKey, credit.segments, 'RELEASE')
            .catch((e) => this.logger.error(`sms credit release failed (${partKey}): ${String(e)}`))
        : undefined;
    const repo = this.dataSource.getRepository(CommunicationLog);
    let log: CommunicationLog;
    try {
      log = await repo.save(
        repo.create({
          tenant_id: tenantId,
          medium: CommunicationMedium.SMS,
          recipient_address: g.phone!.trim(),
          recipient_name: g.full_name,
          message_body: text,
          subject: 'Alert',
          student_id: alert.student_id,
          guardian_id: g.id,
          sent_by_user_id: null,
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.AUTOMATED,
          reference_key: referenceKey,
          metadata: { alert_id: alert.id, rule_key: alert.rule_key },
        }),
      );
    } catch (e) {
      await release(`${referenceKey}:no-log`);
      // a concurrent run (another replica) already holds this key: it sends, we do not
      if ((e as { driverError?: { code?: string } }).driverError?.code === PG_UNIQUE_VIOLATION)
        return false;
      throw e;
    }
    try {
      await this.queue.add('send', { logId: log.id, ...(credit ?? {}) });
    } catch (e) {
      // No job will ever exist for this log: free its share and close the row. Freeing the
      // reference_key lets the next sweep retry this guardian (and keeps it out of the daily cap).
      await release(`log:${log.id}`);
      log.status = CommunicationStatus.FAILED;
      log.reference_key = null;
      log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
      await repo.save(log);
      throw e;
    }
    if (g.user_id)
      await this.dataSource.query(
        `UPDATE alert_recipients SET sms_sent_at = now()
          WHERE tenant_id = $1 AND alert_id = $2 AND user_id = $3 AND sms_sent_at IS NULL`,
        [tenantId, alert.id, g.user_id],
      );
    return true;
  }
}

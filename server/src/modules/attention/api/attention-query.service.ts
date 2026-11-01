import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { AlertSeverity, AlertSource, UserRole, hasTenantDataScope } from '@biddaloy/shared';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { SchoolsService } from '../../schools/schools.service';
import { SchoolCalendarService } from '../../calendar/school-calendar.service';
import { TeacherScopeService } from '../../classes/teacher-scope.service';
import { ATTENTION_SUMMARY_TTL_SECONDS, attentionKeys } from '../attention.constants';
import { AlertWriterService, run } from '../engine/alert-writer.service';
import { RuleRegistryService } from '../rules/rule-registry.service';
import { RuleContextService, addDaysIso, localDateTimeToUtc } from '../rules/rule-context.service';
import { AttentionLocale, render, resolveLocale } from '../rules/messages';
import type { AlertItemDto, AlertItemsPageDto, StudentAlertDto } from './dto/alert-item.dto';
import type { AttentionSummaryDto } from './dto/alert-item.dto';
import type { ItemsQueryDto, SnoozeDto, SummaryQueryDto } from './dto/attention-query.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const SEVERITY_RANK = `CASE a.severity WHEN 'CRITICAL' THEN 2 WHEN 'WARNING' THEN 1 ELSE 0 END`;
const BY_SEVERITY = `${SEVERITY_RANK} DESC, a.raised_at ASC`;
const ITEM_FROM = `FROM alert_recipients r
  JOIN alerts a ON a.id = r.alert_id AND a.tenant_id = r.tenant_id
  LEFT JOIN users u ON u.id = a.resolved_by_user_id`;
const ITEM_COLS = `r.id AS recipient_id, r.alert_id, r.state, r.snoozed_until,
  COALESCE(r.resolved_at, a.resolved_at) AS resolved_at, u.full_name AS resolved_by_name,
  a.rule_key, a.source, a.severity, a.category, a.params, a.action_url, a.raised_at,
  a.expires_at, a.manual_title, a.manual_body, a.status AS alert_status`;
const iso = (d: Date | string) => new Date(d).toISOString();

interface CachedSummary {
  critical: number;
  warning: number;
  reminder: number;
  activeTotal: number;
  top: Row | null;
}

@Injectable()
export class AttentionQueryService {
  private readonly logger = new Logger(AttentionQueryService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: RuleRegistryService,
    private readonly context: RuleContextService,
    private readonly writer: AlertWriterService,
    private readonly calendar: SchoolCalendarService,
    private readonly teacherScope: TeacherScopeService,
    private readonly schools: SchoolsService,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
  ) {}

  /** Public: 67.1.08 (#2051) renders pushes with it. */
  renderAlert(
    row: Row,
    locale: AttentionLocale,
  ): { title: string; why: string; steps: string[]; actionLabel?: string } {
    const rule = this.registry.get(row.rule_key);
    if (rule) {
      const m = render(rule.messages, locale, row.params ?? {});
      return {
        title: m.title,
        why: m.why,
        steps: m.steps,
        ...(m.action !== undefined ? { actionLabel: m.action } : {}),
      };
    }
    if (row.source === AlertSource.MANUAL) {
      return { title: row.manual_title ?? row.rule_key, why: row.manual_body ?? '', steps: [] };
    }
    return { title: row.rule_key, why: '', steps: [] };
  }

  toItem(row: Row, locale: AttentionLocale): AlertItemDto {
    const params = row.params ?? {};
    const text = this.renderAlert(row, locale);
    return {
      recipientId: row.recipient_id,
      alertId: row.alert_id,
      ruleKey: row.rule_key,
      source: row.source,
      severity: row.severity,
      category: row.category,
      state: row.state,
      title: text.title,
      why: text.why,
      steps: text.steps,
      ...(text.actionLabel !== undefined ? { actionLabel: text.actionLabel } : {}),
      ...(row.action_url ? { actionUrl: row.action_url } : {}),
      closable: row.severity !== AlertSeverity.CRITICAL, // D4
      raisedAt: iso(row.raised_at),
      ...(row.expires_at ? { expiresAt: iso(row.expires_at) } : {}),
      ...(row.snoozed_until ? { snoozedUntil: iso(row.snoozed_until) } : {}),
      ...(params.studentName ? { studentName: String(params.studentName) } : {}),
      ...(params.sectionLabel ? { sectionLabel: String(params.sectionLabel) } : {}),
      ...(row.resolved_at ? { resolvedAt: iso(row.resolved_at) } : {}),
      ...(row.resolved_by_name ? { resolvedByName: row.resolved_by_name } : {}),
    };
  }

  private async localeFor(tenantId: string, requested?: AttentionLocale) {
    if (requested) return requested;
    const settings = await this.schools.getResolvedSettings(tenantId);
    return resolveLocale(settings.region?.locale);
  }

  /** A user can't read another role's bar (D15). */
  private assertOwnRole(activeRole: string, requested?: UserRole): string {
    const role = requested ?? activeRole;
    if (role !== activeRole) throw new ForbiddenException('Not your active role');
    return role;
  }

  async summary(
    tenantId: string,
    userId: string,
    activeRole: string,
    query: SummaryQueryDto,
  ): Promise<AttentionSummaryDto> {
    const role = this.assertOwnRole(activeRole, query.role);
    const key = attentionKeys.summary(tenantId, userId, role);

    let cached: CachedSummary | null = null;
    try {
      const raw = await this.redis.get(key);
      if (raw) cached = JSON.parse(raw) as CachedSummary;
    } catch (err) {
      this.logger.warn(`summary cache read failed: ${(err as Error).message}`);
    }
    if (!cached) {
      cached = await this.computeSummary(tenantId, userId, role);
      try {
        await this.redis.set(key, JSON.stringify(cached), 'EX', ATTENTION_SUMMARY_TTL_SECONDS);
      } catch (err) {
        this.logger.warn(`summary cache write failed: ${(err as Error).message}`);
      }
    }

    const { updatedAt, staleMinutes } = await this.freshness();
    return {
      critical: cached.critical,
      warning: cached.warning,
      reminder: cached.reminder,
      activeTotal: cached.activeTotal,
      // locale only when there is text to render: a cache hit with no top costs no settings read
      top: cached.top
        ? this.toItem(cached.top, await this.localeFor(tenantId, query.locale))
        : null,
      updatedAt,
      staleMinutes,
    };
  }

  private async computeSummary(
    tenantId: string,
    userId: string,
    role: string,
  ): Promise<CachedSummary> {
    const where = `r.tenant_id = $1 AND r.user_id = $2 AND (r.role = $3 OR r.role IS NULL)
      AND a.status = 'ACTIVE'`;
    const [open, [{ total }]] = await Promise.all([
      // ponytail: bar counts cap at 200 open rows; the bar only needs "many".
      this.dataSource.query(
        `SELECT ${ITEM_COLS} ${ITEM_FROM} WHERE ${where} AND r.state = 'OPEN'
         ORDER BY ${BY_SEVERITY} LIMIT 200`,
        [tenantId, userId, role],
      ),
      this.dataSource.query(
        `SELECT count(*)::int AS total FROM alert_recipients r
         JOIN alerts a ON a.id = r.alert_id AND a.tenant_id = r.tenant_id
         WHERE ${where} AND r.state IN ('OPEN','HIDDEN')`,
        [tenantId, userId, role],
      ),
    ]);
    const count = (s: AlertSeverity) => (open as Row[]).filter((x) => x.severity === s).length;
    return {
      critical: count(AlertSeverity.CRITICAL),
      warning: count(AlertSeverity.WARNING),
      reminder: count(AlertSeverity.REMINDER),
      activeTotal: total,
      top: (open as Row[])[0] ?? null,
    };
  }

  private async freshness(): Promise<{ updatedAt: string | null; staleMinutes: number }> {
    try {
      const raw = await this.redis.get(attentionKeys.heartbeat('FAST'));
      if (!raw) return { updatedAt: null, staleMinutes: 0 };
      const at = new Date((JSON.parse(raw) as { at: string }).at);
      return {
        updatedAt: at.toISOString(),
        staleMinutes: Math.max(0, Math.floor((Date.now() - at.getTime()) / 60_000)),
      };
    } catch (err) {
      this.logger.warn(`heartbeat read failed: ${(err as Error).message}`);
      return { updatedAt: null, staleMinutes: 0 };
    }
  }

  async items(
    tenantId: string,
    userId: string,
    activeRole: string,
    query: ItemsQueryDto,
  ): Promise<AlertItemsPageDto> {
    const role = this.assertOwnRole(activeRole, query.role);
    const locale = await this.localeFor(tenantId, query.locale);
    const params: unknown[] = [tenantId, userId, role];
    const arg = (v: unknown) => `$${params.push(v)}`;
    const history = query.tab === 'history';
    let where = `r.tenant_id = $1 AND r.user_id = $2 AND (r.role = $3 OR r.role IS NULL) AND ${
      history
        ? `r.state IN ('RESOLVED','EXPIRED')`
        : `r.state IN ('OPEN','HIDDEN') AND a.status = 'ACTIVE'`
    }`;
    if (query.category) where += ` AND a.category = ${arg(query.category)}`;
    if (query.sectionId) where += ` AND a.params->>'sectionId' = ${arg(query.sectionId)}`;
    if (query.studentId) {
      const s = arg(query.studentId);
      where += ` AND (r.student_id = ${s} OR (a.subject_type = 'student' AND a.subject_id = ${s}))`;
    }
    const order = history ? `COALESCE(r.resolved_at, r.updated_at) DESC` : BY_SEVERITY;
    const countParams = [...params];
    const page = `LIMIT ${arg(query.pageSize)} OFFSET ${arg((query.page - 1) * query.pageSize)}`;
    const [[{ total }], rows] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*)::int AS total FROM alert_recipients r
         JOIN alerts a ON a.id = r.alert_id AND a.tenant_id = r.tenant_id WHERE ${where}`,
        countParams,
      ),
      this.dataSource.query(
        `SELECT ${ITEM_COLS} ${ITEM_FROM} WHERE ${where} ORDER BY ${order}, r.id ${page}`,
        params,
      ) as Promise<Row[]>,
    ]);
    return { items: rows.map((r) => this.toItem(r, locale)), total };
  }

  /** 404 (never 403) for someone else's row: no existence leak. */
  private async loadOwn(tenantId: string, userId: string, recipientId: string): Promise<Row> {
    const [row] = await this.dataSource.query(
      `SELECT ${ITEM_COLS} ${ITEM_FROM} WHERE r.id = $1 AND r.tenant_id = $2 AND r.user_id = $3`,
      [recipientId, tenantId, userId],
    );
    if (!row) throw new NotFoundException('Alert not found');
    if (row.severity === AlertSeverity.CRITICAL) throw new BadRequestException('not closable'); // D4
    if ((row.state !== 'OPEN' && row.state !== 'HIDDEN') || row.alert_status !== 'ACTIVE') {
      throw new ConflictException('Alert is already closed');
    }
    return row;
  }

  private async setHidden(
    tenantId: string,
    userId: string,
    row: Row,
    now: Date,
    snoozedUntil: Date | null,
    locale: AttentionLocale,
  ): Promise<AlertItemDto> {
    const rows = await run(
      this.dataSource.manager,
      `UPDATE alert_recipients SET state = 'HIDDEN', hidden_at = $4, snoozed_until = $5, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND user_id = $3 AND state IN ('OPEN','HIDDEN')
       RETURNING id`,
      [row.recipient_id, tenantId, userId, now, snoozedUntil],
    );
    // 0 rows = resolver/expirer won the race
    if (!rows.length) throw new ConflictException('Alert is already closed');
    await this.writer.invalidateSummary(tenantId, [userId]);
    return this.toItem({ ...row, state: 'HIDDEN', snoozed_until: snoozedUntil }, locale);
  }

  async hide(
    tenantId: string,
    userId: string,
    recipientId: string,
    locale?: AttentionLocale,
  ): Promise<AlertItemDto> {
    const row = await this.loadOwn(tenantId, userId, recipientId);
    const loc = await this.localeFor(tenantId, locale);
    if (row.state === 'HIDDEN' && !row.snoozed_until) return this.toItem(row, loc); // idempotent
    return this.setHidden(tenantId, userId, row, new Date(), null, loc);
  }

  async snooze(
    tenantId: string,
    userId: string,
    recipientId: string,
    dto: SnoozeDto,
    now = new Date(),
    locale?: AttentionLocale,
  ): Promise<AlertItemDto> {
    const row = await this.loadOwn(tenantId, userId, recipientId);
    const loc = await this.localeFor(tenantId, locale);
    const ctx = await this.context.build(tenantId, now);
    const at = (date: string) => localDateTimeToUtc(date, ctx.settings.dailyAt, ctx.tz);

    let until: Date;
    switch (dto.choice) {
      case 'TWO_HOURS':
        until = new Date(now.getTime() + 2 * 3_600_000);
        break;
      case 'TOMORROW_MORNING':
        // after midnight but before dailyAt, "tomorrow morning" is this coming morning
        until = at(
          ctx.localTime < ctx.settings.dailyAt ? ctx.localDate : addDaysIso(ctx.localDate, 1),
        );
        break;
      case 'NEXT_SCHOOL_DAY': {
        let found: string | null = null;
        for (let i = 1; i <= 14 && !found; i++) {
          const date = addDaysIso(ctx.localDate, i);
          if (!(await this.calendar.isNonWorkingDay({ tenantId, date }))) found = date;
        }
        if (!found) throw new BadRequestException('No school day in the next 14 days');
        until = at(found);
        break;
      }
      default: {
        const date = dto.date ?? '';
        if (date <= ctx.localDate || date > addDaysIso(ctx.localDate, 30)) {
          throw new BadRequestException('date must be after today and within 30 days');
        }
        until = at(date);
      }
    }
    return this.setHidden(tenantId, userId, row, now, until, loc);
  }

  async markSeen(tenantId: string, userId: string, ids: string[]): Promise<{ updated: number }> {
    if (!ids.length) return { updated: 0 };
    const rows = await run(
      this.dataSource.manager,
      `UPDATE alert_recipients SET seen_at = now()
       WHERE tenant_id = $1 AND user_id = $2 AND id = ANY($3::uuid[]) AND seen_at IS NULL
       RETURNING id`,
      [tenantId, userId, ids],
    );
    return { updated: rows.length };
  }

  async studentAlerts(
    tenantId: string,
    caller: { userId: string; role: string },
    studentId: string,
    locale?: AttentionLocale,
  ): Promise<StudentAlertDto[]> {
    if (caller.role === UserRole.PARENT || caller.role === UserRole.STUDENT) {
      throw new ForbiddenException('Staff only');
    }
    const [student] = await this.dataSource.query(
      `SELECT id FROM students WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [studentId, tenantId],
    );
    if (!student) throw new NotFoundException('Student not found');

    // Epic 75 D2/D13: the shared current-year teacher scope, and a miss looks like a missing student.
    if (
      !hasTenantDataScope(caller.role) &&
      !(await this.teacherScope.canSeeStudent({
        userId: caller.userId,
        tenantId,
        studentId,
        includeCoordinated: true, // [83.3.1] D4 read
      }))
    ) {
      throw new NotFoundException('Student not found');
    }

    const loc = await this.localeFor(tenantId, locale);
    const rows: Row[] = await this.dataSource.query(
      `SELECT a.id AS alert_id, a.rule_key, a.source, a.severity, a.category, a.params,
              a.raised_at, a.manual_title, a.manual_body,
              count(r.id) FILTER (WHERE r.state IN ('OPEN','HIDDEN'))::int AS recipient_count,
              count(r.seen_at) FILTER (WHERE r.state IN ('OPEN','HIDDEN'))::int AS seen_count
       FROM alerts a
       LEFT JOIN alert_recipients r ON r.alert_id = a.id AND r.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 AND a.status = 'ACTIVE'
         AND ((a.subject_type = 'student' AND a.subject_id = $2)
              OR EXISTS (SELECT 1 FROM alert_recipients x
                         WHERE x.alert_id = a.id AND x.tenant_id = a.tenant_id AND x.student_id = $2))
       GROUP BY a.id
       ORDER BY ${BY_SEVERITY}`,
      [tenantId, studentId],
    );
    return rows.map((r) => {
      const text = this.renderAlert(r, loc);
      return {
        alertId: r.alert_id,
        ruleKey: r.rule_key,
        severity: r.severity,
        category: r.category,
        title: text.title,
        why: text.why,
        raisedAt: iso(r.raised_at),
        seenCount: r.seen_count,
        recipientCount: r.recipient_count,
      };
    });
  }
}

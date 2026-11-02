import { isDeepStrictEqual } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, EntityTarget, Repository, SelectQueryBuilder } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { ApprovalScope, AuditAction, AuditEntityType } from '@biddaloy/shared';
import { redactSensitiveFields } from './redact.util';
import { QueryAuditLogDto } from './dto/audit-log.dto';
import type { RecentActivityDto } from './dto/audit-dashboard.dto';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Exam } from '../exams/entities/exam.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { User } from '../users/entities/user.entity';
import { pagedRows } from '../reports/export/paged-rows';

/** Keys of either snapshot whose value differs (deep equality); a key on one side only counts. Same rule as the client's `changedFieldCount`. */
function countChangedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): number {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((k) => k in b !== k in a || !isDeepStrictEqual(b[k], a[k])).length;
}

export interface RecordAuditEntryInput {
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id?: string | null;
  tenant_id: string | null;
  performed_by_user_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * The single entry point for writing an audit row — no other module
   * should hold an `@InjectRepository(AuditLog)` of its own.
   *
   * Pass `manager` when this write must participate in an existing
   * transaction (e.g. payment-allocation's payment+audit write): a failure
   * then propagates and rolls back with the business operation, exactly
   * matching that call site's prior direct-repository behavior.
   *
   * Without a manager, this call is ancillary to an already-decided,
   * user-facing outcome (a login, a fee-structure edit, a reminder send) —
   * a transient DB error here must not turn a successful action into a
   * 500, so the failure is caught and logged instead of thrown, matching
   * auth.service.ts's pre-existing writeAuditLog behavior.
   */
  async record(entry: RecordAuditEntryInput, manager?: EntityManager): Promise<void> {
    if (manager) {
      const repo = manager.getRepository(AuditLog);
      const sanitized = {
        ...entry,
        old_values: entry.old_values ? redactSensitiveFields(entry.old_values) : null,
        new_values: entry.new_values ? redactSensitiveFields(entry.new_values) : null,
      };
      await repo.save(repo.create(sanitized));
      return;
    }

    // Redaction runs inside the try too — a malformed snapshot (e.g. a
    // circular structure) must fail open here exactly like a DB error
    // would, not bypass the fail-open guard below it.
    try {
      const sanitized = {
        ...entry,
        old_values: entry.old_values ? redactSensitiveFields(entry.old_values) : null,
        new_values: entry.new_values ? redactSensitiveFields(entry.new_values) : null,
      };
      await this.repo.save(this.repo.create(sanitized));
    } catch (error) {
      this.logger.error(
        `Failed to write ${entry.action} audit record: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Same write path as `record`, plus stamping who *approved* the action
   * and under which `ApprovalScope` — every money-affecting mutation
   * behind `@RequireApproval`/`ApprovalService.consume` (waves 3–7) uses
   * this instead of `record` so the approver never has to be smuggled
   * through `new_values` by each caller individually.
   *
   * Unlike `record`, this NEVER fails open, `manager` or not: the row it
   * writes is the proof a human authorized a money-affecting change, and
   * `record`'s no-manager fail-open behavior (log and swallow a transient
   * DB error) is right for ordinary audit but wrong for the one row that
   * exists specifically to prove someone signed off. A caller that gets a
   * rejection here must treat the underlying action as not-yet-audited
   * and react accordingly (retry the whole operation in a transaction,
   * surface an error) rather than proceed as if it were logged.
   */
  async recordApproved(
    entry: RecordAuditEntryInput & { approved_by_user_id: string; approval_scope: ApprovalScope },
    manager?: EntityManager,
  ): Promise<void> {
    const { approved_by_user_id, approval_scope, new_values, ...rest } = entry;
    const merged: RecordAuditEntryInput = {
      ...rest,
      new_values: {
        ...(new_values ?? {}),
        approved_by_user_id,
        approval_scope,
      },
    };
    const sanitized = {
      ...merged,
      old_values: merged.old_values ? redactSensitiveFields(merged.old_values) : null,
      new_values: merged.new_values ? redactSensitiveFields(merged.new_values) : null,
    };

    if (manager) {
      const repo = manager.getRepository(AuditLog);
      await repo.save(repo.create(sanitized));
      return;
    }
    // No manager: still don't swallow — see the fail-open note above.
    await this.repo.save(this.repo.create(sanitized));
  }

  /**
   * [8.15.11] Every audit row matching the list's own filters, as export rows.
   * Who, what and when only: the old/new value snapshots and IP address stay
   * on screen behind the diff panel and never leave in a file.
   */
  exportHeader(): string[] {
    return ['When', 'Who', 'Action', 'Entity type', 'Entity ID'];
  }

  iterateForExport(query: QueryAuditLogDto, tenantId: string, callerId?: string) {
    return pagedRows(
      (page, limit) => this.findAll({ ...query, page, limit }, tenantId, callerId),
      (log: AuditLog) => [
        log.created_at.toISOString(),
        log.performed_by?.full_name ?? 'System',
        log.action,
        log.entity_type,
        log.entity_id ?? '',
      ],
    );
  }

  async findAll(query: QueryAuditLogDto, tenantId: string, callerId?: string) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('audit_log')
      // [8.11.10]'s audit-trail screen shows a "Who" column, and a raw
      // `performed_by_user_id` UUID is not an answer to "who". Only the
      // two columns the DTO reads are selected — `leftJoinAndSelect` would
      // pull the whole `User` row (email, phone, password hash) into a
      // list response that has no business carrying it. `id` is selected
      // alongside `full_name` because TypeORM needs the relation's primary
      // key to hydrate `performed_by` as an object at all.
      // Must come *before* the join below, not after: TypeORM bakes
      // `performed_by.deleted_at IS NULL` into the join condition at the
      // moment `leftJoin` is called, reading this flag as it stands then
      // (`SelectQueryBuilder`'s own `join()`). Users are soft-deleted, so
      // without this a removed administrator's rows resolve no name and
      // render as "System" — destroying exactly the attribution an audit
      // trail exists to preserve. `AuditLog` itself has no `deleted_at`,
      // so widening the query cannot leak deleted audit rows.
      .withDeleted()
      .leftJoin('audit_log.performed_by', 'performed_by')
      .addSelect(['performed_by.id', 'performed_by.full_name'])
      .where('audit_log.tenant_id = :tenantId', { tenantId })
      .orderBy('audit_log.created_at', 'DESC');

    this.hideCallersAcr(qb, callerId);

    if (query.action) {
      qb.andWhere('audit_log.action = :action', { action: query.action });
    }
    if (query.entity_type) {
      qb.andWhere('audit_log.entity_type = :entityType', { entityType: query.entity_type });
    }
    if (query.performed_by_user_id) {
      qb.andWhere('audit_log.performed_by_user_id = :performedBy', {
        performedBy: query.performed_by_user_id,
      });
    }
    if (query.entity_id) {
      qb.andWhere('audit_log.entity_id = :entityId', { entityId: query.entity_id });
    }
    if (query.from_date) {
      qb.andWhere('audit_log.created_at >= :fromDate', { fromDate: query.from_date });
    }
    if (query.to_date) {
      // A date-only value (no time component) must include the whole day —
      // otherwise Postgres casts it to that day's midnight and every row
      // from the day itself is excluded from what's meant to be an
      // inclusive range end.
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(query.to_date);
      const toDate = new Date(query.to_date);
      if (isDateOnly) {
        toDate.setUTCHours(23, 59, 59, 999);
      }
      qb.andWhere('audit_log.created_at <= :toDate', { toDate });
    }

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();
    const entityLabels = await this.resolveEntityLabels(data, tenantId);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit), entityLabels };
  }

  /**
   * [8.10.7.3.18] "Recent activity" widget: the newest rows of `findAll` (so the same
   * tenant filter, caller-ACR hiding and label resolution as the audit page), cut down to
   * what one sentence needs. Never returns the raw old/new JSON, ip or user agent.
   */
  async findRecentForDashboard(
    tenantId: string,
    callerId: string,
    limit = 8,
  ): Promise<RecentActivityDto> {
    const { data, entityLabels } = await this.findAll(
      { page: 1, limit } as QueryAuditLogDto,
      tenantId,
      callerId,
    );
    return {
      items: data.map((log) => ({
        id: log.id,
        action: log.action,
        entity_type: log.entity_type,
        entity_label: entityLabels.get(`${log.entity_type}:${log.entity_id}`) ?? null,
        performed_by_name: log.performed_by?.full_name ?? null,
        created_at: log.created_at.toISOString(),
        changed_field_count:
          log.action === AuditAction.UPDATE
            ? countChangedFields(log.old_values, log.new_values)
            : null,
      })),
    };
  }

  /**
   * [31.3.7a] Display names for the page's audited records, keyed
   * `${entity_type}:${entity_id}`. Whitelisted types only (one small query
   * each); every query is tenant-scoped by hand and includes soft-deleted
   * records so a deleted student is still named. Unknown types get no entry.
   */
  private async resolveEntityLabels(
    rows: AuditLog[],
    tenantId: string,
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    const idsByType = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.entity_id) continue;
      const set = idsByType.get(r.entity_type) ?? new Set<string>();
      set.add(r.entity_id);
      idsByType.set(r.entity_type, set);
    }

    await Promise.all(
      [...idsByType].map(async ([type, idSet]) => {
        const qb = this.labelQuery(type, [...idSet], tenantId);
        if (!qb) return;
        const found: { id: string; label: string | null }[] = await qb.getRawMany();
        for (const f of found) {
          if (f.label) labels.set(`${type}:${f.id}`, f.label);
        }
      }),
    );
    return labels;
  }

  private labelQuery(type: string, ids: string[], tenantId: string) {
    const base = (entity: EntityTarget<object>, label: string) =>
      this.repo.manager
        .createQueryBuilder(entity, 'e')
        .withDeleted()
        .select('e.id', 'id')
        .addSelect(label, 'label')
        .where('e.id IN (:...ids)', { ids });
    const scoped = (entity: EntityTarget<object>, label: string) =>
      base(entity, label).andWhere('e.tenant_id = :tenantId', { tenantId });

    switch (type) {
      case 'Student':
        return scoped(Student, 'e.full_name');
      case 'Guardian':
        return scoped(Guardian, 'e.full_name');
      case 'Class':
        return scoped(Class, 'e.name');
      case 'ClassSection':
        // The class is tenant-scoped too, so a cross-tenant link never leaks its name.
        return scoped(ClassSection, "c.name || ' – ' || e.section_name").leftJoin(
          'e.class',
          'c',
          'c.tenant_id = :tenantId',
          { tenantId },
        );
      case 'Exam':
        return scoped(Exam, 'e.name');
      case 'FeeStructure':
        return scoped(FeeStructure, 'e.name');
      case 'Invoice':
        // no tenant_id column — scope through the student
        return base(Invoice, 'e.invoice_number')
          .innerJoin('e.student', 's')
          .andWhere('s.tenant_id = :tenantId', { tenantId });
      case 'User':
        // global table — only users who belong to this tenant
        return base(User, 'e.full_name').andWhere(
          'EXISTS (SELECT 1 FROM user_tenants ut WHERE ut.user_id = e.id AND ut.tenant_id = :tenantId)',
          { tenantId },
        );
      default:
        return null;
    }
  }

  /**
   * A narrower, separately-authorized sibling of `findAll` — scoped to one
   * entity (e.g. a single student's activity tab) rather than the tenant's
   * whole audit trail, so it can be granted to roles (ACCOUNTANT, EXECUTIVE,
   * TEACHER) that must never see `findAll`'s unscoped dump. The boundary
   * is the permission each `AuditController` route requires:
   * `AUDIT_LOG_READ` (ADMIN only) for `findAll` vs
   * `AUDIT_ENTITY_HISTORY_READ` for this one, per `ROLE_PERMISSIONS`.
   */
  async findByEntity(
    entityType: string,
    entityId: string,
    query: QueryAuditLogDto,
    tenantId: string,
    callerId?: string,
  ) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const qb = this.repo
      .createQueryBuilder('audit_log')
      .where('audit_log.tenant_id = :tenantId', { tenantId })
      .andWhere('audit_log.entity_type = :entityType', { entityType })
      .andWhere('audit_log.entity_id = :entityId', { entityId })
      .orderBy('audit_log.created_at', 'DESC');

    this.hideCallersAcr(qb, callerId);

    if (query.action) {
      qb.andWhere('audit_log.action = :action', { action: query.action });
    }
    if (query.from_date) {
      qb.andWhere('audit_log.created_at >= :fromDate', { fromDate: query.from_date });
    }
    if (query.to_date) {
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(query.to_date);
      const toDate = new Date(query.to_date);
      if (isDateOnly) {
        toDate.setUTCHours(23, 59, 59, 999);
      }
      qb.andWhere('audit_log.created_at <= :toDate', { toDate });
    }

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * [28.0] ACR privacy (D2): the subject must never see audit rows about their
   * own ACR — the row's existence/timing is itself the leak. AcrFormVersion has
   * no subject, so only AcrAssessment rows are filtered.
   */
  private hideCallersAcr(qb: SelectQueryBuilder<AuditLog>, callerId?: string) {
    if (!callerId) return;
    qb.andWhere(
      `NOT (audit_log.entity_type = 'AcrAssessment' AND EXISTS (
        SELECT 1 FROM acr_assessments acr
        WHERE acr.id::text = audit_log.entity_id::text
          AND acr.tenant_id = audit_log.tenant_id
          AND acr.user_id = :acrCallerId))`,
      { acrCallerId: callerId },
    );
    // [GAP-11] Same rule for incident audit rows (create and withdraw): the
    // subject must not learn an incident about them exists.
    qb.andWhere(
      `NOT (audit_log.entity_type = 'StaffIncident' AND EXISTS (
        SELECT 1 FROM staff_incidents si
        WHERE si.id::text = audit_log.entity_id::text
          AND si.tenant_id = audit_log.tenant_id
          AND si.staff_user_id = :acrCallerId))`,
    );
  }
}

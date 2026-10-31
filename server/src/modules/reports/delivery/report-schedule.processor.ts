import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import {
  CommunicationMedium,
  Permission,
  ReportDefinitionStatus,
  ReportRunKind,
  ReportRunStatus,
  UserRole,
  UserStatus,
  roleHasPermission,
} from '@biddaloy/shared';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { resolveAppBaseUrl } from '../../account-access/app-base-url.util';
import { CommunicationsService } from '../../communications/communications.service';
import { SchoolsService } from '../../schools/schools.service';
import { TenantStatusService } from '../../schools/tenant-status.service';
import { DEFINITION_SOURCE } from '../engine/runner/definition-row-source';
import { ReportDefinition } from '../entities/report-definition.entity';
import { ReportRun } from '../entities/report-run.entity';
import { ReportSchedule } from '../entities/report-schedule.entity';
import { ReportExportProcessor } from '../export/report-export.processor';
import { ReportRunLogService } from '../export/report-run-log.service';
import {
  REPORT_SCHEDULE_QUEUE,
  ReportSchedulesService,
  roleMayDownloadReports,
  roleMaySeeDefinition,
  type ReportScheduleJobData,
} from './report-schedules.service';

/** Most people one fire writes a file for. A school has far fewer staff than this. */
export const MAX_RECIPIENTS_PER_FIRE = 50;

export type FireOutcome =
  | { status: 'SENT'; sent: number; failed: number; skippedRoles: string[] }
  | { status: 'GONE' | 'SKIPPED' | 'DISABLED'; reason: string };

/**
 * [8.15.44] Fires one schedule (Epic 8.15 D5, D15). For each person holding a recipient role it
 * makes THEIR OWN run (so the file is built with their role's rows and fields, and only they can
 * download it) and emails them a link. The email carries the report name, the link and the expiry:
 * never a row, a name or an amount, and never an attachment.
 *
 * "Runs as its creator's role" is a ceiling: the creator must still be an active member of the
 * school with a role that may design reports. If not, the schedule switches itself off. Recipients
 * can never get more than the creator's role sees, because only design roles (ADMIN) hold all fields.
 */
@Injectable()
@Processor(REPORT_SCHEDULE_QUEUE, { concurrency: 1 })
export class ReportScheduleProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ReportScheduleProcessor.name);

  constructor(
    @InjectRepository(ReportSchedule) private readonly schedules: Repository<ReportSchedule>,
    @InjectRepository(ReportDefinition) private readonly definitions: Repository<ReportDefinition>,
    @InjectRepository(ReportRun) private readonly runs: Repository<ReportRun>,
    @InjectRepository(UserTenant) private readonly members: Repository<UserTenant>,
    private readonly service: ReportSchedulesService,
    private readonly exporter: ReportExportProcessor,
    private readonly runLog: ReportRunLogService,
    private readonly communications: CommunicationsService,
    private readonly schools: SchoolsService,
    private readonly tenantStatus: TenantStatusService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Redis being briefly unavailable at boot must not stop the server from starting.
    try {
      await this.service.reconcile();
    } catch (err) {
      this.logger.error(
        `Could not sync report schedules: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async process(job: Job<ReportScheduleJobData>): Promise<FireOutcome> {
    return this.fire(job.data.scheduleId, job.data.tenantId);
  }

  /** One fire. Exposed so a spec can run it without a clock. */
  async fire(scheduleId: string, tenantId: string): Promise<FireOutcome> {
    // The tenant is part of the lookup: a job can never touch another school's schedule.
    const schedule = await this.schedules.findOne({
      where: { id: scheduleId, tenant_id: tenantId },
    });
    if (!schedule || !schedule.active) {
      await this.service.unregister(scheduleId).catch(() => undefined);
      return { status: 'GONE', reason: 'no active schedule' };
    }

    // A suspended school or a restore in progress: do nothing, try again next time.
    if (
      !(await this.tenantStatus.isActive(tenantId)) ||
      (await this.tenantStatus.isRestoring(tenantId, { failClosed: true }))
    ) {
      return { status: 'SKIPPED', reason: 'school not available' };
    }

    const definition = await this.definitions.findOne({
      where: { id: schedule.definition_id, tenant_id: tenantId },
      withDeleted: true,
    });
    if (
      !definition ||
      definition.deleted_at ||
      definition.status === ReportDefinitionStatus.ARCHIVED ||
      !definition.current_version_id
    ) {
      await this.service.disable(tenantId, schedule.id);
      return { status: 'DISABLED', reason: 'report archived or removed' };
    }

    const creator = await this.creatorMember(tenantId, schedule.created_by);
    if (!creator) {
      await this.service.disable(tenantId, schedule.id);
      return { status: 'DISABLED', reason: 'creator no longer may design reports' };
    }

    const roles = schedule.recipient_roles.filter(
      (role) => roleMayDownloadReports(role) && roleMaySeeDefinition(definition, role, true),
    );
    const skippedRoles = schedule.recipient_roles.filter((role) => !roles.includes(role));
    const recipients = roles.length > 0 ? await this.recipients(tenantId, roles) : [];

    let sent = 0;
    let failed = 0;
    let lastRunId: string | null = null;
    for (const person of recipients) {
      const runId = await this.exportFor(schedule, definition, person);
      if (!runId) {
        failed++;
        continue;
      }
      lastRunId = runId;
      try {
        await this.email(schedule, definition, person, runId, creator.user_id);
        sent++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Schedule ${schedule.id}: email not queued: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    if (lastRunId) {
      await this.schedules.update(
        { id: schedule.id, tenant_id: tenantId },
        { last_run_id: lastRunId },
      );
    }
    return { status: 'SENT', sent, failed, skippedRoles };
  }

  /** The creator's membership, only while they are an active person with a role that designs reports. */
  private async creatorMember(tenantId: string, userId: string | null): Promise<UserTenant | null> {
    if (!userId) return null;
    const rows = await this.members
      .createQueryBuilder('ut')
      .innerJoinAndSelect('ut.user', 'u')
      .where('ut.tenant_id = :tenantId AND ut.user_id = :userId', { tenantId, userId })
      .andWhere('ut.deleted_at IS NULL AND u.deleted_at IS NULL AND u.status = :active', {
        active: UserStatus.ACTIVE,
      })
      .getMany();
    return rows.find((m) => roleHasPermission(m.role, Permission.REPORTS_DESIGN)) ?? null;
  }

  /** Active people of this school holding one of `roles`, one entry each (first role in the list wins). */
  private async recipients(tenantId: string, roles: string[]): Promise<UserTenant[]> {
    const rows = await this.members
      .createQueryBuilder('ut')
      .innerJoinAndSelect('ut.user', 'u')
      .where('ut.tenant_id = :tenantId AND ut.role IN (:...roles)', { tenantId, roles })
      .andWhere('ut.deleted_at IS NULL AND u.deleted_at IS NULL AND u.status = :active', {
        active: UserStatus.ACTIVE,
      })
      .andWhere('u.email IS NOT NULL')
      .orderBy('u.id', 'ASC')
      .take(MAX_RECIPIENTS_PER_FIRE * roles.length)
      .getMany();
    const byUser = new Map<string, UserTenant>();
    for (const row of rows) {
      const best = byUser.get(row.user_id);
      if (!best || roles.indexOf(row.role) < roles.indexOf(best.role)) byUser.set(row.user_id, row);
    }
    return [...byUser.values()].slice(0, MAX_RECIPIENTS_PER_FIRE);
  }

  /**
   * Writes this person's file with the same code a queued export uses. The run is theirs, built for
   * their role. Returns the run id only when the file is stored.
   */
  private async exportFor(
    schedule: ReportSchedule,
    definition: ReportDefinition,
    person: UserTenant,
  ): Promise<string | null> {
    const query = {
      versionId: definition.current_version_id as string,
      role: person.role as UserRole,
      params: schedule.params,
    };
    const run = await this.runLog.start({
      tenantId: schedule.tenant_id,
      userId: person.user_id,
      kind: ReportRunKind.SCHEDULED,
      status: ReportRunStatus.QUEUED,
      sourceKey: DEFINITION_SOURCE,
      definitionVersionId: query.versionId,
      format: schedule.format,
      params: query,
    });
    await this.exporter.process({
      data: {
        runId: run.id,
        tenantId: schedule.tenant_id,
        userId: person.user_id,
        source: DEFINITION_SOURCE,
        query,
        format: schedule.format,
      },
    } as Job);
    const done = await this.runs.findOne({ where: { id: run.id, tenant_id: schedule.tenant_id } });
    return done?.status === ReportRunStatus.DONE && done.storage_key ? done.id : null;
  }

  private async email(
    schedule: ReportSchedule,
    definition: ReportDefinition,
    person: UserTenant,
    runId: string,
    sentBy: string,
  ): Promise<void> {
    const link = `${resolveAppBaseUrl(this.config)}/reports/runs/${runId}`;
    await this.communications.enqueue(
      {
        medium: CommunicationMedium.EMAIL,
        recipient_address: person.user.email as string,
        recipient_name: person.user.full_name.slice(0, 100),
        subject: `${definition.name_bn} (${definition.name_en})`.slice(0, 200),
        message_body: [
          `আপনার নিয়মিত রিপোর্ট প্রস্তুত: ${definition.name_bn}`,
          `Your scheduled report is ready: ${definition.name_en}`,
          '',
          `Download: ${link}`,
          'The link works for 24 hours. Sign in to download.',
        ].join('\n'),
      },
      schedule.tenant_id,
      sentBy,
    );
  }
}

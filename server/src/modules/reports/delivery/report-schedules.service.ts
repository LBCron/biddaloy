import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, Repository } from 'typeorm';
import {
  AuditAction,
  Permission,
  ReportDefinitionStatus,
  ReportScheduleFrequency,
  UserRole,
  roleHasPermission,
} from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { SchoolsService } from '../../schools/schools.service';
import { DEFAULT_REGION_SETTINGS } from '../../schools/settings/tenant-settings-defaults';
import { ReportDefinition } from '../entities/report-definition.entity';
import { ReportSchedule } from '../entities/report-schedule.entity';
import type { CreateReportScheduleDto, UpdateReportScheduleDto } from './dto/report-delivery.dto';

export const REPORT_SCHEDULE_QUEUE = 'report-schedule';
export const REPORT_SCHEDULE_JOB = 'fire';
/** One BullMQ job scheduler per schedule: `report-schedule:<schedule id>`. */
export const SCHEDULER_PREFIX = 'report-schedule:';
/** How long registering a job waits for Redis before it gives up (a down Redis would otherwise hang). */
const REDIS_TIMEOUT_MS = 3_000;
/** A schedule's saved answers are a handful of values; refuse anything bigger. */
const MAX_PARAMS_JSON = 4_000;

export interface ReportScheduleJobData {
  scheduleId: string;
  tenantId: string;
}

export interface ScheduleViewer {
  tenantId: string;
  userId: string;
}

/** Roles that author reports see every report, whoever it was made for (same rule as the catalogue). */
export const SEES_ALL = new Set<string>([UserRole.ADMIN, UserRole.SUPER_ADMIN]);

/**
 * [8.15.44] The catalogue rule for one definition and one role: the role may open reports, and the
 * report is open to every role (`visible_roles` empty) or names this role. A deleted report is never
 * visible. Used before a schedule emails a link and every time a snapshot is read.
 * `needPublished` is true when the report is to be run (an archived report cannot run) and false for
 * reading a copy that was kept earlier.
 */
export function roleMaySeeDefinition(
  definition: Pick<ReportDefinition, 'status' | 'visible_roles' | 'deleted_at'>,
  role: string,
  needPublished: boolean,
): boolean {
  if (definition.deleted_at) return false;
  if (needPublished && definition.status !== ReportDefinitionStatus.PUBLISHED) return false;
  if (!roleHasPermission(role, Permission.REPORTS_VIEW)) return false;
  if (SEES_ALL.has(role)) return true;
  return definition.visible_roles.length === 0 || definition.visible_roles.includes(role);
}

/** Roles that may take a report file out of the system: they hold REPORTS_VIEW and REPORTS_EXPORT. */
export function roleMayDownloadReports(role: string): boolean {
  return (
    roleHasPermission(role, Permission.REPORTS_VIEW) &&
    roleHasPermission(role, Permission.REPORTS_EXPORT)
  );
}

/**
 * The cron pattern for a schedule. Built here from checked fields, never from client text. The
 * smallest step is one day, so a schedule can never fire more often than hourly.
 *   DAILY   08:30      -> "30 8 * * *"
 *   WEEKLY  Sun 08:30  -> "30 8 * * 0"
 *   MONTHLY 5th 08:30  -> "30 8 5 * *"
 */
export function cronFor(
  s: Pick<ReportSchedule, 'frequency' | 'day_of_week' | 'day_of_month' | 'local_time'>,
): string {
  const [hh, mm] = s.local_time.split(':').map(Number);
  if (s.frequency === ReportScheduleFrequency.WEEKLY) return `${mm} ${hh} * * ${s.day_of_week}`;
  if (s.frequency === ReportScheduleFrequency.MONTHLY) return `${mm} ${hh} ${s.day_of_month} * *`;
  return `${mm} ${hh} * * *`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * [8.15.44] The life of a report schedule (Epic 8.15 D15): create, change, switch off, delete, and the
 * BullMQ repeatable job that fires it in the school's own timezone. Every method takes the tenant;
 * a schedule id from another school is a plain 404. A schedule runs as the person who made it
 * (see `ReportScheduleProcessor`).
 */
@Injectable()
export class ReportSchedulesService {
  private readonly logger = new Logger(ReportSchedulesService.name);

  constructor(
    @InjectRepository(ReportSchedule) private readonly schedules: Repository<ReportSchedule>,
    @InjectRepository(ReportDefinition) private readonly definitions: Repository<ReportDefinition>,
    @InjectQueue(REPORT_SCHEDULE_QUEUE) private readonly queue: Queue<ReportScheduleJobData>,
    private readonly schools: SchoolsService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, definitionId: string): Promise<ReportSchedule[]> {
    await this.liveDefinition(tenantId, definitionId);
    return this.schedules.find({
      where: { tenant_id: tenantId, definition_id: definitionId },
      order: { created_at: 'ASC' },
      take: 100,
    });
  }

  async create(
    viewer: ScheduleViewer,
    definitionId: string,
    dto: CreateReportScheduleDto,
  ): Promise<ReportSchedule> {
    const definition = await this.liveDefinition(viewer.tenantId, definitionId);
    this.assertSchedulable(definition);
    const shape = this.checkShape(dto);
    const saved = await this.schedules.save(
      this.schedules.create({
        tenant_id: viewer.tenantId,
        definition_id: definition.id,
        ...shape,
        params: this.checkParams(dto.params),
        recipient_roles: [...new Set(dto.recipient_roles)],
        format: dto.format,
        active: true,
        last_run_id: null,
        created_by: viewer.userId,
      }),
    );
    try {
      await this.register(saved);
    } catch (error) {
      // No job means the schedule would never fire: undo, so a retry starts clean (fails closed).
      await this.schedules.delete({ id: saved.id, tenant_id: viewer.tenantId });
      this.logger.error(`Could not register schedule ${saved.id}: ${String(error)}`);
      throw new ServiceUnavailableException(
        'Scheduling is not available right now. Try again later.',
      );
    }
    await this.record(viewer, AuditAction.CREATE, saved);
    return saved;
  }

  async update(
    viewer: ScheduleViewer,
    definitionId: string,
    id: string,
    dto: UpdateReportScheduleDto,
  ): Promise<ReportSchedule> {
    const schedule = await this.find(viewer.tenantId, definitionId, id);
    const wasActive = schedule.active;
    const shape = this.checkShape({
      frequency: dto.frequency ?? schedule.frequency,
      day_of_week: dto.day_of_week ?? schedule.day_of_week ?? undefined,
      day_of_month: dto.day_of_month ?? schedule.day_of_month ?? undefined,
      local_time: dto.local_time ?? schedule.local_time,
    });
    Object.assign(schedule, shape);
    if (dto.params !== undefined) schedule.params = this.checkParams(dto.params);
    if (dto.recipient_roles) schedule.recipient_roles = [...new Set(dto.recipient_roles)];
    if (dto.format) schedule.format = dto.format;
    if (dto.active !== undefined) schedule.active = dto.active;
    if (schedule.active && !wasActive) {
      // Switching a schedule back on needs a report people can still run.
      this.assertSchedulable(await this.liveDefinition(viewer.tenantId, definitionId));
    }
    const saved = await this.schedules.save(schedule);
    try {
      if (saved.active) await this.register(saved);
      else await this.unregister(saved.id);
    } catch (error) {
      this.logger.error(`Could not update the job of schedule ${saved.id}: ${String(error)}`);
      throw new ServiceUnavailableException(
        'Scheduling is not available right now. Try again later.',
      );
    }
    await this.record(viewer, AuditAction.UPDATE, saved);
    return saved;
  }

  async remove(viewer: ScheduleViewer, definitionId: string, id: string): Promise<void> {
    const schedule = await this.find(viewer.tenantId, definitionId, id);
    await this.schedules.delete({ id: schedule.id, tenant_id: viewer.tenantId });
    await this.unregister(schedule.id).catch((error) =>
      // The job finds no row when it next fires and removes itself.
      this.logger.warn(`Could not remove the job of schedule ${id}: ${String(error)}`),
    );
    await this.record(viewer, AuditAction.DELETE, schedule);
  }

  /** Switches a schedule off and removes its job (an archived or lost report, a creator who lost rights). */
  async disable(tenantId: string, id: string): Promise<void> {
    await this.schedules.update({ id, tenant_id: tenantId }, { active: false });
    await this.unregister(id).catch((error) =>
      this.logger.warn(`Could not remove the job of schedule ${id}: ${String(error)}`),
    );
  }

  /** Creates or replaces the repeatable job: same id, so it is never doubled. */
  async register(schedule: ReportSchedule): Promise<void> {
    const tz = await this.timezoneOf(schedule.tenant_id);
    await withTimeout(
      this.queue.upsertJobScheduler(
        SCHEDULER_PREFIX + schedule.id,
        { pattern: cronFor(schedule), tz },
        {
          name: REPORT_SCHEDULE_JOB,
          data: { scheduleId: schedule.id, tenantId: schedule.tenant_id },
          opts: { removeOnComplete: true, removeOnFail: 20, attempts: 1 },
        },
      ),
      REDIS_TIMEOUT_MS,
    );
  }

  async unregister(id: string): Promise<void> {
    await withTimeout(this.queue.removeJobScheduler(SCHEDULER_PREFIX + id), REDIS_TIMEOUT_MS);
  }

  /**
   * At boot: make Redis match the table. Every active schedule gets its job (which also picks up a
   * changed school timezone); a job whose schedule is gone or off is removed. System work across
   * schools, so it reads without a tenant filter and writes only job entries.
   */
  async reconcile(): Promise<void> {
    const active = await this.schedules.find({ where: { active: true } });
    const wanted = new Set(active.map((s) => SCHEDULER_PREFIX + s.id));
    for (const schedule of active) {
      try {
        await this.register(schedule);
      } catch (error) {
        this.logger.error(`Could not register schedule ${schedule.id}: ${String(error)}`);
      }
    }
    const existing = await withTimeout(this.queue.getJobSchedulers(0, -1), REDIS_TIMEOUT_MS);
    for (const scheduler of existing) {
      const key = scheduler.key ?? scheduler.id;
      if (key && key.startsWith(SCHEDULER_PREFIX) && !wanted.has(key)) {
        await this.queue.removeJobScheduler(key).catch(() => undefined);
      }
    }
  }

  private async timezoneOf(tenantId: string): Promise<string> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    const tz = settings.region?.timezone ?? DEFAULT_REGION_SETTINGS.timezone;
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    } catch {
      return DEFAULT_REGION_SETTINGS.timezone;
    }
  }

  /** Same fixed sentence for every bad combination; the message never echoes what was sent. */
  private checkShape(input: {
    frequency: ReportScheduleFrequency;
    day_of_week?: number;
    day_of_month?: number;
    local_time: string;
  }) {
    const weekly = input.frequency === ReportScheduleFrequency.WEEKLY;
    const monthly = input.frequency === ReportScheduleFrequency.MONTHLY;
    if (
      (weekly && input.day_of_week === undefined) ||
      (monthly && input.day_of_month === undefined)
    ) {
      throw new BadRequestException(
        'A weekly schedule needs a day of the week and a monthly one needs a day of the month.',
      );
    }
    return {
      frequency: input.frequency,
      day_of_week: weekly ? (input.day_of_week as number) : null,
      day_of_month: monthly ? (input.day_of_month as number) : null,
      local_time: input.local_time,
    };
  }

  private checkParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
    const value = params ?? {};
    if (JSON.stringify(value).length > MAX_PARAMS_JSON) {
      throw new BadRequestException('The saved answers are too long.');
    }
    return value;
  }

  private assertSchedulable(definition: ReportDefinition): void {
    if (definition.status !== ReportDefinitionStatus.PUBLISHED || !definition.current_version_id) {
      throw new ConflictException('Only a published report can be sent on a schedule.');
    }
  }

  private async liveDefinition(tenantId: string, id: string): Promise<ReportDefinition> {
    const definition = await this.definitions.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!definition) throw new NotFoundException('Report not found');
    return definition;
  }

  private async find(tenantId: string, definitionId: string, id: string): Promise<ReportSchedule> {
    const schedule = await this.schedules.findOne({
      where: { id, tenant_id: tenantId, definition_id: definitionId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  private record(viewer: ScheduleViewer, action: AuditAction, s: ReportSchedule): Promise<void> {
    return this.audit.record({
      action,
      // `ReportSchedule` is not an audit entity type; the entry hangs on the report it belongs to.
      entity_type: 'ReportDefinition',
      entity_id: s.definition_id,
      tenant_id: viewer.tenantId,
      performed_by_user_id: viewer.userId,
      // Says what the schedule is, never any report data.
      new_values: {
        change: 'schedule',
        schedule_id: s.id,
        frequency: s.frequency,
        format: s.format,
        active: s.active,
        recipient_roles: s.recipient_roles,
      },
    });
  }
}

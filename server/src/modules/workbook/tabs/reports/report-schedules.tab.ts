import { IsNull, type EntityManager } from 'typeorm';
import { ExportFormat, ReportScheduleFrequency } from '@biddaloy/shared';
import { ReportSchedule } from '../../../reports/entities/report-schedule.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `report_schedules` tab ([8.15.12], Epic 8.15 D15): "email me this report every ...".
 * A schedule belongs to a report (the `report` ref column). `last_run_id` is not exported:
 * runs are derived output and are not in the workbook, so a restored schedule starts with
 * no last run and the delivery job fills it in.
 */
export interface ReportScheduleRow {
  id: string;
  definition_id: string;
  report_key: string;
  frequency: ReportScheduleFrequency;
  day_of_week: number | null;
  day_of_month: number | null;
  local_time: string;
  params: Record<string, unknown>;
  recipient_roles: string[];
  format: ExportFormat;
  active: boolean;
}

const label = (en: string, bn: string) => ({ en, bn });
const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: label('ID', 'আইডি') },
  {
    key: 'report',
    type: 'ref',
    ref: 'report_definitions',
    required: true,
    label: label('Report', 'রিপোর্ট'),
  },
  {
    key: 'frequency',
    type: 'enum',
    required: true,
    enumValues: Object.values(ReportScheduleFrequency),
    label: label('Frequency', 'কত দিন পর পর'),
  },
  { key: 'day_of_week', type: 'int', label: label('Day of week (0-6)', 'সপ্তাহের দিন (০-৬)') },
  { key: 'day_of_month', type: 'int', label: label('Day of month (1-31)', 'মাসের দিন (১-৩১)') },
  {
    key: 'local_time',
    type: 'string',
    required: true,
    label: label('Time (HH:MM)', 'সময় (HH:MM)'),
  },
  { key: 'params', type: 'json', required: true, label: label('Prompt answers', 'প্রশ্নের উত্তর') },
  {
    key: 'recipient_roles',
    type: 'json',
    required: true,
    label: label('Send to roles', 'যাদের পাঠানো হবে'),
  },
  {
    key: 'format',
    type: 'enum',
    required: true,
    enumValues: Object.values(ExportFormat),
    label: label('File format', 'ফাইলের ধরন'),
  },
  { key: 'active', type: 'bool', required: true, label: label('Active', 'চালু') },
];

const excluded: readonly string[] = [
  'definition_id', // exported instead as the `report` ref column
  'last_run_id', // runs are derived output; the delivery job sets it again
  'created_by', // audit "who created" field, not needed for restore fidelity
];

const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const scheduleKey = (
  reportKey: string,
  x: {
    frequency: string;
    day_of_week: number | null;
    day_of_month: number | null;
    local_time: string;
  },
) => `${reportKey}|${x.frequency}|${x.day_of_week ?? ''}|${x.day_of_month ?? ''}|${x.local_time}`;

export const reportSchedulesTab: TabSpec<ReportSchedule, ReportScheduleRow> = {
  name: 'report_schedules',
  entity: ReportSchedule,
  excluded,
  dependsOn: ['report_definitions'],
  columns,
  // The cells that identify a schedule: which report, how often, when.
  naturalKey: ['report', 'frequency', 'day_of_week', 'day_of_month', 'local_time'],
  // The table has no unique constraint: two schedules can differ only in params, format or recipients.
  allowDuplicateKeys: true,
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<ReportSchedule[]> {
    return m.find(ReportSchedule, {
      // Schedules of a soft-deleted report are absent from the report_definitions export.
      where: { tenant_id: tenantId, report_definition: { deleted_at: IsNull() } },
      relations: ['report_definition'],
    });
  },

  toRow(entity: ReportSchedule, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      report: ctx.keyOf('report_definitions', entity.definition_id),
      frequency: entity.frequency,
      day_of_week: entity.day_of_week,
      day_of_month: entity.day_of_month,
      local_time: entity.local_time,
      params: entity.params,
      recipient_roles: entity.recipient_roles,
      format: entity.format,
      active: entity.active,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ReportScheduleRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const v: Record<string, unknown> = {};
    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'report_schedules', rowNo);
      if ('error' in result) errors.push(result.error);
      else v[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const fail = (column: string, message: string): { errors: RowError[] } => ({
      errors: [{ tab: 'report_schedules', row: rowNo, column, message, severity: 'error' }],
    });
    const reportKey = v.report as string;
    const definitionId = ctx.ref('report_definitions', reportKey);
    if (!definitionId) {
      return fail('report', `Column "report": no report with the key "${reportKey}" was found.`);
    }
    if (!LOCAL_TIME.test(v.local_time as string)) {
      return fail('local_time', 'Column "local_time": expected a time like 08:30.');
    }
    const dow = v.day_of_week as number | null;
    const dom = v.day_of_month as number | null;
    if (dow !== null && (dow < 0 || dow > 6)) {
      return fail('day_of_week', 'Column "day_of_week": expected a number from 0 to 6.');
    }
    if (dom !== null && (dom < 1 || dom > 31)) {
      return fail('day_of_month', 'Column "day_of_month": expected a number from 1 to 31.');
    }
    const frequency = v.frequency as string;
    if (frequency === ReportScheduleFrequency.WEEKLY && (dow === null || dom !== null)) {
      return fail('day_of_week', 'A weekly schedule needs "day_of_week" and no "day_of_month".');
    }
    if (frequency === ReportScheduleFrequency.MONTHLY && (dom === null || dow !== null)) {
      return fail('day_of_month', 'A monthly schedule needs "day_of_month" and no "day_of_week".');
    }
    if (frequency === ReportScheduleFrequency.DAILY && (dow !== null || dom !== null)) {
      return fail('frequency', 'A daily schedule takes neither "day_of_week" nor "day_of_month".');
    }
    const roles = v.recipient_roles;
    if (!Array.isArray(roles) || roles.some((r) => typeof r !== 'string')) {
      return fail('recipient_roles', 'Column "recipient_roles": expected a list of role names.');
    }

    return {
      row: {
        id: v.id as string,
        definition_id: definitionId,
        report_key: reportKey,
        frequency: v.frequency as ReportScheduleFrequency,
        day_of_week: (v.day_of_week as number | undefined) ?? null,
        day_of_month: (v.day_of_month as number | undefined) ?? null,
        local_time: v.local_time as string,
        params: (v.params ?? {}) as Record<string, unknown>,
        recipient_roles: roles as string[],
        format: v.format as ExportFormat,
        active: v.active as boolean,
      },
    };
  },

  keyOf(x: ReportScheduleRow | ReportSchedule): string {
    if (x instanceof ReportSchedule) return scheduleKey(x.report_definition?.key ?? '', x);
    return scheduleKey(x.report_key, x);
  },

  diffFields(row: ReportScheduleRow, existing: ReportSchedule): string[] {
    const changed: string[] = [];
    if (JSON.stringify(row.params) !== JSON.stringify(existing.params)) changed.push('params');
    if (JSON.stringify(row.recipient_roles) !== JSON.stringify(existing.recipient_roles)) {
      changed.push('recipient_roles');
    }
    if (row.format !== existing.format) changed.push('format');
    if (row.active !== existing.active) changed.push('active');
    return changed;
  },

  async upsert(
    row: ReportScheduleRow,
    existing: ReportSchedule | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ReportSchedule> {
    const schedule = existing ?? new ReportSchedule();
    schedule.tenant_id = tenantId;
    schedule.definition_id = row.definition_id;
    schedule.frequency = row.frequency;
    schedule.day_of_week = row.day_of_week;
    schedule.day_of_month = row.day_of_month;
    schedule.local_time = row.local_time;
    schedule.params = row.params;
    schedule.recipient_roles = row.recipient_roles;
    schedule.format = row.format;
    schedule.active = row.active;
    return m.save(ReportSchedule, schedule);
  },

  async remove(entity: ReportSchedule, m: EntityManager): Promise<void> {
    await m.remove(ReportSchedule, entity);
  },
};

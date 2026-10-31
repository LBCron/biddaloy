import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ExportFormat, ReportFieldType, ReportScheduleFrequency } from '@biddaloy/shared';
import { REPORT_VISIBLE_ROLES } from '../../definitions/dto/report-definition.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Most recipient roles one schedule may name. */
export const MAX_RECIPIENT_ROLES = 10;

/** [8.15.45] A recurring email-link delivery. The cron is built on the server from these fields, never taken from the client. */
export class CreateReportScheduleDto {
  @ApiProperty({ enum: Object.values(ReportScheduleFrequency) })
  @IsEnum(ReportScheduleFrequency)
  frequency: ReportScheduleFrequency;

  @ApiPropertyOptional({ minimum: 0, maximum: 6, description: '0 is Sunday. WEEKLY only.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 28,
    description: 'MONTHLY only; 28 at most so every month has it.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  day_of_month?: number;

  @ApiProperty({ example: '08:30', description: "The school's wall-clock time, HH:MM." })
  @IsString()
  @MaxLength(5)
  @Matches(LOCAL_TIME_RE, { message: 'local_time must be HH:MM' })
  local_time: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Answers to the report questions.',
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiProperty({ enum: REPORT_VISIBLE_ROLES, isArray: true, maxItems: MAX_RECIPIENT_ROLES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENT_ROLES)
  @IsIn(REPORT_VISIBLE_ROLES, { each: true })
  recipient_roles: string[];

  @ApiProperty({ enum: Object.values(ExportFormat) })
  @IsEnum(ExportFormat)
  format: ExportFormat;
}

export class UpdateReportScheduleDto {
  @ApiPropertyOptional({ enum: Object.values(ReportScheduleFrequency) })
  @IsOptional()
  @IsEnum(ReportScheduleFrequency)
  frequency?: ReportScheduleFrequency;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 28 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28)
  day_of_month?: number;

  @ApiPropertyOptional({ example: '08:30' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  @Matches(LOCAL_TIME_RE, { message: 'local_time must be HH:MM' })
  local_time?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: REPORT_VISIBLE_ROLES, isArray: true, maxItems: MAX_RECIPIENT_ROLES })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENT_ROLES)
  @IsIn(REPORT_VISIBLE_ROLES, { each: true })
  recipient_roles?: string[];

  @ApiPropertyOptional({ enum: Object.values(ExportFormat) })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ReportScheduleDto {
  @ApiProperty() id: string;
  @ApiProperty() definition_id: string;
  @ApiProperty({ enum: Object.values(ReportScheduleFrequency) }) frequency: ReportScheduleFrequency;
  @ApiProperty({ nullable: true, type: Number }) day_of_week: number | null;
  @ApiProperty({ nullable: true, type: Number }) day_of_month: number | null;
  @ApiProperty() local_time: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) params: Record<string, unknown>;
  @ApiProperty({ type: [String] }) recipient_roles: string[];
  @ApiProperty({ enum: Object.values(ExportFormat) }) format: ExportFormat;
  @ApiProperty() active: boolean;
  @ApiProperty({ nullable: true, type: String }) last_run_id: string | null;
  @ApiProperty() created_at: string;
}

export class CreateReportSnapshotDto {
  @ApiPropertyOptional({
    example: '2026-10-31',
    description:
      "The date the numbers are as of. Defaults to the school's today; never in the future.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(DATE_RE, { message: 'as_of must be YYYY-MM-DD' })
  as_of?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  label?: string;
}

export class ListReportSnapshotsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  offset?: number;
}

export class ReportSnapshotDto {
  @ApiProperty() id: string;
  @ApiProperty() definition_id: string;
  @ApiProperty() name_en: string;
  @ApiProperty() name_bn: string;
  @ApiProperty() as_of: string;
  @ApiProperty() label: string;
  @ApiProperty() row_count: number;
  @ApiProperty() created_at: string;
}

export class ReportSnapshotPageDto {
  @ApiProperty({ type: [ReportSnapshotDto] }) items: ReportSnapshotDto[];
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
  @ApiProperty({ description: 'True when more may follow.' }) has_more: boolean;
}

export class WidgetColumnDto {
  @ApiProperty() key: string;
  @ApiProperty() label_en: string;
  @ApiProperty() label_bn: string;
  @ApiProperty({ enum: Object.values(ReportFieldType) }) type: ReportFieldType;
  @ApiProperty({ enum: ['dimension', 'measure'] }) kind: 'dimension' | 'measure';
}

/** The dashboard tile of a report: its dimensions and first measure, at most 50 rows. */
export class ReportWidgetDto {
  @ApiProperty() definition_id: string;
  @ApiProperty() name_en: string;
  @ApiProperty() name_bn: string;
  @ApiProperty({ type: [WidgetColumnDto] }) columns: WidgetColumnDto[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  rows: Array<Record<string, unknown>>;
  @ApiProperty({ description: 'True when the report has more rows than the tile shows.' })
  truncated: boolean;
  @ApiProperty() suppressed: boolean;
}

/** Platform usage page query: a date range of at most 366 days. */
export class PlatformReportUsageQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Default: 30 days before `to`.' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(DATE_RE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Inclusive. Default: today (UTC).' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(DATE_RE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class PlatformReportUsageRowDto {
  @ApiProperty({ description: "A ready report's key, or 'custom' for a school's own." })
  report_key: string;
  @ApiProperty() runs: number;
  @ApiProperty() schools: number;
  @ApiProperty() unique_users: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Share of answers that said yes; null when nobody answered.',
  })
  helpful_pct: number | null;
  @ApiProperty() too_slow: number;
  @ApiProperty() empty_results: number;
  @ApiProperty({ description: 'Exports of more than 5,000 rows.' }) large_exports: number;
  @ApiProperty({
    type: [String],
    description: 'The latest comments, newest first; no names or ids.',
  })
  latest_comments: string[];
}

export class PlatformReportUsageDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: [PlatformReportUsageRowDto] }) reports: PlatformReportUsageRowDto[];
}

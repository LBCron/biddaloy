import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { ReportDefinitionJson } from '@biddaloy/shared';
import { ExportFormat, ReportRunKind, ReportRunStatus } from '@biddaloy/shared';

/** What `GET /reports/meta` says about one field. Never SQL, never a table name (D19). */
export class MetaFieldDto {
  @ApiProperty() key: string;
  @ApiProperty() label_en: string;
  @ApiProperty() label_bn: string;
  @ApiProperty() type: string;
  @ApiProperty() sensitivity: string;
  @ApiProperty() filterable: boolean;
  @ApiProperty() groupable: boolean;
  @ApiProperty() sortable: boolean;
  @ApiPropertyOptional({ type: [String] }) enum_values?: string[];
}

export class MetaMeasureDto {
  @ApiProperty() key: string;
  @ApiProperty() label_en: string;
  @ApiProperty() label_bn: string;
  @ApiProperty() fn: string;
  @ApiProperty() type: string;
  @ApiProperty() sensitivity: string;
}

export class MetaAreaDto {
  @ApiProperty() key: string;
  @ApiProperty({ type: [MetaFieldDto] }) fields: MetaFieldDto[];
  @ApiProperty({ type: [MetaMeasureDto] }) measures: MetaMeasureDto[];
}

export class ReportMetaDto {
  @ApiProperty() schema_version: number;
  @ApiProperty({ type: [MetaAreaDto] }) areas: MetaAreaDto[];
}

export class RunReportDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A saved report (REPORTS_VIEW and visible to your role).',
  })
  @IsOptional()
  @IsUUID()
  definitionId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'An unsaved report to preview (REPORTS_DESIGN).',
  })
  @IsOptional()
  @IsObject()
  definition?: ReportDefinitionJson;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class ExportRunDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() definitionId?: string;

  @ApiPropertyOptional({
    description: 'A list to export instead of a report, e.g. `students-list`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  source?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'The list filters.',
  })
  @IsOptional()
  @IsObject()
  query?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ExportFormat, default: ExportFormat.XLSX })
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;
}

export class QueuedExportDto {
  @ApiProperty({ format: 'uuid' }) run_id: string;
  @ApiProperty({ enum: ReportRunStatus }) status: ReportRunStatus;
}

export class ReportRunStatusDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ReportRunKind }) kind: ReportRunKind;
  @ApiProperty({ enum: ReportRunStatus }) status: ReportRunStatus;
  @ApiProperty({ nullable: true, type: String }) format: string | null;
  @ApiProperty() row_count: number;
  @ApiProperty({ nullable: true, type: String }) error_code: string | null;
  @ApiProperty({ nullable: true, type: String }) expires_at: string | null;
  @ApiProperty({ description: 'True while the file can still be downloaded.' })
  downloadable: boolean;
}

export class RunFeedbackDto {
  @ApiProperty() @IsBoolean() helpful: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

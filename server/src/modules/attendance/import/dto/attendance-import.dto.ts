import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AttendanceStatus } from '@biddaloy/shared';
import { IsRealDate } from '../../../../common/decorators/is-real-date.decorator';

/** `GET attendance/import/template?sectionIds=a,b&date=YYYY-MM-DD` (D35: at most 10 sections). */
export class TemplateQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  sectionIds: string[];

  @IsString()
  @IsRealDate()
  date: string;
}

export class CommitAttendanceImportDto {
  @IsUUID()
  staging_id: string;

  @IsOptional()
  @IsUUID()
  supersedes_import_id?: string;
}

export class QueryAttendanceImportsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ImportPreviewRowDto {
  @ApiProperty({ description: '1-based row number in the file' }) row: number;
  @ApiProperty({ type: String, nullable: true }) date: string | null;
  @ApiProperty({ type: String, nullable: true }) section_id: string | null;
  @ApiProperty({ type: String, nullable: true }) class_name: string | null;
  @ApiProperty({ type: String, nullable: true }) section_name: string | null;
  @ApiProperty({ type: Number, nullable: true }) roll: number | null;
  @ApiProperty({ enum: AttendanceStatus, nullable: true }) before: AttendanceStatus | null;
  @ApiProperty({ enum: AttendanceStatus, nullable: true }) after: AttendanceStatus | null;
  @ApiProperty({ enum: ['NEW', 'CHANGED', 'UNCHANGED', 'ERROR'] }) outcome: string;
  @ApiPropertyOptional({ description: 'Stable problem code; the UI translates it' })
  code?: string;
}

export class ImportCountsDto {
  @ApiProperty() new: number;
  @ApiProperty() changed: number;
  @ApiProperty() unchanged: number;
  @ApiProperty() error: number;
}

export class ValidateAttendanceImportResultDto {
  @ApiProperty({ type: String, nullable: true, description: 'null when nothing can be saved' })
  staging_id: string | null;
  @ApiProperty({ type: ImportPreviewRowDto, isArray: true }) rows: ImportPreviewRowDto[];
  @ApiProperty({ type: ImportCountsDto }) counts: ImportCountsDto;
  @ApiProperty({ description: 'Recorded marks this save will change' }) overwrite_count: number;
}

export class CommitAttendanceImportResultDto {
  @ApiProperty() import_id: string;
}

export class AttendanceImportSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: String, nullable: true }) uploaded_by_user_id: string | null;
  @ApiProperty() file_name: string;
  @ApiProperty({ type: ImportCountsDto }) counts: ImportCountsDto;
  @ApiProperty({ type: String, nullable: true }) supersedes_import_id: string | null;
  @ApiProperty() created_at: string;
}

export class AttendanceImportListDto {
  @ApiProperty({ type: AttendanceImportSummaryDto, isArray: true })
  items: AttendanceImportSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class AttendanceImportDetailRowDto {
  @ApiProperty() date: string;
  @ApiProperty() section_id: string;
  @ApiProperty() roll: number;
  @ApiProperty({ enum: AttendanceStatus, nullable: true }) before: AttendanceStatus | null;
  @ApiProperty({ enum: AttendanceStatus, nullable: true }) after: AttendanceStatus | null;
  @ApiProperty({ enum: ['NEW', 'CHANGED', 'UNCHANGED', 'ERROR'] }) outcome: string;
  @ApiProperty({ type: String, nullable: true }) record_id: string | null;
  @ApiPropertyOptional() code?: string;
  @ApiProperty({
    enum: AttendanceStatus,
    nullable: true,
    description: 'The record’s status now; differs from `after` when it was changed later',
  })
  current: AttendanceStatus | null;
}

export class AttendanceImportDetailDto extends AttendanceImportSummaryDto {
  @ApiProperty({ type: AttendanceImportDetailRowDto, isArray: true })
  rows: AttendanceImportDetailRowDto[];
}

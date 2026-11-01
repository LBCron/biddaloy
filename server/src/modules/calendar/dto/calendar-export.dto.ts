import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

/** `GET /calendar/export` query — [17.3.2]. `format` defaults to `xlsx`,
 * same default as `GET /calendar-import/template`. */
export class CalendarExportQueryDto {
  @IsUUID()
  academic_year_id: string;

  @ApiPropertyOptional({ enum: ['xlsx', 'csv'], default: 'xlsx' })
  @IsOptional()
  @IsIn(['xlsx', 'csv'])
  format?: 'xlsx' | 'csv';
}

/** `POST /calendar/clone` body — [17.3.2]. Omitting `event_ids` clones
 * every non-`HOLIDAY` published event in `source_year_id`; passing it
 * narrows the clone to that explicit set (still restricted to
 * `source_year_id`, non-`HOLIDAY`, published). */
export class CloneCalendarDto {
  @IsUUID()
  source_year_id: string;

  @IsUUID()
  target_year_id: string;

  @IsOptional()
  @IsArray()
  // Rule 5: an unbounded list reaches an `IN (...)` query. A year holds a few hundred events.
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  event_ids?: string[];
}

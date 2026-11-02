import type { Type } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { ExportFormat } from '@biddaloy/shared';

/**
 * [8.15.11] A list's own query DTO plus `format`, so `GET <list>/export`
 * accepts exactly the filters the list does. `csv` / `xlsx` in any case.
 * `page` and `limit` are inherited but ignored: an export is every match.
 */
export function WithExportFormat<T extends Type<object>>(Base: T) {
  class WithFormat extends Base {
    @ApiPropertyOptional({ enum: ExportFormat, default: ExportFormat.CSV })
    @IsOptional()
    @Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.toUpperCase() : value,
    )
    @IsEnum(ExportFormat)
    format?: ExportFormat;
  }
  return WithFormat;
}

/** The filter part of an export request, stored on the run row (never `format`, `page` or `limit`). */
export function exportFilters(query: object): Record<string, unknown> {
  const {
    format: _format,
    page: _page,
    limit: _limit,
    ...filters
  } = query as Record<string, unknown>;
  return filters;
}

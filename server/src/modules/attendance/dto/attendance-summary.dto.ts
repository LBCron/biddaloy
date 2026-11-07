import { BadRequestException } from '@nestjs/common';
import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { IsRealDate, IsRealMonth } from '../../../common/decorators/is-real-date.decorator';
import { AttendanceStatus, DailyRegisterWriteReason } from '@biddaloy/shared';

// ---------------------------------------------------------------------------
// Shared month/range resolution
// ---------------------------------------------------------------------------

/**
 * The one place `?month=YYYY-MM` is expanded to `{ from, to }` — every
 * range-taking summary route shares this so "first/last day of month" is
 * computed identically everywhere. Rejects a request that sends both
 * `month` and `from`/`to` with a 400 rather than silently preferring one,
 * and rejects a request that sends neither.
 */
export function resolveDateRange(query: { month?: string; from?: string; to?: string }): {
  from: string;
  to: string;
} {
  const hasMonth = !!query.month;
  const hasRange = !!query.from || !!query.to;

  if (hasMonth && hasRange) {
    throw new BadRequestException('Provide either "month" or "from"/"to", not both');
  }
  if (hasMonth) {
    const [year, month] = query.month!.split('-').map(Number);
    const from = `${query.month}-01`;
    // Day 0 of the *next* month is the last day of this one — plain UTC
    // arithmetic, never a local-timezone `Date`.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const to = `${query.month}-${String(lastDay).padStart(2, '0')}`;
    return { from, to };
  }
  if (!query.from || !query.to) {
    throw new BadRequestException('Either "month" or both "from" and "to" are required');
  }
  return { from: query.from, to: query.to };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** `GET /attendance/students/:studentId/summary` — `from`/`to` or `month`. */
export class QueryStudentSummaryDto {
  @IsOptional()
  @IsString()
  @IsRealMonth()
  month?: string;

  @IsOptional()
  @IsString()
  @IsRealDate()
  from?: string;

  @IsOptional()
  @IsString()
  @IsRealDate()
  to?: string;
}

/** `GET /attendance/students/:studentId/days` — month only, drives the
 * portal's month grid. */
export class QueryStudentDaysDto {
  @IsString()
  @IsRealMonth()
  month: string;
}

/** `GET /attendance/sections/:sectionId/summary` — an explicit range, not a
 * whole-month view (that's the register matrix below). */
export class QuerySectionSummaryDto {
  @IsString()
  @IsRealDate()
  from: string;

  @IsString()
  @IsRealDate()
  to: string;
}

/** `GET /attendance/sections/:sectionId/register-matrix` — month only; the
 * printable paper-register replacement is inherently a monthly layout. */
export class QueryRegisterMatrixDto {
  @IsString()
  @IsRealMonth()
  month: string;
}

/** `GET /attendance/flags/low`. `threshold` defaults to the tenant's
 * `policy.lowAttendanceThresholdPercent` when omitted. */
export class QueryLowAttendanceDto {
  @IsString()
  @IsRealDate()
  from: string;

  @IsString()
  @IsRealDate()
  to: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  threshold?: number;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

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
  limit?: number = 10;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class AttendanceSummaryPolicyDto {
  @ApiProperty() late_counts_as_present: boolean;
  @ApiProperty() leave_counts_as_working_day: boolean;
  @ApiProperty({ enum: ['WORKING_DAYS', 'MARKED_DAYS'] }) denominator:
    'WORKING_DAYS' | 'MARKED_DAYS';
}

/**
 * **This shape is a contract with a future exam module.** Adding a key is
 * allowed. Renaming or removing one is a breaking change that must be
 * raised with the user first. `attendance-summary.contract.spec.ts` asserts
 * the exact key set so the change cannot be accidental.
 */
export class AttendanceSummaryDto {
  @ApiProperty() student_id: string;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() working_days: number;
  @ApiProperty() marked_days: number;
  @ApiProperty() present_days: number;
  @ApiProperty() late_days: number;
  @ApiProperty() absent_days: number;
  @ApiProperty() leave_days: number;
  @ApiProperty() unmarked_days: number;
  @ApiProperty({ type: Number, nullable: true }) attendance_percentage: number | null;
  @ApiProperty({ type: AttendanceSummaryPolicyDto }) policy: AttendanceSummaryPolicyDto;
}

export class AttendanceDayDto {
  @ApiProperty() date: string;
  @ApiProperty({ enum: AttendanceStatus, nullable: true }) status: AttendanceStatus | null;
  @ApiProperty({ type: Number, nullable: true }) minutes_late: number | null;
  @ApiProperty({ type: String, nullable: true }) remarks: string | null;
  @ApiProperty() is_working_day: boolean;
  @ApiProperty({ type: String, nullable: true }) holiday_name: string | null;
  /** UTC ISO time the day's whole-day register was marked; null if never. */
  @ApiProperty({ type: String, nullable: true }) marked_at: string | null;
}

export class SectionSummaryDto {
  @ApiProperty() section_id: string;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() working_days: number;
  @ApiProperty({ type: AttendanceSummaryDto, isArray: true }) students: AttendanceSummaryDto[];
  @ApiProperty({ type: Number, nullable: true }) section_percentage: number | null;
}

export class RegisterMatrixDateDto {
  @ApiProperty() date: string;
  @ApiProperty() is_working_day: boolean;
}

export class RegisterMatrixRowDto {
  @ApiProperty() student_id: string;
  @ApiProperty() roll_number: number;
  @ApiProperty() full_name: string;
  @ApiProperty({ type: Object }) marks: Record<string, AttendanceStatus | null>;
  @ApiProperty({ type: AttendanceSummaryDto }) summary: AttendanceSummaryDto;
}

export class RegisterMatrixDto {
  @ApiProperty({ type: RegisterMatrixDateDto, isArray: true }) dates: RegisterMatrixDateDto[];
  /** date -> version of that date's whole-day session; only marked dates. */
  @ApiProperty({ type: Object }) versions: Record<string, number>;
  @ApiProperty({ type: RegisterMatrixRowDto, isArray: true }) rows: RegisterMatrixRowDto[];
  @ApiProperty({
    description:
      'Whether you may save this month grid: your mark permission plus the school daily-attendance setting. A first-period teacher may not (D31).',
  })
  can_write: boolean;
  @ApiProperty({
    enum: DailyRegisterWriteReason,
    nullable: true,
    description: 'Why you cannot save; null when you can (or never could).',
  })
  write_reason: DailyRegisterWriteReason | null;
}

export class AttendanceStreakDto {
  @ApiProperty() student_id: string;
  @ApiProperty() student_name: string;
  @ApiProperty() roll_number: number;
  @ApiProperty({ enum: [AttendanceStatus.ABSENT, AttendanceStatus.LATE, AttendanceStatus.PRESENT] })
  status: AttendanceStatus.ABSENT | AttendanceStatus.LATE | AttendanceStatus.PRESENT;
  @ApiProperty() length: number;
  @ApiProperty({
    description:
      'Oldest day-session of the run within the last 15 sessions (YYYY-MM-DD); length is therefore capped at 15.',
  })
  since_date: string;
}

export class AttendanceStreaksDto {
  @ApiProperty({ type: AttendanceStreakDto, isArray: true }) items: AttendanceStreakDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: "The section's latest day-session date; null when it has none.",
  })
  as_of_date: string | null;
}

export class LowAttendanceFlagDto extends AttendanceSummaryDto {
  @ApiProperty() student_name: string;
  @ApiProperty() roll_number: number;
  @ApiProperty() class_name: string;
  @ApiProperty() section_name: string;
  @ApiProperty({ type: String, nullable: true }) guardian_id: string | null;
}

export class LowAttendanceListResponseDto {
  @ApiProperty({ type: LowAttendanceFlagDto, isArray: true }) data: LowAttendanceFlagDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

export class SubjectCountsDto {
  @ApiProperty() present: number;
  @ApiProperty() late: number;
  @ApiProperty() absent: number;
  @ApiProperty() leave: number;
  @ApiProperty() attended: number;
  @ApiProperty({ type: Number, nullable: true }) percentage: number | null;
}

export class SubjectSummarySubjectDto {
  @ApiProperty() subject_id: string;
  @ApiProperty() name: string;
  @ApiProperty() held: number;
}

@ApiExtraModels(SubjectCountsDto)
export class SubjectSummaryRowDto {
  @ApiProperty() student_id: string;
  @ApiProperty() roll_number: number;
  @ApiProperty() full_name: string;
  /** Keyed by `subject_id`. */
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(SubjectCountsDto) },
  })
  by_subject: Record<string, SubjectCountsDto>;
}

export class SubjectSummaryDto {
  @ApiProperty({ type: SubjectSummarySubjectDto, isArray: true })
  subjects: SubjectSummarySubjectDto[];
  @ApiProperty({ type: SubjectSummaryRowDto, isArray: true }) rows: SubjectSummaryRowDto[];
}

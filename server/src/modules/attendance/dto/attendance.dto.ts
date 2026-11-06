import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  DailyRegisterWriteReason,
} from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { IsRealDate } from '../../../common/decorators/is-real-date.decorator';
import { AuditLogListResponseDto } from '../../audit/dto/audit-log-response.dto';
import { SMALLINT_MAX } from '../../routines/dto/setup.dto';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Query params for `GET /attendance/my-sections`. `date` defaults to the
 * tenant's local today when omitted — see `AttendanceService.listMySections`. */
export class QueryMySectionsDto {
  @IsOptional()
  @IsString()
  @IsRealDate()
  date?: string;
}

/** Query params for `GET /attendance/sections/:sectionId/register`. */
export class QueryRegisterDto {
  @IsString()
  @IsRealDate()
  date: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX) // PeriodSlot.sequence is a smallint
  period_no?: number;
}

/** Query params for `GET /attendance/sections/:sectionId/periods`. */
export class QueryPeriodsDto {
  @IsString()
  @IsRealDate()
  date: string;
}

/** One student's mark within a `PUT .../register` payload. */
export class RegisterEntryDto {
  @IsUUID()
  student_id: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  /** Only meaningful when `status = LATE`; ignored otherwise. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  minutes_late?: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  @SanitizeText()
  remarks?: string;
}

/** `PUT /attendance/sections/:sectionId/register` — the whole register for
 * one section, one day (and optionally one period), in a single idempotent,
 * conflict-aware call. */
export class PutRegisterDto {
  @IsString()
  @IsRealDate()
  date: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX) // PeriodSlot.sequence is a smallint
  period_no?: number | null;

  /** The `session.version` this write was based on — `0` when no session
   * exists yet. A mismatch against the current value is a 409. */
  @IsInt()
  @Min(0)
  base_version: number;

  /** Replay key. Re-sending the same id against an already-accepted write
   * returns the current register and writes nothing. */
  @IsUUID()
  client_request_id: string;

  @IsOptional()
  @IsBoolean()
  finalize?: boolean;

  /** Required when correcting an existing register outside the tenant's
   * correction window, or when forcing a write on a non-working day. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @SanitizeText()
  reason?: string;

  /** Marks a non-working day (holiday or weekly off) as intentional. Only
   * effective for a caller holding `ATTENDANCE_CORRECT`. */
  @IsOptional()
  @IsBoolean()
  force_non_working_day?: boolean;

  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => RegisterEntryDto)
  entries: RegisterEntryDto[];
}

/** One student's mark for one day in `PUT .../register-matrix`. Deliberately
 * only a status: no minutes late, remarks, period or force flag. */
export class MatrixEntryDto {
  @IsUUID()
  student_id: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;
}

export class MatrixDayDto {
  @IsString()
  @IsRealDate()
  date: string;

  /** The `session.version` the client saw for this day; `null` = "I saw no
   * register for this day". A saved register's version starts at 1. */
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  base_version: number | null;

  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => MatrixEntryDto)
  entries: MatrixEntryDto[];
}

/** `PUT /attendance/sections/:sectionId/register-matrix` — many days of one
 * section's whole-day register, all-or-nothing. All days share one calendar
 * month (checked in the service). */
export class PutRegisterMatrixDto {
  @ApiProperty({
    description:
      'One replay key for the whole request. On every sent day already = replay (200, nothing ' +
      'written). On only some = 409 ATTENDANCE_MATRIX_REQUEST_REUSED: the id was already used, ' +
      'or some of these days changed since. Treat it like ATTENDANCE_MATRIX_CONFLICT and reload ' +
      'the month.',
  })
  @IsUUID()
  client_request_id: string;

  /** Written to every audit row; required when any day needs a correction. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @SanitizeText()
  reason?: string;

  @ApiProperty({
    type: MatrixDayDto,
    isArray: true,
    description:
      'Every sent day is checked as a correction, even if its marks are unchanged. A FINALIZED ' +
      'or out-of-window day needs ATTENDANCE_CORRECT (else 403 ATTENDANCE_WINDOW_CLOSED) and a ' +
      'reason (else 422 ATTENDANCE_REASON_REQUIRED); send only the days you changed. A new LATE mark is saved with minutes_late = null, ' +
      'and a fine rule with a minimum-minutes condition still counts it.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @ValidateNested({ each: true })
  @Type(() => MatrixDayDto)
  days: MatrixDayDto[];
}

/** `POST /attendance/sections/:sectionId/register/finalize` — finalizes an
 * already-submitted register without resubmitting marks. Exists separately
 * from `PUT { finalize: true }` because [9.8]'s cut-off sweep needs to
 * finalize a register it never itself marked. */
export class FinalizeRegisterDto {
  @IsString()
  @IsRealDate()
  date: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SMALLINT_MAX) // PeriodSlot.sequence is a smallint
  period_no?: number | null;
}

/** `PATCH /attendance/records/:recordId` — correcting one existing mark.
 * Unlike the register-level `PutRegisterDto`, `reason` is always required:
 * this route only ever edits something that already exists. */
export class CorrectRecordDto {
  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  minutes_late?: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  @SanitizeText()
  remarks?: string;

  @IsString()
  @MinLength(3)
  @SanitizeText()
  reason: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class RegisterSectionDto {
  @ApiProperty() id: string;
  @ApiProperty() section_name: string;
  @ApiProperty() class_name: string;
}

export class RegisterPolicyDto {
  @ApiProperty() late_after: string;
  @ApiProperty() correction_window_days: number;
  @ApiProperty() allow_future_dates: boolean;
}

/** `null` for every field means "no session exists for this day yet" — the
 * client sends `version: 0` back as `base_version` in that case. */
export class SessionSummaryDto {
  @ApiProperty({ type: String, nullable: true }) id: string | null;
  @ApiProperty() date: string;
  @ApiProperty({ type: Number, nullable: true }) period_no: number | null;
  @ApiProperty({ enum: AttendanceSessionState }) state: AttendanceSessionState;
  @ApiProperty() version: number;
  @ApiProperty({ type: String, nullable: true }) marked_by_user_id: string | null;
  @ApiProperty({ type: String, nullable: true }) marked_at: string | null;
  @ApiProperty({ type: String, nullable: true }) finalized_at: string | null;
}

/** `status: null` means "not marked yet" — deliberately distinct from
 * `ABSENT`. The marking UI depends on that distinction to show an unmarked
 * count. `correction_count` is derived from `audit_logs` at read time (see
 * `AttendanceService`'s docstring) rather than a persisted column. */
export class RegisterStudentDto {
  @ApiProperty() student_id: string;
  @ApiProperty() roll_number: number;
  @ApiProperty() full_name: string;
  @ApiProperty({ type: String, nullable: true }) record_id: string | null;
  @ApiProperty({ enum: AttendanceStatus, nullable: true }) status: AttendanceStatus | null;
  @ApiProperty({ type: Number, nullable: true }) minutes_late: number | null;
  @ApiProperty({ type: String, nullable: true }) remarks: string | null;
  @ApiProperty({ enum: AttendanceSource, nullable: true }) source: AttendanceSource | null;
  @ApiProperty() correction_count: number;
  /** Period registers only, before the first save: `ABSENT` or `LEAVE` when
   * the day register says so, otherwise `null` (D8). Never persisted. */
  @ApiProperty({ enum: AttendanceStatus, nullable: true })
  suggested_status: AttendanceStatus | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'When a card scan came in for a student who is marked absent or on leave: the scan time. Otherwise null.',
  })
  scanned_at: string | null;
}

/** The shape returned by `GET .../register`, `PUT .../register` (200, both
 * on first write and on idempotent replay), `POST .../finalize`, and — as
 * `current_register` — inside a 409's `details`. */
export class RegisterResponseDto {
  @ApiProperty({ type: RegisterSectionDto }) section: RegisterSectionDto;
  @ApiProperty({ type: SessionSummaryDto }) session: SessionSummaryDto;
  @ApiProperty() editable: boolean;
  @ApiProperty() reason_required: boolean;
  @ApiProperty() non_working_day: boolean;
  @ApiProperty({ type: RegisterPolicyDto }) policy: RegisterPolicyDto;
  @ApiProperty({ type: RegisterStudentDto, isArray: true }) students: RegisterStudentDto[];
  @ApiProperty({
    description: 'Whether period-wise attendance is switched on for this school.',
  })
  period_attendance_enabled: boolean;
  @ApiProperty({
    required: false,
    description:
      'GET register only. Whether you may change this whole-day register under the school daily-attendance setting. Always false for a period register.',
  })
  can_write?: boolean;
  @ApiProperty({
    required: false,
    enum: DailyRegisterWriteReason,
    nullable: true,
    description: 'GET register only. Why you cannot write; null when you can (or never could).',
  })
  write_reason?: DailyRegisterWriteReason | null;
  @ApiProperty({
    required: false,
    description: 'GET register only. True when you cover period 1 of this section on this date.',
  })
  first_period_today?: boolean;
}

export class MySectionTodayDto {
  @ApiProperty({ enum: AttendanceSessionState }) state: AttendanceSessionState;
  @ApiProperty() present: number;
  @ApiProperty() absent: number;
  @ApiProperty() late: number;
  @ApiProperty() leave: number;
  @ApiProperty() unmarked: number;
  @ApiProperty({
    description: 'Students with a card scan today who are marked absent or on leave.',
  })
  scanned_but_absent: number;
  @ApiProperty({ type: String, nullable: true }) marked_at: string | null;
}

/** `today: null` means no register exists yet for the queried date. */
export class MySectionDto {
  @ApiProperty() section_id: string;
  @ApiProperty() section_name: string;
  @ApiProperty() class_id: string;
  @ApiProperty() class_name: string;
  @ApiProperty() student_count: number;
  @ApiProperty({ type: String, nullable: true }) class_teacher_name: string | null;
  @ApiProperty() is_working_day: boolean;
  @ApiProperty({ type: MySectionTodayDto, nullable: true }) today: MySectionTodayDto | null;
}

/** Response of `PUT .../register-matrix`; the client refetches the matrix. */
export class MatrixSaveResponseDto {
  @ApiProperty({ type: String, isArray: true }) saved_dates: string[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  versions: Record<string, number>;
}

/** One period of a section's day, `GET /attendance/sections/:sectionId/periods`.
 * `state: null` means no register exists yet for that period. */
export class PeriodDto {
  @ApiProperty() period_no: number;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty() starts_at: string;
  @ApiProperty() ends_at: string;
  @ApiProperty() subject_id: string;
  @ApiProperty({ type: String, nullable: true }) subject_name: string | null;
  @ApiProperty({ type: String, isArray: true }) teacher_names: string[];
  @ApiProperty({ enum: AttendanceSessionState, nullable: true })
  state: AttendanceSessionState | null;
}

/** `GET /attendance/records/:recordId/history` — same list shape as
 * `AuditLogListResponseDto`, named separately so the attendance tag's
 * OpenAPI schema documents its own response model rather than borrowing the
 * audit module's name. */
export class RecordHistoryResponseDto extends AuditLogListResponseDto {}

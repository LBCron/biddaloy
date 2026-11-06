import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  AttendanceDeviceKind,
  AttendanceDeviceStatus,
  AttendanceEventDirection,
  AttendanceSubjectType,
} from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

// ---------------------------------------------------------------------------
// Management (`devices.controller.ts`) requests
// ---------------------------------------------------------------------------

/** `POST /attendance/devices`. */
export class CreateDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @SanitizeText()
  name: string;

  @IsEnum(AttendanceDeviceKind)
  kind: AttendanceDeviceKind;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  @IsOptional()
  @IsBoolean()
  roster_access?: boolean;
}

// ---------------------------------------------------------------------------
// Ingest (`device-ingest.controller.ts`) requests
// ---------------------------------------------------------------------------

/** One scan within a `POST /attendance/device-events` batch. Exactly one of
 * `student_id`/`external_ref` must be given — validated in
 * `DeviceEventsService`, not here, since it's a cross-field rule. */
export class DeviceEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  device_event_id: string;

  @IsDateString()
  occurred_at: string;

  @IsEnum(AttendanceEventDirection)
  direction: AttendanceEventDirection;

  @IsOptional()
  @IsUUID()
  student_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  external_ref?: string;

  /** [36.2.3] Which kind of subject this scan is for — `student_id`
   * resolves against `staff_profiles.id` and `external_ref` against
   * `staff_profiles.employee_id` when this is `STAFF`. Defaults to
   * `STUDENT` so every existing payload (which never sends this field)
   * keeps its current behavior unchanged. */
  @IsOptional()
  @IsEnum(AttendanceSubjectType)
  subject_type?: AttendanceSubjectType;
}

/** `POST /attendance/device-events`. A batch is not atomic — see
 * `DeviceEventsService.ingest`'s docstring for why. */
export class DeviceEventBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DeviceEventDto)
  events: DeviceEventDto[];
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class DeviceResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: AttendanceDeviceKind }) kind: AttendanceDeviceKind;
  @ApiProperty() token_last4: string;
  @ApiProperty({ type: String, nullable: true }) section_id: string | null;
  @ApiProperty() roster_access: boolean;
  @ApiProperty({ enum: AttendanceDeviceStatus }) status: AttendanceDeviceStatus;
  @ApiProperty({ type: String, nullable: true }) last_seen_at: string | null;
}

/** Returned only from `POST /attendance/devices` and
 * `POST /attendance/devices/:id/rotate` — the one and only time the raw key
 * is ever visible again. */
export class DeviceWithKeyResponseDto {
  @ApiProperty({ type: DeviceResponseDto }) device: DeviceResponseDto;
  @ApiProperty() key: string;
}

export class DeviceEventResultDto {
  @ApiProperty() device_event_id: string;
  @ApiProperty({
    enum: [
      'accepted',
      'duplicate',
      'unknown_student',
      'unknown_staff',
      'skipped_teacher_marked',
      'out_of_window',
      'rejected',
    ],
  })
  outcome: string;
  @ApiProperty({ type: String, nullable: true, required: false }) student_id?: string | null;
  @ApiProperty({ nullable: true, required: false }) status?: string | null;
  @ApiProperty({ type: Number, nullable: true, required: false }) minutes_late?: number | null;
  @ApiProperty({ type: String, required: false }) reason?: string;
}

export class DeviceEventBatchResponseDto {
  @ApiProperty({ type: DeviceEventResultDto, isArray: true }) results: DeviceEventResultDto[];
  @ApiProperty() accepted: number;
  @ApiProperty() duplicate: number;
  @ApiProperty() failed: number;
}

/** `GET /attendance/devices/me/roster` — exactly these five fields, never
 * the whole `Student` entity. */
export class DeviceRosterEntryDto {
  @ApiProperty() student_id: string;
  @ApiProperty() registration_number: string;
  @ApiProperty({ type: String, nullable: true }) card_no: string | null;
  @ApiProperty() roll_number: number;
  @ApiProperty() full_name: string;
  @ApiProperty() section_id: string;
}

export class DeviceHeartbeatResponseDto {
  @ApiProperty() server_time: string;
  @ApiProperty() tenant_timezone: string;
  @ApiProperty() policy: { late_after: string; absent_after: string };
}

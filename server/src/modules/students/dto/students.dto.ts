import {
  IsBoolean,
  IsString,
  IsEmail,
  IsOptional,
  IsUUID,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsNotEmpty,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateBy,
} from 'class-validator';
import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { CommunicationMedium, EnrollmentStatus } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { IsPlausibleBirthDate } from '../../../common/decorators/is-real-date.decorator';
import { ROLL_NUMBER_MAX } from '../roll-number.util';
import type { BulkImportErrorDto } from '../../bulk-import/dto/bulk-import.dto';

/** [32.2.5] Allowed blood groups on a student (D43). */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Matches "01712345678", "+8801712345678", or "8801712345678" — Bangladesh
// mobile numbers (operator prefixes 13-19).
export const BD_PHONE_REGEX = /^(?:\+?880|0)1[3-9]\d{8}$/;

/** [39.2.1] The five student-profile fields. Writing any needs STUDENT_RECORDS_WRITE
 * (enforced in the controller); `null` on update clears the column. */
export const STUDENT_PROFILE_FIELDS = [
  'religion',
  'birth_reg_no',
  'health_notes',
  'father_name',
  'mother_name',
] as const;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const ProfileText = (max: number) =>
  applyDecorators(IsOptional(), Transform(trimmed), IsString(), SanitizeText(), MaxLength(max));

/** Birth registration numbers are 10-17 digits (BD BRN is 17, older ones 10+). */
const BirthRegNo = () =>
  applyDecorators(
    IsOptional(),
    Transform(trimmed),
    IsString(),
    Matches(/^\d{10,17}$/, { message: 'birth_reg_no must be 10 to 17 digits' }),
  );

export class CreateStudentDto {
  @IsString()
  @MaxLength(100)
  @IsNotEmpty()
  @SanitizeText()
  full_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  full_name_bn?: string;

  @IsOptional()
  @IsIn(BLOOD_GROUPS)
  blood_group?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsUUID()
  class_section_id: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ROLL_NUMBER_MAX)
  roll_number?: number;

  @IsOptional()
  @IsPlausibleBirthDate()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @SanitizeText()
  gender?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  home_address?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  guardian_ids?: string[];

  @BirthRegNo()
  birth_reg_no?: string;

  @ProfileText(200)
  religion?: string;

  @ProfileText(2000)
  health_notes?: string;

  @ProfileText(200)
  father_name?: string;

  @ProfileText(200)
  mother_name?: string;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  full_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  full_name_bn?: string | null;

  @IsOptional()
  @IsIn(BLOOD_GROUPS)
  blood_group?: string | null;

  @IsOptional()
  @IsUUID()
  class_section_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ROLL_NUMBER_MAX)
  roll_number?: number;

  // `| null` (not just optional) — `@IsOptional()` already skips the
  // string/date-format validators below for `null` same as `undefined`,
  // and `StudentService.update` spreads the DTO straight into a TypeORM
  // partial update, so an explicit `null` clears the column. Without the
  // `| null` in the type, editing a student had no way to *remove* a
  // previously-set date of birth, gender or address — an absent key means
  // "leave unchanged" in a PATCH, so the client's only option was to omit
  // the field entirely, which never clears it.
  @IsOptional()
  @IsPlausibleBirthDate()
  date_of_birth?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  @SanitizeText()
  gender?: string | null;

  @IsOptional()
  @IsString()
  @SanitizeText()
  home_address?: string | null;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  // [39.2.1] No `enrollment_status` here on purpose. A status change must go through
  // POST /students/:id/leave or /readmit (STUDENT_LIFECYCLE_MANAGE, mandatory reason and date,
  // a lifecycle event, one transaction). With `forbidNonWhitelisted` a body that still sends it
  // is rejected with a 400 instead of writing `students.enrollment_status` directly.
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  guardian_ids?: string[];

  @BirthRegNo()
  birth_reg_no?: string | null;

  @ProfileText(200)
  religion?: string | null;

  @ProfileText(2000)
  health_notes?: string | null;

  @ProfileText(200)
  father_name?: string | null;

  @ProfileText(200)
  mother_name?: string | null;
}

/**
 * [39.2.4] Body of `PATCH /students/:id/records`: the five profile fields only. A separate route
 * (ADMIN + EXECUTIVE, STUDENT_RECORDS_WRITE) so an EXECUTIVE can edit records without being
 * granted general student updates.
 */
export class UpdateStudentRecordsDto extends PickType(UpdateStudentDto, [
  'birth_reg_no',
  'religion',
  'health_notes',
  'father_name',
  'mother_name',
] as const) {}

export class QueryStudentDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  // [33.3.1] Filters to students enrolled in a class using this
  // organisation-vocabulary shift/version, via `class_section.class`.
  // Unknown/nonexistent value → no matching rows (empty page), never a 500.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  shift?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  enrollment_status?: EnrollmentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  /** [8.15.33] Exact match, any letter case (the field is free text on the student record). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  religion?: string;

  @IsOptional()
  @IsDateString()
  date_of_birth_from?: string;

  @IsOptional()
  @IsDateString()
  date_of_birth_to?: string;

  /** Allowlisted, not free-text — a raw column name from the client would
   * let `order: { [query.sort]: ... }` in `StudentService.findAll` sort
   * (or, with a crafted key, error on) an arbitrary TypeORM-mapped column.
   * `roll_number` deliberately excluded: it's only unique per class
   * section (see this entity's own composite unique index), so sorting
   * the whole tenant by it produces a confusing, repeating sequence. */
  @IsOptional()
  @IsIn(['full_name', 'registration_number', 'created_at'])
  sort?: 'full_name' | 'registration_number' | 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

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

/**
 * [16.3.3] Filters for `GET /students/ids` — the audience picker's
 * "select all matching" action. Same filter set as `QueryStudentDto` minus
 * pagination/sort, which don't apply to an unpaginated id list.
 */
export class QueryStudentIdsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  section_id?: string;

  // [money-tier review, bug 3] Without these, `QueryStudentIdsDto`
  // structurally satisfies `buildStudentIdsQuery`'s `Pick<QueryStudentDto,
  // ... | 'shift' | 'version' | ...>` parameter type while always reading
  // `undefined` for both at runtime — "select all N matching" would
  // silently ignore a shift/version filter the paginated list just
  // applied, over-broadening a communications audience with no error.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  shift?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @IsOptional()
  @IsEnum(EnrollmentStatus)
  enrollment_status?: EnrollmentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  /** [8.15.33] Exact match, any letter case (the field is free text on the student record). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  religion?: string;

  @IsOptional()
  @IsDateString()
  date_of_birth_from?: string;

  @IsOptional()
  @IsDateString()
  date_of_birth_to?: string;
}

/** [CodeRabbit round 1] response shape for `GET /students/ids` — without
 * this the generated OpenAPI doc had `content?: never` for that route. */
export class StudentIdsResultDto {
  @ApiProperty({ type: [String] })
  ids: string[];

  @ApiProperty()
  total: number;
}

export class CreateGuardianDto {
  @IsString()
  @MaxLength(100)
  @IsNotEmpty()
  @SanitizeText()
  full_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  relationship?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  alternate_phone?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  occupation?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  student_ids?: string[];
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  full_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  relationship?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // [8.11.4]'s edit-guardian dialog sends `''` (not an omitted key) to
  // explicitly clear an optional field — `GuardianService.update` maps
  // that to a real NULL. `@IsEmail()` alone would reject `''` as an
  // invalid address, so it's skipped for that one case; a non-empty
  // value still has to be a real email.
  @IsOptional()
  @ValidateIf((o: UpdateGuardianDto) => o.email !== '')
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  alternate_phone?: string;

  @IsOptional()
  @IsString()
  @SanitizeText()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @SanitizeText()
  occupation?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  /** Staff override of the guardian's reminder opt-out — same field the
   * parent flips on `PATCH /guardians/mine`, one source of truth. [5.4c] */
  // NOT `@IsOptional()`: that skips validation for `null` as well as
  // `undefined`, so an explicit `null` would pass here and only fail at the
  // NOT NULL column as a 500. Validating whenever the key is present turns
  // it into the 400 it should be. Same on UpdateOwnGuardianDto below.
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  notifications_enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  student_ids?: string[];
}

/**
 * The narrow self-service slice of a guardian record: contact details only.
 *
 * Deliberately NOT `UpdateGuardianDto` — that one also allows `full_name`,
 * `relationship`, `address`, `occupation` and, critically, `student_ids`,
 * which would let a guardian relink themselves to arbitrary students
 * (privilege escalation). `forbidNonWhitelisted` rejects any of those with
 * a 400 here. [5.4a]
 */
export class UpdateOwnGuardianDto {
  /** Shape- and length-pinned exactly like `users.phone`: this is the number
   * fee-reminder SMS actually dials, and a parent editing their own record
   * could otherwise store `"call me"` in it. The column is varchar(20), so an
   * unpinned over-long value would also reach Postgres as a 22001 and surface
   * as a 500. `''` still clears the column (the service maps it to NULL), so
   * the checks are skipped for that one value. [5.4a] */
  @IsOptional()
  @ValidateIf((o: UpdateOwnGuardianDto) => o.phone !== '')
  @IsString()
  @MaxLength(20)
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format' })
  phone?: string;

  /** Same pinning as `phone` above — varchar(20), `''` clears. */
  @IsOptional()
  @ValidateIf((o: UpdateOwnGuardianDto) => o.alternate_phone !== '')
  @IsString()
  @MaxLength(20)
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format' })
  alternate_phone?: string;

  // `''` explicitly clears the column (mapped to NULL by the service), and
  // `@IsEmail()` alone would reject it — same trick as UpdateGuardianDto.
  // varchar(100), pinned so an over-long address is a 400 and not a 22001/500.
  @IsOptional()
  @ValidateIf((o: UpdateOwnGuardianDto) => o.email !== '')
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  /** The parent's own opt-out from automated fee reminders. [5.4c] */
  // See the note on UpdateGuardianDto.notifications_enabled — `@IsOptional()`
  // would let an explicit `null` through to a NOT NULL column.
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  notifications_enabled?: boolean;
}

/**
 * One row of a bulk-upload spreadsheet, validated after empty cells have
 * been normalized to `undefined` (see StudentBulkUploadService.toDtoInput).
 * "Essential" fields are required; the rest of the fixed column schema is
 * optional per row.
 */
export class BulkUploadRowDto {
  @IsNotEmpty({ message: 'Missing required field: student_name' })
  @SanitizeText()
  student_name: string;

  @IsNotEmpty({ message: 'Missing required field: class' })
  class: string;

  @IsNotEmpty({ message: 'Missing required field: section' })
  section: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'roll must be a positive whole number' })
  // [2595] Same cap as CreateStudentDto.roll_number: past it, auto-roll in the section 409s.
  @ValidateBy({
    name: 'rollNotAboveMax',
    validator: {
      validate: (v: unknown) =>
        typeof v !== 'string' || !/^\d+$/.test(v) || Number(v) <= ROLL_NUMBER_MAX,
      defaultMessage: () => `roll must not be greater than ${ROLL_NUMBER_MAX}`,
    },
  })
  roll?: string;

  // Blank means auto-numbered (REG-<year>-NNNN); a value is stored as given (varchar(50)),
  // except the auto series itself, which bulk-upload.service.ts refuses.
  // Not on CreateStudentDto: the public API never takes a client-chosen number.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  registration_number?: string;

  @IsNotEmpty({ message: 'Missing required field: guardian1_name' })
  @SanitizeText()
  guardian1_name: string;

  @IsNotEmpty({ message: 'Missing required field: guardian1_phone' })
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format: guardian1_phone' })
  guardian1_phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format: guardian1_email' })
  guardian1_email?: string;

  @IsOptional()
  @SanitizeText()
  guardian2_name?: string;

  @ValidateIf((o) => !!o.guardian2_name)
  @IsNotEmpty({
    message: 'Missing required field: guardian2_phone (required when guardian2_name is provided)',
  })
  @Matches(BD_PHONE_REGEX, { message: 'Invalid phone format: guardian2_phone' })
  guardian2_phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format: guardian2_email' })
  guardian2_email?: string;

  @IsOptional()
  @SanitizeText()
  home_address?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium, { message: 'Invalid preferred_communication value' })
  preferred_communication?: CommunicationMedium;
}

export class BulkUploadErrorDto {
  row: number;
  /** Spreadsheet column the problem sits in (e.g. `guardian1_phone`,
   * `class`, `roll`). Absent when the problem spans the whole row. */
  field?: string;
  /** The offending cell's raw value, so the reporter can show exactly
   * what to fix. Absent when there is no single offending value. */
  value?: string;
  reason: string;
}

export class BulkUploadResultDto {
  total_rows: number;
  success_count: number;
  error_count: number;
  created_student_ids: string[];
  errors: BulkUploadErrorDto[];
}

/** One accepted row, shown so the admin can eyeball the shape before committing. */
export class BulkUploadPreviewRowDto {
  row: number;
  student_name: string;
  class: string;
  section: string;
  guardian1_phone: string;
}

/** Response of `POST /students/bulk-upload/validate`. Nothing has been written yet. */
export class BulkUploadValidateResultDto {
  staging_id: string;
  expires_at: string;
  rows_to_create: number;
  preview: BulkUploadPreviewRowDto[];
  errors: BulkImportErrorDto[];
  hard_error_count: number;

  /** [13.2.3] Seats in use vs the school's limit (`null` = unlimited) and what this file adds. */
  @ApiProperty({
    type: 'object',
    properties: {
      used: { type: 'number' },
      limit: { type: 'number', nullable: true },
      new_rows: { type: 'number' },
    },
    required: ['used', 'limit', 'new_rows'],
  })
  seats: { used: number; limit: number | null; new_rows: number };
}

/** Body of `POST /students/bulk-upload/commit`. */
export class CommitBulkUploadDto {
  // `@IsNotEmpty` alone accepts an object or an array, which then stringifies
  // into the Redis key template as `[object Object]`. The id is a randomUUID.
  @IsUUID('4', { message: 'staging_id must be a valid id' })
  @IsNotEmpty({ message: 'Missing required field: staging_id' })
  staging_id: string;
}

export class QueryGuardianDto {
  /** Matches against full_name, phone, or email (ILIKE, escaped). */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  relationship?: string;

  @IsOptional()
  @IsEnum(CommunicationMedium)
  preferred_communication?: CommunicationMedium;

  // `@Type(() => Boolean)` is deliberately not used here: class-transformer's
  // Boolean coercion is `Boolean(value)`, which treats the *string*
  // `"false"` (what a query param actually is) as truthy — `?is_primary_
  // contact=false` would silently become `true`. This transform parses the
  // two literal strings a query param can actually carry.
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  is_primary_contact?: boolean;

  /** [8.10.7.4.13] true = only guardians with a blank name/relationship or no phone at all (D33). */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  incomplete?: boolean;

  @IsOptional()
  @IsIn(['full_name', 'created_at'])
  sort?: 'full_name' | 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

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

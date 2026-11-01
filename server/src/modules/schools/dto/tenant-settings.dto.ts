import {
  ArrayMaxSize,
  ArrayUnique,
  IsIn,
  IsUUID,
  IsInt,
  IsString,
  IsArray,
  IsBoolean,
  IsObject,
  ArrayNotEmpty,
  IsISO31661Alpha2,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
  Min,
  Max,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { NestedSettings } from '../settings/nested-settings.decorator';
import { OptionalSetting } from '../settings/optional-setting.decorator';
import { IsRegexSourceConstraint } from '../settings/regex-source.validator';
import { MessagingMediumSettings } from '../settings/messaging-settings.validator';
import { AttentionRulesConstraint } from '../settings/attention-rules.validator';
import { UniqueLabelListConstraint } from '../settings/unique-labels.validator';
import {
  ApprovalMode,
  CommunicationMedium,
  DiscountKind,
  FeeType,
  SERIAL_PREFIX_PATTERN,
  TermLabel,
} from '@biddaloy/shared';
import type {
  NumeralSystem,
  CurrencyGrouping,
  CurrencyPosition,
  MediumSettings,
  BackupScheduleMode,
  StudyPlansSettings,
} from '@biddaloy/shared';

/**
 * Mirrors `TENANT_SETTINGS_SCHEMA_VERSION` from `@biddaloy/shared` as a
 * local literal rather than a runtime import of it. A static import of a
 * value added to the shared barrel resolves to `undefined` under this
 * repo's vitest config (`resolve.alias` pointing `@biddaloy/shared` at
 * workspace `src/`, not `dist/`) — see the comment on `SanitizeText` in
 * `common/decorators/sanitize-text.decorator.ts` for the full story. A
 * single-literal constant isn't worth the `require()` workaround; the two
 * must simply be kept in sync, which `tenant-settings-defaults.spec.ts`
 * guards against drifting silently.
 */
export const TENANT_SETTINGS_SCHEMA_VERSION = 1 as const;

export class RegionCurrencyDto {
  @IsString()
  code: string;

  @IsString()
  symbol: string;

  @IsIn(['prefix', 'suffix'])
  position: CurrencyPosition;

  @IsInt()
  @Min(0)
  @Max(4)
  decimals: number;

  @IsIn(['lakh-crore', 'thousand'])
  grouping: CurrencyGrouping;
}

export class RegionDateDto {
  @IsString()
  format: string;

  @IsInt()
  @Min(0)
  @Max(6)
  firstDayOfWeek: number;

  @IsString()
  calendar: string;
}

export class RegionPhoneDto {
  @IsString()
  country: string;

  @IsString()
  @Validate(IsRegexSourceConstraint)
  pattern: string;

  @IsString()
  example: string;

  @IsString()
  displayFormat: string;
}

export class RegionAddressDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  fields: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  order: string[];
}

export class RegionAcademicYearDto {
  @IsInt()
  @Min(1)
  @Max(12)
  startMonth: number;
}

export class RegionIdentifiersDto {
  @IsString()
  @Validate(IsRegexSourceConstraint)
  national: string;

  // Empty string is a legitimate "no student-ID format enforced" — see
  // DEFAULT_REGION_SETTINGS — and compiles to a match-everything regex,
  // so it needs no special case here.
  @IsString()
  @Validate(IsRegexSourceConstraint)
  student: string;
}

/**
 * `region.calendar` (17.1.1/17.1.2) — what a tenant calls a grading period
 * on its academic calendar. Optional: a tenant with no calendar settings
 * yet resolves to `TermLabel.TERM` via `DEFAULT_REGION_SETTINGS`.
 */
export class RegionCalendarDto {
  @IsIn(Object.values(TermLabel))
  termLabel: TermLabel;
}

export class RegionSettingsDto {
  @IsString()
  locale: string;

  // ISO 3166-1 alpha-2, e.g. 'BD' (D11) — picks the default public-holiday
  // source for a tenant's calendar (Epic 17).
  // `@Matches` keeps case strict (rejects 'bd') — `@IsISO31661Alpha2` alone
  // is case-insensitive per its underlying `validator` library, so on its
  // own it would accept a lowercase code and store it un-normalised,
  // producing a value like 'bd' next to `DEFAULT_REGION_SETTINGS.country`'s
  // 'BD'. Chosen behaviour: reject anything but a real, uppercase ISO
  // 3166-1 alpha-2 code (`tenant-settings.dto.spec.ts` documents this).
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO 3166-1 alpha-2 code, e.g. BD' })
  @IsISO31661Alpha2({ message: 'country must be a real ISO 3166-1 alpha-2 country code' })
  country: string;

  @NestedSettings(() => RegionCurrencyDto)
  currency: RegionCurrencyDto;

  @IsIn(['latin', 'bengali'])
  numerals: NumeralSystem;

  @NestedSettings(() => RegionDateDto)
  date: RegionDateDto;

  @NestedSettings(() => RegionPhoneDto)
  phone: RegionPhoneDto;

  @NestedSettings(() => RegionAddressDto)
  address: RegionAddressDto;

  @NestedSettings(() => RegionAcademicYearDto)
  academicYear: RegionAcademicYearDto;

  @NestedSettings(() => RegionIdentifiersDto)
  identifiers: RegionIdentifiersDto;

  @IsString()
  timezone: string;

  @OptionalSetting()
  @NestedSettings(() => RegionCalendarDto)
  calendar?: RegionCalendarDto;
}

export class CommunicationsSettingsDto {
  @MessagingMediumSettings(CommunicationMedium.SMS) sms?: MediumSettings;
  @MessagingMediumSettings(CommunicationMedium.WHATSAPP) whatsapp?: MediumSettings;
  @MessagingMediumSettings(CommunicationMedium.EMAIL) email?: MediumSettings;
  @MessagingMediumSettings(CommunicationMedium.MESSENGER) messenger?: MediumSettings;
}

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AutoAbsentNotificationDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @Matches(HH_MM_PATTERN)
  cutoffTime: string;
}

export class ShiftTimeDto {
  @IsUUID()
  shiftId: string;

  @IsString()
  @Matches(HH_MM_PATTERN)
  lateAfter: string;

  @IsString()
  @Matches(HH_MM_PATTERN)
  absentAfter: string;
}

export class SpecialPeriodTimeDto {
  // A period grid may start at 0, the same as PeriodSlotItemDto.sequence.
  @IsInt()
  @Min(0)
  @Max(30)
  sequence: number;

  @IsString()
  @Matches(HH_MM_PATTERN)
  startsAt: string;

  @IsString()
  @Matches(HH_MM_PATTERN)
  endsAt: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class SpecialTimingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @Matches(ISO_DATE_PATTERN)
  from: string;

  @Matches(ISO_DATE_PATTERN)
  to: string;

  @ValidateIf((o: SpecialTimingDto) => o.shiftId !== null)
  @IsUUID()
  shiftId: string | null;

  @Matches(HH_MM_PATTERN)
  lateAfter: string;

  @Matches(HH_MM_PATTERN)
  absentAfter: string;

  @IsArray()
  @ArrayMaxSize(30)
  // `?.`: a null element is the nested validator's 400 to report, not a throw here.
  @ArrayUnique((p: SpecialPeriodTimeDto | null) => p?.sequence)
  @ValidateNested({ each: true })
  @Type(() => SpecialPeriodTimeDto)
  periods: SpecialPeriodTimeDto[];
}

/** Each entry ends on/after it starts, each period ends after it starts, and
 * two entries of the same shift (null = its own group) never overlap. */
@ValidatorConstraint({ name: 'specialTimingsValid' })
export class SpecialTimingsValid implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return true;
    // Skip malformed elements: the nested validators report them as a 400.
    // Dereferencing them here would throw, and class-validator turns that into a 500.
    const list = value.filter((t): t is SpecialTimingDto => !!t && typeof t === 'object');
    for (const t of list) {
      if (t.from > t.to) return false;
      if (Array.isArray(t.periods) && t.periods.some((p) => !!p && p.startsAt >= p.endsAt))
        return false;
    }
    return list.every((a, i) =>
      list.every((b, j) => j <= i || a.shiftId !== b.shiftId || a.to < b.from || b.to < a.from),
    );
  }

  defaultMessage(): string {
    return 'Special timings for the same shift must not overlap, and each must end on or after it starts.';
  }
}

export class PeriodAttendanceDto {
  @IsBoolean()
  enabled: boolean;
}

export class ArrivalNoticeDto {
  @IsBoolean()
  enabled: boolean;

  @IsBoolean()
  smsAllowed: boolean;
}

export class AttendancePolicyDto {
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weeklyOffDays: number[];

  /**
   * Server-maintained (see tenant-settings-merge.util). Accepted so a client
   * that echoes the full GET payload back is not rejected by whitelist
   * validation; the merge ignores whatever is sent.
   */
  @ApiPropertyOptional({
    type: 'array',
    readOnly: true,
    items: {
      type: 'object',
      required: ['until', 'days'],
      properties: {
        until: { type: 'string', format: 'date' },
        days: { type: 'array', items: { type: 'integer' } },
      },
    },
  })
  @IsOptional()
  @IsArray()
  weeklyOffHistory?: Array<{ until: string; days: number[] }>;

  @IsString()
  @Matches(HH_MM_PATTERN)
  lateAfter: string;

  @IsString()
  @Matches(HH_MM_PATTERN)
  absentAfter: string;

  @IsInt()
  @Min(0)
  @Max(365)
  correctionWindowDays: number;

  @IsInt()
  @Min(0)
  @Max(100)
  lowAttendanceThresholdPercent: number;

  @IsBoolean()
  lateCountsAsPresent: boolean;

  @IsBoolean()
  leaveCountsAsWorkingDay: boolean;

  @IsIn(['WORKING_DAYS', 'MARKED_DAYS'])
  percentageDenominator: 'WORKING_DAYS' | 'MARKED_DAYS';

  @IsBoolean()
  allowFutureDates: boolean;

  @NestedSettings(() => AutoAbsentNotificationDto)
  autoAbsentNotification: AutoAbsentNotificationDto;

  @OptionalSetting()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique((s: ShiftTimeDto) => s.shiftId)
  @ValidateNested({ each: true })
  @Type(() => ShiftTimeDto)
  shiftTimes?: ShiftTimeDto[];

  @OptionalSetting()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SpecialTimingDto)
  @Validate(SpecialTimingsValid)
  specialTimings?: SpecialTimingDto[];

  @OptionalSetting()
  @NestedSettings(() => PeriodAttendanceDto)
  periodAttendance?: PeriodAttendanceDto;

  @OptionalSetting()
  @NestedSettings(() => ArrivalNoticeDto)
  arrivalNotice?: ArrivalNoticeDto;
}

/**
 * `subjectPeriodsPerWeek`'s keys are arbitrary subject ids, not a fixed
 * enum (unlike `lateFees`/`FeeType` below) — validated by hand rather than
 * `@ValidateNested()` for the same arbitrary-key-map reason as
 * `LateFeesMapConstraint`.
 */
@ValidatorConstraint({ name: 'isSubjectPeriodsPerWeekMap', async: false })
export class SubjectPeriodsPerWeekMapConstraint implements ValidatorConstraintInterface {
  private lastError = '';

  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) {
      this.lastError = 'subjectPeriodsPerWeek must be an object keyed by subject id';
      return false;
    }
    for (const [subjectId, target] of Object.entries(value as Record<string, unknown>)) {
      if (!subjectId.trim()) {
        this.lastError = 'subjectPeriodsPerWeek has an empty subject id key';
        return false;
      }
      if (!Number.isInteger(target) || (target as number) < 1) {
        this.lastError = `subjectPeriodsPerWeek.${subjectId} must be a positive integer`;
        return false;
      }
    }
    return true;
  }

  defaultMessage(): string {
    return this.lastError || 'subjectPeriodsPerWeek is invalid';
  }
}

/**
 * `routine.*` (21.1.1) — class-timetable generation constraints (D7).
 * `maxPeriodsPerTeacherPerDay`/`maxConsecutivePeriods` are nullable caps:
 * `null` (or omitted) means no cap.
 */
export class RoutineSettingsDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  defaultChangeoverMinutes: number;

  @ApiPropertyOptional({ minimum: 1, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPeriodsPerTeacherPerDay?: number | null;

  @ApiPropertyOptional({ minimum: 1, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxConsecutivePeriods?: number | null;

  /** [21.1.1] Target periods/week per subject, keyed by subject id. Subject
   * ids are arbitrary tenant data (not a fixed enum like `FeeType`), so this
   * validates shape (non-empty string keys, positive-int values) rather
   * than membership — the greedy-fill service (wave 4) is the one that
   * checks a key against the tenant's real subject list. */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 1 },
    description: 'Keyed by subject id. Omitted subject = builder enforces no target for it.',
  })
  @IsOptional()
  @Validate(SubjectPeriodsPerWeekMapConstraint)
  subjectPeriodsPerWeek?: Record<string, number>;
}

/**
 * `organisation.{shifts,versions,groups}` (33.1.1) — a tenant's own
 * vocabulary for shift/version/group. Each list: trimmed non-empty entries,
 * at most 50 characters, at most 20 entries, no case-insensitive duplicate.
 */
export class OrganisationSettingsDto {
  @IsArray()
  @Validate(UniqueLabelListConstraint)
  shifts: string[];

  @IsArray()
  @Validate(UniqueLabelListConstraint)
  versions: string[];

  @IsArray()
  @Validate(UniqueLabelListConstraint)
  groups: string[];
}

/**
 * Per-tenant login policy (12.5). `otpLoginEnabled` is a school's off-switch
 * for passwordless phone+OTP sign-in — not a secret, no `@Secret()`. A user
 * with memberships in several tenants is allowed OTP login only if *every*
 * tenant they belong to has this `!== false` (deny wins) — see
 * `OtpLoginService.allowed`.
 */
export class AuthSettingsDto {
  @IsBoolean()
  otpLoginEnabled: boolean;
}

/**
 * `backup.schedule` (14.12.1/#615 D10) — not a secret, no `@Secret()`.
 */
export class BackupSettingsDto {
  @IsIn(['OFF', 'WEEKLY', 'DAILY'])
  schedule: BackupScheduleMode;
}

/**
 * One fee type's late-fee rule, `settings.fees.lateFees[feeType]` (16.7.4).
 * `LateFeeService.applyDue` reads this per fee type — `enabled: false` (or
 * the fee type simply absent from the map) means that fee type never gets
 * a late-fee bill.
 */
export class LateFeeRuleDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ minimum: 0, maximum: 60 })
  @IsInt()
  @Min(0)
  @Max(60)
  grace_days: number;

  @ApiProperty({ enum: DiscountKind })
  @IsIn(Object.values(DiscountKind))
  kind: DiscountKind;

  @ApiProperty()
  @IsNotEmpty()
  value: number;
}

/**
 * `lateFees`'s keys are `FeeType` values — validated by hand rather than
 * `@ValidateNested()` (which needs a fixed property list, not an
 * arbitrary-key map) against each value's `LateFeeRuleDto` shape.
 */
@ValidatorConstraint({ name: 'isLateFeesMap', async: false })
export class LateFeesMapConstraint implements ValidatorConstraintInterface {
  private lastError = '';

  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) {
      this.lastError = 'lateFees must be an object keyed by fee type';
      return false;
    }
    for (const [feeType, rule] of Object.entries(value as Record<string, unknown>)) {
      if (!Object.values(FeeType).includes(feeType as FeeType)) {
        this.lastError = `"${feeType}" is not a known fee type`;
        return false;
      }
      // Epic 38 D10: a FINE bill never gets a late fee — same rule as
      // LATE_FEE never getting one (belt-and-braces with
      // `LateFeeService.applyDue`'s own runtime skip).
      if (feeType === FeeType.FINE) {
        this.lastError = 'lateFees.FINE is not allowed — a fine never gets a late fee';
        return false;
      }
      if (typeof rule !== 'object' || rule === null) {
        this.lastError = `lateFees.${feeType} must be an object`;
        return false;
      }
      const r = rule as Record<string, unknown>;
      if (typeof r.enabled !== 'boolean') {
        this.lastError = `lateFees.${feeType}.enabled must be a boolean`;
        return false;
      }
      if (
        !Number.isInteger(r.grace_days) ||
        (r.grace_days as number) < 0 ||
        (r.grace_days as number) > 60
      ) {
        this.lastError = `lateFees.${feeType}.grace_days must be an integer 0-60`;
        return false;
      }
      if (!Object.values(DiscountKind).includes(r.kind as DiscountKind)) {
        this.lastError = `lateFees.${feeType}.kind must be PERCENT or FLAT`;
        return false;
      }
      if (typeof r.value !== 'number' || r.value < 0) {
        this.lastError = `lateFees.${feeType}.value must be a non-negative number`;
        return false;
      }
    }
    return true;
  }

  defaultMessage(): string {
    return this.lastError || 'lateFees is invalid';
  }
}

/**
 * `settings.fees` (16.2.1) — who may approve, and how, is data. `approvalMode`
 * is what `SchoolSettingsReader.feesApprovalMode` (16.2.2's step-up approval
 * flow) reads to decide whether PASSWORD is an allowed verification method
 * alongside OTP.
 */
@ApiExtraModels(LateFeeRuleDto)
export class FeesSettingsDto {
  @ApiProperty({ enum: ApprovalMode })
  @IsIn(Object.values(ApprovalMode))
  approvalMode: ApprovalMode;

  @ApiProperty()
  @IsBoolean()
  notifyOnManualGenerationDefault: boolean;

  @ApiProperty()
  @IsBoolean()
  notifyOnScheduleDefault: boolean;

  /** [16.7.4] Per-fee-type late-fee rule. Omitted/absent fee type = no
   * late fee ever applies to that fee type.
   *
   * [CodeRabbit review, PR #801] `@ApiPropertyOptional` here is load-bearing,
   * not decorative: nestjs/swagger's CLI-plugin reflection can describe a
   * plain class property automatically, but not a mapped type like
   * `Partial<Record<FeeType, LateFeeRuleDto>>` — without this, the
   * generated OpenAPI (and therefore ui/src/api/schema.d.ts) described
   * `lateFees` as `Record<string, never>`, which rejected every real
   * field (`enabled`, `grace_days`, `kind`, `value`) at the UI's type
   * level even though the server accepted and validated them correctly. */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(LateFeeRuleDto) },
    description: 'Keyed by FeeType. Omitted key = that fee type never gets a late fee.',
  })
  @IsOptional()
  @Validate(LateFeesMapConstraint)
  lateFees?: Partial<Record<FeeType, LateFeeRuleDto>>;

  /** [Epic 38 D10] Days after creation a fine is due. Default 7. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  fineDueDays?: number;

  /** [Epic 78 D1] `true` = a payment reversal always needs a second person.
   * Default `false`: self-approval is allowed only in a single-admin school. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireSecondApprover?: boolean;
}

/** [28.2.1] `settings.evaluations` — incident notification options. Absent = off. */
export class EvaluationsSettingsDto {
  /** SMS to ACR_WRITE holders on a new incident (fixed text, never the incident). Default off. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  incidentSmsEnabled?: boolean;
}

/** [52.2.6] `settings.applications`. Absent = off. */
export class ApplicationsSettingsDto {
  /** Guardian SMS on a final decision (D18). Default off. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  smsOnDecision?: boolean;
}

/** [TIME-11] `settings.homework`. Both guardian SMS notices default off. */
export class HomeworkSettingsDto {
  /** Text guardians when homework is assigned. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyOnAssign?: boolean;

  /** Text guardians the day after the due date if not submitted. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyDefaulters?: boolean;
}

/** [67.1.06] quiet hours window. */
export class AttentionQuietHoursDto {
  @ApiProperty({ example: '21:00' })
  @IsString()
  @Matches(HH_MM_PATTERN)
  start: string;

  @ApiProperty({ example: '07:00' })
  @IsString()
  @Matches(HH_MM_PATTERN)
  end: string;
}

/** [67.1.06] `settings.attention` — every field optional so a PATCH may send one. */
export class AttentionSettingsDto {
  /** Per-rule `{ enabled }`; CRITICAL rules cannot be switched off (D34). */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  @Validate(AttentionRulesConstraint)
  rules?: Record<string, { enabled: boolean }>;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  attendanceGraceMinutes?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  classStartingLeadMinutes?: number;

  @ApiPropertyOptional({ example: '07:00' })
  @IsOptional()
  @Matches(HH_MM_PATTERN)
  dailyAt?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @Matches(HH_MM_PATTERN)
  eveningAt?: string;

  @ApiPropertyOptional({ type: () => AttentionQuietHoursDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AttentionQuietHoursDto)
  quietHours?: AttentionQuietHoursDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  guardianSmsFallback?: boolean;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  guardianSmsDailyCap?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  smsCreditLowThreshold?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  failedMessagesThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  escalateAttendanceToHeads?: boolean;
}

/** [48.1.03] `settings.documents` — Epic 48 D9 / D24. */
export class DocumentsSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withholdAdmitCardForDues?: boolean;

  /** `null` clears a stored prefix (the block is shallow-merged). */
  @ApiPropertyOptional({ example: 'DAHS', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(SERIAL_PREFIX_PATTERN)
  serialPrefix?: string | null;
}

export class DashboardRiskThresholdsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 30 })
  @OptionalSetting()
  @IsInt()
  @Min(1)
  @Max(30)
  absentStreakDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @OptionalSetting()
  @IsInt()
  @Min(1)
  @Max(100)
  monthlyAttendancePct?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @OptionalSetting()
  @IsInt()
  @Min(1)
  @Max(20)
  failedSubjects?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @OptionalSetting()
  @IsInt()
  @Min(1)
  @Max(365)
  overdueDays?: number;
}

/** [8.10.7] `settings.dashboard` — at-risk thresholds (D7), committee target (D23), digest time (D31). */
export class DashboardSettingsDto {
  @OptionalSetting()
  @NestedSettings(() => DashboardRiskThresholdsDto)
  risk?: DashboardRiskThresholdsDto;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @OptionalSetting()
  @IsInt()
  @Min(1)
  @Max(100)
  committeeAttendanceTargetPct?: number;

  @ApiPropertyOptional({ example: '07:30' })
  @OptionalSetting()
  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'digestTime must be HH:mm' })
  digestTime?: string;
}

/** [66.1.04] `settings.studyPlans` — reminder and digest timing (D25, D26).
 * `@OptionalSetting` (not `@IsOptional`): an explicit `null` is a 400, since
 * clearing a field is not supported — omit it to keep the default. */
export class StudyPlansSettingsDto implements Partial<StudyPlansSettings> {
  @ApiPropertyOptional()
  @OptionalSetting()
  @IsString()
  @Matches(HH_MM_PATTERN)
  statusDeadline?: string;

  @ApiPropertyOptional()
  @OptionalSetting()
  @IsString()
  @Matches(HH_MM_PATTERN)
  reminderTime?: string;

  @ApiPropertyOptional()
  @OptionalSetting()
  @IsInt()
  @Min(1)
  @Max(10)
  escalateAfterSchoolDays?: number;

  @ApiPropertyOptional()
  @OptionalSetting()
  @IsString()
  @Matches(HH_MM_PATTERN)
  weeklyDigestTime?: string;

  @ApiPropertyOptional()
  @OptionalSetting()
  @IsBoolean()
  guardianDigestSms?: boolean;
}

/**
 * [33.3.1] An explicit rename instruction for one `organisation` vocabulary
 * list, carried alongside a settings PATCH rather than inferred from the
 * `organisation` diff itself — inferring "Morning removed, Prabhati added"
 * as a rename would turn an unrelated delete-then-add into a silent mass
 * `UPDATE` of every `classes`/`class_sections` row using the deleted value.
 * `SchoolsService.updateSettings` strips this out of the persisted
 * `settings` jsonb before merging (it's an instruction *for* this write,
 * not a stored setting) and uses it to rewrite affected rows in the same
 * transaction as the settings save.
 */
export class OrganisationRenameDto {
  @IsIn(['shifts', 'versions', 'groups'])
  list: 'shifts' | 'versions' | 'groups';

  @IsString()
  @IsNotEmpty()
  from: string;

  @IsString()
  @IsNotEmpty()
  to: string;
}

export class TenantSettingsDto {
  @IsIn([TENANT_SETTINGS_SCHEMA_VERSION])
  version: typeof TENANT_SETTINGS_SCHEMA_VERSION;

  /** [33.3.1] See `OrganisationRenameDto`. Not part of the stored settings
   * shape — a write instruction only. */
  @ApiPropertyOptional({ type: [OrganisationRenameDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrganisationRenameDto)
  organisationRenames?: OrganisationRenameDto[];

  @OptionalSetting()
  @NestedSettings(() => RegionSettingsDto)
  region?: RegionSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => CommunicationsSettingsDto)
  communications?: CommunicationsSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => AttendancePolicyDto)
  attendance?: AttendancePolicyDto;

  @OptionalSetting()
  @NestedSettings(() => RoutineSettingsDto)
  routine?: RoutineSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => OrganisationSettingsDto)
  organisation?: OrganisationSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => AuthSettingsDto)
  auth?: AuthSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => BackupSettingsDto)
  backup?: BackupSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => FeesSettingsDto)
  fees?: FeesSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => EvaluationsSettingsDto)
  evaluations?: EvaluationsSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => ApplicationsSettingsDto)
  applications?: ApplicationsSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => HomeworkSettingsDto)
  homework?: HomeworkSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => DocumentsSettingsDto)
  documents?: DocumentsSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => StudyPlansSettingsDto)
  studyPlans?: StudyPlansSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => AttentionSettingsDto)
  attention?: AttentionSettingsDto;

  @OptionalSetting()
  @NestedSettings(() => DashboardSettingsDto)
  dashboard?: DashboardSettingsDto;
}

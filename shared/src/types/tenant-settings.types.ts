import type { ApprovalMode, TermLabel } from '../enums';
import type { AttentionSettings } from './attention';

/**
 * Shape of the JSON blob stored on `schools.settings`. `version` is a
 * discriminator so a future shape change is migratable rather than a
 * breaking read — see server/src/modules/schools for the resolver that
 * merges a partially-configured or `null` blob over defaults.
 *
 * Fields marked `→ secret` in the comments are encrypted at rest (#8.7.8)
 * and write-only over the API (#8.7.9) — the server-side DTOs in
 * `server/src/modules/schools/dto/tenant-settings.dto.ts` mark the same
 * fields with a `@Secret()` decorator so encryption and redaction can find
 * them generically instead of via a hand-maintained path list.
 */
export const TENANT_SETTINGS_SCHEMA_VERSION = 1 as const;

export type NumeralSystem = 'latin' | 'bengali';
export type CurrencyGrouping = 'lakh-crore' | 'thousand';
export type CurrencyPosition = 'prefix' | 'suffix';

export interface RegionCurrencySettings {
  code: string;
  symbol: string;
  position: CurrencyPosition;
  decimals: number;
  grouping: CurrencyGrouping;
}

export interface RegionDateSettings {
  format: string;
  firstDayOfWeek: number;
  calendar: string;
}

export interface RegionPhoneSettings {
  country: string;
  pattern: string;
  example: string;
  displayFormat: string;
}

export interface RegionAddressSettings {
  fields: string[];
  order: string[];
}

export interface RegionAcademicYearSettings {
  startMonth: number;
}

export interface RegionIdentifierSettings {
  national: string;
  student: string;
}

/**
 * `region.calendar` (17.1.1) — what a tenant calls a grading period on its
 * academic calendar. Read by the calendar module (Epic 17) wherever a term/
 * semester/trimester label is shown.
 */
export interface CalendarSettings {
  /** Default `'TERM'`. */
  termLabel: TermLabel;
}

export interface RegionSettings {
  locale: string;
  /** ISO 3166-1 alpha-2 country code, e.g. `'BD'` (D11). Used to pick the
   * default public-holiday source for a tenant's calendar (Epic 17). */
  country: string;
  currency: RegionCurrencySettings;
  numerals: NumeralSystem;
  date: RegionDateSettings;
  phone: RegionPhoneSettings;
  address: RegionAddressSettings;
  academicYear: RegionAcademicYearSettings;
  identifiers: RegionIdentifierSettings;
  timezone: string;
  calendar?: CalendarSettings;
}

/**
 * How a school counts attendance. Every attendance percentage and
 * low-attendance flag downstream depends on this, so it lives here and
 * every consumer (marking UI, summaries, exam module in a later epic)
 * reads one policy instead of re-deriving school rules.
 */
export interface AttendancePolicySettings {
  /** 0 = Sunday … 6 = Saturday. Bangladesh default: Friday only. */
  weeklyOffDays: number[];
  /** Server-maintained. Before `until` (exclusive, YYYY-MM-DD) these were the weekly off days. Sorted by `until`. Never sent by clients. */
  weeklyOffHistory?: Array<{ until: string; days: number[] }>;
  /** Local 'HH:mm'. A check-in after this is LATE. */
  lateAfter: string;
  /** Local 'HH:mm'. A check-in after this is ABSENT, not LATE. */
  absentAfter: string;
  /** Days a teacher may edit their own marks without ATTENDANCE_CORRECT. */
  correctionWindowDays: number;
  /** Below this a student is flagged low-attendance. BD board eligibility
   * is commonly 75. */
  lowAttendanceThresholdPercent: number;
  /** Does a LATE day count toward the numerator? */
  lateCountsAsPresent: boolean;
  /** Does an approved LEAVE day stay in the denominator? */
  leaveCountsAsWorkingDay: boolean;
  /** WORKING_DAYS = full calendar. MARKED_DAYS = only days the register
   * was finalized. A school that marks unreliably wants MARKED_DAYS. */
  percentageDenominator: 'WORKING_DAYS' | 'MARKED_DAYS';
  /** Is marking a future date allowed at all, and if so only LEAVE (9.3
   * enforces this). */
  allowFutureDates: boolean;
  autoAbsentNotification: { enabled: boolean; cutoffTime: string };
  /** [84.1.1] Arrival notices. The resolver default is set in 84.1.4
   * (`attendance-policy.util.ts`). */
  arrivalNotice?: { enabled: boolean; smsAllowed: boolean };
  /** Per-shift override of `lateAfter`/`absentAfter` (local 'HH:mm'). A
   * class whose shift has no entry uses the tenant pair above. */
  shiftTimes?: Array<{ shiftId: string; lateAfter: string; absentAfter: string }>;
  /** Date-ranged timings (Ramadan, winter). `from`/`to` inclusive 'YYYY-MM-DD'; `shiftId: null` = every shift and staff; times 'HH:mm'; `periods` overrides start/end by period sequence. Same-shift ranges never overlap (server-validated). */
  specialTimings?: Array<{
    name: string;
    from: string;
    to: string;
    shiftId: string | null;
    lateAfter: string;
    absentAfter: string;
    periods: Array<{ sequence: number; startsAt: string; endsAt: string }>;
  }>;
  /** Period-by-period attendance on top of the daily register. */
  periodAttendance?: { enabled: boolean };
}

/**
 * `routine.*` (21.1.1) — class-timetable generation constraints. Every
 * later routine-builder ticket (Epic 21.0) reads these instead of
 * hardcoding scheduling defaults.
 */
export interface RoutineSettings {
  /** Minutes reserved between two consecutive periods for changeover
   * (D7). */
  defaultChangeoverMinutes: number;
  /** Cap on periods one teacher may teach in a day. `null`/unset = no
   * cap. */
  maxPeriodsPerTeacherPerDay?: number | null;
  /** Cap on periods in a row without a break. `null`/unset = no cap. */
  maxConsecutivePeriods?: number | null;
  /** Target periods/week for a subject, keyed by subject id. The
   * routine-builder's greedy fill (Epic 21.0 wave 4) reads this to know how
   * many slots to place per subject; omitted subject = builder doesn't
   * enforce a target for it. */
  subjectPeriodsPerWeek?: Record<string, number>;
}

/**
 * `organisation.{shifts,versions,groups}` (33.1.1) — a tenant's own
 * vocabulary for shift/version/group, e.g. `shifts: ['Morning', 'Day']`.
 * These are settings values, not entities (Epic 33.0 D2/D3): a school picks
 * its own words, so this list is what every later Epic 33 ticket reads
 * instead of a hardcoded enum.
 */
export interface OrganisationSettings {
  shifts: string[];
  versions: string[];
  groups: string[];
}

/**
 * Per-tenant login policy. `otpLoginEnabled` (default true) is a school's
 * off-switch for passwordless phone+OTP sign-in (12.5). A user who belongs
 * to more than one tenant is allowed OTP login only if *every* tenant they
 * belong to has this `!== false` — deny wins, so one school turning it off
 * can't be bypassed via another membership.
 */
export interface AuthSettings {
  otpLoginEnabled: boolean;
}

/** D20: validity is a runtime check against the server registry / fetched schema. */
export type MessagingProviderName = string;
/** @deprecated use MessagingProviderName. */
export type SmsGatewayName = MessagingProviderName;

/** `sms.metering` — [15.6/#508 D5] OFF (default) is today's unmetered
 * behaviour; PLATFORM meters sends against `sms_credit_ledger`/
 * `sms_credit_balance` (#545/#546). Absent ⇒ OFF. */
export type SmsMeteringMode = 'OFF' | 'PLATFORM';

/** One provider's saved config. Secret fields are `null` when explicitly cleared. */
export type ProviderConfigValues = Record<string, string | null | undefined>;

/**
 * D6: `communications.<medium> = { provider, <providerName>: {...}, metering? }`.
 * Missing `provider` defaults to the medium's sole vendor. The deprecated flat
 * keys (`accessToken`, `host`, …) are still read as-is until W2.01 removes them.
 */
export interface MediumSettings {
  provider?: MessagingProviderName;
  metering?: SmsMeteringMode;
  /** @deprecated flat pre-D6 keys; read-only compat. */
  phoneNumberId?: string;
  /** @deprecated */
  apiVersion?: string;
  /** @deprecated */
  accessToken?: string | null;
  /** @deprecated */
  host?: string;
  /** @deprecated */
  port?: number;
  /** @deprecated */
  user?: string;
  /** @deprecated */
  from?: string;
  /** @deprecated */
  password?: string | null;
  /** @deprecated */
  pageId?: string;
  /** Per-provider blocks, keyed by provider name. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- index signature must admit the typed keys above; callers narrow to ProviderConfigValues (W2 removes the flat keys)
  [providerName: string]: any;
}

export type SmsSettings = MediumSettings;
export type WhatsAppSettings = MediumSettings;
export type EmailSettings = MediumSettings;
export type MessengerSettings = MediumSettings;

export interface CommunicationsSettings {
  sms?: MediumSettings;
  whatsapp?: MediumSettings;
  email?: MediumSettings;
  messenger?: MediumSettings;
}

export type BackupScheduleMode = 'OFF' | 'WEEKLY' | 'DAILY';

/** `backup.schedule` — [14.12.1/#427 D10]. WEEKLY (Sunday 02:00 in the
 * school's own timezone) is the default: a school opts out, not in. */
export interface BackupSettings {
  schedule: BackupScheduleMode;
}

/**
 * `settings.fees` (16.2.1) — who may approve, and how, is data, not code.
 * `approvalMode` is what `SchoolSettingsReader.feesApprovalMode` (16.2.2's
 * step-up approval flow) reads to decide whether PASSWORD is an allowed
 * verification method alongside OTP.
 */
export interface FeesSettings {
  /** Default `'OTP'` — a school opts into password-or-OTP, not out of it. */
  approvalMode: ApprovalMode;
  /** Default `false` — a manual fee generation run doesn't notify parents
   * unless the school turns it on. */
  notifyOnManualGenerationDefault: boolean;
  /** Default `true` — a scheduled/recurring generation run does notify
   * parents unless the school turns it off. */
  notifyOnScheduleDefault: boolean;
  /** Days after creation a fine is due (Epic 38 D10). Default 7. */
  fineDueDays: number;
  /** Default `false` (Epic 78 D1). `true` = a payment reversal always needs a
   * second person; `false` = an admin may approve their own reversal only when
   * they are the school's only active approver. */
  requireSecondApprover?: boolean;
}

/** Which curriculum preset (Epic 35.0) a tenant applied, and when. */
export interface PresetSettings {
  id: string;
  version: string;
  /** ISO timestamp. */
  appliedAt: string;
  appliedByUserId: string;
}

/**
 * `evaluations.*` (28.2.1) — incident notification options. Absent = off.
 * Push is always on; this only gates the SMS.
 */
export interface EvaluationsSettings {
  /** SMS to ACR_WRITE holders on a new incident (fixed text, never the incident). */
  incidentSmsEnabled?: boolean;
}

/** `applications.*` (52.1.1). */
export interface ApplicationsSettings {
  /** Guardian SMS on a final decision (D18). Default false. */
  smsOnDecision?: boolean;
}

/** `homework.*` (TIME-11). Both default off. */
export interface HomeworkSettings {
  notifyOnAssign?: boolean;
  notifyDefaulters?: boolean;
}

/** `documents.*` (48.1.01) — student document options. */
export interface DocumentsSettings {
  /** Refuse an admit card while the student has dues (D9). Default off. */
  withholdAdmitCardForDues?: boolean;
  /** Short code in front of certificate serials, `SERIAL_PREFIX_PATTERN` (D24). */
  serialPrefix?: string;
}

/** `studyPlans.*` (66.1.01) — reminder and digest timing. */
export interface StudyPlansSettings {
  statusDeadline: string; // 'HH:mm', default '18:00'
  reminderTime: string; // 'HH:mm', default '08:00'
  escalateAfterSchoolDays: number; // default 2
  weeklyDigestTime: string; // 'HH:mm', default '17:00'
  guardianDigestSms: boolean; // default false (D26)
}

/** [66.1.04] D25 timings, D26 guardian SMS off by default. Server and admin UI share it. */
export const DEFAULT_STUDY_PLANS_SETTINGS: StudyPlansSettings = {
  statusDeadline: '18:00',
  reminderTime: '08:00',
  escalateAfterSchoolDays: 2,
  weeklyDigestTime: '17:00',
  guardianDigestSms: false,
};

/** `dashboard.*` (8.10.7) — at-risk thresholds (D7), committee attendance target (D23), digest time (D31). */
export interface DashboardRiskThresholds {
  absentStreakDays: number; // default 3
  monthlyAttendancePct: number; // default 75
  failedSubjects: number; // default 1
  overdueDays: number; // default 60
}

export interface DashboardSettings {
  risk: DashboardRiskThresholds;
  committeeAttendanceTargetPct: number; // default 90
  digestTime: string; // 'HH:mm', school-local, default '07:30'
}

export interface TenantSettings {
  version: typeof TENANT_SETTINGS_SCHEMA_VERSION;
  region?: RegionSettings;
  communications?: CommunicationsSettings;
  attendance?: AttendancePolicySettings;
  routine?: RoutineSettings;
  organisation?: OrganisationSettings;
  preset?: PresetSettings;
  auth?: AuthSettings;
  backup?: BackupSettings;
  fees?: FeesSettings;
  evaluations?: EvaluationsSettings;
  applications?: ApplicationsSettings;
  homework?: HomeworkSettings;
  documents?: DocumentsSettings;
  studyPlans?: StudyPlansSettings;
  attention?: AttentionSettings;
  dashboard?: DashboardSettings;
}

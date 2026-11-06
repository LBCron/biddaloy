import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import {
  ApprovalMode,
  DailyAttendanceSource,
  DEFAULT_CONDUCT_ITEMS,
  DEFAULT_STUDY_PLANS_SETTINGS,
  TermLabel,
} from '@biddaloy/shared';
import type {
  AttendancePolicySettings,
  AttentionSettings,
  AuthSettings,
  BackupSettings,
  DashboardSettings,
  DocumentsSettings,
  FeesSettings,
  OrganisationSettings,
  RegionSettings,
  RoutineSettings,
  TenantSettings,
} from '@biddaloy/shared';

/**
 * bn-BD region defaults. #8.7.2 owns the canonical `RegionConfig` used by
 * the SPA; this is the server-side equivalent so a school with no stored
 * `region` block still resolves to sensible values instead of throwing.
 */
export const DEFAULT_REGION_SETTINGS: RegionSettings = {
  locale: 'bn-BD',
  // [17.1.2] ISO 3166-1 alpha-2 — picks the default public-holiday source
  // for a tenant's calendar (Epic 17, D11).
  country: 'BD',
  currency: {
    code: 'BDT',
    symbol: '৳',
    position: 'prefix',
    decimals: 2,
    grouping: 'lakh-crore',
  },
  numerals: 'bengali',
  date: {
    format: 'DD/MM/YYYY',
    firstDayOfWeek: 0,
    calendar: 'gregory',
  },
  phone: {
    country: 'BD',
    pattern: '^(?:\\+?880|0)1[3-9]\\d{8}$',
    example: '01712345678',
    displayFormat: '+880 XXXX-XXXXXX',
  },
  address: {
    fields: ['village_or_area', 'post_office', 'upazila', 'district', 'division'],
    order: ['village_or_area', 'post_office', 'upazila', 'district', 'division'],
  },
  academicYear: {
    startMonth: 1,
  },
  identifiers: {
    national: '^[0-9]{10}$|^[0-9]{13}$|^[0-9]{17}$',
    student: '',
  },
  timezone: 'Asia/Dhaka',
  // [17.1.2] a school opts into a different label, not out of one.
  calendar: {
    termLabel: TermLabel.TERM,
  },
};

/**
 * bn-BD attendance defaults. `autoAbsentNotification.enabled` is off by
 * default: a school upgrading into this epic must not start texting
 * parents without asking first ([9.8] owns turning it on).
 */
export const DEFAULT_ATTENDANCE_SETTINGS: AttendancePolicySettings = {
  weeklyOffDays: [5],
  weeklyOffHistory: [],
  lateAfter: '08:15',
  absentAfter: '10:00',
  correctionWindowDays: 2,
  lowAttendanceThresholdPercent: 75,
  lateCountsAsPresent: true,
  leaveCountsAsWorkingDay: false,
  percentageDenominator: 'WORKING_DAYS',
  allowFutureDates: false,
  autoAbsentNotification: { enabled: false, cutoffTime: '11:00' },
  arrivalNotice: { enabled: false, smsAllowed: false },
  shiftTimes: [],
  specialTimings: [],
  periodAttendance: { enabled: false },
  dailySource: DailyAttendanceSource.ANY,
};

/**
 * [33.1.1] Empty by default: a school has to opt into naming its own
 * shifts/versions/groups, nothing is invented on its behalf.
 */
export const DEFAULT_ORGANISATION_SETTINGS: OrganisationSettings = {
  shifts: [],
  versions: [],
  groups: [],
};

/** 12.5: OTP login is on by default; a school opts out, not in. */
export const DEFAULT_AUTH_SETTINGS: AuthSettings = {
  otpLoginEnabled: true,
};

/** [14.12.1/#615 D10]. WEEKLY is the default — a school opts out, not in. */
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  schedule: 'WEEKLY',
};

/** [16.2.1] OTP-only by default — a school opts into password-or-OTP
 * approval, not out of it. Manual generation runs don't notify by default;
 * scheduled/recurring runs do. */
export const DEFAULT_FEES_SETTINGS: FeesSettings = {
  approvalMode: ApprovalMode.OTP,
  notifyOnManualGenerationDefault: false,
  notifyOnScheduleDefault: true,
  fineDueDays: 7,
  requireSecondApprover: false,
};

/** [21.1.1] D7 — 5-minute changeover between periods by default; no cap
 * on daily/consecutive periods until a school opts in. */
export const DEFAULT_ROUTINE_SETTINGS: RoutineSettings = {
  defaultChangeoverMinutes: 5,
};

/** [48.1.03] D9: admit cards are never withheld unless a school opts in. */
export const DEFAULT_DOCUMENTS_SETTINGS: DocumentsSettings = { withholdAdmitCardForDues: false };

// [66.1.04] Lives in @biddaloy/shared so the admin UI reads the same constant.
export { DEFAULT_STUDY_PLANS_SETTINGS };

/** [67.1.06] D10 sweep times, D23 quiet hours, D29 guardian SMS off + cap 2, D34 thresholds. */
export const DEFAULT_ATTENTION_SETTINGS: AttentionSettings = {
  rules: {},
  attendanceGraceMinutes: 15,
  classStartingLeadMinutes: 10,
  dailyAt: '07:00',
  eveningAt: '17:00',
  quietHours: { start: '21:00', end: '07:00' },
  guardianSmsFallback: false,
  staffSmsFallback: false,
  guardianSmsDailyCap: 2,
  smsCreditLowThreshold: 200,
  failedMessagesThreshold: 10,
  escalateAttendanceToHeads: true,
};

/** [8.10.7] D7 at-risk thresholds, D23 committee attendance target, D31 morning digest time. */
export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  risk: { absentStreakDays: 3, monthlyAttendancePct: 75, failedSubjects: 1, overdueDays: 60 },
  committeeAttendanceTargetPct: 90,
  digestTime: '07:30',
};

/** [70.2.01] D30: the four conduct lines a new tenant starts with. */
export const DEFAULT_EXAMS_SETTINGS = { conductItems: DEFAULT_CONDUCT_ITEMS };

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  version: TENANT_SETTINGS_SCHEMA_VERSION,
  region: DEFAULT_REGION_SETTINGS,
  attendance: DEFAULT_ATTENDANCE_SETTINGS,
  routine: DEFAULT_ROUTINE_SETTINGS,
  organisation: DEFAULT_ORGANISATION_SETTINGS,
  auth: DEFAULT_AUTH_SETTINGS,
  backup: DEFAULT_BACKUP_SETTINGS,
  fees: DEFAULT_FEES_SETTINGS,
  documents: DEFAULT_DOCUMENTS_SETTINGS,
  studyPlans: DEFAULT_STUDY_PLANS_SETTINGS,
  attention: DEFAULT_ATTENTION_SETTINGS,
  dashboard: DEFAULT_DASHBOARD_SETTINGS,
  exams: DEFAULT_EXAMS_SETTINGS,
};

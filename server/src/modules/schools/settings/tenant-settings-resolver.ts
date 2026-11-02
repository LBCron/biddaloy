import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_ATTENTION_SETTINGS,
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_AUTH_SETTINGS,
  DEFAULT_BACKUP_SETTINGS,
  DEFAULT_DOCUMENTS_SETTINGS,
  DEFAULT_EXAMS_SETTINGS,
  DEFAULT_FEES_SETTINGS,
  DEFAULT_ORGANISATION_SETTINGS,
  DEFAULT_REGION_SETTINGS,
  DEFAULT_ROUTINE_SETTINGS,
  DEFAULT_STUDY_PLANS_SETTINGS,
} from './tenant-settings-defaults';
import {
  alertRuleMeta,
  ApprovalMode,
  isAlertRuleKey,
  SERIAL_PREFIX_PATTERN,
} from '@biddaloy/shared';
import type {
  AttentionSettings,
  DocumentsSettings,
  ApplicationsSettings,
  HomeworkSettings,
  DashboardSettings,
  EvaluationsSettings,
  RoutineSettings,
  StudyPlansSettings,
  TenantSettings,
} from '@biddaloy/shared';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

const isHhMm = (v: unknown): v is string => typeof v === 'string' && HH_MM.test(v);
const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * [67.1.06] Always a full object: the attention engine reads it every sweep, so a
 * partial/absent/junk stored block falls back field by field (ranges mirror
 * `AttentionSettingsDto`). `rules` keeps only known keys with a boolean `enabled`
 * and drops `enabled: false` on non-disableable rules (D34 read-side guard).
 */
function overlayAttentionSettings(stored: unknown): AttentionSettings {
  const d = DEFAULT_ATTENTION_SETTINGS;
  const s = isPlainObject(stored) ? stored : {};
  const q = isPlainObject(s.quietHours) ? s.quietHours : {};
  const rules: AttentionSettings['rules'] = {};
  if (isPlainObject(s.rules)) {
    for (const [key, entry] of Object.entries(s.rules)) {
      if (!isAlertRuleKey(key) || !isPlainObject(entry) || typeof entry.enabled !== 'boolean') {
        continue;
      }
      if (!entry.enabled && !alertRuleMeta(key).canDisable) continue;
      rules[key] = { enabled: entry.enabled };
    }
  }
  return {
    rules,
    attendanceGraceMinutes: intIn(s.attendanceGraceMinutes, 0, 120)
      ? s.attendanceGraceMinutes
      : d.attendanceGraceMinutes,
    classStartingLeadMinutes: intIn(s.classStartingLeadMinutes, 0, 60)
      ? s.classStartingLeadMinutes
      : d.classStartingLeadMinutes,
    dailyAt: isHhMm(s.dailyAt) ? s.dailyAt : d.dailyAt,
    eveningAt: isHhMm(s.eveningAt) ? s.eveningAt : d.eveningAt,
    quietHours:
      isHhMm(q.start) && isHhMm(q.end) ? { start: q.start, end: q.end } : { ...d.quietHours },
    guardianSmsFallback:
      typeof s.guardianSmsFallback === 'boolean' ? s.guardianSmsFallback : d.guardianSmsFallback,
    guardianSmsDailyCap: intIn(s.guardianSmsDailyCap, 0, 10)
      ? s.guardianSmsDailyCap
      : d.guardianSmsDailyCap,
    smsCreditLowThreshold: intIn(s.smsCreditLowThreshold, 0, 100000)
      ? s.smsCreditLowThreshold
      : d.smsCreditLowThreshold,
    failedMessagesThreshold: intIn(s.failedMessagesThreshold, 1, 1000)
      ? s.failedMessagesThreshold
      : d.failedMessagesThreshold,
    escalateAttendanceToHeads:
      typeof s.escalateAttendanceToHeads === 'boolean'
        ? s.escalateAttendanceToHeads
        : d.escalateAttendanceToHeads,
  };
}

/**
 * [1047] Read-side guard for `routine`'s optional caps, mirroring the
 * `backup.schedule`/`fees.approvalMode` guards below — `RoutineSettingsDto`
 * rejects a malformed cap on write, but a row can still get here some
 * other way (predates the schema, hand-edited, restored from a backup). A
 * bad value for one field falls back to the default (or is dropped, for
 * the optional caps) rather than passing through as-is or discarding the
 * whole section.
 *
 * Each field's accepted range mirrors `RoutineSettingsDto`
 * (`../dto/tenant-settings.dto.ts`) exactly: `@Min(0)` for
 * `defaultChangeoverMinutes`, where zero legitimately means "no
 * changeover gap"; `@Min(1)` for both caps and for every
 * `subjectPeriodsPerWeek` value, where zero would mean a cap permitting
 * no periods at all — indistinguishable from a misparse, and stricter
 * than any school could have meant.
 */
function overlayRoutineSettings(stored: unknown): RoutineSettings {
  if (!isPlainObject(stored)) return DEFAULT_ROUTINE_SETTINGS;

  const result: RoutineSettings = { ...DEFAULT_ROUTINE_SETTINGS };

  if (isNonNegativeInteger(stored.defaultChangeoverMinutes)) {
    result.defaultChangeoverMinutes = stored.defaultChangeoverMinutes;
  }
  if (isPositiveInteger(stored.maxPeriodsPerTeacherPerDay)) {
    result.maxPeriodsPerTeacherPerDay = stored.maxPeriodsPerTeacherPerDay;
  }
  if (isPositiveInteger(stored.maxConsecutivePeriods)) {
    result.maxConsecutivePeriods = stored.maxConsecutivePeriods;
  }
  if (isPlainObject(stored.subjectPeriodsPerWeek)) {
    const entries = Object.entries(stored.subjectPeriodsPerWeek).filter(([, value]) =>
      isPositiveInteger(value),
    );
    if (entries.length > 0) {
      result.subjectPeriodsPerWeek = Object.fromEntries(entries) as Record<string, number>;
    }
  }

  return result;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** [66.1.04] Read-side guard mirroring `StudyPlansSettingsDto`: a bad stored
 * field falls back to its default, good siblings survive, unknown keys drop. */
function overlayStudyPlansSettings(stored: unknown): StudyPlansSettings {
  const result: StudyPlansSettings = { ...DEFAULT_STUDY_PLANS_SETTINGS };
  if (!isPlainObject(stored)) return result;

  for (const key of ['statusDeadline', 'reminderTime', 'weeklyDigestTime'] as const) {
    const value = stored[key];
    if (typeof value === 'string' && HH_MM.test(value)) result[key] = value;
  }
  const days = stored.escalateAfterSchoolDays;
  if (typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= 10) {
    result.escalateAfterSchoolDays = days;
  }
  if (typeof stored.guardianDigestSms === 'boolean') {
    result.guardianDigestSms = stored.guardianDigestSms;
  }
  return result;
}

const CONDUCT_KEY = /^[a-z][a-z0-9_]{1,30}$/;

/** [70.2.01] Read-side guard mirroring `ExamsSettingsDto`: a stored list that is not
 * entirely well-formed (bad item, duplicate key, over 12) reads as the defaults. */
function overlayExamsSettings(stored: unknown): NonNullable<TenantSettings['exams']> {
  const list = isPlainObject(stored) ? stored.conductItems : undefined;
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 60;
  if (
    !Array.isArray(list) ||
    list.length > 12 ||
    new Set(list.map((i) => (isPlainObject(i) ? i.key : i))).size !== list.length ||
    !list.every(
      (i) =>
        isPlainObject(i) &&
        typeof i.key === 'string' &&
        CONDUCT_KEY.test(i.key) &&
        text(i.name_bn) &&
        text(i.name_en),
    )
  ) {
    return DEFAULT_EXAMS_SETTINGS;
  }
  return {
    conductItems: list.map((i) => ({ key: i.key, name_bn: i.name_bn, name_en: i.name_en })),
  };
}

/**
 * Overlays whatever a school actually stored on top of `defaults`,
 * field by field, all the way down.
 *
 * The stored blob is not re-validated on read — it was validated when it
 * was written, but it can predate a schema change, be hand-edited, or be
 * restored from a backup, so a section that's present is not necessarily
 * complete. Walking `defaults` (rather than the stored value) means the
 * result always has every field the type promises, and any key the
 * current schema doesn't know about is dropped instead of being handed
 * to a caller that has no idea what to do with it.
 *
 * A stored value that's the wrong *kind* — an object where a scalar
 * belongs, `null` where a nested group belongs — falls back to the
 * default for that field alone rather than discarding the whole section:
 * one bad field shouldn't cost a school every other setting next to it.
 * Arrays (`address.fields`/`order`) are replaced wholesale, never merged
 * element-wise, since a school's field list is a complete statement, not
 * an addition to ours.
 */
function overlayOnDefaults<T>(defaults: T, stored: unknown): T {
  if (!isPlainObject(stored) || !isPlainObject(defaults)) return defaults;

  const result: Record<string, unknown> = { ...defaults };

  for (const [key, defaultValue] of Object.entries(defaults)) {
    const storedValue = stored[key];
    if (storedValue === undefined || storedValue === null) continue;

    if (isPlainObject(defaultValue)) {
      result[key] = overlayOnDefaults(defaultValue, storedValue);
    } else if (Array.isArray(defaultValue)) {
      result[key] = Array.isArray(storedValue) ? storedValue : defaultValue;
    } else {
      result[key] = typeof storedValue === typeof defaultValue ? storedValue : defaultValue;
    }
  }

  return result as T;
}

const BACKUP_SCHEDULE_MODES: readonly NonNullable<TenantSettings['backup']>['schedule'][] = [
  'OFF',
  'WEEKLY',
  'DAILY',
];

const FEES_APPROVAL_MODES: readonly ApprovalMode[] = Object.values(ApprovalMode);

/**
 * Resolves a school's raw `settings` jsonb column against defaults, one
 * top-level section at a time — a school that has configured
 * `communications.email` but never touched `region` still gets sane
 * regional defaults, and vice versa. `null`/empty settings resolve to
 * defaults entirely rather than throwing.
 *
 * `region` resolves per *field*, not per section: a stored
 * `{ region: { locale: 'en-BD' } }` comes back as the full default region
 * with only `locale` overridden, so callers can rely on every region
 * field being present regardless of how partially the row was written.
 * `communications` has no defaults to merge against — a medium is either
 * configured or it isn't — so it passes through as stored, minus a
 * non-object value, which would only mislead a caller that trusts the
 * type.
 */
export function resolveTenantSettings(stored: Record<string, unknown> | null): TenantSettings {
  const region = overlayOnDefaults(DEFAULT_REGION_SETTINGS, stored?.region);
  const attendance = overlayOnDefaults(DEFAULT_ATTENDANCE_SETTINGS, stored?.attendance);
  const organisation = overlayOnDefaults(DEFAULT_ORGANISATION_SETTINGS, stored?.organisation);
  const auth = overlayOnDefaults(DEFAULT_AUTH_SETTINGS, stored?.auth);
  // Not `overlayOnDefaults`: it only copies a stored key that also exists
  // in `defaults`, and `DEFAULT_ROUTINE_SETTINGS` only declares
  // `defaultChangeoverMinutes` — its other fields are optional-and-absent
  // by design (no cap until a school opts in), so overlaying would silently
  // drop a stored `maxPeriodsPerTeacherPerDay`/`maxConsecutivePeriods`/
  // `subjectPeriodsPerWeek`. `overlayRoutineSettings` (above) is the
  // field-by-field guard doing that merge instead.
  const routine: RoutineSettings = overlayRoutineSettings(stored?.routine);
  // `overlayOnDefaults` only type-checks (a string is a string), so a
  // stored `{ schedule: 'NONSENSE' }` would otherwise come back typed as a
  // `BackupScheduleMode` and reach `BACKUP_SCHEDULE_CRON[mode]` as
  // `undefined`. `BackupSettingsDto`'s `@IsIn` rejects this on write; this
  // is the read-side guard for a row that got there some other way.
  const overlaidBackup = overlayOnDefaults(DEFAULT_BACKUP_SETTINGS, stored?.backup);
  const backup = BACKUP_SCHEDULE_MODES.includes(overlaidBackup.schedule)
    ? overlaidBackup
    : { ...overlaidBackup, schedule: DEFAULT_BACKUP_SETTINGS.schedule };
  const communications = isPlainObject(stored?.communications)
    ? (stored.communications as TenantSettings['communications'])
    : undefined;
  // Same read-side guard as `backup.schedule` above — `FeesSettingsDto`'s
  // `@IsIn` rejects a bad `approvalMode` on write; this covers a row that
  // got there some other way (predates the schema, hand-edited, restored).
  const overlaidFees = overlayOnDefaults(DEFAULT_FEES_SETTINGS, stored?.fees);
  // [78 D1] A non-boolean `requireSecondApprover` reads as the default
  // (`false`), the same read guard `documents.withholdAdmitCardForDues` uses.
  const fees = {
    ...(FEES_APPROVAL_MODES.includes(overlaidFees.approvalMode)
      ? overlaidFees
      : { ...overlaidFees, approvalMode: DEFAULT_FEES_SETTINGS.approvalMode }),
    requireSecondApprover:
      typeof overlaidFees.requireSecondApprover === 'boolean'
        ? overlaidFees.requireSecondApprover
        : DEFAULT_FEES_SETTINGS.requireSecondApprover,
  };

  // [35.1.2] No default: `preset` is absent until a preset is applied, so
  // "has a preset" is a truthiness check. Passed through only if stored.
  const preset = isPlainObject(stored?.preset)
    ? (stored.preset as unknown as TenantSettings['preset'])
    : undefined;
  // Only the known boolean passes through; anything else is dropped.
  const storedEvaluations = isPlainObject(stored?.evaluations) ? stored.evaluations : undefined;
  const evaluations: EvaluationsSettings | undefined =
    typeof storedEvaluations?.incidentSmsEnabled === 'boolean'
      ? { incidentSmsEnabled: storedEvaluations.incidentSmsEnabled }
      : undefined;

  // [52.2.6] Only the known boolean passes through; absent = off.
  const storedApplications = isPlainObject(stored?.applications) ? stored.applications : undefined;
  const applications: ApplicationsSettings | undefined =
    typeof storedApplications?.smsOnDecision === 'boolean'
      ? { smsOnDecision: storedApplications.smsOnDecision }
      : undefined;

  // [TIME-11] Only the two known booleans pass through; absent = off.
  const storedHomework = isPlainObject(stored?.homework) ? stored.homework : undefined;
  const homeworkPicked: HomeworkSettings = {
    ...(typeof storedHomework?.notifyOnAssign === 'boolean'
      ? { notifyOnAssign: storedHomework.notifyOnAssign }
      : {}),
    ...(typeof storedHomework?.notifyDefaulters === 'boolean'
      ? { notifyDefaulters: storedHomework.notifyDefaulters }
      : {}),
  };
  const homework = Object.keys(homeworkPicked).length > 0 ? homeworkPicked : undefined;

  // [48.1.03] Always present. A hand-edited or restored row must not put junk
  // on a printed certificate, so each field passes only if well-formed.
  const storedDocuments = isPlainObject(stored?.documents) ? stored.documents : undefined;
  const documents: DocumentsSettings = {
    withholdAdmitCardForDues:
      typeof storedDocuments?.withholdAdmitCardForDues === 'boolean'
        ? storedDocuments.withholdAdmitCardForDues
        : DEFAULT_DOCUMENTS_SETTINGS.withholdAdmitCardForDues,
    ...(typeof storedDocuments?.serialPrefix === 'string' &&
    SERIAL_PREFIX_PATTERN.test(storedDocuments.serialPrefix)
      ? { serialPrefix: storedDocuments.serialPrefix }
      : {}),
  };

  // [8.10.7] Read-side guard, like backup.schedule: a malformed time would break the digest scheduler.
  const overlaidDashboard: DashboardSettings = overlayOnDefaults(
    DEFAULT_DASHBOARD_SETTINGS,
    stored?.dashboard,
  );
  // Same bounds as DashboardSettingsDto: a restored row outside them falls back to the default.
  const inRange = (v: number, d: number, max: number) =>
    Number.isInteger(v) && v >= 1 && v <= max ? v : d;
  const D = DEFAULT_DASHBOARD_SETTINGS;
  const risk = overlaidDashboard.risk;
  const dashboard: DashboardSettings = {
    ...overlaidDashboard,
    risk: {
      absentStreakDays: inRange(risk.absentStreakDays, D.risk.absentStreakDays, 30),
      monthlyAttendancePct: inRange(risk.monthlyAttendancePct, D.risk.monthlyAttendancePct, 100),
      failedSubjects: inRange(risk.failedSubjects, D.risk.failedSubjects, 20),
      overdueDays: inRange(risk.overdueDays, D.risk.overdueDays, 365),
    },
    committeeAttendanceTargetPct: inRange(
      overlaidDashboard.committeeAttendanceTargetPct,
      D.committeeAttendanceTargetPct,
      100,
    ),
    digestTime: HH_MM.test(overlaidDashboard.digestTime)
      ? overlaidDashboard.digestTime
      : D.digestTime,
  };

  return {
    version: TENANT_SETTINGS_SCHEMA_VERSION,
    region,
    attendance,
    routine,
    organisation,
    auth,
    backup,
    fees,
    documents,
    studyPlans: overlayStudyPlansSettings(stored?.studyPlans),
    attention: overlayAttentionSettings(stored?.attention),
    dashboard,
    exams: overlayExamsSettings(stored?.exams),
    ...(communications ? { communications } : {}),
    ...(preset ? { preset } : {}),
    ...(evaluations ? { evaluations } : {}),
    ...(applications ? { applications } : {}),
    ...(homework ? { homework } : {}),
  };
}

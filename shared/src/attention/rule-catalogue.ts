import { AlertCadence, AlertCategory, AlertSeverity } from '../enums/attention';
import { UserRole } from '../enums/index';

export const ALERT_RULE_KEYS = [
  'setup.incomplete',
  'trial.ending',
  'comms.provider_missing',
  'staff.invite_pending',
  'year.next_missing',
  'comms.sms_credit_low',
  'comms.failed_messages',
  'system.backup_failed',
  'routine.not_published',
  'section.no_class_teacher',
  'routine.subject_no_teacher',
  'guardian.contact_missing',
  'attendance.not_taken',
  'class.starting',
  'routine.substitution_today',
  'routine.uncovered_periods',
  'homework.not_submitted',
  'homework.due_today',
  'homework.due_tomorrow',
  'homework.to_grade',
  'class.absent_streak',
  'class.guardian_contact_missing',
  'fees.overdue_rising',
  'fees.reminders_pending',
  'fees.unassigned_students',
  'fees.structure_missing_new_year',
  'exams.marks_overdue',
  'exams.my_marks_due',
  'exams.results_unpublished',
  'exams.schedule_unpublished',
  'exams.seat_plan_missing',
  'admission.applications_pending',
  'admission.intake_window',
  'students.records_incomplete',
  'leave.staff_pending',
  'leave.my_request_decided',
  'acr.incomplete',
  'child.absent_today',
  'fees.due_soon',
  'fees.overdue_family',
  'exams.tomorrow',
  'results.published',
  'routine.changed_today',
  'guardian.profile_incomplete',
  'calendar.holiday_tomorrow',
  'surveys.pending',
  'platform.backup_failing',
  'platform.trials_ending',
  'platform.provider_failures',
  'manual.alert',
  'study_plan.unreported',
  'study_plan.behind',
  'admin.mfa_missing',
  'approvals.pending',
  'print.queue_pending',
  'billing.renewal_due',
  'students.at_risk',
  'committee.monthly_report_ready',
  'seats.expiring',
  'seats.exhausted',
  'account.idle',
  'platform.seats.expiring',
  'platform.bkash.refund_due',
] as const;

export type AlertRuleKey = (typeof ALERT_RULE_KEYS)[number];

export interface AlertRuleMeta {
  key: AlertRuleKey;
  category: AlertCategory;
  /** Default/start severity; escalating rules later raise it. */
  severity: AlertSeverity;
  cadence: AlertCadence[];
  /** `[]` = personal (addressed to one user, not a role). */
  roles: UserRole[];
  pushable: boolean;
  canDisable: boolean;
  guardianSmsFallback: boolean;
  staffSmsFallback: boolean;
  ownerEpic?: '#1828' | '#1752' | '#1726' | '#1373' | '#1649' | '#169';
}

const C = AlertCategory;
const S = AlertSeverity;
const K = AlertCadence;
const R = UserRole;
const ALL9 = Object.values(UserRole).filter((r) => r !== UserRole.SUPER_ADMIN);

type Row = [
  key: AlertRuleKey,
  category: AlertCategory,
  severity: AlertSeverity,
  cadence: AlertCadence[],
  roles: UserRole[],
  pushable: boolean,
  canDisable: boolean,
  guardianSmsFallback: boolean,
  ownerEpic?: AlertRuleMeta['ownerEpic'],
  staffSmsFallback?: boolean,
];

// prettier-ignore
const ROWS: Row[] = [
  ['setup.incomplete', C.SETUP, S.CRITICAL, [K.ON_CHANGE, K.DAILY], [R.ADMIN], true, false, false],
  ['trial.ending', C.SETUP, S.WARNING, [K.DAILY, K.ON_CHANGE], [R.ADMIN], true, false, false],
  ['comms.provider_missing', C.SETUP, S.WARNING, [K.ON_CHANGE, K.DAILY], [R.ADMIN], true, true, false],
  ['staff.invite_pending', C.SETUP, S.REMINDER, [K.DAILY], [R.ADMIN], false, true, false],
  ['year.next_missing', C.SETUP, S.WARNING, [K.DAILY], [R.ADMIN], true, true, false],
  ['comms.sms_credit_low', C.SYSTEM, S.WARNING, [K.HOURLY], [R.ADMIN], true, true, false],
  ['comms.failed_messages', C.SYSTEM, S.WARNING, [K.HOURLY], [R.ADMIN], true, true, false],
  ['system.backup_failed', C.SYSTEM, S.CRITICAL, [K.HOURLY], [R.ADMIN], true, false, false],
  ['routine.not_published', C.STRUCTURE, S.WARNING, [K.DAILY, K.ON_CHANGE], [R.ADMIN], true, true, false],
  ['section.no_class_teacher', C.STRUCTURE, S.WARNING, [K.DAILY, K.ON_CHANGE], [R.ADMIN], true, true, false],
  ['routine.subject_no_teacher', C.STRUCTURE, S.WARNING, [K.DAILY], [R.ADMIN], true, true, false],
  ['guardian.contact_missing', C.STRUCTURE, S.WARNING, [K.DAILY], [R.ADMIN], true, true, false],
  ['attendance.not_taken', C.ATTENDANCE, S.REMINDER, [K.FAST, K.ON_CHANGE], [R.TEACHER, R.EXECUTIVE, R.ADMIN], true, false, false, undefined, true],
  ['class.starting', C.PERIOD, S.REMINDER, [K.FAST], [R.TEACHER], true, true, false],
  ['routine.substitution_today', C.PERIOD, S.REMINDER, [K.DAILY, K.ON_CHANGE], [R.TEACHER], true, true, false],
  ['routine.uncovered_periods', C.PERIOD, S.WARNING, [K.FAST], [R.EXECUTIVE, R.ADMIN], true, true, false],
  ['homework.not_submitted', C.HOMEWORK, S.WARNING, [K.FAST, K.ON_CHANGE], [R.STUDENT, R.PARENT, R.TEACHER], true, true, false],
  ['homework.due_today', C.HOMEWORK, S.REMINDER, [K.DAILY], [R.STUDENT], false, true, false],
  ['homework.due_tomorrow', C.HOMEWORK, S.REMINDER, [K.DAILY], [R.STUDENT, R.PARENT], false, true, false],
  ['homework.to_grade', C.HOMEWORK, S.REMINDER, [K.DAILY], [R.TEACHER], false, true, false],
  ['class.absent_streak', C.CLASS, S.REMINDER, [K.DAILY], [R.TEACHER], false, true, false],
  ['class.guardian_contact_missing', C.CLASS, S.REMINDER, [K.DAILY], [R.TEACHER], false, true, false],
  ['fees.overdue_rising', C.FEES, S.REMINDER, [K.DAILY], [R.ACCOUNTANT], false, true, false],
  ['fees.reminders_pending', C.FEES, S.REMINDER, [K.DAILY], [R.ACCOUNTANT], false, true, false],
  ['fees.unassigned_students', C.FEES, S.WARNING, [K.DAILY, K.ON_CHANGE], [R.ACCOUNTANT, R.ADMIN], true, true, false],
  ['fees.structure_missing_new_year', C.FEES, S.WARNING, [K.DAILY], [R.ACCOUNTANT, R.ADMIN], true, true, false],
  ['exams.marks_overdue', C.EXAMS, S.WARNING, [K.DAILY], [R.EXECUTIVE, R.EXAM_CONTROLLER], true, false, false],
  ['exams.my_marks_due', C.EXAMS, S.WARNING, [K.DAILY], [R.TEACHER], true, false, false],
  ['exams.results_unpublished', C.EXAMS, S.REMINDER, [K.DAILY, K.ON_CHANGE], [R.EXECUTIVE, R.EXAM_CONTROLLER, R.ADMIN], false, true, false],
  ['exams.schedule_unpublished', C.EXAMS, S.WARNING, [K.DAILY], [R.EXAM_CONTROLLER, R.ADMIN], true, true, false],
  ['exams.seat_plan_missing', C.EXAMS, S.WARNING, [K.DAILY], [R.EXAM_CONTROLLER, R.ADMIN], true, true, false],
  ['admission.applications_pending', C.OFFICE, S.REMINDER, [K.DAILY], [R.OFFICE_STAFF, R.ADMIN], false, true, false],
  ['admission.intake_window', C.OFFICE, S.REMINDER, [K.DAILY], [R.OFFICE_STAFF, R.ADMIN], false, true, false],
  ['students.records_incomplete', C.OFFICE, S.REMINDER, [K.DAILY], [R.OFFICE_STAFF, R.ADMIN], false, true, false],
  ['leave.staff_pending', C.OFFICE, S.WARNING, [K.HOURLY, K.ON_CHANGE], [R.ADMIN, R.EXECUTIVE], true, true, false],
  ['leave.my_request_decided', C.OFFICE, S.REMINDER, [K.ON_CHANGE], [], true, true, false],
  ['acr.incomplete', C.OFFICE, S.WARNING, [K.DAILY], [R.ADMIN], true, true, false],
  ['child.absent_today', C.FAMILY, S.WARNING, [K.FAST], [R.PARENT], false, false, true],
  ['fees.due_soon', C.FAMILY, S.REMINDER, [K.DAILY, K.ON_CHANGE], [R.PARENT], false, true, false],
  ['fees.overdue_family', C.FAMILY, S.WARNING, [K.DAILY, K.ON_CHANGE], [R.PARENT], true, true, true],
  ['exams.tomorrow', C.FAMILY, S.REMINDER, [K.DAILY], [R.PARENT, R.STUDENT], true, true, false],
  ['results.published', C.FAMILY, S.REMINDER, [K.ON_CHANGE], [R.PARENT, R.STUDENT], true, true, false],
  ['routine.changed_today', C.FAMILY, S.REMINDER, [K.DAILY, K.ON_CHANGE], [R.PARENT, R.STUDENT], false, true, false],
  ['guardian.profile_incomplete', C.FAMILY, S.WARNING, [K.DAILY], [R.PARENT], false, true, false],
  ['calendar.holiday_tomorrow', C.COMMON, S.REMINDER, [K.DAILY], ALL9, false, true, false],
  ['surveys.pending', C.COMMON, S.REMINDER, [K.DAILY], [R.PARENT, R.STUDENT], false, true, false],
  ['platform.backup_failing', C.PLATFORM, S.CRITICAL, [K.HOURLY], [R.SUPER_ADMIN], true, false, false],
  ['platform.trials_ending', C.PLATFORM, S.REMINDER, [K.DAILY], [R.SUPER_ADMIN], false, true, false],
  ['platform.provider_failures', C.PLATFORM, S.WARNING, [K.HOURLY], [R.SUPER_ADMIN], true, true, false],
  ['manual.alert', C.MANUAL, S.WARNING, [], ALL9, true, false, false],
  ['study_plan.unreported', C.STUDY_PLAN, S.WARNING, [K.DAILY], [R.TEACHER, R.EXECUTIVE, R.ADMIN], true, true, false, '#1828'],
  ['study_plan.behind', C.STUDY_PLAN, S.REMINDER, [K.DAILY], [R.PARENT, R.COMMITTEE], true, true, false, '#1828'],
  ['admin.mfa_missing', C.SETUP, S.WARNING, [K.DAILY, K.ON_CHANGE], [R.ADMIN], true, false, false, '#1752'],
  ['approvals.pending', C.OFFICE, S.WARNING, [K.HOURLY], [R.ADMIN, R.EXECUTIVE], true, true, false, '#1726'],
  ['print.queue_pending', C.OFFICE, S.REMINDER, [K.DAILY], [R.OFFICE_STAFF], false, true, false, '#1373'],
  ['billing.renewal_due', C.BILLING, S.WARNING, [K.DAILY], [R.ADMIN], true, false, false, '#1649'],
  ['students.at_risk', C.CLASS, S.REMINDER, [K.DAILY], [R.EXECUTIVE, R.ADMIN, R.TEACHER], false, true, false, '#169'],
  ['committee.monthly_report_ready', C.COMMON, S.REMINDER, [K.DAILY], [R.COMMITTEE], false, true, false, '#169'],
  // seats.expiring may overlap billing.renewal_due; which one supersedes is decided in #2716.
  ['seats.expiring', C.BILLING, S.WARNING, [K.DAILY, K.ON_CHANGE], [R.ADMIN], true, false, false, '#1649'],
  ['seats.exhausted', C.BILLING, S.WARNING, [K.DAILY, K.ON_CHANGE], [R.ADMIN], true, false, false, '#1649'],
  ['account.idle', C.BILLING, S.REMINDER, [K.DAILY], [R.ADMIN], false, true, false, '#1649'],
  ['platform.seats.expiring', C.PLATFORM, S.REMINDER, [K.DAILY], [R.SUPER_ADMIN], false, true, false, '#1649'],
  // Money bKash took that paid no order: critical until refunded, so it cannot be turned off.
  ['platform.bkash.refund_due', C.PLATFORM, S.CRITICAL, [K.HOURLY], [R.SUPER_ADMIN], true, false, false, '#1649'],
];

export const ALERT_RULES: readonly AlertRuleMeta[] = ROWS.map(
  ([
    key,
    category,
    severity,
    cadence,
    roles,
    pushable,
    canDisable,
    guardianSmsFallback,
    ownerEpic,
    staffSmsFallback,
  ]) => ({
    key,
    category,
    severity,
    cadence,
    roles: [...roles],
    pushable,
    canDisable,
    guardianSmsFallback,
    staffSmsFallback: staffSmsFallback ?? false,
    ...(ownerEpic ? { ownerEpic } : {}),
  }),
);

const BY_KEY = new Map<string, AlertRuleMeta>(ALERT_RULES.map((r) => [r.key, r]));

export function isAlertRuleKey(v: string): v is AlertRuleKey {
  return BY_KEY.has(v);
}

export function alertRuleMeta(key: AlertRuleKey): AlertRuleMeta {
  const meta = BY_KEY.get(key);
  if (!meta) throw new Error(`Unknown alert rule key: ${key}`);
  return meta;
}

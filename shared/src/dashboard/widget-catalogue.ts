/**
 * [8.10.7.1.01] The one registry of dashboard widgets: keys, who may see
 * each, what permission its route needs, and each role's default layout.
 * Const-object + type pattern (not a TS `enum`), like `enums/homework.ts`.
 * Every widget route is `GET /dashboard/widgets/<key>` (D37). The briefing is
 * computed by the attention engine (Epic 67 D1), so there is no briefing
 * priority here.
 */
import { Permission } from '../enums/permissions';
import { UserRole } from '../enums';

export const DashboardWidgetKey = {
  ATTENDANCE_TODAY: 'attendance-today',
  STAFF_TODAY: 'staff-today',
  COLLECTION_MONTH: 'collection-month',
  MARK_ENTRY_PROGRESS: 'mark-entry-progress',
  SYLLABUS_PROGRESS: 'syllabus-progress',
  AT_RISK_STUDENTS: 'at-risk-students',
  SMS_BALANCE: 'sms-balance',
  FAILED_MESSAGES: 'failed-messages',
  UPCOMING: 'upcoming',
  HOMEWORK_SUBMISSION_RATE: 'homework-submission-rate',
  RECENT_ACTIVITY: 'recent-activity',
  MY_ROUTINE_TODAY: 'my-routine-today',
  MY_PENDING_SECTIONS: 'my-pending-sections',
  MY_MARK_DEADLINES: 'my-mark-deadlines',
  HOMEWORK_TO_CHECK: 'homework-to-check',
  CLASS_TEACHER_STREAKS: 'class-teacher-streaks',
  MY_LEAVE_BALANCE: 'my-leave-balance',
  MY_SYLLABUS_PROGRESS: 'my-syllabus-progress',
  COLLECTION_TODAY: 'collection-today',
  COLLECTION_BY_MONTH: 'collection-by-month',
  DUES_AGEING: 'dues-ageing',
  DUES_BY_CLASS: 'dues-by-class',
  FEE_GENERATION_STATUS: 'fee-generation-status',
  REMINDERS_PENDING: 'reminders-pending',
  RECENT_PAYMENTS: 'recent-payments',
  COMMITTEE_ENROLLMENT: 'committee-enrollment',
  COMMITTEE_ATTENDANCE: 'committee-attendance',
  COMMITTEE_FINANCE: 'committee-finance',
  COMMITTEE_PASS_RATE: 'committee-pass-rate',
  SEAT_PLAN_STATUS: 'seat-plan-status',
  RESULTS_STATE: 'results-state',
  ADMISSIONS_TODAY: 'admissions-today',
  GUARDIANS_INCOMPLETE: 'guardians-incomplete',
  STUDENTS_ADDED_TODAY: 'students-added-today',
  APPROVALS_PENDING: 'approvals-pending',
  PRINT_QUEUE: 'print-queue',
  SETUP_CHECKLIST: 'setup-checklist',
  SYLLABUS_VS_PLAN: 'syllabus-vs-plan',
  MY_LESSONS_TO_MARK: 'my-lessons-to-mark',
  LATEST_NOTICES: 'latest-notices',
} as const;
export type DashboardWidgetKey = (typeof DashboardWidgetKey)[keyof typeof DashboardWidgetKey];

/** Grid columns 1 / 2 / 3. */
export const WIDGET_SIZES = ['S', 'M', 'L'] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export interface WidgetCatalogueEntry {
  /** Needed on top of DASHBOARD_VIEW, which the server decorator always adds. Never list DASHBOARD_VIEW here. */
  permissions: Permission[];
  /** Roles that may show this widget (customise list, default layouts). */
  roles: UserRole[];
  /** First entry = default size. */
  sizes: WidgetSize[];
  /** Rendered as a 2-col KPI tile on phone (D16). */
  phoneTile?: boolean;
  /** Hidden / "available when #n ships" until that epic lands (D20). */
  needsEpic?: number;
}

const P = Permission;
const R = UserRole;

export const WIDGET_CATALOGUE: Record<DashboardWidgetKey, WidgetCatalogueEntry> = {
  'latest-notices': {
    permissions: [P.NOTICE_READ],
    roles: [R.ADMIN, R.EXECUTIVE, R.TEACHER, R.ACCOUNTANT, R.OFFICE_STAFF, R.EXAM_CONTROLLER],
    sizes: ['M'],
  },
  'attendance-today': {
    permissions: [P.ATTENDANCE_READ],
    roles: [R.ADMIN, R.EXECUTIVE, R.OFFICE_STAFF],
    sizes: ['S', 'M'],
    phoneTile: true,
  },
  'staff-today': {
    permissions: [P.STAFF_ATTENDANCE_READ],
    roles: [R.ADMIN, R.EXECUTIVE, R.OFFICE_STAFF],
    sizes: ['S', 'M'],
  },
  'collection-month': {
    permissions: [P.REPORT_COLLECTIONS_READ],
    roles: [R.ADMIN, R.EXECUTIVE, R.ACCOUNTANT],
    sizes: ['S', 'M'],
    phoneTile: true,
  },
  'mark-entry-progress': {
    permissions: [P.MARK_VIEW],
    roles: [R.ADMIN, R.EXECUTIVE, R.EXAM_CONTROLLER],
    sizes: ['S', 'M'],
  },
  'syllabus-progress': {
    permissions: [P.SYLLABUS_READ],
    roles: [R.ADMIN, R.EXECUTIVE],
    sizes: ['M', 'L'],
  },
  'at-risk-students': {
    permissions: [P.ATTENDANCE_READ, P.MARK_VIEW, P.FEE_READ],
    roles: [R.ADMIN, R.EXECUTIVE],
    sizes: ['L', 'M'],
    phoneTile: true,
  },
  'sms-balance': { permissions: [P.SETTINGS_MANAGE], roles: [R.ADMIN], sizes: ['S'] },
  'failed-messages': { permissions: [P.COMMUNICATION_LOG_READ], roles: [R.ADMIN], sizes: ['S'] },
  upcoming: {
    permissions: [P.CALENDAR_READ],
    roles: [
      R.ADMIN,
      R.EXECUTIVE,
      R.ACCOUNTANT,
      R.TEACHER,
      R.OFFICE_STAFF,
      R.EXAM_CONTROLLER,
      R.COMMITTEE,
    ],
    sizes: ['M', 'S'],
  },
  'homework-submission-rate': { permissions: [P.HOMEWORK_READ], roles: [R.ADMIN], sizes: ['S'] },
  'recent-activity': { permissions: [P.AUDIT_LOG_READ], roles: [R.ADMIN], sizes: ['M'] },
  'my-routine-today': { permissions: [P.ROUTINE_READ], roles: [R.TEACHER], sizes: ['L', 'M'] },
  'my-pending-sections': {
    permissions: [P.ATTENDANCE_MARK],
    roles: [R.TEACHER],
    sizes: ['S'],
    phoneTile: true,
  },
  'my-mark-deadlines': {
    permissions: [P.MARK_ENTER],
    roles: [R.TEACHER],
    sizes: ['S'],
    phoneTile: true,
  },
  'homework-to-check': {
    permissions: [P.HOMEWORK_GRADE],
    roles: [R.TEACHER],
    sizes: ['S'],
    phoneTile: true,
  },
  'class-teacher-streaks': {
    permissions: [P.MY_CLASS_VIEW],
    roles: [R.TEACHER],
    sizes: ['L', 'M'],
  },
  'my-leave-balance': {
    permissions: [],
    roles: [R.TEACHER, R.ACCOUNTANT, R.OFFICE_STAFF, R.EXAM_CONTROLLER],
    sizes: ['S'],
    phoneTile: true,
  },
  'my-syllabus-progress': {
    permissions: [P.SYLLABUS_READ],
    roles: [R.TEACHER],
    sizes: ['L', 'M'],
  },
  'collection-today': {
    permissions: [P.REPORT_COLLECTIONS_READ],
    roles: [R.ACCOUNTANT, R.ADMIN, R.EXECUTIVE],
    sizes: ['L', 'M'],
    phoneTile: true,
  },
  'collection-by-month': {
    permissions: [P.REPORT_COLLECTIONS_READ],
    roles: [R.ACCOUNTANT, R.ADMIN, R.EXECUTIVE],
    sizes: ['L'],
  },
  // Two permissions on purpose: TEACHER holds FEE_READ, and school-wide dues
  // totals must 403 for a teacher.
  'dues-ageing': {
    permissions: [P.FEE_READ, P.REPORT_COLLECTIONS_READ],
    roles: [R.ACCOUNTANT, R.ADMIN, R.EXECUTIVE],
    sizes: ['M'],
    phoneTile: true,
  },
  'dues-by-class': {
    permissions: [P.FEE_READ, P.REPORT_COLLECTIONS_READ],
    roles: [R.ACCOUNTANT, R.ADMIN, R.EXECUTIVE],
    sizes: ['M'],
  },
  'fee-generation-status': {
    permissions: [P.FEE_GENERATE],
    roles: [R.ACCOUNTANT, R.ADMIN],
    sizes: ['S'],
  },
  'reminders-pending': {
    permissions: [P.FEE_READ, P.REPORT_COLLECTIONS_READ],
    roles: [R.ACCOUNTANT, R.ADMIN],
    sizes: ['S'],
    phoneTile: true,
  },
  'recent-payments': {
    permissions: [P.PAYMENT_READ],
    roles: [R.ACCOUNTANT, R.ADMIN],
    sizes: ['M'],
  },
  'committee-enrollment': {
    permissions: [P.COMMITTEE_REPORT_READ],
    roles: [R.COMMITTEE, R.ADMIN, R.EXECUTIVE],
    sizes: ['M'],
    phoneTile: true,
  },
  'committee-attendance': {
    permissions: [P.COMMITTEE_REPORT_READ],
    roles: [R.COMMITTEE, R.ADMIN, R.EXECUTIVE],
    sizes: ['M'],
    phoneTile: true,
  },
  'committee-finance': {
    permissions: [P.COMMITTEE_REPORT_READ],
    roles: [R.COMMITTEE, R.ADMIN, R.EXECUTIVE],
    sizes: ['L'],
    phoneTile: true,
  },
  'committee-pass-rate': {
    permissions: [P.COMMITTEE_REPORT_READ],
    roles: [R.COMMITTEE, R.ADMIN, R.EXECUTIVE],
    sizes: ['M'],
    phoneTile: true,
  },
  'seat-plan-status': {
    permissions: [P.SEAT_PLAN_MANAGE],
    roles: [R.EXAM_CONTROLLER, R.ADMIN],
    sizes: ['M'],
  },
  'results-state': {
    permissions: [P.RESULT_READ],
    roles: [R.EXAM_CONTROLLER, R.ADMIN, R.EXECUTIVE],
    sizes: ['M'],
    phoneTile: true,
  },
  'admissions-today': {
    permissions: [P.ADMISSION_REVIEW],
    roles: [R.OFFICE_STAFF, R.ADMIN],
    sizes: ['S'],
    phoneTile: true,
  },
  'guardians-incomplete': {
    permissions: [P.GUARDIAN_READ],
    roles: [R.OFFICE_STAFF, R.ADMIN],
    sizes: ['S'],
    phoneTile: true,
  },
  'students-added-today': {
    permissions: [P.STUDENT_READ],
    roles: [R.OFFICE_STAFF, R.ADMIN],
    sizes: ['S'],
    phoneTile: true,
  },
  'approvals-pending': {
    // Who may decide comes from the application type catalogue (D22); the widget counts
    // the caller's own inbox, so the gate is the submit/inbox permission, not LEAVE_APPROVE.
    permissions: [P.APPLICATION_SUBMIT],
    roles: [R.ADMIN, R.EXECUTIVE],
    sizes: ['S'],
    phoneTile: true,
    needsEpic: 1726,
  },
  'print-queue': {
    permissions: [P.DOCUMENT_PRINT],
    roles: [R.OFFICE_STAFF, R.EXAM_CONTROLLER, R.ADMIN],
    sizes: ['S'],
    needsEpic: 1373,
  },
  'setup-checklist': {
    permissions: [P.SETTINGS_MANAGE],
    roles: [R.ADMIN],
    sizes: ['L'],
    needsEpic: 1640,
  },
  'syllabus-vs-plan': {
    permissions: [P.SYLLABUS_READ],
    roles: [R.ADMIN, R.EXECUTIVE],
    sizes: ['M', 'L'],
    needsEpic: 1828,
  },
  'my-lessons-to-mark': {
    permissions: [P.SYLLABUS_MANAGE],
    roles: [R.TEACHER],
    sizes: ['S'],
    needsEpic: 1828,
  },
};

/** Order = mockup order (D8). Platform console / curated portal roles get none (D2). */
export const ROLE_DEFAULT_LAYOUTS: Record<UserRole, DashboardWidgetKey[]> = {
  [R.ADMIN]: [
    'attendance-today',
    'staff-today',
    'collection-month',
    'approvals-pending',
    'at-risk-students',
    'mark-entry-progress',
    'syllabus-progress',
    'upcoming',
    'sms-balance',
    'failed-messages',
    'setup-checklist',
    'latest-notices',
  ],
  [R.EXECUTIVE]: [
    'attendance-today',
    'staff-today',
    'collection-month',
    'approvals-pending',
    'at-risk-students',
    'mark-entry-progress',
    'syllabus-progress',
    'upcoming',
    'latest-notices',
  ],
  [R.TEACHER]: [
    'my-routine-today',
    'my-pending-sections',
    'my-mark-deadlines',
    'homework-to-check',
    'my-leave-balance',
    'class-teacher-streaks',
    'my-syllabus-progress',
    'latest-notices',
  ],
  [R.ACCOUNTANT]: [
    'collection-today',
    'collection-month',
    'fee-generation-status',
    'reminders-pending',
    'collection-by-month',
    'dues-ageing',
    'recent-payments',
    'dues-by-class',
    'latest-notices',
  ],
  [R.COMMITTEE]: [
    'committee-enrollment',
    'committee-attendance',
    'committee-finance',
    'committee-pass-rate',
  ],
  [R.OFFICE_STAFF]: [
    'admissions-today',
    'students-added-today',
    'guardians-incomplete',
    'attendance-today',
    'staff-today',
    'print-queue',
    'upcoming',
    'latest-notices',
  ],
  [R.EXAM_CONTROLLER]: [
    'mark-entry-progress',
    'results-state',
    'seat-plan-status',
    'print-queue',
    'upcoming',
    'latest-notices',
  ],
  [R.SUPER_ADMIN]: [],
  [R.PARENT]: [],
  [R.STUDENT]: [],
};

export interface DashboardLayoutItem {
  key: DashboardWidgetKey;
  hidden?: boolean;
  size?: WidgetSize;
}
/** Array order = display order. */
export interface DashboardLayoutPref {
  widgets: DashboardLayoutItem[];
}
/** `users.preferences.dashboard` (D9). */
export type DashboardPreferences = Partial<Record<UserRole, DashboardLayoutPref>>;

export const DASHBOARD_LAYOUT_MAX_WIDGETS = 40; // D34; 40 (not 30) so ADMIN, who lists 31 widgets, can save them all
export const DASHBOARD_LAYOUT_MAX_BYTES = 8192; // D34

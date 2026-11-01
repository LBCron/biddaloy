import type { EntityLabel } from '@biddaloy/shared';
import { Permission, type STAFF_ROLES } from '@biddaloy/shared';

/**
 * [30.1.3]'s staff nav as plain, serialisable data — no JSX, no hooks, so
 * this module is importable from a plain `.test.ts` file the same way
 * `route-permissions.ts` is. `_staff.tsx` is what turns this into the
 * `AppShellNavGroup[]` `AppShell` actually renders: it supplies the
 * `ReactNode` icon per item (keyed by `id`) and resolves each item's
 * `label` — either through `useEntityLabel` ([30.1.2], for an entity noun
 * like "Students") or the `nav` namespace's `items` map (for everything
 * else, e.g. "Attendance", "Settings").
 *
 * **`id` is a stable contract, not a display detail.** Once shipped it must
 * never change: Epic 24.0's `RoleMenu` rows will join on an item's `id`,
 * and a *group's* `id` is what `AppShellNavGroup` already uses as its
 * `localStorage` collapse-state key (`app-shell.tsx`'s
 * `nav-group-collapsed:${group.id}`) — renaming a group id silently resets
 * every user's saved collapse preference for it.
 */
export type StaffNavLabel = { readonly entity: EntityLabel } | { readonly key: string };

export interface StaffNavItemDef {
  /** Stable id, e.g. `academics.classes`. Must not change across releases. */
  readonly id: string;
  /** Route path, passed straight through to `AppShellNavItem.to`. */
  readonly to: string;
  /** Omitted → every signed-in staff role sees the item (e.g. Dashboard). */
  readonly permission?: Permission;
  readonly label: StaffNavLabel;
  /** [30.5.1] Extra terms `CommandPalette`'s Page tab matches this item
   * against, alongside its translated `label` (en + bn) — plain-language
   * synonyms staff actually type ("routine" for the class timetable) that
   * would otherwise dead-end the search with no match. */
  readonly synonyms?: readonly string[];
}

export type StaffNavGroupId =
  | 'people'
  | 'academics'
  | 'attendance'
  | 'examsResults'
  | 'finance'
  | 'reports'
  | 'communications'
  | 'administration';

export interface StaffNavGroupDef {
  /** Stable id — kept identical to the pre-30.1.3 groups (`people`,
   * `finance`, `communications`, `administration`) where the group
   * survives this restructure, so a user's saved collapse preference for
   * it survives too. */
  readonly id: StaffNavGroupId;
  readonly label: StaffNavLabel;
  readonly items: readonly StaffNavItemDef[];
  readonly pinnedItems?: readonly StaffNavItemDef[];
  readonly pinnedLabel?: StaffNavLabel;
}

/** Every nav item, flat, keyed by its own `id` — the lookup `_staff.tsx`
 * uses to attach an icon and resolve a label, and what
 * `nav-tree.test.ts` asserts ids against directly. */
export const STAFF_NAV_ITEMS = {
  dashboard: {
    id: 'dashboard',
    to: '/dashboard',
    permission: Permission.DASHBOARD_VIEW,
    label: { key: 'dashboard' },
  },
  // [52.4.1] Top-level (ungrouped) work queue, rendered above the groups (D23).
  applications: {
    id: 'applications',
    to: '/applications',
    permission: Permission.APPLICATION_SUBMIT,
    label: { key: 'applications' },
    synonyms: ['application', 'leave', 'waiver', 'testimonial', 'আবেদন', 'ছুটি', 'মওকুফ'],
  },
  'people.students': {
    id: 'people.students',
    to: '/students',
    permission: Permission.STUDENT_READ,
    label: { entity: 'student' },
  },
  'people.guardians': {
    id: 'people.guardians',
    to: '/guardians',
    permission: Permission.GUARDIAN_READ,
    label: { entity: 'guardian' },
  },
  'people.calendar': {
    id: 'people.calendar',
    to: '/calendar',
    permission: Permission.CALENDAR_READ,
    label: { key: 'calendar' },
  },
  'people.staff': {
    id: 'people.staff',
    to: '/staff',
    permission: Permission.USER_READ,
    label: { entity: 'staff' },
  },
  // [13.6.1] People > Staff > Import from Excel — gated like the route.
  'people.staffImport': {
    id: 'people.staffImport',
    to: '/staff/import',
    permission: Permission.USER_CREATE,
    label: { key: 'importFromExcel' },
  },
  // [34.4.2] `PROGRAM_READ` — same "match the route's own gate" rule
  // this file follows throughout; `/programs`'s list route is gated on
  // `PROGRAM_READ` (`route-permissions.ts`).
  'people.programs': {
    id: 'people.programs',
    to: '/programs',
    permission: Permission.PROGRAM_READ,
    label: { key: 'programs' },
    synonyms: ['program', 'programs', 'hifz', 'club', 'milestone', 'track'],
  },
  // [27.9] Staff admission intakes list — gated same as the route itself
  // (`route-permissions.ts`), `admission:review`.
  'people.admissionIntakes': {
    id: 'people.admissionIntakes',
    to: '/admissions/intakes',
    permission: Permission.ADMISSION_REVIEW,
    label: { key: 'admissionIntakes' },
  },
  // [27.10] Staff admission applicants list — same gate as the intakes
  // nav item above.
  'people.admissionApplicants': {
    id: 'people.admissionApplicants',
    to: '/admissions/applicants',
    permission: Permission.ADMISSION_REVIEW,
    label: { key: 'admissionApplicants' },
  },
  // [39.4.2] Admission lifecycle report — gated like the route itself.
  'people.admissionReports': {
    id: 'people.admissionReports',
    to: '/admissions/reports',
    permission: Permission.STUDENT_LIFECYCLE_MANAGE,
    label: { key: 'admissionReports' },
  },
  // [29.0] Class/subject-teacher assignments, bulk-view across a class's
  // sections — `15-ux-principles.md` §3.1's "Teaching assignments (bulk
  // view)" line, gated on `CLASS_MANAGE` per D5 (same gate the class
  // detail page's Teachers tab already uses for the same mutation).
  'people.teachingAssignments': {
    id: 'people.teachingAssignments',
    to: '/staff/teaching-assignments',
    permission: Permission.CLASS_MANAGE,
    label: { key: 'teachingAssignments' },
  },
  // [28.4.1] People > Staff > Evaluations (D20) — ACR, survey results and
  // incidents in one place; `ACR_READ` is ADMIN-only today, so a teacher
  // never sees it.
  'people.evaluations': {
    id: 'people.evaluations',
    to: '/staff/evaluations',
    permission: Permission.ACR_READ,
    label: { key: 'evaluations' },
  },
  'academics.academicYears': {
    id: 'academics.academicYears',
    to: '/academic-years',
    permission: Permission.ACADEMIC_YEAR_MANAGE,
    label: { entity: 'academicYear' },
  },
  'academics.classes': {
    id: 'academics.classes',
    to: '/classes',
    permission: Permission.CLASS_MANAGE,
    label: { entity: 'class' },
  },
  'academics.homework': {
    id: 'academics.homework',
    to: '/academics/homework',
    permission: Permission.HOMEWORK_READ,
    label: { key: 'homework' },
    synonyms: ['assignment', 'classwork'],
  },
  'academics.syllabus': {
    id: 'academics.syllabus',
    to: '/academics/syllabus',
    permission: Permission.SYLLABUS_READ,
    label: { key: 'syllabus' },
  },
  'examsResults.gradingScales': {
    id: 'examsResults.gradingScales',
    to: '/grading-scales',
    permission: Permission.GRADING_SCALE_MANAGE,
    label: { key: 'gradingScales' },
  },
  // [19.6.1] `EXAM_MANAGE` — `/exams` is the exam management page, and
  // opening an exam's detail (`ExamsController.findOne`) plus every write
  // are `@Roles(ADMIN)` + `@RequirePermissions(EXAM_MANAGE)` server-side.
  // Only the bare list (`findAll`) is looser, on `MARK_VIEW`, so the
  // marks/analysis exam pickers load for teachers and executives.
  'examsResults.exams': {
    id: 'examsResults.exams',
    to: '/exams',
    permission: Permission.EXAM_MANAGE,
    label: { entity: 'exam' },
  },
  // [35.5.1] `EXAM_MANAGE` — same gate as `examsResults.exams` (D36).
  'examsResults.examTemplates': {
    id: 'examsResults.examTemplates',
    to: '/exams/templates',
    permission: Permission.EXAM_MANAGE,
    label: { key: 'examTemplates' },
  },
  // [26.5.1] `MARK_VIEW` — same "seeing is weaker than editing" gate
  // `/marks` already uses; analysis is a read-only view over processed
  // results, not a write action like `/results`'s `RESULT_PROCESS`.
  'examsResults.analysis': {
    id: 'examsResults.analysis',
    to: '/analysis',
    permission: Permission.MARK_VIEW,
    label: { key: 'analysis' },
  },
  // [26.6.1] D22: PROMOTION_MANAGE (admin).
  'examsResults.promotion': {
    id: 'examsResults.promotion',
    to: '/promotions',
    permission: Permission.PROMOTION_MANAGE,
    label: { key: 'promotion' },
  },
  // [25.6] `SEAT_PLAN_MANAGE` — `SeatPlansController`'s own gate, same
  // "match the controller's real requirement" reasoning `examsResults.exams`
  // gives above.
  'examsResults.seatPlans': {
    id: 'examsResults.seatPlans',
    to: '/exams/seat-plans',
    permission: Permission.SEAT_PLAN_MANAGE,
    label: { key: 'seatPlans' },
  },
  'academics.routineSetup': {
    id: 'academics.routineSetup',
    to: '/routines/setup',
    permission: Permission.ROUTINE_MANAGE,
    label: { key: 'routineSetup' },
  },
  'academics.routineBuilder': {
    id: 'academics.routineBuilder',
    to: '/routines',
    permission: Permission.ROUTINE_MANAGE,
    label: { key: 'routineBuilder' },
    synonyms: ['routine', 'timetable', 'grid'],
  },
  // [21.10.1] A teacher's own phone-first agenda — `ROUTINE_READ`
  // (`READ_ROLES` on `ResolveRoutineController`), not `ROUTINE_MANAGE`,
  // so every staff role that can see a routine at all sees this link,
  // not just the builder.
  'academics.myRoutine': {
    id: 'academics.myRoutine',
    to: '/routines/my',
    permission: Permission.ROUTINE_READ,
    label: { key: 'myRoutine' },
    synonyms: ['routine', 'timetable', 'agenda'],
  },
  // [47.4.2] TEACHER-only (`MY_CLASS_VIEW`): the class teacher's one-screen
  // view of their own homeroom section(s).
  'academics.myClass': {
    id: 'academics.myClass',
    to: '/my-class',
    permission: Permission.MY_CLASS_VIEW,
    label: { key: 'myClass' },
    synonyms: ['class teacher', 'form master', 'homeroom', 'my section'],
  },
  // [83.4.1] D9/D25: TEACHER-only (`COORDINATION_VIEW`); shows for every teacher like My
  // class (P12); a teacher with no coordinator rows sees the page's empty state.
  'academics.myCoordination': {
    id: 'academics.myCoordination',
    to: '/my-coordination',
    permission: Permission.COORDINATION_VIEW,
    label: { key: 'myCoordination' },
    synonyms: ['coordinator', 'class coordinator', 'subject coordinator', 'oversight'],
  },
  'attendance.attendance': {
    id: 'attendance.attendance',
    to: '/attendance',
    permission: Permission.ATTENDANCE_READ,
    label: { key: 'attendance' },
    synonyms: ['routine', 'timetable'],
  },
  'attendance.attendanceReports': {
    id: 'attendance.attendanceReports',
    to: '/attendance/reports',
    permission: Permission.ATTENDANCE_READ,
    label: { key: 'attendanceReports' },
  },
  'attendance.attendanceRegister': {
    id: 'attendance.attendanceRegister',
    to: '/attendance/register',
    permission: Permission.ATTENDANCE_READ,
    label: { key: 'attendanceRegister' },
  },
  // [36.4] Sibling entry, same style as `attendance.attendanceReports`
  // above — a distinct route/permission from the student register, not a
  // switcher on the existing `attendance.attendance` item.
  'attendance.staffAttendance': {
    id: 'attendance.staffAttendance',
    to: '/attendance/staff',
    permission: Permission.STAFF_ATTENDANCE_READ,
    label: { key: 'staffAttendance' },
  },
  'finance.dues': {
    id: 'finance.dues',
    to: '/fees/dues',
    permission: Permission.FEE_COLLECT,
    label: { key: 'studentDues' },
  },
  'finance.recordPayment': {
    id: 'finance.recordPayment',
    to: '/payments/record',
    permission: Permission.PAYMENT_RECORD,
    label: { key: 'recordPayment' },
  },
  'finance.feeStructures': {
    id: 'finance.feeStructures',
    to: '/fee-structures',
    permission: Permission.FEE_STRUCTURE_READ,
    label: { key: 'feeStructures' },
  },
  'finance.generateFees': {
    id: 'finance.generateFees',
    to: '/fees/generate',
    permission: Permission.FEE_GENERATE,
    label: { key: 'generateFees' },
  },
  'finance.recurringSchedules': {
    id: 'finance.recurringSchedules',
    to: '/fees/schedules',
    permission: Permission.SCHEDULE_MANAGE,
    label: { key: 'recurringSchedules' },
  },
  // [38.4.3] FEE_READ — same "blanket refusal matching nav visibility"
  // gate `route-permissions.ts` uses for this route.
  'finance.fines': {
    id: 'finance.fines',
    to: '/fees/fines',
    permission: Permission.FEE_READ,
    label: { key: 'fines' },
  },
  // [31.3.1] The payments list — same gate as its route (`PAYMENT_READ`).
  'finance.payments': {
    id: 'finance.payments',
    to: '/payments',
    permission: Permission.PAYMENT_READ,
    label: { key: 'payments' },
  },
  'finance.invoices': {
    id: 'finance.invoices',
    to: '/invoices',
    permission: Permission.INVOICE_READ,
    label: { entity: 'invoice' },
  },
  // [31.3.1] Pages that existed but had no sidebar item; each permission
  // equals its route's `STAFF_ROUTE_PERMISSIONS` entry.
  'examsResults.marksEntry': {
    id: 'examsResults.marksEntry',
    to: '/marks',
    permission: Permission.MARK_VIEW,
    label: { key: 'marksEntry' },
  },
  'examsResults.results': {
    id: 'examsResults.results',
    to: '/results',
    permission: Permission.RESULT_PROCESS,
    label: { key: 'results' },
  },
  'academics.routineReview': {
    id: 'academics.routineReview',
    to: '/routines/review',
    permission: Permission.ROUTINE_READ,
    label: { key: 'routineReview' },
  },
  'academics.routineSubstitutions': {
    id: 'academics.routineSubstitutions',
    to: '/routines/substitutions',
    permission: Permission.ROUTINE_MANAGE,
    label: { key: 'routineSubstitutions' },
  },
  'reports.collectionsReport': {
    id: 'reports.collectionsReport',
    to: '/reports/collections',
    permission: Permission.REPORT_COLLECTIONS_READ,
    label: { key: 'collectionsReport' },
  },
  'communications.sendMessage': {
    id: 'communications.sendMessage',
    to: '/communications/send',
    permission: Permission.COMMUNICATION_SEND,
    label: { key: 'sendMessage' },
  },
  // [67.5.09] Manual alerts (D32) and their monthly report (D33).
  'communications.sendAlert': {
    id: 'communications.sendAlert',
    to: '/communications/send-alert',
    permission: Permission.ALERT_SEND,
    label: { key: 'sendAlert' },
    synonyms: ['alert', 'warning', 'announce', 'সতর্কতা'],
  },
  'reports.alertsReport': {
    id: 'reports.alertsReport',
    to: '/reports/alerts',
    permission: Permission.ALERT_REPORT_READ,
    label: { key: 'alertsReport' },
    synonyms: ['alerts', 'breach', 'সতর্কতা'],
  },
  'communications.feeReminders': {
    id: 'communications.feeReminders',
    to: '/communications/reminders',
    permission: Permission.COMMUNICATION_BULK_SEND,
    label: { key: 'feeReminders' },
  },
  'communications.reminderHistory': {
    id: 'communications.reminderHistory',
    to: '/communications/batches',
    permission: Permission.COMMUNICATION_BULK_SEND,
    label: { key: 'reminderHistory' },
  },
  // [32.4.1] Template design + the library. `PRINT_TEMPLATE_MANAGE` is the templates controller's gate.
  'administration.printTemplates': {
    id: 'administration.printTemplates',
    to: '/print-templates',
    permission: Permission.PRINT_TEMPLATE_MANAGE,
    label: { key: 'printTemplates' },
    synonyms: ['ID card', 'certificate', 'design', 'template'],
  },
  'reports.printables': {
    id: 'reports.printables',
    to: '/reports/printables',
    permission: Permission.PRINT_HISTORY_READ,
    label: { key: 'printables' },
    synonyms: ['ID card', 'printed', 'reprint', 'history'],
  },
  'reports.applications': {
    id: 'reports.applications',
    to: '/applications/reports',
    permission: Permission.APPLICATION_MANAGE,
    label: { key: 'applicationsReportsNav' },
  },
  // [24.3.5] Read-only role comparison (D25: gated on USER_READ).
  'administration.roles': {
    id: 'administration.roles',
    to: '/roles',
    permission: Permission.USER_READ,
    label: { key: 'rolesAccess' },
    synonyms: ['role', 'permission', 'access', 'রোল'],
  },
  'administration.auditLogs': {
    id: 'administration.auditLogs',
    to: '/audit-logs',
    permission: Permission.AUDIT_LOG_READ,
    label: { key: 'auditLogs' },
  },
  'administration.settings': {
    id: 'administration.settings',
    to: '/settings',
    permission: Permission.SETTINGS_MANAGE,
    label: { key: 'settings' },
  },
  // [35.5.1] Settings › Curriculum preset (D12), gated like its route.
  'administration.curriculumPreset': {
    id: 'administration.curriculumPreset',
    to: '/curriculum-preset',
    permission: Permission.CURRICULUM_PRESET_APPLY,
    label: { key: 'curriculumPreset' },
  },
} as const satisfies Record<string, StaffNavItemDef>;

/**
 * The [15-ux-principles.md] §3 restructure: Dashboard stays a flat item;
 * People/Finance/Communications/Administration keep their pre-30.1.3
 * group `id`s (so saved collapse preferences survive) but shed the items
 * the three new domain groups now own; **Academics**, **Attendance** and
 * **Reports** are new groups carved out of Administration/People/Finance;
 * **Exams & Results** started with zero items ([30.1.3]) — `AppShell`
 * auto-hides an empty group (`app-shell.tsx`'s `NavGroupSection`) — and
 * gained its first two, `examsResults.gradingScales` and (19.6.1)
 * `examsResults.exams`, as Epic 19.0 landed routes for it.
 */
/** [30.5.1] `CommandPalette`'s Page-tab match predicate: does `query`
 * appear in the item's already-resolved display `label`, or in one of
 * its `synonyms`? Pure and React-free so it is unit-testable directly,
 * without rendering the palette — `command-palette-launcher.tsx` is the
 * only caller. An empty `query` matches every item — the Page tab lists
 * everything when nothing is typed (#1733 D2). */
export function matchesNavSearch(
  label: string,
  synonyms: readonly string[] | undefined,
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (label.toLowerCase().includes(trimmed)) return true;
  return (synonyms ?? []).some((synonym) => synonym.toLowerCase().includes(trimmed));
}

/** #1733 D11 + D4: within one group, enabled before disabled, then
 * "label starts with query" before "contains / synonym-only", otherwise
 * input order (Array.prototype.sort is stable). */
export function rankByMatch<T extends { label: string; disabled?: boolean }>(
  results: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  const key = (r: T) =>
    (r.disabled ? 2 : 0) + (q !== '' && r.label.toLowerCase().startsWith(q) ? 0 : 1);
  return [...results].sort((a, b) => key(a) - key(b));
}

/** [52.4.1] The ungrouped items above the groups (D23). */
export const STAFF_TOP_NAV_ITEMS = [
  STAFF_NAV_ITEMS.dashboard,
  STAFF_NAV_ITEMS.applications,
] as const;

export const STAFF_NAV_GROUPS: readonly StaffNavGroupDef[] = [
  {
    id: 'people',
    label: { key: 'people' },
    items: [
      STAFF_NAV_ITEMS['people.students'],
      STAFF_NAV_ITEMS['people.guardians'],
      STAFF_NAV_ITEMS['people.calendar'],
      STAFF_NAV_ITEMS['people.staff'],
      STAFF_NAV_ITEMS['people.staffImport'],
      STAFF_NAV_ITEMS['people.programs'],
      STAFF_NAV_ITEMS['people.admissionIntakes'],
      STAFF_NAV_ITEMS['people.admissionApplicants'],
      STAFF_NAV_ITEMS['people.admissionReports'],
      STAFF_NAV_ITEMS['people.teachingAssignments'],
      STAFF_NAV_ITEMS['people.evaluations'],
    ],
  },
  {
    id: 'academics',
    label: { key: 'academics' },
    items: [
      STAFF_NAV_ITEMS['academics.academicYears'],
      STAFF_NAV_ITEMS['academics.classes'],
      STAFF_NAV_ITEMS['academics.routineSetup'],
      STAFF_NAV_ITEMS['academics.routineBuilder'],
      STAFF_NAV_ITEMS['academics.routineReview'],
      STAFF_NAV_ITEMS['academics.routineSubstitutions'],
      STAFF_NAV_ITEMS['academics.myRoutine'],
      STAFF_NAV_ITEMS['academics.myClass'],
      STAFF_NAV_ITEMS['academics.myCoordination'],
      STAFF_NAV_ITEMS['academics.homework'],
      STAFF_NAV_ITEMS['academics.syllabus'],
    ],
  },
  {
    id: 'attendance',
    label: { key: 'attendance' },
    items: [
      STAFF_NAV_ITEMS['attendance.attendance'],
      STAFF_NAV_ITEMS['attendance.attendanceReports'],
      STAFF_NAV_ITEMS['attendance.attendanceRegister'],
      STAFF_NAV_ITEMS['attendance.staffAttendance'],
    ],
  },
  {
    id: 'examsResults',
    label: { key: 'examsResults' },
    items: [
      STAFF_NAV_ITEMS['examsResults.exams'],
      STAFF_NAV_ITEMS['examsResults.examTemplates'],
      STAFF_NAV_ITEMS['examsResults.marksEntry'],
      STAFF_NAV_ITEMS['examsResults.seatPlans'],
      STAFF_NAV_ITEMS['examsResults.gradingScales'],
      STAFF_NAV_ITEMS['examsResults.results'],
      STAFF_NAV_ITEMS['examsResults.analysis'],
      STAFF_NAV_ITEMS['examsResults.promotion'],
    ],
  },
  {
    id: 'finance',
    label: { key: 'finance' },
    pinnedLabel: { key: 'quickActions' },
    pinnedItems: [STAFF_NAV_ITEMS['finance.dues'], STAFF_NAV_ITEMS['finance.recordPayment']],
    items: [
      STAFF_NAV_ITEMS['finance.feeStructures'],
      STAFF_NAV_ITEMS['finance.generateFees'],
      STAFF_NAV_ITEMS['finance.recurringSchedules'],
      STAFF_NAV_ITEMS['finance.fines'],
      STAFF_NAV_ITEMS['finance.payments'],
      STAFF_NAV_ITEMS['finance.invoices'],
    ],
  },
  {
    id: 'reports',
    label: { key: 'reports' },
    items: [
      STAFF_NAV_ITEMS['reports.collectionsReport'],
      STAFF_NAV_ITEMS['reports.printables'],
      STAFF_NAV_ITEMS['reports.applications'],
      STAFF_NAV_ITEMS['reports.alertsReport'],
    ],
  },
  {
    id: 'communications',
    label: { key: 'communications' },
    items: [
      STAFF_NAV_ITEMS['communications.sendMessage'],
      STAFF_NAV_ITEMS['communications.sendAlert'],
      STAFF_NAV_ITEMS['communications.feeReminders'],
      STAFF_NAV_ITEMS['communications.reminderHistory'],
    ],
  },
  {
    id: 'administration',
    label: { key: 'administration' },
    items: [
      STAFF_NAV_ITEMS['administration.printTemplates'],
      STAFF_NAV_ITEMS['administration.roles'],
      STAFF_NAV_ITEMS['administration.auditLogs'],
      STAFF_NAV_ITEMS['administration.settings'],
      STAFF_NAV_ITEMS['administration.curriculumPreset'],
    ],
  },
];

export type StaffNavItemId = keyof typeof STAFF_NAV_ITEMS;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** One phone bottom-bar cell: a nav item plus the `nav:bottomNavCells.*` short label key. */
export interface BottomNavCellDef {
  readonly id: StaffNavItemId;
  readonly shortLabelKey: string;
}

const cell = (id: StaffNavItemId, shortLabelKey: string): BottomNavCellDef => ({
  id,
  shortLabelKey,
});

/** [31.3.1] Each role's own bottom-bar cells (nav-icons.md "Bottom-bar cells per role"). */
export const STAFF_BOTTOM_NAV: Record<StaffRole, readonly BottomNavCellDef[]> = {
  SUPER_ADMIN: [
    cell('dashboard', 'dashboard'),
    cell('people.students', 'students'),
    cell('attendance.attendance', 'attendance'),
    cell('finance.dues', 'dues'),
  ],
  ADMIN: [
    cell('dashboard', 'dashboard'),
    cell('people.students', 'students'),
    cell('attendance.attendance', 'attendance'),
    cell('finance.dues', 'dues'),
  ],
  ACCOUNTANT: [
    cell('dashboard', 'dashboard'),
    cell('finance.dues', 'dues'),
    cell('finance.recordPayment', 'payment'),
    cell('finance.invoices', 'invoices'),
  ],
  EXECUTIVE: [
    cell('dashboard', 'dashboard'),
    cell('people.students', 'students'),
    cell('attendance.attendance', 'attendance'),
    cell('reports.collectionsReport', 'reports'),
  ],
  // [8.10.7.5.16] D23 — the teacher dashboard is the home again; My class stays in the drawer and the palette.
  TEACHER: [
    cell('dashboard', 'dashboard'),
    cell('attendance.attendance', 'attendance'),
    cell('academics.myRoutine', 'routine'),
    cell('academics.homework', 'homework'),
  ],
  OFFICE_STAFF: [
    cell('dashboard', 'dashboard'),
    cell('people.students', 'students'),
    cell('people.admissionApplicants', 'applicants'),
    cell('attendance.attendance', 'attendance'),
  ],
  EXAM_CONTROLLER: [
    cell('dashboard', 'dashboard'),
    cell('examsResults.exams', 'exams'),
    cell('examsResults.analysis', 'analysis'),
    cell('people.students', 'students'),
  ],
  // Two cells: "up to 4, never empty or duplicate" (C8).
  COMMITTEE: [cell('dashboard', 'dashboard'), cell('people.calendar', 'calendar')],
};

/** true when `pathname` is `to` or under it on whole segments ("/fees" does not own "/feesx"). */
export function isPathUnder(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

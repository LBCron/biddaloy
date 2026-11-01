import { Permission } from '@biddaloy/shared';

import type { StaffNavGroupId } from './nav-tree';

/**
 * [30.4.2] The command-palette action registry.
 *
 * Lives beside `route-permissions.ts` / `route-loaders.ts`, not in `ui/` —
 * `ui/` only holds the *types* the palette component renders; the actual
 * seed data belongs here because `run()` is a router navigation, and the
 * router is `client-admin`-owned (the palette contract keeps `ui/` route
 * agnostic, D12).
 *
 * ## The rule this file enforces
 *
 * An action becomes reachable from the palette **only** by being listed
 * here — never by scanning routes at runtime. Every entry's `permission`
 * must be the *exact* permission the corresponding route (or the nav item
 * that already links to it) is gated on in `route-permissions.ts` — the
 * palette must never grant a shortcut to something the sidebar wouldn't
 * already show. Do not widen access to add an entry.
 *
 * `ActionRunContext` carries no entity id, so entity-scoped actions land on
 * the list and the user picks the row. Create/record actions open their
 * dialog through a one-shot search flag on the page (`?new=1`, see
 * `routes/_staff/-use-landing-flag.ts`).
 *
 * ## Delete-your-lines protocol
 *
 * If you delete or rename a route this file points at, delete (or fix)
 * the matching entry in the same commit — a dangling `run()` target is a
 * silent 404 from the palette, not a compile error `tsc` would catch.
 */

/** The entity kinds a palette action may be scoped to. */
export type ActionContext = 'student' | 'guardian' | 'invoice' | 'gradingScale' | 'exam';

/** How the palette presents the action once triggered. */
export type ActionKind = 'modal' | 'navigate' | 'inline' | 'external';

/** What `run()` receives — currently just a TanStack Router navigate. */
export interface ActionRunContext {
  readonly navigate: (opts: { readonly to: string }) => void;
  /** Ids of the current route, when it has them (the palette's context). */
  readonly params?: {
    readonly studentId?: string | undefined;
    readonly examId?: string | undefined;
  };
  /** [44.2.01] The guide URL of the current page, or null when it has none (E17). */
  readonly helpHref?: string | null;
}

export interface PaletteAction {
  readonly id: string;
  readonly label: { readonly en: string; readonly bn: string };
  /** Extra words the palette search also matches (any language), e.g. what staff call the thing. */
  readonly synonyms?: readonly string[];
  /** `null` = any role (not a route: E17 `help.thisPage`). */
  readonly permission: Permission | null;
  /** Extra permissions the action needs on top of the route's `permission` (all must hold). */
  readonly alsoRequires?: readonly Permission[];
  readonly kind: ActionKind;
  /** Palette Action-tab section = the nav group of the page `run()` lands on
   * (`administration`/`reports` for the few targets outside the nav tree).
   * `top` = the ungrouped items above the groups. */
  readonly group: StaffNavGroupId | 'top';
  readonly context?: readonly ActionContext[];
  readonly run: (ctx: ActionRunContext) => void;
}

/**
 * Seed actions, drawn from dialogs that already have a dedicated route
 * (so `run()` can reuse the page's own component by navigating to it,
 * per U7 — never a second copy of the form). Each `permission` is copied
 * verbatim from `route-permissions.ts`'s entry for the same route.
 */
export const ACTIONS: readonly PaletteAction[] = [
  // [44.2.01] E17: opens the guide page in a new tab; the launcher hides it when the page has none.
  {
    id: 'help.thisPage',
    label: { en: 'Help for this page', bn: 'এই পাতার সাহায্য' },
    permission: null,
    kind: 'external',
    group: 'top',
    run: (ctx) => {
      if (ctx.helpHref) window.open(ctx.helpHref, '_blank', 'noopener');
    },
  },
  // [52.4.1] Applications (D25). Decide rights come from the catalogue, so these only need submit.
  {
    id: 'applications.new',
    label: { en: 'New application', bn: 'নতুন আবেদন' },
    permission: Permission.APPLICATION_SUBMIT,
    kind: 'navigate',
    group: 'top',
    run: (ctx) => ctx.navigate({ to: '/applications/new' }),
  },
  {
    id: 'applications.inbox',
    label: { en: 'Applications waiting for me', bn: 'আমার সিদ্ধান্তের অপেক্ষায় থাকা আবেদন' },
    permission: Permission.APPLICATION_SUBMIT,
    kind: 'navigate',
    group: 'top',
    run: (ctx) => ctx.navigate({ to: '/applications?view=inbox' }),
  },
  {
    id: 'applications.apply-leave',
    label: { en: 'Apply for leave', bn: 'ছুটির আবেদন করুন' },
    permission: Permission.APPLICATION_SUBMIT,
    kind: 'navigate',
    group: 'top',
    run: (ctx) => ctx.navigate({ to: '/applications/new?type=STAFF_LEAVE' }),
  },
  {
    id: 'payments.record',
    label: { en: 'Record payment', bn: 'পেমেন্ট রেকর্ড করুন' },
    permission: Permission.PAYMENT_RECORD,
    kind: 'navigate',
    group: 'finance',
    context: ['student', 'invoice'],
    run: (ctx) => ctx.navigate({ to: '/payments/record' }),
  },
  // [35.5.1] D14: no availability predicate — the page renders a read-only
  // summary once a preset is applied.
  {
    id: 'presets.apply',
    label: { en: 'Use a ready-made curriculum', bn: 'তৈরি শিক্ষাক্রম ব্যবহার করুন' },
    permission: Permission.CURRICULUM_PRESET_APPLY,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/curriculum-preset' }),
  },
  // [8.10.7.5.99] D13: dashboard actions.
  {
    id: 'dashboard.customise',
    label: { en: 'Customise dashboard', bn: 'ড্যাশবোর্ড সাজান' },
    permission: Permission.DASHBOARD_VIEW,
    kind: 'navigate',
    group: 'top',
    run: (ctx) => ctx.navigate({ to: '/dashboard?customize=1' }),
  },
  {
    id: 'dashboard.committeeReport',
    label: { en: 'Committee monthly report', bn: 'মাসিক সভার রিপোর্ট' },
    permission: Permission.COMMITTEE_REPORT_READ,
    kind: 'navigate',
    group: 'reports',
    run: (ctx) => ctx.navigate({ to: '/print/committee-report?from=/dashboard' }),
  },
  {
    id: 'roles.view',
    label: { en: 'Roles & access', bn: 'ভূমিকা ও অনুমতি' },
    permission: Permission.USER_READ,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/roles' }),
  },
  {
    id: 'examTemplates.createExam',
    label: { en: 'Create exam from template', bn: 'টেমপ্লেট থেকে পরীক্ষা তৈরি করুন' },
    permission: Permission.EXAM_MANAGE,
    kind: 'modal',
    group: 'examsResults',
    run: (ctx) => ctx.navigate({ to: '/exams?create=1' }),
  },
  {
    id: 'seatPlans.generate',
    label: { en: 'Generate seat plan', bn: 'সিট প্ল্যান তৈরি করুন' },
    permission: Permission.SEAT_PLAN_MANAGE,
    kind: 'navigate',
    group: 'examsResults',
    run: (ctx) => ctx.navigate({ to: '/exams/seat-plans?generate=1' }),
  },
  {
    id: 'seatPlans.publish',
    label: { en: 'Publish seat plan', bn: 'সিট প্ল্যান প্রকাশ করুন' },
    permission: Permission.SEAT_PLAN_MANAGE,
    kind: 'modal',
    group: 'examsResults',
    // Same "no entity id" limitation as `results.publish`/`grading.copyScale`
    // above — `ActionRunContext` carries no plan id, so this lands on the
    // seat plans list, one click from a specific plan's own Publish button.
    run: (ctx) => ctx.navigate({ to: '/exams/seat-plans' }),
  },
  {
    id: 'communications.sendMessage',
    label: { en: 'Send message', bn: 'বার্তা পাঠান' },
    permission: Permission.COMMUNICATION_SEND,
    kind: 'navigate',
    group: 'communications',
    context: ['student', 'guardian'],
    run: (ctx) => ctx.navigate({ to: '/communications/send' }),
  },
  {
    id: 'attention.send',
    label: { en: 'Send an alert', bn: 'সতর্কতা পাঠান' },
    permission: Permission.ALERT_SEND,
    kind: 'modal',
    group: 'communications',
    // The route is the full-page modal (like `students.add` -> `/students/new`).
    run: (ctx) => ctx.navigate({ to: '/communications/send-alert' }),
  },
  {
    id: 'attention.report',
    label: { en: 'Alerts report', bn: 'সতর্কতা প্রতিবেদন' },
    permission: Permission.ALERT_REPORT_READ,
    kind: 'navigate',
    group: 'reports',
    run: (ctx) => ctx.navigate({ to: '/reports/alerts' }),
  },
  {
    id: 'communications.sendFeeReminder',
    label: { en: 'Send fee reminder', bn: 'ফি রিমাইন্ডার পাঠান' },
    permission: Permission.COMMUNICATION_BULK_SEND,
    kind: 'navigate',
    group: 'communications',
    run: (ctx) => ctx.navigate({ to: '/communications/reminders' }),
  },
  {
    id: 'communications.messageLog',
    label: { en: 'Message log', bn: 'বার্তার তালিকা' },
    permission: Permission.COMMUNICATION_BULK_SEND,
    kind: 'navigate',
    group: 'communications',
    run: (ctx) => ctx.navigate({ to: '/communications/message-log' }),
  },
  {
    id: 'attendance.take',
    label: { en: 'Take attendance', bn: 'উপস্থিতি নিন' },
    permission: Permission.ATTENDANCE_READ,
    kind: 'navigate',
    group: 'attendance',
    run: (ctx) => ctx.navigate({ to: '/attendance' }),
  },
  // [41.4.7] Both land on a filtered/edit-mode view of an existing route
  // (`ctx.navigate` only takes a `to` string, so the search rides in it,
  // like `fees.generate`). The register route itself is gated at
  // ATTENDANCE_READ; edit mode needs ATTENDANCE_MARK (stricter, on purpose).
  {
    id: 'attendance.pending',
    label: { en: "Today's pending attendance", bn: 'আজকের বাকি উপস্থিতি' },
    permission: Permission.ATTENDANCE_READ,
    kind: 'navigate',
    group: 'attendance',
    run: (ctx) => ctx.navigate({ to: '/attendance?status=pending' }),
  },
  {
    id: 'attendance.register.edit',
    label: { en: 'Edit monthly register', bn: 'মাসিক খাতা সম্পাদনা' },
    permission: Permission.ATTENDANCE_MARK,
    kind: 'navigate',
    group: 'attendance',
    run: (ctx) => ctx.navigate({ to: '/attendance/register?edit=true' }),
  },
  // [36.4] Mirrors `attendance.take` above — permission copied verbatim
  // from `route-permissions.ts`'s `/_staff/attendance/staff/` entry.
  {
    id: 'attendance.markStaff',
    label: { en: 'Mark staff attendance', bn: 'কর্মীর উপস্থিতি নিন' },
    permission: Permission.STAFF_ATTENDANCE_READ,
    kind: 'navigate',
    group: 'attendance',
    run: (ctx) => ctx.navigate({ to: '/attendance/staff' }),
  },
  {
    id: 'fees.generate',
    label: { en: 'Create fee bills', bn: 'ফির বিল তৈরি করুন' },
    permission: Permission.FEE_GENERATE,
    kind: 'navigate',
    group: 'finance',
    run: (ctx) => ctx.navigate({ to: '/fees/generate?generate=1' }),
  },
  // [38.4.3] `/_staff/fees/fines/` itself only requires FEE_READ (its
  // route gate) — these three actions are stricter than that on purpose
  // (only who can log/generate/waive a fine should see them from the
  // palette), same documented "route is broader than the action" shape
  // `programs.add`/`programs.enrol` already use, per
  // `action-registry.test.ts`'s `ROUTE_PERMISSION_EXCEPTIONS`. `run()`
  // carries no entity id,
  // so all three land unprefilled on `/fees/fines` — `?logFine=1`/
  // `?generateFines=1` open the modal on arrival; waive has no such flag
  // (no fine id to open one *for*), so it lands on the plain list.
  {
    id: 'fines.log',
    label: { en: 'Log fine', bn: 'জরিমানা যোগ করুন' },
    permission: Permission.FEE_GENERATE,
    kind: 'navigate',
    group: 'finance',
    context: ['student'],
    run: (ctx) => ctx.navigate({ to: '/fees/fines?logFine=1' }),
  },
  {
    id: 'fines.generate',
    label: { en: 'Generate fines', bn: 'জরিমানা তৈরি করুন' },
    permission: Permission.FEE_GENERATE,
    kind: 'navigate',
    group: 'finance',
    run: (ctx) => ctx.navigate({ to: '/fees/fines?generateFines=1' }),
  },
  {
    id: 'fines.waive',
    label: { en: 'Waive fine', bn: 'জরিমানা মাফ করুন' },
    permission: Permission.FEE_APPROVE,
    kind: 'modal',
    group: 'finance',
    context: ['student'],
    run: (ctx) => ctx.navigate({ to: '/fees/fines' }),
  },
  // [28.3.2/D22, 28.4.2/U7] ACR actions have no entity id in `run()`, so they
  // land on the evaluations page with a one-shot flag (`?startAcr=1` /
  // `?reportIncident=1`, same shape as `fines.log`); that page opens the very
  // same `StartAcrDialog` / `ReportIncidentDialog` the staff tabs use, with a
  // staff picker since no staff member is in context. `ACR_WRITE` is stricter
  // than the route's ACR_READ gate on purpose (see `ROUTE_PERMISSION_EXCEPTIONS`).
  {
    id: 'acr.start',
    label: { en: 'Start ACR', bn: 'এসিআর শুরু করুন' },
    permission: Permission.ACR_WRITE,
    kind: 'modal',
    group: 'people',
    context: [],
    run: (ctx) => ctx.navigate({ to: '/staff/evaluations?startAcr=1' }),
  },
  {
    id: 'incidents.report',
    label: { en: 'Report an incident', bn: 'ঘটনা জানান' },
    permission: Permission.ACR_WRITE,
    kind: 'modal',
    group: 'people',
    context: [],
    run: (ctx) => ctx.navigate({ to: '/staff/evaluations?reportIncident=1' }),
  },
  // [28.4.2/D22] Same one-shot flag shape; the evaluations page opens the
  // survey dialog and switches to its Surveys tab. ACR_WRITE is stricter than
  // the route's ACR_READ gate, same as `acr.start`.
  {
    id: 'surveys.publish',
    label: { en: 'Publish teacher survey', bn: 'শিক্ষক জরিপ চালু করুন' },
    permission: Permission.ACR_WRITE,
    kind: 'navigate',
    group: 'people',
    context: [],
    run: (ctx) => ctx.navigate({ to: '/staff/evaluations?tab=surveys&publishSurvey=1' }),
  },
  // [28.4.5/D22] No entity id in `run()`: lands on the student list with a
  // flag that makes each row's "View" open the Performance tab.
  {
    id: 'performance.open',
    label: { en: 'Open performance', bn: 'পারফরম্যান্স দেখুন' },
    permission: Permission.MARK_VIEW,
    kind: 'navigate',
    group: 'people',
    context: ['student'],
    run: (ctx) => ctx.navigate({ to: '/students?openPerformance=1' }),
  },
  {
    id: 'students.add',
    label: { en: 'Add student', bn: 'শিক্ষার্থী যোগ করুন' },
    permission: Permission.STUDENT_CREATE,
    kind: 'navigate',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/students/new' }),
  },
  // [13.6.1] Permissions copied from `route-permissions.ts`. "Continue setting
  // up" shows for every ADMIN, finished or not (the palette has no per-action
  // predicate); `/welcome` is harmless once setup is done.
  {
    id: 'onboarding.continue',
    label: { en: 'Continue setting up your school', bn: 'স্কুলের সেটআপ চালিয়ে যান' },
    permission: Permission.SETTINGS_MANAGE,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/welcome' }),
  },
  // [67.2.06] D16 — Epic 67 attention palette actions; portal users reach alerts from the bar and bell (the portal palette has no actions for PARENT/STUDENT, who lack DASHBOARD_VIEW).
  {
    id: 'attention.show',
    label: { en: 'Show alerts', bn: 'সতর্কতা দেখুন' },
    permission: Permission.DASHBOARD_VIEW,
    kind: 'modal',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/notifications?alerts=1' }),
  },
  {
    id: 'attention.todo',
    label: { en: 'My to-do', bn: 'আমার করণীয়' },
    permission: Permission.DASHBOARD_VIEW,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/notifications?tab=active' }),
  },
  {
    id: 'attention.settings',
    label: { en: 'Alert settings', bn: 'সতর্কতার সেটিংস' },
    permission: Permission.SETTINGS_MANAGE,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/settings?section=alerts' }),
  },
  {
    id: 'staff.import',
    label: { en: 'Import staff from Excel', bn: 'এক্সেল থেকে কর্মী আমদানি করুন' },
    permission: Permission.USER_CREATE,
    kind: 'navigate',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/staff/import' }),
  },
  {
    id: 'account.sign-in-methods',
    label: { en: 'Sign-in methods', bn: 'সাইন-ইন পদ্ধতি' },
    permission: Permission.DASHBOARD_VIEW,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/security' }),
  },
  {
    id: 'students.import',
    label: { en: 'Import students', bn: 'শিক্ষার্থী আমদানি করুন' },
    permission: Permission.STUDENT_BULK_UPLOAD,
    kind: 'navigate',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/students/import' }),
  },
  {
    id: 'grading.copyScale',
    label: { en: 'Copy grading scale', bn: 'গ্রেডিং স্কেল কপি করুন' },
    permission: Permission.GRADING_SCALE_MANAGE,
    kind: 'modal',
    group: 'examsResults',
    context: ['gradingScale'],
    // `ActionRunContext` carries no entity id — lands on the scales list instead of
    // a specific scale's editor; its own Copy button opens
    // `-copy-scale-dialog.tsx` from there (U7: reuse the page, never a
    // second copy of the dialog).
    run: (ctx) => ctx.navigate({ to: '/grading-scales' }),
  },
  {
    id: 'programs.add',
    label: { en: 'Add program', bn: 'প্রোগ্রাম যোগ করুন' },
    permission: Permission.PROGRAM_MANAGE,
    kind: 'modal',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/programs?new=1' }),
  },
  {
    id: 'programs.enrol',
    label: { en: 'Enrol students', bn: 'শিক্ষার্থী তালিকাভুক্ত করুন' },
    permission: Permission.PROGRAM_MANAGE,
    kind: 'modal',
    group: 'people',
    context: ['student'],
    // Same "no entity id" limitation as `grading.copyScale` above —
    // `ActionRunContext` carries no student id, so this lands on
    // `/programs`'s own enrol dialog unprefilled rather than a specific
    // student pre-selected.
    run: (ctx) => ctx.navigate({ to: '/programs?enrol=1' }),
  },
  {
    id: 'programs.recordMilestone',
    label: { en: 'Record achievement', bn: 'অর্জন রেকর্ড করুন' },
    permission: Permission.PROGRAM_READ,
    kind: 'modal',
    group: 'people',
    context: ['student'],
    // Same "no entity id" limitation as `programs.enrol` above.
    run: (ctx) => ctx.navigate({ to: '/programs?record=1' }),
  },
  /**
   * [21.9.1] `run()` only carries `navigate({ to })` — there is no way to
   * pass the slot/date "context" the ticket names, or to auto-open a
   * dialog remotely. Both land the caller on the page that has it, one
   * click away, the same limitation this file's own header comment
   * already documents for the five actions in `UNREGISTERED_ACTIONS`
   * (flagged here rather than silently pretending it's context-aware).
   */
  // [47.4.2] D13. `?then=attendance` makes `/my-class` skip straight to the
  // register when the teacher has exactly one section.
  {
    id: 'my-class.open',
    label: { en: 'Open my class', bn: 'আমার শ্রেণি খুলুন' },
    permission: Permission.MY_CLASS_VIEW,
    kind: 'navigate',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/my-class' }),
  },
  {
    id: 'my-class.take-attendance',
    label: { en: "Take my class's attendance", bn: 'আমার শ্রেণির উপস্থিতি নিন' },
    permission: Permission.MY_CLASS_VIEW,
    kind: 'navigate',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/my-class?then=attendance' }),
  },
  // [84.3.6] Lands on the My class card (`?then=arrival` focuses it). The permission is
  // stricter than the route's MY_CLASS_VIEW; both must hold (see `ROUTE_PERMISSION_EXCEPTIONS`).
  {
    id: 'arrival-notice.requests',
    label: { en: 'Arrival notice requests', bn: 'আগমন বার্তার অনুরোধ' },
    permission: Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE,
    synonyms: ['আগমন', 'arrival', 'reached school'],
    alsoRequires: [Permission.MY_CLASS_VIEW],
    kind: 'navigate',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/my-class?then=arrival' }),
  },
  {
    id: 'routines.openMyRoutine',
    label: { en: 'Open my routine', bn: 'আমার রুটিন খুলুন' },
    permission: Permission.ROUTINE_READ,
    kind: 'navigate',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/routines/my' }),
  },
  {
    id: 'routines.addSubstitution',
    label: { en: 'Add substitute teacher', bn: 'বদলি শিক্ষক যোগ করুন' },
    permission: Permission.ROUTINE_MANAGE,
    kind: 'modal',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/routines/substitutions' }),
  },
  {
    id: 'routines.copyLastYearRoutine',
    label: { en: "Copy last year's routine", bn: 'গত বছরের রুটিন কপি করুন' },
    // The copy button itself is `ROUTINE_MANAGE`-gated inside
    // `review.tsx` — but that route's own blanket gate is `ROUTINE_READ`
    // (a teacher can open it too, to see their own slots), and this
    // file's own rule requires the action's permission to match the
    // *route's* gate, not the narrower in-page control.
    permission: Permission.ROUTINE_READ,
    kind: 'modal',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/routines/review' }),
  },
  {
    id: 'results.enterMarks',
    label: { en: 'Enter marks', bn: 'নম্বর প্রবেশ করান' },
    permission: Permission.MARK_VIEW,
    kind: 'navigate',
    group: 'examsResults',
    run: (ctx) => ctx.navigate({ to: '/marks' }),
  },
  {
    id: 'results.process',
    label: { en: 'Process result', bn: 'ফলাফল প্রক্রিয়া করুন' },
    permission: Permission.RESULT_PROCESS,
    kind: 'modal',
    group: 'examsResults',
    // Same "no entity id" pattern as `grading.copyScale` above — lands on
    // the exam picker (`/results`) rather than a specific exam's dialog.
    run: (ctx) => ctx.navigate({ to: '/results' }),
  },
  {
    id: 'results.publish',
    label: { en: 'Publish result', bn: 'ফলাফল প্রকাশ করুন' },
    // Matches `/_staff/results/`'s own gate (`RESULT_PROCESS`), not
    // `RESULT_PUBLISH` — see `route-permissions.ts`'s comment on why the
    // whole route shares one permission.
    permission: Permission.RESULT_PROCESS,
    kind: 'modal',
    group: 'examsResults',
    run: (ctx) => ctx.navigate({ to: '/results' }),
  },
  {
    id: 'results.sendSms',
    label: { en: 'Send result SMS', bn: 'ফলাফল এসএমএস পাঠান' },
    permission: Permission.RESULT_PROCESS,
    kind: 'modal',
    group: 'examsResults',
    run: (ctx) => ctx.navigate({ to: '/results' }),
  },
  {
    id: 'admissions.reviewApplicant',
    label: { en: 'Review applicant', bn: 'আবেদনকারী পর্যালোচনা করুন' },
    permission: Permission.ADMISSION_REVIEW,
    kind: 'navigate',
    group: 'people',
    // No entity id in `ActionRunContext` — lands on the applicants list, same "no entity id"
    // pattern as `grading.copyScale`/`results.process` above.
    run: (ctx) => ctx.navigate({ to: '/admissions/applicants' }),
  },
  {
    id: 'admissions.admitApplicant',
    label: { en: 'Admit applicant', bn: 'আবেদনকারী ভর্তি করুন' },
    permission: Permission.ADMISSION_REVIEW,
    kind: 'modal',
    group: 'people',
    // Same "no entity id" pattern — lands on the applicants list, whose own
    // row opens the detail screen where `AdmitApplicantModal` actually
    // lives (#27.10, `ApplicantDetail.tsx`).
    run: (ctx) => ctx.navigate({ to: '/admissions/applicants' }),
  },
  {
    id: 'analysis.meritList',
    label: { en: 'Analysis: merit list', bn: 'বিশ্লেষণ: মেধা তালিকা' },
    permission: Permission.MARK_VIEW,
    kind: 'navigate',
    group: 'examsResults',
    // Same "no entity id" pattern as `results.process` above — lands on
    // the exam/section picker rather than a specific exam (the palette's
    // `ActionRunContext` carries no exam id to prefill, D12).
    run: (ctx) => ctx.navigate({ to: '/analysis' }),
  },
  {
    id: 'analysis.defaultedList',
    label: { en: 'Analysis: defaulters', bn: 'বিশ্লেষণ: অকৃতকার্য/অনুপস্থিত' },
    permission: Permission.MARK_VIEW,
    kind: 'navigate',
    group: 'examsResults',
    run: (ctx) => ctx.navigate({ to: '/analysis' }),
  },
  {
    id: 'staff.assignTeacher',
    label: { en: 'Assign class/subject teacher', bn: 'শ্রেণি/বিষয় শিক্ষক নিয়োগ করুন' },
    // Matches `/_staff/staff/teaching-assignments`'s own gate
    // (`route-permissions.ts`).
    permission: Permission.CLASS_MANAGE,
    kind: 'modal',
    group: 'people',
    // No entity id in `ActionRunContext` — same "land on the list/picker, no prefill"
    // pattern as `grading.copyScale`/`results.process` above. Lands on the
    // teaching-assignments list; its own row action opens
    // `-assign-teacher-dialog.tsx` from there (U7: reuse the page, never a
    // second copy of the dialog).
    run: (ctx) => ctx.navigate({ to: '/staff/teaching-assignments' }),
  },
  {
    id: 'exams.copyComponents',
    label: { en: 'Copy exam components', bn: 'পরীক্ষার উপাদান কপি করুন' },
    permission: Permission.EXAM_MANAGE,
    kind: 'modal',
    group: 'examsResults',
    // The dialog itself (`-copy-components-dialog.tsx`) shipped with
    // #902 on the exam Setup tab; this only registers the palette entry.
    run: (ctx) => ctx.navigate({ to: '/exams' }),
  },
  {
    id: 'homework.assign',
    label: { en: 'Assign homework', bn: 'বাড়ির কাজ দিন' },
    permission: Permission.HOMEWORK_ASSIGN,
    kind: 'navigate',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/academics/homework/new' }),
  },
  {
    id: 'homework.import',
    label: { en: 'Upload homework (CSV)', bn: 'বাড়ির কাজ আপলোড করুন (CSV)' },
    permission: Permission.HOMEWORK_IMPORT,
    kind: 'navigate',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/academics/homework/import' }),
  },
  {
    id: 'syllabus.markTopic',
    // Gated on SYLLABUS_READ (must match the target route's own gate, see
    // route-permissions.ts), so the label promises only what a read-only
    // user can actually do here — open the syllabus screen. Mark/edit/
    // reorder controls on that screen are separately gated on
    // SYLLABUS_MANAGE (index.tsx), same as every other inline control.
    label: { en: 'Open syllabus', bn: 'সিলেবাস খুলুন' },
    permission: Permission.SYLLABUS_READ,
    kind: 'inline',
    group: 'academics',
    // No standalone route for one topic's status change — same reasoning
    // this file's header gives for the five actions kept out of
    // `ACTIONS` entirely, except this one DOES have a route to land on:
    // the syllabus list page itself, where status is an inline control
    // per topic (U7: reuse the page, never a second copy of the edit UI).
    run: (ctx) => ctx.navigate({ to: '/academics/syllabus' }),
  },
  {
    id: 'studyPlans.markToday',
    label: { en: "Mark today's lessons", bn: 'আজকের পাঠ জানান' },
    permission: Permission.ROUTINE_READ,
    kind: 'navigate',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/routines/my' }),
  },
  {
    id: 'studyPlans.open',
    label: { en: 'Open study plans', bn: 'পাঠ পরিকল্পনা খুলুন' },
    permission: Permission.SYLLABUS_READ,
    kind: 'navigate',
    group: 'academics',
    // No prefill: `ActionRunContext` carries no section or subject (D46).
    run: (ctx) => ctx.navigate({ to: '/academics/syllabus?tab=plans' }),
  },
  {
    id: 'studyPlans.create',
    label: { en: 'New study plan', bn: 'নতুন পাঠ পরিকল্পনা' },
    // Stricter than the syllabus route's SYLLABUS_READ: the wizard is the only
    // thing this opens (see ROUTE_PERMISSION_EXCEPTIONS in the test).
    permission: Permission.SYLLABUS_MANAGE,
    kind: 'modal',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/academics/syllabus?tab=plans&new=1' }),
  },
  {
    id: 'studyPlans.library',
    label: { en: 'Template library', bn: 'টেমপ্লেট লাইব্রেরি' },
    permission: Permission.SYLLABUS_READ,
    kind: 'navigate',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/academics/syllabus?tab=library' }),
  },
  {
    id: 'promotions.promote',
    label: { en: 'Promote students', bn: 'শিক্ষার্থী প্রমোশন দিন' },
    permission: Permission.PROMOTION_MANAGE,
    kind: 'navigate',
    group: 'examsResults',
    // Same "no entity id" pattern as `analysis.meritList` above — lands on
    // the empty new-run form; the user picks the source class there.
    // `/promotions/new?classId=` prefill exists for direct links, but
    // `ActionRunContext` can't supply a class.
    run: (ctx) => ctx.navigate({ to: '/promotions/new' }),
  },

  // [32.4.2] Print module (D32). The two ID-card actions open `/print/preview` with nobody
  // chosen, which shows the picker modal (`print-id-card-modal.tsx`).
  {
    id: 'print.studentIdCard',
    label: { en: 'Print student ID card', bn: 'শিক্ষার্থীর আইডি কার্ড প্রিন্ট' },
    permission: Permission.DOCUMENT_PRINT,
    kind: 'navigate',
    group: 'reports',
    run: (ctx) => ctx.navigate({ to: '/print/preview?kind=STUDENT_ID_CARD&subject_type=STUDENT' }),
  },
  {
    id: 'print.staffIdCard',
    label: { en: 'Print staff ID card', bn: 'কর্মীর আইডি কার্ড প্রিন্ট' },
    permission: Permission.DOCUMENT_PRINT,
    kind: 'navigate',
    group: 'reports',
    run: (ctx) => ctx.navigate({ to: '/print/preview?kind=STAFF_ID_CARD&subject_type=STAFF' }),
  },
  {
    id: 'print.newTemplate',
    label: { en: 'New print template', bn: 'নতুন প্রিন্ট টেমপ্লেট' },
    permission: Permission.PRINT_TEMPLATE_MANAGE,
    kind: 'modal',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/print-templates?new=1' }),
  },
  {
    id: 'print.history',
    label: { en: 'Print history', bn: 'প্রিন্টের ইতিহাস' },
    permission: Permission.PRINT_HISTORY_READ,
    kind: 'navigate',
    group: 'reports',
    run: (ctx) => ctx.navigate({ to: '/reports/printables' }),
  },
  // Gated like the Settings page it opens (`SETTINGS_MANAGE`), not `PRINT_TEMPLATE_MANAGE`: the
  // palette must not offer a shortcut to a page the person cannot open.
  {
    id: 'print.printers',
    label: { en: 'Printers', bn: 'প্রিন্টার' },
    permission: Permission.SETTINGS_MANAGE,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/settings#printers-section' }),
  },
  // [31.5.1b] Create/record shortcuts. Each target is the one-shot flag its page opens on.
  {
    id: 'academicYears.create',
    label: { en: 'Add academic year', bn: 'শিক্ষাবর্ষ যোগ করুন' },
    permission: Permission.ACADEMIC_YEAR_MANAGE,
    kind: 'modal',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/academic-years?new=1' }),
  },
  {
    id: 'classes.create',
    label: { en: 'Add class', bn: 'শ্রেণি যোগ করুন' },
    permission: Permission.CLASS_MANAGE,
    kind: 'modal',
    group: 'academics',
    run: (ctx) => ctx.navigate({ to: '/classes?new=1' }),
  },
  {
    id: 'calendar.addEvent',
    label: { en: 'Add calendar event', bn: 'ক্যালেন্ডারে ইভেন্ট যোগ করুন' },
    permission: Permission.CALENDAR_MANAGE,
    kind: 'navigate',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/calendar?panel=new-event' }),
  },
  {
    id: 'calendar.addGovernmentHolidays',
    label: { en: 'Add government holidays', bn: 'সরকারি ছুটি যোগ করুন' },
    permission: Permission.CALENDAR_MANAGE,
    kind: 'navigate',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/calendar?panel=holidays' }),
  },
  {
    id: 'calendar.copyFromYear',
    label: { en: 'Copy calendar from another year', bn: 'অন্য বছরের ক্যালেন্ডার কপি করুন' },
    permission: Permission.CALENDAR_MANAGE,
    kind: 'modal',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/calendar?panel=clone' }),
  },
  {
    id: 'calendar.import',
    label: { en: 'Import calendar', bn: 'ক্যালেন্ডার আমদানি করুন' },
    permission: Permission.CALENDAR_MANAGE,
    kind: 'navigate',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/calendar/import' }),
  },
  {
    id: 'feeStructures.create',
    label: { en: 'Add fee structure', bn: 'ফি কাঠামো যোগ করুন' },
    permission: Permission.FEE_STRUCTURE_CREATE,
    kind: 'modal',
    group: 'finance',
    run: (ctx) => ctx.navigate({ to: '/fee-structures?new=1' }),
  },
  {
    id: 'feeSchedules.create',
    label: { en: 'Add automatic billing rule', bn: 'স্বয়ংক্রিয় বিলের নিয়ম যোগ করুন' },
    permission: Permission.SCHEDULE_MANAGE,
    kind: 'navigate',
    group: 'finance',
    run: (ctx) => ctx.navigate({ to: '/fees/schedules?new=1' }),
  },
  {
    id: 'guardians.invite',
    label: { en: 'Invite guardians', bn: 'অভিভাবকদের আমন্ত্রণ জানান' },
    permission: Permission.USER_CREATE,
    kind: 'modal',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/guardians?invite=1' }),
  },
  {
    id: 'staff.add',
    label: { en: 'Add staff member', bn: 'কর্মী যোগ করুন' },
    permission: Permission.USER_CREATE,
    kind: 'modal',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/staff?new=1' }),
  },
  {
    id: 'staff.makeTeacher',
    label: { en: 'Make a staff member a teacher', bn: 'কর্মীকে শিক্ষক করুন' },
    permission: Permission.USER_CREATE,
    kind: 'modal',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/staff?promote=1' }),
  },
  {
    id: 'grading.createScale',
    label: { en: 'Add grading scale', bn: 'গ্রেডিং পদ্ধতি যোগ করুন' },
    permission: Permission.GRADING_SCALE_MANAGE,
    kind: 'modal',
    group: 'examsResults',
    run: (ctx) => ctx.navigate({ to: '/grading-scales?new=1' }),
  },
  {
    id: 'examTemplates.create',
    label: { en: 'Add exam structure', bn: 'পরীক্ষার কাঠামো যোগ করুন' },
    permission: Permission.EXAM_MANAGE,
    kind: 'modal',
    group: 'examsResults',
    run: (ctx) => ctx.navigate({ to: '/exams/templates?new=1' }),
  },
  {
    id: 'students.uploadPhotos',
    label: { en: 'Upload student photos', bn: 'শিক্ষার্থীর ছবি আপলোড করুন' },
    permission: Permission.STUDENT_UPDATE,
    kind: 'modal',
    group: 'people',
    run: (ctx) => ctx.navigate({ to: '/students?photos=1' }),
  },
  {
    id: 'settings.communication',
    label: { en: 'SMS and messaging settings', bn: 'এসএমএস ও বার্তার সেটিংস' },
    permission: Permission.SETTINGS_MANAGE,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/settings?section=communication' }),
  },
  {
    id: 'settings.finance',
    label: { en: 'Fee settings', bn: 'ফির সেটিংস' },
    permission: Permission.SETTINGS_MANAGE,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/settings?section=finance' }),
  },
  {
    id: 'settings.billing',
    label: { en: 'Seats and billing', bn: 'সিট ও বিল' },
    permission: Permission.SETTINGS_MANAGE,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/settings?section=billing' }),
  },
  {
    id: 'billing.buy-seats',
    label: { en: 'Buy seats', bn: 'সিট কিনুন' },
    permission: Permission.SETTINGS_MANAGE,
    kind: 'modal',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/settings?section=billing&buy=1' }),
  },
  {
    id: 'settings.backup',
    label: { en: 'Backup and restore', bn: 'ব্যাকআপ ও রিস্টোর' },
    permission: Permission.SETTINGS_MANAGE,
    kind: 'navigate',
    group: 'administration',
    run: (ctx) => ctx.navigate({ to: '/settings?section=backup' }),
  },

  // [48.3.15] Epic 48 D14. With the route's id they land on that exam / student, never a list.
  {
    id: 'exams.printAdmitCards',
    label: { en: 'Print admit cards', bn: 'প্রবেশপত্র প্রিন্ট করুন' },
    permission: Permission.EXAM_MANAGE,
    // Printing itself is DOCUMENT_PRINT: without it the action would land on a tab that cannot print.
    alsoRequires: [Permission.DOCUMENT_PRINT],
    kind: 'navigate',
    group: 'examsResults',
    context: ['exam'],
    run: (ctx) =>
      ctx.navigate({
        to: ctx.params?.examId ? `/exams/${ctx.params.examId}?tab=print` : '/exams',
      }),
  },
  // CERTIFICATE_ISSUE is stricter than `/students`'s STUDENT_READ: documented exception.
  {
    id: 'certificates.issue',
    label: { en: 'Issue certificate', bn: 'সনদ ইস্যু করুন' },
    permission: Permission.CERTIFICATE_ISSUE,
    kind: 'modal',
    group: 'people',
    context: ['student'],
    run: (ctx) =>
      ctx.navigate({
        to: ctx.params?.studentId
          ? `/students/${ctx.params.studentId}?tab=documents&issue=pick`
          : '/students',
      }),
  },
  {
    id: 'certificates.register',
    label: { en: 'Certificate register', bn: 'সনদ রেজিস্টার' },
    permission: Permission.PRINT_HISTORY_READ,
    kind: 'navigate',
    group: 'reports',
    run: (ctx) => ctx.navigate({ to: '/reports/printables?tab=register' }),
  },
  // DOCUMENT_PRINT is stricter than the page's PRINT_HISTORY_READ: the To print tab needs it.
  {
    id: 'print.toPrint',
    label: { en: 'To print', bn: 'প্রিন্ট বাকি' },
    permission: Permission.DOCUMENT_PRINT,
    kind: 'navigate',
    group: 'reports',
    run: (ctx) => ctx.navigate({ to: '/reports/printables?tab=to-print' }),
  },
];

/**
 * [58.2.07] Offered by the palette launcher only in the demo school (`GET /demo/roles` says
 * `enabled`); kept out of `ACTIONS` so a normal school's palette is untouched. DASHBOARD_VIEW =
 * any staff role. A signed-in visitor is bounced off `/login`, so the launcher intercepts this id
 * and signs out first (`useSignOutToLogin`); `run` is only the fallback.
 */
export const DEMO_SWITCH_ROLE_ACTION: PaletteAction = {
  id: 'demo.switchRole',
  label: { en: 'Switch demo role', bn: 'ডেমো ভূমিকা বদলান' },
  permission: Permission.DASHBOARD_VIEW,
  kind: 'navigate',
  group: 'top',
  run: (ctx) => ctx.navigate({ to: '/login' }),
};

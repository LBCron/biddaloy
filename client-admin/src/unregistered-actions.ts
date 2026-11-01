/**
 * [31.5.1b / D35] The other half of the action registry's contract.
 *
 * Every file under `client-admin/src/routes` that holds dialog markup
 * (`<Dialog`, `DialogContent`, `<Sheet`, `SheetContent`, `<FullPageShell`)
 * must end up in exactly one of three places. `action-registry.test.ts`
 * fails the build for a file that is in none of them.
 *
 * 1. Registered: a palette action in `ACTIONS` opens it (its file is listed in
 *    `REGISTERED_ACTION_FILES` in `action-registry.test.ts`).
 * 2. Allow-listed (`PALETTE_ALLOW_LIST`): a permanent decision that it does not
 *    belong in `Ctrl+K`, with a one-line reason. No owning epic: nothing is owed.
 * 3. Deferred (`UNREGISTERED_ACTIONS`): "wire this later", with the open epic
 *    that owes it. Empty today.
 *
 * Both lists are keyed by the **dialog file**, never by the page that hosts it.
 * Adding a dialog? Register it, allow-list it with a reason, or defer it.
 */

export interface UnregisteredAction {
  readonly file: string;
  readonly owningEpic: string;
  readonly note: string;
}

/** Work owed to an open epic. Empty: nothing is deferred. */
export const UNREGISTERED_ACTIONS: readonly UnregisteredAction[] = [];

export interface PaletteAllowListEntry {
  readonly file: string;
  readonly reason: string;
}

const R = 'client-admin/src/routes/';

export const PALETTE_ALLOW_LIST: readonly PaletteAllowListEntry[] = [
  {
    file: `${R}_staff/communications/message-log/-row-detail.tsx`,
    reason:
      'a row of the Message log: the palette action `communications.messageLog` opens the page, the detail needs a row',
  },
  {
    file: `${R}_staff/my-class/-arrival-add-dialog.tsx`,
    reason:
      'opened from the My class card only; the palette action `arrival-notice.requests` lands on the card, so the dialog itself stays out of `Ctrl+K`',
  },
  {
    file: `${R}_platform/holiday-sets/$setId.tsx`,
    reason: 'Platform console: its palette is pages-only (31.3.3); `ACTIONS` is staff-scoped',
  },
  { file: `${R}_platform/holiday-sets/index.tsx`, reason: 'Platform console, pages-only palette' },
  {
    file: `${R}_platform/subscriptions/index.tsx`,
    reason: 'Platform console, pages-only palette; the detail dialog acts on one school',
  },
  {
    file: `${R}_platform/subscriptions/-detail/grant-seats-dialog.tsx`,
    reason: 'Platform console; acts on one school',
  },
  {
    file: `${R}_platform/subscriptions/-detail/record-payment-dialog.tsx`,
    reason: 'Platform console; acts on one order',
  },
  {
    file: `${R}_platform/subscriptions/-detail/revive-dialog.tsx`,
    reason: 'Platform console; acts on one school',
  },
  {
    file: `${R}_platform/schools/-detail/preset-reset-dialog.tsx`,
    reason: 'Platform console; acts on one school',
  },
  {
    file: `${R}_platform/schools/-detail/restore-workbook-dialog.tsx`,
    reason: 'Platform console; acts on one school',
  },
  {
    file: `${R}_platform/schools/-detail/status-action-dialog.tsx`,
    reason: 'Platform console; acts on one school',
  },
  {
    file: `${R}_staff/academic-years/-detail/terms-tab.tsx`,
    reason: "Term add/edit/delete inside one year's detail page",
  },
  {
    file: `${R}_staff/academics/homework/$homeworkId.tsx`,
    reason: '"Assign again" for one homework',
  },
  {
    file: `${R}_staff/academics/syllabus/-syllabus-topic-form.tsx`,
    reason: 'Needs the class and subject picked on the page',
  },
  {
    file: `${R}_staff/academics/syllabus/-library/template-lessons-dialog.tsx`,
    reason: "One template's lessons, opened from its row",
  },
  {
    file: `${R}_staff/academics/syllabus/-library/template-form-dialog.tsx`,
    reason: "Add or rename needs the library tab's class grade and subject",
  },
  {
    file: `${R}_staff/academics/study-plans/-detail/lesson-form-dialog.tsx`,
    reason: 'Adds or edits a lesson inside one plan',
  },
  {
    file: `${R}_staff/academics/study-plans/-detail/extra-class-dialog.tsx`,
    reason: 'Acts on one study plan',
  },
  {
    file: `${R}_staff/academics/study-plans/-detail/copy-to-section-dialog.tsx`,
    reason: 'Acts on one study plan',
  },
  {
    file: `${R}_staff/academics/study-plans/-detail/exam-markers-dialog.tsx`,
    reason: 'Acts on one study plan',
  },
  {
    file: `${R}_staff/academics/study-plans/-detail/change-owner-dialog.tsx`,
    reason: 'Acts on one study plan',
  },
  {
    file: `${R}_staff/academics/study-plans/-detail/add-to-library-dialog.tsx`,
    reason: 'Acts on one study plan',
  },
  {
    file: `${R}_staff/routines/-marking/not-taught-dialog.tsx`,
    reason: "One period's reason, opened from its cross button",
  },
  {
    file: `${R}_staff/attendance/$sectionId.tsx`,
    reason: "Confirms and history inside one section's marking",
  },
  {
    file: `${R}_staff/attendance/-conflict-dialog.tsx`,
    reason: 'Raised by the marking flow, not started by a user',
  },
  { file: `${R}_staff/attendance/-correction-dialog.tsx`, reason: 'Corrects one submitted mark' },
  { file: `${R}_staff/calendar/-event-details-sheet.tsx`, reason: 'Detail view of one event' },
  {
    file: `${R}_staff/classes/-assign-teacher-dialog.tsx`,
    reason: 'Row action needing a class/subject; the palette path is `staff.assignTeacher`',
  },
  { file: `${R}_staff/classes/-attach-subject-dialog.tsx`, reason: 'Needs one class' },
  { file: `${R}_staff/classes/-delete-class-dialog.tsx`, reason: 'Confirm dialog for one class' },
  { file: `${R}_staff/classes/-section-form-dialog.tsx`, reason: 'Needs one class' },
  { file: `${R}_staff/communications/batches/$batchId.tsx`, reason: 'Retry confirm for one batch' },
  { file: `${R}_staff/exams/-detail/merit-dialog.tsx`, reason: 'Needs one exam (its Print tab)' },
  { file: `${R}_staff/exams/seat-plans/-reseat-dialog.tsx`, reason: 'Needs one plan and one seat' },
  {
    file: `${R}_staff/fees/-generations/batch-actions.tsx`,
    reason: 'Confirms on one generation batch row',
  },
  { file: `${R}_staff/fees/-generations/batch-bills-drawer.tsx`, reason: 'Bills of one batch' },
  { file: `${R}_staff/fees/-generations/edit-batch-dialog.tsx`, reason: 'Edits one batch' },
  {
    file: `${R}_staff/fees/-generations/remove-student-dialog.tsx`,
    reason: 'One student in one batch',
  },
  {
    file: `${R}_staff/fees/fines/-rules/copy-rules-dialog.tsx`,
    reason: 'Needs the academic year picked on the rules panel',
  },
  {
    file: `${R}_staff/fees/fines/-rules/rule-form-dialog.tsx`,
    reason: 'Needs the academic year picked on the rules panel',
  },
  { file: `${R}_staff/fees/schedules/-clone-dialog.tsx`, reason: 'Row action on one schedule' },
  {
    file: `${R}_staff/grading-scales/-recompute-preview-dialog.tsx`,
    reason: 'Step inside saving one scale',
  },
  { file: `${R}_staff/guardians/-edit-guardian-dialog.tsx`, reason: 'Edits one guardian' },
  { file: `${R}_staff/invoices/$invoiceId.tsx`, reason: 'Share/send on one invoice' },
  { file: `${R}_staff/marks/-submit-dialog.tsx`, reason: 'Submits one marks grid' },
  {
    file: `${R}_staff/applications/-detail/decision-dialogs.tsx`,
    reason: 'Acts on one open application; opened from its detail page or a list row icon',
  },
  {
    file: `${R}_staff/payments/-record/checkout-success.tsx`,
    reason: 'Result sheet after a payment, not a task',
  },
  { file: `${R}_staff/payments/-reverse-payment-dialog.tsx`, reason: 'Reverses one payment' },
  {
    file: `${R}_staff/promotions/-commit-dialog.tsx`,
    reason: 'Confirm step inside one promotion run',
  },
  { file: `${R}_staff/routines/-cell-picker.tsx`, reason: 'One cell of one routine grid' },
  { file: `${R}_staff/routines/-change-request-dialog.tsx`, reason: 'One slot of one routine' },
  { file: `${R}_staff/routines/-fill-assist-dialog.tsx`, reason: 'Inside one routine grid' },
  {
    file: `${R}_staff/staff/-detail/-promote-staff-dialog.tsx`,
    reason: 'Acts on one staff member',
  },
  {
    file: `${R}_staff/staff/-detail/invitation-card.tsx`,
    reason: 'Revoke confirm for one invitation',
  },
  {
    file: `${R}_staff/staff/-detail/reset-password-dialog.tsx`,
    reason: 'Acts on one staff member',
  },
  { file: `${R}_staff/staff/-edit-teacher-dialog.tsx`, reason: 'Edits one row' },
  { file: `${R}_staff/staff/-edit-user-dialog.tsx`, reason: 'Edits one row' },
  { file: `${R}_staff/staff/-remove-member-dialog.tsx`, reason: 'Confirm dialog for one row' },
  { file: `${R}_staff/staff/-restore-member-dialog.tsx`, reason: 'Confirm dialog for one row' },
  {
    file: `${R}_staff/students/-detail/-records/public-exams-section.tsx`,
    reason: 'Records of one student',
  },
  { file: `${R}_staff/students/-detail/-transfer-dialog.tsx`, reason: 'Acts on one student' },
  { file: `${R}_staff/students/-detail/discounts-section.tsx`, reason: 'Discounts of one student' },
  { file: `${R}_staff/students/-detail/leave-dialog.tsx`, reason: 'Acts on one student' },
  { file: `${R}_staff/students/-detail/notes-tab.tsx`, reason: 'Notes of one student' },
  { file: `${R}_staff/students/-detail/readmit-dialog.tsx`, reason: 'Acts on one student' },
  {
    file: `${R}_staff/students/-send-reminder-dialog.tsx`,
    reason: 'Needs selected rows; bulk path is `communications.sendFeeReminder`',
  },
  {
    file: `${R}_staff/students/-student-form.tsx`,
    reason: 'Unsaved-changes confirm inside the form',
  },
  { file: `${R}portal.tsx`, reason: 'Portal phone drawer, not an action' },
  {
    file: `${R}portal/applications/new.tsx`,
    reason: 'Guardian portal page; the staff palette does not cover the portal',
  },
  { file: `${R}_platform/schools/new.tsx`, reason: 'Platform console, pages-only palette' },
  {
    file: `${R}_platform/schools/-detail/add-admin-form.tsx`,
    reason: 'Platform console; acts on one school',
  },
  {
    file: `${R}_platform/schools/-detail/sms-credits-card.tsx`,
    reason: 'Platform console; acts on one school',
  },
  {
    file: `${R}_staff/calendar/index.tsx`,
    reason:
      'Host of the event and holidays full pages; reached by `calendar.addEvent` and `calendar.addGovernmentHolidays`',
  },
  { file: `${R}_staff/classes/-dialog-kit.tsx`, reason: 'Shared dialog layout helper, not a task' },
  {
    file: `${R}_staff/communications/-bulk/bulk-reminder-wizard.tsx`,
    reason: 'Reached by `communications.sendFeeReminder`',
  },
  { file: `${R}_staff/exams/-template-grid.tsx`, reason: 'Edits inside one exam structure' },
  {
    file: `${R}_staff/guardians/-detail/linked-students-tab.tsx`,
    reason: 'Linked students of one guardian',
  },
  {
    file: `${R}_staff/print/preview.tsx`,
    reason: 'Preview page reached by `print.studentIdCard` and `print.staffIdCard`',
  },
  { file: `${R}_staff/routines/-change-request-list.tsx`, reason: 'One change request' },
  {
    file: `${R}_staff/routines/-setup/rooms-panel.tsx`,
    reason: 'Rooms setup panel; rows within one panel',
  },
  {
    file: `${R}_staff/routines/-setup/shifts-panel.tsx`,
    reason: 'Shifts setup panel; rows within one panel',
  },
  {
    file: `${R}_staff/staff/$userId_.acr.$assessmentId.tsx`,
    reason: 'ACR form for one assessment; started by `acr.start`',
  },
  {
    file: `${R}_staff/staff/-acr/acr-form.tsx`,
    reason: 'ACR form for one assessment; started by `acr.start`',
  },
  { file: `${R}_staff/students/$studentId_.edit.tsx`, reason: 'Edits one student' },
  {
    file: `${R}_staff/students/-detail/recurring-fees-tab.tsx`,
    reason: 'Recurring fees of one student',
  },
  {
    file: `${R}_staff/staff/-detail/incidents-tab.tsx`,
    reason: 'Withdraws one incident from its row on the staff Incidents tab',
  },
  {
    file: `${R}_staff/students/-detail/wallet-payout-dialog.tsx`,
    reason: 'Pays out one student wallet; opened from the Fees tab',
  },
  {
    file: `${R}_staff/students/-detail/write-off-bill-dialog.tsx`,
    reason: 'Writes off one bill; opened from the Fees tab',
  },
];

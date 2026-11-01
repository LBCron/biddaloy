/**
 * One authoritative list of the `entity_type` strings the server ever
 * writes to `audit_logs.entity_type`. `AuditLog.entity_type` stays a
 * free-form varchar column (no DB enum) — this catalog is the compile-time
 * and test-time contract that keeps every literal server code writes, and
 * every option the client filter offers, in sync.
 *
 * Sourced from every `entity_type: '...'` literal under `server/src`
 * (`rg -o "entity_type: '[A-Za-z_]+'" server/src -g '!*.spec.ts' | sort -u`),
 * kept alphabetical so additions are an easy diff.
 *
 * Adding a new literal in a server service without adding it here is a
 * compile error (`AuditService.record`'s `entity_type` is typed
 * `AuditEntityType`) and fails `server/src/modules/audit/entity-catalog.spec.ts`.
 */
export const AUDIT_ENTITY_TYPES = [
  'AbsenceNoticePreview',
  'AcademicTerm',
  'AcademicYear',
  // [Epic 28] ACR. Audit reads hide AcrAssessment rows about the caller (D2).
  'AcrAssessment',
  'AcrFormVersion',
  'AdmissionApplicantDocuments',
  'Alert',
  'Application',
  'ApplicationAttachment',
  'ApprovalToken',
  'AttendanceDevice',
  'AttendanceRecord',
  'AttendanceSession',
  'CalendarEvent',
  'CalendarFeedToken',
  'Class',
  'ClassSection',
  // [83.2.2] Coordinator assign / remove.
  'CoordinatorAssignment',
  'CurriculumPreset',
  'Designation',
  'DiscountRule',
  'Enrollment',
  'Exam',
  'ExamComponent',
  'ExamSchedule',
  'ExamTemplate',
  'FeeGeneration',
  'FeeStructure',
  'FineRule',
  'GradingScale',
  'Guardian',
  'InvitationBatch',
  'Invoice',
  'LeaveRecord',
  'LessonDelivery',
  'Mark',
  'MarkGrid',
  'Membership',
  'MilestoneAchievement',
  'Payment',
  'PrintAsset',
  'PrintJobItem',
  'PrintTemplate',
  'PrinterProfile',
  'Program',
  'ProgramEnrollment',
  'ProgramMilestone',
  'PromotionRun',
  'PublicHolidaySet',
  'RecurringSchedule',
  'RefreshToken',
  'Registration',
  'ReminderBatch',
  'ReminderBatchPreview',
  'Result',
  'Routine',
  'RoutineChangeRequest',
  'RoutineSlot',
  'RoutineSubstitution',
  'School',
  // Deprecated: `school_holidays` was renamed to `calendar_events` (Epic
  // 17). Kept read-compatible so historical audit rows with this
  // entity_type still validate — no new write ever uses it.
  'SchoolHoliday',
  'StaffAttendanceRecord',
  'StaffDesignationHistory',
  'StaffDocument',
  'StaffHrRecord',
  // [68.4 GAP-11] create and withdraw of a staff incident (no incident text in the row).
  'StaffIncident',
  'Student',
  'StudentDocumentPrint',
  // [Epic 38.2.3] `FinesService.waiveFine` audits the bill it waived.
  'StudentFee',
  'StudentSubjectChoice',
  // [MON-09] `WalletService.payout` audits the wallet it paid out from.
  'StudentWallet',
  'StudyPlan',
  'StudyPlanTemplate',
  'SyllabusTopic',
  'TeacherClassSection',
  'Trial',
  'User',
  'UserIdentity',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

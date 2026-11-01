import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Teacher } from '../src/modules/academics/entities/teacher.entity';
import { StaffProfile } from '../src/modules/staff-profiles/entities/staff-profile.entity';
import { TeacherClassSection } from '../src/modules/academics/entities/teacher-class-section.entity';
import { CoordinatorAssignment } from '../src/modules/academics/entities/coordinator-assignment.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { ClassSubject } from '../src/modules/academics/entities/class-subject.entity';
import { CalendarEvent } from '../src/modules/calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../src/modules/calendar/entities/calendar-event-class.entity';
import { AcademicTerm } from '../src/modules/calendar/entities/academic-term.entity';
import { PublicHolidaySet } from '../src/modules/calendar/entities/public-holiday-set.entity';
import { PublicHolidayEntry } from '../src/modules/calendar/entities/public-holiday-entry.entity';
import { CalendarFeedToken } from '../src/modules/calendar/entities/calendar-feed-token.entity';
import { AttendanceSession } from '../src/modules/attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../src/modules/attendance/entities/attendance-record.entity';
import { AttendanceDevice } from '../src/modules/attendance/entities/attendance-device.entity';
import { ArrivalNoticeSubscription } from '../src/modules/attendance/entities/arrival-notice-subscription.entity';
import { AttendanceDeviceEvent } from '../src/modules/attendance/entities/attendance-device-event.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { UserTenant } from '../src/modules/auth/entities/user-tenant.entity';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { UserIdentity } from '../src/modules/auth/entities/user-identity.entity';
import { AuthToken } from '../src/modules/account-access/entities/auth-token.entity';
import { CommunicationLog } from '../src/modules/communications/entities/communication-log.entity';
import { ReminderBatch } from '../src/modules/communications/entities/reminder-batch.entity';
import { SmsCreditLedger } from '../src/modules/communications/credits/entities/sms-credit-ledger.entity';
import { SmsCreditBalance } from '../src/modules/communications/credits/entities/sms-credit-balance.entity';
import { FeeStructure } from '../src/modules/fees/entities/fee-structure.entity';
import { FineRule } from '../src/modules/fees/entities/fine-rule.entity';
import { DiscountRule } from '../src/modules/fees/entities/discount-rule.entity';
import { Payment } from '../src/modules/fees/entities/payment.entity';
import { PaymentAllocation } from '../src/modules/fees/entities/payment-allocation.entity';
import { StudentFee } from '../src/modules/fees/entities/student-fee.entity';
import { FeeGeneration } from '../src/modules/fees/entities/fee-generation.entity';
import { RecurringSchedule } from '../src/modules/fees/entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from '../src/modules/fees/entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from '../src/modules/fees/entities/recurring-schedule-exclusion.entity';
import { StudentWallet } from '../src/modules/fees/entities/student-wallet.entity';
import { WalletTransaction } from '../src/modules/fees/entities/wallet-transaction.entity';
import { Invoice } from '../src/modules/invoices/entities/invoice.entity';
import { InvoiceShareToken } from '../src/modules/invoices/entities/invoice-share-token.entity';
import { School } from '../src/modules/schools/entities/school.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { StudentLifecycleEvent } from '../src/modules/students/entities/student-lifecycle-event.entity';
import { StudentNote } from '../src/modules/students/entities/student-note.entity';
import { StudentPublicExam } from '../src/modules/students/entities/student-public-exam.entity';
import { Guardian } from '../src/modules/students/entities/guardian.entity';
import { Enrollment } from '../src/modules/students/entities/enrollment.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { PushSubscription } from '../src/modules/push/entities/push-subscription.entity';
import { WorkbookJob } from '../src/modules/workbook/jobs/workbook-job.entity';
import { GradingScale } from '../src/modules/grading/entities/grading-scale.entity';
import { GradingBand } from '../src/modules/grading/entities/grading-band.entity';
import { Exam } from '../src/modules/exams/entities/exam.entity';
import { ExamComponent } from '../src/modules/exams/entities/exam-component.entity';
import { Mark } from '../src/modules/exams/entities/mark.entity';
import { MarkGrid } from '../src/modules/exams/entities/mark-grid.entity';
import { Result } from '../src/modules/exams/entities/result.entity';
import { ResultSubject } from '../src/modules/exams/entities/result-subject.entity';
import { ExamSchedule } from '../src/modules/exams/entities/exam-schedule.entity';
import { StudentSubjectChoice } from '../src/modules/students/entities/student-subject-choice.entity';
import { Shift } from '../src/modules/routines/entities/shift.entity';
import { PeriodSlot } from '../src/modules/routines/entities/period-slot.entity';
import { Room } from '../src/modules/routines/entities/room.entity';
import { Routine } from '../src/modules/routines/entities/routine.entity';
import { RoutineSlot } from '../src/modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../src/modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../src/modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from '../src/modules/routines/entities/routine-change-request.entity';
import { Homework } from '../src/modules/homework/entities/homework.entity';
import { HomeworkAssignment } from '../src/modules/homework/entities/homework-assignment.entity';
import { HomeworkSubmission } from '../src/modules/homework/entities/homework-submission.entity';
import { SyllabusTopic } from '../src/modules/homework/entities/syllabus-topic.entity';
import { StudyPlan } from '../src/modules/study-plans/entities/study-plan.entity';
import { LessonDelivery } from '../src/modules/study-plans/entities/lesson-delivery.entity';
import { StudyPlanTemplate } from '../src/modules/study-plans/entities/study-plan-template.entity';
import { AdmissionIntake } from '../src/modules/admission/entities/admission-intake.entity';
import { AdmissionApplicant } from '../src/modules/admission/entities/admission-applicant.entity';
import { AdmissionEvaluation } from '../src/modules/admission/entities/admission-evaluation.entity';
import { SeatPlan } from '../src/modules/seat-plans/entities/seat-plan.entity';
import { SeatPlanSchedule } from '../src/modules/seat-plans/entities/seat-plan-schedule.entity';
import { SeatAllocation } from '../src/modules/seat-plans/entities/seat-allocation.entity';
import { Program } from '../src/modules/programs/entities/program.entity';
import { ProgramMilestone } from '../src/modules/programs/entities/program-milestone.entity';
import { ProgramEnrollment } from '../src/modules/programs/entities/program-enrollment.entity';
import { MilestoneAchievement } from '../src/modules/programs/entities/milestone-achievement.entity';
import { PromotionRun } from '../src/modules/promotions/entities/promotion-run.entity';
import { PromotionEntry } from '../src/modules/promotions/entities/promotion-entry.entity';
import { Designation } from '../src/modules/staff-hr/entities/designation.entity';
import { StaffHrRecord } from '../src/modules/staff-hr/entities/staff-hr-record.entity';
import { StaffDesignationHistory } from '../src/modules/staff-hr/entities/staff-designation-history.entity';
import { StaffDocument } from '../src/modules/staff-hr/entities/staff-document.entity';
import { ExamTemplate } from '../src/modules/exams/entities/exam-template.entity';
import { ExamTemplateComponent } from '../src/modules/exams/entities/exam-template-component.entity';
import { PrintTemplate } from '../src/modules/print/entities/print-template.entity';
import { PrintTemplateVersion } from '../src/modules/print/entities/print-template-version.entity';
import { PrintAsset } from '../src/modules/print/entities/print-asset.entity';
import { PrinterProfile } from '../src/modules/print/entities/printer-profile.entity';
import { PrintJob } from '../src/modules/print/entities/print-job.entity';
import { PrintJobItem } from '../src/modules/print/entities/print-job-item.entity';
import { StaffFamilyMember } from '../src/modules/staff-hr/entities/staff-family-member.entity';
import { StaffAddress } from '../src/modules/staff-hr/entities/staff-address.entity';
import { StaffExperience } from '../src/modules/staff-hr/entities/staff-experience.entity';
import { StaffEducation } from '../src/modules/staff-hr/entities/staff-education.entity';
import { StaffTraining } from '../src/modules/staff-hr/entities/staff-training.entity';
import { StaffAchievement } from '../src/modules/staff-hr/entities/staff-achievement.entity';
import { StaffLanguage } from '../src/modules/staff-hr/entities/staff-language.entity';
import { StaffAttendanceSession } from '../src/modules/staff-attendance/entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from '../src/modules/staff-attendance/entities/staff-attendance-record.entity';
import { LeaveRecord } from '../src/modules/leave/entities/leave-record.entity';
import { LeavePolicy } from '../src/modules/leave/entities/leave-policy.entity';
import { Application } from '../src/modules/applications/entities/application.entity';
import { ApplicationEvent } from '../src/modules/applications/entities/application-event.entity';
import { ApplicationTag } from '../src/modules/applications/entities/application-tag.entity';
import { ApplicationAttachment } from '../src/modules/applications/entities/application-attachment.entity';
import { AcrFormVersion } from '../src/modules/acr/entities/acr-form-version.entity';
import { AcrCriterion } from '../src/modules/acr/entities/acr-criterion.entity';
import { AcrAssessment } from '../src/modules/acr/entities/acr-assessment.entity';
import { AcrScore } from '../src/modules/acr/entities/acr-score.entity';
import { StaffIncident } from '../src/modules/incidents/entities/staff-incident.entity';
import { Alert } from '../src/modules/attention/entities/alert.entity';
import { SeatOrder } from '../src/modules/billing/entities/seat-order.entity';
import { PlatformPayment } from '../src/modules/billing/entities/platform-payment.entity';
import { PlatformAlert } from '../src/modules/health/platform-alerts/platform-alert.entity';
import { AlertRecipient } from '../src/modules/attention/entities/alert-recipient.entity';
import { Survey } from '../src/modules/surveys/entities/survey.entity';
import { SurveyQuestion } from '../src/modules/surveys/entities/survey-question.entity';
import { SurveyTarget } from '../src/modules/surveys/entities/survey-target.entity';
import { SurveyResponse } from '../src/modules/surveys/entities/survey-response.entity';
import { SurveyAnswer } from '../src/modules/surveys/entities/survey-answer.entity';

export const ALL_ENTITIES = [
  AcademicYear,
  Class,
  ClassSection,
  Teacher,
  StaffProfile,
  TeacherClassSection,
  CoordinatorAssignment,
  Subject,
  ClassSubject,
  CalendarEvent,
  CalendarEventClass,
  AcademicTerm,
  PublicHolidaySet,
  PublicHolidayEntry,
  CalendarFeedToken,
  AttendanceSession,
  AttendanceRecord,
  AttendanceDevice,
  ArrivalNoticeSubscription,
  AttendanceDeviceEvent,
  AuditLog,
  UserTenant,
  AuthToken,
  UserIdentity,
  RefreshToken,
  CommunicationLog,
  ReminderBatch,
  SmsCreditLedger,
  SmsCreditBalance,
  FeeStructure,
  FineRule,
  DiscountRule,
  Payment,
  PaymentAllocation,
  StudentFee,
  FeeGeneration,
  RecurringSchedule,
  RecurringScheduleStructure,
  RecurringScheduleExclusion,
  StudentWallet,
  WalletTransaction,
  Invoice,
  InvoiceShareToken,
  School,
  Student,
  StudentLifecycleEvent,
  StudentNote,
  StudentPublicExam,
  Guardian,
  Enrollment,
  User,
  PushSubscription,
  WorkbookJob,
  GradingScale,
  GradingBand,
  Exam,
  ExamComponent,
  Mark,
  MarkGrid,
  Result,
  ResultSubject,
  ExamSchedule,
  StudentSubjectChoice,
  Shift,
  PeriodSlot,
  Room,
  Routine,
  RoutineSlot,
  RoutineSlotTeacher,
  RoutineSubstitution,
  RoutineChangeRequest,
  Homework,
  HomeworkAssignment,
  HomeworkSubmission,
  SyllabusTopic,
  StudyPlan,
  LessonDelivery,
  StudyPlanTemplate,
  AdmissionIntake,
  AdmissionApplicant,
  AdmissionEvaluation,
  SeatPlan,
  SeatPlanSchedule,
  SeatAllocation,
  Program,
  ProgramMilestone,
  ProgramEnrollment,
  MilestoneAchievement,
  PromotionRun,
  PromotionEntry,
  Designation,
  StaffHrRecord,
  StaffDesignationHistory,
  StaffDocument,
  ExamTemplate,
  ExamTemplateComponent,
  PrintTemplate,
  PrintTemplateVersion,
  PrintAsset,
  PrinterProfile,
  PrintJob,
  PrintJobItem,
  StaffFamilyMember,
  StaffAddress,
  StaffExperience,
  StaffEducation,
  StaffTraining,
  StaffAchievement,
  StaffLanguage,
  StaffAttendanceSession,
  StaffAttendanceRecord,
  LeaveRecord,
  LeavePolicy,
  Application,
  ApplicationEvent,
  ApplicationTag,
  ApplicationAttachment,
  AcrFormVersion,
  AcrCriterion,
  AcrAssessment,
  AcrScore,
  StaffIncident,
  Alert,
  AlertRecipient,
  PlatformAlert,
  SeatOrder,
  PlatformPayment,
  Survey,
  SurveyQuestion,
  SurveyTarget,
  SurveyResponse,
  SurveyAnswer,
];

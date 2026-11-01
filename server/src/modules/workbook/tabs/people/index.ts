import type { TabSpec } from '../../codec/tab-spec';
import { usersTab } from './users.tab';
import { staffProfileTab } from './staff-profile.tab';
import { teachersTab } from './teachers.tab';
import { teacherAssignmentsTab } from './teacher-assignments.tab';
import { coordinatorAssignmentsTab } from './coordinator-assignments.tab';
import { guardiansTab } from './guardians.tab';
import { studentsTab } from './students.tab';
import { enrollmentsTab } from './enrollments.tab';
import { admissionIntakesTab } from './admission-intakes.tab';
import { admissionApplicantsTab } from './admission-applicants.tab';
import { admissionEvaluationsTab } from './admission-evaluations.tab';
import { studentLifecycleEventsTab } from './student-lifecycle-events.tab';
import { studentNotesTab } from './student-notes.tab';
import { studentPublicExamsTab } from './student-public-exams.tab';
import { designationTab } from './designation.tab';
import { staffHrRecordTab } from './staff-hr-record.tab';
import { staffDesignationHistoryTab } from './staff-designation-history.tab';
import { staffFamilyMemberTab } from './staff-family-member.tab';
import { staffAddressTab } from './staff-address.tab';
import { staffExperienceTab } from './staff-experience.tab';
import { staffEducationTab } from './staff-education.tab';
import { staffTrainingTab } from './staff-training.tab';
import { staffAchievementTab } from './staff-achievement.tab';
import { staffLanguageTab } from './staff-language.tab';
import { staffDocumentTab } from './staff-document.tab';

/**
 * Tabs owned by the people lane. Populated by that lane's own tickets; kept as a
 * separate barrel so that no two lanes ever edit `codec/registry.ts`.
 *
 * Registered in dependency order: `users` first (depends only on `school`),
 * then `staff_profiles` (depends on `users`; [36.4.5] added this ahead of
 * `teachers` because `teachers.staff_profile_id` now FKs it, though that
 * column is excluded from `teachers.tab.ts` as system-derived), then
 * `teachers` (depends on `users`), then `teacher_assignments`
 * (depends on `teachers` plus the academics lane's `classes`,
 * `academic_years`, `sections`, `subjects`). `guardians` depends only on
 * `users`, but sits after `teacher_assignments` because the registry must be
 * a subsequence of `EXPECTED_TABS` (`codec/registry.ts`). `students` depends
 * on `users`, `classes`, `academic_years`, `sections`, and `guardians`;
 * appending it last is correct because `EXPECTED_TABS` places `students`
 * directly after `guardians`. `enrollments` depends on `students`, `classes`,
 * `academic_years` and `sections`, and goes last because `EXPECTED_TABS`
 * places it directly after `students`, with the fees lane's tabs following.
 *
 * [27.6] `admission_intakes`/`admission_applicants`/`admission_evaluations`
 * are appended at the end, after `enrollments`: an intake depends on
 * `sections` (already satisfied), an applicant depends on the intake, and
 * an evaluation depends on the applicant plus `users` (already satisfied).
 * `EXPECTED_TABS` (`codec/registry.ts`) places them in this same physical
 * spot — right after `enrollments`, before `fee_structures` — because
 * `ALL_TABS` must be a strict subsequence of `EXPECTED_TABS`.
 */
// [23.5] `designationTab`..`staffLanguageTab` are deliberately NOT in this
// array, even though they live in this same folder: `EXPECTED_TABS`
// (codec/registry.ts) places them at the very end of the whole registry —
// after `feesTabs`/`examsTabs`/`routinesTabs`/the seat-plan tabs — but
// `peopleTabs` itself is spread *before* all of those in `ALL_TABS`. Same
// reasoning `registry.ts`'s own comment gives for registering
// `promotionRunsTab`/`seatPlansTab` directly rather than through a lane's
// barrel: they're imported and appended straight into `ALL_TABS` instead.
export const peopleTabs: TabSpec<any, any>[] = [
  usersTab,
  staffProfileTab,
  teachersTab,
  teacherAssignmentsTab,
  // [83.2.3] Right after `teacher_assignments`; depends on teachers, classes, subjects, users.
  coordinatorAssignmentsTab,
  guardiansTab,
  studentsTab,
  enrollmentsTab,
  admissionIntakesTab,
  admissionApplicantsTab,
  admissionEvaluationsTab,
  // [39.1.3] After `students`, `enrollments` and (via the academics lane) `academic_years`.
  studentLifecycleEventsTab,
  studentNotesTab,
  studentPublicExamsTab,
];

export {
  usersTab,
  staffProfileTab,
  teachersTab,
  teacherAssignmentsTab,
  coordinatorAssignmentsTab,
  guardiansTab,
  studentsTab,
  enrollmentsTab,
  admissionIntakesTab,
  admissionApplicantsTab,
  admissionEvaluationsTab,
  studentLifecycleEventsTab,
  studentNotesTab,
  studentPublicExamsTab,
  designationTab,
  staffHrRecordTab,
  staffDesignationHistoryTab,
  staffFamilyMemberTab,
  staffAddressTab,
  staffExperienceTab,
  staffEducationTab,
  staffTrainingTab,
  staffAchievementTab,
  staffLanguageTab,
  staffDocumentTab,
};
export type { UserRow } from './users.tab';
export type { StaffProfileRow } from './staff-profile.tab';
export type { TeacherRow } from './teachers.tab';
export type { TeacherAssignmentRow } from './teacher-assignments.tab';
export type { CoordinatorAssignmentRow } from './coordinator-assignments.tab';
export type { GuardianRow } from './guardians.tab';
export type { StudentRow } from './students.tab';
export type { EnrollmentRow } from './enrollments.tab';
export type { AdmissionIntakeRow } from './admission-intakes.tab';
export type { AdmissionApplicantRow } from './admission-applicants.tab';
export type { AdmissionEvaluationRow } from './admission-evaluations.tab';
export type { StudentLifecycleEventRow } from './student-lifecycle-events.tab';
export type { StudentNoteRow } from './student-notes.tab';
export type { StudentPublicExamRow } from './student-public-exams.tab';

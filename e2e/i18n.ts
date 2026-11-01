// [8.5.3] Locale-proof accessible-name lookups: specs resolve strings
// through the app's own message catalogs (`ui/src/i18n/locales`) instead
// of hardcoding Bangla. Default locale is `bn` — what a fresh browser
// context renders (ui/src/i18n/locale-storage.ts) — switchable per suite
// for future en coverage.
//
// Deliberately not react-i18next: specs need plain string lookup +
// `{{var}}` interpolation, nothing more.

import bnAcademicYears from '../ui/src/i18n/locales/bn/academicYears.json';
import bnAdmissionPublic from '../ui/src/i18n/locales/bn/admission-public.json';
import bnAdmissionReports from '../ui/src/i18n/locales/bn/admission-reports.json';
import bnAdmissionStaffApplicants from '../ui/src/i18n/locales/bn/admission-staff-applicants.json';
import bnAdmissionStaffIntakes from '../ui/src/i18n/locales/bn/admission-staff-intakes.json';
import bnApplications from '../ui/src/i18n/locales/bn/applications.json';
import bnApplicationsDetail from '../ui/src/i18n/locales/bn/applicationsDetail.json';
import bnApplicationsList from '../ui/src/i18n/locales/bn/applicationsList.json';
import bnApplicationsNew from '../ui/src/i18n/locales/bn/applicationsNew.json';
import bnApplicationsReports from '../ui/src/i18n/locales/bn/applicationsReports.json';
import bnApplicationForms from '../ui/src/i18n/locales/bn/applicationForms.json';
import bnApproval from '../ui/src/i18n/locales/bn/approval.json';
import bnAttendance from '../ui/src/i18n/locales/bn/attendance.json';
import bnAttention from '../ui/src/i18n/locales/bn/attention.json';
import bnAuth from '../ui/src/i18n/locales/bn/auth.json';
import bnBackup from '../ui/src/i18n/locales/bn/backup.json';
import bnBulkImport from '../ui/src/i18n/locales/bn/bulkImport.json';
import bnCalendar from '../ui/src/i18n/locales/bn/calendar.json';
import bnCertificates from '../ui/src/i18n/locales/bn/certificates.json';
import bnClasses from '../ui/src/i18n/locales/bn/classes.json';
import bnCommon from '../ui/src/i18n/locales/bn/common.json';
import bnCommunications from '../ui/src/i18n/locales/bn/communications.json';
import bnDashboard from '../ui/src/i18n/locales/bn/dashboard.json';
import bnEvaluations from '../ui/src/i18n/locales/bn/evaluations.json';
import bnCurriculumPreset from '../ui/src/i18n/locales/bn/curriculumPreset.json';
import bnExamTemplates from '../ui/src/i18n/locales/bn/examTemplates.json';
import bnExamsTemplateField from '../ui/src/i18n/locales/bn/examsTemplateField.json';
import bnPresetReset from '../ui/src/i18n/locales/bn/presetReset.json';
import bnExamDocuments from '../ui/src/i18n/locales/bn/examDocuments.json';
import bnExams from '../ui/src/i18n/locales/bn/exams.json';
import bnFeeGeneration from '../ui/src/i18n/locales/bn/feeGeneration.json';
import bnFees from '../ui/src/i18n/locales/bn/fees.json';
import bnFeeStructures from '../ui/src/i18n/locales/bn/feeStructures.json';
import bnFines from '../ui/src/i18n/locales/bn/fines.json';
import bnGrading from '../ui/src/i18n/locales/bn/grading.json';
import bnGuardians from '../ui/src/i18n/locales/bn/guardians.json';
import bnHomework from '../ui/src/i18n/locales/bn/homework.json';
import bnLeave from '../ui/src/i18n/locales/bn/leave.json';
import bnMyClass from '../ui/src/i18n/locales/bn/myClass.json';
import bnCoordination from '../ui/src/i18n/locales/bn/coordination.json';
import bnNav from '../ui/src/i18n/locales/bn/nav.json';
import bnPayments from '../ui/src/i18n/locales/bn/payments.json';
import bnPerformance from '../ui/src/i18n/locales/bn/performance.json';
import bnPlatform from '../ui/src/i18n/locales/bn/platform.json';
import bnPortal from '../ui/src/i18n/locales/bn/portal.json';
import bnPortalApplications from '../ui/src/i18n/locales/bn/portalApplications.json';
import bnPrintEditor from '../ui/src/i18n/locales/bn/printEditor.json';
import bnPrintHistory from '../ui/src/i18n/locales/bn/printHistory.json';
import bnPrintPreview from '../ui/src/i18n/locales/bn/printPreview.json';
import bnPrintTemplates from '../ui/src/i18n/locales/bn/printTemplates.json';
import bnVerify from '../ui/src/i18n/locales/bn/verify.json';
import bnPrograms from '../ui/src/i18n/locales/bn/programs.json';
import bnPromotions from '../ui/src/i18n/locales/bn/promotions.json';
import bnReports from '../ui/src/i18n/locales/bn/reports.json';
import bnRoutines from '../ui/src/i18n/locales/bn/routines.json';
import bnSeatPlans from '../ui/src/i18n/locales/bn/seatPlans.json';
import bnSeatPlansDetail from '../ui/src/i18n/locales/bn/seatPlansDetail.json';
import bnSettings from '../ui/src/i18n/locales/bn/settings.json';
import bnStaff from '../ui/src/i18n/locales/bn/staff.json';
import bnStaffAttendance from '../ui/src/i18n/locales/bn/staffAttendance.json';
import bnStudentLifecycle from '../ui/src/i18n/locales/bn/student-lifecycle.json';
import bnStudentNotes from '../ui/src/i18n/locales/bn/student-notes.json';
import bnStudentRecords from '../ui/src/i18n/locales/bn/student-records.json';
import bnStudents from '../ui/src/i18n/locales/bn/students.json';
import bnSyllabus from '../ui/src/i18n/locales/bn/syllabus.json';
import bnStudyPlans from '../ui/src/i18n/locales/bn/studyPlans.json';
import bnTeacherAssignments from '../ui/src/i18n/locales/bn/teacherAssignments.json';
import enAcademicYears from '../ui/src/i18n/locales/en/academicYears.json';
import enAdmissionPublic from '../ui/src/i18n/locales/en/admission-public.json';
import enAdmissionReports from '../ui/src/i18n/locales/en/admission-reports.json';
import enAdmissionStaffApplicants from '../ui/src/i18n/locales/en/admission-staff-applicants.json';
import enAdmissionStaffIntakes from '../ui/src/i18n/locales/en/admission-staff-intakes.json';
import enApplications from '../ui/src/i18n/locales/en/applications.json';
import enApplicationsDetail from '../ui/src/i18n/locales/en/applicationsDetail.json';
import enApplicationsList from '../ui/src/i18n/locales/en/applicationsList.json';
import enApplicationsNew from '../ui/src/i18n/locales/en/applicationsNew.json';
import enApplicationsReports from '../ui/src/i18n/locales/en/applicationsReports.json';
import enApplicationForms from '../ui/src/i18n/locales/en/applicationForms.json';
import enApproval from '../ui/src/i18n/locales/en/approval.json';
import enAttendance from '../ui/src/i18n/locales/en/attendance.json';
import enAttention from '../ui/src/i18n/locales/en/attention.json';
import enAuth from '../ui/src/i18n/locales/en/auth.json';
import enBackup from '../ui/src/i18n/locales/en/backup.json';
import enBulkImport from '../ui/src/i18n/locales/en/bulkImport.json';
import enCalendar from '../ui/src/i18n/locales/en/calendar.json';
import enCertificates from '../ui/src/i18n/locales/en/certificates.json';
import enClasses from '../ui/src/i18n/locales/en/classes.json';
import enCommon from '../ui/src/i18n/locales/en/common.json';
import enCommunications from '../ui/src/i18n/locales/en/communications.json';
import enDashboard from '../ui/src/i18n/locales/en/dashboard.json';
import enEvaluations from '../ui/src/i18n/locales/en/evaluations.json';
import enCurriculumPreset from '../ui/src/i18n/locales/en/curriculumPreset.json';
import enExamTemplates from '../ui/src/i18n/locales/en/examTemplates.json';
import enExamsTemplateField from '../ui/src/i18n/locales/en/examsTemplateField.json';
import enPresetReset from '../ui/src/i18n/locales/en/presetReset.json';
import enExamDocuments from '../ui/src/i18n/locales/en/examDocuments.json';
import enExams from '../ui/src/i18n/locales/en/exams.json';
import enFeeGeneration from '../ui/src/i18n/locales/en/feeGeneration.json';
import enFees from '../ui/src/i18n/locales/en/fees.json';
import enFeeStructures from '../ui/src/i18n/locales/en/feeStructures.json';
import enFines from '../ui/src/i18n/locales/en/fines.json';
import enGrading from '../ui/src/i18n/locales/en/grading.json';
import enGuardians from '../ui/src/i18n/locales/en/guardians.json';
import enHomework from '../ui/src/i18n/locales/en/homework.json';
import enLeave from '../ui/src/i18n/locales/en/leave.json';
import enMyClass from '../ui/src/i18n/locales/en/myClass.json';
import enNav from '../ui/src/i18n/locales/en/nav.json';
import enPayments from '../ui/src/i18n/locales/en/payments.json';
import enPerformance from '../ui/src/i18n/locales/en/performance.json';
import enPlatform from '../ui/src/i18n/locales/en/platform.json';
import enPortal from '../ui/src/i18n/locales/en/portal.json';
import enPortalApplications from '../ui/src/i18n/locales/en/portalApplications.json';
import enPrintEditor from '../ui/src/i18n/locales/en/printEditor.json';
import enPrintHistory from '../ui/src/i18n/locales/en/printHistory.json';
import enPrintPreview from '../ui/src/i18n/locales/en/printPreview.json';
import enPrintTemplates from '../ui/src/i18n/locales/en/printTemplates.json';
import enVerify from '../ui/src/i18n/locales/en/verify.json';
import enPrograms from '../ui/src/i18n/locales/en/programs.json';
import enPromotions from '../ui/src/i18n/locales/en/promotions.json';
import enReports from '../ui/src/i18n/locales/en/reports.json';
import enRoutines from '../ui/src/i18n/locales/en/routines.json';
import enSeatPlans from '../ui/src/i18n/locales/en/seatPlans.json';
import enSeatPlansDetail from '../ui/src/i18n/locales/en/seatPlansDetail.json';
import enSettings from '../ui/src/i18n/locales/en/settings.json';
import enStaff from '../ui/src/i18n/locales/en/staff.json';
import enStaffAttendance from '../ui/src/i18n/locales/en/staffAttendance.json';
import enStudentLifecycle from '../ui/src/i18n/locales/en/student-lifecycle.json';
import enStudentNotes from '../ui/src/i18n/locales/en/student-notes.json';
import enStudentRecords from '../ui/src/i18n/locales/en/student-records.json';
import enStudents from '../ui/src/i18n/locales/en/students.json';
import enSyllabus from '../ui/src/i18n/locales/en/syllabus.json';
import enStudyPlans from '../ui/src/i18n/locales/en/studyPlans.json';
import enTeacherAssignments from '../ui/src/i18n/locales/en/teacherAssignments.json';
import enCoordination from '../ui/src/i18n/locales/en/coordination.json';
import bnRegister from '../ui/src/i18n/locales/bn/register.json';
import bnOnboardingSetup from '../ui/src/i18n/locales/bn/onboardingSetup.json';
import bnOnboardingPeople from '../ui/src/i18n/locales/bn/onboardingPeople.json';
import bnSetupChecklist from '../ui/src/i18n/locales/bn/setupChecklist.json';
import bnSignInMethods from '../ui/src/i18n/locales/bn/signInMethods.json';
import bnStaffImport from '../ui/src/i18n/locales/bn/staffImport.json';
import bnTrial from '../ui/src/i18n/locales/bn/trial.json';
import enRegister from '../ui/src/i18n/locales/en/register.json';
import enOnboardingSetup from '../ui/src/i18n/locales/en/onboardingSetup.json';
import enOnboardingPeople from '../ui/src/i18n/locales/en/onboardingPeople.json';
import enSetupChecklist from '../ui/src/i18n/locales/en/setupChecklist.json';
import enSignInMethods from '../ui/src/i18n/locales/en/signInMethods.json';
import enStaffImport from '../ui/src/i18n/locales/en/staffImport.json';
import enTrial from '../ui/src/i18n/locales/en/trial.json';

const catalogs = {
  bn: {
    academicYears: bnAcademicYears,
    register: bnRegister,
    onboardingSetup: bnOnboardingSetup,
    onboardingPeople: bnOnboardingPeople,
    setupChecklist: bnSetupChecklist,
    signInMethods: bnSignInMethods,
    staffImport: bnStaffImport,
    trial: bnTrial,
    'admission-public': bnAdmissionPublic,
    'admission-reports': bnAdmissionReports,
    'admission-staff-applicants': bnAdmissionStaffApplicants,
    'admission-staff-intakes': bnAdmissionStaffIntakes,
    approval: bnApproval,
    attendance: bnAttendance,
    attention: bnAttention,
    auth: bnAuth,
    backup: bnBackup,
    bulkImport: bnBulkImport,
    calendar: bnCalendar,
    classes: bnClasses,
    common: bnCommon,
    communications: bnCommunications,
    dashboard: bnDashboard,
    evaluations: bnEvaluations,
    performance: bnPerformance,
    curriculumPreset: bnCurriculumPreset,
    examTemplates: bnExamTemplates,
    examsTemplateField: bnExamsTemplateField,
    presetReset: bnPresetReset,
    examDocuments: bnExamDocuments,
    certificates: bnCertificates,
    exams: bnExams,
    feeGeneration: bnFeeGeneration,
    fees: bnFees,
    feeStructures: bnFeeStructures,
    fines: bnFines,
    grading: bnGrading,
    guardians: bnGuardians,
    homework: bnHomework,
    applicationForms: bnApplicationForms,
    applications: bnApplications,
    applicationsDetail: bnApplicationsDetail,
    applicationsList: bnApplicationsList,
    applicationsNew: bnApplicationsNew,
    applicationsReports: bnApplicationsReports,
    leave: bnLeave,
    myClass: bnMyClass,
    coordination: bnCoordination,
    nav: bnNav,
    payments: bnPayments,
    platform: bnPlatform,
    portal: bnPortal,
    portalApplications: bnPortalApplications,
    printEditor: bnPrintEditor,
    printHistory: bnPrintHistory,
    printPreview: bnPrintPreview,
    printTemplates: bnPrintTemplates,
    verify: bnVerify,
    programs: bnPrograms,
    promotions: bnPromotions,
    reports: bnReports,
    routines: bnRoutines,
    seatPlans: bnSeatPlans,
    seatPlansDetail: bnSeatPlansDetail,
    settings: bnSettings,
    staff: bnStaff,
    staffAttendance: bnStaffAttendance,
    'student-lifecycle': bnStudentLifecycle,
    'student-notes': bnStudentNotes,
    'student-records': bnStudentRecords,
    students: bnStudents,
    syllabus: bnSyllabus,
    studyPlans: bnStudyPlans,
    teacherAssignments: bnTeacherAssignments,
  },
  en: {
    academicYears: enAcademicYears,
    register: enRegister,
    onboardingSetup: enOnboardingSetup,
    onboardingPeople: enOnboardingPeople,
    setupChecklist: enSetupChecklist,
    signInMethods: enSignInMethods,
    staffImport: enStaffImport,
    trial: enTrial,
    'admission-public': enAdmissionPublic,
    'admission-reports': enAdmissionReports,
    'admission-staff-applicants': enAdmissionStaffApplicants,
    'admission-staff-intakes': enAdmissionStaffIntakes,
    approval: enApproval,
    attendance: enAttendance,
    attention: enAttention,
    auth: enAuth,
    backup: enBackup,
    bulkImport: enBulkImport,
    calendar: enCalendar,
    classes: enClasses,
    common: enCommon,
    communications: enCommunications,
    dashboard: enDashboard,
    evaluations: enEvaluations,
    performance: enPerformance,
    curriculumPreset: enCurriculumPreset,
    examTemplates: enExamTemplates,
    examsTemplateField: enExamsTemplateField,
    presetReset: enPresetReset,
    examDocuments: enExamDocuments,
    certificates: enCertificates,
    exams: enExams,
    feeGeneration: enFeeGeneration,
    fees: enFees,
    feeStructures: enFeeStructures,
    fines: enFines,
    grading: enGrading,
    guardians: enGuardians,
    homework: enHomework,
    applicationForms: enApplicationForms,
    applications: enApplications,
    applicationsDetail: enApplicationsDetail,
    applicationsList: enApplicationsList,
    applicationsNew: enApplicationsNew,
    applicationsReports: enApplicationsReports,
    leave: enLeave,
    myClass: enMyClass,
    coordination: enCoordination,
    nav: enNav,
    payments: enPayments,
    platform: enPlatform,
    portal: enPortal,
    portalApplications: enPortalApplications,
    printEditor: enPrintEditor,
    printHistory: enPrintHistory,
    printPreview: enPrintPreview,
    printTemplates: enPrintTemplates,
    verify: enVerify,
    programs: enPrograms,
    promotions: enPromotions,
    reports: enReports,
    routines: enRoutines,
    seatPlans: enSeatPlans,
    seatPlansDetail: enSeatPlansDetail,
    settings: enSettings,
    staff: enStaff,
    staffAttendance: enStaffAttendance,
    'student-lifecycle': enStudentLifecycle,
    'student-notes': enStudentNotes,
    'student-records': enStudentRecords,
    students: enStudents,
    syllabus: enSyllabus,
    studyPlans: enStudyPlans,
    teacherAssignments: enTeacherAssignments,
  },
} as const;

export type Locale = keyof typeof catalogs;

/** Suite-wide default; `makeT('en')` for a suite that switches locale. */
export const DEFAULT_LOCALE: Locale = 'bn';

export function makeT(locale: Locale = DEFAULT_LOCALE) {
  return function t(key: string, params?: Record<string, string | number>): string {
    const [namespace, ...path] = key.split('.');
    let node: unknown = catalogs[locale][namespace as keyof (typeof catalogs)['bn']];
    for (const segment of path) {
      if (node === null || typeof node !== 'object') break;
      node = (node as Record<string, unknown>)[segment];
    }
    if (typeof node !== 'string') {
      throw new Error(`i18n key not found for locale "${locale}": ${key}`);
    }
    if (!params) return node;
    return node.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
      if (!(name in params)) return match;
      const v = params[name];
      // Mirrors the app's numeral formatter: numbers follow the locale's digits, strings stay.
      return locale === 'bn' && typeof v === 'number'
        ? String(v).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)] ?? d)
        : String(v);
    });
  };
}

/** Default-locale translator — what nearly every spec should import. */
export const t = makeT();

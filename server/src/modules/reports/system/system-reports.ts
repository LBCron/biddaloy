import { defaultersGuardianContact } from './defaulters-guardian-contact.definition';
import type { SystemReportDef } from './definition-helpers';
import { publicExamResults } from './public-exam-results.definition';
import { staffByTypeGender } from './staff-by-type-gender.definition';
import { studentCountBanbeis } from './student-count-banbeis.definition';
import { studentList } from './student-list.definition';

/** The ready reports every school gets (Epic 8.15 D12), in the order the hub lists them. */
export const SYSTEM_REPORTS: readonly SystemReportDef[] = [
  studentList,
  studentCountBanbeis,
  staffByTypeGender,
  publicExamResults,
  defaultersGuardianContact,
];

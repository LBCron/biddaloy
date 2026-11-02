import type { SubjectAreaDef } from '../registry.types';
import { attendanceArea } from './attendance.area';
import { feesArea } from './fees.area';
import { paymentsArea } from './payments.area';
import { publicExamsArea } from './public-exams.area';
import { staffArea } from './staff.area';
import { studentsArea } from './students.area';

/** Every subject area the engine knows. One file per area; order is the order of `GET /reports/meta`. */
export const ALL_AREAS: readonly SubjectAreaDef[] = [
  studentsArea,
  staffArea,
  publicExamsArea,
  feesArea,
  paymentsArea,
  attendanceArea,
];

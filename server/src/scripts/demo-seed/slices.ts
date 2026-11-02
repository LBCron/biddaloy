import type { DemoSlice } from './context';
import { slice as org } from './slices/org';
import { slice as staff } from './slices/staff';
import { slice as students } from './slices/students';
import { slice as studentExtras } from './slices/student-extras';
import { slice as routine } from './slices/routine';
import { slice as attendance } from './slices/attendance';
import { slice as fees } from './slices/fees';
import { slice as exams } from './slices/exams';
import { slice as learning } from './slices/learning';
import { slice as peopleOps } from './slices/people-ops';
import { slice as commsPrint } from './slices/comms-print';
import { slice as applications } from './slices/applications';
import { slice as billing } from './slices/billing';
import { slice as attention } from './slices/attention';

/** Run order matters: later slices read ids earlier ones publish. `attention` is always last. */
export const SLICES: DemoSlice[] = [
  org,
  staff,
  students,
  studentExtras,
  routine,
  attendance,
  fees,
  exams,
  learning,
  peopleOps,
  commsPrint,
  applications,
  billing,
  attention,
];

/** Entities that no slice fills, with the reason. `demo-seed.coverage.integration.spec.ts` reads this. */
export const EXEMPT: Record<string, string> = {
  PlatformAlert: 'platform incident state, not school data',
  PushSubscription: 'push is off in the demo (D2)',
  RefreshToken: 'login state, minted by real sign-ins',
  AuthToken: 'login state: reset / verification tokens',
  UserIdentity: 'login state: sign-in credentials come from the seeded users',
  WorkbookJob: 'backups are off in the demo (D2)',
  AuditLog: 'written by services as a side effect, never seeded directly',
  // [70.1.2] Temporary. The Epic 70 seed tickets (#3407 finals, #3411 notes) move these five
  // into the exams slice's `covers` and delete these lines.
  FinalResult:
    'Epic 70 seed ticket #3407 owes this; FinalResultsService now writes this table; a restore loses it until the workbook tabs ship (#3422)',
  FinalResultWeight:
    'Epic 70 seed ticket #3407 owes this; FinalResultsService now writes this table; a restore loses it until the workbook tabs ship (#3422)',
  FinalResultRow:
    'Epic 70 seed ticket #3407 owes this; FinalResultsService now writes this table; a restore loses it until the workbook tabs ship (#3422)',
  FinalResultSubject:
    'Epic 70 seed ticket #3407 owes this; FinalResultsService now writes this table; a restore loses it until the workbook tabs ship (#3422)',
  ReportCardNote: 'Epic 70 seed ticket #3411 owes this; no service writes it yet',
};

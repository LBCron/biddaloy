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
import { slice as reports } from './slices/reports';
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
  reports,
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
  ReportSnapshot: 'runtime output: a stored copy of one run (Epic 8.15)',
  ReportSchedule: 'runtime output: schedules are set up by the school (Epic 8.15)',
};

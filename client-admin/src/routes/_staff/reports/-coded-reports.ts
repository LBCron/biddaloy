/**
 * [8.15.29] The reports that stay as code (Epic 8.15 D1: ledgers and documents), listed so the Reports
 * hub can link to them. The hub holds links, never copies (UX §3.1, P5): each report lives once,
 * where its data lives, and this list only says where.
 *
 * ```
 *  Hub card "Fee collection report"  --link-->  /reports/collections   (REPORT_COLLECTIONS_READ)
 * ```
 *
 * A viewer sees a card only if their role holds the permission of the target route. That permission
 * is read from `STAFF_ROUTE_PERMISSIONS` (the one map the route guard also uses), never copied here,
 * so a card and its page cannot disagree about who may open it.
 *
 * The student count (BANBEIS) is not here any more: it is a ready report in the catalogue
 * (`student-count-banbeis`), so it shows as an ordinary card, and `/reports/student-count` only
 * redirects to it (Epic 8.15 D23).
 *
 * Names are the sidebar labels (`nav.json`), because title, crumb and sidebar label are one name
 * (P7). Each description is one plain line of what the report shows (D21): no field names, no layout
 * words. Both languages sit here, like `action-registry.ts`, so the hub's search can match either
 * one without loading the other language's words.
 */
import { STAFF_ROUTE_PERMISSIONS } from '../../../route-permissions';

export interface Bilingual {
  readonly en: string;
  readonly bn: string;
}

export type CodedFolderId =
  'students' | 'money' | 'attendance' | 'exams' | 'documents' | 'messages' | 'applications';

/** Section headings on the hub, in the order they appear. */
export const CODED_FOLDERS: Record<CodedFolderId, Bilingual> = {
  students: { en: 'Students', bn: 'শিক্ষার্থী' },
  money: { en: 'Fees and money', bn: 'ফি ও টাকা' },
  attendance: { en: 'Attendance', bn: 'উপস্থিতি' },
  exams: { en: 'Exams and results', bn: 'পরীক্ষা ও ফলাফল' },
  documents: { en: 'Printouts and documents', bn: 'প্রিন্ট ও ডকুমেন্ট' },
  messages: { en: 'Messages and alerts', bn: 'বার্তা ও সতর্কতা' },
  applications: { en: 'Applications', bn: 'আবেদন' },
};

export interface CodedReport {
  /** Stable id; the favourites list keeps it. */
  readonly id: string;
  /** The page it opens. */
  readonly to:
    | '/reports/collections'
    | '/attendance/reports'
    | '/reports/printables'
    | '/reports/alerts'
    | '/applications/reports'
    | '/analysis';
  /** TanStack route id, the key of `STAFF_ROUTE_PERMISSIONS`. */
  readonly routeId: string;
  readonly folder: CodedFolderId;
  readonly name: Bilingual;
  /** One plain line: what the report shows. */
  readonly description: Bilingual;
}

export const CODED_REPORTS: readonly CodedReport[] = [
  {
    id: 'collections',
    to: '/reports/collections',
    routeId: '/_staff/reports/collections',
    folder: 'money',
    name: { en: 'Fee collection report', bn: 'ফি আদায়ের প্রতিবেদন' },
    description: {
      en: 'How much was paid each day, by which method and to whom.',
      bn: 'কোন দিনে কত টাকা জমা হয়েছে, কীভাবে এবং কার হাতে।',
    },
  },
  {
    id: 'attendance-reports',
    to: '/attendance/reports',
    routeId: '/_staff/attendance/reports',
    folder: 'attendance',
    name: { en: 'Attendance reports', bn: 'উপস্থিতি প্রতিবেদন' },
    description: {
      en: 'Attendance for the month, and who attends too little.',
      bn: 'মাসের উপস্থিতির হিসাব, আর যাদের উপস্থিতি কম তাদের তালিকা।',
    },
  },
  {
    id: 'analysis',
    to: '/analysis',
    routeId: '/_staff/analysis/',
    folder: 'exams',
    name: { en: 'Result analysis', bn: 'ফলাফল বিশ্লেষণ' },
    description: {
      en: 'How each class did in an exam: merit list, passed and failed.',
      bn: 'পরীক্ষায় প্রতিটি শ্রেণি কেমন করেছে: মেধাতালিকা, পাস ও ফেল।',
    },
  },
  {
    id: 'printables',
    to: '/reports/printables',
    routeId: '/_staff/reports/printables',
    folder: 'documents',
    name: { en: 'Print & documents', bn: 'প্রিন্ট ও ডকুমেন্ট' },
    description: {
      en: 'ID cards and certificates already printed, and what is waiting to be printed.',
      bn: 'যে আইডি কার্ড ও সনদ ছাপা হয়েছে, আর যা ছাপার অপেক্ষায় আছে।',
    },
  },
  {
    id: 'alerts',
    to: '/reports/alerts',
    routeId: '/_staff/reports/alerts',
    folder: 'messages',
    name: { en: 'Alerts report', bn: 'সতর্কতা প্রতিবেদন' },
    description: {
      en: 'How many alerts went out each month, by rule and section.',
      bn: 'প্রতি মাসে নিয়ম ও শাখা অনুযায়ী কতগুলো সতর্কতা গেছে।',
    },
  },
  {
    id: 'applications',
    to: '/applications/reports',
    routeId: '/_staff/applications/reports',
    folder: 'applications',
    name: { en: 'Application reports', bn: 'আবেদনপত্রের প্রতিবেদন' },
    description: {
      en: 'How many applications came in, who decided them and how long they took.',
      bn: 'কতগুলো আবেদন এসেছে, কে সিদ্ধান্ত দিয়েছেন আর কত সময় লেগেছে।',
    },
  },
];

/** The coded reports this role may open: its permission on the target route, from the guard's own map. */
export function visibleCodedReports(
  can: (permission: (typeof STAFF_ROUTE_PERMISSIONS)[string]) => boolean,
): CodedReport[] {
  return CODED_REPORTS.filter((report) => {
    const permission = STAFF_ROUTE_PERMISSIONS[report.routeId];
    return permission !== undefined && can(permission);
  });
}

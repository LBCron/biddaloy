/**
 * [67.5.05] Pages the optional "Page to open" link may point at. A link only
 * works if every recipient uses the same app, so the list follows the audience:
 * staff pages (those every chosen role can open, else those the sender can
 * see), portal pages, or none when mixed.
 */
import {
  hasPermission,
  useActiveRole,
  useEntityLabel,
  type ManualAudience,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { STAFF_NAV_ITEMS } from '../../../nav-tree';

export type AudienceKind = 'staff' | 'portal' | 'mixed';

export interface LinkOption {
  value: string;
  label: string;
}

/** `nav:items.*` keys of the `/portal/*` pages (mirrors `routes/portal.tsx`). */
export const PORTAL_PAGES = [
  ['/portal', 'portalOverview'],
  ['/portal/fees', 'portalFees'],
  ['/portal/statement', 'portalStatement'],
  ['/portal/attendance', 'portalAttendance'],
  ['/portal/routine', 'portalRoutine'],
  ['/portal/calendar', 'portalCalendar'],
  ['/portal/results', 'portalResults'],
  ['/portal/programs', 'portalPrograms'],
  ['/portal/exam-schedule', 'portalExamSchedule'],
  ['/portal/syllabus', 'portalSyllabus'],
  ['/portal/homework', 'portalHomework'],
  ['/portal/surveys', 'portalSurveys'],
  ['/portal/applications', 'portalApplications'],
  ['/portal/account', 'portalAccount'],
] as const;

const PORTAL_ROLES: readonly string[] = ['PARENT', 'STUDENT'];

/** Who the audience reaches, by app. An empty audience counts as staff. */
export function audienceKind(audience: ManualAudience): AudienceKind {
  const roles = audience.roles ?? [];
  const staff = roles.some((r) => !PORTAL_ROLES.includes(r)) || (audience.userIds?.length ?? 0) > 0;
  const portal =
    roles.some((r) => PORTAL_ROLES.includes(r)) ||
    (audience.sectionIds?.length ?? 0) > 0 ||
    (audience.guardiansOfSectionIds?.length ?? 0) > 0;
  return staff && portal ? 'mixed' : portal ? 'portal' : 'staff';
}

export function useLinkOptions(kind: AudienceKind, roles?: readonly string[]): LinkOption[] {
  const { t } = useTranslation('nav');
  const role = useActiveRole();
  const entity: Record<string, string> = {
    student: useEntityLabel('student', { count: 2 }),
    guardian: useEntityLabel('guardian', { count: 2 }),
    staff: useEntityLabel('staff', { count: 2 }),
    class: useEntityLabel('class', { count: 2 }),
    academicYear: useEntityLabel('academicYear', { count: 2 }),
    invoice: useEntityLabel('invoice', { count: 2 }),
    exam: useEntityLabel('exam', { count: 2 }),
  };

  if (kind === 'mixed') return [];
  if (kind === 'portal') {
    return PORTAL_PAGES.map(([value, key]) => ({ value, label: t(`items.${key}`) }));
  }
  // ponytail: named people (userIds) are judged by the sender's own permissions; their roles
  // are not known here. Filter by their roles if wrong links to them show up.
  const viewers = roles?.length ? roles : [role];
  return Object.values(STAFF_NAV_ITEMS)
    .filter(
      (item) => !('permission' in item) || viewers.every((r) => hasPermission(r, item.permission)),
    )
    .map((item) => ({
      value: item.to,
      label: 'entity' in item.label ? entity[item.label.entity]! : t(`items.${item.label.key}`),
    }));
}

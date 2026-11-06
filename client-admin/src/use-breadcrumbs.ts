import type { BreadcrumbItem } from '@biddaloy/ui/components';
import {
  academicYearQueryOptions,
  applicationQueryOptions,
  attendanceImportKeys,
  attendanceKeys,
  classKeys,
  classQueryOptions,
  examQueryOptions,
  finalResultQueryOptions,
  gradingScaleQueryOptions,
  guardianQueryOptions,
  homeworkQueryOptions,
  invoiceQueryOptions,
  myClassSectionsQueryOptions,
  paymentKeys,
  printTemplateQueryOptions,
  programQueryOptions,
  publicHolidaySetQueryOptions,
  recurringScheduleQueryOptions,
  reminderBatchQueryOptions,
  schoolsKeys,
  seatPlanDetailQueryOptions,
  studentQueryOptions,
  studentResultCardKey,
  studyPlanQueryOptions,
  surveyKeys,
  useEntityLabel,
  userQueryOptions,
} from '@biddaloy/ui/hooks';
import { i18n, useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatDate, renderDigits } from '@biddaloy/ui/utils';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useMatches } from '@tanstack/react-router';
import * as React from 'react';

import { applicantQueryOptions } from './features/admission/hooks/useApplicants';
import { intakeQueryOptions } from './features/admission/hooks/useIntakes';
import { noticeKeys } from './features/notices/manage/use-notices';
import { STAFF_NAV_ITEMS, type StaffNavLabel } from './nav-tree';
import { ROUTE_CRUMBS, type RouteCrumbs } from './route-crumbs';
import { studyPlanTitle } from './routes/_staff/academics/study-plans/-detail/plan-title';
import { examTemplateQueryOptions } from './routes/_staff/exams/-use-exam-templates';

/**
 * [30.3.3] wires [30.3.1]'s `ROUTE_CRUMBS` map and [30.3.2]'s
 * `Breadcrumbs` component into the shells (`_staff.tsx`, `portal.tsx`,
 * `_platform/route.tsx`).
 *
 * `ROUTE_CRUMBS` is keyed by the *leaf* route id and stores that leaf's
 * whole trail already, so resolving it is one lookup by
 * `matches[matches.length - 1].routeId`.
 *
 * A `dynamic: 'entity'` segment's *label* (e.g. `{ entity: 'student' }`)
 * is only ever the generic noun. The real display text comes from
 * `ENTITY_RESOLVERS` below, which reads the react-query cache the page's own
 * detail route already warmed — by key *prefix*, so a page whose cache key
 * carries extra parts (the attendance register: date + period) still
 * resolves. It never fetches, and it never shows an id (D9): name found →
 * the name; resolver registered but nothing cached yet → the generic noun
 * with `loading: true` (a skeleton bar, C5); no resolver → the noun.
 *
 * C7: a trail of fewer than 2 crumbs returns no `items` (the layouts render
 * the row only when there are some), but still returns a `title`.
 */

export type CrumbContext = { language: string; region: RegionConfig };

type EntityResolver = {
  /** Which route param is the id (default: the first one). */
  param?: string;
  /** Cache key prefixes to read; the first one with a name wins. */
  queryKeys: (id: string, params: Record<string, string>) => readonly QueryKey[];
  getName: (data: unknown, id: string, ctx: CrumbContext) => string | undefined;
};

/** A non-empty string field of an untyped cache value. */
function field(data: unknown, key: string): string | undefined {
  const v = (data as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}
const byField = (key: string) => (data: unknown) => field(data, key);

/** Exported for tests: pages with partial seeded data crash their own render. */
export const ENTITY_RESOLVERS: Record<string, EntityResolver> = {
  student: { queryKeys: (id) => [studentQueryOptions(id).queryKey], getName: byField('full_name') },
  guardian: {
    queryKeys: (id) => [guardianQueryOptions(id).queryKey],
    getName: byField('full_name'),
  },
  class: { queryKeys: (id) => [classQueryOptions(id).queryKey], getName: byField('name') },
  academicYear: {
    queryKeys: (id) => [academicYearQueryOptions(id).queryKey],
    getName: byField('name'),
  },
  // [52.4.1] "ফি মওকুফ — রহিম উদ্দিন": type label plus applicant, from the detail the route warmed.
  applicationDetail: {
    queryKeys: (id) => [applicationQueryOptions(id).queryKey],
    getName: (data, _id, ctx) => {
      const name = field(data, 'applicant_name');
      const type = field(data, 'type');
      if (!name || !type) return undefined;
      const typeLabel = i18n.getFixedT(ctx.language, 'applications')(`types.${type}`);
      return `${typeLabel} — ${name}`;
    },
  },
  // [53.4.01] Notice title, from the detail cache or the compose form's own cache (edit page).
  noticeDetail: {
    queryKeys: (id) => [noticeKeys.detail(id), ['notice-compose', id]],
    getName: byField('title'),
  },
  // [76.5.06] File name of the saved attendance sheet, from the detail the page already loaded.
  uploadDetail: {
    queryKeys: (id) => [attendanceImportKeys.detail(id)],
    getName: byField('file_name'),
  },
  // [32.4.1] Keyed by the crumb's own label key: "template" has no `EntityLabel` noun.
  printTemplateEdit: {
    queryKeys: (id) => [printTemplateQueryOptions(id).queryKey],
    getName: byField('name'),
  },
  // [47.4.2] The section list `/my-class/$sectionId`'s loader already warmed.
  myClassSection: {
    queryKeys: () => [myClassSectionsQueryOptions().queryKey],
    getName: (data, id) => {
      const section = (
        Array.isArray(data)
          ? (data as { section_id: string; class_name: string; section_name: string }[])
          : []
      ).find((s) => s.section_id === id);
      return section && `${section.class_name} – ${section.section_name}`;
    },
  },
  // Attendance register (cached by section + date + period) or the sections list.
  section: {
    queryKeys: (id) => [
      [...attendanceKeys.all, 'register', id],
      [...classKeys.all, 'sections'],
    ],
    getName: (data, id) => {
      if (Array.isArray(data)) {
        const row = (
          data as { id?: string; section_name?: string; class?: { name?: string } }[]
        ).find((r) => r.id === id);
        if (!row?.section_name) return undefined;
        return `${row.class?.name ?? ''} – ${row.section_name}`.replace(/^ – /, '');
      }
      const section = (data as { section?: { class_name?: string; section_name?: string } })
        .section;
      return section?.class_name && section.section_name
        ? `${section.class_name} – ${section.section_name}`
        : undefined;
    },
  },
  examTemplateDetail: {
    queryKeys: (id) => [examTemplateQueryOptions(id).queryKey],
    getName: byField('name'),
  },
  invoice: {
    queryKeys: (id) => [invoiceQueryOptions(id).queryKey],
    getName: byField('invoice_number'),
  },
  staff: {
    param: 'userId',
    queryKeys: (id) => [userQueryOptions(id).queryKey],
    getName: byField('full_name'),
  },
  batchDetail: {
    queryKeys: (id) => [reminderBatchQueryOptions(id).queryKey],
    getName: byField('batch_name'),
  },
  surveyDetail: { queryKeys: (id) => [surveyKeys.detail(id)], getName: byField('title') },
  exam: { queryKeys: (id) => [examQueryOptions(id).queryKey], getName: byField('name') },
  programDetail: {
    queryKeys: (id) => [programQueryOptions(id).queryKey],
    getName: byField('name'),
  },
  homeworkDetail: {
    queryKeys: (id) => [homeworkQueryOptions(id).queryKey],
    getName: byField('title'),
  },
  // [66.2] Same "<section> · <subject> · <term>" string as the page's h1.
  studyPlanDetail: {
    queryKeys: (id) => [studyPlanQueryOptions(id).queryKey],
    getName: (data, _id, ctx) => {
      const plan = data as Parameters<typeof studyPlanTitle>[0] | undefined;
      if (!plan?.section || !plan.subject) return undefined;
      return studyPlanTitle(
        plan,
        ctx.language,
        i18n.t('list.filters.wholeYear', { ns: 'studyPlans', lng: ctx.language }),
      );
    },
  },
  // [70.5.5] "Class 8 2026", the same class and year the detail page's own title shows.
  finalResultDetail: {
    queryKeys: (id) => [finalResultQueryOptions(id).queryKey],
    getName: (data) => {
      const d = data as
        { class?: { name?: string }; academic_year?: { name?: string } } | undefined;
      return d?.class?.name && d.academic_year?.name
        ? `${d.class.name} ${d.academic_year.name}`
        : undefined;
    },
  },
  gradingScaleDetail: {
    queryKeys: (id) => [gradingScaleQueryOptions(id).queryKey],
    getName: byField('name'),
  },
  seatPlanDetail: {
    queryKeys: (id) => [seatPlanDetailQueryOptions(id).queryKey],
    getName: byField('name'),
  },
  scheduleDetail: {
    queryKeys: (id) => [recurringScheduleQueryOptions(id).queryKey],
    getName: byField('name'),
  },
  // "বাংলাদেশ ২০২৬" — equal to the page's h1; never the raw "BD 2026" (D9).
  holidaySetDetail: {
    queryKeys: (id) => [publicHolidaySetQueryOptions(id).queryKey],
    getName: (data, _id, ctx) => {
      const country = field(data, 'country');
      const year = (data as { year?: unknown } | undefined)?.year;
      if (!country || typeof year !== 'number') return undefined;
      let place: string;
      try {
        place = new Intl.DisplayNames([ctx.language], { type: 'region' }).of(country) ?? country;
      } catch {
        // Malformed region code: Intl throws RangeError. Fall back to the generic noun.
        return undefined;
      }
      return `${place} ${renderDigits(String(year), ctx.region.numerals)}`;
    },
  },
  // There is no `GET /schools/:id`; the page reads the `useSchools()` list.
  schoolDetail: {
    queryKeys: () => [schoolsKeys.lists()],
    getName: (data, id) =>
      (Array.isArray(data) ? (data as { id?: string; name?: string }[]) : []).find(
        (r) => r.id === id,
      )?.name,
  },
  admissionIntakeDetail: {
    queryKeys: (id) => [intakeQueryOptions(id).queryKey],
    getName: byField('title'),
  },
  admissionApplicantDetail: {
    queryKeys: (id) => [applicantQueryOptions(id).queryKey],
    getName: (data) =>
      field((data as { applicant?: unknown } | undefined)?.applicant, 'applicant_name'),
  },
  paymentDetail: {
    queryKeys: (id) => [paymentKeys.detail(id)],
    getName: (data, _id, ctx) => {
      const d = data as { student?: { full_name?: string } | null; payment_date?: string };
      const date = d.payment_date ? formatDate(d.payment_date, ctx.region) : undefined;
      return [d.student?.full_name, date].filter(Boolean).join(' — ') || undefined;
    },
  },
  // The page reads `useStudentResultCard`, so key by (studentId, examId), not `useStudent`.
  reportCard: {
    param: 'studentId',
    queryKeys: (id, params) => [studentResultCardKey(id, params.examId)],
    getName: (data) => field((data as { student?: unknown } | undefined)?.student, 'full_name'),
  },
};

/** List-page `to` for a segment's own label, read from the same
 * `STAFF_NAV_ITEMS` data `_staff.tsx` renders the sidebar from, so a
 * breadcrumb link and its matching nav item can never point two
 * different places for the same entity. */
function findNavPath(label: StaffNavLabel): string | undefined {
  const sameLabel = (a: StaffNavLabel, b: StaffNavLabel): boolean =>
    ('entity' in a && 'entity' in b && a.entity === b.entity) ||
    ('key' in a && 'key' in b && a.key === b.key);
  const match = Object.values(STAFF_NAV_ITEMS).find((item) => sameLabel(item.label, label));
  return match?.to;
}

/** Reads the cached name for a dynamic segment. Never fetches. */
function useCachedEntityName(
  entityKey: string | undefined,
  params: Record<string, string>,
  ctx: CrumbContext,
): { id: string | undefined; name: string | undefined; hasResolver: boolean } {
  const resolver = entityKey ? ENTITY_RESOLVERS[entityKey] : undefined;
  const id = resolver?.param ? params[resolver.param] : Object.values(params)[0];
  const queryClient = useQueryClient();
  const read = (): string | undefined => {
    if (!resolver || !id) return undefined;
    for (const key of resolver.queryKeys(id, params)) {
      for (const [, data] of queryClient.getQueriesData({ queryKey: key })) {
        if (data === undefined) continue;
        const name = resolver.getName(data, id, ctx);
        if (name) return name;
      }
    }
    return undefined;
  };
  // Returns a string or undefined, so this re-renders only when the name changes.
  const name = React.useSyncExternalStore(
    (cb) => queryClient.getQueryCache().subscribe(cb),
    read,
    read,
  );
  return { id, name, hasResolver: resolver !== undefined };
}

export interface UseBreadcrumbsResult {
  /** Ready for `Breadcrumbs`' `items` prop — empty for any route
   * `ROUTE_CRUMBS` marks `null` and for any one-crumb trail (C7), so the
   * layouts render no row there. */
  items: BreadcrumbItem[];
  /** Reversed trail joined with ` · `, e.g. `Fees · Rahim Uddin ·
   * SchoolManager` — the tab title for routes that do have a trail.
   * Loading crumbs are left out (C5). `undefined` when there is no trail,
   * so the caller can leave `document.title` to whatever already owns it. */
  title: string | undefined;
}

export function useBreadcrumbs(appName: string): UseBreadcrumbsResult {
  const { t, i18n } = useTranslation('nav');
  const region = useRegionConfig();
  const matches = useMatches();
  const leafMatch = matches[matches.length - 1];
  const leafRouteId = leafMatch?.routeId;
  const entry = leafRouteId ? ROUTE_CRUMBS[leafRouteId] : undefined;
  const segments: RouteCrumbs = Array.isArray(entry) ? entry : [];

  const lastIndex = segments.length - 1;
  const dynamicSegment = segments.find((segment) => segment.dynamic === 'entity');
  const dynamicLabel = dynamicSegment?.label;
  const dynamicEntityKey =
    dynamicLabel === undefined
      ? undefined
      : 'entity' in dynamicLabel
        ? dynamicLabel.entity
        : dynamicLabel.key;

  // Same plural count `_staff.tsx`'s own `entityLabels` map uses for
  // these nouns in the sidebar — a breadcrumb list segment is the same
  // "Students" collection link, not a fresh string.
  const entityLabels: Record<string, string> = {
    student: useEntityLabel('student', { count: 2 }),
    guardian: useEntityLabel('guardian', { count: 2 }),
    staff: useEntityLabel('staff', { count: 2 }),
    class: useEntityLabel('class', { count: 2 }),
    academicYear: useEntityLabel('academicYear', { count: 2 }),
    invoice: useEntityLabel('invoice', { count: 2 }),
    exam: useEntityLabel('exam', { count: 2 }),
  };
  // The generic noun for a detail crumb that has no name to show.
  const entityNouns: Record<string, string> = {
    student: useEntityLabel('student', { count: 1 }),
    guardian: useEntityLabel('guardian', { count: 1 }),
    staff: useEntityLabel('staff', { count: 1 }),
    class: useEntityLabel('class', { count: 1 }),
    academicYear: useEntityLabel('academicYear', { count: 1 }),
    invoice: useEntityLabel('invoice', { count: 1 }),
    exam: useEntityLabel('exam', { count: 1 }),
  };

  const {
    id: dynamicId,
    name: resolvedName,
    hasResolver,
  } = useCachedEntityName(
    dynamicSegment ? dynamicEntityKey : undefined,
    dynamicSegment && leafMatch ? leafMatch.params : {},
    { language: i18n.language, region },
  );

  if (segments.length === 0) {
    return { items: [], title: undefined };
  }

  const items: BreadcrumbItem[] = segments.map((segment, index) => {
    const isLast = index === lastIndex;
    if (segment.dynamic === 'entity') {
      if (resolvedName !== undefined) {
        const to = !isLast && dynamicId ? deriveEntityPath(segment.label, dynamicId) : undefined;
        return to ? { label: resolvedName, to } : { label: resolvedName };
      }
      const noun =
        'entity' in segment.label
          ? (entityNouns[segment.label.entity] ?? '')
          : t(`items.${segment.label.key}`);
      return hasResolver ? { label: noun, loading: true } : { label: noun };
    }
    const label =
      'entity' in segment.label
        ? (entityLabels[segment.label.entity] ?? '')
        : t(`items.${segment.label.key}`);
    const to = !isLast ? (segment.to ?? findNavPath(segment.label)) : undefined;
    return to ? { label, to } : { label };
  });

  const title = items
    .filter((item) => !item.loading)
    .reverse()
    .map((item) => item.label)
    .concat(appName)
    .join(' · ');

  // C7: the crumb row only shows from two levels.
  return { items: items.length >= 2 ? items : [], title };
}

function deriveEntityPath(label: StaffNavLabel, id: string): string | undefined {
  const listPath = findNavPath(label);
  return listPath ? `${listPath}/${id}` : undefined;
}

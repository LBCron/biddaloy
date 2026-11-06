/**
 * [9.6] "Which section do I mark today?" — every section the signed-in
 * teacher is mapped to (`GET /attendance/my-sections`, server-scoped —
 * see the plan's "Plan corrections" on why this is not a client-side
 * filter over the tenant's whole class/section list).
 *
 * Each section is a link card to `/attendance/$sectionId`; unfinished
 * sections (not marked, then draft) sort before submitted ones.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  DatePicker,
  EmptyState,
  ErrorState,
  RoutePending,
  Label,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import { mySectionsQueryOptions, useMySections, type MySection } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import { formatDate, parseDate, tenantTodayIso, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { CalendarCheck2, ChevronRight } from 'lucide-react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

const searchSchema = z.object({
  status: z.enum(['pending', 'done']).optional().catch(undefined),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_staff/attendance/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.ensureQueryData(mySectionsQueryOptions(deps.date)).catch(swallowUnlessOffline),
      loadRouteNamespaces('attendance'),
    ]),
  pendingComponent: AttendanceListPending,
  component: AttendanceListPage,
});

function rank(section: MySection): number {
  if (!section.today) return 0;
  return section.today.state === 'FINALIZED' ? 2 : 1;
}

function StateBadge({ section }: { section: MySection }) {
  const { t } = useTranslation('attendance');
  const today = section.today;
  if (!today) return <StatusBadge tone="warning" label={t('list.stateNotStarted')} />;
  if (today.state !== 'FINALIZED') return <StatusBadge tone="info" label={t('list.stateDraft')} />;
  return <StatusBadge tone="success" label={t('mark.stateFinalized')} />;
}

function CountChips({ section }: { section: MySection }) {
  const { t } = useTranslation('attendance');
  const today = section.today;
  if (!today) return null;
  // D5, D28: hidden at 0.
  const chips = [
    {
      n: today.scanned_but_absent,
      label: t('list.scannedAbsent', {
        count: today.scanned_but_absent,
        defaultValue: '{{count}} scanned but marked absent',
      }),
      hint: t('list.scannedAbsentHint', {
        defaultValue:
          'The card machine saw these students today, but the register marks them absent or on leave.',
      }),
    },
    {
      n: today.unmarked,
      label: t('list.withoutStatus', {
        count: today.unmarked,
        defaultValue: '{{count}} without a status',
      }),
      hint: t('list.withoutStatusHint', {
        defaultValue: 'These students have not been marked present, absent, late or on leave yet.',
      }),
    },
  ].filter((c) => c.n > 0);
  if (chips.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.label}
          title={c.hint}
          className="rounded-full bg-muted px-2 py-0.5 text-text-secondary"
        >
          {c.label}
        </span>
      ))}
    </span>
  );
}

function AttendanceListPage() {
  const { t } = useTranslation('attendance');
  const regionConfig = useTenantRegionConfig();
  const { status, date: chosenDate } = Route.useSearch();
  // The school's date, not the browser's (nor UTC's): the same "today" the
  // server computed each section's state for, and the register page uses.
  const today = tenantTodayIso(regionConfig);
  const date = chosenDate ?? today;
  const query = useMySections(chosenDate);
  const navigate = useNavigate({ from: Route.fullPath });

  if (query.isPending) {
    return (
      <PageContainer>
        <div aria-busy="true" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <span className="sr-only">{t('list.loadingLabel')}</span>
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      </PageContainer>
    );
  }

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <PageContainer>
        <ErrorState
          message={forbidden ? t('list.forbidden') : t('list.errorMessage')}
          retryLabel={t('list.retry')}
          onRetry={() => void query.refetch()}
        />
      </PageContainer>
    );
  }

  const sections = query.data ?? [];

  if (sections.length === 0) {
    return (
      <PageContainer>
        <EmptyState
          icon={<CalendarCheck2 />}
          title={t('list.emptyTitle')}
          explanation={t('list.emptyExplanation')}
          action={{
            label: t('list.emptyAction'),
            onClick: () => void navigate({ to: '/dashboard' }),
          }}
        />
      </PageContainer>
    );
  }

  // D27: a section with no students has nothing to mark — out of the list and the count.
  // Same for a section whose CLASS has no school today (`is_working_day` is per
  // class): marking it is refused, so it must not sit in "pending" all day.
  const withStudents = sections.filter((s) => s.student_count > 0);
  const markable = withStudents.filter((s) => s.is_working_day);
  const isPending = (s: MySection) => s.today?.state !== 'FINALIZED';
  const pendingCount = markable.filter(isPending).length;
  const visible = markable.filter((s) =>
    status === 'pending' ? isPending(s) : status === 'done' ? !isPending(s) : true,
  );
  const holiday = withStudents.length > 0 && markable.length === 0;
  // Array.prototype.sort is stable: server order is kept within a group.
  const sorted = [...visible].sort((a, b) => rank(a) - rank(b));

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'status',
      label: t('list.filterStatus'),
      allLabel: t('list.filterAll'),
      options: [
        { value: 'pending', label: t('list.filterPending') },
        { value: 'done', label: t('list.filterDone') },
      ],
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('list.title')}
        subtitle={
          holiday
            ? undefined
            : t('list.pendingCount', {
                count: markable.length,
                pending: pendingCount,
                total: markable.length,
              })
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FilterBar
          fields={filterFields}
          values={status ? { status } : {}}
          onChange={(patch) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                status:
                  patch.status === 'pending' || patch.status === 'done' ? patch.status : undefined,
              }),
            })
          }
        />
        <div className="grid gap-1.5 md:w-64">
          <Label htmlFor="attendance-list-date">{t('list.dateLabel')}</Label>
          <DatePicker
            id="attendance-list-date"
            aria-label={t('list.dateLabel')}
            className="w-full"
            config={regionConfig}
            value={parseDate(date)}
            max={parseDate(today)}
            clearable={false}
            onValueChange={(next) =>
              void navigate({
                search: (prev) => ({ ...prev, date: next ? toIsoDate(next) : prev.date }),
              })
            }
          />
        </div>
      </div>
      {holiday ? (
        <EmptyState
          icon={<CalendarCheck2 />}
          title={t('list.holidayTitle')}
          explanation={t('list.holidayBody')}
        />
      ) : sorted.length === 0 && status === 'pending' ? (
        <EmptyState
          icon={<CalendarCheck2 />}
          title={t('list.allDoneTitle')}
          // `subtitleDone` says "Today, …" — a past `?date=` just names the day.
          explanation={
            date === today
              ? t('list.subtitleDone', { date: formatDate(date, regionConfig) })
              : formatDate(date, regionConfig)
          }
        />
      ) : sorted.length === 0 && status === 'done' ? (
        <EmptyState
          icon={<CalendarCheck2 />}
          title={t('list.noneDoneTitle')}
          explanation={t('list.noneDoneBody')}
        />
      ) : (
        <section aria-labelledby="att-sections">
          <h2 id="att-sections" className="sr-only">
            {t('list.caption')}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((section) => (
              <li key={section.section_id} className="min-w-0">
                <Link
                  to="/attendance/$sectionId"
                  params={{ sectionId: section.section_id }}
                  search={{ date }}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4 no-underline shadow-e1 hover:bg-muted md:p-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-h3">
                      {t('mark.title', {
                        className: section.class_name,
                        sectionName: section.section_name,
                      })}
                    </span>
                    <span className="mt-0.5 block text-text-secondary">
                      {t('list.studentCount', { count: section.student_count })}
                    </span>
                    <span className="mt-0.5 block truncate text-text-secondary">
                      {t('list.classTeacher')}:{' '}
                      {section.class_teacher_name ?? t('list.noClassTeacher')}
                    </span>
                    <CountChips section={section} />
                  </span>
                  <StateBadge section={section} />
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-text-secondary" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}

function AttendanceListPending() {
  const { t } = useTranslation('attendance');
  return <RoutePending variant="list" label={t('list.loadingLabel')} />;
}

/**
 * [83.4.1] Academics › My coordination (Epic 83 D9, D22–D25): with no click, per coordinated
 * class, which sections have no attendance on the date, which mark sheets are pending and who
 * teaches what. "Notify teachers" sends one in-app reminder. Cloned from `my-class/index.tsx`.
 *
 * - No coordinator rows: the empty state (D25). The nav item shows for every TEACHER (P12).
 * - `?date=YYYY-MM-DD` changes the day; omitted = the school's today (the server decides).
 * - `?then=notify` opens "Notify teachers" for the first class (palette action
 *   `coordination.notify-teachers`).
 */
import {
  Button,
  DatePicker,
  EmptyState,
  ErrorState,
  Label,
  RoutePending,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  coordinationOverviewQueryOptions,
  useCoordinationOverview,
  type CoordinationTeacher,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { parseDate, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { MegaphoneIcon, UsersRoundIcon } from 'lucide-react';
import * as React from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ClassCard } from './-cards';
import { NotifyTeachersDialog } from './-notify-dialog';

const searchSchema = z.object({
  then: z.enum(['notify']).optional().catch(undefined),
  // A real calendar day only: `2026-13-45` falls back to the school's today instead of reaching
  // `parseDate`, which throws on it.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      try {
        parseDate(value);
        return true;
      } catch {
        return false;
      }
    })
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_staff/my-coordination/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient
        .ensureQueryData(coordinationOverviewQueryOptions(deps.date))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('coordination', 'nav'),
    ]),
  pendingComponent: MyCoordinationPending,
  component: MyCoordinationPage,
});

function MyCoordinationPending() {
  const { t } = useTranslation('coordination');
  return <RoutePending variant="list" label={t('title')} />;
}

function MyCoordinationPage() {
  const { t } = useTranslation('coordination');
  const search = Route.useSearch();
  const navigate = useNavigate();
  const region = useTenantRegionConfig();
  const query = useCoordinationOverview(search.date);
  const classes = React.useMemo(() => query.data?.classes ?? [], [query.data]);
  const date = query.data?.date ?? search.date ?? '';

  const [notifyFor, setNotifyFor] = React.useState<CoordinationTeacher[] | null>(null);
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current || search.then !== 'notify' || !query.isSuccess) return;
    opened.current = true;
    const first = classes.find((c) => c.teachers.length > 0);
    if (first) setNotifyFor(first.teachers);
    void navigate({
      to: '/my-coordination',
      search: search.date ? { date: search.date } : {},
      replace: true,
    });
  }, [search.then, search.date, query.isSuccess, classes, navigate]);

  const firstWithTeachers = classes.find((c) => c.teachers.length > 0);
  const openNotify = firstWithTeachers ? () => setNotifyFor(firstWithTeachers.teachers) : undefined;

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <div aria-busy="true" className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (classes.length === 0) {
    body = (
      <EmptyState
        icon={<UsersRoundIcon aria-hidden="true" />}
        title={t('emptyTitle')}
        explanation={t('empty')}
      />
    );
  } else {
    body = (
      <div className="grid gap-4 pb-20 md:pb-0 xl:grid-cols-2">
        {classes.map((cls) => (
          <ClassCard
            key={`${cls.class_id}-${cls.subject_id ?? 'all'}`}
            cls={cls}
            date={date}
            onNotify={() => setNotifyFor(cls.teachers)}
          />
        ))}
      </div>
    );
  }

  return (
    <PageContainer size="wide">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1.5 md:w-64">
          <Label htmlFor="coordination-date">{t('dateLabel')}</Label>
          <DatePicker
            id="coordination-date"
            aria-label={t('dateLabel')}
            className="w-full"
            config={region}
            value={date ? parseDate(date) : undefined}
            clearable={false}
            onValueChange={(next) =>
              void navigate({
                to: '/my-coordination',
                search: next ? { date: toIsoDate(next) } : {},
              })
            }
          />
        </div>
        {openNotify && (
          <Button type="button" className="hidden md:inline-flex" onClick={openNotify}>
            <MegaphoneIcon aria-hidden="true" />
            {t('notify')}
          </Button>
        )}
      </div>
      {body}

      {/* Phone: the primary action stays reachable at the bottom of the screen. */}
      {openNotify && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border-subtle bg-surface p-3 md:hidden">
          <Button type="button" className="h-11 w-full" onClick={openNotify}>
            <MegaphoneIcon aria-hidden="true" />
            {t('notify')}
          </Button>
        </div>
      )}

      <NotifyTeachersDialog
        open={notifyFor !== null}
        onOpenChange={(open) => !open && setNotifyFor(null)}
        teachers={notifyFor ?? []}
      />
    </PageContainer>
  );
}

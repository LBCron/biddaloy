/**
 * [70.5.3] Final results landing: one line per class of a year, its status, and the one next
 * action (Start for a class with no final result yet, Open otherwise). Start creates a DRAFT
 * (the server picks the published TERM exams, D3) and goes straight to its detail page.
 */
import { Permission } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import {
  Button,
  Label,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  type FinalResultListItem,
  useAcademicYears,
  useCreateFinalResult,
  useFinalResults,
  examKeys,
  type Exam,
  useHasPermission,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { fetchAllPages, PAGE_SIZE } from './-fetch-all';

export const Route = createFileRoute('/_staff/results/final/')({
  loader: () => loadRouteNamespaces('exams', 'common', 'nav'),
  pendingComponent: FinalResultsPending,
  component: FinalResultsListPage,
});

const TONE = {
  NOT_SET_UP: 'neutral',
  DRAFT: 'neutral',
  PROCESSED: 'info',
  PUBLISHED: 'success',
} as const;

function FinalResultsListPage() {
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const navigate = Route.useNavigate();
  const canStart = useHasPermission(Permission.RESULT_PROCESS);
  const years = useAcademicYears({ limit: 100 });
  const [pickedYear, setPickedYear] = React.useState<string | undefined>(undefined);
  const yearList = years.data?.data ?? [];
  const yearId = pickedYear ?? (yearList.find((y) => y.is_current) ?? yearList[0])?.id;

  const list = useFinalResults(yearId);
  // Which classes have a published exam: every exam of the year, paged 100 at a time. The
  // exams list has no status filter, so this is the cheapest read that cannot miss one. If the
  // list is cut (past the page cap) the gate stays open and the server has the last word.
  const exams = useQuery({
    queryKey: [...examKeys.lists(), 'start-gate', yearId],
    queryFn: async ({ signal }) => {
      const all = await fetchAllPages(async (offset) => {
        const { data } = await apiClient.get<{ data: Exam[]; total: number }>('/exams', {
          params: {
            academic_year_id: yearId,
            limit: PAGE_SIZE,
            page: offset / PAGE_SIZE + 1,
          },
          signal,
        });
        return { items: data.data, total: data.total };
      });
      return {
        truncated: all.truncated,
        classIds: new Set(all.items.filter((e) => e.status === 'PUBLISHED').map((e) => e.class_id)),
      };
    },
    enabled: canStart && Boolean(yearId),
  });
  const create = useCreateFinalResult();
  const [startingId, setStartingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    document.title = t('finalResults.documentTitle.list') + ' · Biddaloy';
  }, [t]);

  const hasPublishedExam = (classId: string) =>
    exams.data?.truncated === true || exams.data?.classIds.has(classId) === true;

  const start = (classId: string) => {
    if (!yearId) return;
    setStartingId(classId);
    create.mutate(
      { class_id: classId, academic_year_id: yearId },
      {
        onSuccess: (created) =>
          void navigate({
            to: '/results/final/$finalResultId',
            params: { finalResultId: created.id },
          }),
        onError: () => toast.error(t('finalResults.list.startError')),
        onSettled: () => setStartingId(null),
      },
    );
  };

  // The table caches each cell by row object, so a cell that reads page state (Start's spinner,
  // the pending lock, the exam gate) needs fresh row objects whenever that state changes.
  const tableRows = React.useMemo(
    () => (list.data ?? []).map((r) => ({ ...r })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the extra deps are the point
    [list.data, startingId, create.isPending, exams.data],
  );

  const columns: DataTableColumn<FinalResultListItem>[] = [
    {
      id: 'class',
      header: t('finalResults.list.classColumn'),
      accessorFn: (row) => row.class.name,
      card: 'title',
    },
    {
      id: 'status',
      header: t('finalResults.list.statusColumn'),
      accessorFn: (row) => (
        <StatusBadge tone={TONE[row.status]} label={t(`finalResults.status.${row.status}`)} />
      ),
      card: 'badge',
    },
    {
      id: 'published',
      header: t('finalResults.list.publishedColumn'),
      accessorFn: (row) => (row.published_at ? formatDate(row.published_at, config) : '—'),
    },
    {
      id: 'action',
      header: '',
      pinned: true,
      accessorFn: (row) => {
        if (row.final_result_id) {
          return (
            <Button asChild variant="outline">
              <Link
                to="/results/final/$finalResultId"
                params={{ finalResultId: row.final_result_id }}
              >
                {t('finalResults.list.open')}
              </Link>
            </Button>
          );
        }
        if (!canStart) return null;
        const blocked = exams.isSuccess && !hasPublishedExam(row.class.id);
        return (
          <div className="flex flex-col items-start gap-1">
            <Button
              type="button"
              disabled={blocked || (create.isPending && startingId !== row.class.id)}
              loading={startingId === row.class.id}
              onClick={() => start(row.class.id)}
            >
              {t('finalResults.list.start')}
            </Button>
            {blocked && (
              <p className="text-caption text-text-secondary">
                {t('finalResults.list.startDisabled')}{' '}
                <Link to="/results" className="font-medium underline">
                  {t('finalResults.list.startDisabledLink')}
                </Link>
              </p>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <ListShell
      title={t('finalResults.title')}
      tableId="final-results"
      caption={t('finalResults.title')}
      columns={columns}
      data={tableRows}
      getRowId={(row) => row.class.id}
      sorting={null}
      onSortingChange={() => undefined}
      totalCount={list.data?.length ?? 0}
      paginated={false}
      loading={list.isLoading || years.isLoading}
      {...(list.isError ? { error: t('finalResults.loadError') } : {})}
      emptyState={{
        title: t('finalResults.list.emptyTitle'),
        explanation: t('finalResults.list.emptyBody'),
      }}
      tabs={
        <div className="flex flex-col gap-1.5 md:w-72">
          <Label htmlFor="final-year">{t('finalResults.yearLabel')}</Label>
          {years.isLoading ? (
            <Skeleton className="h-11 w-full md:h-8" />
          ) : (
            <Select value={yearId ?? ''} onValueChange={setPickedYear}>
              <SelectTrigger id="final-year" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearList.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      }
    />
  );
}

function FinalResultsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

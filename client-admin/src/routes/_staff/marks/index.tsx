/**
 * [19.7.1] Marks-entry landing page. Pick an exam, see every marks list of it
 * (one section x one subject) with its status. The server already scopes
 * `MARK_ENTER` via `TeacherClassSection` (19.4.1's `marks-authorization
 * .util.ts`), so a teacher only ever sees grids they're allowed to write.
 * An admin (EXAM_MANAGE) additionally gets a section/subject text filter
 * since their list spans the whole school.
 *
 * [31.4.marks-1] Kit redesign: PageHeader + labelled exam picker + FilterBar
 * + an unpaginated DataTable (drafts first, then submitted).
 */
import { Permission } from '@biddaloy/shared';
import {
  DataTable,
  EmptyState,
  ErrorState,
  HelpHint,
  Label,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { examsQueryOptions, useExamProgress, useExams, useHasPermission } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { FileX2Icon, ListChecksIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/marks/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(examsQueryOptions({ limit: 50 })).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'grading', 'common', 'nav'),
    ]),
  pendingComponent: MarksListPending,
  component: MarksListPage,
});

type Row = NonNullable<ReturnType<typeof useExamProgress>['data']>['grids'][number];

const NO_SORT = () => undefined;

function MarksListPage() {
  const { t, i18n } = useTranslation('grading');
  const { t: tExams } = useTranslation('exams');
  const { t: tNav } = useTranslation('nav');
  const config = useRegionConfig();
  const canManage = useHasPermission(Permission.EXAM_MANAGE);
  const canEnter = useHasPermission(Permission.MARK_ENTER);
  const examsQuery = useExams({ limit: 50 });
  const exams = examsQuery.data?.data ?? [];

  const [examId, setExamId] = React.useState<string | undefined>(undefined);
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const selectedExamId = examId ?? exams[0]?.id;

  const progressQuery = useExamProgress(selectedExamId);
  const progress = progressQuery.data;
  const bn = i18n.language === 'bn';
  const subjectOf = (row: Row) =>
    bn ? (row.subject_name_bn ?? row.subject_name) : row.subject_name;

  const q = (filters.q ?? '').trim().toLowerCase();
  const status = filters.status;
  const all = progress?.grids ?? [];
  const matches = all.filter(
    (row) =>
      (status === undefined || row.state === status) &&
      (q === '' ||
        row.section_name.toLowerCase().includes(q) ||
        (subjectOf(row) ?? '').toLowerCase().includes(q)),
  );
  // Drafts first, then submitted; each group keeps the server's order.
  const rows = [
    ...matches.filter((r) => r.state === 'DRAFT'),
    ...matches.filter((r) => r.state === 'SUBMITTED'),
  ];

  const subtitle = progress
    ? t('marksEntry.subtitleProgress', {
        submitted: formatNumber(progress.counts.SUBMITTED, config),
        total: formatNumber(progress.counts.DRAFT + progress.counts.SUBMITTED, config),
      })
    : t('marksEntry.subtitleHint');

  const fields: FilterFieldDescriptor[] = [
    ...(canManage
      ? [
          {
            kind: 'text' as const,
            key: 'q',
            primary: true,
            label: t('marksEntry.searchLabel'),
            placeholder: t('marksEntry.searchPlaceholder'),
          },
        ]
      : []),
    {
      kind: 'select',
      key: 'status',
      label: t('marksEntry.statusLabel'),
      allLabel: t('marksEntry.statusAll'),
      options: [
        { value: 'DRAFT', label: t('marksEntry.statusDraft') },
        { value: 'SUBMITTED', label: t('marksEntry.statusSubmitted') },
      ],
    },
  ];

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'section',
      header: t('marksEntry.columnSection'),
      card: 'title',
      accessorFn: (row) => (
        <span className="font-medium">
          {t('marksEntry.sectionValue', { name: row.section_name })}
        </span>
      ),
    },
    {
      id: 'subject',
      header: t('marksEntry.columnSubject'),
      card: 'subtitle',
      accessorFn: (row) => subjectOf(row) ?? '—',
    },
    {
      id: 'status',
      header: t('marksEntry.columnStatus'),
      card: 'badge',
      accessorFn: (row) =>
        row.state === 'DRAFT' ? (
          <StatusBadge tone="warning" label={t('marksEntry.statusDraft')} />
        ) : (
          <StatusBadge tone="success" label={t('marksEntry.statusSubmitted')} />
        ),
    },
  ];

  const gridPath = (row: Row) => `/marks/${selectedExamId}/${row.section_id}/${row.subject_id}`;

  const body = () => {
    if (progressQuery.isError) {
      return (
        <ErrorState
          message={tExams('marksList.loadError')}
          onRetry={() => void progressQuery.refetch()}
        />
      );
    }
    const filtered = all.length > 0 && rows.length === 0;
    return (
      <DataTable<Row>
        tableId="marks-lists"
        caption={tExams('marksList.tableCaption')}
        columns={columns}
        data={rows}
        getRowId={(r) => `${r.section_id}:${r.subject_id}`}
        sorting={null}
        onSortingChange={NO_SORT}
        totalCount={rows.length}
        paginated={false}
        loading={progressQuery.isLoading}
        rowActions={(row) => {
          const draft = row.state === 'DRAFT';
          return [
            {
              intent: 'edit',
              label: t('marksEntry.enterMarks'),
              to: gridPath(row),
              allowed: draft && canEnter,
            },
            {
              intent: 'view',
              label: t('marksEntry.viewMarks'),
              to: gridPath(row),
              allowed: !draft || !canEnter,
            },
          ];
        }}
        emptyState={
          filtered
            ? {
                kind: 'no-results',
                icon: <FileX2Icon />,
                title: t('marksEntry.noMatchTitle'),
                explanation: t('marksEntry.noMatchText'),
                action: { label: t('marksEntry.clearFilters'), onClick: () => setFilters({}) },
              }
            : {
                icon: <ListChecksIcon />,
                title: t('marksEntry.emptyTitle'),
                explanation: t('marksEntry.emptyText'),
              }
        }
      />
    );
  };

  return (
    <PageContainer>
      <PageHeader title={tNav('items.marksEntry')} subtitle={subtitle} />

      {examsQuery.isPending ? (
        <Skeleton className="h-11 w-full md:h-8 md:w-96" />
      ) : examsQuery.isError ? (
        <ErrorState
          message={tExams('marksList.loadError')}
          onRetry={() => void examsQuery.refetch()}
        />
      ) : exams.length > 0 ? (
        <>
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex flex-col gap-1.5 md:w-96 md:shrink-0">
              <span className="inline-flex items-center gap-1">
                <Label htmlFor="marks-exam">{tExams('marksList.examLabel')}</Label>
                <HelpHint helpId="examsResults.marksEntry.field.exam" />
              </span>
              <Select value={selectedExamId ?? ''} onValueChange={setExamId}>
                <SelectTrigger id="marks-exam" className="w-full">
                  <SelectValue placeholder={tExams('marksList.examPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {exams.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.class?.name
                        ? t('marksEntry.examOption', { exam: exam.name, class: exam.class.name })
                        : exam.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 flex-1">
              <FilterBar
                fields={fields}
                values={filters}
                onChange={(patch) =>
                  setFilters((prev) => {
                    const next = { ...prev };
                    for (const [k, v] of Object.entries(patch)) {
                      if (v === null || v === '') delete next[k];
                      else next[k] = v;
                    }
                    return next;
                  })
                }
              />
            </div>
          </div>
          {selectedExamId && body()}
        </>
      ) : (
        <EmptyState
          icon={<ListChecksIcon />}
          title={t('marksEntry.noExamsTitle')}
          explanation={t('marksEntry.noExamsText')}
        />
      )}
    </PageContainer>
  );
}

function MarksListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

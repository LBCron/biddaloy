/**
 * [70.5.3] Results tab: one row per student, best position first, one column per counted exam.
 * Until built it says so. While not published, a notice per section lists students still without
 * a remark or conduct grade and links the notes screen (D18).
 */
import type { FinalResultRowView, FinalResultSummary } from '@biddaloy/shared';
import {
  DataTable,
  ErrorState,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useClassSections, useExams, useFinalResultRows } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FilterBar } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { MissingNotes } from './-publish-dialog';

export interface ResultsPanelProps {
  summary: FinalResultSummary;
}

const PAGE_SIZE = 100; // the server's cap (Rule 5)

export function ResultsPanel({ summary }: ResultsPanelProps) {
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const built = summary.status !== 'DRAFT';
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [page, setPage] = React.useState(1);
  const sections = useClassSections(summary.class.id);
  const exams = useExams({
    academic_year_id: summary.academic_year.id,
    class_id: summary.class.id,
    limit: 100,
  });
  const sectionId = filters.section || undefined;
  const rowsQuery = useFinalResultRows(built ? summary.id : undefined, {
    ...(sectionId ? { section_id: sectionId } : {}),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const examName = (id: string) => exams.data?.data.find((e) => e.id === id)?.name ?? '—';
  const examIds = [...new Set(summary.weights.map((w) => w.exam_id))];

  const needle = (filters.q ?? '').trim().toLowerCase();
  // ponytail: search filters the loaded page only (the endpoint has no name filter); a note
  // beside the search says so when there are more rows than the page. Page the rows if needed.
  const rows = [...(rowsQuery.data?.data ?? [])]
    .filter(
      (r) =>
        needle === '' ||
        r.student.full_name.toLowerCase().includes(needle) ||
        String(r.student.roll_number) === needle,
    )
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

  const n = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : formatNumber(v, config);

  const columns: DataTableColumn<FinalResultRowView>[] = [
    {
      id: 'roll',
      header: t('finalResults.results.roll'),
      accessorFn: (r) => n(r.student.roll_number),
      align: 'end',
    },
    {
      id: 'name',
      header: t('finalResults.results.name'),
      card: 'title',
      accessorFn: (r) => (
        <button
          type="button"
          className="min-h-11 text-left font-medium hover:text-primary md:min-h-0"
          onClick={() =>
            void navigate({
              to: '.',
              search: ((prev: Record<string, unknown>) => ({
                ...prev,
                tab: 'print',
                student: r.student.id,
              })) as never,
            })
          }
        >
          {r.student.full_name}
        </button>
      ),
    },
    ...examIds.map((id): DataTableColumn<FinalResultRowView> => ({
      id: `exam-${id}`,
      header: examName(id),
      align: 'end',
      accessorFn: (r) => {
        const cell = r.per_exam.find((p) => p.exam_id === id);
        return cell?.absent ? t('finalResults.results.absent') : n(cell?.total_marks);
      },
    })),
    {
      id: 'total',
      header: t('finalResults.results.totalMarks'),
      align: 'end',
      accessorFn: (r) => n(r.total_marks),
    },
    {
      id: 'gpa',
      header: t('finalResults.results.gpa'),
      align: 'end',
      accessorFn: (r) => formatNumber(r.gpa, config, { decimals: 2 }),
    },
    { id: 'grade', header: t('finalResults.results.grade'), accessorFn: (r) => r.grade },
    {
      id: 'position',
      header: t('finalResults.results.position'),
      align: 'end',
      accessorFn: (r) => n(r.position),
    },
    {
      id: 'sectionPosition',
      header: t('finalResults.results.sectionPosition'),
      align: 'end',
      accessorFn: (r) => n(r.section_position),
    },
    {
      id: 'status',
      header: '',
      card: 'badge',
      accessorFn: (r) =>
        r.is_fail ? <StatusBadge tone="danger" label={t('finalResults.results.fail')} /> : null,
    },
  ];

  if (!built) {
    return <p className="text-text-secondary">{t('finalResults.results.emptyBuilt')}</p>;
  }
  if (rowsQuery.isError) {
    return (
      <ErrorState
        message={t('finalResults.results.loadError')}
        onRetry={() => void rowsQuery.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {summary.status !== 'PUBLISHED' &&
        (sections.data ?? []).map((s) => (
          <MissingNotes
            key={s.id}
            sectionId={s.id}
            name={s.section_name}
            finalResultId={summary.id}
          />
        ))}

      <FilterBar
        fields={[
          { kind: 'text', key: 'q', label: t('finalResults.results.name'), primary: true },
          {
            kind: 'select',
            key: 'section',
            label: t('finalResults.results.sectionFilter'),
            allLabel: t('finalResults.results.allSections'),
            options: (sections.data ?? []).map((s) => ({ value: s.id, label: s.section_name })),
          },
        ]}
        values={filters}
        onChange={(patch) => {
          setPage(1);
          setFilters((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(patch)) {
              if (v === null) delete next[k];
              else next[k] = v;
            }
            return next;
          });
        }}
        resultCount={rows.length}
      />

      {needle !== '' && (rowsQuery.data?.total ?? 0) > (rowsQuery.data?.data.length ?? 0) && (
        <p className="text-caption text-text-secondary">
          {t('finalResults.results.searchNote', {
            shown: formatNumber(rowsQuery.data?.data.length ?? 0, config),
          })}
        </p>
      )}

      {rowsQuery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <DataTable
          tableId="final-result-rows"
          caption={t('finalResults.tabs.results')}
          columns={columns}
          data={rows}
          getRowId={(r) => r.student.id}
          sorting={null}
          onSortingChange={() => undefined}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={rowsQuery.data?.total ?? rows.length}
          onPageChange={setPage}
          emptyState={{
            title: t('finalResults.results.noRows'),
            explanation: t('finalResults.results.noRowsHint'),
          }}
        />
      )}
    </div>
  );
}

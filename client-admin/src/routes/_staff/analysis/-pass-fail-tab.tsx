/**
 * [26.5.1] Pass/fail tab — per-subject table with an overall row, and a
 * "by component" toggle that swaps in the per-component breakdown. No
 * `Switch` primitive exists in `@biddaloy/ui` (see the plan's corrections)
 * — the toggle reuses `Checkbox`, same as `ResultsPanel`'s `failOnly`
 * filter. Grade distribution renders as compact inline chips (plain
 * tokens, not a new component — a handful of `{grade: count}` pairs
 * doesn't warrant one).
 */
import {
  Checkbox,
  DataTable,
  ErrorState,
  HelpHint,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  passFailByComponentQueryOptions,
  passFailQueryOptions,
  type ComponentPassFailRow,
  type OverallPassFailRow,
  type SubjectPassFailRow,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { ListXIcon } from 'lucide-react';
import type * as React from 'react';

import type { AnalysisTabProps } from './-merit-tab';

type Row = SubjectPassFailRow | OverallPassFailRow;

function GradeChips({
  distribution,
  label,
}: {
  distribution: Record<string, number>;
  label: (grade: string, count: number) => string;
}) {
  const entries = Object.entries(distribution).filter(([, count]) => count > 0);
  if (entries.length === 0) return <>—</>;
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([grade, count]) => (
        <span
          key={grade}
          className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-label"
        >
          {label(grade, count)}
        </span>
      ))}
    </span>
  );
}

export interface PassFailTabProps extends AnalysisTabProps {
  byComponent: boolean;
  onByComponentChange: (next: boolean) => void;
}

export function PassFailTab({
  examId,
  examName,
  sectionId,
  sectionName,
  className,
  byComponent,
  onByComponentChange,
}: PassFailTabProps) {
  const { t } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const config = useRegionConfig();
  const num = (value: number | null | undefined, decimals = 0) =>
    formatNumber(value, config, { decimals });
  // The overall row is a total, not a subject: bold, and not counted in "Total n".
  const strong = (row: Row, value: React.ReactNode) =>
    row.subject_id === null ? <span className="font-semibold">{value}</span> : value;

  // Only the visible tab's query is enabled — the toggle used to fetch both
  // subject- and component-level pass/fail data on every render regardless
  // of which table was shown (code review finding on #1001).
  const passFailQuery = useQuery({
    ...passFailQueryOptions(examId, sectionId),
    enabled: examId !== undefined && !byComponent,
  });
  const componentQuery = useQuery({
    ...passFailByComponentQueryOptions(examId, sectionId),
    enabled: examId !== undefined && byComponent,
  });

  const activeQuery = byComponent ? componentQuery : passFailQuery;

  if (activeQuery.isError)
    return (
      <ErrorState
        message={t('resultsPanel.loadError')}
        onRetry={() => void activeQuery.refetch()}
      />
    );

  const subjectColumns: DataTableColumn<Row>[] = [
    {
      id: 'subject',
      header: t('analysis.passFail.columnSubject'),
      // The server names the overall row "Overall"; show the translated word.
      accessorFn: (row) =>
        row.subject_id === null ? t('analysis.passFail.overallRow') : row.subject_name,
      card: 'title',
    },
    {
      id: 'appeared',
      header: t('analysis.passFail.columnAppeared'),
      accessorFn: (row) => strong(row, num(row.appeared)),
      align: 'end',
    },
    {
      id: 'passed',
      header: t('analysis.passFail.columnPassed'),
      accessorFn: (row) => strong(row, num(row.passed)),
      align: 'end',
    },
    {
      id: 'failed',
      header: t('analysis.passFail.columnFailed'),
      accessorFn: (row) => strong(row, num(row.failed)),
      align: 'end',
    },
    {
      id: 'absent',
      header: t('analysis.passFail.columnAbsent'),
      accessorFn: (row) => strong(row, num(row.absent)),
      align: 'end',
    },
    {
      id: 'pass_pct',
      header: t('analysis.passFail.columnPassPct'),
      accessorFn: (row) => strong(row, `${num(row.pass_pct, 1)}%`),
      align: 'end',
    },
    {
      id: 'highest',
      header: t('analysis.passFail.columnHighest'),
      accessorFn: (row) => strong(row, num(row.highest)),
      align: 'end',
    },
    {
      id: 'average',
      header: t('analysis.passFail.columnAverage'),
      accessorFn: (row) => strong(row, num(row.average, 1)),
      align: 'end',
    },
    {
      id: 'grades',
      header: t('analysis.merit.columnGrade'),
      accessorFn: (row) => (
        <GradeChips
          distribution={row.grade_distribution}
          label={(grade, count) =>
            tg('analysisPage.gradeCount', { grade, n: formatNumber(count, config) })
          }
        />
      ),
    },
  ];

  const componentColumns: DataTableColumn<ComponentPassFailRow>[] = [
    {
      id: 'subject',
      header: t('analysis.passFailComponent.columnSubject'),
      accessorFn: (row) => row.subject_name,
      card: 'title',
    },
    {
      id: 'component',
      header: tg('analysisPage.columnPart'),
      accessorFn: (row) => row.component_name,
    },
    {
      id: 'appeared',
      header: t('analysis.passFailComponent.columnAppeared'),
      accessorFn: (row) => num(row.appeared),
      align: 'end',
    },
    {
      id: 'absent',
      header: t('analysis.passFailComponent.columnAbsent'),
      accessorFn: (row) => num(row.absent),
      align: 'end',
    },
    {
      id: 'below_pass',
      header: t('analysis.passFailComponent.columnBelowPass'),
      accessorFn: (row) => num(row.below_pass),
      align: 'end',
    },
    {
      id: 'highest',
      header: t('analysis.passFailComponent.columnHighest'),
      accessorFn: (row) => num(row.highest),
      align: 'end',
    },
    {
      id: 'average',
      header: t('analysis.passFailComponent.columnAverage'),
      accessorFn: (row) => num(row.average, 1),
      align: 'end',
    },
  ];

  // The overall row only makes sense next to subjects; with none, show the empty state.
  const subjectRows: Row[] =
    passFailQuery.data && passFailQuery.data.subjects.length > 0
      ? [...passFailQuery.data.subjects, passFailQuery.data.overall]
      : [];
  const emptyState = {
    icon: <ListXIcon />,
    title: tg('analysisPage.noRowsTitle'),
    explanation: sectionId ? tg('analysisPage.noRowsSectionText') : tg('analysisPage.noRowsText'),
  };
  const componentRows = componentQuery.data?.rows ?? [];

  return (
    <div id="analysis-print-area" className="flex flex-col gap-3">
      <div className="hidden print:block">
        <h2 className="text-base font-semibold">{examName}</h2>
        <p className="text-sm">
          {className}
          {sectionName ? ` · ${sectionName}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 print:hidden">
        <label className="flex min-h-11 items-center gap-3 md:min-h-8">
          <Checkbox
            checked={byComponent}
            onCheckedChange={(v) => onByComponentChange(v === true)}
          />
          {tg('analysisPage.byPart')}
        </label>
        <HelpHint helpId="examsResults.analysis.field.byPart" />
      </div>
      {byComponent ? (
        <DataTable
          tableId="analysis-pass-fail-component"
          caption={tg('analysisPage.tabs.passFail')}
          columns={componentColumns}
          data={componentRows}
          getRowId={(row) => `${row.subject_id}-${row.component_id}`}
          sorting={null}
          onSortingChange={() => undefined}
          totalCount={componentRows.length}
          paginated={false}
          loading={componentQuery.isLoading}
          emptyState={emptyState}
        />
      ) : (
        <DataTable
          tableId="analysis-pass-fail"
          caption={tg('analysisPage.tabs.passFail')}
          columns={subjectColumns}
          data={subjectRows}
          getRowId={(row) => row.subject_id ?? 'overall'}
          sorting={null}
          onSortingChange={() => undefined}
          totalCount={passFailQuery.data?.subjects.length ?? 0}
          paginated={false}
          loading={passFailQuery.isLoading}
          emptyState={emptyState}
        />
      )}
    </div>
  );
}

/**
 * [19.9.1] Staff results panel on student detail — every exam this
 * student has a result for, published or not, each unpublished one
 * clearly labelled (issue step 4): staff must never mistake an
 * unpublished grade for one a parent can already see. Same
 * `GET /students/:studentId/results` the portal uses
 * (`StudentResultsController`), but staff get `published: false` rows
 * too since the route's own `isGuardianRole` check never fires for them.
 *
 * Mounted as a tab the same way [19.6.1]'s `SubjectChoicesPanel` is
 * (`$studentId.tsx`).
 */
import { Permission } from '@biddaloy/shared';
import {
  DataTable,
  ErrorState,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useFinalResults,
  useHasPermission,
  useStudentEnrollments,
  useStudentFinalCard,
  useStudentResults,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { AwardIcon } from 'lucide-react';

export interface ResultsPanelProps {
  studentId: string;
}

/**
 * [70.5.x] One year's final result of this student, shown above the per-exam rows. The server
 * decides what staff may see (PUBLISHED, or PROCESSED for those who may process); a year with
 * no visible final answers 404 and the row renders nothing.
 * Links to the final result's own page (#3421) for anyone who can read it.
 */
function FinalResultRow({ studentId, yearId }: { studentId: string; yearId: string }) {
  const { t } = useTranslation('exams');
  const regionConfig = useRegionConfig();
  const card = useStudentFinalCard(studentId, yearId);
  const finals = useFinalResults(yearId);
  const canOpen = useHasPermission(Permission.RESULT_READ);
  if (!card.data) return null;
  const status = finals.data?.find((f) => f.final_result_id === card.data.final_result_id)?.status;
  const { final: result, academic_year_name } = card.data;
  return (
    <section
      data-testid="student-final-result"
      className="mb-4 rounded-lg border border-primary bg-primary/5 p-4"
    >
      <h3 className="flex flex-wrap items-center gap-2 text-h3">
        {t('studentResultsPanel.finalTitle', { year: academic_year_name })}
        {status !== undefined && status !== 'PUBLISHED' && (
          <StatusBadge tone="warning" label={t('studentResultsPanel.notPublished')} />
        )}
        {result.is_fail && <StatusBadge tone="danger" label={t('studentResultsPanel.failTag')} />}
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <dt className="text-text-secondary">{t('finalResults.results.totalMarks')}</dt>
          <dd className="font-medium">{formatNumber(result.total_marks, regionConfig)}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">{t('finalResults.results.gpa')}</dt>
          <dd className="font-medium">{formatNumber(result.gpa, regionConfig, { decimals: 2 })}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">{t('finalResults.results.grade')}</dt>
          <dd className="font-medium">{result.grade}</dd>
        </div>
        <div>
          <dt className="text-text-secondary">{t('finalResults.results.position')}</dt>
          <dd className="font-medium">
            {result.position === null ? '-' : formatNumber(result.position, regionConfig)}
          </dd>
        </div>
      </dl>
      {canOpen && (
        <Link
          to="/results/final/$finalResultId"
          params={{ finalResultId: card.data.final_result_id }}
          className="mt-3 inline-block font-medium underline underline-offset-2"
        >
          {t('studentResultsPanel.openFinal')}
        </Link>
      )}
    </section>
  );
}

export function ResultsPanel({ studentId }: ResultsPanelProps) {
  const { t } = useTranslation('exams');
  const { t: tStudents } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const resultsQuery = useStudentResults(studentId);
  // Every year the student was enrolled in, newest first: a promoted student keeps last year's final.
  const enrollments = useStudentEnrollments(studentId);
  const yearIds = [
    ...new Map(
      [...(enrollments.data ?? [])]
        .sort((a, b) => b.academic_year.start_date.localeCompare(a.academic_year.start_date))
        .map((e) => [e.academic_year_id, e.academic_year_id]),
    ).values(),
  ];

  if (resultsQuery.isPending) return <Skeleton className="h-24 w-full" />;
  if (resultsQuery.isError) {
    return (
      <ErrorState
        message={t('studentResultsPanel.loadError')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void resultsQuery.refetch()}
      />
    );
  }

  const rows = resultsQuery.data;
  type Row = (typeof rows)[number];
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'exam',
      header: t('studentResultsPanel.columnExam'),
      accessorFn: (row) => (
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {row.exam_name}
          {row.is_fail && <StatusBadge tone="danger" label={t('studentResultsPanel.failTag')} />}
        </span>
      ),
      card: 'title',
    },
    { id: 'grade', header: t('studentResultsPanel.columnGrade'), accessorFn: (row) => row.grade },
    {
      id: 'gpa',
      header: t('studentResultsPanel.columnGpa'),
      align: 'end',
      accessorFn: (row) => formatNumber(row.gpa, regionConfig, { decimals: 2 }),
    },
    {
      id: 'status',
      header: t('studentResultsPanel.columnStatus'),
      // The one label this panel exists for: staff must never read an
      // unpublished row as something a parent can already see.
      accessorFn: (row) =>
        row.published ? (
          <StatusBadge tone="success" label={t('studentResultsPanel.published')} />
        ) : (
          <StatusBadge tone="warning" label={t('studentResultsPanel.notPublished')} />
        ),
      card: 'badge',
    },
  ];

  return (
    <>
      {yearIds.map((yearId) => (
        <FinalResultRow key={yearId} studentId={studentId} yearId={yearId} />
      ))}
      <DataTable
        tableId="student-results"
        caption={t('studentResultsPanel.caption')}
        paginated={false}
        sorting={null}
        onSortingChange={() => {}}
        columns={columns}
        data={rows}
        getRowId={(row) => row.exam_id}
        totalCount={rows.length}
        rowActions={(row) => [
          {
            intent: 'view',
            label: tStudents('detail.results.view'),
            to: `/results/${row.exam_id}/${studentId}`,
          },
        ]}
        emptyState={{
          title: t('studentResultsPanel.empty'),
          explanation: tStudents('detail.results.emptyExplanation'),
          icon: <AwardIcon aria-hidden="true" />,
        }}
      />
    </>
  );
}

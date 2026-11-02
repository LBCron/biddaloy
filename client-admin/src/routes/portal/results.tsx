/**
 * [19.9.1] — the guardian/student portal's own results page. Cloned from
 * `portal/fees.tsx`'s shell exactly (issue step 1): same loading/empty/
 * error frames, same `?student=` picker wiring, same "no `<h1>` while
 * pending/erroring" heading contract.
 *
 * **Published only (D19).** `GET /students/:studentId/results` already
 * does the filtering server-side (`ResultsService.listForStudent` with
 * `publishedOnly: true` for a PARENT/STUDENT caller) — an unpublished exam
 * never appears in `useStudentResults`'s response at all, so there is
 * nothing here to grey out or hide. Each row expands to the full
 * subject/component breakdown (`useStudentResultCard`, fetched only once
 * expanded) and offers Print, which renders `ReportCard` — the same
 * component the staff-only `/results/$examId/$studentId` route (#904)
 * prints from, reused rather than re-declared.
 *
 * Layout: one card per exam with the figures (GPA, grade, total marks,
 * position) up front, a pass / fail badge, and a footer with a disclosure
 * for the subject table and a labelled Print button. The newest exam
 * starts open. Region config comes from a value-less
 * `RegionConfigProvider` (same reasoning as `fees.tsx`).
 */
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  HelpHint,
  ReportCard,
  RoutePending,
  Skeleton,
  StatusBadge,
  StudentPicker,
  toast,
  type DataTableColumn,
  type ReportCardData,
} from '@biddaloy/ui/components';
import {
  logDocumentPrint,
  myStudentsQueryOptions,
  useMyStudents,
  useStudentResultCard,
  useStudentResults,
  type ResultSubjectDetail,
  type Student,
  type StudentResultRow,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatNumber, formatScore } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { AwardIcon, ChevronDownIcon, ChevronUpIcon, PrinterIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

import { FinalResultCard } from './-final-result-card';

const resultsSearchSchema = z.object({
  /** Same contract as `portal/fees.tsx`'s `student` param — not trusted to
   * widen anything, the server re-checks the link on every request. */
  student: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/results')({
  validateSearch: resultsSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common', 'exams'),
    ]),
  pendingComponent: PortalResultsPending,
  component: PortalResultsRoute,
});

function PortalResultsRoute() {
  return (
    <RegionConfigProvider>
      <PortalResults />
    </RegionConfigProvider>
  );
}

/** The same "class section · roll" line `portal/fees.tsx`'s own
 * `useStudentMeta` renders, from the same two keys. */
function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    const roll = formatNumber(student.roll_number, config);
    return className === null
      ? t('children.metaNoClass', { roll })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll,
        });
  };
}

function PortalResults() {
  const { t } = useTranslation('portal');
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];

  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;

  const resultsQuery = useStudentResults(selected?.id);
  const [printingExamId, setPrintingExamId] = React.useState<string | null>(null);

  if (studentsQuery.isPending) return <ResultsSkeleton label={t('results.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('results.error.message')}
        retryLabel={t('results.error.retry')}
        onRetry={() => void studentsQuery.refetch()}
      />
    );
  }

  if (students.length === 0 || selected === undefined) {
    return (
      <PageContainer size="narrow">
        <PageHeader title={t('results.title')} />
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.explanation')}
          action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
    );
  }

  if (resultsQuery.isPending) {
    return <ResultsSkeleton label={t('results.loading')} showPicker={students.length > 1} />;
  }

  if (resultsQuery.isError) {
    return (
      <ErrorState
        message={t('results.error.message')}
        retryLabel={t('results.error.retry')}
        onRetry={() => void resultsQuery.refetch()}
      />
    );
  }

  // `PrintTarget` is a sibling of the `print:hidden` page, not a child —
  // `display: none` on an ancestor hides it no matter what it sets itself,
  // and the report card would print blank.
  return (
    <>
      <div className="print:hidden">
        <PageContainer size="narrow">
          <PageHeader
            title={t('results.title')}
            subtitle={`${selected.full_name} · ${studentMeta(selected)}`}
          />
          {students.length > 1 && (
            <StudentPicker
              label={t('fees.pickerLabel')}
              items={students.map((student) => ({
                id: student.id,
                name: student.full_name,
                meta: studentMeta(student),
              }))}
              selectedId={selected.id}
              to="/portal/results"
            />
          )}

          {/* [70.W5] The published final result comes first; absent when none. */}
          <div className="mb-6 empty:hidden">
            <FinalResultCard
              studentId={selected.id}
              academicYearId={selected.class_section?.class?.academic_year_id}
              childName={selected.full_name}
              className={selected.class_section?.class?.name ?? null}
            />
          </div>

          {resultsQuery.data.length === 0 ? (
            // Not an error: results appear once the school publishes them
            // (D19, issue step 5).
            <EmptyState
              icon={<AwardIcon />}
              title={t('results.emptyTitle')}
              explanation={t('results.emptyExplanation')}
            />
          ) : (
            <div className="space-y-6">
              {resultsQuery.data.map((row, index) => (
                <ResultCard
                  key={row.exam_id}
                  row={row}
                  studentId={selected.id}
                  defaultOpen={index === 0}
                  printing={printingExamId === row.exam_id}
                  onPrint={() => setPrintingExamId(row.exam_id)}
                />
              ))}
            </div>
          )}
        </PageContainer>
      </div>

      {printingExamId !== null && (
        <PrintTarget
          studentId={selected.id}
          examId={printingExamId}
          onDone={() => setPrintingExamId(null)}
        />
      )}
    </>
  );
}

function ResultCard({
  row,
  studentId,
  defaultOpen,
  printing,
  onPrint,
}: {
  row: StudentResultRow;
  studentId: string;
  defaultOpen: boolean;
  printing: boolean;
  onPrint: () => void;
}) {
  const { t } = useTranslation('portal');
  const { t: tExams } = useTranslation('exams');
  const config = useRegionConfig();
  const [open, setOpen] = React.useState(defaultOpen);
  const titleId = `result-${row.exam_id}`;
  const subjectsId = `result-subjects-${row.exam_id}`;
  // Four literal kinds, never the raw enum for an unknown one.
  const kindLabel =
    row.exam_kind === 'TERM'
      ? tExams('kind.TERM')
      : row.exam_kind === 'MONTHLY'
        ? tExams('kind.MONTHLY')
        : row.exam_kind === 'MODEL'
          ? tExams('kind.MODEL')
          : row.exam_kind === 'OTHER'
            ? tExams('kind.OTHER')
            : '';

  const facts = [
    {
      label: tExams('reportCard.gpa'),
      value: formatNumber(row.gpa, config, { decimals: 2 }),
    },
    { label: tExams('reportCard.grade'), value: row.grade },
    { label: tExams('reportCard.totalMarks'), value: formatScore(row.total_marks, config) },
    {
      label: tExams('reportCard.position'),
      value: row.position === null ? '—' : formatNumber(row.position, config),
    },
  ];

  return (
    <Card asChild>
      <article className="overflow-hidden p-0" aria-labelledby={titleId}>
        <div className="p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={titleId} className="text-h2">
              {row.exam_name}
            </h2>
            <StatusBadge
              tone={row.is_fail ? 'danger' : 'success'}
              label={row.is_fail ? t('results.failTag') : t('results.passTag')}
            />
          </div>
          {kindLabel && <p className="text-text-secondary">{kindLabel}</p>}
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 md:flex md:flex-wrap md:gap-x-10">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-caption text-text-secondary">{fact.label}</dt>
                <dd className="text-h2 tabular-nums">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3 md:flex-row md:px-5">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-11 flex-1 md:h-8 md:flex-none"
              aria-expanded={open}
              aria-controls={subjectsId}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
              {open ? t('results.hideSubjects') : t('results.showSubjects')}
            </Button>
            <HelpHint helpId="portal.results.action.showSubjects" />
          </div>
          <div className="flex items-center gap-1 md:ms-auto">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 md:h-8 md:flex-none"
              aria-label={t('results.printLabel', { name: row.exam_name })}
              loading={printing}
              onClick={onPrint}
            >
              <PrinterIcon aria-hidden="true" />
              {tExams('reportCard.print')}
            </Button>
            <HelpHint helpId="portal.results.action.printReportCard" />
          </div>
        </div>
        <div id={subjectsId}>
          {open && <ResultBreakdown studentId={studentId} examId={row.exam_id} />}
        </div>
      </article>
    </Card>
  );
}

function ResultBreakdown({ studentId, examId }: { studentId: string; examId: string }) {
  const { t } = useTranslation('portal');
  const { t: tExams } = useTranslation('exams');
  const config = useRegionConfig();
  const cardQuery = useStudentResultCard(studentId, examId);

  if (cardQuery.isPending) {
    return (
      <div className="space-y-2 border-t border-border-subtle p-4" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (cardQuery.isError) {
    return (
      <p className="border-t border-border-subtle px-4 py-3 text-caption text-destructive">
        {t('results.breakdownError')}
      </p>
    );
  }

  const card = cardQuery.data;
  const columns: DataTableColumn<ResultSubjectDetail>[] = [
    {
      id: 'subject',
      header: tExams('reportCard.subject'),
      card: 'title',
      accessorFn: (subject) => (
        <>
          {subject.subject_name}
          {subject.is_fourth_subject && (
            <span className="block text-caption text-text-secondary md:ms-2 md:inline">
              {tExams('reportCard.fourthSubject')}
            </span>
          )}
        </>
      ),
    },
    {
      id: 'obtained',
      header: tExams('reportCard.obtained'),
      align: 'end',
      accessorFn: (subject) => formatScore(subject.obtained, config),
    },
    {
      id: 'grade',
      header: tExams('reportCard.grade'),
      accessorFn: (subject) => (
        <span className={subject.is_fail ? 'text-status-overdue-fg' : ''}>{subject.grade}</span>
      ),
    },
    {
      // Hidden in the phone card layout; shown as a column on desktop.
      id: 'gpa',
      header: tExams('reportCard.gpa'),
      align: 'end',
      card: 'hidden',
      accessorFn: (subject) => formatNumber(subject.gpa, config, { decimals: 2 }),
    },
  ];

  return (
    <div className="border-t border-border-subtle">
      <DataTable
        tableId={`portal-result-${examId}`}
        caption={t('results.subjectsCaption', { name: card.exam_name })}
        columns={columns}
        data={card.subjects}
        getRowId={(subject) => subject.subject_id}
        sorting={null}
        onSortingChange={noop}
        paginated={false}
        totalCount={card.subjects.length}
      />
    </div>
  );
}

function noop(): void {}

/** Off-screen render of `ReportCard`, printed once its data has loaded,
 * then discarded. `print:hidden` on the page's own content above hides
 * everything else, so this is the only thing the browser's print dialog
 * ever shows. */
function PrintTarget({
  studentId,
  examId,
  onDone,
}: {
  studentId: string;
  examId: string;
  onDone: () => void;
}) {
  // `{ ns: 'exams' }` on every call below rather than
  // `useTranslation('exams')` — this file's other components all use the
  // 'portal' namespace, and `check-i18n-keys.mjs`'s namespace-resolution
  // regex picks one dominant namespace per file rather than parsing
  // per-hook scope (`portal/fees.tsx`'s own header comment notes the same
  // gap), so a bound `useTranslation('exams')` here gets misrouted as
  // "portal" and every 'reportCard.*' key reads as missing.
  const { t, i18n } = useTranslation();
  const cardQuery = useStudentResultCard(studentId, examId);

  // A failed load must not leave the target mounted: the guardian would see
  // nothing and a second click would do nothing.
  React.useEffect(() => {
    if (!cardQuery.isError) return;
    toast.error(t('results.printError', { ns: 'portal' }));
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardQuery.isError]);

  React.useEffect(() => {
    if (!cardQuery.data) return;
    // Log first, print second (D17/D25): no entry, no print.
    logDocumentPrint(studentId, { document: 'REPORT_CARD', exam_id: examId })
      .then(() => window.print())
      .catch(() => toast.error(t('results.printLogError', { ns: 'portal' })))
      .finally(onDone);
    // Fires once, right after the data this print needs has arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardQuery.data]);

  if (!cardQuery.data) return null;

  const card = cardQuery.data;
  const data: ReportCardData = {
    exam_name: card.exam_name,
    student: card.student,
    result: card.result,
    subjects: card.subjects,
    legend: card.legend,
  };

  return (
    <div className="hidden print:block">
      <ReportCard
        data={data}
        issuer={card.issuer}
        logoUrl={card.logo_url}
        activeLanguage={i18n.language}
        labels={{
          examLabel: t('reportCard.examLabel', { ns: 'exams' }),
          rollLabel: t('reportCard.rollLabel', { ns: 'exams' }),
          subject: t('reportCard.subject', { ns: 'exams' }),
          obtained: t('reportCard.obtained', { ns: 'exams' }),
          grade: t('reportCard.grade', { ns: 'exams' }),
          gpa: t('reportCard.gpa', { ns: 'exams' }),
          totalMarks: t('reportCard.totalMarks', { ns: 'exams' }),
          totalGpa: t('reportCard.totalGpa', { ns: 'exams' }),
          overallGrade: t('reportCard.overallGrade', { ns: 'exams' }),
          position: t('reportCard.position', { ns: 'exams' }),
          positionValue: t('reportCard.positionValue', { ns: 'exams' }),
          fail: t('reportCard.fail', { ns: 'exams' }),
          fourthSubject: t('reportCard.fourthSubject', { ns: 'exams' }),
          absent: t('reportCard.absent', { ns: 'exams' }),
          legendTitle: t('reportCard.legendTitle', { ns: 'exams' }),
          programs: t('reportCard.programs', { ns: 'exams' }),
          progress: t('reportCard.progress', { ns: 'exams' }),
          latestMilestone: t('reportCard.latestMilestone', { ns: 'exams' }),
          scoreGrade: t('reportCard.scoreGrade', { ns: 'exams' }),
        }}
      />
    </div>
  );
}

function ResultsSkeleton({ label, showPicker = false }: { label: string; showPicker?: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-8 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}

function PortalResultsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

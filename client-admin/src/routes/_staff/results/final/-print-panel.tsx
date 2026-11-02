/**
 * [70.5.3] Print tab: pick a section (and a student) to preview the final report card on A4, then
 * print every card of the section or the section's tabulation sheet (D20).
 *
 * There is no print route for a final result, so this prints in place: the sheets sit in a
 * `.final-print-area` that is hidden on screen, and a print-only stylesheet hides the rest of the
 * page, so the app chrome never lands on paper. Cards load only when "print all" is pressed.
 */
import type { FinalResultStudentCard, FinalResultSummary } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import {
  Button,
  EmptyState,
  ErrorState,
  Label,
  ReportCard,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  TabulationSheet,
  toast,
} from '@biddaloy/ui/components';
import type { IssuerSnapshot, ReportCardProps } from '@biddaloy/ui/components';
import {
  finalResultCardKey,
  useClassSections,
  useFinalResultRows,
  useFinalResultStudentCard,
  useFinalTabulation,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, formatNumber } from '@biddaloy/ui/utils';
import { useQueries } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';
import * as React from 'react';

import { subjectLabel } from '../../exams/-detail/subject-label';

export interface PrintPanelProps {
  summary: FinalResultSummary;
}

/** `FinalReportCardData` is not re-exported by the kit; this is the same type. */
type FinalReportCardData = Extract<ReportCardProps['data'], { final: { label: string } }>;

const PRINT_ONLY_CSS = `@media print {
  body * { visibility: hidden !important; }
  .final-print-area, .final-print-area * { visibility: visible !important; }
  .final-print-area { position: absolute; left: 0; top: 0; width: 100%; }
}`;

type Job = 'cards' | 'tabulation' | null;

export function PrintPanel({ summary }: PrintPanelProps) {
  const { t, i18n } = useTranslation('exams');
  const { t: tD } = useTranslation('examDocuments');
  const config = useRegionConfig();
  const lang = i18n.language;
  const built = summary.status !== 'DRAFT';
  const search = useSearch({ strict: false });
  const sections = useClassSections(summary.class.id);
  const [pickedSection, setPickedSection] = React.useState<string | undefined>(undefined);
  const sectionId = pickedSection ?? sections.data?.[0]?.id;
  const rowsQuery = useFinalResultRows(built && sectionId ? summary.id : undefined, {
    ...(sectionId ? { section_id: sectionId } : {}),
    limit: 100,
  });
  const rows = React.useMemo(
    () =>
      [...(rowsQuery.data?.data ?? [])].sort(
        (a, b) => a.student.roll_number - b.student.roll_number,
      ),
    [rowsQuery.data],
  );
  const [pickedStudent, setPickedStudent] = React.useState<string | undefined>(undefined);
  const wanted = pickedStudent ?? search.student;
  const studentId = rows.find((r) => r.student.id === wanted)?.student.id ?? rows[0]?.student.id;
  const cardQuery = useFinalResultStudentCard(summary.id, studentId);

  const [job, setJob] = React.useState<Job>(null);
  // `useQueries` so every student's card is fetched on demand, one request each, never retried.
  const allCards = useQueries({
    queries: rows.map((r) => ({
      queryKey: finalResultCardKey(summary.id, r.student.id),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (
          await apiClient.get<FinalResultStudentCard>(
            `/final-results/${summary.id}/students/${r.student.id}`,
            { signal },
          )
        ).data,
      enabled: job === 'cards',
      // A rebuild or reopen changes the cards: never print a cached copy.
      staleTime: 0,
      gcTime: 0,
      retry: false,
    })),
  });
  const tab = useFinalTabulation(summary.id, job === 'tabulation' ? sectionId : undefined);

  const cardsReady = job === 'cards' && allCards.length > 0 && allCards.every((q) => q.isSuccess);
  const cardsFailed = job === 'cards' && allCards.some((q) => q.isError);
  const tabReady = job === 'tabulation' && tab.isSuccess;
  const tabFailed = job === 'tabulation' && tab.isError;
  React.useEffect(() => {
    if (!cardsReady && !tabReady) return;
    // One frame so the print area is in the DOM before the browser snapshots it.
    const id = requestAnimationFrame(() => {
      window.print();
      setJob(null);
    });
    return () => cancelAnimationFrame(id);
  }, [cardsReady, tabReady]);
  React.useEffect(() => {
    if (!cardsFailed && !tabFailed) return;
    toast.error(t('finalResults.print.loadError'));
    setJob(null);
  }, [cardsFailed, tabFailed, t]);

  // The card carries no student id; rows do, matched by roll number within the section.
  const sectionPosition = (roll: number) =>
    rows.find((r) => r.student.roll_number === roll)?.section_position ?? null;
  const shareOf = (examId: string) => {
    const w = summary.weights.find((x) => x.exam_id === examId && x.subject_id === null);
    return summary.mode === 'WEIGHTED' && w ? `${formatNumber(w.share_percent, config)}%` : '';
  };

  const blockLabels = {
    workingDays: t('reportCard.workingDays'),
    daysPresent: t('reportCard.presentDays'),
    attendance: t('reportCard.attendance'),
    remark: t('reportCard.remarkLabel'),
    conduct: t('reportCard.conductLabel'),
    final: t('reportCard.finalColumn'),
    sectionPosition: t('finalResults.results.sectionPosition'),
    classTeacher: tD('sign.classTeacher'),
    guardian: t('reportCard.guardian'),
    headTeacher: tD('sign.headTeacher'),
  };
  const rt = (k: string) => t(`reportCard.${k}`);
  const labels = {
    examLabel: rt('examLabel'),
    rollLabel: rt('rollLabel'),
    subject: rt('subject'),
    obtained: rt('obtained'),
    grade: rt('grade'),
    gpa: rt('gpa'),
    totalMarks: rt('totalMarks'),
    totalGpa: rt('totalGpa'),
    overallGrade: rt('overallGrade'),
    position: rt('position'),
    positionValue: rt('positionValue'),
    fail: rt('fail'),
    fourthSubject: rt('fourthSubject'),
    absent: rt('absent'),
    legendTitle: rt('legendTitle'),
    programs: rt('programs'),
    progress: rt('progress'),
    latestMilestone: rt('latestMilestone'),
    scoreGrade: rt('scoreGrade'),
  };

  const cardData = (c: FinalResultStudentCard): FinalReportCardData => ({
    exam_name: t('reportCard.finalTitle'),
    student: c.student,
    result: c.final,
    subjects: c.subjects.map((s) => ({
      subject_name: s.subject_name,
      obtained: s.obtained,
      grade: s.grade,
      gpa: s.gpa,
      is_fail: s.is_fail,
      is_fourth_subject: s.is_fourth_subject,
      components: [],
      exam_cells: s.per_exam.map((p) => ({ exam_id: p.exam_id, value: p.obtained })),
    })),
    legend: c.legend,
    attendance: c.attendance,
    remark: c.remark,
    conduct: c.conduct.map((x) => ({
      label: lang.startsWith('bn') ? x.name_bn : x.name_en,
      grade: x.grade,
    })),
    final: {
      label: t('reportCard.finalColumn'),
      section_position: sectionPosition(c.student.roll_number),
    },
    exam_columns: c.exams.map((e) => ({
      id: e.exam_id,
      label: e.exam_name,
      share_label: shareOf(e.exam_id),
    })),
  });
  const renderCard = (c: FinalResultStudentCard) => (
    <ReportCard
      data={cardData(c)}
      issuer={c.issuer as unknown as IssuerSnapshot}
      logoUrl={c.logo_url}
      activeLanguage={lang}
      labels={labels}
      blockLabels={blockLabels}
    />
  );

  if (!built) {
    return <p className="text-text-secondary">{t('finalResults.print.notBuilt')}</p>;
  }
  if (rowsQuery.isError) {
    return (
      <ErrorState
        message={t('finalResults.print.loadError')}
        onRetry={() => void rowsQuery.refetch()}
      />
    );
  }

  const card = cardQuery.data;
  const printedOn = formatDateTime(new Date(), config);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
        <div className="flex flex-col gap-1.5 md:w-56">
          <Label htmlFor="final-print-section">{t('finalResults.results.sectionFilter')}</Label>
          <Select
            value={sectionId ?? ''}
            onValueChange={(v) => {
              setPickedSection(v);
              setPickedStudent(undefined);
            }}
          >
            <SelectTrigger id="final-print-section" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(sections.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.section_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5 md:w-72">
          <Label htmlFor="final-print-student">{t('finalResults.print.studentLabel')}</Label>
          <Select value={studentId ?? ''} onValueChange={setPickedStudent}>
            <SelectTrigger id="final-print-student" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rows.map((r) => (
                <SelectItem key={r.student.id} value={r.student.id}>
                  {formatNumber(r.student.roll_number, config)} · {r.student.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2 md:ms-auto md:flex-row">
          <Button
            type="button"
            variant="outline"
            disabled={rows.length === 0 || job !== null}
            loading={job === 'cards'}
            onClick={() => setJob('cards')}
          >
            <PrinterIcon aria-hidden className="size-4" />
            {t('finalResults.print.printAll')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!sectionId || job !== null}
            loading={job === 'tabulation'}
            onClick={() => setJob('tabulation')}
          >
            {t('finalResults.print.tabulation')}
          </Button>
        </div>
      </div>

      {rowsQuery.isLoading || cardQuery.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('finalResults.print.noStudents')}
          explanation={t('finalResults.print.noStudentsHint')}
        />
      ) : cardQuery.isError || !card ? (
        <ErrorState
          message={t('finalResults.print.loadError')}
          onRetry={() => void cardQuery.refetch()}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-subtle bg-muted p-2 md:p-4">
          {renderCard(card)}
        </div>
      )}

      {(cardsReady || tabReady) && (
        <>
          <style>{PRINT_ONLY_CSS}</style>
          <div className="final-print-area hidden print:block">
            {cardsReady &&
              allCards.map((q) =>
                q.data ? (
                  <div key={q.data.student.roll_number} className="break-after-page">
                    {renderCard(q.data)}
                  </div>
                ) : null,
              )}
            {tabReady && tab.data && (
              <TabulationSheet
                variant="final"
                issuer={(card?.issuer ?? {}) as unknown as IssuerSnapshot}
                logoUrl={card?.logo_url ?? null}
                activeLanguage={lang}
                examName={t('reportCard.finalTitle')}
                className={tab.data.section.class_name}
                section={tab.data.section.name}
                subjects={tab.data.subjects.map((s) => ({
                  id: s.subject_id,
                  name: subjectLabel(s, lang),
                  fullMarks: 100,
                }))}
                examColumns={tab.data.exams.map((e) => ({ id: e.exam_id, label: e.name }))}
                rows={[...tab.data.rows]
                  .sort((a, b) => a.roll_number - b.roll_number)
                  .map((r) => ({
                    roll: r.roll_number,
                    name: r.full_name,
                    cells: Object.fromEntries(
                      Object.entries(r.cells).map(([id, c]) => [
                        id,
                        { obtained: c.obtained, grade: c.grade, isFail: c.is_fail },
                      ]),
                    ),
                    examTotals: r.exam_totals,
                    total: r.total_marks,
                    gpa: r.gpa,
                    grade: r.grade,
                    merit: r.section_position,
                    isFail: r.is_fail,
                  }))}
                legend=""
                printedOn={printedOn}
                labels={{
                  title: tD('doc.tabulation'),
                  roll: tD('col.roll'),
                  name: tD('col.name'),
                  fullMarks: tD('col.fullMarks', { n: '' }).trim(),
                  obtained: tD('col.marks'),
                  grade: tD('col.grade'),
                  total: tD('col.total'),
                  gpa: tD('col.gpa'),
                  merit: tD('col.merit'),
                  summary: tD('tabulation.summary', {
                    examinees: formatNumber(tab.data.rows.length, config),
                    passed: formatNumber(tab.data.rows.filter((r) => !r.is_fail).length, config),
                    failed: formatNumber(tab.data.rows.filter((r) => r.is_fail).length, config),
                  }),
                  classTeacher: tD('sign.classTeacher'),
                  examController: tD('sign.examController'),
                  headTeacher: tD('sign.headTeacher'),
                  absent: t('finalResults.results.absent'),
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

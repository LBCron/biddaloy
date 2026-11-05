/**
 * [70.W5] Portal results page: the child's published final result, shown
 * first. Cloned from `-latest-result-card.tsx` (a presentational view plus a
 * container that owns the query). `useStudentFinalCard` reads the
 * family-visible route, so only a PUBLISHED final ever arrives; a 404 (or any
 * error) means nothing is published and the container renders nothing, so the
 * per-exam list below stays the page.
 */
import { isNotFoundError } from '@biddaloy/ui/api';
import { Button, Card, ErrorState, Meter, StatusBadge } from '@biddaloy/ui/components';
import { useStudentFinalCard, type FinalCard } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatScore } from '@biddaloy/ui/utils';
import * as React from 'react';

/** Highest GPA on the grading scale the meter is drawn against. */
const GPA_MAX = 5;

export interface FinalResultCardViewProps {
  card: FinalCard;
  childName: string;
  className: string | null;
}

export function FinalResultCardView({ card, childName, className }: FinalResultCardViewProps) {
  const { t, i18n } = useTranslation('portal');
  const { t: tExams } = useTranslation('exams');
  const config = useRegionConfig();
  const [open, setOpen] = React.useState(false);
  const detailsId = 'final-result-details';

  const { final } = card;
  const gpaText = t('finalResult.gpa', { gpa: formatNumber(final.gpa, config, { decimals: 2 }) });
  const max = formatNumber(GPA_MAX, config);
  const title = className
    ? t('finalResult.cardTitle', { year: card.academic_year_name, class: className })
    : t('finalResult.title');

  const shares = card.exam_shares.flatMap((share) => {
    const exam = card.exams.find((e) => e.exam_id === share.exam_id);
    return exam && share.share_percent !== null
      ? [
          t('finalResult.share', {
            exam: exam.exam_name,
            percent: formatNumber(share.share_percent, config, { percent: true }),
          }),
        ]
      : [];
  });

  const { working_days: working, present_days: present } = card.attendance;
  const attendance =
    working !== null && present !== null && working > 0
      ? t('finalResult.attendance', {
          present: formatNumber(present, config),
          working: formatNumber(working, config),
          percent: formatNumber((present / working) * 100, config, { percent: true }),
        })
      : null;

  const bn = i18n.language.startsWith('bn');
  const conduct = card.conduct.map((item) => ({
    key: item.key,
    label: (bn ? item.name_bn : item.name_en) || item.key,
    grade: item.grade ?? '—',
  }));
  const remark = card.remark?.trim();

  return (
    <Card asChild>
      <article className="p-4 md:p-5" aria-labelledby="final-result-title">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id="final-result-title" className="text-h2">
            {title}
          </h2>
          {final.is_fail && <StatusBadge tone="danger" label={t('finalResult.failed')} />}
        </div>
        <p className="text-text-secondary">
          {t('finalResult.yearLine', { child: childName, year: card.academic_year_name })}
        </p>

        <p className="mt-3 text-display tabular-nums">
          {gpaText}{' '}
          <span className="text-body text-text-secondary">{t('finalResult.outOf', { max })}</span>
        </p>
        <Meter
          label={t('finalResult.meterLabel', { max })}
          value={final.gpa}
          max={GPA_MAX}
          valueText={gpaText}
        />

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt className="text-caption text-text-secondary">{tExams('reportCard.grade')}</dt>
            <dd className="text-h2">{final.grade}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">{tExams('reportCard.position')}</dt>
            <dd className="text-h2 tabular-nums">
              {final.position === null ? '—' : formatNumber(final.position, config)}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">{tExams('reportCard.totalMarks')}</dt>
            <dd className="text-h2 tabular-nums">{formatScore(final.total_marks, config)}</dd>
          </div>
        </dl>

        {shares.length > 0 && <p className="mt-3 text-text-secondary">{shares.join(' · ')}</p>}
        {attendance && <p className="mt-1 text-text-secondary">{attendance}</p>}

        {remark ? (
          <div className="mt-3">
            <p className="text-caption text-text-secondary">{tExams('reportCard.remarkLabel')}</p>
            <p>{remark}</p>
          </div>
        ) : null}

        {conduct.length > 0 && (
          <div className="mt-3">
            <p className="text-caption text-text-secondary">{tExams('reportCard.conductLabel')}</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {conduct.map((item) => (
                <li key={item.key}>
                  <StatusBadge tone="neutral" label={`${item.label}: ${item.grade}`} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button
          type="button"
          className="mt-4 h-11 w-full md:h-9 md:w-auto"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t('finalResult.hideDetails') : t('finalResult.showDetails')}
        </Button>

        <div id={detailsId}>
          {open && (
            <table className="mt-3 w-full text-start">
              <caption className="sr-only">{tExams('reportCard.examsHeading')}</caption>
              <thead>
                <tr className="text-caption text-text-secondary">
                  <th scope="col" className="py-1 text-start">
                    {tExams('reportCard.examLabel')}
                  </th>
                  <th scope="col" className="py-1 text-end">
                    {tExams('reportCard.totalMarks')}
                  </th>
                  <th scope="col" className="py-1 text-end">
                    {tExams('reportCard.gpa')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {card.exams.map((exam) => (
                  <tr key={exam.exam_id} className="border-t border-border-subtle">
                    <td className="py-1">{exam.exam_name}</td>
                    <td className="py-1 text-end tabular-nums">
                      {exam.total_marks === null
                        ? tExams('reportCard.absent')
                        : formatScore(exam.total_marks, config)}
                    </td>
                    <td className="py-1 text-end tabular-nums">
                      {exam.gpa === null ? '—' : formatNumber(exam.gpa, config, { decimals: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </article>
    </Card>
  );
}

export function FinalResultCard({
  studentId,
  academicYearId,
  childName,
  className,
}: {
  studentId: string;
  academicYearId: string | undefined;
  childName: string;
  className: string | null;
}) {
  const { t } = useTranslation('portal');
  const query = useStudentFinalCard(studentId, academicYearId);
  // A 404 means nothing is published; any other failure may hide a published final, so say so.
  if (query.isError && !isNotFoundError(query.error)) {
    return (
      <ErrorState
        message={t('finalResult.loadError')}
        retryLabel={t('finalResult.retry')}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) return null;
  return <FinalResultCardView card={query.data} childName={childName} className={className} />;
}

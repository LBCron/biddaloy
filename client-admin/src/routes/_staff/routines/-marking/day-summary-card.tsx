/** [66.3.01] D19/D34: the day's header, progress bar and the page's one filled button. */
import { Button, HelpHint, StatusBadge } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatTime, formatWeekday } from '@biddaloy/ui/utils';
import { CheckCheckIcon } from 'lucide-react';

import { periodState, type MarkingPeriod, type PeriodState } from './types';

const SEGMENT_TONE: Record<PeriodState, string> = {
  reported: 'bg-status-paid-fg',
  left: 'bg-status-due-fg',
  auto: 'bg-text-secondary',
  noPlan: 'bg-border-functional',
};

export interface DaySummaryCardProps {
  date: string;
  isToday: boolean;
  periods: MarkingPeriod[];
  statusDeadline: string;
  bulkPending: boolean;
  bulkFailed: boolean;
  onBulk: () => void;
  onBackToToday: () => void;
}

export function DaySummaryCard({
  date,
  isToday,
  periods,
  statusDeadline,
  bulkPending,
  bulkFailed,
  onBulk,
  onBackToToday,
}: DaySummaryCardProps) {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  const states = periods.map(periodState);
  const count = (s: PeriodState) => states.filter((x) => x === s).length;
  const left = count('left');
  const weekday = formatWeekday(date, config);
  const title = isToday
    ? t('marking.todayTitle', { weekday })
    : t('marking.dayTitle', { weekday, date: formatDate(date, config) });
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold">{title}</h2>
          <p className="text-body text-text-secondary">
            {t('marking.dayMeta', { count: periods.length, date: formatDate(date, config) })}
          </p>
        </div>
        {isToday ? (
          <StatusBadge
            tone="warning"
            label={t('marking.deadline', { time: formatTime(statusDeadline, config) })}
          />
        ) : (
          <Button variant="link" className="h-11" onClick={onBackToToday}>
            {t('marking.backToToday')}
          </Button>
        )}
      </div>
      {periods.length > 0 && (
        <>
          <div aria-hidden="true" className="flex h-2 gap-1">
            {states.map((s, i) => (
              <span key={i} className={`flex-1 rounded-full ${SEGMENT_TONE[s]}`} />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <p className="text-caption text-text-secondary">
              {t('marking.counts', {
                left,
                reported: count('reported'),
                cancelled: count('auto'),
                noPlan: count('noPlan'),
              })}
            </p>
            {/* One (?) for every period card's status group, not one per card (D18). */}
            <HelpHint helpId="academics.myRoutine.field.lessonStatus" />
          </div>
        </>
      )}
      {isToday && left > 0 && (
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1">
            <Button
              className="h-14 w-full md:h-11 md:w-fit"
              disabled={bulkPending}
              aria-busy={bulkPending}
              onClick={onBulk}
            >
              <CheckCheckIcon aria-hidden="true" />
              {t('marking.allTaught')}
            </Button>
            <HelpHint helpId="academics.myRoutine.action.allTaught" />
          </span>
          <p className="text-caption text-text-secondary">
            {t('marking.allTaughtHelp', { count: left })}
          </p>
          {bulkFailed && (
            <p role="alert" className="text-caption text-status-overdue-fg">
              {t('marking.saveFailed')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

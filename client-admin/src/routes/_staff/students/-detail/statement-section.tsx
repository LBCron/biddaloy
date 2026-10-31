/**
 * [8.15.38] The Statement section of a student's Fees tab: what the school charged, what was
 * paid, and what is still owed after each line, for a range of dates.
 *
 * ```
 *  এখন বাকি: ৳১,২০০                       [শুরুর তারিখ] [শেষ তারিখ]  [প্রিন্ট]
 *  শেষ জমা: ১০ মে ২০২৬
 *
 *  তারিখ     | বিবরণ        | বিল   | জমা  | বাকি
 *  শুরুতে বাকি (bold)                       | ০
 *  ০১ মে     | Tuition      | ১,২০০ |  —   | ১,২০০
 *  শেষে বাকি (bold)                         | ১,২০০
 * ```
 *
 * Words (D21, the 8.15 glossary): বিল / জমা / বাকি. The API calls these `debit` / `credit` /
 * `balance`; those words never reach the screen. Advance money in the wallet is listed under the
 * table and said, plainly, not to be part of what is owed.
 *
 * Default range: from the start of the current academic year to today's end (no `to`). With no
 * `to`, the closing balance is the same number as the total on the Fees tab, and the same number a
 * guardian sees in the portal. Printing: `window.print()` with `printing-statement` on <html> for
 * the duration, so only this section and the school header print (`features/statement/statement-print.css`).
 */
import { Permission } from '@biddaloy/shared';
import { Button, DatePicker, EmptyState, Skeleton } from '@biddaloy/ui/components';
import {
  academicYearsQueryOptions,
  useHasPermission,
  useStudentStatement,
  type StudentStatement,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount, parseServerDate, toIsoDate } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { PrinterIcon } from 'lucide-react';
import * as React from 'react';

import {
  STATEMENT_ROOT_CLASS,
  StatementHeadline,
  StatementPrintHeader,
  StatementWallet,
  isOwed,
  usePrintStatement,
} from '../../../../features/statement/statement-shared';

import { TabQueryState } from './tab-query-state';

export interface StatementSectionProps {
  studentId: string;
}

export function StatementSection({ studentId }: StatementSectionProps) {
  const { t } = useTranslation('fees');
  const { t: tStudents } = useTranslation('students');
  const config = useRegionConfig();

  // The year list is reference data not every role may read: without it the range simply starts
  // empty (everything), and the query is never sent.
  const canReadYears = useHasPermission(Permission.ACADEMIC_STRUCTURE_READ);
  const years = useQuery({ ...academicYearsQueryOptions({ limit: 100 }), enabled: canReadYears });
  const yearsSettled = !canReadYears || years.isSuccess || years.isError;
  const currentYear = years.data?.data.find((year) => year.is_current);
  const defaultFrom = currentYear ? parseServerDate(currentYear.start_date) : undefined;

  // `null` = the user has not touched the control, so the default (this academic year) applies.
  const [pickedFrom, setPickedFrom] = React.useState<{ value: Date | undefined } | null>(null);
  const [to, setTo] = React.useState<Date | undefined>(undefined);
  const from = pickedFrom ? pickedFrom.value : defaultFrom;

  const query = useStudentStatement(
    {
      studentId,
      audience: 'staff',
      from: from ? toIsoDate(from) : undefined,
      to: to ? toIsoDate(to) : undefined,
    },
    { enabled: yearsSettled },
  );

  const handlePrint = usePrintStatement();

  return (
    <section
      aria-label={t('statement.title')}
      className={`${STATEMENT_ROOT_CLASS} flex flex-col gap-4 md:gap-6`}
    >
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">{t('statement.from')}</span>
          <DatePicker
            value={from}
            onValueChange={(value) => setPickedFrom({ value })}
            config={config}
            aria-label={t('statement.fromLabel')}
            placeholder={t('statement.anyDate')}
            max={to}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-text-secondary">{t('statement.to')}</span>
          <DatePicker
            value={to}
            onValueChange={setTo}
            config={config}
            aria-label={t('statement.toLabel')}
            placeholder={t('statement.today')}
            min={from}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="ms-auto"
          disabled={query.data === undefined}
          onClick={handlePrint}
        >
          <PrinterIcon aria-hidden className="size-4" />
          {t('statement.print')}
        </Button>
      </div>

      <TabQueryState
        query={query}
        forbiddenMessage={tStudents('detail.forbidden')}
        errorMessage={t('statement.loadError')}
        skeleton={<Skeleton className="h-64 w-full" />}
      >
        {(statement) => <StatementBody statement={statement} from={from} to={to} />}
      </TabQueryState>
    </section>
  );
}

function StatementBody({
  statement,
  from,
  to,
}: {
  statement: StudentStatement;
  from: Date | undefined;
  to: Date | undefined;
}) {
  const { t } = useTranslation('fees');
  const config = useRegionConfig();
  const money = (amount: number | string) => formatServerAmount(amount, config);
  // A zero is a real zero in the বিল / জমা columns only when the other column has the amount;
  // an em dash reads as "nothing on this line" and keeps the figures easy to scan.
  const cell = (amount: number) => (isOwed(amount) ? money(amount) : '—');

  const headCell = 'px-3 py-2 text-start font-medium text-text-secondary';
  const numberHead = 'px-3 py-2 text-end font-medium text-text-secondary';
  const numberCell = 'px-3 py-2 text-end tabular-nums';

  return (
    <div className="flex flex-col gap-6">
      <StatementPrintHeader statement={statement} from={from} to={to} />

      <StatementHeadline statement={statement} to={to} />

      {statement.entries.length === 0 ? (
        <EmptyState
          title={t('statement.empty.title')}
          explanation={t('statement.empty.explanation')}
        />
      ) : (
        // WCAG SCR29: a focusable, labelled scroll region keeps a wide table keyboard-reachable.
        <div
          role="region"
          aria-label={t('statement.tableLabel')}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- WCAG SCR29, see above
          tabIndex={0}
          className="overflow-x-auto rounded-lg border border-border-subtle"
        >
          <table className="w-full min-w-[34rem] border-collapse">
            <thead className="bg-muted">
              <tr>
                <th scope="col" className={headCell}>
                  {t('statement.columns.date')}
                </th>
                <th scope="col" className={headCell}>
                  {t('statement.columns.what')}
                </th>
                <th scope="col" className={numberHead}>
                  {t('statement.columns.charged')}
                </th>
                <th scope="col" className={numberHead}>
                  {t('statement.columns.paid')}
                </th>
                <th scope="col" className={numberHead}>
                  {t('statement.columns.owed')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              <tr className="font-semibold">
                <th scope="row" colSpan={4} className={headCell}>
                  {t('statement.opening')}
                </th>
                <td className={numberCell}>{money(statement.opening_balance)}</td>
              </tr>
              {statement.entries.map((entry, index) => (
                <tr key={`${entry.date}-${entry.kind}-${index}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(entry.date, config)}</td>
                  <td className="px-3 py-2">
                    {entry.description}
                    {(entry.kind === 'DISCOUNT' || entry.kind === 'REVERSAL') && (
                      <span className="ms-2 text-caption text-text-secondary">
                        {t(`statement.kind.${entry.kind}`)}
                      </span>
                    )}
                  </td>
                  <td className={numberCell}>{cell(entry.debit)}</td>
                  <td className={numberCell}>{cell(entry.credit)}</td>
                  <td className={numberCell}>{money(entry.balance)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <th scope="row" colSpan={4} className={headCell}>
                  {t('statement.closing')}
                </th>
                <td className={numberCell}>{money(statement.closing_balance)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <StatementWallet statement={statement} />
    </div>
  );
}

/**
 * [8.15.38] What the staff Statement section (`routes/_staff/students/-detail/statement-section.tsx`)
 * and the guardian portal page (`routes/portal/statement.tsx`) share, so that both read the same
 * statement the same way: one "still owed" headline, one "last paid" rule, one print header.
 * The API's `debit` / `credit` / `balance` are বিল / জমা / বাকি on screen (D21).
 */
import { type StatementEntry, type StudentStatement, useSchoolProfile } from '@biddaloy/ui/hooks';
import { useLocale, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount } from '@biddaloy/ui/utils';
import * as React from 'react';

import { useActiveSchoolName } from '../../use-active-school-name';

import './statement-print.css';

/** The class that wraps whatever should print, and that `statement-print.css` keeps. */
export const STATEMENT_ROOT_CLASS = 'student-statement';
const PRINTING_CLASS = 'printing-statement';

/** Whole paisa, so float drift never decides "all paid". */
export function isOwed(amount: number | string): boolean {
  return Math.round(Number(amount) * 100) > 0;
}

/** The newest payment line (a reversal or discount is not a payment). */
export function lastPaymentDate(entries: readonly StatementEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]!.kind === 'PAYMENT') return entries[i]!.date;
  }
  return null;
}

/**
 * Returns the function that opens the browser's print dialog for the statement alone: it puts
 * `printing-statement` on <html> (see `statement-print.css`), and `afterprint` takes it off again.
 */
export function usePrintStatement(): () => void {
  React.useEffect(() => {
    const clear = () => document.documentElement.classList.remove(PRINTING_CLASS);
    window.addEventListener('afterprint', clear);
    return () => {
      window.removeEventListener('afterprint', clear);
      clear();
    };
  }, []);
  return React.useCallback(() => {
    document.documentElement.classList.add(PRINTING_CLASS);
    window.print();
  }, []);
}

/** "এখন বাকি: ৳…" or "সব পরিশোধ হয়েছে", then the date of the last payment shown. */
export function StatementHeadline({
  statement,
  to,
  className = 'text-h2 font-semibold tabular-nums md:text-h1',
}: {
  statement: StudentStatement;
  /** The last day the reader asked for; with none, the headline says "now". */
  to: Date | undefined;
  className?: string;
}) {
  const { t } = useTranslation('fees');
  const config = useRegionConfig();
  const amount = formatServerAmount(statement.closing_balance, config);
  const owed = isOwed(statement.closing_balance);
  const lastPaid = lastPaymentDate(statement.entries);
  return (
    <div aria-live="polite" className="flex flex-col gap-1">
      <p className={[className, owed && 'text-status-overdue-fg'].filter(Boolean).join(' ')}>
        {!owed
          ? t('statement.allPaid')
          : to
            ? t('statement.owedUpTo', { date: formatDate(to, config), amount })
            : t('statement.owedNow', { amount })}
      </p>
      {lastPaid !== null && (
        <p className="text-text-secondary">
          {t('statement.lastPaid', { date: formatDate(lastPaid, config) })}
        </p>
      )}
    </div>
  );
}

/** What a printed page starts with: the school, the student and the dates (hidden on screen). */
export function StatementPrintHeader({
  statement,
  from,
  to,
}: {
  statement: StudentStatement;
  from: Date | undefined;
  to: Date | undefined;
}) {
  const { t } = useTranslation('fees');
  const { locale } = useLocale();
  const config = useRegionConfig();
  const profile = useSchoolProfile();
  const fallbackName = useActiveSchoolName();
  const school =
    (locale === 'bn' ? profile.data?.name_bn : null) ?? profile.data?.name ?? fallbackName;
  return (
    <header className="hidden print:block">
      <h1 className="text-h2 font-semibold">{school}</h1>
      <p className="text-body-lg">{t('statement.printTitle')}</p>
      <p>
        {statement.student_name} · {statement.registration_number}
      </p>
      <p className="text-caption">
        {from && to
          ? t('statement.printRange', {
              from: formatDate(from, config),
              to: formatDate(to, config),
            })
          : from
            ? t('statement.printFrom', { from: formatDate(from, config) })
            : to
              ? t('statement.printUpTo', { to: formatDate(to, config) })
              : t('statement.printAll')}
      </p>
    </header>
  );
}

/**
 * Advance money in the wallet, listed apart from the statement. It is not part of what is owed
 * (the closing balance ignores it), and the screen says so plainly.
 */
export function StatementWallet({ statement }: { statement: StudentStatement }) {
  const { t } = useTranslation('fees');
  const config = useRegionConfig();
  const money = (amount: number | string) => formatServerAmount(amount, config);
  const hasWallet = statement.wallet_moves.length > 0 || Number(statement.wallet_balance) !== 0;
  if (!hasWallet) return null;
  return (
    <section aria-labelledby="statement-wallet" className="flex flex-col gap-2">
      <h2 id="statement-wallet" className="text-h3">
        {t('statement.wallet.title')}
      </h2>
      <p>{t('statement.wallet.balance', { amount: money(statement.wallet_balance) })}</p>
      <p className="text-text-secondary">{t('statement.wallet.notCounted')}</p>
      {statement.wallet_moves.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {statement.wallet_moves.map((move, index) => (
            <li
              key={`${move.date}-${index}`}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2"
            >
              <span>
                {formatDate(move.date, config)} ·{' '}
                {Number(move.amount) >= 0
                  ? t('statement.wallet.added')
                  : t('statement.wallet.taken')}
                {move.note ? ` · ${move.note}` : ''}
              </span>
              <span className="tabular-nums">{money(Math.abs(Number(move.amount)))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

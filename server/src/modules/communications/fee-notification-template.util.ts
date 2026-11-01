/**
 * bn/en message text for the "new fees added" family notification [16.3.4].
 *
 * Kept as pure functions, same reasoning as reminder-template.util.ts: the
 * exact wording (and its Bengali-numeral formatting) is worth testing
 * directly rather than only through an integration test that sends a job.
 */

import { FeeType } from '@biddaloy/shared';
import { resolveTemplateLocale } from '../account-access/account-access-templates';

export type FeeNotificationLocale = 'bn' | 'en';

/** One bill this student was just charged, as the message lists it —
 * "মাসিক ফি ৪,২০০" / "Monthly Fee 4,200". `name` is the fee structure's own
 * name, copied verbatim: it is whatever the school typed in, in whichever
 * language they typed it, so this util never translates it.
 *
 * `feeType`/`note`/`periodStart` are only set for a FINE bill (Epic 38 D2's
 * `student_fees.note`/`period_start`, set by the fine engine) — a non-fine
 * bill never carries them, and this util keys its fine-vs-generic branch on
 * `feeType === FeeType.FINE`. `periodStart` is the month the fine is
 * *for* ("Absent fine for September"), which is not the same as the bill's
 * due date ("Due 10 October") — a fine billed in October can cover
 * September's absences. */
export interface FeeNotificationBillLine {
  name: string;
  amount: number;
  feeType?: FeeType;
  note?: string | null;
  periodStart?: Date | string;
}

const LATIN_TO_BENGALI_DIGITS: Record<string, string> = {
  '0': '০',
  '1': '১',
  '2': '২',
  '3': '৩',
  '4': '৪',
  '5': '৫',
  '6': '৬',
  '7': '৭',
  '8': '৮',
  '9': '৯',
};

export function toBengaliDigits(input: string): string {
  return input.replace(/[0-9]/g, (digit) => LATIN_TO_BENGALI_DIGITS[digit]);
}

/** Grouped thousands, no decimals for a whole amount ("4,200"), two decimals
 * only when the amount actually has a fractional part ("4,200.50") — a fee
 * notification is a headline number, not a receipt line. */
export function formatFeeNotificationAmount(locale: FeeNotificationLocale, amount: number): string {
  const hasFraction = Math.round(amount * 100) % 100 !== 0;
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return locale === 'bn' ? toBengaliDigits(formatted) : formatted;
}

const EN_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const BN_MONTH_NAMES = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];

/** "10 September" / "১০ সেপ্টেম্বর" — day + month name, no year, matching the
 * ticket's example wording. `dueDate` accepts a `Date` or an ISO date
 * string (TypeORM hands back `date`-typed columns as strings). */
export function formatFeeNotificationDueDate(
  locale: FeeNotificationLocale,
  dueDate: Date | string,
): string {
  const date = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const day = date.getUTCDate();
  const monthIndex = date.getUTCMonth();
  if (locale === 'bn') {
    return `${toBengaliDigits(String(day))} ${BN_MONTH_NAMES[monthIndex]}`;
  }
  return `${day} ${EN_MONTH_NAMES[monthIndex]}`;
}

function joinBillLines(locale: FeeNotificationLocale, bills: FeeNotificationBillLine[]): string {
  return bills
    .map((bill) => `${bill.name} ${formatFeeNotificationAmount(locale, bill.amount)}`)
    .join(', ');
}

/** SMS-length guard on a fine's free-text note (Steps §1): a note over 80
 * chars is cut to 79 chars + "…" (80 total) rather than dropped, so the
 * reason for the fine still shows up in a segment-1 SMS. */
function truncateFineNote(note: string): string {
  return note.length > 80 ? `${note.slice(0, 79)}…` : note;
}

function monthName(locale: FeeNotificationLocale, periodStart: Date | string): string {
  const date = typeof periodStart === 'string' ? new Date(periodStart) : periodStart;
  return locale === 'bn' ? BN_MONTH_NAMES[date.getUTCMonth()] : EN_MONTH_NAMES[date.getUTCMonth()];
}

/**
 * One FINE bill's line — "Absent fine for September: ৳80 — 4 absent days
 * (1 free). Due 10 October." / the bn equivalent. Distinct from
 * `joinBillLines` (the generic "new fee" phrasing) because a fine carries
 * two extra facts a family needs to make sense of it: which month it's
 * *for*, and why it was charged (`note`).
 */
function buildFineBillLine(
  locale: FeeNotificationLocale,
  bill: FeeNotificationBillLine,
  dueDate: Date | string,
): string {
  const amountText = formatFeeNotificationAmount(locale, bill.amount);
  const dueDateText = formatFeeNotificationDueDate(locale, dueDate);
  const month = bill.periodStart ? monthName(locale, bill.periodStart) : monthName(locale, dueDate);
  const note = bill.note ? truncateFineNote(bill.note) : null;

  if (locale === 'bn') {
    const noteText = note ? ` — ${note}` : '';
    return `${bill.name} (${month} মাসের): ৳${amountText}${noteText}। শেষ তারিখ ${dueDateText}।`;
  }
  const noteText = note ? ` — ${note}.` : '.';
  return `${bill.name} for ${month}: ৳${amountText}${noteText} Due ${dueDateText}.`;
}

/** Message body for a batch of FINE bills only (the listener splits a
 * mixed event into a fine-only call and a non-fine call, Steps §2) — one
 * line per fine, so several fines for the same guardian all show up. */
export function buildFineNotificationMessage(
  locale: FeeNotificationLocale,
  bills: FeeNotificationBillLine[],
  dueDate: Date | string,
): string {
  return bills.map((bill) => buildFineBillLine(locale, bill, dueDate)).join('\n');
}

/**
 * The full message body for one student's guardian: every bill this
 * generation batch created for that student, plus the batch's due date.
 *
 * bn: "নতুন ফি যোগ হয়েছে: মাসিক ফি ৪,২০০, পরীক্ষা ফি ৮০০ — শেষ তারিখ ১০ সেপ্টেম্বর"
 * en: "New fees added: Monthly Fee 4,200, Exam Fee 800 — Due date 10 September"
 */
export function buildFeeNotificationMessage(
  locale: FeeNotificationLocale,
  bills: FeeNotificationBillLine[],
  dueDate: Date | string,
): string {
  // The listener groups a guardian's bills into an all-FINE batch and an
  // all-non-FINE batch before calling this (Steps §2), so checking the
  // first bill is enough — a mixed array never reaches here.
  if (bills[0]?.feeType === FeeType.FINE) {
    return buildFineNotificationMessage(locale, bills, dueDate);
  }
  const billsText = joinBillLines(locale, bills);
  const dueDateText = formatFeeNotificationDueDate(locale, dueDate);
  return locale === 'bn'
    ? `নতুন ফি যোগ হয়েছে: ${billsText} — শেষ তারিখ ${dueDateText}`
    : `New fees added: ${billsText} — Due date ${dueDateText}`;
}

/** `settings.region.locale` (e.g. `bn-BD`) -> this util's locale. Delegates
 * to the one resolver (#3136): no stored locale means the bn-BD default. */
export function resolveFeeNotificationLocale(
  regionLocale: string | undefined | null,
): FeeNotificationLocale {
  return resolveTemplateLocale(regionLocale);
}

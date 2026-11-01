import { describe, it, expect } from 'vitest';
import { FeeType } from '@biddaloy/shared';
import {
  buildFeeNotificationMessage,
  formatFeeNotificationAmount,
  formatFeeNotificationDueDate,
  resolveFeeNotificationLocale,
} from './fee-notification-template.util';

describe('formatFeeNotificationAmount', () => {
  it('formats a whole number with thousands grouping, no decimals, in Latin digits', () => {
    expect(formatFeeNotificationAmount('en', 4200)).toBe('4,200');
  });

  it('formats a whole number in Bengali numerals for bn', () => {
    expect(formatFeeNotificationAmount('bn', 4200)).toBe('৪,২০০');
  });

  it('keeps two decimals when the amount has a fractional part', () => {
    expect(formatFeeNotificationAmount('en', 800.5)).toBe('800.50');
    expect(formatFeeNotificationAmount('bn', 800.5)).toBe('৮০০.৫০');
  });
});

describe('formatFeeNotificationDueDate', () => {
  it('renders day + English month name, no year', () => {
    expect(formatFeeNotificationDueDate('en', '2026-09-10')).toBe('10 September');
  });

  it('renders day + Bengali month name in Bengali numerals', () => {
    expect(formatFeeNotificationDueDate('bn', '2026-09-10')).toBe('১০ সেপ্টেম্বর');
  });

  it('accepts a Date object identically to an ISO string', () => {
    expect(formatFeeNotificationDueDate('en', new Date('2026-01-05T00:00:00Z'))).toBe('5 January');
  });
});

describe('buildFeeNotificationMessage', () => {
  it('matches the ticket wording for bn', () => {
    const message = buildFeeNotificationMessage(
      'bn',
      [
        { name: 'মাসিক ফি', amount: 4200 },
        { name: 'পরীক্ষা ফি', amount: 800 },
      ],
      '2026-09-10',
    );
    expect(message).toBe(
      'নতুন ফি যোগ হয়েছে: মাসিক ফি ৪,২০০, পরীক্ষা ফি ৮০০ — শেষ তারিখ ১০ সেপ্টেম্বর',
    );
  });

  it('matches the analogous en wording', () => {
    const message = buildFeeNotificationMessage(
      'en',
      [
        { name: 'Monthly Fee', amount: 4200 },
        { name: 'Exam Fee', amount: 800 },
      ],
      '2026-09-10',
    );
    expect(message).toBe('New fees added: Monthly Fee 4,200, Exam Fee 800 — Due date 10 September');
  });

  it('lists a single bill without a trailing comma', () => {
    const message = buildFeeNotificationMessage(
      'en',
      [{ name: 'Monthly Fee', amount: 4200 }],
      '2026-09-10',
    );
    expect(message).toBe('New fees added: Monthly Fee 4,200 — Due date 10 September');
  });

  it('does not translate the fee structure name itself', () => {
    // A school's own fee name is copied verbatim regardless of locale —
    // this util only translates the surrounding phrase and the numerals.
    const message = buildFeeNotificationMessage(
      'bn',
      [{ name: 'Custom English Name', amount: 100 }],
      '2026-01-01',
    );
    expect(message).toContain('Custom English Name');
  });
});

describe('buildFeeNotificationMessage — FINE bills [38.2.4]', () => {
  const fineBill = {
    name: 'Absent Fine',
    amount: 80,
    feeType: FeeType.FINE,
    note: '4 absent days (1 free)',
    periodStart: '2026-09-01',
  };

  it('reads as a fine notice in en: amount, month, note and due date all present', () => {
    const message = buildFeeNotificationMessage('en', [fineBill], '2026-10-10');
    expect(message).toContain('80');
    expect(message).toContain('September');
    expect(message).toContain('4 absent days (1 free)');
    expect(message).toContain('10 October');
  });

  it('reads as a fine notice in bn: amount, month, note and due date all present', () => {
    const message = buildFeeNotificationMessage('bn', [fineBill], '2026-10-10');
    expect(message).toContain('৮০');
    expect(message).toContain('সেপ্টেম্বর');
    expect(message).toContain('4 absent days (1 free)');
    expect(message).toContain('১০ অক্টোবর');
  });

  it('truncates a note over 80 chars to 80 chars including the ellipsis', () => {
    const longNote = 'x'.repeat(120);
    const message = buildFeeNotificationMessage(
      'en',
      [{ ...fineBill, note: longNote }],
      '2026-10-10',
    );
    expect(message).not.toContain(longNote);
    expect(message).toContain(`${'x'.repeat(79)}…`);
  });

  it('omits the note segment cleanly when there is no note', () => {
    const message = buildFeeNotificationMessage('en', [{ ...fineBill, note: null }], '2026-10-10');
    expect(message).toContain('Absent Fine for September: ৳80');
    expect(message).not.toContain('—');
  });

  it('produces one line per fine when several fines are billed together', () => {
    const message = buildFeeNotificationMessage(
      'en',
      [fineBill, { ...fineBill, name: 'Late Return Fine', note: 'library book' }],
      '2026-10-10',
    );
    expect(message.split('\n')).toHaveLength(2);
    expect(message).toContain('Absent Fine');
    expect(message).toContain('Late Return Fine');
  });

  it("leaves a tuition (non-FINE) bill's text byte-identical to before", () => {
    const message = buildFeeNotificationMessage(
      'en',
      [{ name: 'Monthly Fee', amount: 4200, feeType: FeeType.MONTHLY_TUITION }],
      '2026-09-10',
    );
    expect(message).toBe('New fees added: Monthly Fee 4,200 — Due date 10 September');
  });
});

describe('resolveFeeNotificationLocale', () => {
  it('resolves a bn-* region locale to bn', () => {
    expect(resolveFeeNotificationLocale('bn-BD')).toBe('bn');
  });

  it('is en for a non-bn locale', () => {
    expect(resolveFeeNotificationLocale('en-US')).toBe('en');
  });

  it('falls back to the bn-BD default for undefined/null/empty (#3136)', () => {
    expect(resolveFeeNotificationLocale(undefined)).toBe('bn');
    expect(resolveFeeNotificationLocale(null)).toBe('bn');
    expect(resolveFeeNotificationLocale('')).toBe('bn');
  });
});

import type { RegionConfig } from '../i18n/region-config';

import { renderDigits, toLatinDigits } from './digits';
import { groupDigits } from './grouping';

/**
 * Generic (non-currency) number display — student counts, percentages,
 * roll numbers. Unlike `formatCurrency`, this isn't money, so a plain
 * `number` in and `toFixed` internally is fine; nothing here accumulates
 * arithmetic error the way chained currency math would.
 */
export function formatNumber(
  value: number | null | undefined,
  config: RegionConfig,
  options: { decimals?: number; percent?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const { decimals = 0, percent = false } = options;
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [integerPart = '0', fractionPart = ''] = fixed.split('.');
  const grouped = groupDigits(integerPart, 'thousand');
  const plain = fractionPart ? `${grouped}.${fractionPart}` : grouped;
  const numeral = renderDigits(plain, config.numerals);
  const signed = negative ? `-${numeral}` : numeral;
  if (!percent) return signed;
  // Bengali-numeral tenants read "৯০ শতাংশ"; a bare Latin "%" next to Bengali digits looks wrong.
  return config.numerals === 'bengali' ? `${signed} শতাংশ` : `${signed}%`;
}

/** A mark or score stored as `numeric(…, 2)`: keeps the fraction it has
 * (87.5, 87.25) and pads nothing (88, not 88.00). Worked in whole
 * hundredths so float noise never adds a digit. */
export function formatScore(value: number | null | undefined, config: RegionConfig): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const hundredths = Math.round(value * 100);
  const decimals = hundredths % 100 === 0 ? 0 : hundredths % 10 === 0 ? 1 : 2;
  return formatNumber(hundredths / 100, config, { decimals });
}

/** Accepts either digit system and grouping separators; returns a plain
 * JS number. Throws `RangeError` on invalid input, same reasoning as
 * `parseCurrency`. Unlike `parseCurrency`/`parsePhone`, no `RegionConfig`
 * is needed — digit-system detection is automatic (`toLatinDigits` accepts
 * both), and grouping separators are stripped unconditionally regardless
 * of style. */
export function parseNumber(input: string): number {
  const cleaned = toLatinDigits(input).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new RangeError(`parseNumber: "${input}" is not a valid number`);
  }
  return Number(cleaned);
}

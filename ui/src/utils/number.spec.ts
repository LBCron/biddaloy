import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN } from '../i18n/region-config';

import { formatNumber, formatScore, parseNumber } from './number';

describe('formatNumber', () => {
  it('groups with thousand separators by default', () => {
    expect(formatNumber(1234567, REGION_BD_EN)).toBe('1,234,567');
  });

  it('renders Bengali numerals for a Bengali-numeral config', () => {
    expect(formatNumber(1234, REGION_BD_BN)).toBe('১,২৩৪');
  });

  it('supports decimals', () => {
    expect(formatNumber(12.5, REGION_BD_EN, { decimals: 2 })).toBe('12.50');
  });

  it('prefixes negative numbers with a minus sign', () => {
    expect(formatNumber(-1234, REGION_BD_EN)).toBe('-1,234');
  });

  it('rounds to the requested decimal count', () => {
    expect(formatNumber(1.005, REGION_BD_EN, { decimals: 1 })).toBe('1.0');
  });

  it('appends a percent marker in the tenant numeral system', () => {
    expect(formatNumber(90, REGION_BD_EN, { percent: true })).toBe('90%');
    expect(formatNumber(90, REGION_BD_BN, { percent: true })).toBe('৯০ শতাংশ');
    expect(formatNumber(null, REGION_BD_BN, { percent: true })).toBe('—');
  });

  it('formats zero', () => {
    expect(formatNumber(0, REGION_BD_EN)).toBe('0');
  });
});

describe('parseNumber', () => {
  it('parses a grouped number back to a plain JS number', () => {
    expect(parseNumber('1,234,567')).toBe(1234567);
  });

  it('accepts Bengali digits', () => {
    expect(parseNumber('১,২৩৪')).toBe(1234);
  });

  it('parses negative numbers', () => {
    expect(parseNumber('-1,234')).toBe(-1234);
  });

  it('parses decimals', () => {
    expect(parseNumber('12.5')).toBe(12.5);
  });

  it('throws on invalid input', () => {
    expect(() => parseNumber('not a number')).toThrow(RangeError);
  });

  it('round-trips through formatNumber', () => {
    expect(parseNumber(formatNumber(1234567, REGION_BD_EN))).toBe(1234567);
    expect(parseNumber(formatNumber(1234567, REGION_BD_BN))).toBe(1234567);
  });

  it.each([null, undefined, Number.NaN])('shows the none value for %s', (value) => {
    expect(formatNumber(value, REGION_BD_EN)).toBe('—');
  });
});

describe('formatScore', () => {
  it.each([
    [88, '88'],
    [87.5, '87.5'],
    [87.25, '87.25'],
    [0.3, '0.3'],
    [100, '100'],
  ])('shows %s as %s', (value, expected) => {
    expect(formatScore(value, REGION_BD_EN)).toBe(expected);
  });

  it('uses the region numerals', () => {
    expect(formatScore(89.5, REGION_BD_BN)).toBe('৮৯.৫');
  });

  it('shows the none value for a missing score', () => {
    expect(formatScore(null, REGION_BD_EN)).toBe('—');
  });
});

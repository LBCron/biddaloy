import { describe, expect, it } from 'vitest';

import { DEFAULT_CONDUCT_ITEMS } from '../types/report-card-note.types';
import {
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  ExamStatus,
  MarkGridState,
  MarkStatus,
} from './exams';

describe('exam enums', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['ExamKind', ExamKind],
    ['ExamStatus', ExamStatus],
    ['ExamComponentKind', ExamComponentKind],
    ['ExamComponentSource', ExamComponentSource],
    ['MarkStatus', MarkStatus],
    ['MarkGridState', MarkGridState],
  ];

  it.each(cases)('%s is non-empty with unique values', (_name, obj) => {
    const values = Object.values(obj);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
  });

  it('DEFAULT_CONDUCT_ITEMS is the four D30 items', () => {
    expect(DEFAULT_CONDUCT_ITEMS.map((i) => i.key)).toEqual([
      'discipline',
      'neatness',
      'punctuality',
      'sports',
    ]);
  });

  it('ExamKind has the four kinds', () => {
    expect(Object.values(ExamKind).sort()).toEqual(['MODEL', 'MONTHLY', 'OTHER', 'TERM']);
  });

  it('ExamStatus is the D12 three-state lifecycle', () => {
    expect(Object.values(ExamStatus)).toEqual(['DRAFT', 'PROCESSED', 'PUBLISHED']);
  });

  it('ExamComponentKind has all eight kinds', () => {
    expect(ExamComponentKind).toEqual({
      WRITTEN: 'WRITTEN',
      MCQ: 'MCQ',
      VIVA: 'VIVA',
      LAB: 'LAB',
      PRACTICAL: 'PRACTICAL',
      MONTHLY_TEST: 'MONTHLY_TEST',
      ATTENDANCE: 'ATTENDANCE',
      OTHER: 'OTHER',
    });
  });

  it('ExamComponentSource distinguishes MANUAL from DERIVED', () => {
    expect(Object.values(ExamComponentSource).sort()).toEqual(['DERIVED', 'MANUAL']);
  });

  it('MarkStatus has all three statuses', () => {
    expect(MarkStatus).toEqual({
      PRESENT: 'PRESENT',
      ABSENT: 'ABSENT',
      EXEMPT: 'EXEMPT',
    });
  });

  it('MarkGridState is the D12 two-state grid lock', () => {
    expect(Object.values(MarkGridState)).toEqual(['DRAFT', 'SUBMITTED']);
  });
});

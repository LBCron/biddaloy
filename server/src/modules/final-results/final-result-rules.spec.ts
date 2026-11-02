import { describe, it, expect } from 'vitest';
import { FinalResultMode, FinalResultRounding } from '@biddaloy/shared';
import {
  FINAL_RULE_VERSION,
  SharesNotHundred,
  combineStudent,
  combineSubject,
  effectiveShares,
  type ExamSubjectMark,
  type FinalSettings,
} from './final-result-rules';

const MATH = 'math';
const ENG = 'eng';

const settings = (over: Partial<FinalSettings> = {}): FinalSettings => ({
  mode: FinalResultMode.WEIGHTED,
  best_of_count: null,
  rounding: FinalResultRounding.TWO_DECIMALS,
  fail_if_any_exam_fails: false,
  weights: [],
  ...over,
});

const mark = (
  exam_id: string,
  obtained: number | null,
  over: Partial<ExamSubjectMark> = {},
): ExamSubjectMark => ({
  exam_id,
  subject_id: MATH,
  obtained,
  full_marks: 100,
  is_fail: false,
  ...over,
});

const w = (exam_id: string, share_percent: number, subject_id: string | null = null) => ({
  exam_id,
  subject_id,
  share_percent,
});

describe('final-result-rules', () => {
  it('exports the rule version', () => {
    expect(FINAL_RULE_VERSION).toBe('final-1');
  });

  describe('effectiveShares', () => {
    it('gives equal shares when no weights are configured', () => {
      const s = effectiveShares(settings(), MATH, ['a', 'b', 'c', 'd']);
      expect([...s.values()]).toEqual([25, 25, 25, 25]);
    });

    it('uses the exam-level rows when the subject has none of its own', () => {
      const s = effectiveShares(settings({ weights: [w('a', 30), w('b', 70)] }), MATH, ['a', 'b']);
      expect(s.get('a')).toBe(30);
      expect(s.get('b')).toBe(70);
    });

    it('lets a per-subject row set win over the exam default (D6d)', () => {
      const weights = [w('a', 30), w('b', 70), w('a', 50, MATH), w('b', 50, MATH)];
      const s = effectiveShares(settings({ weights }), MATH, ['a', 'b']);
      expect(s.get('a')).toBe(50);
      // Another subject still uses the default.
      expect(effectiveShares(settings({ weights }), ENG, ['a', 'b']).get('a')).toBe(30);
    });

    it('drops an exam without the subject and renormalises to 100 (D22)', () => {
      const s = effectiveShares(settings({ weights: [w('a', 20), w('b', 30), w('c', 50)] }), MATH, [
        'a',
        'b',
      ]);
      expect(s.get('a')).toBeCloseTo(40);
      expect(s.get('b')).toBeCloseTo(60);
      expect(s.has('c')).toBe(false);
    });

    it('throws SharesNotHundred when the subject is in no weighted exam', () => {
      const run = () => effectiveShares(settings({ weights: [w('a', 100)] }), MATH, ['x', 'y']);
      expect(run).toThrow(SharesNotHundred);
    });

    it('throws SharesNotHundred when the kept exams all carry a 0 share', () => {
      const run = () =>
        effectiveShares(settings({ weights: [w('a', 100), w('b', 0)] }), MATH, ['b']);
      expect(run).toThrow(SharesNotHundred);
    });

    it('adds shares exactly in hundredths: 33.33 + 33.33 + 33.34 is 100, 3 x 33.33 is not', () => {
      const ok = settings({ weights: [w('a', 33.33), w('b', 33.33), w('c', 33.34)] });
      expect(effectiveShares(ok, MATH, ['a', 'b', 'c']).get('c')).toBeCloseTo(33.34, 10);
      const short = settings({ weights: [w('a', 33.33), w('b', 33.33), w('c', 33.33)] });
      expect(() => effectiveShares(short, MATH, ['a', 'b', 'c'])).toThrow(SharesNotHundred);
    });

    it('throws SharesNotHundred when the configured rows do not sum to 100', () => {
      const run = () =>
        effectiveShares(settings({ weights: [w('a', 40), w('b', 50)] }), MATH, ['a', 'b']);
      expect(run).toThrow(SharesNotHundred);
      try {
        run();
      } catch (e) {
        expect((e as SharesNotHundred).total).toBe(90);
        expect((e as SharesNotHundred).subject_id).toBe(MATH);
      }
    });
  });

  describe('combineSubject', () => {
    it('combines a 30/70 two-exam case', () => {
      const c = combineSubject(
        [mark('a', 60), mark('b', 90)],
        settings({ weights: [w('a', 30), w('b', 70)] }),
      );
      expect(c.obtained).toBe(81); // 0.3*60 + 0.7*90
      expect(c.full_marks).toBe(100);
    });

    it('uses equal shares by default', () => {
      expect(combineSubject([mark('a', 60), mark('b', 90)], settings()).obtained).toBe(75);
    });

    it('mixes exams with different full marks by percentage, scaled to the largest', () => {
      const c = combineSubject(
        [mark('a', 20, { full_marks: 25 }), mark('b', 60, { full_marks: 100 })],
        settings(),
      );
      // 80% and 60% -> 70% of 100
      expect(c.obtained).toBe(70);
      expect(c.full_marks).toBe(100);
    });

    it('uses a per-subject override', () => {
      const weights = [w('a', 50), w('b', 50), w('a', 100, MATH), w('b', 0, MATH)];
      expect(combineSubject([mark('a', 60), mark('b', 90)], settings({ weights })).obtained).toBe(
        60,
      );
    });

    it('renormalises when the subject is missing from one exam (D22)', () => {
      const c = combineSubject([mark('a', 80)], settings({ weights: [w('a', 30), w('b', 70)] }));
      expect(c.obtained).toBe(80);
    });

    it('counts absent as 0 and does not renormalise (D2)', () => {
      const c = combineSubject(
        [mark('a', null), mark('b', 80)],
        settings({ weights: [w('a', 50), w('b', 50)] }),
      );
      expect(c.obtained).toBe(40);
      expect(c.is_absent).toBe(false);
    });

    it('flags a subject absent in every exam', () => {
      const c = combineSubject([mark('a', null), mark('b', null)], settings());
      expect(c.is_absent).toBe(true);
      expect(c.obtained).toBe(0);
    });

    it('takes the best N by percentage with an equal mean in BEST_OF (D23)', () => {
      const c = combineSubject(
        [mark('a', 90), mark('b', null), mark('c', 70)],
        settings({ mode: FinalResultMode.BEST_OF, best_of_count: 2 }),
      );
      expect(c.obtained).toBe(80); // best 2 of 90, 70, 0 (absent)
    });

    it('uses every exam in BEST_OF when N is missing or larger than the exams', () => {
      const all = [mark('a', 90), mark('b', 60)];
      const open = settings({ mode: FinalResultMode.BEST_OF, best_of_count: null });
      expect(combineSubject(all, open).obtained).toBe(75);
      expect(combineSubject(all, { ...open, best_of_count: 5 }).obtained).toBe(75);
    });

    it('rounds WHOLE half-up and TWO_DECIMALS to two places at .5', () => {
      const marks = [mark('a', 80), mark('b', 81)]; // mean 80.5
      expect(
        combineSubject(marks, settings({ rounding: FinalResultRounding.WHOLE })).obtained,
      ).toBe(81);
      expect(combineSubject(marks, settings()).obtained).toBe(80.5);
      const frac = [mark('a', 80.01), mark('b', 80)]; // 80.005 -> 80.01, not 80.00
      expect(combineSubject(frac, settings()).obtained).toBe(80.01);
      // WHOLE rounds once: 80.495 is below 80.5, so 80 (not 80.5 -> 81).
      const near = [mark('a', 80.49), mark('b', 80.5)];
      expect(combineSubject(near, settings({ rounding: FinalResultRounding.WHOLE })).obtained).toBe(
        80,
      );
      // 39.4967 of 50 is 39, not 39.50 -> 40.
      const low = [
        mark('a', 39.49, { full_marks: 50 }),
        mark('b', 39.49, { full_marks: 50 }),
        mark('c', 39.51, { full_marks: 50 }),
      ];
      expect(combineSubject(low, settings({ rounding: FinalResultRounding.WHOLE })).obtained).toBe(
        39,
      );
      // Thirds: float gives 80.4999..., still the exact .5 that rounds up.
      const thirds = [mark('a', 80), mark('b', 81), mark('c', 80.5)];
      expect(
        combineSubject(thirds, settings({ rounding: FinalResultRounding.WHOLE })).obtained,
      ).toBe(81);
    });

    it('fails the subject from an exam only when the switch is on', () => {
      const marks = [mark('a', 20, { is_fail: true }), mark('b', 90)];
      expect(
        combineSubject(marks, settings({ fail_if_any_exam_fails: true })).is_fail_from_exam,
      ).toBe(true);
      expect(combineSubject(marks, settings()).is_fail_from_exam).toBe(false);
      expect(
        combineSubject([mark('a', 50), mark('b', 90)], settings({ fail_if_any_exam_fails: true }))
          .is_fail_from_exam,
      ).toBe(false);
    });

    it('drops an all-EXEMPT paper (full 0) and renormalises, like D22', () => {
      // Exempt is not absent: counting it as 0 would halve this student's 80.
      const c = combineSubject([mark('a', 0, { full_marks: 0 }), mark('b', 80)], settings());
      expect(c.obtained).toBe(80);
    });

    it('grades a subject exempt in every exam as nothing to grade', () => {
      const c = combineSubject(
        [mark('a', 0, { full_marks: 0 }), mark('b', 0, { full_marks: 0 })],
        settings(),
      );
      // full_marks 0 -> gradeSubjectTotal gives '-', never a fail.
      expect(c).toMatchObject({ obtained: 0, full_marks: 0, percent: 0, is_absent: false });
    });

    it('still counts absent as 0 when the absent paper carries full 0 (D2)', () => {
      const c = combineSubject([mark('a', null, { full_marks: 0 }), mark('b', 80)], settings());
      expect(c.obtained).toBe(40);
    });

    it('treats best_of_count 0 as best 1, never a divide by zero', () => {
      const c = combineSubject(
        [mark('a', 90), mark('b', 60)],
        settings({ mode: FinalResultMode.BEST_OF, best_of_count: 0 }),
      );
      expect(c.obtained).toBe(90);
    });

    it('grades from the rounded mark, not the unrounded percent', () => {
      // 79.1% of a 50-mark subject = 39.55.
      const one = [mark('a', 39.55, { full_marks: 50 })];
      const whole = combineSubject(one, settings({ rounding: FinalResultRounding.WHOLE }));
      // The card prints 40 / 50, so the grade must come from 80%, not 79.1%.
      expect(whole.obtained).toBe(40);
      expect(whole.percent).toBe(80);
      const two = combineSubject(one, settings());
      expect(two.obtained).toBe(39.55);
      expect(two.percent).toBeCloseTo(79.1, 10);
    });

    it('takes shares as the numeric column strings', () => {
      // TypeORM returns numeric(5,2) as a string; '30.00' + '70.00' must not concatenate.
      const weights = [
        { exam_id: 'a', subject_id: null, share_percent: '30.00' },
        { exam_id: 'b', subject_id: null, share_percent: '70.00' },
      ];
      const c = combineSubject([mark('a', 60), mark('b', 90)], settings({ weights }));
      expect(c.obtained).toBe(81);
    });

    it('propagates SharesNotHundred', () => {
      const bad = settings({ weights: [w('a', 40), w('b', 50)] });
      expect(() => combineSubject([mark('a', 10), mark('b', 10)], bad)).toThrow(SharesNotHundred);
    });

    it('never returns more than full marks (property, fixed seed)', () => {
      let seed = 12345;
      const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let i = 0; i < 300; i++) {
        const n = 1 + Math.floor(next() * 4);
        const marks = Array.from({ length: n }, (_, k) => {
          const full = 10 + Math.floor(next() * 91);
          return mark(`e${k}`, next() < 0.15 ? null : Math.round(next() * full * 100) / 100, {
            full_marks: full,
          });
        });
        const best = settings({
          mode: next() < 0.5 ? FinalResultMode.BEST_OF : FinalResultMode.WEIGHTED,
          best_of_count: 1 + Math.floor(next() * 3),
          rounding: next() < 0.5 ? FinalResultRounding.WHOLE : FinalResultRounding.TWO_DECIMALS,
        });
        const c = combineSubject(marks, best);
        expect(c.obtained).toBeGreaterThanOrEqual(0);
        expect(c.obtained).toBeLessThanOrEqual(c.full_marks);
      }
    });
  });

  describe('combineStudent', () => {
    it('groups by subject across exams, including a subject only one exam has (D26)', () => {
      const out = combineStudent(
        [mark('a', 60), mark('b', 80), { ...mark('a', 50), subject_id: ENG }],
        settings({ fail_if_any_exam_fails: true }),
      );
      expect(out.map((s) => s.subject_id)).toEqual([MATH, ENG]);
      expect(out[0]).toMatchObject({ obtained: 70, full_marks: 100, is_absent: false });
      expect(out[1]).toMatchObject({ obtained: 50, component_failed: false });
    });

    it('sets component_failed from the fail switch', () => {
      const [m] = combineStudent(
        [mark('a', 10, { is_fail: true }), mark('b', 90)],
        settings({ fail_if_any_exam_fails: true }),
      );
      expect(m.component_failed).toBe(true);
    });

    it('returns nothing for a student with no marks', () => {
      expect(combineStudent([], settings())).toEqual([]);
    });
  });
});

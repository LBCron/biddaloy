import { FilterOp, type ReportDrill, type ReportFormatRule } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { REGION_BD_EN } from '../../i18n';

import { drillQuery, resolveDrill, type DrillContext } from './drill';
import { describeRule, meetsCondition, toneFor } from './format-cell';
import type { ReportColumn } from './types';

// The BANBEIS count: class down the side, gender across, a count in each cell.
const toStudents: ReportDrill = {
  field: 'class',
  target: { route: '/students' },
  pass: { class_id: 'class', gender: 'gender' },
};
const toReport: ReportDrill = {
  field: 'class',
  target: { report: 'student-list' },
  pass: { class: 'class', academic_year: 'academic_year' },
};

const ctx: DrillContext = {
  reportIdByKey: (key) => (key === 'student-list' ? 'report-uuid' : undefined),
  classIdByName: (name) => (name === 'Class 6' ? 'class-6-uuid' : undefined),
  sectionIdByName: (className, name) =>
    className === 'Class 6' && name === 'A' ? 'section-a-uuid' : undefined,
  params: { academic_year: '2026' },
};

describe('resolveDrill', () => {
  it('maps the class and gender of a count cell into the students list filters', () => {
    const target = resolveDrill(
      [toStudents],
      ['class', 'gender', 'students'],
      { class: 'Class 6', gender: 'FEMALE', students: 38 },
      ctx,
    );
    // The list filters by id, so the class name became its id; the gender went through as it is.
    expect(target).toEqual({
      kind: 'student',
      search: { class_id: 'class-6-uuid', gender: 'FEMALE' },
    });
    expect(drillQuery(target!).toString()).toBe('class_id=class-6-uuid&gender=FEMALE');
  });

  it('a row total names only the class, so the list is every student of the class', () => {
    expect(resolveDrill([toStudents], ['class'], { class: 'Class 6' }, ctx)).toEqual({
      kind: 'student',
      search: { class_id: 'class-6-uuid' },
    });
  });

  it('opens another report by its key, with the clicked values and the run answers as choices', () => {
    const target = resolveDrill([toReport], ['class'], { class: 'Class 6' }, ctx);
    expect(target).toEqual({
      kind: 'report',
      reportId: 'report-uuid',
      params: { class: 'Class 6', academic_year: '2026' },
    });
    expect(JSON.parse(drillQuery(target!).get('p')!)).toEqual({
      class: 'Class 6',
      academic_year: '2026',
    });
  });

  it('makes no link when it would open the wrong people', () => {
    const cell = { class: 'Class 6', gender: 'FEMALE' };
    // A class the school does not have (or one the person may not read).
    expect(resolveDrill([toStudents], ['class'], { class: 'Class 9', gender: 'MALE' }, ctx)).toBe(
      null,
    );
    // Gender not given: the cell has the field but no value, which is not "any gender".
    expect(
      resolveDrill([toStudents], ['class'], { class: 'Class 6', gender: null }, ctx),
    ).toBeNull();
    // A report that is not in this person's catalogue.
    expect(
      resolveDrill([toReport], ['class'], cell, { ...ctx, reportIdByKey: () => undefined }),
    ).toBeNull();
    // A person who may not open the students list.
    expect(
      resolveDrill([toStudents], ['class'], cell, {
        ...ctx,
        canOpen: (kind) => kind !== 'student',
      }),
    ).toBeNull();
    // No rule for this column.
    expect(resolveDrill([toStudents], ['fee'], cell, ctx)).toBeNull();
    expect(resolveDrill(undefined, ['class'], cell, ctx)).toBeNull();
  });

  it('does not link a count for a year the students list cannot show', () => {
    const rule: ReportDrill = {
      field: 'class',
      target: { route: '/students' },
      pass: { class_id: 'class', academic_year: 'academic_year' },
    };
    const cell = { class: 'Class 6' };
    expect(
      resolveDrill([rule], ['class'], cell, { ...ctx, isCurrentYear: () => false }),
    ).toBeNull();
    expect(resolveDrill([rule], ['class'], cell, { ...ctx, isCurrentYear: () => true })).toEqual({
      kind: 'student',
      search: { class_id: 'class-6-uuid' },
    });
  });

  it('resolves a section name through its class', () => {
    const rule: ReportDrill = {
      field: 'section',
      target: { route: '/students' },
      pass: { section_id: 'section' },
    };
    expect(resolveDrill([rule], ['section'], { class: 'Class 6', section: 'A' }, ctx)).toEqual({
      kind: 'student',
      search: { section_id: 'section-a-uuid' },
    });
  });
});

const columns: ReportColumn[] = [
  { key: 'class', type: 'TEXT', kind: 'dimension', label_en: 'Class', label_bn: 'শ্রেণি' },
  { key: 'outstanding', type: 'MONEY', kind: 'measure', label_en: 'Still owed', label_bn: 'বাকি' },
];
const overFive: ReportFormatRule = {
  field: 'outstanding',
  when: { field: 'outstanding', op: FilterOp.GT, value: 5000 },
  style: { tone: 'bad' },
};

describe('colour rules', () => {
  it('applies the tone of the first rule that is met, and none otherwise', () => {
    expect(toneFor([overFive], 'outstanding', { outstanding: 5000.01 }, columns)).toBe('bad');
    // Exactly 5,000.00 is not "more than" 5,000.
    expect(toneFor([overFive], 'outstanding', { outstanding: 5000 }, columns)).toBeNull();
    // Another column is never coloured by this rule.
    expect(toneFor([overFive], 'class', { outstanding: 9000, class: 'Six' }, columns)).toBeNull();
    // A hidden count (null) is never coloured.
    expect(toneFor([overFive], 'outstanding', { outstanding: null }, columns)).toBeNull();
  });

  it('compares money in whole paisa, with no tolerance', () => {
    const equal: ReportFormatRule['when'] = {
      field: 'outstanding',
      op: FilterOp.EQ,
      value: 0.3,
    };
    // 0.1 + 0.2 is 0.30000000000000004 in floating point, but it is 30 paisa.
    expect(meetsCondition(equal, 0.1 + 0.2, 'MONEY')).toBe(true);
  });

  it('writes the rule as the pieces of the designer sentence, in the viewer digits', () => {
    expect(describeRule(overFive, columns, 'en', REGION_BD_EN)).toEqual({
      field: 'Still owed',
      op: 'more',
      value: expect.stringContaining('5,000'),
    });
    // A rule about a field the report does not show has no sentence.
    expect(
      describeRule(
        { ...overFive, when: { ...overFive.when, field: 'gone' } },
        columns,
        'en',
        REGION_BD_EN,
      ),
    ).toBeNull();
  });
});

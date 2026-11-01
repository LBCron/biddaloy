import { AudienceTab, AudienceTarget } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  advancedFilters,
  EMPTY_VOCAB,
  hasOrgChoices,
  validPercent,
} from './advanced-filter-fields';
import {
  audienceQuery,
  INITIAL_FILTERS,
  pendingHint,
  tabKeys,
  type AudienceFilterState,
} from './audience-tabs';

afterEach(cleanupTestState);

const EXAM = '11111111-1111-4111-8111-111111111111';
const f = (x: Partial<AudienceFilterState>): AudienceFilterState => ({ ...INITIAL_FILTERS, ...x });

describe('advanced audience query', () => {
  it('exam tab sends the exam and the chosen target', () => {
    expect(audienceQuery('examFailed', f({ examId: EXAM }), 1, 25)).toEqual({
      page: 1,
      limit: 25,
      target: AudienceTarget.STUDENTS,
      tab: AudienceTab.EXAM_FAILED,
      examId: EXAM,
    });
    expect(
      audienceQuery('examFailed', f({ examId: EXAM, target: 'GUARDIANS' }), 1, 25).target,
    ).toBe(AudienceTarget.GUARDIANS);
  });

  it('fee due sends no extra field', () => {
    expect(audienceQuery('feeDue', f({}), 1, 25)).toEqual({
      page: 1,
      limit: 25,
      target: AudienceTarget.STUDENTS,
      tab: AudienceTab.FEE_DUE,
    });
  });

  it('low attendance defaults to 75 and sends a number', () => {
    expect(audienceQuery('lowAttendance', f({}), 1, 25).belowPercent).toBe(75);
    expect(audienceQuery('lowAttendance', f({ belowPercent: '60' }), 1, 25).belowPercent).toBe(60);
  });

  it('org tab sends only the picked values', () => {
    const q = audienceQuery('orgGroup', f({ shift: 'Morning', group: 'Science' }), 1, 25);
    expect(q).toMatchObject({ tab: AudienceTab.ORG_GROUP, shift: 'Morning', group: 'Science' });
    expect(q).not.toHaveProperty('version');
  });

  it('waits for what the server needs', () => {
    expect(pendingHint('examFailed', f({}))).toBe('pickExam');
    expect(pendingHint('examFailed', f({ examId: EXAM }))).toBeNull();
    expect(pendingHint('orgGroup', f({}))).toBe('pickGroup');
    expect(pendingHint('feeDue', f({}))).toBeNull();
  });
});

describe('percent validation', () => {
  it.each([
    ['75', true],
    ['1', true],
    ['100', true],
    ['0', false],
    ['101', false],
    ['', false],
    ['7.5', false],
    ['abc', false],
  ])('%s -> %s', (v, ok) => {
    expect(validPercent(v)).toBe(ok);
  });

  it('shows an alert and waits for a valid number', async () => {
    renderWithRouter(
      createRootRoute({
        component: () => (
          <>{advancedFilters(f({ belowPercent: '250' }), () => {}, EMPTY_VOCAB).lowAttendance}</>
        ),
      }),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(pendingHint('lowAttendance', f({ belowPercent: '250' }))).toBe('pickPercent');
  });
});

describe('tabs', () => {
  it('hide the org tab unless a field has 2+ values', () => {
    expect(hasOrgChoices({ shifts: ['Morning'], versions: [], groups: ['A'] })).toBe(false);
    expect(hasOrgChoices({ shifts: ['Morning', 'Day'], versions: [], groups: [] })).toBe(true);
    expect(tabKeys(false, false)).not.toContain('orgGroup');
    expect(tabKeys(false, true)).toContain('orgGroup');
  });

  it('give a teacher the class tabs only', () => {
    expect(tabKeys(true, true)).toEqual(['guardians', 'students']);
  });
});

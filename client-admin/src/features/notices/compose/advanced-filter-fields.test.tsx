import { AudienceTab, AudienceTarget } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  useAudienceTabs,
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

const exam = (id: string, name: string, status: string) => ({
  id,
  name,
  status,
  created_at: '2026-01-01',
  class: null,
});
const renderExam = (set = vi.fn()) =>
  renderWithRouter(
    createRootRoute({
      component: () => <>{advancedFilters(f({}), set, EMPTY_VOCAB).examFailed}</>,
    }),
    { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
  );
const listExams = (data: unknown[], total = data.length) =>
  server.use(
    http.get('/api/v1/exams', () =>
      HttpResponse.json({ data, total, page: 1, limit: 100, totalPages: 1 }),
    ),
  );

describe('exam picker', () => {
  it('lists published exams only', async () => {
    listExams([exam('a', 'Final', 'PUBLISHED'), exam('b', 'Draft test', 'DRAFT')]);
    renderExam();
    await userEvent.click(await screen.findByRole('combobox', { name: 'Exam' }));
    expect(await screen.findByRole('option', { name: 'Final' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Draft test' })).toBeNull();
  });

  it('shows a loading line, then a partial-list hint', async () => {
    listExams([exam('a', 'Final', 'PUBLISHED')], 150);
    renderExam();
    expect(await screen.findByText('Loading exams...')).toBeTruthy();
    expect(await screen.findByText('Only the latest 100 exams are listed.')).toBeTruthy();
    expect(screen.queryByText('Loading exams...')).toBeNull();
  });

  it('shows a fixed error message when the list fails', async () => {
    server.use(
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ message: 'secret-detail' }, { status: 500 }),
      ),
    );
    renderExam();
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent).toBe('Could not load exams. Try again.');
  });
});

describe('target toggle and tab switching', () => {
  it('changing the target changes the query target', async () => {
    const set = vi.fn();
    renderWithRouter(
      createRootRoute({ component: () => <>{advancedFilters(f({}), set, EMPTY_VOCAB).feeDue}</> }),
      { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
    );
    const box = await screen.findByRole('combobox', { name: 'Send to' });
    await userEvent.click(box);
    await userEvent.clear(box);
    await userEvent.click(await screen.findByRole('option', { name: 'Guardians' }));
    expect(set).toHaveBeenCalledWith({ target: 'GUARDIANS' });
  });

  it("a tab never carries another tab's values into its query", () => {
    const state = f({ target: 'GUARDIANS', examId: EXAM, shift: 'Morning', classId: 'c1' });
    expect(audienceQuery('feeDue', state, 1, 25)).not.toHaveProperty('examId');
    expect(audienceQuery('feeDue', state, 1, 25)).not.toHaveProperty('shift');
    expect(audienceQuery('examFailed', state, 1, 25)).not.toHaveProperty('shift');
    expect(audienceQuery('orgGroup', state, 1, 25)).not.toHaveProperty('examId');
    // The class tabs keep their own target and ignore the advanced one.
    expect(audienceQuery('students', state, 1, 25).target).toBe(AudienceTarget.STUDENTS);
  });
});

describe('stale org values', () => {
  it('clears a shift that left the vocabulary', async () => {
    server.use(
      http.get('/api/v1/classes/vocabulary', () =>
        HttpResponse.json({ shifts: ['Day'], versions: [], groups: [] }),
      ),
    );
    const set = vi.fn();
    function Probe() {
      useAudienceTabs(false, f({ shift: 'Morning' }), set);
      return null;
    }
    renderWithRouter(createRootRoute({ component: Probe }), { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' });
    await waitFor(() => expect(set).toHaveBeenCalledWith({ shift: null }));
  });
});

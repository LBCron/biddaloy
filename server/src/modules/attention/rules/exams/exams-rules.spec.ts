import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, AlertSeverity, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import { ExamsMarksOverdueRule } from './exams-marks-overdue.rule';
import { ExamsMyMarksDueRule } from './exams-my-marks-due.rule';
import { ExamsResultsUnpublishedRule } from './exams-results-unpublished.rule';
import { ExamsScheduleUnpublishedRule } from './exams-schedule-unpublished.rule';
import { ExamsSeatPlanMissingRule } from './exams-seat-plan-missing.rule';

const EXEC = { userId: 'u1', role: UserRole.EXECUTIVE };

const ctx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  tenantId: 't1',
  now: new Date('2026-10-10T04:00:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '10:00',
  isWorkingDay: true,
  settings: {} as RuleContext['settings'],
  ...extra,
});

/** Routes each query by its SQL: recipients, teachers, or "the" rule query. */
function ds(rows: unknown[], teachers: unknown[] = [], coordinators: unknown[] = []) {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    // [83.2.4] First: the coordinator query also mentions user_tenants (in an EXISTS).
    if (sql.includes('FROM coordinator_assignments')) return coordinators;
    if (sql.includes('FROM user_tenants')) return [EXEC];
    if (sql.includes('FROM teacher_class_sections')) return teachers;
    return rows;
  });
  return { query };
}

const grid = (over: Record<string, unknown> = {}) => ({
  examId: 'E',
  examName: 'Term 1',
  classId: 'C7',
  className: 'Seven',
  lastDate: '2026-10-02',
  sectionId: 'S1',
  sectionLabel: 'Seven-A',
  subjectId: 'SUB',
  ...over,
});

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('exams rules: shared contract', () => {
  const rules = [
    ['exams.marks_overdue', new ExamsMarksOverdueRule(ds([]) as never)],
    ['exams.my_marks_due', new ExamsMyMarksDueRule(ds([]) as never)],
    ['exams.results_unpublished', new ExamsResultsUnpublishedRule(ds([]) as never)],
    ['exams.schedule_unpublished', new ExamsScheduleUnpublishedRule(ds([]) as never)],
    ['exams.seat_plan_missing', new ExamsSeatPlanMissingRule(ds([]) as never)],
  ] as const;

  for (const [key, rule] of rules) {
    it(`${key}: meta, matching bn/en placeholders, at most 3 steps`, () => {
      expect(rule.meta).toEqual(alertRuleMeta(key));
      const { en, bn } = rule.messages;
      expect(placeholders(en.title + en.why)).toEqual(placeholders(bn.title + bn.why));
      expect(en.steps.length).toBeLessThanOrEqual(3);
      expect(bn.steps).toHaveLength(en.steps.length);
    });
  }
});

describe('ExamsMarksOverdueRule', () => {
  const run = (rows: unknown[], c = ctx()) =>
    new ExamsMarksOverdueRule(ds(rows) as never).evaluate(c);

  it('last sitting 8 days ago: WARNING, level 0, counts the open sheets', async () => {
    const [f] = await run([grid({ lastDate: '2026-10-02' }), grid({ sectionId: 'S2' })]);
    expect(f.severity).toBe(AlertSeverity.WARNING);
    expect(f.escalationLevel).toBe(0);
    expect(f.params).toEqual({ exam: 'Term 1', className: 'Seven', outstanding: 2, days: 8 });
    expect(f.dedupeKey).toBe('exam:E');
  });

  it('14 days: CRITICAL at escalation level 1', async () => {
    const [f] = await run([grid({ lastDate: '2026-09-26' })]);
    expect(f.severity).toBe(AlertSeverity.CRITICAL);
    expect(f.escalationLevel).toBe(1);
  });

  it('asks SQL for the tenant-local date (not UTC) minus the grace period', async () => {
    // 18:00Z on the 9th is already the 10th in Dhaka.
    const d = ds([grid()]);
    await new ExamsMarksOverdueRule(d as never).evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z'), localDate: '2026-10-10' }),
    );
    expect(d.query.mock.calls[0][1]).toEqual(['t1', '2026-10-03']);
  });

  it('nothing outstanding: silent', async () => {
    expect(await run([])).toEqual([]);
  });

  // [83.2.4] D6: the class coordinator and the matching subject coordinator join; a coordinator
  // of another subject or another class does not.
  it('adds coordinators of the exam class: class-level and the open subject only', async () => {
    const coords = [
      { userId: 'class-coord', classId: 'C7', subjectId: null },
      { userId: 'maths-coord', classId: 'C7', subjectId: 'SUB' },
      { userId: 'bangla-coord', classId: 'C7', subjectId: 'BAN' },
      { userId: 'other-class', classId: 'C8', subjectId: null },
    ];
    const [f] = await new ExamsMarksOverdueRule(ds([grid()], [], coords) as never).evaluate(ctx());
    const ids = f.recipients.map((r) => r.userId);
    expect(ids).toContain('class-coord');
    expect(ids).toContain('maths-coord');
    expect(ids).not.toContain('bangla-coord');
    expect(ids).not.toContain('other-class');
    expect(f.dedupeKey).toBe('exam:E');
  });
});

describe('ExamsMyMarksDueRule', () => {
  const T = { sectionId: 'S1', subjectId: 'SUB', userId: 'teacher1' };
  const run = (rows: unknown[], teachers: unknown[]) =>
    new ExamsMyMarksDueRule(ds(rows, teachers) as never).evaluate(ctx());

  it('one grid: deep link to that grid, one TEACHER recipient, section params', async () => {
    const [f] = await run([grid()], [T]);
    expect(f.actionUrl).toBe('/marks/E/S1/SUB');
    expect(f.recipients).toEqual([{ userId: 'teacher1', role: UserRole.TEACHER }]);
    expect(f.params).toMatchObject({ count: 1, sectionId: 'S1', sectionLabel: 'Seven-A' });
    expect(f.dedupeKey).toBe('exam:E:teacher:teacher1');
  });

  it('two grids in two sections: /marks and no sectionId', async () => {
    const rows = [grid(), grid({ sectionId: 'S2', sectionLabel: 'Seven-B' })];
    const [f] = await run(rows, [T, { ...T, sectionId: 'S2' }]);
    expect(f.actionUrl).toBe('/marks');
    expect(f.params.count).toBe(2);
    expect(f.params).not.toHaveProperty('sectionId');
  });

  it('a grid with no subject teacher produces no finding', async () => {
    expect(await run([grid()], [])).toEqual([]);
  });

  it('7+ days since the exam is CRITICAL', async () => {
    const [f] = await run([grid({ lastDate: '2026-10-03' })], [T]);
    expect(f.severity).toBe(AlertSeverity.CRITICAL);
  });
});

describe('ExamsResultsUnpublishedRule', () => {
  it('one finding per processed exam', async () => {
    const rows = [{ id: 'E', name: 'Term 1', class_name: 'Seven' }];
    const [f] = await new ExamsResultsUnpublishedRule(ds(rows) as never).evaluate(ctx());
    expect(f.params).toEqual({ exam: 'Term 1', className: 'Seven' });
    expect(f.actionUrl).toBe('/results');
  });
});

describe('ExamsScheduleUnpublishedRule', () => {
  const row = (unscheduled: number) => [
    { id: 'E', name: 'Term 1', class_name: 'Seven', first_date: '2026-10-15', unscheduled },
  ];

  it('complete schedule (unscheduled 0): silent', async () => {
    expect(await new ExamsScheduleUnpublishedRule(ds(row(0)) as never).evaluate(ctx())).toEqual([]);
  });

  it('unscheduled subjects fire with a 14-day window', async () => {
    const d = ds(row(2));
    const [f] = await new ExamsScheduleUnpublishedRule(d as never).evaluate(ctx());
    expect(f.params).toMatchObject({ unscheduled: 2, firstDate: '2026-10-15' });
    expect(d.query.mock.calls[0][1]).toEqual(['t1', '2026-10-10', '2026-10-24']);
  });
});

describe('ExamsSeatPlanMissingRule', () => {
  it('looks at the next 3 days (tenant-local) and reports sittings', async () => {
    const d = ds([
      { id: 'E', name: 'Term 1', class_name: 'Seven', sittings: 3, first_date: '2026-10-11' },
    ]);
    const [f] = await new ExamsSeatPlanMissingRule(d as never).evaluate(ctx());
    expect(d.query.mock.calls[0][1]).toEqual(['t1', '2026-10-10', '2026-10-13']);
    expect(f.params).toMatchObject({ sittings: 3, firstDate: '2026-10-11' });
    expect(f.actionUrl).toBe('/exams/seat-plans');
  });
});

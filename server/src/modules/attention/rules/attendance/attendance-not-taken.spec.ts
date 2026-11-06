import { describe, it, expect, vi } from 'vitest';
import { alertRuleMeta, AlertSeverity, UserRole } from '@biddaloy/shared';
import type { RuleContext } from '../rule.types';
import {
  AttendanceNotTakenRule,
  attendanceStep,
  dayRegisterTeachers,
  sectionCutoff,
  toMinutes,
} from './attendance-not-taken.rule';

describe('toMinutes', () => {
  it('reads HH:mm and Postgres time', () => {
    expect(toMinutes('08:00')).toBe(480);
    expect(toMinutes('08:00:00')).toBe(480);
  });
});

describe('attendanceStep (first period 08:00, grace 15, cutoff 10:00)', () => {
  const step = (t: string, heads = true, cutoff = '10:00') =>
    attendanceStep(t, '08:00', 15, cutoff, heads);

  it('walks the ladder', () => {
    expect(step('07:59')).toBe('BEFORE_START');
    expect(step('08:00')).toBe('LEVEL_0');
    expect(step('08:14')).toBe('LEVEL_0');
    expect(step('08:15')).toMatchObject({ level: 1, severity: AlertSeverity.WARNING });
    expect(step('09:59')).toMatchObject({ level: 1 });
    expect(step('10:00')).toMatchObject({
      level: 2,
      severity: AlertSeverity.CRITICAL,
      addRoles: [UserRole.EXECUTIVE, UserRole.ADMIN],
    });
  });

  it('level 2 adds nobody when heads escalation is off', () => {
    expect(step('10:00', false)).toMatchObject({ level: 2, addRoles: [] });
  });

  it('a cutoff before the first period means level 2 from the first bell', () => {
    expect(step('08:00', true, '07:30')).toMatchObject({ level: 2 });
  });
});

describe('sectionCutoff (school cutoff 10:00, earliest first bell 08:00)', () => {
  it('a section that starts before the cutoff keeps the school cutoff', () => {
    expect(sectionCutoff('10:00', 0, '08:00', '08:00')).toBe('10:00');
    expect(sectionCutoff('10:00', 0, '09:30', '08:00')).toBe('10:00');
  });
  it('a later-shift section with no times of its own keeps the same 2h gap from its own bell', () => {
    expect(sectionCutoff('10:00', 0, '12:30', '08:00')).toBe('14:30');
  });
  it('a shift with its own times moves the school cutoff by its lateAfter offset', () => {
    // school lateAfter 09:00, shift lateAfter 12:45 -> +225 min
    expect(sectionCutoff('10:00', 225, '12:30', '08:00')).toBe('13:45');
    // shift times that copy the school's: the school cutoff, not the earlier absentAfter
    expect(sectionCutoff('11:00', 0, '08:00', '08:00')).toBe('11:00');
  });
  it('a shift whose moved cutoff is not after its first bell keeps the gap from that bell', () => {
    expect(sectionCutoff('10:00', 60, '12:30', '08:00')).toBe('14:30');
  });
  it('a cutoff before every first bell stays as it is (level 2 from the bell)', () => {
    expect(sectionCutoff('07:30', 0, '08:00', '08:00')).toBe('07:30');
  });
});

describe('dayRegisterTeachers (D22)', () => {
  const CT = { teacherId: 'CT', staffProfileId: 'sp-CT' };
  const AT = { teacherId: 'AT', staffProfileId: 'sp-AT' };
  const run = (over: Partial<Parameters<typeof dayRegisterTeachers>[0]>) =>
    dayRegisterTeachers({
      classTeachers: [CT],
      assistants: [AT],
      onLeaveStaffProfileIds: new Set(),
      substituteTeacherIdsFor: (id) => (id === 'CT' ? ['SUB'] : []),
      ...over,
    });

  it('the class teacher alone when present', () => {
    expect(run({})).toEqual(['CT']);
  });
  it('class teacher on leave: assistants and substitutes, not the class teacher', () => {
    expect(run({ onLeaveStaffProfileIds: new Set(['sp-CT']) }).sort()).toEqual(['AT', 'SUB']);
  });
  it('assistant also on leave: only the substitute', () => {
    expect(run({ onLeaveStaffProfileIds: new Set(['sp-CT', 'sp-AT']) })).toEqual(['SUB']);
  });
  it('no class teacher row: the assistants', () => {
    expect(run({ classTeachers: [] })).toEqual(['AT']);
  });
});

// ---- evaluate ----------------------------------------------------------
const ctx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  tenantId: 't1',
  now: new Date('2026-10-10T02:20:00Z'),
  tz: 'Asia/Dhaka',
  localDate: '2026-10-10',
  localTime: '08:20',
  isWorkingDay: true,
  settings: {
    attendanceGraceMinutes: 15,
    escalateAttendanceToHeads: true,
  } as RuleContext['settings'],
  ...extra,
});

interface Fx {
  perPeriod?: boolean;
  sessions?: unknown[];
  slots?: unknown[];
  coordinators?: unknown[];
  unmarked?: number;
}
function build(f: Fx = {}) {
  const query = vi.fn(async (sql: string) => {
    // [83.2.4] Before the user_tenants route: the coordinator query has one in an EXISTS.
    if (sql.includes('FROM coordinator_assignments')) return f.coordinators ?? [];
    if (sql.includes('FROM students st')) return [{ section_id: 'S1', unmarked: f.unmarked ?? 0 }];
    if (sql.includes('FROM class_sections cs')) return [{ id: 'S1', class_id: 'C1', label: '7-B' }];
    if (sql.includes('calendar_events')) return [];
    if (sql.includes('FROM attendance_sessions')) return f.sessions ?? [];
    if (sql.includes('FROM teacher_class_sections'))
      return [
        {
          section_id: 'S1',
          assignment_type: 'CLASS_TEACHER',
          teacher_id: 'CT',
          staff_profile_id: 'sp-CT',
          user_id: 'u-CT',
        },
      ];
    if (sql.includes('FROM leave_records')) return [];
    if (sql.includes('FROM period_slots'))
      return [
        { id: 'p1', sequence: 1, name: null },
        { id: 'p2', sequence: 2, name: null },
      ];
    if (sql.includes('FROM teachers te'))
      return [
        { id: 'T2', user_id: 'u-T2' },
        { id: 'SUB', user_id: 'u-SUB' },
      ];
    if (sql.includes('FROM user_tenants')) return [{ userId: 'head', role: UserRole.ADMIN }];
    return [];
  });
  const slot = (period: string, extra = {}) => ({
    section_id: 'S1',
    period_slot_id: period,
    // The resolver fills the dated times on each slot, as `HH:mm:ss`.
    starts_at: period === 'p1' ? '08:00:00' : '09:00:00',
    ends_at: period === 'p1' ? '08:40:00' : '09:40:00',
    subject_id: 'sub',
    teacher_ids: ['T2'],
    substituted: false,
    cancelled: false,
    ...extra,
  });
  const resolveTenantDay = vi.fn(async () => f.slots ?? [slot('p1')]);
  const schools = {
    getResolvedSettings: vi.fn(async () => ({
      attendance: {
        lateAfter: '09:00',
        autoAbsentNotification: { enabled: true, cutoffTime: '10:00' },
        periodAttendance: { enabled: f.perPeriod ?? false },
      },
    })),
  };
  const rule = new AttendanceNotTakenRule(
    { query } as never,
    schools as never,
    { resolveTenantDay } as never,
  );
  return { rule, query, resolveTenantDay, slot };
}

describe('AttendanceNotTakenRule', () => {
  it('meta, bn/en placeholders match, at most 3 steps', () => {
    const { rule } = build();
    expect(rule.meta).toEqual(alertRuleMeta('attendance.not_taken'));
    const all = (m: (typeof rule.messages)['en']) => [m.title, m.why, ...m.steps].join(' ');
    const names = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1].replace(/_(en|bn)$/, '')).sort();
    expect(names(all(rule.messages.en))).toEqual(names(all(rule.messages.bn)));
    expect(rule.messages.en.steps.length).toBeLessThanOrEqual(3);
  });

  it('non-working day: nothing, and no query runs', async () => {
    const { rule, query } = build();
    expect(await rule.evaluate(ctx({ isWorkingDay: false }))).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('local-midnight edge: before the first period nothing; at 08:20 a WARNING that expires at Dhaka midnight', async () => {
    const { rule, resolveTenantDay } = build();
    const before = await rule.evaluate(
      ctx({ now: new Date('2026-10-09T18:00:00Z'), localTime: '00:00' }),
    );
    expect(before).toEqual([]);
    expect(resolveTenantDay).toHaveBeenCalledWith('t1', '2026-10-10');

    const [finding] = await rule.evaluate(ctx());
    expect(finding.dedupeKey).toBe('section:S1:2026-10-10');
    expect(finding.severity).toBe(AlertSeverity.WARNING);
    expect(finding.expiresAt?.toISOString()).toBe('2026-10-10T18:00:00.000Z');
    expect(finding.recipients).toEqual([{ userId: 'u-CT', role: UserRole.TEACHER }]);
  });

  it('after the cutoff the tenant heads are added at CRITICAL', async () => {
    const { rule } = build();
    const [finding] = await rule.evaluate(ctx({ localTime: '10:05' }));
    expect(finding.severity).toBe(AlertSeverity.CRITICAL);
    expect(finding.escalationLevel).toBe(2);
    expect(finding.recipients.map((r) => r.userId).sort()).toEqual(['head', 'u-CT']);
  });

  describe('unmarked students (76.2.05)', () => {
    const finalized = [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }];
    const open = [{ section_id: 'S1', period_no: null, state: 'DRAFT' }];

    it('12 unmarked after grace on an open register: WARNING with the incomplete title', async () => {
      const { rule } = build({ sessions: open, unmarked: 12 });
      const [f] = await rule.evaluate(ctx());
      expect(f.severity).toBe(AlertSeverity.WARNING);
      expect(f.dedupeKey).toBe('section:S1:2026-10-10');
      expect(f.params.title_en).toBe('Attendance incomplete: 7-B — 12 without status');
      expect(f.params.title_bn).toBe('হাজিরা অসম্পূর্ণ: 7-B — 12 জনের অবস্থা নেই');
    });

    it('finalized register with unmarked students still fires; 0 unmarked does not', async () => {
      const [f] = await build({ sessions: finalized, unmarked: 3 }).rule.evaluate(ctx());
      expect(f.params.title_en).toContain('incomplete');
      expect(await build({ sessions: finalized, unmarked: 0 }).rule.evaluate(ctx())).toEqual([]);
    });

    it('no session: the old title, ladder unchanged (CRITICAL after cutoff)', async () => {
      const { rule } = build({ unmarked: 30 });
      const [f] = await rule.evaluate(ctx({ localTime: '10:05' }));
      expect(f.params.title_en).toBe('Attendance not taken: 7-B');
      expect(f.severity).toBe(AlertSeverity.CRITICAL);
    });
  });

  // [83.2.4] D7: a class coordinator of the section's class joins at level 1, not before;
  // subject coordinators and coordinators of other classes never do. Dedupe key unchanged (D26).
  describe('coordinators (83.2.4)', () => {
    const coordinators = [
      { userId: 'u-COORD', classId: 'C1', subjectId: null },
      { userId: 'u-MATHS', classId: 'C1', subjectId: 'MATHS' },
      { userId: 'u-OTHER', classId: 'C9', subjectId: null },
    ];

    it('level 0 (REMINDER, inside grace): not a recipient yet', async () => {
      const { rule } = build({ coordinators });
      const [finding] = await rule.evaluate(ctx({ localTime: '08:05' }));
      expect(finding.escalationLevel).toBe(0);
      expect(finding.recipients.map((r) => r.userId)).toEqual(['u-CT']);
    });

    it('level 1 (WARNING): the class coordinator joins; heads do not', async () => {
      const { rule } = build({ coordinators });
      const [finding] = await rule.evaluate(ctx());
      expect(finding.escalationLevel).toBe(1);
      expect(finding.recipients).toEqual([
        { userId: 'u-CT', role: UserRole.TEACHER },
        { userId: 'u-COORD', role: UserRole.TEACHER },
      ]);
      expect(finding.dedupeKey).toBe('section:S1:2026-10-10');
    });

    it('a late period register (level 1) reaches the class coordinator; an on-time one does not', async () => {
      const late = build({
        coordinators,
        perPeriod: true,
        sessions: [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }],
        slots: [build().slot('p2')],
      });
      const [f] = await late.rule.evaluate(ctx({ localTime: '09:20' }));
      expect(f.escalationLevel).toBe(1);
      expect(f.recipients.map((r) => r.userId)).toEqual(['u-T2', 'u-COORD']);
      const [g] = await late.rule.evaluate(ctx({ localTime: '09:05' }));
      expect(g.recipients.map((r) => r.userId)).toEqual(['u-T2']);
    });

    it('a late period with no resolved teacher still reaches the class coordinator', async () => {
      const unresolved = build({
        coordinators,
        perPeriod: true,
        sessions: [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }],
        slots: [build().slot('p2', { teacher_ids: [] })],
      });
      const [f] = await unresolved.rule.evaluate(ctx({ localTime: '09:20' }));
      expect(f.escalationLevel).toBe(1);
      expect(f.recipients.map((r) => r.userId)).toEqual(['u-COORD']);
    });

    it('level 2 (CRITICAL): coordinator and heads both', async () => {
      const { rule } = build({ coordinators });
      const [finding] = await rule.evaluate(ctx({ localTime: '10:05' }));
      expect(finding.recipients.map((r) => r.userId).sort()).toEqual(['head', 'u-COORD', 'u-CT']);
    });
  });

  it('a FINALIZED day session clears the day finding', async () => {
    const { rule } = build({
      sessions: [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }],
    });
    expect(await rule.evaluate(ctx())).toEqual([]);
  });

  it('per-period: an unfinalized period 2 at 09:20 warns its teacher; a substitute replaces the teacher', async () => {
    const plain = build({
      perPeriod: true,
      sessions: [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }],
      slots: [build().slot('p2')],
    });
    const [f] = await plain.rule.evaluate(ctx({ localTime: '09:20' }));
    expect(f.dedupeKey).toBe('section:S1:2026-10-10:p2');
    expect(f.severity).toBe(AlertSeverity.WARNING);
    expect(f.recipients).toEqual([{ userId: 'u-T2', role: UserRole.TEACHER }]);

    const covered = build({
      perPeriod: true,
      sessions: [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }],
      slots: [
        build().slot('p2', {
          substituted: true,
          substitute_teacher_id: 'SUB',
          teacher_ids: ['SUB'],
        }),
      ],
    });
    const [g] = await covered.rule.evaluate(ctx({ localTime: '09:20' }));
    expect(g.recipients).toEqual([{ userId: 'u-SUB', role: UserRole.TEACHER }]);
  });

  // The resolver's `HH:mm:ss` against `localTime`'s `HH:mm`: period 2 is due
  // at 09:00 itself, not one tick later.
  it('per-period: a period is due in its first minute', async () => {
    const { rule } = build({
      perPeriod: true,
      sessions: [{ section_id: 'S1', period_no: null, state: 'FINALIZED' }],
      slots: [build().slot('p2')],
    });
    const [f] = await rule.evaluate(ctx({ localTime: '09:00' }));
    expect(f?.dedupeKey).toBe('section:S1:2026-10-10:p2');
    expect(f.severity).toBe(AlertSeverity.REMINDER);
  });

  // #2290: a special timing moved period 1 to 08:30 today; the day register's
  // first bell follows it.
  it('a special timing moves the first bell of the day register', async () => {
    const { rule } = build({
      slots: [build().slot('p1', { starts_at: '08:30:00', ends_at: '09:05:00' })],
    });
    expect(await rule.evaluate(ctx({ localTime: '08:20' }))).toEqual([]);
    const [f] = await rule.evaluate(ctx({ localTime: '08:30' }));
    expect(f.params).toMatchObject({ startsAt: '08:30' });
  });
});

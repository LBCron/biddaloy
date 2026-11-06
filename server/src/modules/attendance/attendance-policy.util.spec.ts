import { describe, it, expect, vi, afterEach } from 'vitest';
import { AttendanceStatus } from '@biddaloy/shared';
import type { AttendancePolicySettings, TenantSettings } from '@biddaloy/shared';
import { resolveTenantSettings } from '../schools/settings/tenant-settings-resolver';
import {
  classifyCheckIn,
  policyForShift,
  specialTimingOn,
  periodTimesOn,
  daysBetween,
  isWeeklyOff,
  localDate,
  localToday,
  resolveAttendancePolicy,
} from './attendance-policy.util';

const POLICY: AttendancePolicySettings = {
  weeklyOffDays: [5], // Friday, matching Bangladesh's default weekend
  lateAfter: '08:15',
  absentAfter: '10:00',
  correctionWindowDays: 2,
  lowAttendanceThresholdPercent: 75,
  lateCountsAsPresent: true,
  leaveCountsAsWorkingDay: false,
  percentageDenominator: 'WORKING_DAYS',
  allowFutureDates: false,
  autoAbsentNotification: { enabled: false, cutoffTime: '11:00' },
};

describe('resolveAttendancePolicy', () => {
  it('carries dailySource: ANY for an unset school, the stored value otherwise', () => {
    expect(resolveAttendancePolicy(resolveTenantSettings(null)).dailySource).toBe('ANY');
    const set = resolveTenantSettings({ attendance: { dailySource: 'DEVICE' } });
    expect(policyForShift(resolveAttendancePolicy(set), null).dailySource).toBe('DEVICE');
  });

  it('returns the resolved attendance settings', () => {
    const settings: TenantSettings = { version: 1, attendance: POLICY };
    expect(resolveAttendancePolicy(settings)).toBe(POLICY);
  });

  it('throws when handed a settings object with no resolved attendance section', () => {
    const settings: TenantSettings = { version: 1 };
    expect(() => resolveAttendancePolicy(settings)).toThrow(/has no resolved attendance policy/);
  });
});

describe('isWeeklyOff', () => {
  // 2026-09-04 is a Friday; walking each day of that week covers all 7
  // weekdays against the same Friday-off policy.
  const days: Record<string, string> = {
    Sunday: '2026-08-30',
    Monday: '2026-08-31',
    Tuesday: '2026-09-01',
    Wednesday: '2026-09-02',
    Thursday: '2026-09-03',
    Friday: '2026-09-04',
    Saturday: '2026-09-05',
  };

  it('is true only for the configured weekly off day (Friday)', () => {
    for (const [name, dateIso] of Object.entries(days)) {
      expect(isWeeklyOff(dateIso, POLICY)).toBe(name === 'Friday');
    }
  });

  it('respects a different weekly off configuration (Saturday+Sunday)', () => {
    const weekendPolicy: AttendancePolicySettings = { ...POLICY, weeklyOffDays: [0, 6] };
    expect(isWeeklyOff(days.Sunday, weekendPolicy)).toBe(true);
    expect(isWeeklyOff(days.Saturday, weekendPolicy)).toBe(true);
    expect(isWeeklyOff(days.Monday, weekendPolicy)).toBe(false);
  });
});

describe('isWeeklyOff history (TIME-02)', () => {
  const h = (history: Array<{ until: string; days: number[] }>): AttendancePolicySettings => ({
    ...POLICY,
    weeklyOffDays: [5],
    weeklyOffHistory: history,
  });
  const SAT = '2025-03-08';
  it('uses the history entry for a date before until', () => {
    expect(isWeeklyOff(SAT, h([{ until: '2026-10-11', days: [5, 6] }]))).toBe(true);
  });
  it('uses the current days on and after until', () => {
    expect(isWeeklyOff('2026-10-17', h([{ until: '2026-10-11', days: [5, 6] }]))).toBe(false);
    expect(isWeeklyOff('2026-10-11', h([{ until: '2026-10-11', days: [0] }]))).toBe(false);
  });
  it('with two entries, picks the earliest one whose until is after the date', () => {
    const p = h([
      { until: '2025-01-01', days: [0] },
      { until: '2026-01-01', days: [6] },
    ]);
    expect(isWeeklyOff(SAT, p)).toBe(true);
    expect(isWeeklyOff('2024-12-29', p)).toBe(true);
  });
  it('no history gives current days', () => {
    expect(isWeeklyOff(SAT, { ...POLICY, weeklyOffDays: [5] })).toBe(false);
  });
});

describe('localToday', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the tenant-local calendar date, which can differ from UTC', () => {
    // 2026-09-04T19:00Z is 2026-09-05 01:00 in Asia/Dhaka (UTC+6) — already
    // the next calendar day locally.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T19:00:00Z'));

    expect(localToday('Asia/Dhaka')).toBe('2026-09-05');
    expect(localToday('UTC')).toBe('2026-09-04');
  });
});

describe('localDate', () => {
  it('resolves an arbitrary instant to its tenant-local calendar date', () => {
    const instant = new Date('2026-09-04T19:00:00Z');
    expect(localDate(instant, 'Asia/Dhaka')).toBe('2026-09-05');
    expect(localDate(instant, 'UTC')).toBe('2026-09-04');
  });
});

describe('daysBetween', () => {
  it('is 0 for the same date', () => {
    expect(daysBetween('2026-09-04', '2026-09-04')).toBe(0);
  });

  it('is positive when the second date is later', () => {
    expect(daysBetween('2026-09-01', '2026-09-04')).toBe(3);
  });

  it('is negative when the second date is earlier', () => {
    expect(daysBetween('2026-09-04', '2026-09-01')).toBe(-3);
  });
});

describe('classifyCheckIn', () => {
  const timezone = 'Asia/Dhaka';

  it('is PRESENT at or before lateAfter', () => {
    const result = classifyCheckIn(
      new Date('2026-09-04T02:00:00Z'), // 08:00 local
      '2026-09-04',
      POLICY,
      timezone,
    );
    expect(result).toEqual({ status: AttendanceStatus.PRESENT, minutesLate: null });
  });

  it('is LATE between lateAfter and absentAfter, with the correct minutesLate', () => {
    const result = classifyCheckIn(
      new Date('2026-09-04T02:30:00Z'), // 08:30 local — 15 minutes after 08:15
      '2026-09-04',
      POLICY,
      timezone,
    );
    expect(result).toEqual({ status: AttendanceStatus.LATE, minutesLate: 15 });
  });

  it('is ABSENT after absentAfter', () => {
    const result = classifyCheckIn(
      new Date('2026-09-04T04:30:00Z'), // 10:30 local
      '2026-09-04',
      POLICY,
      timezone,
    );
    expect(result).toEqual({ status: AttendanceStatus.ABSENT, minutesLate: null });
  });
});

describe('policyForShift', () => {
  const SHIFT = '6b1f3c1e-5d2a-4c8e-9a47-1f2e3d4c5b6a';
  const withShift: AttendancePolicySettings = {
    ...POLICY,
    shiftTimes: [{ shiftId: SHIFT, lateAfter: '12:15', absentAfter: '14:00' }],
  };

  it('returns the policy unchanged for no shift id or an unknown one', () => {
    expect(policyForShift(withShift, null)).toBe(withShift);
    expect(policyForShift(withShift, undefined)).toBe(withShift);
    expect(policyForShift(withShift, 'other')).toBe(withShift);
    expect(policyForShift(POLICY, SHIFT)).toBe(POLICY);
  });

  it('applies the matching entry without mutating the input', () => {
    const result = policyForShift(withShift, SHIFT);
    expect(result).toMatchObject({ lateAfter: '12:15', absentAfter: '14:00', weeklyOffDays: [5] });
    expect(withShift.lateAfter).toBe('08:15');
  });

  it('classifyCheckIn with a day-shift policy: 12:20 LATE, 08:30 PRESENT', () => {
    const p = policyForShift(withShift, SHIFT);
    const tz = 'Asia/Dhaka';
    expect(classifyCheckIn(new Date('2026-09-04T06:20:00Z'), '2026-09-04', p, tz).status).toBe(
      AttendanceStatus.LATE,
    );
    expect(classifyCheckIn(new Date('2026-09-04T02:30:00Z'), '2026-09-04', p, tz).status).toBe(
      AttendanceStatus.PRESENT,
    );
  });
});

describe('special timings', () => {
  const SHIFT = '6b1f3c1e-5d2a-4c8e-9a47-1f2e3d4c5b6a';
  const all = {
    name: 'Ramadan',
    from: '2027-02-08',
    to: '2027-03-09',
    shiftId: null,
    lateAfter: '08:45',
    absentAfter: '09:30',
    periods: [{ sequence: 1, startsAt: '08:30', endsAt: '09:05' }],
  };
  const own = { ...all, name: 'Day', shiftId: SHIFT, lateAfter: '12:45', absentAfter: '13:30' };
  const policy: AttendancePolicySettings = { ...POLICY, specialTimings: [all, own] };
  const period = { shift_id: SHIFT, sequence: 1, starts_at: '08:00:00', ends_at: '08:45:00' };

  it('specialTimingOn: inside, on both edges, outside', () => {
    expect(specialTimingOn(policy, null, '2027-02-20')).toBe(all);
    expect(specialTimingOn(policy, null, '2027-02-08')).toBe(all);
    expect(specialTimingOn(policy, null, '2027-03-09')).toBe(all);
    expect(specialTimingOn(policy, null, '2027-02-07')).toBeNull();
    expect(specialTimingOn(policy, null, '2027-03-10')).toBeNull();
  });

  it("specialTimingOn: shift entry beats all-shifts; other shift's entry ignored", () => {
    expect(specialTimingOn(policy, SHIFT, '2027-02-20')).toBe(own);
    expect(specialTimingOn(policy, 'other', '2027-02-20')).toBe(all);
    expect(specialTimingOn({ ...POLICY, specialTimings: [own] }, 'other', '2027-02-20')).toBeNull();
  });

  it('policyForShift: special cut-offs in range, old result without a date', () => {
    expect(policyForShift(policy, null, '2027-02-20')).toMatchObject({
      lateAfter: '08:45',
      absentAfter: '09:30',
    });
    expect(policyForShift(policy, null)).toBe(policy);
    expect(policyForShift(policy, null, '2027-04-01')).toBe(policy);
  });

  it('periodTimesOn: listed sequence overridden with :00, unlisted untouched', () => {
    const own1 = { ...own, periods: all.periods };
    expect(periodTimesOn({ ...POLICY, specialTimings: [own1] }, period, '2027-02-20')).toEqual({
      starts_at: '08:30:00',
      ends_at: '09:05:00',
    });
    expect(periodTimesOn(policy, { ...period, sequence: 2 }, '2027-02-20')).toEqual({
      starts_at: '08:00:00',
      ends_at: '08:45:00',
    });
    expect(periodTimesOn(policy, period, '2027-04-01')).toEqual({
      starts_at: '08:00:00',
      ends_at: '08:45:00',
    });
  });

  // Business-critical: in a two-shift school an "all shifts" Ramadan entry
  // (morning clock times) must not mark an on-time day-shift scan ABSENT.
  it('all-shifts entry does not override a shift that has its own shiftTimes', () => {
    const twoShift: AttendancePolicySettings = {
      ...POLICY,
      shiftTimes: [{ shiftId: SHIFT, lateAfter: '12:15', absentAfter: '14:00' }],
      specialTimings: [all],
    };
    expect(specialTimingOn(twoShift, SHIFT, '2027-02-20')).toBeNull();
    expect(policyForShift(twoShift, SHIFT, '2027-02-20')).toMatchObject({
      lateAfter: '12:15',
      absentAfter: '14:00',
    });
    expect(periodTimesOn(twoShift, period, '2027-02-20')).toEqual({
      starts_at: '08:00:00',
      ends_at: '08:45:00',
    });
    // A day-shift scan at 12:20 local is LATE, not ABSENT.
    const p = policyForShift(twoShift, SHIFT, '2027-02-20');
    expect(
      classifyCheckIn(new Date('2027-02-20T06:20:00Z'), '2027-02-20', p, 'Asia/Dhaka').status,
    ).toBe(AttendanceStatus.LATE);
    // Shifts without their own times, and staff (null), still take the entry.
    expect(specialTimingOn(twoShift, 'other', '2027-02-20')).toBe(all);
    expect(specialTimingOn(twoShift, null, '2027-02-20')).toBe(all);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DeviceAbsentSweepScheduler,
  DEVICE_ABSENT_SWEEP_JOB_ID,
  DEVICE_ABSENT_SWEEP_INTERVAL_MS,
} from './device-absent-sweep.scheduler';
import { DailyAttendanceSource } from '@biddaloy/shared';

vi.mock('./attendance-policy.util', async (orig) => ({
  ...(await orig<typeof import('./attendance-policy.util')>()),
  localTimeHHmm: () => '12:00',
}));

const settings = (dailySource: DailyAttendanceSource, absentAfter = '11:00') => ({
  region: { timezone: 'Asia/Dhaka' },
  attendance: { dailySource, lateAfter: '00:00', absentAfter, weeklyOffDays: [] },
});

describe('DeviceAbsentSweepScheduler', () => {
  let queue: any;
  let dataSource: any;
  let schoolsService: any;
  let calendar: any;
  let scheduler: DeviceAbsentSweepScheduler;
  let sweepSection: ReturnType<typeof vi.fn>;

  function build(s: any, scans = 1) {
    queue = { upsertJobScheduler: vi.fn(async () => undefined) };
    dataSource = {
      // 1st query = scan count, 2nd = sections
      query: vi
        .fn()
        .mockResolvedValueOnce(scans ? [{ '?column?': 1 }] : [])
        .mockResolvedValueOnce([{ id: 'sec-1', class_id: 'c-1', shift_id: null }]),
      transaction: vi.fn(async (fn: any) => fn({})),
    };
    schoolsService = {
      findAllActive: vi.fn(async () => [{ id: 't-1' }, { id: 't-2' }]),
      getResolvedSettings: vi.fn(async () => s),
    };
    calendar = { isNonWorkingDay: vi.fn(async () => false) };
    scheduler = new DeviceAbsentSweepScheduler(queue, dataSource, schoolsService, calendar, {
      record: vi.fn(),
    } as any);
    sweepSection = vi.fn(async () => 2);
    (scheduler as any).sweepSection = sweepSection;
  }

  beforeEach(() => build(settings(DailyAttendanceSource.DEVICE)));

  it('registers one repeatable job every 5 minutes', async () => {
    await scheduler.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      DEVICE_ABSENT_SWEEP_JOB_ID,
      { every: DEVICE_ABSENT_SWEEP_INTERVAL_MS },
      expect.anything(),
    );
  });

  it('does nothing for a non-DEVICE school', async () => {
    build(settings(DailyAttendanceSource.ANY));
    expect(await scheduler.sweepTenant('t-1')).toBe(0);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('does nothing on a non-working day', async () => {
    calendar.isNonWorkingDay.mockResolvedValue(true);
    expect(await scheduler.sweepTenant('t-1')).toBe(0);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('skips the school when no device scan arrived today', async () => {
    build(settings(DailyAttendanceSource.DEVICE), 0);
    expect(await scheduler.sweepTenant('t-1')).toBe(0);
    expect(sweepSection).not.toHaveBeenCalled();
  });

  it('skips a section whose shift cut-off has not passed', async () => {
    build(settings(DailyAttendanceSource.DEVICE, '13:00'));
    expect(await scheduler.sweepTenant('t-1')).toBe(0);
    expect(sweepSection).not.toHaveBeenCalled();
  });

  it('skips a section of a class on a class-scoped holiday', async () => {
    calendar.isNonWorkingDay.mockImplementation(async (a: any) => !!a.classId);
    expect(await scheduler.sweepTenant('t-1')).toBe(0);
    expect(sweepSection).not.toHaveBeenCalled();
  });

  it('uses the shift own absentAfter, not the school one', async () => {
    const s: any = settings(DailyAttendanceSource.DEVICE, '11:00');
    s.attendance.shiftTimes = [{ shiftId: 'sh-1', lateAfter: '00:00', absentAfter: '13:00' }];
    build(s);
    dataSource.query = vi
      .fn()
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ id: 'sec-1', class_id: 'c-1', shift_id: 'sh-1' }]);
    expect(await scheduler.sweepTenant('t-1')).toBe(0);
    expect(sweepSection).not.toHaveBeenCalled();
  });

  it('sweeps a section once the cut-off has passed', async () => {
    expect(await scheduler.sweepTenant('t-1')).toBe(2);
    expect(sweepSection).toHaveBeenCalledTimes(1);
  });

  it('one failing school does not stop the next', async () => {
    schoolsService.getResolvedSettings
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(settings(DailyAttendanceSource.ANY));
    await expect(scheduler.process()).resolves.toBeUndefined();
    expect(schoolsService.getResolvedSettings).toHaveBeenCalledTimes(2);
  });
});

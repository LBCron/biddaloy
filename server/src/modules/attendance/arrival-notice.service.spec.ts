import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  AttendanceStatus,
  countSmsSegments,
} from '@biddaloy/shared';
import {
  ArrivalNoticeService,
  ArrivalSkipReason,
  formatArrivalTime,
} from './arrival-notice.service';
import { ArrivalNoticeSubscription } from './entities/arrival-notice-subscription.entity';
import { AttendanceDevice } from './entities/attendance-device.entity';
import { CommunicationLog, PUSH_MEDIUM } from '../communications/entities/communication-log.entity';
import { Student } from '../students/entities/student.entity';
import { localToday } from '../../common/time';

const T = 'tenant-1';
const TODAY = localToday('Asia/Dhaka');
const AT = new Date('2026-03-02T03:05:00Z'); // 09:05 Asia/Dhaka

function guardian(over: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    full_name: 'G',
    phone: '017',
    user_id: 'u1',
    notifications_enabled: true,
    ...over,
  };
}
function sub(over: Record<string, unknown> = {}) {
  return {
    id: 'sub1',
    student_id: 's1',
    guardian_id: 'g1',
    channel: ArrivalNoticeChannel.PUSH,
    mode: ArrivalNoticeMode.RECURRING,
    lock: ArrivalNoticeLock.NONE,
    guardian: guardian(),
    ...over,
  };
}

describe('formatArrivalTime', () => {
  it('bn uses Bangla digits and a day-part word; en is HH:mm', () => {
    expect(formatArrivalTime(AT, 'Asia/Dhaka', 'bn')).toBe('সকাল ৯:০৫');
    expect(formatArrivalTime(AT, 'Asia/Dhaka', 'en')).toBe('09:05');
    expect(formatArrivalTime(new Date('2026-03-02T07:30:00Z'), 'Asia/Dhaka', 'bn')).toBe(
      'দুপুর ১:৩০',
    );
  });
});

describe('ArrivalNoticeService', () => {
  let subs: any[];
  let nameRow: Record<string, unknown> = { full_name: 'Karim' };
  let saved: any[];
  let saveError: unknown;
  let queue: { add: ReturnType<typeof vi.fn> };
  let credits: { reserveForLog: ReturnType<typeof vi.fn>; releaseForLog: ReturnType<typeof vi.fn> };
  let update: ReturnType<typeof vi.fn>;
  let failRows: unknown[]; // rows the conditional FAILED update returns (empty = a worker claimed)
  let queryCalls: unknown[][];
  let smsAllowed: boolean;
  let service: ArrivalNoticeService;

  const qb = (rows: () => any[]) => {
    const b: any = {
      innerJoinAndSelect: () => b,
      where: () => b,
      andWhere: () => b,
      getMany: async () => rows(),
    };
    return b;
  };

  beforeEach(() => {
    nameRow = { full_name: 'Karim' };
    subs = [sub()];
    saved = [];
    saveError = null;
    smsAllowed = true;
    update = vi.fn();
    failRows = [{ id: 'L' }];
    queryCalls = [];
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    credits = {
      reserveForLog: vi.fn().mockResolvedValue({ batchId: 'L', segments: 1 }),
      releaseForLog: vi.fn(),
    };
    const repos = new Map<unknown, any>([
      [ArrivalNoticeSubscription, { createQueryBuilder: () => qb(() => subs), update }],
      [
        Student,
        {
          createQueryBuilder: () =>
            qb(() => [{ id: 's1', full_name: 'Rahim', full_name_bn: 'রহিম' }]),
        },
      ],
      [AttendanceDevice, { findOne: async () => ({ name: 'Gate 1' }) }],
      [
        CommunicationLog,
        {
          create: (x: any) => ({ id: 'L', ...x }),
          query: async (...args: unknown[]) => {
            queryCalls.push(args);
            return [failRows, failRows.length];
          },
          save: async (x: any) => {
            if (saveError) throw saveError;
            saved.push({ ...x });
            return x;
          },
        },
      ],
    ]);
    const ds: any = {
      getRepository: (e: unknown) => repos.get(e),
      query: async () => [nameRow],
    };
    const schools: any = {
      getResolvedSettings: async () => ({
        region: { locale: 'bn-BD', timezone: 'Asia/Dhaka' },
        attendance: { arrivalNotice: { smsAllowed } },
      }),
    };
    service = new ArrivalNoticeService(ds, queue as any, schools, credits as any);
  });

  const call = (over: Record<string, unknown> = {}) =>
    service.sendArrivalNotices({
      tenantId: T,
      date: TODAY,
      students: [{ studentId: 's1', status: AttendanceStatus.PRESENT, occurredAt: AT }],
      takenBy: { kind: 'TEACHER', userId: 'tu' },
      ...over,
    } as any);

  it('bn school: taken_by uses the staff Bangla name when set, else the English name', async () => {
    nameRow = { full_name: 'Karim', name_bn: 'করিম' };
    await call();
    expect(saved[0].message_body).toContain('করিম');
    expect(saved[0].message_body).not.toContain('Karim');
    nameRow = { full_name: 'Karim', name_bn: null };
    await call();
    expect(saved[1].message_body).toContain('Karim');
  });

  it('a queue.add that never settles (Redis down) is cut off as ENQUEUE_FAILED', async () => {
    vi.useFakeTimers();
    queue.add.mockReturnValue(new Promise(() => {}));
    const pending = call();
    await vi.advanceTimersByTimeAsync(3100);
    const r = await pending;
    vi.useRealTimers();
    expect(r.skipped[0].reason).toBe('enqueue_failed');
  });

  it('queues one PUSH log with the dedupe key and no SMS reservation', async () => {
    const r = await call();
    expect(r.queued).toBe(1);
    expect(saved[0]).toMatchObject({
      medium: PUSH_MEDIUM,
      recipient_address: 'push:u1',
      reference_key: `arrival:${TODAY}:s1:g1`,
      metadata: { subscription_id: 'sub1' },
    });
    expect(credits.reserveForLog).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled(); // RECURRING untouched
  });

  it('teacher text says উপস্থিত; device text says পৌঁছেছে with the device name; bn <= 2 segments', async () => {
    await call();
    expect(saved[0].message_body).toContain('রহিম'); // student name (bn school uses full_name_bn)
    expect(saved[0].message_body).toContain('উপস্থিত');
    expect(saved[0].message_body).toContain('Karim');
    expect(saved[0].message_body).toMatch(/[০-৯]/);
    await call({ takenBy: { kind: 'DEVICE', deviceId: 'd1' } });
    expect(saved[1].message_body).toContain('পৌঁছেছে');
    expect(saved[1].message_body).toContain('Gate 1');
    expect(countSmsSegments(saved[1].message_body).segments).toBeLessThanOrEqual(2);
  });

  it('consumes a ONCE row when enqueued', async () => {
    subs = [sub({ mode: ArrivalNoticeMode.ONCE })];
    await call();
    expect(update).toHaveBeenCalledWith(
      { id: 'sub1', tenant_id: T },
      expect.objectContaining({ status: 'OFF', consumed_at: expect.any(Date) }),
    );
  });

  it('skips an opted-out guardian even with an ALWAYS lock', async () => {
    subs = [
      sub({ lock: ArrivalNoticeLock.ALWAYS, guardian: guardian({ notifications_enabled: false }) }),
    ];
    expect((await call()).queued).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('only PRESENT and LATE students send', async () => {
    const r = await call({
      students: [{ studentId: 's1', status: AttendanceStatus.ABSENT, occurredAt: AT }],
    });
    expect(r.queued).toBe(0);
  });

  it('skips SMS when smsAllowed is off, and PUSH when the guardian has no user', async () => {
    smsAllowed = false;
    subs = [sub({ channel: ArrivalNoticeChannel.SMS })];
    expect((await call()).skipped[0].reason).toBe(ArrivalSkipReason.SMS_NOT_ALLOWED);
    subs = [sub({ guardian: guardian({ user_id: null }) })];
    expect((await call()).skipped[0].reason).toBe(ArrivalSkipReason.NO_USER);
  });

  it('reserves credit for SMS before enqueue; insufficient credit queues nothing and keeps ONCE', async () => {
    subs = [sub({ channel: ArrivalNoticeChannel.SMS, mode: ArrivalNoticeMode.ONCE })];
    await call();
    expect(credits.reserveForLog).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('send', { logId: 'L', batchId: 'L', segments: 1 });
    queue.add.mockClear();
    update.mockClear();
    credits.reserveForLog.mockResolvedValue('INSUFFICIENT');
    const r = await call();
    expect(r.skipped[0].reason).toBe(ArrivalSkipReason.INSUFFICIENT_CREDIT);
    expect(queue.add).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('a failed reservation frees the dedupe key and reports its own reason', async () => {
    subs = [sub({ channel: ArrivalNoticeChannel.SMS })];
    credits.reserveForLog.mockResolvedValue('INSUFFICIENT');
    await call();
    // The key is cleared so a later call today (after a top-up) is not "already sent".
    expect(saved.at(-1)).toMatchObject({ status: 'FAILED', reference_key: null });
    credits.reserveForLog.mockRejectedValue(new Error('db down'));
    const r = await call();
    expect(r.skipped[0].reason).toBe(ArrivalSkipReason.CREDIT_RESERVE_FAILED);
    expect(saved.at(-1)).toMatchObject({ status: 'FAILED', reference_key: null });
  });

  it('a past date sends nothing, because the text says "today"', async () => {
    const r = await call({ date: '2020-01-01' });
    expect(r.queued).toBe(0);
    expect(saved).toHaveLength(0);
  });

  it('a failed ONCE consume does not stop the next guardian', async () => {
    subs = [
      sub({ mode: ArrivalNoticeMode.ONCE }),
      sub({ id: 'sub2', guardian_id: 'g2', guardian: guardian({ id: 'g2', user_id: 'u2' }) }),
    ];
    update.mockRejectedValue(new Error('db blip'));
    const r = await call();
    expect(r.queued).toBe(2);
  });

  it('a unique-index conflict is "already sent", not an error', async () => {
    saveError = { driverError: { code: '23505' } };
    const r = await call();
    expect(r.skipped[0].reason).toBe(ArrivalSkipReason.ALREADY_SENT);
  });

  it('Redis down fails open: releases credit, does not consume ONCE, does not throw', async () => {
    subs = [sub({ channel: ArrivalNoticeChannel.SMS, mode: ArrivalNoticeMode.ONCE })];
    queue.add.mockRejectedValue(new Error('redis down'));
    const r = await call();
    expect(r.skipped[0].reason).toBe(ArrivalSkipReason.ENQUEUE_FAILED);
    expect(credits.releaseForLog).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // the FAILED transition is the conditional UPDATE, scoped to this log and tenant
    expect(queryCalls).toHaveLength(1);
    expect(String(queryCalls[0][0])).toContain("claimed_by' IS NULL");
    expect(queryCalls[0][1]).toEqual(['L', 'tenant-1', expect.any(String)]);
  });

  it('add times out but a worker already claimed the log: no FAILED, no credit release, counted queued', async () => {
    subs = [sub({ channel: ArrivalNoticeChannel.SMS })];
    queue.add.mockRejectedValue(new Error('queue add timed out'));
    failRows = []; // conditional UPDATE matched nothing: log is claimed or settled
    const r = await call();
    expect(r.queued).toBe(1);
    expect(credits.releaseForLog).not.toHaveBeenCalled();
  });
});

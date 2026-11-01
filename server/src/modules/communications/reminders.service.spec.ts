import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BulkReminderService,
  SkipReason,
  selectReminderGuardians,
  partitionByOptOut,
  resolveReminderAudience,
  addressForMedium,
  canCheckStatus,
  toBatchLogDto,
  visibleLogBody,
} from './reminders.service';
import type { CommunicationLog } from './entities/communication-log.entity';
import { renderReminderTemplate } from './reminder-template.util';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ReminderBatchStatus,
  AuditAction,
  countSmsSegments,
} from '@biddaloy/shared';

const TENANT = 'tenant-1';
const USER = 'user-1';

function guardian(overrides: Partial<any> = {}) {
  return {
    id: 'g-1',
    full_name: 'Karim Uddin',
    phone: '01712345678',
    alternate_phone: null,
    email: 'karim@example.com',
    is_primary_contact: true,
    notifications_enabled: true,
    preferred_communication: CommunicationMedium.SMS,
    ...overrides,
  };
}

function student(overrides: Partial<any> = {}) {
  return {
    id: 's-1',
    full_name: 'Rahim Uddin',
    guardians: [guardian()],
    ...overrides,
  };
}

function snapshot(overrides: Partial<any> = {}) {
  return {
    student_id: 's-1',
    total_due: 1500,
    earliest_due_month: 3,
    earliest_due_year: 2026,
    ...overrides,
  };
}

describe('selectReminderGuardians', () => {
  it('returns only primary contacts when the student has any', () => {
    const primary = guardian({ id: 'g-1', is_primary_contact: true });
    const secondary = guardian({ id: 'g-2', is_primary_contact: false });

    expect(selectReminderGuardians([primary, secondary] as any)).toEqual([primary]);
  });

  it('falls back to every guardian when none is flagged primary', () => {
    const a = guardian({ id: 'g-1', is_primary_contact: false });
    const b = guardian({ id: 'g-2', is_primary_contact: false });

    expect(selectReminderGuardians([a, b] as any)).toEqual([a, b]);
  });

  it('returns an empty list for a student with no guardians', () => {
    expect(selectReminderGuardians([])).toEqual([]);
  });
});

describe('partitionByOptOut', () => {
  it('separates opted-out guardians from reachable ones', () => {
    const on = guardian({ id: 'g-1', notifications_enabled: true });
    const off = guardian({ id: 'g-2', notifications_enabled: false });

    expect(partitionByOptOut([on, off] as any)).toEqual({ reachable: [on], optedOut: [off] });
  });

  it('promotes a reachable non-primary when the sole primary has opted out', () => {
    // Partitioning BEFORE selectReminderGuardians is the whole point: the
    // primary is gone, so the fallback reaches the remaining guardian
    // rather than sending nothing. [5.4c]
    const primaryOptedOut = guardian({
      id: 'g-1',
      is_primary_contact: true,
      notifications_enabled: false,
    });
    const secondary = guardian({
      id: 'g-2',
      is_primary_contact: false,
      notifications_enabled: true,
    });

    const { reachable, optedOut } = partitionByOptOut([primaryOptedOut, secondary] as any);
    expect(optedOut).toEqual([primaryOptedOut]);
    expect(selectReminderGuardians(reachable)).toEqual([secondary]);
  });

  it('returns everything as reachable when nobody opted out', () => {
    const a = guardian({ id: 'g-1' });
    expect(partitionByOptOut([a] as any)).toEqual({ reachable: [a], optedOut: [] });
  });
});

describe('resolveReminderAudience', () => {
  it('does not report a non-primary opt-out when a reachable primary exists', () => {
    // Regression: partitioning over ALL linked guardians reported g-2, who
    // primary selection would never have chosen anyway. [5.4c]
    const primary = guardian({ id: 'g-1', is_primary_contact: true, notifications_enabled: true });
    const secondary = guardian({
      id: 'g-2',
      is_primary_contact: false,
      notifications_enabled: false,
    });

    const { guardians, skippedOptOut } = resolveReminderAudience([primary, secondary] as any);

    expect(guardians).toEqual([primary]);
    expect(skippedOptOut).toEqual([]);
  });

  it('still promotes a reachable non-primary when the sole primary opted out', () => {
    const primary = guardian({ id: 'g-1', is_primary_contact: true, notifications_enabled: false });
    const secondary = guardian({
      id: 'g-2',
      is_primary_contact: false,
      notifications_enabled: true,
    });

    const { guardians, skippedOptOut } = resolveReminderAudience([primary, secondary] as any);

    expect(guardians).toEqual([secondary]);
    expect(skippedOptOut).toEqual([primary]);
  });

  it('reports every opt-out when no guardian is flagged primary', () => {
    const a = guardian({ id: 'g-1', is_primary_contact: false, notifications_enabled: false });
    const b = guardian({ id: 'g-2', is_primary_contact: false, notifications_enabled: true });

    const { guardians, skippedOptOut } = resolveReminderAudience([a, b] as any);

    expect(guardians).toEqual([b]);
    expect(skippedOptOut).toEqual([a]);
  });
});

describe('addressForMedium', () => {
  it('uses the email address for EMAIL', () => {
    expect(addressForMedium(guardian() as any, CommunicationMedium.EMAIL)).toBe(
      'karim@example.com',
    );
  });

  it('uses the phone number for SMS and WhatsApp', () => {
    expect(addressForMedium(guardian() as any, CommunicationMedium.SMS)).toBe('01712345678');
    expect(addressForMedium(guardian() as any, CommunicationMedium.WHATSAPP)).toBe('01712345678');
  });

  it('falls back to the alternate phone when the primary one is missing', () => {
    const g = guardian({ phone: null, alternate_phone: '01898765432' });
    expect(addressForMedium(g as any, CommunicationMedium.SMS)).toBe('01898765432');
  });

  it('returns null when nothing is on file for the medium', () => {
    expect(
      addressForMedium(guardian({ email: null }) as any, CommunicationMedium.EMAIL),
    ).toBeNull();
    expect(
      addressForMedium(
        guardian({ phone: null, alternate_phone: null }) as any,
        CommunicationMedium.SMS,
      ),
    ).toBeNull();
  });
});

describe('BulkReminderService', () => {
  let service: BulkReminderService;
  let logRepo: Record<string, ReturnType<typeof vi.fn>>;
  let batchRepo: Record<string, ReturnType<typeof vi.fn>>;
  let queue: Record<string, ReturnType<typeof vi.fn>>;
  let studentService: Record<string, ReturnType<typeof vi.fn>>;
  let feeDuesService: Record<string, ReturnType<typeof vi.fn>>;
  let auditService: Record<string, ReturnType<typeof vi.fn>>;
  let smsCreditService: Record<string, ReturnType<typeof vi.fn>>;

  let savedBatch: any;
  let txManager: Record<string, ReturnType<typeof vi.fn>>;

  const dto = {
    student_ids: ['s-1'],
    message_template:
      'Dear {{guardian_name}}, {{student_name}} owes {{due_amount}} for {{due_month}}.',
  };

  beforeEach(() => {
    savedBatch = null;
    // The enqueue-failure path saves the log and records the batch outcome
    // inside one transaction (see the "why" in reminders.service.ts) so
    // a crash between the two can't leave a FAILED log the batch never
    // counted. txManager stands in for the transactional EntityManager.
    txManager = {
      save: vi.fn(async (v) => v),
      query: vi.fn(async () => undefined),
    };

    logRepo = {
      create: vi.fn((v) => ({ ...v })),
      save: vi.fn(async (v) => ({ id: 'log-1', ...v })),
      findAndCount: vi.fn(async () => [[], 0]),
      manager: { transaction: vi.fn(async (cb: any) => cb(txManager)) },
    };
    batchRepo = {
      create: vi.fn((v) => ({ ...v })),
      save: vi.fn(async (v) => {
        savedBatch = {
          id: 'batch-1',
          successful_count: 0,
          failed_count: 0,
          created_at: new Date('2026-03-01T00:00:00Z'),
          ...v,
        };
        return savedBatch;
      }),
      findOne: vi.fn(async () => savedBatch),
      findAndCount: vi.fn(async () => [[], 0]),
      query: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    queue = { add: vi.fn(async () => undefined) };
    studentService = { findManyWithGuardians: vi.fn(async () => [student()]) };
    feeDuesService = {
      getDueSnapshots: vi.fn(async () => new Map([['s-1', snapshot()]])),
    };
    auditService = { record: vi.fn(async () => undefined) };
    // [15.6.4/#547] Unmetered by default — most existing tests don't care
    // about SMS credits at all, so OFF keeps their `previewBulk` result
    // shape unaffected except for the new `projection` field.
    smsCreditService = {
      isMetered: vi.fn(async () => false),
      getBalance: vi.fn(async () => ({ available: 0, reserved: 0 })),
      reserve: vi.fn(async () => ({ ok: true })),
      settlePart: vi.fn(async () => undefined),
    };

    service = new BulkReminderService(
      logRepo as any,
      batchRepo as any,
      queue as any,
      studentService as any,
      feeDuesService as any,
      auditService as any,
      smsCreditService as any,
    );
  });

  describe('validation', () => {
    it('rejects a template using an unsupported placeholder before creating anything', async () => {
      await expect(
        service.sendBulk({ ...dto, message_template: 'Hi {{parent}}' } as any, TENANT, USER),
      ).rejects.toThrow(BadRequestException);

      expect(batchRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects whatsapp_template_params naming a placeholder it cannot fill', async () => {
      await expect(
        service.sendBulk(
          {
            ...dto,
            whatsapp_template_name: 'fee_reminder',
            whatsapp_template_params: ['nope'],
          } as any,
          TENANT,
          USER,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(batchRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFound for student ids outside the tenant, without echoing them (#3000)', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([student({ id: 's-1' })]);

      const err = await service
        .sendBulk({ ...dto, student_ids: ['s-1', 's-missing'] } as any, TENANT, USER)
        .catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('One or more student IDs not found');
      expect(err.message).not.toContain('s-missing');
    });

    it('scopes the student lookup and the dues lookup to the caller tenant', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(studentService.findManyWithGuardians).toHaveBeenCalledWith(['s-1'], TENANT);
      expect(feeDuesService.getDueSnapshots).toHaveBeenCalledWith(['s-1'], TENANT);
    });

    it('deduplicates repeated student ids so a guardian is not messaged twice', async () => {
      await service.sendBulk({ ...dto, student_ids: ['s-1', 's-1'] } as any, TENANT, USER);

      expect(studentService.findManyWithGuardians).toHaveBeenCalledWith(['s-1'], TENANT);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    // Epic 88: the demo cap counts the students picked (after the dedupe), not guardians, and is
    // checked before any DB read.
    it.each([
      [100, false],
      [101, true],
    ])('demo: %i picked students refused=%s, before any lookup', async (n, refused) => {
      const prev = process.env.DEMO_MODE;
      process.env.DEMO_MODE = 'true';
      const ids = Array.from({ length: n }, (_, i) => `s-${i}`);
      // Duplicates do not count: the cap is on the deduped list.
      const err = await service
        .previewBulk({ ...dto, student_ids: [...ids, ids[0]] } as any, TENANT, USER)
        .catch((e) => e)
        .finally(() => {
          if (prev === undefined) delete process.env.DEMO_MODE;
          else process.env.DEMO_MODE = prev;
        });
      if (refused) {
        expect(err).toBeInstanceOf(UnprocessableEntityException);
        expect(err.getResponse().details).toEqual({
          code: 'DEMO_ROW_LIMIT',
          limit: 100,
          count: 101,
        });
        expect(studentService.findManyWithGuardians).not.toHaveBeenCalled();
      } else {
        expect(err).not.toBeInstanceOf(UnprocessableEntityException);
        expect(studentService.findManyWithGuardians).toHaveBeenCalled();
      }
    });
  });

  describe('happy path', () => {
    it('creates a PROCESSING batch owned by the tenant and queues one job per recipient', async () => {
      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT,
          initiated_by_user_id: USER,
          status: ReminderBatchStatus.PROCESSING,
          total_recipients: 1,
          message_template: dto.message_template,
        }),
      );
      // Default recipient is SMS (guardian()'s preferred_communication), so
      // the job carries both batchId and its own positive segments count.
      expect(queue.add).toHaveBeenCalledWith(
        'send',
        expect.objectContaining({
          logId: 'log-1',
          batchId: 'batch-1',
          segments: expect.any(Number),
        }),
      );
      const jobData = queue.add.mock.calls[0][1];
      expect(jobData.segments).toBeGreaterThan(0);
      expect(result.total_recipients).toBe(1);
      expect(result.skipped).toEqual([]);
    });

    it('writes a QUEUED log tagged BULK_REMINDER and linked to the batch', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT,
          reminder_batch_id: 'batch-1',
          student_id: 's-1',
          guardian_id: 'g-1',
          medium: CommunicationMedium.SMS,
          recipient_address: '01712345678',
          recipient_name: 'Karim Uddin',
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.BULK_REMINDER,
        }),
      );
    });

    it('renders the placeholders into each recipient message body', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message_body: 'Dear Karim Uddin, Rahim Uddin owes 1,500.00 for March 2026.',
        }),
      );
    });

    it('records the request in filters_applied for audit', async () => {
      await service.sendBulk({ ...dto, mediums: [CommunicationMedium.SMS] } as any, TENANT, USER);

      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          filters_applied: expect.objectContaining({
            student_ids: ['s-1'],
            mediums: [CommunicationMedium.SMS],
          }),
        }),
      );
    });

    it('uses the supplied batch name, and a dated default otherwise', async () => {
      await service.sendBulk({ ...dto, batch_name: 'March chase-up' } as any, TENANT, USER);
      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ batch_name: 'March chase-up' }),
      );

      batchRepo.create.mockClear();
      await service.sendBulk(dto as any, TENANT, USER);
      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          batch_name: expect.stringMatching(/^Fee Reminder \d{4}-\d{2}-\d{2}$/),
        }),
      );
    });

    it.each([
      ['2026-10-07T17:59:00Z', '2026-10-07'],
      ['2026-10-07T18:00:00Z', '2026-10-08'],
      ['2026-10-08T00:00:00Z', '2026-10-08'],
    ])('default batch name at %s uses the Dhaka day', async (now, day) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(now));
      try {
        await service.sendBulk(dto as any, TENANT, USER);
      } finally {
        vi.useRealTimers();
      }
      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ batch_name: `Fee Reminder ${day}` }),
      );
    });

    it('sends one message per primary guardian when a student has several', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true }),
            guardian({ id: 'g-2', is_primary_contact: true }),
          ],
        }),
      ]);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.total_recipients).toBe(2);
      expect(queue.add).toHaveBeenCalledTimes(2);
    });
  });

  describe('email specifics', () => {
    it('sets a subject only for email recipients', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ guardians: [guardian({ preferred_communication: CommunicationMedium.EMAIL })] }),
      ]);

      await service.sendBulk({ ...dto, batch_name: 'March chase-up' } as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          medium: CommunicationMedium.EMAIL,
          recipient_address: 'karim@example.com',
          subject: 'March chase-up',
        }),
      );
    });

    it('leaves the subject null for non-email recipients', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ subject: null }));
    });
  });

  describe('WhatsApp templates', () => {
    beforeEach(() => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [guardian({ preferred_communication: CommunicationMedium.WHATSAPP })],
        }),
      ]);
    });

    it('maps named template params onto positional values in order', async () => {
      await service.sendBulk(
        {
          ...dto,
          whatsapp_template_name: 'fee_reminder',
          whatsapp_template_language: 'bn',
          whatsapp_template_params: ['guardian_name', 'due_amount', 'due_month'],
        } as any,
        TENANT,
        USER,
      );

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            template_name: 'fee_reminder',
            template_language: 'bn',
            template_params: ['Karim Uddin', '1,500.00', 'March 2026'],
          },
        }),
      );
    });

    it('leaves metadata null when no template name was supplied', async () => {
      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: null }));
    });

    it('does not attach template metadata to a non-WhatsApp recipient', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ guardians: [guardian({ preferred_communication: CommunicationMedium.SMS })] }),
      ]);

      await service.sendBulk(
        { ...dto, whatsapp_template_name: 'fee_reminder' } as any,
        TENANT,
        USER,
      );

      expect(logRepo.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: null }));
    });
  });

  describe('skipping', () => {
    async function skipReasonFor(setup: () => void): Promise<string> {
      setup();
      const result = await service.sendBulk(dto as any, TENANT, USER);
      expect(result.skipped).toHaveLength(1);
      return result.skipped[0].reason;
    }

    it('skips a student with no open dues', async () => {
      const reason = await skipReasonFor(() => {
        feeDuesService.getDueSnapshots.mockResolvedValue(new Map());
      });

      expect(reason).toBe(SkipReason.NO_OPEN_DUES);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips a student with no guardians on file', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([student({ guardians: [] })]);
      });

      expect(reason).toBe(SkipReason.NO_GUARDIANS);
    });

    it('skips a student whose guardians relation was not loaded', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([student({ guardians: undefined })]);
      });

      expect(reason).toBe(SkipReason.NO_GUARDIANS);
    });

    it('skips a guardian who has opted out of notifications', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([
          student({ guardians: [guardian({ notifications_enabled: false })] }),
        ]);
      });

      expect(reason).toBe(SkipReason.NOTIFICATIONS_DISABLED);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('still reaches the guardians who have not opted out', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [
            guardian({ id: 'g-1', notifications_enabled: false }),
            guardian({ id: 'g-2', notifications_enabled: true }),
          ],
        }),
      ]);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.skipped).toEqual([
        { student_id: 's-1', guardian_id: 'g-1', reason: SkipReason.NOTIFICATIONS_DISABLED },
      ]);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({ guardian_id: 'g-2' }));
    });

    it('promotes a reachable non-primary when the sole primary has opted out', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true, notifications_enabled: false }),
            guardian({ id: 'g-2', is_primary_contact: false, notifications_enabled: true }),
          ],
        }),
      ]);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.skipped).toEqual([
        { student_id: 's-1', guardian_id: 'g-1', reason: SkipReason.NOTIFICATIONS_DISABLED },
      ]);
      expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({ guardian_id: 'g-2' }));
    });

    it('does not report a non-primary opt-out when the primary is reachable', async () => {
      // Regression: this guardian is not a primary contact, so they would
      // never have been messaged — reporting them inflated skipped_count
      // and the REMINDER_PREVIEWED audit row. [5.4c]
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true, notifications_enabled: true }),
            guardian({ id: 'g-2', is_primary_contact: false, notifications_enabled: false }),
          ],
        }),
      ]);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.skipped).toEqual([]);
      expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({ guardian_id: 'g-1' }));
    });

    it('reports only per-guardian opt-outs, not NO_GUARDIANS, when all opted out', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [
            guardian({ id: 'g-1', notifications_enabled: false }),
            guardian({ id: 'g-2', notifications_enabled: false }),
          ],
        }),
      ]);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.skipped).toEqual([
        { student_id: 's-1', guardian_id: 'g-1', reason: SkipReason.NOTIFICATIONS_DISABLED },
        { student_id: 's-1', guardian_id: 'g-2', reason: SkipReason.NOTIFICATIONS_DISABLED },
      ]);
      expect(result.skipped.some((s: any) => s.reason === SkipReason.NO_GUARDIANS)).toBe(false);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips PHONE_CALL, which has no automated provider', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([
          student({
            guardians: [guardian({ preferred_communication: CommunicationMedium.PHONE_CALL })],
          }),
        ]);
      });

      expect(reason).toBe(SkipReason.NO_AUTOMATED_PROVIDER);
    });

    it('skips MESSENGER, which cannot be reached from a phone or email', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([
          student({
            guardians: [guardian({ preferred_communication: CommunicationMedium.MESSENGER })],
          }),
        ]);
      });

      expect(reason).toBe(SkipReason.NO_AUTOMATED_PROVIDER);
    });

    it('skips a guardian with no address for their preferred medium', async () => {
      const reason = await skipReasonFor(() => {
        studentService.findManyWithGuardians.mockResolvedValue([
          student({ guardians: [guardian({ phone: null, alternate_phone: null })] }),
        ]);
      });

      expect(reason).toBe(SkipReason.MISSING_ADDRESS);
    });

    it('skips a guardian whose preferred medium is outside the requested mediums', async () => {
      const result = await service.sendBulk(
        { ...dto, mediums: [CommunicationMedium.EMAIL] } as any,
        TENANT,
        USER,
      );

      expect(result.skipped[0].reason).toBe(SkipReason.MEDIUM_NOT_ALLOWED);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('treats an empty mediums array as no restriction at all', async () => {
      const result = await service.sendBulk({ ...dto, mediums: [] } as any, TENANT, USER);

      expect(result.skipped).toEqual([]);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('names the skipped student and guardian so the caller can act on it', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ guardians: [guardian({ id: 'g-7', phone: null, alternate_phone: null })] }),
      ]);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.skipped[0]).toEqual({
        student_id: 's-1',
        guardian_id: 'g-7',
        reason: SkipReason.MISSING_ADDRESS,
      });
    });

    it('completes a batch immediately when every recipient was skipped', async () => {
      feeDuesService.getDueSnapshots.mockResolvedValue(new Map());

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(batchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: ReminderBatchStatus.COMPLETED, total_recipients: 0 }),
      );
      expect(result.status).toBe(ReminderBatchStatus.COMPLETED);
    });

    it('renders an empty due_month when the snapshot has no dated fee', async () => {
      feeDuesService.getDueSnapshots.mockResolvedValue(
        new Map([['s-1', snapshot({ earliest_due_month: null, earliest_due_year: null })]]),
      );

      await service.sendBulk(dto as any, TENANT, USER);

      expect(logRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message_body: 'Dear Karim Uddin, Rahim Uddin owes 1,500.00 for .',
        }),
      );
    });
  });

  describe('enqueue failures', () => {
    it('marks the log FAILED and counts it against the batch without aborting the rest', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ id: 's-1', guardians: [guardian({ id: 'g-1' })] }),
        student({ id: 's-2', guardians: [guardian({ id: 'g-2' })] }),
      ]);
      feeDuesService.getDueSnapshots.mockResolvedValue(
        new Map([
          ['s-1', snapshot({ student_id: 's-1' })],
          ['s-2', snapshot({ student_id: 's-2' })],
        ]),
      );
      queue.add.mockRejectedValueOnce(new Error('redis down'));

      const result = await service.sendBulk(
        { ...dto, student_ids: ['s-1', 's-2'] } as any,
        TENANT,
        USER,
      );

      expect(result.total_recipients).toBe(2);
      // Second recipient still enqueued despite the first failing.
      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(txManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: CommunicationStatus.FAILED,
          metadata: expect.objectContaining({ error: 'Failed to enqueue for delivery' }),
        }),
      );
      // Save and counter update happen inside the same transaction callback.
      expect(logRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(txManager.query).toHaveBeenCalledTimes(1);
      // The audit trail must distinguish "attempted 2" from "only 1
      // actually reached the queue" rather than collapsing both outcomes
      // into a single count.
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          new_values: expect.objectContaining({ queued_count: 1, failed_count: 1 }),
        }),
      );
    });

    it('releases the reserved SMS credit for a recipient whose enqueue failed', async () => {
      smsCreditService.isMetered.mockResolvedValue(true);
      smsCreditService.reserve.mockResolvedValue({ ok: true });
      queue.add.mockRejectedValueOnce(new Error('redis down'));

      await service.sendBulk({ ...dto, mediums: [CommunicationMedium.SMS] } as any, TENANT, USER);

      expect(smsCreditService.settlePart).toHaveBeenCalledWith(
        TENANT,
        `batch:${savedBatch.id}`,
        expect.stringMatching(/^log:/),
        expect.any(Number),
        'RELEASE',
      );
    });

    it('does not abort the batch loop when settlePart fails to release credit', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ id: 's-1', guardians: [guardian({ id: 'g-1' })] }),
        student({ id: 's-2', guardians: [guardian({ id: 'g-2' })] }),
      ]);
      feeDuesService.getDueSnapshots.mockResolvedValue(
        new Map([
          ['s-1', snapshot({ student_id: 's-1' })],
          ['s-2', snapshot({ student_id: 's-2' })],
        ]),
      );
      smsCreditService.isMetered.mockResolvedValue(true);
      smsCreditService.reserve.mockResolvedValue({ ok: true });
      smsCreditService.settlePart.mockRejectedValue(new Error('no RESERVE found'));
      queue.add.mockRejectedValueOnce(new Error('redis down'));

      const result = await service.sendBulk(
        { ...dto, student_ids: ['s-1', 's-2'], mediums: [CommunicationMedium.SMS] } as any,
        TENANT,
        USER,
      );

      // Second recipient still enqueued despite settlePart throwing for the
      // first — the release failure must not escape the loop.
      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(result.total_recipients).toBe(2);
    });

    it('reports counts re-read after the enqueue loop, not the ones the batch was created with', async () => {
      queue.add.mockRejectedValueOnce(new Error('redis down'));
      batchRepo.findOne.mockResolvedValue({
        ...savedBatch,
        id: 'batch-1',
        batch_name: 'b',
        status: ReminderBatchStatus.FAILED,
        total_recipients: 1,
        successful_count: 0,
        failed_count: 1,
        message_template: dto.message_template,
        created_at: new Date(),
      });

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.failed_count).toBe(1);
      expect(result.status).toBe(ReminderBatchStatus.FAILED);
    });

    it('falls back to the in-memory batch if the re-read returns nothing', async () => {
      batchRepo.findOne.mockResolvedValue(null);

      const result = await service.sendBulk(dto as any, TENANT, USER);

      expect(result.id).toBe('batch-1');
      expect(result.status).toBe(ReminderBatchStatus.PROCESSING);
    });
  });

  describe('SMS credit reservation [15.6.5/#548]', () => {
    it('OFF mode: never calls reserve', async () => {
      smsCreditService.isMetered.mockResolvedValue(false);

      await service.sendBulk(dto as any, TENANT, USER);

      expect(smsCreditService.reserve).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('PLATFORM mode with sms_units === 0: never calls reserve', async () => {
      smsCreditService.isMetered.mockResolvedValue(true);
      // EMAIL-only recipient never contributes to sms_units.
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [
            guardian({
              id: 'g-1',
              preferred_communication: CommunicationMedium.EMAIL,
              email: 'salma@example.com',
            }),
          ],
        }),
      ]);

      await service.sendBulk(dto as any, TENANT, USER);

      expect(smsCreditService.reserve).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('metered, sufficient balance: reserves the recomputed units under batch:<id>, then creates logs/jobs', async () => {
      smsCreditService.isMetered.mockResolvedValue(true);
      smsCreditService.reserve.mockResolvedValue({ ok: true });

      const rendered = renderReminderTemplate(dto.message_template, {
        student_name: 'Rahim Uddin',
        guardian_name: 'Karim Uddin',
        due_amount: '1,500.00',
        due_month: 'March 2026',
      });
      const expectedUnits = countSmsSegments(rendered).segments;

      await service.sendBulk(dto as any, TENANT, USER);

      expect(smsCreditService.reserve).toHaveBeenCalledWith(
        TENANT,
        expectedUnits,
        'batch:batch-1',
        { type: 'batch', id: 'batch-1' },
      );

      // Reservation happens strictly before any log/job is created.
      const reserveOrder = smsCreditService.reserve.mock.invocationCallOrder[0];
      const logSaveOrder = logRepo.save.mock.invocationCallOrder[0];
      const jobAddOrder = queue.add.mock.invocationCallOrder[0];
      expect(reserveOrder).toBeLessThan(logSaveOrder);
      expect(reserveOrder).toBeLessThan(jobAddOrder);
    });

    it('metered, insufficient balance: 409 with INSUFFICIENT_SMS_CREDIT, no logs/jobs, batch rolled back', async () => {
      smsCreditService.isMetered.mockResolvedValue(true);
      smsCreditService.reserve.mockResolvedValue({ ok: false, available: 2 });

      try {
        await service.sendBulk(dto as any, TENANT, USER);
        throw new Error('expected sendBulk to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getStatus()).toBe(409);
        expect((error as ConflictException).getResponse()).toMatchObject({
          details: {
            code: 'INSUFFICIENT_SMS_CREDIT',
            required: expect.any(Number),
            available: 2,
          },
        });
      }

      expect(logRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(batchRepo.delete).toHaveBeenCalledWith({ id: 'batch-1', tenant_id: TENANT });
    });

    it('metered, reserve throws: deletes the PROCESSING batch instead of leaving it orphaned, then rethrows', async () => {
      smsCreditService.isMetered.mockResolvedValue(true);
      const dbError = new Error('connection reset');
      smsCreditService.reserve.mockRejectedValue(dbError);

      await expect(service.sendBulk(dto as any, TENANT, USER)).rejects.toBe(dbError);

      expect(logRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(batchRepo.delete).toHaveBeenCalledWith({ id: 'batch-1', tenant_id: TENANT });
    });

    it('ignores any client-supplied total and reserves the server-recomputed sms_units instead', async () => {
      smsCreditService.isMetered.mockResolvedValue(true);
      smsCreditService.reserve.mockResolvedValue({ ok: true });

      // A DTO carrying a bogus client-side total — the DTO type has no such
      // field, so this only exercises that the service never reads one.
      const dtoWithStaleTotal = { ...dto, sms_units: 999 } as any;

      await service.sendBulk(dtoWithStaleTotal, TENANT, USER);

      const [, reservedUnits] = smsCreditService.reserve.mock.calls[0];
      expect(reservedUnits).not.toBe(999);
      expect(reservedUnits).toBeGreaterThan(0);
    });

    it('each SMS job carries its own segments count and the batchId', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          id: 's-1',
          guardians: [guardian({ id: 'g-1', preferred_communication: CommunicationMedium.SMS })],
        }),
      ]);

      await service.sendBulk(dto as any, TENANT, USER);

      expect(queue.add).toHaveBeenCalledWith(
        'send',
        expect.objectContaining({ batchId: 'batch-1', segments: expect.any(Number) }),
      );
    });
  });

  describe('findBatch', () => {
    // Business-critical: the detail page composes "retry the failures" from
    // this response. If the original targeting is missing, an email-only
    // batch retries onto every preferred channel and a WhatsApp template
    // batch retries as freeform text Meta rejects.
    it('replays the original targeting so a retry can reproduce the send', async () => {
      batchRepo.findOne.mockResolvedValue({
        id: 'batch-1',
        batch_name: 'b',
        status: ReminderBatchStatus.COMPLETED,
        total_recipients: 1,
        successful_count: 0,
        failed_count: 1,
        message_template: 'x',
        created_at: new Date(),
        filters_applied: {
          mediums: [CommunicationMedium.EMAIL],
          whatsapp_template_name: 'fee_reminder',
          whatsapp_template_language: 'bn',
          whatsapp_template_params: ['guardian_name'],
          skipped: [],
        },
      });

      const result = await service.findBatch('batch-1', TENANT);

      expect(result.mediums).toEqual([CommunicationMedium.EMAIL]);
      expect(result.whatsapp_template_name).toBe('fee_reminder');
      expect(result.whatsapp_template_language).toBe('bn');
      expect(result.whatsapp_template_params).toEqual(['guardian_name']);
    });

    it('reports null targeting for a batch sent on guardian preferences', async () => {
      batchRepo.findOne.mockResolvedValue({
        id: 'batch-1',
        batch_name: 'b',
        status: ReminderBatchStatus.COMPLETED,
        total_recipients: 1,
        successful_count: 1,
        failed_count: 0,
        message_template: 'x',
        created_at: new Date(),
        filters_applied: { skipped: [] },
      });

      const result = await service.findBatch('batch-1', TENANT);

      expect(result.mediums).toBeNull();
      expect(result.whatsapp_template_name).toBeNull();
    });

    it('scopes the lookup to the caller tenant', async () => {
      batchRepo.findOne.mockResolvedValue({
        id: 'batch-1',
        batch_name: 'b',
        status: ReminderBatchStatus.COMPLETED,
        total_recipients: 3,
        successful_count: 3,
        failed_count: 0,
        message_template: 'x',
        created_at: new Date(),
        filters_applied: {
          skipped: [{ student_id: 's-9', guardian_id: null, reason: 'no_open_dues' }],
        },
      });

      const result = await service.findBatch('batch-1', TENANT);

      expect(batchRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'batch-1', tenant_id: TENANT },
      });
      expect(result.successful_count).toBe(3);
      expect(result.skipped).toHaveLength(1);
    });

    it('throws NotFound for a batch belonging to another tenant', async () => {
      batchRepo.findOne.mockResolvedValue(null);

      await expect(service.findBatch('batch-1', 'other-tenant')).rejects.toThrow(NotFoundException);
    });

    it('returns an empty skipped list when filters_applied has none', async () => {
      batchRepo.findOne.mockResolvedValue({
        id: 'batch-1',
        batch_name: 'b',
        status: ReminderBatchStatus.COMPLETED,
        total_recipients: 0,
        successful_count: 0,
        failed_count: 0,
        message_template: null,
        created_at: new Date(),
        filters_applied: null,
      });

      const result = await service.findBatch('batch-1', TENANT);

      expect(result.skipped).toEqual([]);
    });
  });

  describe('previewBulk', () => {
    it('sends nothing: no batch, no logs, no queue jobs', async () => {
      await service.previewBulk(dto as any, TENANT, 'user-1');

      expect(batchRepo.save).not.toHaveBeenCalled();
      expect(logRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    // Business-critical: preview hands back every guardian's name, channel and
    // contact address behind a filter. Nothing is sent, but who asked for that
    // data must leave a trace — and the trace must carry counts only, never a
    // second copy of the contact data itself.
    it('audits the preview with counts only, never the resolved contacts', async () => {
      await service.previewBulk(dto as any, TENANT, 'user-1', {
        ip: '1.2.3.4',
        userAgent: 'test-agent',
      });

      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith({
        action: AuditAction.REMINDER_PREVIEWED,
        entity_type: 'ReminderBatchPreview',
        entity_id: null,
        tenant_id: TENANT,
        performed_by_user_id: 'user-1',
        ip_address: '1.2.3.4',
        user_agent: 'test-agent',
        new_values: {
          student_count: 1,
          recipient_count: 1,
          skipped_count: 0,
          mediums: null,
        },
      });

      const [[recorded]] = auditService.record.mock.calls;
      expect(JSON.stringify(recorded)).not.toContain('01712345678');
    });

    it('rejects a template using an unsupported placeholder before loading anything', async () => {
      await expect(
        service.previewBulk({ ...dto, message_template: 'Hi {{parent}}' } as any, TENANT),
      ).rejects.toThrow(BadRequestException);

      expect(studentService.findManyWithGuardians).not.toHaveBeenCalled();
    });

    it('rejects whatsapp_template_params naming a placeholder it cannot fill', async () => {
      await expect(
        service.previewBulk(
          {
            ...dto,
            whatsapp_template_name: 'fee_reminder',
            whatsapp_template_params: ['nope'],
          } as any,
          TENANT,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound for student ids that do not resolve within the tenant', async () => {
      // findManyWithGuardians is tenant-scoped and soft-delete-aware
      // (deleted_at IS NULL), so a cross-tenant or soft-deleted student
      // comes back missing and 404s here — Tenant A cannot preview
      // against Tenant B's students.
      studentService.findManyWithGuardians.mockResolvedValue([student({ id: 's-1' })]);

      await expect(
        service.previewBulk({ ...dto, student_ids: ['s-1', 's-other-tenant'] } as any, TENANT),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes the student and dues lookups to the caller tenant, batched (one call each)', async () => {
      await service.previewBulk(dto as any, TENANT);

      expect(studentService.findManyWithGuardians).toHaveBeenCalledTimes(1);
      expect(studentService.findManyWithGuardians).toHaveBeenCalledWith(['s-1'], TENANT);
      expect(feeDuesService.getDueSnapshots).toHaveBeenCalledTimes(1);
      expect(feeDuesService.getDueSnapshots).toHaveBeenCalledWith(['s-1'], TENANT);
    });

    it('deduplicates repeated student ids', async () => {
      const result = await service.previewBulk(
        { ...dto, student_ids: ['s-1', 's-1'] } as any,
        TENANT,
      );

      expect(result.total_students).toBe(1);
      expect(result.students).toHaveLength(1);
    });

    it('renders the exact message each recipient would receive, grouped by student', async () => {
      const result = await service.previewBulk(dto as any, TENANT);

      expect(result).toEqual({
        total_students: 1,
        recipients_count: 1,
        skipped_count: 0,
        students: [
          {
            student_id: 's-1',
            student_name: 'Rahim Uddin',
            recipients: [
              {
                guardian_id: 'g-1',
                guardian_name: 'Karim Uddin',
                medium: CommunicationMedium.SMS,
                address: '01712345678',
                message_body: 'Dear Karim Uddin, Rahim Uddin owes 1,500.00 for March 2026.',
                subject: null,
                // SMS, so no approved template is in play — the rendered body
                // above is exactly what this guardian receives.
                whatsapp_template: null,
              },
            ],
            skipped: [],
          },
        ],
        projection: { sms_recipients: 1, sms_units: 1, metering: 'OFF' },
      });
    });

    it('sets the email subject the send would use (batch_name, else Fee Reminder)', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ guardians: [guardian({ preferred_communication: CommunicationMedium.EMAIL })] }),
      ]);

      const named = await service.previewBulk(
        { ...dto, batch_name: 'March chase-up' } as any,
        TENANT,
      );
      expect(named.students[0].recipients[0].subject).toBe('March chase-up');

      const unnamed = await service.previewBulk(dto as any, TENANT);
      expect(unnamed.students[0].recipients[0].subject).toBe('Fee Reminder');
    });

    it('names skipped guardians with the reason, so the list is reviewable', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [
            guardian({ id: 'g-1', is_primary_contact: true }),
            guardian({
              id: 'g-2',
              full_name: 'Salma Begum',
              is_primary_contact: true,
              phone: null,
              alternate_phone: null,
            }),
          ],
        }),
      ]);

      const result = await service.previewBulk(dto as any, TENANT);

      expect(result.recipients_count).toBe(1);
      expect(result.skipped_count).toBe(1);
      expect(result.students[0].skipped).toEqual([
        {
          guardian_id: 'g-2',
          guardian_name: 'Salma Begum',
          reason: SkipReason.MISSING_ADDRESS,
        },
      ]);
    });

    it('reports a student-level skip (no open dues) with a null guardian', async () => {
      feeDuesService.getDueSnapshots.mockResolvedValue(new Map());

      const result = await service.previewBulk(dto as any, TENANT);

      expect(result.recipients_count).toBe(0);
      expect(result.students[0].skipped).toEqual([
        { guardian_id: null, guardian_name: null, reason: SkipReason.NO_OPEN_DUES },
      ]);
    });

    it('does not throw when every candidate is skipped — bulk skipping is normal', async () => {
      // Unlike the single-reminder flow, which 400s when nobody is
      // deliverable: in a bulk set, some students being undeliverable is
      // the expected case, and the review step is where the sender sees it.
      feeDuesService.getDueSnapshots.mockResolvedValue(new Map());

      const result = await service.previewBulk(dto as any, TENANT);

      expect(result.recipients_count).toBe(0);
      expect(result.skipped_count).toBe(1);
    });
  });

  describe('previewBulk — SMS projection [15.6.4/#547]', () => {
    it("sums each rendered message's own segment count, not count * one template's segments", async () => {
      // g-1's rendered message stays plain ASCII (GSM-7, 1 segment). g-2's
      // guardian_name is Bengali, so ITS rendered message goes UCS-2 —
      // whose 70-char-per-segment limit is smaller than GSM-7's 160. If the
      // projection multiplied "recipient count * one sample's segments" it
      // would get 2, not the true per-message sum.
      const asciiGuardian = guardian({
        id: 'g-1',
        full_name: 'Karim Uddin',
        preferred_communication: CommunicationMedium.SMS,
      });
      const bengaliGuardian = guardian({
        id: 'g-2',
        full_name: 'করিম উদ্দিন হাসান আলী মাহমুদ চৌধুরী রহমান আকতার হোসেন কবির'.repeat(2),
        preferred_communication: CommunicationMedium.SMS,
      });
      studentService.findManyWithGuardians.mockResolvedValue([
        student({ id: 's-1', guardians: [asciiGuardian] }),
        student({ id: 's-2', guardians: [bengaliGuardian] }),
      ]);
      feeDuesService.getDueSnapshots.mockResolvedValue(
        new Map([
          ['s-1', snapshot({ student_id: 's-1' })],
          ['s-2', snapshot({ student_id: 's-2' })],
        ]),
      );

      const result = await service.previewBulk(
        { ...dto, student_ids: ['s-1', 's-2'] } as any,
        TENANT,
      );

      const asciiMessage = result.students[0].recipients[0].message_body;
      const bengaliMessage = result.students[1].recipients[0].message_body;
      const { countSmsSegments } = await import('@biddaloy/shared');
      const expectedUnits =
        countSmsSegments(asciiMessage).segments + countSmsSegments(bengaliMessage).segments;

      // The two messages must actually differ in encoding/segment size —
      // otherwise this test can't tell a correct sum from a naive product.
      expect(countSmsSegments(asciiMessage).encoding).toBe('GSM_7');
      expect(countSmsSegments(bengaliMessage).encoding).toBe('UCS_2');
      expect(countSmsSegments(asciiMessage).segments).not.toBe(
        countSmsSegments(bengaliMessage).segments,
      );

      expect(result.projection.sms_recipients).toBe(2);
      expect(result.projection.sms_units).toBe(expectedUnits);
      expect(result.projection.sms_units).not.toBe(2 * countSmsSegments(asciiMessage).segments);
    });

    it('excludes non-SMS recipients from sms_recipients and sms_units', async () => {
      studentService.findManyWithGuardians.mockResolvedValue([
        student({
          guardians: [
            guardian({ id: 'g-1', preferred_communication: CommunicationMedium.SMS }),
            guardian({
              id: 'g-2',
              full_name: 'Salma Begum',
              email: 'salma@example.com',
              preferred_communication: CommunicationMedium.EMAIL,
            }),
          ],
        }),
      ]);

      const result = await service.previewBulk(dto as any, TENANT);

      expect(result.recipients_count).toBe(2);
      expect(result.projection.sms_recipients).toBe(1);
      expect(result.projection.sms_units).toBeGreaterThan(0);
    });

    it('OFF metering: no available/reserved/shortfall on the response', async () => {
      smsCreditService.isMetered.mockResolvedValue(false);

      const result = await service.previewBulk(dto as any, TENANT);

      expect(result.projection.metering).toBe('OFF');
      expect(result.projection).not.toHaveProperty('available');
      expect(result.projection).not.toHaveProperty('reserved');
      expect(result.projection).not.toHaveProperty('shortfall');
    });

    it('PLATFORM metering: fills available/reserved and a zero shortfall when balance covers it', async () => {
      smsCreditService.isMetered.mockResolvedValue(true);
      smsCreditService.getBalance.mockResolvedValue({ available: 50, reserved: 3 });

      const result = await service.previewBulk(dto as any, TENANT);

      expect(result.projection.metering).toBe('PLATFORM');
      expect(result.projection.available).toBe(50);
      expect(result.projection.reserved).toBe(3);
      expect(result.projection.shortfall).toBe(0);
      expect(smsCreditService.getBalance).toHaveBeenCalledWith(TENANT);
    });

    it('PLATFORM metering: reports a positive shortfall when available is less than sms_units', async () => {
      smsCreditService.isMetered.mockResolvedValue(true);
      smsCreditService.getBalance.mockResolvedValue({ available: 0, reserved: 0 });

      const result = await service.previewBulk(dto as any, TENANT);

      expect(result.projection.sms_units).toBeGreaterThan(0);
      expect(result.projection.shortfall).toBe(result.projection.sms_units);
    });
  });

  describe('findBatches', () => {
    const batchRow = {
      id: 'batch-1',
      batch_name: 'March chase-up',
      status: ReminderBatchStatus.COMPLETED,
      total_recipients: 3,
      successful_count: 2,
      failed_count: 1,
      message_template: 'x',
      filters_applied: {
        skipped: [{ student_id: 's-9', guardian_id: null, reason: 'no_open_dues' }],
      },
      created_at: new Date('2026-03-01T00:00:00Z'),
    };

    function makeQb(rows: unknown[], total: number) {
      const qb: any = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([rows, total]),
      };
      batchRepo.createQueryBuilder = vi.fn(() => qb);
      return qb;
    }

    it('scopes the list to the caller tenant, newest first, paginated', async () => {
      const qb = makeQb([batchRow], 41);

      const result = await service.findBatches({ page: 3, limit: 20 }, TENANT);

      expect(batchRepo.createQueryBuilder).toHaveBeenCalledWith('batch');
      expect(qb.where).toHaveBeenCalledWith('batch.tenant_id = :tenantId', { tenantId: TENANT });
      // Only the columns the list item maps: the heavy message_template and
      // filters_applied jsonb stay in the database.
      expect(qb.select).toHaveBeenCalledWith([
        'batch.id',
        'batch.batch_name',
        'batch.status',
        'batch.total_recipients',
        'batch.successful_count',
        'batch.failed_count',
        'batch.created_at',
      ]);
      expect(qb.orderBy).toHaveBeenCalledWith('batch.created_at', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(40);
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(result).toEqual({
        data: [
          {
            id: 'batch-1',
            batch_name: 'March chase-up',
            status: ReminderBatchStatus.COMPLETED,
            total_recipients: 3,
            successful_count: 2,
            failed_count: 1,
            created_at: batchRow.created_at,
          },
        ],
        total: 41,
        page: 3,
        limit: 20,
        totalPages: 3,
      });
    });

    it('defaults to page 1 with 20 rows', async () => {
      const qb = makeQb([], 0);

      await service.findBatches({}, TENANT);

      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('does not leak each batch skip list into the list rows', async () => {
      makeQb([batchRow], 1);

      const result = await service.findBatches({}, TENANT);

      expect(result.data[0]).not.toHaveProperty('skipped');
      expect(result.data[0]).not.toHaveProperty('filters_applied');
    });

    // [8.14.9] search matches batch_name, escaped so % / _ can't act as
    // wildcards.
    it('filters by search over batch_name, LIKE-escaped', async () => {
      const qb = makeQb([batchRow], 1);

      await service.findBatches({ search: '100%' }, TENANT);

      expect(qb.andWhere).toHaveBeenCalledWith('batch.batch_name ILIKE :search', {
        search: '%100\\%%',
      });
    });

    it('filters by status', async () => {
      const qb = makeQb([], 0);

      await service.findBatches({ status: ReminderBatchStatus.FAILED }, TENANT);

      expect(qb.andWhere).toHaveBeenCalledWith('batch.status = :status', {
        status: ReminderBatchStatus.FAILED,
      });
    });

    // [8.14.9] sort=batch_name needs Bengali-collated ordering, which
    // FindOptionsOrder cannot express — this is why findBatches is a query
    // builder now instead of findAndCount.
    it('sorts by batch_name using the Bengali collation', async () => {
      const qb = makeQb([], 0);

      await service.findBatches({ sort: 'batch_name', order: 'asc' }, TENANT);

      expect(qb.orderBy).toHaveBeenCalledWith('batch.batch_name COLLATE "bn_icu"', 'ASC');
    });

    it('sorts by total_recipients', async () => {
      const qb = makeQb([], 0);

      await service.findBatches({ sort: 'total_recipients', order: 'desc' }, TENANT);

      expect(qb.orderBy).toHaveBeenCalledWith('batch.total_recipients', 'DESC');
    });
  });

  // findLogs: real SQL, so its filters are proven in reminders.service.integration.spec.ts.

  describe('findBatchLogs', () => {
    const logRow = {
      id: 'log-1',
      medium: CommunicationMedium.SMS,
      recipient_address: '01712345678',
      recipient_name: 'Karim Uddin',
      status: CommunicationStatus.FAILED,
      trigger: CommunicationTrigger.BULK_REMINDER,
      student_id: 's-1',
      guardian_id: 'g-1',
      provider_message_id: null,
      metadata: { error: 'No provider registered for medium "SMS"' },
      created_at: new Date('2026-03-01T00:00:00Z'),
      message_body: 'Dear guardian',
      subject: null,
      reminder_batch_id: 'batch-1',
      sent_by_user_id: 'user-1',
      sent_by: { full_name: 'Rahima Akter' },
    };

    let qb: any;
    beforeEach(() => {
      batchRepo.findOne.mockResolvedValue({ id: 'batch-1', tenant_id: TENANT });
      qb = {
        leftJoin: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[logRow], 1]),
      };
      logRepo.createQueryBuilder = vi.fn(() => qb);
    });

    it('throws NotFound for a batch belonging to another tenant, before touching the logs', async () => {
      batchRepo.findOne.mockResolvedValue(null);

      await expect(service.findBatchLogs('batch-1', {}, 'other-tenant', 'ADMIN')).rejects.toThrow(
        NotFoundException,
      );
      expect(batchRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'batch-1', tenant_id: 'other-tenant' },
      });
      expect(logRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('pages the batch logs, scoped to both the batch and the tenant, with the sender name only', async () => {
      qb.getManyAndCount.mockResolvedValue([[logRow], 101]);

      const result = await service.findBatchLogs(
        'batch-1',
        { page: 2, limit: 50 },
        TENANT,
        'ADMIN',
      );

      expect(qb.where).toHaveBeenCalledWith('log.tenant_id = :tenantId', { tenantId: TENANT });
      expect(qb.andWhere).toHaveBeenCalledWith('log.reminder_batch_id = :id', { id: 'batch-1' });
      // The sender's name, never the whole user row (password_hash), #3351 r2.
      expect(qb.addSelect).toHaveBeenCalledWith(['sender.id', 'sender.full_name']);
      expect(qb.orderBy).toHaveBeenCalledWith('log.created_at', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('log.id', 'DESC');
      expect(qb.offset).toHaveBeenCalledWith(50);
      expect(qb.limit).toHaveBeenCalledWith(50);
      expect(result.total).toBe(101);
      expect(result.totalPages).toBe(3);
    });

    it('surfaces the worker failure reason so FAILED rows are never unexplained', async () => {
      qb.getManyAndCount.mockResolvedValue([[logRow], 1]);

      const result = await service.findBatchLogs('batch-1', {}, TENANT, 'ADMIN');

      expect(result.data[0]).toEqual({
        id: 'log-1',
        medium: CommunicationMedium.SMS,
        recipient_address: '01712345678',
        recipient_name: 'Karim Uddin',
        status: CommunicationStatus.FAILED,
        trigger: CommunicationTrigger.BULK_REMINDER,
        student_id: 's-1',
        guardian_id: 'g-1',
        provider_message_id: null,
        // No metadata.provider: the send never reached a company.
        provider: null,
        error: 'NO_PROVIDER',
        created_at: logRow.created_at,
        message_body: 'Dear guardian',
        body_withheld: false,
        subject: null,
        segments: countSmsSegments('Dear guardian').segments,
        batch_id: 'batch-1',
        is_test: false,
        sent_by_user_id: 'user-1',
        sent_by_name: 'Rahima Akter',
        // FAILED: nothing to ask the company.
        can_check_status: false,
      });
    });

    it('returns a null error when the log has no metadata', async () => {
      qb.getManyAndCount.mockResolvedValue([[{ ...logRow, metadata: null }], 1]);

      const result = await service.findBatchLogs('batch-1', {}, TENANT, 'ADMIN');

      expect(result.data[0].error).toBeNull();
    });
  });
});

// [97.4.02] D22/D23: what one message-log row carries.
describe('toBatchLogDto / canCheckStatus', () => {
  // onecodesoft is the one real SMS company that declares the `status` capability.
  function log(overrides: Partial<CommunicationLog> = {}): CommunicationLog {
    return {
      id: 'log-1',
      medium: CommunicationMedium.SMS,
      recipient_address: '01712345678',
      recipient_name: 'Karim',
      message_body: 'Dues are 500 taka',
      subject: null,
      status: CommunicationStatus.SENT,
      trigger: CommunicationTrigger.MANUAL,
      student_id: null,
      guardian_id: null,
      sent_by_user_id: 'user-1',
      sent_by: null,
      reminder_batch_id: 'batch-1',
      provider_message_id: 'vendor-1',
      metadata: { provider: 'onecodesoft' },
      created_at: new Date('2026-10-20T09:00:00Z'),
      ...overrides,
    } as CommunicationLog;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a SENT row with a company id from a company that reports delivery can be checked', () => {
    expect(canCheckStatus(log())).toBe(true);
  });

  it('a row that is not SENT cannot be checked', () => {
    expect(canCheckStatus(log({ status: CommunicationStatus.DELIVERED }))).toBe(false);
    expect(canCheckStatus(log({ status: CommunicationStatus.FAILED }))).toBe(false);
  });

  it('a row with no company message id cannot be checked', () => {
    expect(canCheckStatus(log({ provider_message_id: null }))).toBe(false);
  });

  it('a row with no company, or a company without the status capability, cannot be checked', () => {
    expect(canCheckStatus(log({ metadata: null }))).toBe(false);
    expect(canCheckStatus(log({ metadata: { provider: 'greenweb' } }))).toBe(false);
    // A name the app does not know (an old or made-up value) is false, never a guess.
    expect(canCheckStatus(log({ metadata: { provider: 'stub-sms' } }))).toBe(false);
  });

  it('a company name on the wrong channel cannot be checked', () => {
    expect(canCheckStatus(log({ medium: CommunicationMedium.EMAIL }))).toBe(false);
  });

  it('nothing can be checked in test-inbox mode (MESSAGE_SINK=mailpit)', () => {
    vi.stubEnv('MESSAGE_SINK', 'mailpit');
    expect(canCheckStatus(log())).toBe(false);
  });

  it('carries the D22 detail fields: body, segments, round, test flag and sender', () => {
    const row = toBatchLogDto(
      log({
        metadata: { provider: 'onecodesoft', segments: 2, test: true },
        sent_by: { full_name: 'Rahima Akter' } as CommunicationLog['sent_by'],
      }),
      'ADMIN',
    );
    expect(row).toMatchObject({
      message_body: 'Dues are 500 taka',
      subject: null,
      segments: 2,
      batch_id: 'batch-1',
      is_test: true,
      sent_by_user_id: 'user-1',
      sent_by_name: 'Rahima Akter',
      can_check_status: true,
    });
  });

  it('counts SMS segments from the text when the send did not record them; null for email', () => {
    expect(toBatchLogDto(log({ metadata: null }), 'ADMIN').segments).toBe(
      countSmsSegments('Dues are 500 taka').segments,
    );
    expect(toBatchLogDto(log({ medium: CommunicationMedium.EMAIL }), 'ADMIN').segments).toBe(null);
  });

  it('a sign-in SMS with no recorded count has no SMS parts (its stored text is redacted)', () => {
    const signIn = { trigger: CommunicationTrigger.ACCOUNT_ACCESS, message_body: 'Code: ••••••' };
    expect(toBatchLogDto(log({ ...signIn, metadata: null }), 'ADMIN').segments).toBe(null);
    expect(toBatchLogDto(log({ ...signIn, metadata: { segments: 2 } }), 'ADMIN').segments).toBe(2);
  });

  // [#3351 r2] Rule 16 + RESULT_READ, at read time only.
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';
  const receipt = `Invoice INV-1 paid. See it: https://app.example/i/${TOKEN} Thanks`;

  it('masks every invoice share token, whatever the kind; counts parts from the stored text', () => {
    for (const trigger of [CommunicationTrigger.AUTOMATED, CommunicationTrigger.MANUAL]) {
      const row = toBatchLogDto(
        log({ trigger, message_body: receipt, metadata: null }),
        'ACCOUNTANT',
      );
      expect(row.message_body).toBe(
        'Invoice INV-1 paid. See it: https://app.example/i/•••••• Thanks',
      );
      expect(row.message_body).not.toContain(TOKEN);
      expect(row.body_withheld).toBe(false);
      expect(row.segments).toBe(countSmsSegments(receipt).segments);
    }
    expect(
      visibleLogBody(
        { trigger: CommunicationTrigger.MANUAL, message_body: 'a /i/x and /i/y' },
        'ADMIN',
      ),
    ).toBe('a /i/•••••• and /i/••••••');
  });

  it('an exam result body is withheld without RESULT_READ (Accountant), shown with it', () => {
    const result = log({
      trigger: CommunicationTrigger.RESULT_SMS,
      message_body: 'Karim: GPA 4.50',
    });
    expect(toBatchLogDto(result, 'ACCOUNTANT')).toMatchObject({
      message_body: null,
      body_withheld: true,
    });
    for (const role of ['ADMIN', 'OFFICE_STAFF']) {
      expect(toBatchLogDto(result, role)).toMatchObject({
        message_body: 'Karim: GPA 4.50',
        body_withheld: false,
      });
    }
    // An unknown role holds nothing, so it is withheld too.
    expect(visibleLogBody(result, 'nope')).toBe(null);
  });

  it('an automatic send has no sender, and a row is not a test unless metadata says so', () => {
    const row = toBatchLogDto(log({ sent_by_user_id: null, metadata: { test: 'yes' } }), 'ADMIN');
    expect(row.sent_by_name).toBe(null);
    expect(row.is_test).toBe(false);
  });
});

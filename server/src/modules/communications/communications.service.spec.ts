import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';

describe('CommunicationsService', () => {
  let service: CommunicationsService;
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let queue: Record<string, ReturnType<typeof vi.fn>>;
  let studentService: Record<string, ReturnType<typeof vi.fn>>;
  let guardianService: Record<string, ReturnType<typeof vi.fn>>;
  let smsCreditService: Record<string, ReturnType<typeof vi.fn>>;

  const TENANT_ID = 'tenant-1';
  const USER_ID = 'user-1';

  let queryBuilder: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    queryBuilder = {
      distinctOn: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      addOrderBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
    };
    repo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ id: 'log-1', created_at: new Date(), ...data })),
      findOne: vi.fn(),
      find: vi.fn(),
      createQueryBuilder: vi.fn(() => queryBuilder),
    };
    queue = { add: vi.fn() };
    studentService = { findOne: vi.fn() };
    guardianService = { findOne: vi.fn() };
    smsCreditService = {
      settlePart: vi.fn(async () => undefined),
      // [#2216] Unmetered unless a test says otherwise.
      reserveIfMetered: vi.fn(async () => 'UNMETERED'),
    };

    service = new CommunicationsService(
      repo as any,
      queue as any,
      studentService as any,
      guardianService as any,
      smsCreditService as any,
    );
  });

  describe('enqueue', () => {
    const baseDto = {
      medium: CommunicationMedium.SMS,
      recipient_address: '01712345678',
      recipient_name: 'Guardian',
      message_body: 'Hello',
    };

    it('writes a QUEUED log row stamped with the tenant, and pushes a job onto the queue', async () => {
      const result = await service.enqueue(baseDto as any, TENANT_ID, USER_ID);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT_ID,
          status: CommunicationStatus.QUEUED,
          sent_by_user_id: USER_ID,
        }),
      );
      expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
      expect(result.id).toBe('log-1');
    });

    it('validates student_id against the tenant before enqueuing', async () => {
      studentService.findOne.mockResolvedValue({ id: 'student-1', tenant_id: TENANT_ID });

      await service.enqueue({ ...baseDto, student_id: 'student-1' } as any, TENANT_ID, USER_ID);

      expect(studentService.findOne).toHaveBeenCalledWith('student-1', TENANT_ID);
    });

    it('propagates NotFoundException when student_id does not belong to the tenant', async () => {
      studentService.findOne.mockRejectedValue(new NotFoundException('Student not found'));

      await expect(
        service.enqueue({ ...baseDto, student_id: 'student-1' } as any, TENANT_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException when guardian_id does not belong to the tenant', async () => {
      guardianService.findOne.mockRejectedValue(new NotFoundException('Guardian not found'));

      await expect(
        service.enqueue({ ...baseDto, guardian_id: 'guardian-1' } as any, TENANT_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('marks the log FAILED and throws when the queue rejects the enqueue', async () => {
      queue.add.mockRejectedValue(new Error('Redis unreachable'));

      await expect(service.enqueue(baseDto as any, TENANT_ID, USER_ID)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(repo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: CommunicationStatus.FAILED }),
      );
    });
  });

  describe('sendToGuardian [#2259]', () => {
    const guardian = {
      id: 'g-1',
      full_name: 'Real Guardian',
      phone: '01711111111',
      alternate_phone: null,
      email: 'g@example.com',
    };
    const dto = { medium: CommunicationMedium.SMS, message_body: 'Hello', guardian_id: 'g-1' };

    beforeEach(() => {
      guardianService.findOne.mockResolvedValue(guardian);
    });

    it('sends SMS to the guardian stored phone and name, ignoring client-sent address', async () => {
      await service.sendToGuardian(
        { ...dto, recipient_address: '01999999999', recipient_name: 'Spoof' } as any,
        TENANT_ID,
        USER_ID,
      );
      expect(guardianService.findOne).toHaveBeenCalledWith('g-1', TENANT_ID);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient_address: '01711111111',
          recipient_name: 'Real Guardian',
          guardian_id: 'g-1',
        }),
      );
    });

    it('uses the guardian email for EMAIL', async () => {
      await service.sendToGuardian(
        { ...dto, medium: CommunicationMedium.EMAIL } as any,
        TENANT_ID,
        USER_ID,
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ recipient_address: 'g@example.com' }),
      );
    });

    it('400 GUARDIAN_NO_ADDRESS when the guardian has no address for the channel', async () => {
      guardianService.findOne.mockResolvedValue({ ...guardian, email: null });
      const err = await service
        .sendToGuardian({ ...dto, medium: CommunicationMedium.EMAIL } as any, TENANT_ID, USER_ID)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().details.code).toBe('GUARDIAN_NO_ADDRESS');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('400 GUARDIAN_NOT_LINKED when student_id is not linked to the guardian', async () => {
      studentService.findOne.mockResolvedValue({ id: 's-1', guardians: [{ id: 'other' }] });
      const err = await service
        .sendToGuardian({ ...dto, student_id: 's-1' } as any, TENANT_ID, USER_ID)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().details.code).toBe('GUARDIAN_NOT_LINKED');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('accepts a linked student', async () => {
      studentService.findOne.mockResolvedValue({ id: 's-1', guardians: [{ id: 'g-1' }] });
      await service.sendToGuardian({ ...dto, student_id: 's-1' } as any, TENANT_ID, USER_ID);
      expect(repo.save).toHaveBeenCalled();
    });

    it('propagates 404 for another tenant guardian', async () => {
      guardianService.findOne.mockRejectedValue(new NotFoundException('nope'));
      await expect(service.sendToGuardian(dto as any, TENANT_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('enqueue reserves for an unreserved SMS [#2216]', () => {
    const dto = {
      medium: CommunicationMedium.SMS,
      recipient_address: '01712345678',
      recipient_name: 'Guardian',
      message_body: 'Hello',
    };

    it('metered + credit: reserves and the job carries batchId and segments', async () => {
      smsCreditService.reserveIfMetered.mockResolvedValue('RESERVED');
      await service.enqueue(dto as any, TENANT_ID, USER_ID);
      expect(queue.add).toHaveBeenCalledWith('send', {
        logId: 'log-1',
        batchId: expect.any(String),
        segments: 1,
      });
    });

    it('metered + 0 credit: 409 INSUFFICIENT_SMS_CREDIT, nothing saved or queued', async () => {
      smsCreditService.reserveIfMetered.mockResolvedValue({ insufficient: true, available: 0 });
      await expect(service.enqueue(dto as any, TENANT_ID, USER_ID)).rejects.toMatchObject({
        status: 409,
        response: { details: { code: 'INSUFFICIENT_SMS_CREDIT', required: 1, available: 0 } },
      });
      expect(repo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('a caller-supplied reservation is not reserved again', async () => {
      await service.enqueue(dto as any, TENANT_ID, USER_ID, { batchId: 'b', segments: 1 });
      expect(smsCreditService.reserveIfMetered).not.toHaveBeenCalled();
    });
  });

  describe('enqueue credit release on queue failure', () => {
    const dto = {
      medium: CommunicationMedium.SMS,
      recipient_address: '01712345678',
      recipient_name: 'Guardian',
      message_body: 'Hello',
    };

    it('releases under batch:<batchId> when queue.add fails', async () => {
      queue.add.mockRejectedValue(new Error('Redis unreachable'));
      await expect(
        service.enqueue(dto as any, TENANT_ID, USER_ID, { batchId: 'incident:X', segments: 2 }),
      ).rejects.toThrow(InternalServerErrorException);
      expect(smsCreditService.settlePart).toHaveBeenCalledWith(
        TENANT_ID,
        'batch:incident:X',
        'log:log-1',
        2,
        'RELEASE',
      );
    });

    it('releases with an enqueue-failed: part key when the log save throws', async () => {
      const boom = new Error('db down');
      repo.save.mockRejectedValueOnce(boom);
      await expect(
        service.enqueue(dto as any, TENANT_ID, USER_ID, { batchId: 'incident:X', segments: 2 }),
      ).rejects.toBe(boom);
      expect(smsCreditService.settlePart).toHaveBeenCalledWith(
        TENANT_ID,
        'batch:incident:X',
        expect.stringMatching(/^enqueue-failed:/),
        2,
        'RELEASE',
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('no reservation: no settlePart', async () => {
      queue.add.mockRejectedValue(new Error('Redis unreachable'));
      await expect(service.enqueue(dto as any, TENANT_ID, USER_ID)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(smsCreditService.settlePart).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('scopes the lookup to the log id and the caller tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: 'log-1',
        tenant_id: TENANT_ID,
        medium: CommunicationMedium.SMS,
        recipient_address: '01712345678',
        recipient_name: 'Guardian',
        status: CommunicationStatus.SENT,
        provider_message_id: 'p-1',
        created_at: new Date(),
      });

      const result = await service.findOne('log-1', TENANT_ID);

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'log-1', tenant_id: TENANT_ID } });
      expect(result.id).toBe('log-1');
    });

    it.each([
      [{ error: 'SMS (Greenweb) is not configured for this tenant' }, 'NOT_CONFIGURED'],
      [{ error: 'No provider registered for medium "SMS"' }, 'NO_PROVIDER'],
      // [2683] Raw provider text never reaches the response (Rule 23).
      [{ error: 'Gateway https://gw.example/acct-9 rejected 01712345678' }, 'FAILED'],
      [null, null],
      [{}, null],
      [{ error: 42 }, null],
      // #3351: a Check status "not delivered" has no `error`; the vendor code stays out (Rule 23).
      [
        { delivery: { status: 'FAILED', code: '1001', checkedAt: '2026-10-31T10:00:00.000Z' } },
        'FAILED',
      ],
      [{ delivery: { status: 'PENDING', checkedAt: '2026-10-31T10:00:00.000Z' } }, null],
      [
        { error: 'No provider registered for medium "SMS"', delivery: { status: 'FAILED' } },
        'NO_PROVIDER',
      ],
    ])('[#2604] maps metadata %j to error %j', async (metadata, expected) => {
      repo.findOne.mockResolvedValue({
        id: 'log-1',
        tenant_id: TENANT_ID,
        medium: CommunicationMedium.SMS,
        recipient_address: '01712345678',
        recipient_name: 'Guardian',
        status: CommunicationStatus.FAILED,
        provider_message_id: null,
        metadata,
        created_at: new Date(),
      });

      const result = await service.findOne('log-1', TENANT_ID);

      expect(result.error).toBe(expected);
    });

    it('throws NotFoundException when no row matches the id + tenant pair', async () => {
      // The mocked repo mirrors what a real tenant-scoped WHERE would
      // return for a missing row or one belonging to a different tenant —
      // both cases return no match.
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne('log-1', TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByStudent', () => {
    // [8.10.2]'s Communication tab.
    it('scopes the query to the student and the caller tenant, newest first', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'log-2',
          medium: CommunicationMedium.SMS,
          recipient_address: '01712345678',
          recipient_name: 'Guardian',
          status: CommunicationStatus.SENT,
          provider_message_id: null,
          created_at: new Date('2026-02-01'),
        },
      ]);

      const result = await service.findByStudent('student-1', TENANT_ID);

      expect(repo.find).toHaveBeenCalledWith({
        where: { student_id: 'student-1', tenant_id: TENANT_ID },
        order: { created_at: 'DESC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('log-2');
    });

    it('resolves an empty array for a student nothing has ever been sent to', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.findByStudent('student-1', TENANT_ID);

      expect(result).toEqual([]);
    });
  });

  describe('findByGuardian', () => {
    // [8.11.4]'s Communication History tab.
    it('verifies the guardian belongs to the tenant, then scopes the query to the guardian', async () => {
      guardianService.findOne.mockResolvedValue({ id: 'guardian-1', tenant_id: TENANT_ID });
      repo.find.mockResolvedValue([
        {
          id: 'log-3',
          medium: CommunicationMedium.SMS,
          recipient_address: '01712345678',
          recipient_name: 'Guardian',
          status: CommunicationStatus.SENT,
          provider_message_id: null,
          created_at: new Date('2026-02-02'),
        },
      ]);

      const result = await service.findByGuardian('guardian-1', TENANT_ID);

      expect(guardianService.findOne).toHaveBeenCalledWith('guardian-1', TENANT_ID);
      expect(repo.find).toHaveBeenCalledWith({
        where: { guardian_id: 'guardian-1', tenant_id: TENANT_ID },
        order: { created_at: 'DESC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('log-3');
    });

    it('propagates NotFoundException for a guardian outside the tenant, without querying logs', async () => {
      guardianService.findOne.mockRejectedValue(new NotFoundException('Guardian not found'));

      await expect(service.findByGuardian('guardian-1', TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('findLastReminders', () => {
    // [8.10.4]'s dues queue "Last reminder" column.
    it('returns a map of student_id to the most recent reminder', async () => {
      const sentAt = new Date('2026-03-01');
      queryBuilder.getRawMany.mockResolvedValue([
        { student_id: 'student-1', medium: CommunicationMedium.SMS, sent_at: sentAt },
      ]);

      const result = await service.findLastReminders(['student-1'], TENANT_ID);

      expect(result.get('student-1')).toEqual({ sent_at: sentAt, medium: CommunicationMedium.SMS });
    });

    it('scopes the query to BULK_REMINDER and SINGLE_REMINDER triggers only, excluding MANUAL', async () => {
      await service.findLastReminders(['student-1'], TENANT_ID);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('log.trigger IN (:...triggers)', {
        triggers: [CommunicationTrigger.BULK_REMINDER, CommunicationTrigger.SINGLE_REMINDER],
      });
    });

    // Tenant isolation: a Tenant A caller must never see Tenant B's
    // reminder history for a student id it happens to also pass in,
    // same coverage `findOne`'s tenant_id assertion above already gives
    // the single-log lookup.
    it("scopes the query to the caller's own tenant", async () => {
      await service.findLastReminders(['student-1'], TENANT_ID);

      expect(queryBuilder.where).toHaveBeenCalledWith('log.tenant_id = :tenantId', {
        tenantId: TENANT_ID,
      });
    });

    it('resolves an empty map without querying when no student IDs are given', async () => {
      const result = await service.findLastReminders([], TENANT_ID);

      expect(result.size).toBe(0);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});

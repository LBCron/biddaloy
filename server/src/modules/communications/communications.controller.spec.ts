import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { BulkReminderService } from './reminders.service';
import { SingleReminderService } from './single-reminder.service';
import { CommunicationMedium, UserRole } from '@biddaloy/shared';
import { FamilyAccessService } from '../students/family-access.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { DeliveryStatusService } from './delivery-status.service';
import { STRICT_RATE_LIMIT } from '../../rate-limit';

// @nestjs/throttler's metadata keys (not exported from the package root).
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';

/**
 * Unit tests for CommunicationsController.
 *
 * Verifies each endpoint correctly delegates to the service layer with the
 * right arguments, and errors propagate through unchanged. Guard/decorator
 * behaviour (@Roles, ContextGuard's X-Tenant-ID handling) is tested
 * separately in auth specs, matching the convention used by the other
 * controller specs in this codebase (see EnrollmentController/UserController).
 */

describe('CommunicationsController', () => {
  let controller: CommunicationsController;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let bulkReminderService: Record<string, ReturnType<typeof vi.fn>>;
  let singleReminderService: Record<string, ReturnType<typeof vi.fn>>;
  let familyAccess: Record<string, ReturnType<typeof vi.fn>>;
  let teacherScope: Record<string, ReturnType<typeof vi.fn>>;
  let deliveryStatus: Record<string, ReturnType<typeof vi.fn>>;

  const TENANT = { id: 'tenant-1', role: UserRole.ADMIN };
  const USER = { sub: 'user-1', memberships: [] } as any;
  const REQUEST = { ip: '1.2.3.4', headers: { 'user-agent': 'test-agent' } } as any;
  const REQUEST_CONTEXT = { ip: '1.2.3.4', userAgent: 'test-agent' };

  beforeEach(() => {
    service = {
      enqueue: vi.fn(),
      sendToGuardian: vi.fn(),
      findOne: vi.fn(),
      findByStudent: vi.fn(),
      findByGuardian: vi.fn(),
      findLastReminders: vi.fn(),
    };
    bulkReminderService = {
      sendBulk: vi.fn(),
      findBatch: vi.fn(),
      previewBulk: vi.fn(),
      findBatches: vi.fn(),
      findBatchLogs: vi.fn(),
      findLogs: vi.fn(),
    };
    singleReminderService = { preview: vi.fn(), sendSingle: vi.fn() };
    familyAccess = { assertLinked: vi.fn() };
    // `scopedStudentIds` null = unrestricted staff; `assertCanSeeGuardian` is a no-op for them.
    teacherScope = {
      scopedStudentIds: vi.fn().mockResolvedValue(null),
      assertCanSeeGuardian: vi.fn().mockResolvedValue(undefined),
    };
    deliveryStatus = { checkStatus: vi.fn() };
    controller = new CommunicationsController(
      service as unknown as CommunicationsService,
      bulkReminderService as unknown as BulkReminderService,
      singleReminderService as unknown as SingleReminderService,
      familyAccess as unknown as FamilyAccessService,
      teacherScope as unknown as TeacherScopeService,
      deliveryStatus as unknown as DeliveryStatusService,
    );
  });

  describe('send', () => {
    it('should call service.sendToGuardian with dto, tenant id, and user id', async () => {
      const dto = { medium: CommunicationMedium.SMS, message_body: 'Hello', guardian_id: 'g-1' };
      const expected = { id: 'log-1' };
      service.sendToGuardian.mockResolvedValue(expected);

      const result = await controller.send(dto as any, TENANT, USER);

      expect(service.sendToGuardian).toHaveBeenCalledWith(dto, TENANT.id, USER.sub);
      expect(result).toEqual(expected);
    });
  });

  describe('findOne', () => {
    it('should call service.findOne with id and tenant id', async () => {
      const expected = { id: 'log-1', status: 'SENT' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('log-1', TENANT, USER);

      expect(service.findOne).toHaveBeenCalledWith('log-1', TENANT.id);
      expect(result).toEqual(expected);
    });
  });

  describe('error propagation', () => {
    it('should propagate NotFoundException from service.sendToGuardian', async () => {
      service.sendToGuardian.mockRejectedValue(new NotFoundException('Student not found'));

      await expect(
        controller.send(
          {
            medium: CommunicationMedium.SMS,
            recipient_address: '01712345678',
            recipient_name: 'Guardian',
            message_body: 'Hello',
            student_id: 'bad',
          } as any,
          TENANT,
          USER,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate NotFoundException from service.findOne', async () => {
      service.findOne.mockRejectedValue(new NotFoundException('Communication log not found'));

      await expect(controller.findOne('bad', TENANT, USER)).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException from bulkReminderService.sendBulk', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      bulkReminderService.sendBulk.mockRejectedValue(
        new BadRequestException('Unsupported template placeholder(s): parent'),
      );

      await expect(
        controller.sendBulkReminder(
          { student_ids: ['s-1'], message_template: '{{parent}}' } as any,
          TENANT,
          USER,
          REQUEST,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendBulkReminder', () => {
    it('should call bulkReminderService.sendBulk with dto, tenant id, user id, and request context', async () => {
      const dto = { student_ids: ['s-1'], message_template: 'Dear {{guardian_name}}' };
      const expected = { id: 'batch-1', total_recipients: 1 };
      bulkReminderService.sendBulk.mockResolvedValue(expected);

      const result = await controller.sendBulkReminder(dto as any, TENANT, USER, REQUEST);

      expect(bulkReminderService.sendBulk).toHaveBeenCalledWith(
        dto,
        TENANT.id,
        USER.sub,
        REQUEST_CONTEXT,
      );
      expect(result).toEqual(expected);
    });
  });

  describe('findReminderBatch', () => {
    it('should call bulkReminderService.findBatch with id and tenant id', async () => {
      const expected = { id: 'batch-1', status: 'COMPLETED' };
      bulkReminderService.findBatch.mockResolvedValue(expected);

      const result = await controller.findReminderBatch('batch-1', TENANT);

      expect(bulkReminderService.findBatch).toHaveBeenCalledWith('batch-1', TENANT.id);
      expect(result).toEqual(expected);
    });

    it('should propagate NotFoundException for a batch in another tenant', async () => {
      bulkReminderService.findBatch.mockRejectedValue(new NotFoundException('not found'));

      await expect(controller.findReminderBatch('batch-1', TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('previewBulkReminder', () => {
    it('should call bulkReminderService.previewBulk with dto, tenant id, user id, and request context', async () => {
      const dto = { student_ids: ['s-1'], message_template: 'Dear {{guardian_name}}' };
      const expected = { total_students: 1, recipients_count: 1, skipped_count: 0, students: [] };
      bulkReminderService.previewBulk.mockResolvedValue(expected);

      // Preview resolves and returns guardian contact data, so it is audited
      // like the send route: the caller and their request context travel with it.
      const result = await controller.previewBulkReminder(dto as any, TENANT, USER, REQUEST);

      expect(bulkReminderService.previewBulk).toHaveBeenCalledWith(
        dto,
        TENANT.id,
        USER.sub,
        REQUEST_CONTEXT,
      );
      expect(result).toEqual(expected);
    });

    it('should propagate BadRequestException from bulkReminderService.previewBulk', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      bulkReminderService.previewBulk.mockRejectedValue(
        new BadRequestException('Unsupported template placeholder(s): parent'),
      );

      await expect(
        controller.previewBulkReminder(
          { student_ids: ['s-1'], message_template: '{{parent}}' } as any,
          TENANT,
          USER,
          REQUEST,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findReminderBatches', () => {
    it('should call bulkReminderService.findBatches with the query and tenant id', async () => {
      const query = { page: 2, limit: 10 };
      const expected = { data: [], total: 0, page: 2, limit: 10, totalPages: 0 };
      bulkReminderService.findBatches.mockResolvedValue(expected);

      const result = await controller.findReminderBatches(query as any, TENANT);

      expect(bulkReminderService.findBatches).toHaveBeenCalledWith(query, TENANT.id);
      expect(result).toEqual(expected);
    });
  });

  describe('checkStatus', () => {
    it('passes the log id, the caller tenant and role to DeliveryStatusService', async () => {
      const expected = { id: 'log-1', status: 'DELIVERED' };
      deliveryStatus.checkStatus.mockResolvedValue(expected);

      const result = await controller.checkStatus('log-1', TENANT);

      expect(deliveryStatus.checkStatus).toHaveBeenCalledWith('log-1', TENANT.id, TENANT.role);
      expect(result).toBe(expected);
    });

    // CodeRabbit on #3347: the 60 s cooldown is per log, so the route itself is capped too.
    // Metadata, not behaviour: app.module.ts skips throttling when NODE_ENV === 'test'.
    it('carries STRICT_RATE_LIMIT, so many logs in a row cannot flood the vendor', () => {
      const handler = CommunicationsController.prototype.checkStatus;
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(
        STRICT_RATE_LIMIT.limit,
      );
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(STRICT_RATE_LIMIT.ttl);
    });
  });

  describe('findLogs', () => {
    it('should call bulkReminderService.findLogs with query, tenant id and role', async () => {
      const query = { status: 'FAILED', medium: 'SMS' };
      const expected = { data: [], total: 0, page: 1, limit: 25, totalPages: 0 };
      bulkReminderService.findLogs.mockResolvedValue(expected);

      const result = await controller.findLogs(query as any, TENANT);

      expect(bulkReminderService.findLogs).toHaveBeenCalledWith(query, TENANT.id, TENANT.role);
      expect(result).toEqual(expected);
    });
  });

  describe('findReminderBatchLogs', () => {
    it('should call bulkReminderService.findBatchLogs with id, query, tenant id and role', async () => {
      const query = { page: 1, limit: 50 };
      const expected = { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
      bulkReminderService.findBatchLogs.mockResolvedValue(expected);

      const result = await controller.findReminderBatchLogs('batch-1', query as any, TENANT);

      expect(bulkReminderService.findBatchLogs).toHaveBeenCalledWith(
        'batch-1',
        query,
        TENANT.id,
        TENANT.role,
      );
      expect(result).toEqual(expected);
    });

    it('should propagate NotFoundException for a batch in another tenant', async () => {
      bulkReminderService.findBatchLogs.mockRejectedValue(new NotFoundException('not found'));

      await expect(controller.findReminderBatchLogs('batch-1', {} as any, TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('previewSingleReminder', () => {
    it('should call singleReminderService.preview with studentId, dto, and tenant id', async () => {
      const dto = { message_template: 'Dear {{guardian_name}}' };
      const expected = { student_id: 's-1', recipients: [], skipped: [] };
      singleReminderService.preview.mockResolvedValue(expected);

      const result = await controller.previewSingleReminder('s-1', dto as any, TENANT);

      expect(singleReminderService.preview).toHaveBeenCalledWith('s-1', dto, TENANT.id);
      expect(result).toEqual(expected);
    });

    it('should propagate BadRequestException from singleReminderService.preview', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      singleReminderService.preview.mockRejectedValue(new BadRequestException('no open dues'));

      await expect(
        controller.previewSingleReminder('s-1', { message_template: 'Hi' } as any, TENANT),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendSingleReminder', () => {
    it('should call singleReminderService.sendSingle with studentId, dto, tenant id, user id, and request context', async () => {
      const dto = { message_template: 'Dear {{guardian_name}}' };
      const expected = { student_id: 's-1', sent: [], skipped: [] };
      singleReminderService.sendSingle.mockResolvedValue(expected);

      const result = await controller.sendSingleReminder('s-1', dto as any, TENANT, USER, REQUEST);

      expect(singleReminderService.sendSingle).toHaveBeenCalledWith(
        's-1',
        dto,
        TENANT.id,
        USER.sub,
        REQUEST_CONTEXT,
      );
      expect(result).toEqual(expected);
    });

    it('should propagate NotFoundException from singleReminderService.sendSingle', async () => {
      singleReminderService.sendSingle.mockRejectedValue(new NotFoundException('not found'));

      await expect(
        controller.sendSingleReminder(
          's-1',
          { message_template: 'Hi' } as any,
          TENANT,
          USER,
          REQUEST,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByStudent', () => {
    it('should call service.findByStudent with student id and tenant id', async () => {
      const expected = [{ id: 'log-1', recipient_name: 'Guardian' }];
      service.findByStudent.mockResolvedValue(expected);

      const result = await controller.findByStudent('student-1', TENANT, USER);

      expect(service.findByStudent).toHaveBeenCalledWith('student-1', TENANT.id);
      expect(result).toEqual(expected);
      expect(familyAccess.assertLinked).not.toHaveBeenCalled();
    });

    // [75.6-d] A TEACHER must be linked to the student; a 404 from the check stops the read.
    it('for a TEACHER calls assertLinked first and does not read when it throws', async () => {
      familyAccess.assertLinked.mockRejectedValue(new NotFoundException());

      await expect(
        controller.findByStudent('student-1', { id: TENANT.id, role: UserRole.TEACHER }, USER),
      ).rejects.toThrow(NotFoundException);

      expect(familyAccess.assertLinked).toHaveBeenCalledWith(
        UserRole.TEACHER,
        USER.sub,
        'student-1',
        TENANT.id,
      );
      expect(service.findByStudent).not.toHaveBeenCalled();
    });
  });

  describe('findByGuardian', () => {
    it('should call service.findByGuardian with guardian id and tenant id', async () => {
      const expected = [{ id: 'log-1', recipient_name: 'Guardian' }];
      service.findByGuardian.mockResolvedValue(expected);

      const result = await controller.findByGuardian('guardian-1', TENANT, USER);

      expect(service.findByGuardian).toHaveBeenCalledWith('guardian-1', TENANT.id, undefined);
      expect(result).toEqual(expected);
    });
  });

  describe('findLastReminders', () => {
    // [8.10.4]'s dues queue "Last reminder" column.
    it('should call service.findLastReminders with the parsed student ids and tenant id, flattening the map into an array', async () => {
      const sentAt = new Date('2026-03-01');
      service.findLastReminders.mockResolvedValue(
        new Map([['student-1', { sent_at: sentAt, medium: CommunicationMedium.SMS }]]),
      );

      const result = await controller.findLastReminders(
        { student_ids: ['student-1', 'student-2'] } as any,
        TENANT,
        USER,
      );

      expect(service.findLastReminders).toHaveBeenCalledWith(['student-1', 'student-2'], TENANT.id);
      expect(result).toEqual([
        { student_id: 'student-1', sent_at: sentAt, medium: CommunicationMedium.SMS },
      ]);
    });
  });
});

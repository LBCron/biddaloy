import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import {
  AdmissionApplicantStatus,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
} from '@biddaloy/shared';
import { AdmissionNotificationService } from './admission-notification.service';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { SmsCreditService } from '../communications/credits/sms-credit.service';

/**
 * [27.7] Unit coverage: correct SMS template per status, queued via the
 * existing `COMMUNICATIONS_QUEUE` mechanism (mocked queue, asserted job
 * payload) — mirrors `AbsenceNoticeService`'s existing spec shape for the
 * same producer pattern.
 */
describe('AdmissionNotificationService', () => {
  let service: AdmissionNotificationService;
  let logRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    manager: { findOne: ReturnType<typeof vi.fn> };
  };
  let queue: { add: ReturnType<typeof vi.fn> };
  // Unmetered by default: reserveForLog returns no extra job data.
  const smsCredit = {
    reserveForLog: vi.fn(async (): Promise<any> => ({})),
    releaseForLog: vi.fn(),
  };

  const applicant = {
    id: 'applicant-1',
    tenant_id: 'tenant-a',
    applicant_name: 'Rahim Uddin',
    guardian_name: 'Karim Uddin',
    guardian_phone: '01700000000',
    status: AdmissionApplicantStatus.PENDING,
  };

  beforeEach(async () => {
    logRepo = {
      create: vi.fn((dto) => dto),
      save: vi.fn(async (log) => ({ ...log, id: 'log-1' })),
      // School lookup for region.locale; English by default so the status tests read in English.
      manager: {
        findOne: vi.fn(async () => ({
          id: 'tenant-a',
          settings: { region: { locale: 'en-US' } },
        })),
      },
    };
    queue = { add: vi.fn(async () => undefined) };
    smsCredit.reserveForLog.mockReset().mockResolvedValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdmissionNotificationService,
        { provide: getRepositoryToken(CommunicationLog), useValue: logRepo },
        { provide: getQueueToken(COMMUNICATIONS_QUEUE), useValue: queue },
        { provide: SmsCreditService, useValue: smsCredit },
      ],
    }).compile();

    service = moduleRef.get(AdmissionNotificationService);
  });

  // [#2216]
  it('metered + credit: the job carries batchId and segments', async () => {
    smsCredit.reserveForLog.mockResolvedValue({ batchId: 'log-1', segments: 1 });

    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.ADMITTED },
      'Class 1 Admission',
    );

    expect(queue.add).toHaveBeenCalledWith('send', {
      logId: 'log-1',
      batchId: 'log-1',
      segments: 1,
    });
  });

  it('metered + 0 credit: no job, log saved FAILED INSUFFICIENT_SMS_CREDIT', async () => {
    smsCredit.reserveForLog.mockResolvedValue('INSUFFICIENT');

    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.ADMITTED },
      'Class 1 Admission',
    );

    expect(queue.add).not.toHaveBeenCalled();
    expect(logRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: CommunicationStatus.FAILED,
        metadata: expect.objectContaining({ reason: 'INSUFFICIENT_SMS_CREDIT' }),
      }),
    );
  });

  it('a reserve that throws saves the log FAILED CREDIT_RESERVE_FAILED, queues nothing, and does not reject', async () => {
    smsCredit.reserveForLog.mockRejectedValue(new Error('db down'));

    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.ADMITTED },
      'Class 1 Admission',
    );

    // Never left QUEUED with no job behind it.
    expect(queue.add).not.toHaveBeenCalled();
    expect(logRepo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: CommunicationStatus.FAILED,
        metadata: expect.objectContaining({ reason: 'CREDIT_RESERVE_FAILED' }),
      }),
    );
  });

  it('queues an SMS with the SHORTLISTED template', async () => {
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.SHORTLISTED },
      'Class 1 Admission',
    );

    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-a',
        medium: CommunicationMedium.SMS,
        recipient_address: '01700000000',
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.AUTOMATED,
        message_body: expect.stringContaining('shortlisted'),
      }),
    );
    expect(logRepo.save.mock.calls[0][0].message_body).toContain('Class 1 Admission');
    expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
  });

  it('queues an SMS with the ADMITTED template', async () => {
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.ADMITTED },
      'Class 1 Admission',
    );
    expect(logRepo.save.mock.calls[0][0].message_body).toContain('admitted');
  });

  it('queues an SMS with the REJECTED template', async () => {
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.REJECTED },
      'Class 1 Admission',
    );
    expect(logRepo.save.mock.calls[0][0].message_body).toContain('not successful');
  });

  // [#2265] Bangla-locale schools get Bangla bodies; typed names stay as typed.
  describe('bn-BD locale', () => {
    beforeEach(() => {
      logRepo.manager.findOne.mockResolvedValue({
        id: 'tenant-a',
        settings: { region: { locale: 'bn-BD' } },
      });
    });

    it('SHORTLISTED body is Bangla', async () => {
      await service.notifyStatusChange(
        { ...applicant, status: AdmissionApplicantStatus.SHORTLISTED },
        'Class 1 Admission',
      );
      expect(logRepo.save.mock.calls[0][0].message_body).toBe(
        'সুখবর! Class 1 Admission-এ Rahim Uddin-এর আবেদন প্রাথমিকভাবে নির্বাচিত হয়েছে। পরবর্তী ধাপ আমরা জানাব।',
      );
    });

    it('ADMITTED body is Bangla', async () => {
      await service.notifyStatusChange(
        { ...applicant, status: AdmissionApplicantStatus.ADMITTED },
        'Class 1 Admission',
      );
      expect(logRepo.save.mock.calls[0][0].message_body).toBe(
        'অভিনন্দন! Rahim Uddin Class 1 Admission-এ ভর্তির জন্য নির্বাচিত হয়েছে। ভর্তি সম্পন্ন করতে স্কুল অফিসে যোগাযোগ করুন।',
      );
    });

    it('REJECTED body is Bangla', async () => {
      await service.notifyStatusChange(
        { ...applicant, status: AdmissionApplicantStatus.REJECTED },
        'Class 1 Admission',
      );
      expect(logRepo.save.mock.calls[0][0].message_body).toBe(
        'আবেদন করার জন্য ধন্যবাদ। এবার Class 1 Admission-এ Rahim Uddin-এর আবেদন সফল হয়নি।',
      );
    });
  });

  // [#3136] No stored locale resolves to the bn-BD default, like every other sender.
  it('school with null settings gets the Bangla body', async () => {
    logRepo.manager.findOne.mockResolvedValue({ id: 'tenant-a', settings: null });
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.REJECTED },
      'Class 1 Admission',
    );
    expect(logRepo.save.mock.calls[0][0].message_body).toBe(
      'আবেদন করার জন্য ধন্যবাদ। এবার Class 1 Admission-এ Rahim Uddin-এর আবেদন সফল হয়নি।',
    );
  });

  it('en locale keeps the English body exactly', async () => {
    logRepo.manager.findOne.mockResolvedValue({
      id: 'tenant-a',
      settings: { region: { locale: 'en-US' } },
    });
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.ADMITTED },
      'Class 1 Admission',
    );
    expect(logRepo.save.mock.calls[0][0].message_body).toBe(
      'Congratulations! Rahim Uddin has been admitted for Class 1 Admission. Please contact the school office to complete enrollment.',
    );
  });

  it('does nothing for PENDING (not a notifiable status)', async () => {
    await service.notifyStatusChange(applicant, 'Class 1 Admission');
    expect(logRepo.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('marks the log FAILED when enqueueing throws, without rejecting', async () => {
    queue.add.mockRejectedValueOnce(new Error('queue down'));
    await service.notifyStatusChange(
      { ...applicant, status: AdmissionApplicantStatus.ADMITTED },
      'Class 1 Admission',
    );
    expect(logRepo.save).toHaveBeenCalledTimes(2);
    expect(logRepo.save.mock.calls[1][0].status).toBe(CommunicationStatus.FAILED);
  });
});

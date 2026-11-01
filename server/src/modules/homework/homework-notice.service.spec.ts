import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HomeworkNoticeService } from './homework-notice.service';
import {
  CommunicationStatus,
  CommunicationTrigger,
  CommunicationMedium,
  EnrollmentStatus,
} from '@biddaloy/shared';

const TENANT = 'tenant-1';

function guardian(overrides: Partial<any> = {}) {
  return {
    id: 'g-1',
    full_name: 'Karim Uddin',
    phone: '01712345678',
    alternate_phone: null,
    email: null,
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

const ASSIGNMENT = {
  id: 'assign-1',
  tenant_id: TENANT,
  section_id: 'section-1',
  student_id: null,
  due_date: '2026-01-08',
};

const HOMEWORK = { id: 'hw-1', title: 'Chapter 3 exercises' };

describe('HomeworkNoticeService', () => {
  let studentRepo: any;
  let logRepo: any;
  let queue: any;
  let smsCredit: any;
  let schoolsService: any;
  let service: HomeworkNoticeService;

  beforeEach(() => {
    studentRepo = {
      findOne: vi.fn(async () => student()),
      find: vi.fn(async () => [student()]),
    };
    logRepo = {
      create: vi.fn((v) => v),
      save: vi.fn(async (v) => ({ id: 'log-1', ...v })),
      manager: {},
    };
    queue = { add: vi.fn(async () => undefined) };
    // Unmetered by default: reserveForLog returns no extra job data.
    smsCredit = { reserveForLog: vi.fn(async () => ({})), releaseForLog: vi.fn() };
    // Both switches on by default so the existing delivery tests keep their meaning. English
    // pinned: since #3136 a school with no stored locale gets the bn-BD default.
    schoolsService = {
      getResolvedSettings: vi.fn(async () => ({
        homework: { notifyOnAssign: true, notifyDefaulters: true },
        region: { locale: 'en-US' },
      })),
    };
    service = new HomeworkNoticeService(studentRepo, logRepo, queue, smsCredit, schoolsService);
  });

  // [#2216]
  describe('metered tenant SMS credit', () => {
    it('credit reserved: the job carries batchId and segments', async () => {
      smsCredit.reserveForLog.mockResolvedValue({ batchId: 'log-1', segments: 1 });

      await service.notifyAssignment(ASSIGNMENT as any, HOMEWORK as any);

      expect(queue.add).toHaveBeenCalledWith('send', {
        logId: 'log-1',
        batchId: 'log-1',
        segments: 1,
      });
    });

    it('0 credit: nothing queued and the log is saved FAILED INSUFFICIENT_SMS_CREDIT', async () => {
      smsCredit.reserveForLog.mockResolvedValue('INSUFFICIENT');

      await service.notifyAssignment(ASSIGNMENT as any, HOMEWORK as any);

      expect(queue.add).not.toHaveBeenCalled();
      expect(logRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: CommunicationStatus.FAILED,
          metadata: expect.objectContaining({ reason: 'INSUFFICIENT_SMS_CREDIT' }),
        }),
      );
    });

    it('releases the reservation when queue.add fails', async () => {
      smsCredit.reserveForLog.mockResolvedValue({ batchId: 'log-1', segments: 1 });
      queue.add.mockRejectedValue(new Error('redis down'));

      await service.notifyAssignment(ASSIGNMENT as any, HOMEWORK as any);

      expect(smsCredit.releaseForLog).toHaveBeenCalledWith(TENANT, 'log-1', 1);
    });

    it('a reserve that throws fails that log CREDIT_RESERVE_FAILED and still notifies the next guardian', async () => {
      studentRepo.find.mockResolvedValue([
        student({ id: 's-1', guardians: [guardian({ id: 'g-1' })] }),
        student({ id: 's-2', guardians: [guardian({ id: 'g-2', phone: '01799999999' })] }),
      ]);
      smsCredit.reserveForLog.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({});

      await service.notifyAssignment(ASSIGNMENT as any, HOMEWORK as any);

      // Never left QUEUED with no job behind it.
      expect(logRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          guardian_id: 'g-1',
          status: CommunicationStatus.FAILED,
          metadata: expect.objectContaining({ reason: 'CREDIT_RESERVE_FAILED' }),
        }),
      );
      // The loop went on to the second guardian.
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyAssignment', () => {
    it('creates one AUTOMATED CommunicationLog per guardian for a section target', async () => {
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);

      expect(studentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            class_section_id: 'section-1',
            tenant_id: TENANT,
            enrollment_status: EnrollmentStatus.ACTIVE,
          },
        }),
      );
      expect(logRepo.save).toHaveBeenCalledTimes(1);
      const saved = logRepo.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        tenant_id: TENANT,
        guardian_id: 'g-1',
        student_id: 's-1',
        trigger: CommunicationTrigger.AUTOMATED,
        status: CommunicationStatus.QUEUED,
      });
      expect(saved.message_body).toContain('Chapter 3 exercises');
      expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
    });

    it('notifies the single target student when student_id is set', async () => {
      const single = { ...ASSIGNMENT, section_id: null, student_id: 'student-1' };
      await service.notifyAssignment(single as never, HOMEWORK as never);
      expect(studentRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'student-1', tenant_id: TENANT, enrollment_status: EnrollmentStatus.ACTIVE },
        }),
      );
      expect(logRepo.save).toHaveBeenCalledTimes(1);
    });

    it('respects opt-out — a guardian with notifications disabled is skipped', async () => {
      studentRepo.find.mockResolvedValue([
        student({ guardians: [guardian({ notifications_enabled: false })] }),
      ]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(logRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips a guardian with no dispatchable medium', async () => {
      studentRepo.find.mockResolvedValue([
        student({
          guardians: [guardian({ preferred_communication: CommunicationMedium.PHONE_CALL })],
        }),
      ]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(logRepo.save).not.toHaveBeenCalled();
    });

    it('does not notify the same guardian twice for two students in the same section', async () => {
      const sharedGuardian = guardian();
      studentRepo.find.mockResolvedValue([
        student({ id: 's-1', guardians: [sharedGuardian] }),
        student({ id: 's-2', guardians: [sharedGuardian] }),
      ]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(logRepo.save).toHaveBeenCalledTimes(1);
    });

    it('the single message to a guardian of two students names both students', async () => {
      const sharedGuardian = guardian();
      studentRepo.find.mockResolvedValue([
        student({ id: 's-1', full_name: 'Rahim Uddin', guardians: [sharedGuardian] }),
        student({ id: 's-2', full_name: 'Karima Uddin', guardians: [sharedGuardian] }),
      ]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(logRepo.save).toHaveBeenCalledTimes(1);
      const saved = logRepo.save.mock.calls[0][0];
      expect(saved.student_id).toBe('s-1');
      expect(saved.message_body).toContain('assigned to Rahim Uddin and Karima Uddin');
    });

    it("a WITHDRAWN student's guardian gets no assignment notice (ACTIVE filter)", async () => {
      studentRepo.find.mockResolvedValue([]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(studentRepo.find.mock.calls[0][0].where.enrollment_status).toBe(
        EnrollmentStatus.ACTIVE,
      );
      expect(logRepo.save).not.toHaveBeenCalled();
    });

    it('a single-student assignment for a student who left sends nothing', async () => {
      studentRepo.findOne.mockResolvedValue(null);
      const single = { ...ASSIGNMENT, section_id: null, student_id: 'student-1' };
      await service.notifyAssignment(single as never, HOMEWORK as never);
      expect(logRepo.save).not.toHaveBeenCalled();
    });

    it('two guardians of one student each get one message with that student name', async () => {
      studentRepo.find.mockResolvedValue([
        student({
          guardians: [guardian({ id: 'g-1' }), guardian({ id: 'g-2' })],
        }),
      ]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      const bodies = logRepo.save.mock.calls.map(
        (c: unknown[]) => (c[0] as { message_body: string }).message_body,
      );
      expect(bodies).toHaveLength(2);
      for (const b of bodies) expect(b).toContain('Rahim Uddin');
    });
  });

  // #3172: families are told when a live assignment's due date moves or it is withdrawn.
  describe('notifyChange', () => {
    it('DUE_CHANGED: one QUEUED automated notice naming the homework and the new date', async () => {
      await service.notifyChange(ASSIGNMENT as never, HOMEWORK as never, 'DUE_CHANGED');
      expect(logRepo.save).toHaveBeenCalledTimes(1);
      const log = logRepo.save.mock.calls[0][0];
      expect(log.message_body).toBe(
        'Dear Guardian, the due date of homework "Chapter 3 exercises" for Rahim Uddin is now 2026-01-08.',
      );
      expect(log.status).toBe(CommunicationStatus.QUEUED);
      expect(log.trigger).toBe(CommunicationTrigger.AUTOMATED);
      expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
    });

    it('WITHDRAWN: tells the guardian the homework no longer needs submitting', async () => {
      await service.notifyChange(ASSIGNMENT as never, HOMEWORK as never, 'WITHDRAWN');
      expect(logRepo.save.mock.calls[0][0].message_body).toBe(
        'Dear Guardian, homework "Chapter 3 exercises" for Rahim Uddin has been withdrawn. It does not need to be submitted.',
      );
    });

    it('REACTIVATED: tells the guardian the homework is back on, with its due date', async () => {
      await service.notifyChange(ASSIGNMENT as never, HOMEWORK as never, 'REACTIVATED');
      expect(logRepo.save.mock.calls[0][0].message_body).toBe(
        'Dear Guardian, homework "Chapter 3 exercises" for Rahim Uddin is back on. It is due 2026-01-08.',
      );
    });

    it('WITHDRAWN on a reassign skips students the new target still covers', async () => {
      // Section A narrowed to Rahim, who is in Section A: only Karim is told it was withdrawn.
      studentRepo.find.mockResolvedValue([
        student({ id: 's-1', full_name: 'Rahim Uddin', guardians: [guardian({ id: 'g-1' })] }),
        student({ id: 's-2', full_name: 'Karim Ali', guardians: [guardian({ id: 'g-2' })] }),
      ]);
      studentRepo.findOne.mockResolvedValue(student({ id: 's-1' }));
      const newTarget = { ...ASSIGNMENT, id: 'assign-2', section_id: null, student_id: 's-1' };
      await service.notifyChange(
        ASSIGNMENT as never,
        HOMEWORK as never,
        'WITHDRAWN',
        newTarget as never,
      );
      expect(logRepo.save).toHaveBeenCalledTimes(1);
      expect(logRepo.save.mock.calls[0][0].message_body).toContain('Karim Ali');
      expect(logRepo.save.mock.calls[0][0].message_body).not.toContain('Rahim Uddin');
    });

    it('WITHDRAWN on a student widened to their own section sends nothing', async () => {
      const oldStudentRow = { ...ASSIGNMENT, section_id: null, student_id: 's-1' };
      // The new section covers s-1, the only student of the old row.
      await service.notifyChange(
        oldStudentRow as never,
        HOMEWORK as never,
        'WITHDRAWN',
        ASSIGNMENT as never,
      );
      expect(logRepo.save).not.toHaveBeenCalled();
    });

    it('sends nothing while the school has the assignment notice switch off', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({
        homework: { notifyOnAssign: false, notifyDefaulters: true },
      });
      await service.notifyChange(ASSIGNMENT as never, HOMEWORK as never, 'WITHDRAWN');
      expect(studentRepo.find).not.toHaveBeenCalled();
      expect(logRepo.save).not.toHaveBeenCalled();
    });

    it('is in Bangla for bn-BD', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({
        homework: { notifyOnAssign: true },
        region: { locale: 'bn-BD' },
      });
      await service.notifyChange(ASSIGNMENT as never, HOMEWORK as never, 'DUE_CHANGED');
      expect(logRepo.save.mock.calls[0][0].message_body).toBe(
        'প্রিয় অভিভাবক, Rahim Uddin-এর বাড়ির কাজ "Chapter 3 exercises"-এর জমার শেষ তারিখ এখন ৮ জানুয়ারি।',
      );
    });
  });

  describe('notifyDefaulters', () => {
    it('creates a notice for each defaulting student passed in', async () => {
      await service.notifyDefaulters(ASSIGNMENT as never, HOMEWORK as never, [student()] as never);
      expect(logRepo.save).toHaveBeenCalledTimes(1);
      expect(logRepo.save.mock.calls[0][0].message_body).toContain(
        'has not been submitted yet by Rahim Uddin',
      );
    });

    it('sends nothing for an empty defaulter list', async () => {
      await service.notifyDefaulters(ASSIGNMENT as never, HOMEWORK as never, []);
      expect(logRepo.save).not.toHaveBeenCalled();
    });
  });

  // [TIME-11] Both notices are off unless the school turns them on.
  describe('school switches', () => {
    it('switches absent: neither notice writes a log', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({});

      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      await service.notifyDefaulters(ASSIGNMENT as never, HOMEWORK as never, [student()] as never);

      expect(logRepo.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('each switch is independent', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({ homework: { notifyOnAssign: true } });
      await service.notifyDefaulters(ASSIGNMENT as never, HOMEWORK as never, [student()] as never);
      expect(logRepo.save).not.toHaveBeenCalled();

      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(logRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // [JOBS-09] Bangla school, Bangla text. The title stays as the teacher typed it.
  describe('locale', () => {
    beforeEach(() => {
      schoolsService.getResolvedSettings.mockResolvedValue({
        region: { locale: 'bn-BD' },
        homework: { notifyOnAssign: true, notifyDefaulters: true },
      });
    });

    // #2399 H1: Bangla name, Bangla date and the Bangla "ও" join, like AbsenceNoticeService.
    it('assignment notice is in Bangla for bn-BD: Bangla names joined with ও, Bangla date', async () => {
      const shared = guardian();
      studentRepo.find.mockResolvedValue([
        student({ id: 's-1', full_name_bn: 'রহিম উদ্দিন', guardians: [shared] }),
        student({
          id: 's-2',
          full_name: 'Karima Uddin',
          full_name_bn: 'করিমা উদ্দিন',
          guardians: [shared],
        }),
      ]);
      await service.notifyAssignment(ASSIGNMENT as never, HOMEWORK as never);
      expect(logRepo.save.mock.calls[0][0].message_body).toBe(
        'প্রিয় অভিভাবক, রহিম উদ্দিন ও করিমা উদ্দিন-এর জন্য নতুন বাড়ির কাজ "Chapter 3 exercises" দেওয়া হয়েছে, জমার শেষ তারিখ ৮ জানুয়ারি।',
      );
    });

    it('defaulter notice is in Bangla for bn-BD, falling back to the English name when there is no Bangla one', async () => {
      await service.notifyDefaulters(ASSIGNMENT as never, HOMEWORK as never, [student()] as never);
      expect(logRepo.save.mock.calls[0][0].message_body).toBe(
        'প্রিয় অভিভাবক, Rahim Uddin-এর বাড়ির কাজ "Chapter 3 exercises" (শেষ তারিখ ৮ জানুয়ারি) এখনও জমা হয়নি।',
      );
    });
  });
});

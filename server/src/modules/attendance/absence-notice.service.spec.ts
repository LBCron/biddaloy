import { NotFoundException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AbsenceNoticeService,
  AbsenceNoticeSkipReason,
  ABSENCE_NOTICE_TEMPLATE_BN,
  DEFAULT_ABSENCE_NOTICE_TEMPLATE,
} from './absence-notice.service';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { Student } from '../students/entities/student.entity';
import {
  AttendanceSessionState,
  AttendanceStatus,
  CommunicationMedium,
  CommunicationStatus,
} from '@biddaloy/shared';

// Every student these tests mark is still enrolled in the section (#2269).
vi.mock('../enrollments/section-roster', () => ({
  sectionRosterStudentIds: vi.fn(async () => ['s-1', 's-2', 's-3']),
}));

const TENANT = 'tenant-1';
const SECTION = 'section-1';
const DATE = '2026-09-04';

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

function record(overrides: Partial<any> = {}) {
  return {
    id: 'rec-1',
    session_id: 'session-1',
    student_id: 's-1',
    status: AttendanceStatus.ABSENT,
    ...overrides,
  };
}

describe('AbsenceNoticeService', () => {
  let sessionRepo: any;
  let sectionRepo: any;
  let recordRepo: any;
  let studentRepo: any;
  let batchRepo: any;
  let logRepo: any;
  let queue: any;
  let dataSource: any;
  let auditService: any;
  let schoolsService: any;
  let smsCreditService: any;
  let service: AbsenceNoticeService;

  const finalizedSession = {
    id: 'session-1',
    tenant_id: TENANT,
    section_id: SECTION,
    date: DATE,
    period_no: null,
    state: AttendanceSessionState.FINALIZED,
    notified_at: null,
  };

  beforeEach(() => {
    sessionRepo = { findOne: vi.fn(async () => finalizedSession) };
    sectionRepo = {
      findOne: vi.fn(async () => ({
        id: SECTION,
        section_name: 'A',
        class: { name: 'Class 6' },
        tenant: { name: 'Green Valley School' },
      })),
    };
    recordRepo = { find: vi.fn(async () => [record()]) };
    studentRepo = { find: vi.fn(async () => [student()]) };
    batchRepo = {};
    logRepo = {};
    queue = { add: vi.fn(async () => undefined) };
    dataSource = {
      manager: {
        getRepository: (entity: any) => {
          if (entity === AttendanceRecord) return recordRepo;
          if (entity === Student) return studentRepo;
          throw new Error(`Unexpected repository requested: ${entity?.name}`);
        },
      },
    };
    auditService = { record: vi.fn(async () => undefined) };
    schoolsService = {
      getResolvedSettings: vi.fn(async () => ({
        attendance: { autoAbsentNotification: { enabled: true, cutoffTime: '14:00' } },
      })),
      // English by default so the template tests read in English; no stored locale = bn-BD (#3136).
      findById: vi.fn(async () => ({ id: TENANT, settings: { region: { locale: 'en-US' } } })),
    };
    // Unmetered by default: reserveForLog returns no extra job data.
    smsCreditService = { reserveForLog: vi.fn(async () => ({})), releaseForLog: vi.fn() };

    service = new AbsenceNoticeService(
      sessionRepo,
      recordRepo,
      sectionRepo,
      studentRepo,
      batchRepo,
      logRepo,
      queue,
      dataSource,
      auditService,
      schoolsService,
      smsCreditService,
    );
  });

  it('groups one guardian with 3 absent children into a single recipient naming all 3', async () => {
    const g = guardian();
    recordRepo.find = vi.fn(async () => [
      record({ id: 'r1', student_id: 's-1' }),
      record({ id: 'r2', student_id: 's-2' }),
      record({ id: 'r3', student_id: 's-3' }),
    ]);
    studentRepo.find = vi.fn(async () => [
      student({ id: 's-1', full_name: 'Rahim', guardians: [g] }),
      student({ id: 's-2', full_name: 'Karim', guardians: [g] }),
      student({ id: 's-3', full_name: 'Ayesha', guardians: [g] }),
    ]);

    const { recipients, skipped } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });

    expect(recipients).toHaveLength(1);
    expect(recipients[0].guardian.id).toBe('g-1');
    expect(recipients[0].students.map((s) => s.full_name)).toEqual(['Rahim', 'Karim', 'Ayesha']);
    expect(recipients[0].vars.student_names).toBe('Rahim, Karim and Ayesha');
    expect(skipped).toEqual([]);
  });

  it('never includes LATE or LEAVE records — only ABSENT', async () => {
    recordRepo.find = vi.fn(async (opts: any) => {
      // Simulate the repo-level status filter: only ABSENT rows come back.
      expect(opts.where.status).toBe(AttendanceStatus.ABSENT);
      return [record({ status: AttendanceStatus.ABSENT })];
    });

    const { recipients } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });

    expect(recipients).toHaveLength(1);
  });

  it('returns no recipients and no skips when the register has no session yet', async () => {
    sessionRepo.findOne = vi.fn(async () => null);

    const { session, recipients, skipped } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });

    expect(session).toBeNull();
    expect(recipients).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it('throws NotFoundException instead of naming a blank section when the section is gone', async () => {
    // Soft-deleted after the session that references it was finalized —
    // `sectionRepo.findOne` excludes soft-deleted rows by default, so this
    // is the same shape as any other "section vanished" case.
    sectionRepo.findOne = vi.fn(async () => null);

    await expect(
      service.previewAbsenceNotice({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
        userId: 'user-1',
        ip: null,
        userAgent: null,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns nothing for a DRAFT (not yet finalized) session', async () => {
    sessionRepo.findOne = vi.fn(async () => ({
      ...finalizedSession,
      state: AttendanceSessionState.DRAFT,
    }));

    const { recipients, skipped } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });

    expect(recipients).toEqual([]);
    expect(skipped).toEqual([]);
  });

  describe('skip reasons', () => {
    it('skips a student with no linked guardians as NO_GUARDIANS', async () => {
      studentRepo.find = vi.fn(async () => [student({ guardians: [] })]);

      const { skipped } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(skipped).toEqual([
        { student_id: 's-1', guardian_id: null, reason: AbsenceNoticeSkipReason.NO_GUARDIANS },
      ]);
    });

    it('skips an opted-out guardian as NOTIFICATIONS_DISABLED', async () => {
      studentRepo.find = vi.fn(async () => [
        student({ guardians: [guardian({ notifications_enabled: false })] }),
      ]);

      const { skipped, recipients } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(recipients).toEqual([]);
      expect(skipped).toEqual([
        {
          student_id: 's-1',
          guardian_id: 'g-1',
          reason: AbsenceNoticeSkipReason.NOTIFICATIONS_DISABLED,
        },
      ]);
    });

    it('skips a guardian whose preferred medium has no automated provider as NO_AUTOMATED_PROVIDER', async () => {
      studentRepo.find = vi.fn(async () => [
        student({
          guardians: [guardian({ preferred_communication: CommunicationMedium.PHONE_CALL })],
        }),
      ]);

      const { skipped, recipients } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(recipients).toEqual([]);
      expect(skipped).toEqual([
        {
          student_id: 's-1',
          guardian_id: 'g-1',
          reason: AbsenceNoticeSkipReason.NO_AUTOMATED_PROVIDER,
        },
      ]);
    });

    it('skips a guardian with no address for their preferred medium as MISSING_ADDRESS', async () => {
      studentRepo.find = vi.fn(async () => [
        student({
          guardians: [
            guardian({ preferred_communication: CommunicationMedium.EMAIL, email: null }),
          ],
        }),
      ]);

      const { skipped, recipients } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(recipients).toEqual([]);
      expect(skipped).toEqual([
        { student_id: 's-1', guardian_id: 'g-1', reason: AbsenceNoticeSkipReason.MISSING_ADDRESS },
      ]);
    });

    it('reports an unreachable guardian only once even with multiple absent children', async () => {
      const g = guardian({ preferred_communication: CommunicationMedium.PHONE_CALL });
      recordRepo.find = vi.fn(async () => [
        record({ id: 'r1', student_id: 's-1' }),
        record({ id: 'r2', student_id: 's-2' }),
      ]);
      studentRepo.find = vi.fn(async () => [
        student({ id: 's-1', guardians: [g] }),
        student({ id: 's-2', guardians: [g] }),
      ]);

      const { skipped } = await service.buildRecipients({
        tenantId: TENANT,
        sectionId: SECTION,
        date: DATE,
      });

      expect(skipped).toHaveLength(1);
    });
  });

  // [#2216] A throwing reserve must not strand a QUEUED log or abort the batch.
  it('a reserve that throws fails that log CREDIT_RESERVE_FAILED, counts a batch failure, and still queues the next guardian', async () => {
    recordRepo.find = vi.fn(async () => [
      record({ id: 'r1', student_id: 's-1' }),
      record({ id: 'r2', student_id: 's-2' }),
    ]);
    studentRepo.find = vi.fn(async () => [
      student({ id: 's-1', guardians: [guardian({ id: 'g-1' })] }),
      student({ id: 's-2', guardians: [guardian({ id: 'g-2', phone: '01799999999' })] }),
    ]);
    const { recipients } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });
    expect(recipients).toHaveLength(2);

    let n = 0;
    const txManager = { save: vi.fn(async (v: any) => v), query: vi.fn(async () => undefined) };
    logRepo.create = vi.fn((v: any) => v);
    logRepo.save = vi.fn(async (v: any) => ({ ...v, id: `log-${++n}` }));
    logRepo.manager = { transaction: vi.fn(async (fn: any) => fn(txManager)) };
    smsCreditService.reserveForLog
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({});

    await (service as any).queueRecipients(
      { id: 'batch-1' },
      recipients,
      TENANT,
      'user-1',
      DEFAULT_ABSENCE_NOTICE_TEMPLATE,
    );

    // First guardian: log failed (not left QUEUED) and the batch counter moved.
    expect(txManager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'log-1',
        status: CommunicationStatus.FAILED,
        metadata: expect.objectContaining({ reason: 'CREDIT_RESERVE_FAILED' }),
      }),
    );
    expect(txManager.query).toHaveBeenCalledWith(expect.any(String), ['batch-1', 0, 1]);
    // Second guardian: still queued.
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-2' });
  });

  it('bn-BD school: Bangla template and Bangla name joining (full_name_bn, English fallback)', async () => {
    schoolsService.findById = vi.fn(async () => ({
      id: TENANT,
      settings: { region: { locale: 'bn-BD' } },
    }));
    const g = guardian();
    recordRepo.find = vi.fn(async () => [
      record({ id: 'r1', student_id: 's-1' }),
      record({ id: 'r2', student_id: 's-2' }),
    ]);
    studentRepo.find = vi.fn(async () => [
      student({ id: 's-1', full_name: 'Rahim', full_name_bn: 'রহিম', guardians: [g] }),
      student({ id: 's-2', full_name: 'Karim', full_name_bn: null, guardians: [g] }),
    ]);

    const { recipients, template } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });

    expect(template).toBe(ABSENCE_NOTICE_TEMPLATE_BN);
    expect(recipients[0].vars.student_names).toBe('রহিম ও Karim');
  });

  it('school with no stored locale gets the Bangla template (bn-BD default)', async () => {
    schoolsService.findById = vi.fn(async () => ({ id: TENANT, settings: {} }));
    const { template } = await service.buildRecipients({
      tenantId: TENANT,
      sectionId: SECTION,
      date: DATE,
    });
    expect(template).toBe(ABSENCE_NOTICE_TEMPLATE_BN);
  });

  describe('notifyCorrection does nothing when there was no notice to correct', () => {
    const args = {
      tenantId: TENANT,
      sessionId: 'session-1',
      studentId: 's-1',
      oldStatus: AttendanceStatus.ABSENT,
      newStatus: AttendanceStatus.PRESENT,
      userId: 'u-1',
    };
    beforeEach(() => {
      dataSource.query = vi.fn();
      batchRepo.save = vi.fn();
    });

    it.each([['period register', { notified_at: new Date(), period_no: 2 }]])(
      '%s',
      async (_name, patch) => {
        sessionRepo.findOne = vi.fn(async () => ({ ...finalizedSession, ...patch }));
        await service.notifyCorrection(args);
        expect(dataSource.query).not.toHaveBeenCalled();
        expect(batchRepo.save).not.toHaveBeenCalled();
      },
    );

    it('un-notified session and nothing told', async () => {
      sessionRepo.findOne = vi.fn(async () => finalizedSession);
      schoolsService.getResolvedSettings = vi.fn(async () => ({
        attendance: { autoAbsentNotification: { enabled: true, cutoffTime: '14:00' } },
      }));
      dataSource.query = vi.fn(async () => [{ last_told: null, batches: 0 }]);
      await service.notifyCorrection({
        ...args,
        oldStatus: AttendanceStatus.PRESENT,
        newStatus: AttendanceStatus.ABSENT,
      });
      expect(batchRepo.save).not.toHaveBeenCalled();
    });

    // [84.3.1 / D14] the guardian was last told "reached school"
    describe('last told = arrival notice', () => {
      beforeEach(() => {
        sessionRepo.findOne = vi.fn(async () => finalizedSession);
        schoolsService.getResolvedSettings = vi.fn(async () => ({
          attendance: { autoAbsentNotification: { enabled: true, cutoffTime: '14:00' } },
        }));
        dataSource.query = vi.fn(async () => [{ last_told: 'ARRIVAL_NOTICE', batches: 0 }]);
        vi.spyOn(service as any, 'loadSectionContext').mockResolvedValue({
          sectionName: 'A',
          schoolName: 'S',
        });
        vi.spyOn(service as any, 'resolveAbsentees').mockResolvedValue({
          recipients: [],
          template: DEFAULT_ABSENCE_NOTICE_TEMPLATE,
        });
      });

      it('PRESENT -> ABSENT goes on to tell the guardian, even with no absence notice before', async () => {
        await service.notifyCorrection({
          ...args,
          oldStatus: AttendanceStatus.PRESENT,
          newStatus: AttendanceStatus.ABSENT,
        });
        expect((service as any).resolveAbsentees).toHaveBeenCalled();
      });

      it('ABSENT -> PRESENT sends nothing new', async () => {
        await service.notifyCorrection(args);
        expect((service as any).resolveAbsentees).not.toHaveBeenCalled();
      });
    });

    it('switch off', async () => {
      sessionRepo.findOne = vi.fn(async () => ({ ...finalizedSession, notified_at: new Date() }));
      schoolsService.getResolvedSettings = vi.fn(async () => ({
        attendance: { autoAbsentNotification: { enabled: false, cutoffTime: '14:00' } },
      }));
      await service.notifyCorrection(args);
      expect(batchRepo.save).not.toHaveBeenCalled();
    });
  });

  it('renders the default template with the resolved vars', () => {
    expect(DEFAULT_ABSENCE_NOTICE_TEMPLATE).toContain('{{student_names}}');
    expect(DEFAULT_ABSENCE_NOTICE_TEMPLATE).toContain('{{date}}');
    expect(DEFAULT_ABSENCE_NOTICE_TEMPLATE).toContain('{{section_name}}');
    expect(DEFAULT_ABSENCE_NOTICE_TEMPLATE).toContain('{{school_name}}');
  });
});

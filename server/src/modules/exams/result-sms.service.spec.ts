import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ResultSmsService } from './result-sms.service';
import { Exam } from './entities/exam.entity';
import { Result } from './entities/result.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { AuditService } from '../audit/audit.service';
import { ExamStatus } from '@biddaloy/shared';

const TENANT_ID = 'tenant-1';
const EXAM_ID = 'exam-1';

async function buildService(
  opts: {
    examStatus?: ExamStatus;
    results?: any[];
    students?: any[];
    metered?: boolean;
    reserveOk?: boolean;
    locale?: string;
    existingKeys?: string[];
    publishedAt?: Date;
  } = {},
) {
  const {
    examStatus = ExamStatus.PUBLISHED,
    results = [{ student_id: 'stu-1', gpa: '4.00', grade: 'A', is_fail: false }],
    students = [
      {
        id: 'stu-1',
        full_name: 'Student One',
        guardians: [
          {
            id: 'g1',
            phone: '+8801700000000',
            full_name: 'Parent One',
            notifications_enabled: true,
          },
        ],
      },
    ],
    metered = false,
    reserveOk = true,
    locale = 'en-BD',
    existingKeys = [],
    publishedAt = new Date('2026-10-01T00:00:00Z'),
  } = opts;

  const examRepo: any = {
    findOne: vi.fn(async () => ({
      id: EXAM_ID,
      tenant_id: TENANT_ID,
      name: 'Term 1',
      status: examStatus,
      published_at: publishedAt,
    })),
    manager: {
      findOne: vi.fn(async () => ({ id: TENANT_ID, settings: { region: { locale } } })),
    },
  };
  const resultRepo: any = { find: vi.fn(async () => results) };
  const studentRepo: any = { find: vi.fn(async () => students) };
  const logRepo: any = {
    find: vi.fn(async () => existingKeys.map((reference_key) => ({ reference_key }))),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: `log-${Math.random()}`, ...v })),
  };
  const queue: any = { add: vi.fn(async () => undefined) };
  const smsCreditService = {
    isMetered: vi.fn(async () => metered),
    reserve: vi.fn(async () => (reserveOk ? { ok: true } : { ok: false, available: 0 })),
  };
  const auditService = { record: vi.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ResultSmsService,
      { provide: getRepositoryToken(Exam), useValue: examRepo },
      { provide: getRepositoryToken(Result), useValue: resultRepo },
      { provide: getRepositoryToken(Student), useValue: studentRepo },
      { provide: getRepositoryToken(CommunicationLog), useValue: logRepo },
      { provide: getQueueToken(COMMUNICATIONS_QUEUE), useValue: queue },
      { provide: SmsCreditService, useValue: smsCreditService },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return {
    service: moduleRef.get(ResultSmsService),
    examRepo,
    resultRepo,
    studentRepo,
    logRepo,
    queue,
    smsCreditService,
    auditService,
  };
}

describe('ResultSmsService.sendForExam', () => {
  it('refuses to send for an unpublished exam', async () => {
    const { service } = await buildService({ examStatus: ExamStatus.PROCESSED });

    await expect(service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('sends one message per reachable guardian and audits the send', async () => {
    const { service, logRepo, queue, auditService } = await buildService();

    const outcome = await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');

    expect(outcome.queued).toBe(1);
    expect(logRepo.save).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('send', { logId: expect.any(String) });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ new_values: expect.objectContaining({ queued: 1 }) }),
    );
  });

  it('skips a student with no reachable guardian', async () => {
    const { service } = await buildService({
      students: [{ id: 'stu-1', full_name: 'Student One', guardians: [] }],
    });

    const outcome = await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');

    expect(outcome.queued).toBe(0);
    expect(outcome.skipped).toEqual([{ student_id: 'stu-1', reason: 'no_reachable_guardian' }]);
  });

  it('reserves per-segment under batch:<batchId> and hands batchId + segments to the job', async () => {
    const { service, smsCreditService, queue } = await buildService({ metered: true });

    await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');

    expect(smsCreditService.reserve).toHaveBeenCalledTimes(1);
    expect(smsCreditService.reserve).toHaveBeenCalledWith(
      TENANT_ID,
      expect.any(Number),
      expect.stringMatching(new RegExp(`^batch:exam-result-sms:${EXAM_ID}:`)),
      { type: 'batch', id: expect.any(String) },
    );
    const key = smsCreditService.reserve.mock.calls[0][2] as string;
    expect(queue.add).toHaveBeenCalledWith('send', {
      logId: expect.any(String),
      batchId: key.replace(/^batch:/, ''),
      segments: smsCreditService.reserve.mock.calls[0][1],
    });
  });

  it('refuses to send when SMS credit is insufficient', async () => {
    const { service } = await buildService({ metered: true, reserveOk: false });

    await expect(service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1')).rejects.toThrow(
      ConflictException,
    );
  });

  const keyFor = (g: string, at = new Date('2026-10-01T00:00:00Z')) =>
    `exam-result:${EXAM_ID}:${at.getTime()}:stu-1:${g}`;

  it('sets a per-publication reference_key on each log', async () => {
    const { service, logRepo } = await buildService();
    await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');
    expect(logRepo.save.mock.calls[0][0].reference_key).toBe(keyFor('g1'));
  });

  it('second call for the same publication queues 0, reserves nothing, lists already_sent', async () => {
    const { service, smsCreditService, queue } = await buildService({
      metered: true,
      existingKeys: [keyFor('g1')],
    });
    const outcome = await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');
    expect(outcome).toEqual({
      queued: 0,
      skipped: [{ student_id: 'stu-1', reason: 'already_sent' }],
    });
    expect(smsCreditService.reserve).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('a new published_at allows a fresh send', async () => {
    const { service } = await buildService({
      existingKeys: [keyFor('g1')],
      publishedAt: new Date('2026-10-05T00:00:00Z'),
    });
    expect((await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1')).queued).toBe(1);
  });

  it('a unique-violation on save counts as already_sent and releases the share', async () => {
    const { service, logRepo, smsCreditService } = await buildService({ metered: true });
    (smsCreditService as any).settlePart = vi.fn(async () => undefined);
    logRepo.save.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const outcome = await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');
    expect(outcome.queued).toBe(0);
    expect(outcome.skipped).toEqual([{ student_id: 'stu-1', reason: 'already_sent' }]);
    expect((smsCreditService as any).settlePart).toHaveBeenCalledWith(
      TENANT_ID,
      expect.stringMatching(/^batch:/),
      expect.any(String),
      1,
      'RELEASE',
    );
  });

  it('an enqueue failure releases the reference_key so a retry can send that pair', async () => {
    const { service, queue, logRepo } = await buildService();
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    const outcome = await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');
    expect(outcome.queued).toBe(0);
    // The second save is the FAILED mark: it must not keep the dedup key.
    const failedSave = logRepo.save.mock.calls[1][0];
    expect(failedSave.status).toBe('FAILED');
    expect(failedSave.reference_key).toBeNull();
    expect(failedSave.metadata.released_reference_key).toMatch(/^exam-result:/);
  });

  it('sends to the primary contact only, and skips an opted-out guardian', async () => {
    const mk = (id: string, primary: boolean, on = true) => ({
      id,
      phone: `017${id}`,
      full_name: id,
      is_primary_contact: primary,
      notifications_enabled: on,
    });
    const { service, logRepo } = await buildService({
      students: [
        {
          id: 'stu-1',
          full_name: 'Student One',
          guardians: [mk('g1', true), mk('g2', false), mk('g3', true, false)],
        },
      ],
    });
    const outcome = await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');
    expect(outcome.queued).toBe(1);
    expect(logRepo.save.mock.calls.map((c: any) => c[0].guardian_id)).toEqual(['g1']);
  });

  // Review r1 #8: a primary with no phone must not hide a secondary who has one.
  it('falls back to a secondary guardian when the primary has no phone', async () => {
    const { service, logRepo } = await buildService({
      students: [
        {
          id: 'stu-1',
          full_name: 'Student One',
          guardians: [
            {
              id: 'g1',
              phone: null,
              full_name: 'P',
              is_primary_contact: true,
              notifications_enabled: true,
            },
            {
              id: 'g2',
              phone: '017',
              full_name: 'S',
              is_primary_contact: false,
              notifications_enabled: true,
            },
          ],
        },
      ],
    });
    const outcome = await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');
    expect(outcome.queued).toBe(1);
    expect(logRepo.save.mock.calls.map((c: any) => c[0].guardian_id)).toEqual(['g2']);
  });

  // Review r1 #9: `published_at` is nullable on older rows.
  it('a PUBLISHED exam with no published_at still sends', async () => {
    const { service } = await buildService({ publishedAt: null as unknown as Date });
    expect((await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1')).queued).toBe(1);
  });

  it('en locale keeps the English body', async () => {
    const { service, logRepo } = await buildService({ locale: 'en' });
    await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');
    expect(logRepo.save.mock.calls[0][0].message_body).toBe(
      `Student One's result for "Term 1": GPA 4.00, Grade A.`,
    );
  });

  // [#3136] No stored locale resolves to the bn-BD default, like every other sender.
  it('school with no stored locale gets the Bangla body', async () => {
    const { service, examRepo, logRepo } = await buildService();
    examRepo.manager.findOne.mockResolvedValue({ id: TENANT_ID, settings: null });
    await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');
    expect(logRepo.save.mock.calls[0][0].message_body).toBe(
      'Student One-এর "Term 1" ফলাফল: জিপিএ 4.00, গ্রেড A।',
    );
  });

  it('bn locale sends a Bangla body with the Bangla name', async () => {
    const { service, logRepo } = await buildService({
      locale: 'bn-BD',
      results: [{ student_id: 'stu-1', gpa: '1.00', grade: 'F', is_fail: true }],
      students: [
        {
          id: 'stu-1',
          full_name: 'Student One',
          full_name_bn: 'শিক্ষার্থী এক',
          guardians: [
            {
              id: 'g1',
              phone: '017',
              full_name: 'P',
              is_primary_contact: true,
              notifications_enabled: true,
            },
          ],
        },
      ],
    });
    await service.sendForExam(EXAM_ID, TENANT_ID, 'admin-1');
    expect(logRepo.save.mock.calls[0][0].message_body).toBe(
      'শিক্ষার্থী এক-এর "Term 1" ফলাফল: জিপিএ 1.00, গ্রেড F (অকৃতকার্য)।',
    );
  });
});

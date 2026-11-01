import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  HomeworkAssignmentStatus,
  HomeworkGradingMode,
  HomeworkSubmissionStatus,
  UserRole,
} from '@biddaloy/shared';
import { HomeworkSubmissionService } from './homework-submission.service';
import { attentionEvents } from '../attention/attention.constants';
import { ATTENTION_RECHECK } from '../attention/engine/attention-events';

describe('HomeworkSubmissionService', () => {
  const TENANT_ID = '11111111-1111-4111-8111-111111111111';
  const studentCtx = { role: UserRole.STUDENT, userId: 'user-student-1', tenantId: TENANT_ID };
  const teacherCtx = { role: UserRole.TEACHER, userId: 'user-teacher-1', tenantId: TENANT_ID };

  const FUTURE_DUE_DATE = '2999-01-08';
  const PAST_DUE_DATE = '2000-01-08';

  const SECTION_ASSIGNMENT = {
    id: 'assign-1',
    homework_id: 'hw-1',
    section_id: 'section-1',
    student_id: null,
    due_date: FUTURE_DUE_DATE,
    status: HomeworkAssignmentStatus.ACTIVE,
    tenant_id: TENANT_ID,
  };

  const HOMEWORK = {
    id: 'hw-1',
    subject_id: 'subject-1',
    grading_mode: HomeworkGradingMode.TICK,
    tenant_id: TENANT_ID,
  };

  const FILE = {
    originalname: 'answer.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('%PDF-1.4 x'),
  } as Express.Multer.File;

  let homeworkRepo: { findOne: ReturnType<typeof vi.fn> };
  let assignmentRepo: { findOne: ReturnType<typeof vi.fn> };
  let submissionRepo: {
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };
  let studentRepo: { findOne: ReturnType<typeof vi.fn> };
  // upload() runs insert-if-absent + FOR UPDATE read + save inside one transaction.
  let tx: {
    insertValues: ReturnType<typeof vi.fn>;
    orIgnore: ReturnType<typeof vi.fn>;
    findOneOrFail: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let access: {
    assertCanManageSection: ReturnType<typeof vi.fn>;
    assertCanManageStudent: ReturnType<typeof vi.fn>;
  };
  let familyAccess: { assertLinked: ReturnType<typeof vi.fn> };
  let storage: { put: ReturnType<typeof vi.fn>; deleteForTenant: ReturnType<typeof vi.fn> };
  let schoolsService: { getResolvedSettings: ReturnType<typeof vi.fn> };
  let service: HomeworkSubmissionService;

  beforeEach(() => {
    homeworkRepo = { findOne: vi.fn(async () => HOMEWORK) };
    assignmentRepo = { findOne: vi.fn(async () => ({ ...SECTION_ASSIGNMENT })) };
    submissionRepo = {
      findOne: vi.fn(async () => null),
      create: vi.fn((v) => ({ status: HomeworkSubmissionStatus.NOT_SUBMITTED, marks: null, ...v })),
      save: vi.fn(async (v) => ({ id: 'sub-1', ...v })),
      find: vi.fn(async () => []),
    };
    tx = {
      insertValues: vi.fn(),
      orIgnore: vi.fn(),
      findOneOrFail: vi.fn(async () => ({
        id: 'sub-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        status: HomeworkSubmissionStatus.NOT_SUBMITTED,
        marks: null,
        attachments: [],
        tenant_id: TENANT_ID,
      })),
      save: vi.fn(async (v) => v),
    };
    const insertChain = {
      insert: () => insertChain,
      into: () => insertChain,
      values: (v: unknown) => {
        (tx.insertValues as (v: unknown) => void)(v);
        return insertChain;
      },
      orIgnore: () => {
        (tx.orIgnore as () => void)();
        return insertChain;
      },
      execute: async () => undefined,
    };
    (submissionRepo as unknown as { manager: unknown }).manager = {
      transaction: async (fn: (m: unknown) => unknown) =>
        fn({
          createQueryBuilder: () => insertChain,
          findOneOrFail: tx.findOneOrFail,
          save: tx.save,
        }),
    };
    studentRepo = {
      findOne: vi.fn(async () => ({
        id: 'student-1',
        class_section_id: 'section-1',
        tenant_id: TENANT_ID,
      })),
    };
    access = {
      assertCanManageSection: vi.fn(async () => undefined),
      assertCanManageStudent: vi.fn(async () => undefined),
    };
    familyAccess = { assertLinked: vi.fn(async () => undefined) };
    storage = { put: vi.fn(async () => undefined), deleteForTenant: vi.fn(async () => undefined) };
    schoolsService = {
      getResolvedSettings: vi.fn(async () => ({ region: { timezone: 'UTC' } })),
    };

    service = new HomeworkSubmissionService(
      homeworkRepo as never,
      assignmentRepo as never,
      submissionRepo as never,
      studentRepo as never,
      access as never,
      familyAccess as never,
      storage as never,
      schoolsService as never,
    );
  });

  describe('upload', () => {
    it('accepts an upload before the due date and marks the submission SUBMITTED', async () => {
      const result = await service.upload('assign-1', 'student-1', [FILE], studentCtx);

      expect(familyAccess.assertLinked).toHaveBeenCalledWith(
        studentCtx.role,
        studentCtx.userId,
        'student-1',
        TENANT_ID,
      );
      expect(storage.put).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(HomeworkSubmissionStatus.SUBMITTED);
      expect(result.attachments).toHaveLength(1);
    });

    it('asks the attention engine to recheck homework.not_submitted after saving', async () => {
      const events: unknown[] = [];
      const on = (p: unknown) => events.push(p);
      attentionEvents.on(ATTENTION_RECHECK, on);
      try {
        await service.upload('assign-1', 'student-1', [FILE], studentCtx);
      } finally {
        attentionEvents.off(ATTENTION_RECHECK, on);
      }
      expect(events).toEqual([
        { tenantId: TENANT_ID, ruleKey: 'homework.not_submitted', actorUserId: studentCtx.userId },
      ]);
    });

    it('throws BadRequestException when bytes do not match the declared mimetype', async () => {
      const html = {
        ...FILE,
        buffer: Buffer.from('<html><script>alert(1)</script></html>'),
      } as Express.Multer.File;
      await expect(
        service.upload('assign-1', 'student-1', [html], studentCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects an upload after the due date', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...SECTION_ASSIGNMENT, due_date: PAST_DUE_DATE });
      await expect(
        service.upload('assign-1', 'student-1', [FILE], studentCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    // The bulk teacher grade can create this row at any time: upload must insert-if-absent
    // (ON CONFLICT DO NOTHING) and then lock the row, never find-then-create.
    it('inserts the row with ON CONFLICT DO NOTHING before locking and saving it', async () => {
      await service.upload('assign-1', 'student-1', [FILE], studentCtx);
      expect(tx.insertValues).toHaveBeenCalledWith({
        tenant_id: TENANT_ID,
        assignment_id: 'assign-1',
        student_id: 'student-1',
      });
      expect(tx.orIgnore).toHaveBeenCalledTimes(1);
      expect(tx.findOneOrFail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(submissionRepo.create).not.toHaveBeenCalled();
    });

    it('a row a teacher bulk-graded first keeps its status and gains the files', async () => {
      tx.findOneOrFail.mockResolvedValue({
        id: 'sub-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        status: HomeworkSubmissionStatus.PARTIAL,
        marks: 4,
        attachments: [],
        tenant_id: TENANT_ID,
      });
      const result = await service.upload('assign-1', 'student-1', [FILE], studentCtx);
      expect(result.status).toBe(HomeworkSubmissionStatus.PARTIAL);
      expect(result.marks).toBe(4);
      expect(result.attachments).toHaveLength(1);
      expect(storage.deleteForTenant).not.toHaveBeenCalled();
    });

    it('resubmission replaces attachments while still before the due date', async () => {
      tx.findOneOrFail.mockResolvedValue({
        id: 'sub-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        status: HomeworkSubmissionStatus.SUBMITTED,
        marks: null,
        attachments: [
          { key: 'old-key', filename: 'old.pdf', mimetype: 'application/pdf', size: 10 },
        ],
        tenant_id: TENANT_ID,
      });

      const newFile = { ...FILE, originalname: 'new-answer.pdf' } as Express.Multer.File;
      const result = await service.upload('assign-1', 'student-1', [newFile], studentCtx);

      expect(result.attachments).toEqual([expect.objectContaining({ filename: 'new-answer.pdf' })]);
      // The replaced object is deleted from storage, not left orphaned.
      expect(storage.deleteForTenant).toHaveBeenCalledWith('old-key', TENANT_ID);
    });

    it('deletes the newly-uploaded objects if the save fails', async () => {
      tx.save.mockRejectedValueOnce(new Error('unique violation'));
      await expect(service.upload('assign-1', 'student-1', [FILE], studentCtx)).rejects.toThrow(
        'unique violation',
      );
      expect(storage.deleteForTenant).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite a teacher override status back to SUBMITTED (D9)', async () => {
      tx.findOneOrFail.mockResolvedValue({
        id: 'sub-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        status: HomeworkSubmissionStatus.DONE,
        marks: null,
        attachments: [],
        tenant_id: TENANT_ID,
      });

      const result = await service.upload('assign-1', 'student-1', [FILE], studentCtx);
      expect(result.status).toBe(HomeworkSubmissionStatus.DONE);
    });

    it('rejects when a student uploads for an unlinked student (D26)', async () => {
      familyAccess.assertLinked.mockRejectedValueOnce(new ForbiddenException('not linked'));
      await expect(
        service.upload('assign-1', 'stranger-student', [FILE], studentCtx),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for an unknown assignment', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.upload('missing', 'student-1', [FILE], studentCtx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an upload to a DEACTIVATED assignment', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        ...SECTION_ASSIGNMENT,
        status: HomeworkAssignmentStatus.DEACTIVATED,
      });
      await expect(
        service.upload('assign-1', 'student-1', [FILE], studentCtx),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('evaluates the due-date cutoff in the tenant timezone', async () => {
      schoolsService.getResolvedSettings.mockResolvedValue({
        region: { timezone: 'Asia/Dhaka' },
      });
      await service.upload('assign-1', 'student-1', [FILE], studentCtx);
      expect(schoolsService.getResolvedSettings).toHaveBeenCalledWith(TENANT_ID);
    });
  });

  describe('update (teacher grade/override)', () => {
    beforeEach(() => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        assignment_id: 'assign-1',
        student_id: 'student-1',
        status: HomeworkSubmissionStatus.SUBMITTED,
        marks: null,
        attachments: [],
        tenant_id: TENANT_ID,
      });
    });

    it('sets a teacher override status', async () => {
      const result = await service.update(
        'sub-1',
        { status: HomeworkSubmissionStatus.DONE },
        teacherCtx,
      );
      expect(result.status).toBe(HomeworkSubmissionStatus.DONE);
      expect(access.assertCanManageSection).toHaveBeenCalled();
    });

    it('accepts marks when grading_mode is MARKS', async () => {
      homeworkRepo.findOne.mockResolvedValue({
        ...HOMEWORK,
        grading_mode: HomeworkGradingMode.MARKS,
      });
      const result = await service.update('sub-1', { marks: 8 }, teacherCtx);
      expect(result.marks).toBe(8);
    });

    it('rejects marks when grading_mode is not MARKS', async () => {
      homeworkRepo.findOne.mockResolvedValue({
        ...HOMEWORK,
        grading_mode: HomeworkGradingMode.TICK,
      });
      await expect(service.update('sub-1', { marks: 8 }, teacherCtx)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    // #3172: the old PATCH shares the rule with the bulk grade.
    it('rejects status PARTIAL when grading_mode is not PARTIAL, and saves nothing', async () => {
      homeworkRepo.findOne.mockResolvedValue({
        ...HOMEWORK,
        grading_mode: HomeworkGradingMode.TICK,
      });
      await expect(
        service.update('sub-1', { status: HomeworkSubmissionStatus.PARTIAL }, teacherCtx),
      ).rejects.toThrow('Partial can only be set when the homework grading mode is PARTIAL');
      expect(submissionRepo.save).not.toHaveBeenCalled();
    });

    it('accepts status PARTIAL when grading_mode is PARTIAL', async () => {
      homeworkRepo.findOne.mockResolvedValue({
        ...HOMEWORK,
        grading_mode: HomeworkGradingMode.PARTIAL,
      });
      const result = await service.update(
        'sub-1',
        { status: HomeworkSubmissionStatus.PARTIAL },
        teacherCtx,
      );
      expect(result.status).toBe(HomeworkSubmissionStatus.PARTIAL);
    });

    it('throws NotFoundException for an unknown submission', async () => {
      submissionRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', { status: HomeworkSubmissionStatus.DONE }, teacherCtx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // Rule 23: every miss on the old PATCH answers the same single text, so a teacher
    // cannot tell "no such submission" from "another section's submission".
    describe('one 404 text for every miss', () => {
      const SAME = new NotFoundException('Homework submission not found');
      const run = () =>
        service.update('sub-1', { status: HomeworkSubmissionStatus.DONE }, teacherCtx);

      it('unknown submission', async () => {
        submissionRepo.findOne.mockResolvedValue(null);
        await expect(run()).rejects.toThrow(SAME);
      });

      it('missing assignment', async () => {
        assignmentRepo.findOne.mockResolvedValue(null);
        await expect(run()).rejects.toThrow(SAME);
      });

      it('missing homework', async () => {
        homeworkRepo.findOne.mockResolvedValue(null);
        await expect(run()).rejects.toThrow(SAME);
      });

      it('teacher outside the section', async () => {
        access.assertCanManageSection.mockRejectedValueOnce(
          new NotFoundException('You do not have access to this section'),
        );
        await expect(run()).rejects.toThrow(SAME);
      });

      it('a 403 passes through', async () => {
        access.assertCanManageSection.mockRejectedValueOnce(new ForbiddenException('no'));
        await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
      });
    });
  });

  describe('check work: findAllForAssignment / grade (#2899)', () => {
    const SID_A = '22222222-2222-4222-8222-222222222222';
    const SID_B = '33333333-3333-4333-8333-333333333333';
    const transaction = vi.fn();
    const query = vi.fn();

    beforeEach(() => {
      transaction.mockReset();
      query.mockReset();
      query.mockResolvedValue([{ student_id: SID_A }]);
      (submissionRepo as unknown as { manager: unknown }).manager = { query, transaction };
    });

    // Rule 23: a teacher cannot tell "other section" from "no such id".
    for (const call of ['get', 'grade'] as const) {
      const run = () =>
        call === 'get'
          ? service.findAllForAssignment('assign-1', teacherCtx)
          : service.grade(
              'assign-1',
              { items: [{ student_id: SID_A, status: 'DONE' }] },
              teacherCtx,
            );

      it(`${call}: scope miss answers the same single 404 text`, async () => {
        access.assertCanManageSection.mockRejectedValueOnce(
          new NotFoundException('You do not have access to this section'),
        );
        await expect(run()).rejects.toThrow(new NotFoundException('Homework assignment not found'));
      });

      it(`${call}: missing homework answers the same single 404 text`, async () => {
        homeworkRepo.findOne.mockResolvedValue(null);
        await expect(run()).rejects.toThrow(new NotFoundException('Homework assignment not found'));
      });

      it(`${call}: a 403 passes through`, async () => {
        access.assertCanManageSection.mockRejectedValueOnce(new ForbiddenException('no'));
        await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
      });
    }

    const rejectsBeforeWrite = async (items: unknown[], message: string) => {
      await expect(service.grade('assign-1', { items } as never, teacherCtx)).rejects.toThrow(
        new BadRequestException(message),
      );
      expect(transaction).not.toHaveBeenCalled();
    };

    it('rejects a duplicate student before any write', async () => {
      await rejectsBeforeWrite(
        [
          { student_id: SID_A, status: 'DONE' },
          { student_id: SID_A, status: 'PARTIAL' },
        ],
        'Each student can appear only once',
      );
    });

    it('rejects an item with neither field before any write', async () => {
      await rejectsBeforeWrite([{ student_id: SID_A }], 'Nothing to change');
    });

    it('rejects marks on a TICK homework before any write', async () => {
      await rejectsBeforeWrite(
        [{ student_id: SID_A, marks: 3 }],
        'Marks can only be set when the homework grading mode is MARKS',
      );
    });

    // #3172: PARTIAL is a PARTIAL-mode outcome; TICK and MARKS only ever send DONE / NOT_SUBMITTED.
    const rejectsPartialOn = async (mode: HomeworkGradingMode) => {
      homeworkRepo.findOne.mockResolvedValue({ ...HOMEWORK, grading_mode: mode });
      await rejectsBeforeWrite(
        [{ student_id: SID_A, status: 'PARTIAL' }],
        'Partial can only be set when the homework grading mode is PARTIAL',
      );
    };

    it('rejects status PARTIAL on a TICK homework before any write', async () => {
      await rejectsPartialOn(HomeworkGradingMode.TICK);
    });

    it('rejects status PARTIAL on a MARKS homework before any write', async () => {
      await rejectsPartialOn(HomeworkGradingMode.MARKS);
    });

    it('accepts status PARTIAL on a PARTIAL homework', async () => {
      homeworkRepo.findOne.mockResolvedValue({
        ...HOMEWORK,
        grading_mode: HomeworkGradingMode.PARTIAL,
      });
      transaction.mockResolvedValue(undefined);
      await service.grade(
        'assign-1',
        { items: [{ student_id: SID_A, status: 'PARTIAL' }] },
        teacherCtx,
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a student not on the roster before any write', async () => {
      await rejectsBeforeWrite(
        [{ student_id: SID_B, status: 'DONE' }],
        'A student in this list is not on this homework',
      );
    });
  });
});

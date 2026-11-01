import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { HomeworkAssignmentStatus, HomeworkGradingMode, UserRole } from '@biddaloy/shared';
import { HomeworkService } from './homework.service';
import { attentionEvents } from '../attention/attention.constants';
import { ATTENTION_RECHECK } from '../attention/engine/attention-events';
import { teacherAssignments } from '../classes/teacher-scope.service';

// Only the teacher-scope join is faked, so a test can count how often a request runs it.
vi.mock('../classes/teacher-scope.service', () => ({ teacherAssignments: vi.fn() }));

describe('HomeworkService', () => {
  const TENANT_ID = 'tenant-1';
  const ctx = { role: UserRole.TEACHER, userId: 'user-1', tenantId: TENANT_ID };

  let homeworkRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let assignmentRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    manager: { transaction: ReturnType<typeof vi.fn> };
  };
  let access: {
    assertCanManageClass: ReturnType<typeof vi.fn>;
    assertCanManageSection: ReturnType<typeof vi.fn>;
    assertCanManageStudent: ReturnType<typeof vi.fn>;
    assertClassAndSubjectInTenant: ReturnType<typeof vi.fn>;
    assertTargetInClass: ReturnType<typeof vi.fn>;
    canManageTenantWide: ReturnType<typeof vi.fn>;
  };
  let notice: {
    notifyAssignment: ReturnType<typeof vi.fn>;
    notifyChange: ReturnType<typeof vi.fn>;
  };
  let service: HomeworkService;

  const HOMEWORK = {
    id: 'hw-1',
    subject_id: 'subject-1',
    class_id: 'class-1',
    tenant_id: TENANT_ID,
  };

  beforeEach(() => {
    homeworkRepo = {
      create: vi.fn((v) => v),
      save: vi.fn(async (v) => ({ id: 'hw-1', ...v })),
      findOne: vi.fn(async () => HOMEWORK),
      createQueryBuilder: vi.fn(),
    };
    let nextAssignmentId = 0;
    assignmentRepo = {
      create: vi.fn((v) => v),
      // Simulates the DB assigning a fresh id on insert (no `id` on the
      // entity yet) while preserving the id on an update to an existing row.
      save: vi.fn(async (v) => (v.id ? v : { id: `new-assign-${++nextAssignmentId}`, ...v })),
      findOne: vi.fn(),
      // #3172 one-live-row check: no other ACTIVE row for the target by default.
      exists: vi.fn(async () => false),
      // `reassign`'s conditional supersede — 1 affected row by default
      // (the happy path); tests exercising the "already superseded"/race
      // case override this to return 0.
      update: vi.fn(async () => ({ affected: 1 })),
      manager: {
        // `reassign` runs both writes through `manager.getRepository(...)`
        // inside a transaction — reuse this same repo's create/save/update
        // mocks so assertions written against `assignmentRepo.save` etc.
        // still see the calls made through the transaction.
        transaction: vi.fn((fn: (manager: unknown) => unknown) =>
          fn({ getRepository: () => assignmentRepo }),
        ),
      },
    };
    access = {
      assertCanManageClass: vi.fn(async () => undefined),
      assertCanManageSection: vi.fn(async () => undefined),
      assertCanManageStudent: vi.fn(async () => undefined),
      assertClassAndSubjectInTenant: vi.fn(async () => undefined),
      assertTargetInClass: vi.fn(async () => undefined),
      // Skips findOne's section-scope query; that gate is covered against a real
      // DB in homework.controller.e2e-spec.ts (section A vs section B).
      canManageTenantWide: vi.fn(() => true),
    };
    notice = {
      notifyAssignment: vi.fn(async () => undefined),
      notifyChange: vi.fn(async () => undefined),
    };
    service = new HomeworkService(
      homeworkRepo as never,
      assignmentRepo as never,
      access as never,
      notice as never,
    );
  });

  describe('create', () => {
    it('creates a Homework scoped to the tenant', async () => {
      const dto = {
        subject_id: 'subject-1',
        class_id: 'class-1',
        title: 'Chapter 3 exercises',
        grading_mode: HomeworkGradingMode.MARKS,
      };
      const result = await service.create(dto, ctx);
      expect(access.assertCanManageClass).toHaveBeenCalledWith(
        ctx.role,
        ctx.userId,
        'class-1',
        'subject-1',
        TENANT_ID,
      );
      expect(homeworkRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ title: 'Chapter 3 exercises', tenant_id: TENANT_ID });
    });

    it('propagates ForbiddenException from the access gate', async () => {
      access.assertCanManageClass.mockRejectedValueOnce(new Error('forbidden'));
      const dto = {
        subject_id: 'subject-1',
        class_id: 'class-1',
        title: 'x',
        grading_mode: HomeworkGradingMode.MARKS,
      };
      await expect(service.create(dto, ctx)).rejects.toThrow('forbidden');
    });
  });

  describe('assign', () => {
    it('creates an ACTIVE assignment for a section target', async () => {
      const dto = { section_id: 'section-1', assigned_date: '2026-01-01', due_date: '2026-01-08' };
      const result = await service.assign('hw-1', dto, ctx);
      expect(access.assertCanManageSection).toHaveBeenCalledWith(
        ctx.role,
        ctx.userId,
        'section-1',
        HOMEWORK.subject_id,
        TENANT_ID,
      );
      expect(result).toMatchObject({
        status: HomeworkAssignmentStatus.ACTIVE,
        section_id: 'section-1',
      });
      // [22.3.3] Assignment triggers a guardian notice with the saved
      // assignment row and its parent homework.
      expect(notice.notifyAssignment).toHaveBeenCalledWith(result, HOMEWORK);
    });

    it('does not fail the assignment when the notice send throws', async () => {
      notice.notifyAssignment.mockRejectedValueOnce(new Error('sms provider down'));
      const dto = { section_id: 'section-1', assigned_date: '2026-01-01', due_date: '2026-01-08' };
      const result = await service.assign('hw-1', dto, ctx);
      expect(result).toMatchObject({ status: HomeworkAssignmentStatus.ACTIVE });
    });

    it('#3172 refuses a second live assignment of the same homework to the same target', async () => {
      assignmentRepo.exists.mockResolvedValue(true);
      const dto = { section_id: 'section-1', assigned_date: '2026-01-01', due_date: '2026-01-08' };
      await expect(service.assign('hw-1', dto, ctx)).rejects.toBeInstanceOf(ConflictException);
      expect(assignmentRepo.save).not.toHaveBeenCalled();
      expect(notice.notifyAssignment).not.toHaveBeenCalled();
    });

    it('rejects both section_id and student_id given together (D24)', async () => {
      const dto = {
        section_id: 'section-1',
        student_id: 'student-1',
        assigned_date: '2026-01-01',
        due_date: '2026-01-08',
      };
      await expect(service.assign('hw-1', dto, ctx)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects neither section_id nor student_id given', async () => {
      const dto = { assigned_date: '2026-01-01', due_date: '2026-01-08' };
      await expect(service.assign('hw-1', dto, ctx)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the homework does not exist', async () => {
      homeworkRepo.findOne.mockResolvedValue(null);
      const dto = { section_id: 'section-1', assigned_date: '2026-01-01', due_date: '2026-01-08' };
      await expect(service.assign('missing', dto, ctx)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a due_date earlier than assigned_date', async () => {
      const dto = { section_id: 'section-1', assigned_date: '2026-01-08', due_date: '2026-01-01' };
      await expect(service.assign('hw-1', dto, ctx)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('checks the target belongs to the homework class', async () => {
      const dto = { section_id: 'section-1', assigned_date: '2026-01-01', due_date: '2026-01-08' };
      await service.assign('hw-1', dto, ctx);
      expect(access.assertTargetInClass).toHaveBeenCalledWith(
        'section-1',
        undefined,
        HOMEWORK.class_id,
        TENANT_ID,
      );
    });
  });

  describe('reassign', () => {
    const OLD_ASSIGNMENT = {
      id: 'assign-1',
      homework_id: 'hw-1',
      section_id: 'section-1',
      student_id: null,
      status: HomeworkAssignmentStatus.ACTIVE,
      tenant_id: TENANT_ID,
    };

    it('creates a new ACTIVE row and marks the old row SUPERSEDED (D20)', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };

      const result = await service.reassign('assign-1', dto, ctx);

      // A new row was created and saved with ACTIVE status.
      expect(result).toMatchObject({
        status: HomeworkAssignmentStatus.ACTIVE,
        section_id: 'section-2',
      });
      expect(result.id).not.toBe('assign-1');

      // The old row was superseded via a conditional UPDATE, not left ACTIVE.
      expect(assignmentRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'assign-1' }),
        { status: HomeworkAssignmentStatus.SUPERSEDED },
      );
    });

    it('aborts when the old row was already superseded concurrently (0 rows affected)', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      assignmentRepo.update.mockResolvedValueOnce({ affected: 0 });
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };

      await expect(service.reassign('assign-1', dto, ctx)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the old assignment does not exist', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('missing', dto, ctx)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects reassigning an already-SUPERSEDED row', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        ...OLD_ASSIGNMENT,
        status: HomeworkAssignmentStatus.SUPERSEDED,
      });
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('#3172 a target that already has another live row is a 409 and writes nothing', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      assignmentRepo.exists.mockResolvedValue(true);
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(assignmentRepo.update).not.toHaveBeenCalled();
      // The row being reassigned is not its own conflict.
      expect(assignmentRepo.exists).toHaveBeenCalledWith({
        where: expect.objectContaining({
          homework_id: 'hw-1',
          section_id: 'section-2',
          status: HomeworkAssignmentStatus.ACTIVE,
          id: expect.anything(),
        }),
      });
    });

    // #3172: the UI hides Change on a withdrawn row; the server refuses it too.
    it('rejects reassigning a DEACTIVATED row and writes nothing', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        ...OLD_ASSIGNMENT,
        status: HomeworkAssignmentStatus.DEACTIVATED,
      });
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toThrow(
        'Reactivate this assignment before reassigning it',
      );
      expect(assignmentRepo.update).not.toHaveBeenCalled();
      expect(assignmentRepo.save).not.toHaveBeenCalled();
    });

    it('the supersede only wins on an ACTIVE row (a racing deactivate aborts it)', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await service.reassign('assign-1', dto, ctx);
      expect(assignmentRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'assign-1', status: HomeworkAssignmentStatus.ACTIVE }),
        { status: HomeworkAssignmentStatus.SUPERSEDED },
      );
    });

    describe('family notices (#3172)', () => {
      const OLD_WITH_DATES = {
        ...OLD_ASSIGNMENT,
        assigned_date: '2026-01-01',
        due_date: '2026-01-08',
      };

      it('another target: the new one is told it is assigned, the old one that it is withdrawn', async () => {
        assignmentRepo.findOne.mockResolvedValue({ ...OLD_WITH_DATES });
        const dto = {
          section_id: 'section-2',
          assigned_date: '2026-02-01',
          due_date: '2026-02-08',
        };
        const created = await service.reassign('assign-1', dto, ctx);
        expect(notice.notifyAssignment).toHaveBeenCalledWith(created, HOMEWORK);
        // The new target is passed so its students are not told it was withdrawn.
        expect(notice.notifyChange).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'assign-1', section_id: 'section-1' }),
          HOMEWORK,
          'WITHDRAWN',
          created,
        );
      });

      it('same target, new due date: one due-date notice and no assigned notice', async () => {
        assignmentRepo.findOne.mockResolvedValue({ ...OLD_WITH_DATES });
        const dto = {
          section_id: 'section-1',
          assigned_date: '2026-01-01',
          due_date: '2026-01-15',
        };
        const created = await service.reassign('assign-1', dto, ctx);
        expect(notice.notifyChange).toHaveBeenCalledTimes(1);
        expect(notice.notifyChange).toHaveBeenCalledWith(created, HOMEWORK, 'DUE_CHANGED');
        expect(notice.notifyAssignment).not.toHaveBeenCalled();
      });

      it('same target, same due date: nobody is told', async () => {
        assignmentRepo.findOne.mockResolvedValue({ ...OLD_WITH_DATES });
        const dto = {
          section_id: 'section-1',
          assigned_date: '2026-01-01',
          due_date: '2026-01-08',
        };
        await service.reassign('assign-1', dto, ctx);
        expect(notice.notifyChange).not.toHaveBeenCalled();
        expect(notice.notifyAssignment).not.toHaveBeenCalled();
      });

      it('a failing notice never fails the reassign', async () => {
        assignmentRepo.findOne.mockResolvedValue({ ...OLD_WITH_DATES });
        notice.notifyAssignment.mockRejectedValue(new Error('sms provider down'));
        notice.notifyChange.mockRejectedValue(new Error('sms provider down'));
        const dto = {
          section_id: 'section-2',
          assigned_date: '2026-02-01',
          due_date: '2026-02-08',
        };
        await expect(service.reassign('assign-1', dto, ctx)).resolves.toMatchObject({
          section_id: 'section-2',
        });
      });

      it('no notice when the reassign itself fails (lost race)', async () => {
        assignmentRepo.findOne.mockResolvedValue({ ...OLD_WITH_DATES });
        assignmentRepo.update.mockResolvedValueOnce({ affected: 0 });
        const dto = {
          section_id: 'section-2',
          assigned_date: '2026-02-01',
          due_date: '2026-02-08',
        };
        await expect(service.reassign('assign-1', dto, ctx)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(notice.notifyAssignment).not.toHaveBeenCalled();
        expect(notice.notifyChange).not.toHaveBeenCalled();
      });
    });

    // Rule 23: a teacher outside the old target gets the same 404 whether the row is live,
    // superseded or missing: no 400-vs-404 or text oracle.
    it('maps an out-of-scope homework to the one fixed 404 text', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      access.assertCanManageClass.mockRejectedValueOnce(
        new NotFoundException('You do not have access to this class'),
      );
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toThrow(
        new NotFoundException('Homework assignment not found'),
      );
    });

    it('maps an out-of-scope old target to the one fixed 404 text', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      access.assertCanManageSection.mockRejectedValueOnce(
        new NotFoundException('You do not have access to this section'),
      );
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toThrow(
        new NotFoundException('Homework assignment not found'),
      );
    });

    it('a SUPERSEDED row out of scope is a 404, not the superseded 400', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        ...OLD_ASSIGNMENT,
        status: HomeworkAssignmentStatus.SUPERSEDED,
      });
      access.assertCanManageSection.mockRejectedValueOnce(
        new NotFoundException('You do not have access to this section'),
      );
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('checks access to the OLD target before creating the new row (IDOR)', async () => {
      assignmentRepo.findOne.mockResolvedValue({ ...OLD_ASSIGNMENT });
      access.assertCanManageSection.mockRejectedValueOnce(new Error('forbidden'));
      const dto = { section_id: 'section-2', assigned_date: '2026-02-01', due_date: '2026-02-08' };
      await expect(service.reassign('assign-1', dto, ctx)).rejects.toThrow('forbidden');
      // The old target's section (section-1) was checked, not just the new one.
      expect(access.assertCanManageSection).toHaveBeenCalledWith(
        ctx.role,
        ctx.userId,
        'section-1',
        HOMEWORK.subject_id,
        TENANT_ID,
      );
    });
  });

  // #3173: a teacher's duties are read once per request, not once for the findOne gate and
  // again for the row filter.
  describe('findAssignments', () => {
    /** Any builder method returns the builder; the two terminals answer. */
    const chain: unknown = new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === 'getRawMany'
            ? async () => []
            : prop === 'getExists'
              ? async () => true
              : () => chain,
      },
    );

    beforeEach(() => {
      vi.mocked(teacherAssignments).mockReset();
      vi.mocked(teacherAssignments).mockResolvedValue([
        {
          section_id: 'section-1',
          class_id: 'class-1',
          assignment_type: 'CLASS_TEACHER',
          subject_id: null,
        },
      ] as never);
      homeworkRepo.createQueryBuilder.mockReturnValue(chain);
      (assignmentRepo as unknown as { createQueryBuilder: unknown }).createQueryBuilder = vi.fn(
        () => chain,
      );
    });

    it('a teacher request runs the teacher-scope join once', async () => {
      access.canManageTenantWide.mockReturnValue(false);
      await service.findAssignments('hw-1', ctx);
      expect(teacherAssignments).toHaveBeenCalledTimes(1);
    });

    it('a teacher with no duties gets the same 404 as a missing homework (one read)', async () => {
      access.canManageTenantWide.mockReturnValue(false);
      vi.mocked(teacherAssignments).mockResolvedValue([]);
      await expect(service.findAssignments('hw-1', ctx)).rejects.toBeInstanceOf(NotFoundException);
      expect(teacherAssignments).toHaveBeenCalledTimes(1);
    });

    it('an admin never reads the teacher scope', async () => {
      access.canManageTenantWide.mockReturnValue(true);
      await service.findAssignments('hw-1', { ...ctx, role: UserRole.ADMIN });
      expect(teacherAssignments).not.toHaveBeenCalled();
    });
  });

  describe('updateAssignment', () => {
    it('deactivates an ACTIVE assignment', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        id: 'assign-1',
        homework_id: 'hw-1',
        section_id: 'section-1',
        student_id: null,
        assigned_date: '2026-01-01',
        due_date: '2026-01-10',
        status: HomeworkAssignmentStatus.ACTIVE,
        tenant_id: TENANT_ID,
      });
      const result = await service.updateAssignment(
        'assign-1',
        { status: HomeworkAssignmentStatus.DEACTIVATED },
        ctx,
      );
      expect(result.status).toBe(HomeworkAssignmentStatus.DEACTIVATED);
    });

    const activeRow = () => ({
      id: 'assign-1',
      homework_id: 'hw-1',
      section_id: 'section-1',
      student_id: null,
      assigned_date: '2026-01-01',
      due_date: '2026-01-10',
      status: HomeworkAssignmentStatus.ACTIVE,
      tenant_id: TENANT_ID,
    });

    it('#3172 reactivating onto a target that already has a live row is a 409', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        ...activeRow(),
        status: HomeworkAssignmentStatus.DEACTIVATED,
      });
      assignmentRepo.exists.mockResolvedValue(true);
      await expect(
        service.updateAssignment('assign-1', { status: HomeworkAssignmentStatus.ACTIVE }, ctx),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(assignmentRepo.update).not.toHaveBeenCalled();
    });

    it('#3172 changing only the due date of a live row does not run the live-row check', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      await service.updateAssignment('assign-1', { due_date: '2026-01-15' }, ctx);
      expect(assignmentRepo.exists).not.toHaveBeenCalled();
    });

    describe('family notices (#3172)', () => {
      it('deactivating a live row tells families it is withdrawn', async () => {
        assignmentRepo.findOne.mockResolvedValue(activeRow());
        await service.updateAssignment(
          'assign-1',
          { status: HomeworkAssignmentStatus.DEACTIVATED },
          ctx,
        );
        expect(notice.notifyChange).toHaveBeenCalledTimes(1);
        expect(notice.notifyChange).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'assign-1', status: HomeworkAssignmentStatus.DEACTIVATED }),
          HOMEWORK,
          'WITHDRAWN',
        );
      });

      it('moving the due date of a live row tells families the new date', async () => {
        assignmentRepo.findOne.mockResolvedValue(activeRow());
        await service.updateAssignment('assign-1', { due_date: '2026-01-15' }, ctx);
        expect(notice.notifyChange).toHaveBeenCalledWith(
          expect.objectContaining({ due_date: '2026-01-15' }),
          HOMEWORK,
          'DUE_CHANGED',
        );
      });

      it('deactivate plus a new date sends only the withdrawn notice', async () => {
        assignmentRepo.findOne.mockResolvedValue(activeRow());
        await service.updateAssignment(
          'assign-1',
          { status: HomeworkAssignmentStatus.DEACTIVATED, due_date: '2026-01-15' },
          ctx,
        );
        expect(notice.notifyChange).toHaveBeenCalledTimes(1);
        expect(notice.notifyChange.mock.calls[0][2]).toBe('WITHDRAWN');
      });

      it('a repeated PATCH that changes nothing sends nothing', async () => {
        assignmentRepo.findOne.mockResolvedValue(activeRow());
        await service.updateAssignment(
          'assign-1',
          { status: HomeworkAssignmentStatus.ACTIVE, due_date: '2026-01-10' },
          ctx,
        );
        assignmentRepo.findOne.mockResolvedValue({
          ...activeRow(),
          status: HomeworkAssignmentStatus.DEACTIVATED,
        });
        await service.updateAssignment(
          'assign-1',
          { status: HomeworkAssignmentStatus.DEACTIVATED },
          ctx,
        );
        expect(notice.notifyChange).not.toHaveBeenCalled();
      });

      it('reactivating tells families it is back on (once, even with a new date); a failing notice never fails the PATCH', async () => {
        // They were told "does not need to be submitted"; without this the defaulter SMS would
        // be the next thing they hear.
        assignmentRepo.findOne.mockResolvedValue({
          ...activeRow(),
          status: HomeworkAssignmentStatus.DEACTIVATED,
        });
        await service.updateAssignment(
          'assign-1',
          { status: HomeworkAssignmentStatus.ACTIVE, due_date: '2026-01-20' },
          ctx,
        );
        expect(notice.notifyChange).toHaveBeenCalledTimes(1);
        expect(notice.notifyChange).toHaveBeenCalledWith(
          expect.objectContaining({
            status: HomeworkAssignmentStatus.ACTIVE,
            due_date: '2026-01-20',
          }),
          HOMEWORK,
          'REACTIVATED',
        );
        notice.notifyChange.mockClear();

        assignmentRepo.findOne.mockResolvedValue(activeRow());
        notice.notifyChange.mockRejectedValue(new Error('sms provider down'));
        await expect(
          service.updateAssignment('assign-1', { due_date: '2026-01-15' }, ctx),
        ).resolves.toMatchObject({ due_date: '2026-01-15' });
      });
    });

    it('moves the due date in place and keeps the status', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      const events: unknown[] = [];
      const on = (p: unknown) => events.push(p);
      attentionEvents.on(ATTENTION_RECHECK, on);
      try {
        const result = await service.updateAssignment('assign-1', { due_date: '2026-01-15' }, ctx);
        expect(result.id).toBe('assign-1');
        expect(result.due_date).toBe('2026-01-15');
        expect(result.status).toBe(HomeworkAssignmentStatus.ACTIVE);
      } finally {
        attentionEvents.off(ATTENTION_RECHECK, on);
      }
      // The not-submitted alert keys on due_date, so a move rechecks it at once.
      expect(events).toEqual([
        { tenantId: TENANT_ID, ruleKey: 'homework.not_submitted', actorUserId: ctx.userId },
      ]);
    });

    it('rejects a due date before the assigned date and saves nothing', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      await expect(
        service.updateAssignment('assign-1', { due_date: '2025-12-31' }, ctx),
      ).rejects.toThrow('due_date must be on or after assigned_date');
      expect(assignmentRepo.update).not.toHaveBeenCalled();
    });

    it('loses a race (reassign or a second PATCH): 0 rows updated is a 400 and no notice', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      assignmentRepo.update.mockResolvedValueOnce({ affected: 0 });
      await expect(
        service.updateAssignment('assign-1', { status: HomeworkAssignmentStatus.DEACTIVATED }, ctx),
      ).rejects.toThrow('This assignment has changed. Reload and try again.');
      // The update only matches the status this request read, so a double deactivate sends
      // WITHDRAWN once.
      expect(assignmentRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'assign-1', status: HomeworkAssignmentStatus.ACTIVE }),
        { status: HomeworkAssignmentStatus.DEACTIVATED },
      );
      expect(notice.notifyChange).not.toHaveBeenCalled();
    });

    it('rejects an empty body before any lookup', async () => {
      await expect(service.updateAssignment('assign-1', {}, ctx)).rejects.toThrow(
        'Nothing to change',
      );
      expect(assignmentRepo.findOne).not.toHaveBeenCalled();
    });

    it('maps an out-of-scope 404 to the one fixed text (Rule 23)', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      access.assertCanManageSection.mockRejectedValueOnce(
        new NotFoundException('You do not have access to this section'),
      );
      await expect(
        service.updateAssignment('assign-1', { due_date: '2026-01-15' }, ctx),
      ).rejects.toThrow('Homework assignment not found');
    });

    it('lets a ForbiddenException through as 403', async () => {
      assignmentRepo.findOne.mockResolvedValue(activeRow());
      access.assertCanManageSection.mockRejectedValueOnce(new ForbiddenException('no'));
      await expect(
        service.updateAssignment('assign-1', { due_date: '2026-01-15' }, ctx),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for an unknown assignment', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateAssignment('missing', { status: HomeworkAssignmentStatus.DEACTIVATED }, ctx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects updating an already-SUPERSEDED row', async () => {
      assignmentRepo.findOne.mockResolvedValue({
        id: 'assign-1',
        homework_id: 'hw-1',
        section_id: 'section-1',
        student_id: null,
        status: HomeworkAssignmentStatus.SUPERSEDED,
        tenant_id: TENANT_ID,
      });
      await expect(
        service.updateAssignment('assign-1', { status: HomeworkAssignmentStatus.ACTIVE }, ctx),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { PromotionRunStatus, PlacementAlgorithm, PromotionOutcome } from '@biddaloy/shared';
import { PromotionsService } from './promotions.service';

/**
 * Unit tests against mocked repositories — covers validation branches that
 * are cheap to hit without a database (missing class, bad exam ids,
 * DRAFT-only guards). Full end-to-end behavior (placement, commit
 * atomicity, approval-gating) is in promotions.service.integration.spec.ts.
 */
function makeRepo() {
  return {
    findOne: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
    save: vi.fn(),
    create: vi.fn((x) => x),
    delete: vi.fn(),
    update: vi.fn(),
    manager: {
      transaction: vi.fn(async (cb: (manager: unknown) => unknown) => cb(fakeManager())),
    },
  };
}

function fakeManager() {
  const repo = makeRepo();
  return { getRepository: () => repo };
}

describe('PromotionsService (unit)', () => {
  let service: PromotionsService;
  let runRepo: ReturnType<typeof makeRepo>;
  let entryRepo: ReturnType<typeof makeRepo>;
  let classRepo: ReturnType<typeof makeRepo>;
  let sectionRepo: ReturnType<typeof makeRepo>;
  let examRepo: ReturnType<typeof makeRepo>;
  let resultRepo: ReturnType<typeof makeRepo>;
  let studentRepo: ReturnType<typeof makeRepo>;
  let enrollmentRepo: ReturnType<typeof makeRepo>;
  let academicYearRepo: ReturnType<typeof makeRepo>;
  let userRepo: ReturnType<typeof makeRepo>;
  let finalResultRepo: ReturnType<typeof makeRepo>;
  let finalRowRepo: ReturnType<typeof makeRepo>;
  let enrollmentService: { createInTransaction: ReturnType<typeof vi.fn> };
  let auditService: { record: ReturnType<typeof vi.fn> };
  let approvalService: { consume: ReturnType<typeof vi.fn> };

  const TENANT_ID = 'tenant-1';

  beforeEach(() => {
    runRepo = makeRepo();
    entryRepo = makeRepo();
    classRepo = makeRepo();
    sectionRepo = makeRepo();
    examRepo = makeRepo();
    resultRepo = makeRepo();
    studentRepo = makeRepo();
    enrollmentRepo = makeRepo();
    academicYearRepo = makeRepo();
    finalResultRepo = makeRepo();
    finalRowRepo = makeRepo();
    userRepo = makeRepo();
    enrollmentService = { createInTransaction: vi.fn() };
    auditService = { record: vi.fn() };
    approvalService = { consume: vi.fn() };

    service = new PromotionsService(
      runRepo as any,
      entryRepo as any,
      classRepo as any,
      sectionRepo as any,
      examRepo as any,
      resultRepo as any,
      studentRepo as any,
      enrollmentRepo as any,
      academicYearRepo as any,
      userRepo as any,
      enrollmentService as any,
      auditService as any,
      approvalService as any,
      { recordEvent: vi.fn() } as any,
      finalResultRepo as any,
      finalRowRepo as any,
    );
  });

  describe('create: merit source [70.3.3]', () => {
    const base = {
      source_class_id: 'class-1',
      target_academic_year_id: 'year-2',
      algorithm: PlacementAlgorithm.BLOCK,
    };

    it('refuses both exam_ids and final_result_id with 422', async () => {
      await expect(
        service.create({ ...base, exam_ids: ['e1'], final_result_id: 'f1' }, TENANT_ID, 'user-1'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('refuses neither with 422', async () => {
      await expect(service.create({ ...base }, TENANT_ID, 'user-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('refuses a final that is not a PUBLISHED final of the source class (422)', async () => {
      finalResultRepo.findOne.mockResolvedValue(null);
      await expect(
        (service as any).assertUsableFinal('f1', 'class-1', 'year-1', TENANT_ID),
      ).rejects.toThrow(UnprocessableEntityException);
      // The lookup is pinned to PUBLISHED, the class, its year and the tenant.
      expect(finalResultRepo.findOne.mock.calls[0][0].where).toMatchObject({
        status: 'PUBLISHED',
        class_id: 'class-1',
        academic_year_id: 'year-1',
        tenant_id: TENANT_ID,
      });
    });

    it('inside a transaction, reads the final through it with a share lock', async () => {
      // Refresh and commit pass their manager: a concurrent reopen must wait, not slip in.
      const txRepo = makeRepo();
      txRepo.findOne.mockResolvedValue({ id: 'f1' });
      const manager = { getRepository: vi.fn().mockReturnValue(txRepo) };
      await (service as any).assertUsableFinal('f1', 'class-1', 'year-1', TENANT_ID, manager);
      expect(finalResultRepo.findOne).not.toHaveBeenCalled();
      expect(txRepo.findOne.mock.calls[0][0].lock).toEqual({ mode: 'pessimistic_read' });
    });
  });

  describe('create', () => {
    it('throws NotFoundException when the source class does not exist', async () => {
      classRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          {
            source_class_id: 'missing-class',
            target_academic_year_id: 'year-2',
            exam_ids: ['exam-1'],
            algorithm: PlacementAlgorithm.BLOCK,
          },
          TENANT_ID,
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 422 when the target class cannot be picked (numeric_grade null, no override given)', async () => {
      classRepo.findOne.mockResolvedValue({
        id: 'class-1',
        numeric_grade: null,
        shift_id: null,
        version: null,
        academic_year_id: 'year-1',
      });
      // year-2 starts after year-1 ([2614]), so the target-year rule passes.
      academicYearRepo.findOne.mockImplementation(async ({ where }: any) => ({
        id: where.id,
        start_date: where.id === 'year-1' ? '2026-01-01' : '2027-01-01',
      }));

      await expect(
        service.create(
          {
            source_class_id: 'class-1',
            target_academic_year_id: 'year-2',
            exam_ids: ['exam-1'],
            algorithm: PlacementAlgorithm.BLOCK,
          },
          TENANT_ID,
          'user-1',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[2614] throws 422 TARGET_YEAR_NOT_LATER when the target year starts on or before the source', async () => {
      classRepo.findOne.mockResolvedValue({ id: 'class-1', academic_year_id: 'year-1' });
      academicYearRepo.findOne.mockResolvedValue({ start_date: '2026-01-01' });

      await expect(
        service.create(
          {
            source_class_id: 'class-1',
            target_academic_year_id: 'year-1',
            exam_ids: ['exam-1'],
            algorithm: PlacementAlgorithm.BLOCK,
          },
          TENANT_ID,
          'user-1',
        ),
      ).rejects.toMatchObject({ response: { details: { code: 'TARGET_YEAR_NOT_LATER' } } });
    });
  });

  describe('patchEntries', () => {
    it('throws ConflictException when the run is not DRAFT', async () => {
      const manager = {
        getRepository: (entity: unknown) => {
          if ((entity as { name?: string })?.name === 'PromotionEntry') return entryRepo;
          return {
            ...runRepo,
            findOne: vi.fn().mockResolvedValue({
              id: 'run-1',
              status: PromotionRunStatus.COMMITTED,
              tenant_id: TENANT_ID,
            }),
          };
        },
      };
      runRepo.manager.transaction.mockImplementation(async (cb: (m: unknown) => unknown) =>
        cb(manager),
      );

      await expect(
        service.patchEntries(
          'run-1',
          [{ student_id: 's1', final_outcome: PromotionOutcome.RETAIN }],
          TENANT_ID,
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    function patchWith(run: Record<string, unknown>, entry: Record<string, unknown>) {
      const manager = {
        getRepository: (e: unknown) =>
          (e as { name?: string })?.name === 'PromotionEntry'
            ? { ...entryRepo, find: vi.fn().mockResolvedValue([entry]) }
            : { ...runRepo, findOne: vi.fn().mockResolvedValue(run) },
      };
      runRepo.manager.transaction.mockImplementation(async (cb: (m: unknown) => unknown) =>
        cb(manager),
      );
    }

    it('refuses CONDITIONAL on a graduation run (CONDITIONAL_NOT_FOR_GRADUATION)', async () => {
      patchWith(
        {
          id: 'run-1',
          status: PromotionRunStatus.DRAFT,
          tenant_id: TENANT_ID,
          target_class_id: null,
        },
        {
          student_id: 's1',
          suggested_outcome: PromotionOutcome.GRADUATE,
          final_outcome: PromotionOutcome.GRADUATE,
        },
      );
      const err = await service
        .patchEntries(
          'run-1',
          [
            {
              student_id: 's1',
              final_outcome: PromotionOutcome.CONDITIONAL,
              override_note: 'Re-test',
            },
          ],
          TENANT_ID,
          'user-1',
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse().details.code).toBe('CONDITIONAL_NOT_FOR_GRADUATION');
    });

    it('refuses GRADUATE on a run with a target class (GRADUATE_ONLY_IN_GRADUATION_RUN)', async () => {
      patchWith(
        {
          id: 'run-1',
          status: PromotionRunStatus.DRAFT,
          tenant_id: TENANT_ID,
          target_class_id: 'class-2',
        },
        {
          student_id: 's1',
          suggested_outcome: PromotionOutcome.PROMOTE,
          final_outcome: PromotionOutcome.PROMOTE,
        },
      );
      const err = await service
        .patchEntries(
          'run-1',
          [
            {
              student_id: 's1',
              final_outcome: PromotionOutcome.GRADUATE,
              override_note: 'Leaving',
            },
          ],
          TENANT_ID,
          'user-1',
        )
        .catch((e) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse().details.code).toBe('GRADUATE_ONLY_IN_GRADUATION_RUN');
    });

    it('a group-only patch on an old GRADUATE row in a normal run is not refused (commit refuses it)', async () => {
      patchWith(
        {
          id: 'run-1',
          status: PromotionRunStatus.DRAFT,
          tenant_id: TENANT_ID,
          target_class_id: 'c2',
        },
        {
          student_id: 's1',
          suggested_outcome: PromotionOutcome.PROMOTE,
          final_outcome: PromotionOutcome.GRADUATE,
          override_note: 'Leaving',
        },
      );
      const err = await service
        .patchEntries('run-1', [{ student_id: 's1', group_name: 'Science' }], TENANT_ID, 'user-1')
        .catch((e) => e);
      expect(err?.getResponse?.()?.details?.code).not.toBe('GRADUATE_ONLY_IN_GRADUATION_RUN');
    });

    it('CONDITIONAL without a note -> 422', async () => {
      patchWith(
        {
          id: 'run-1',
          status: PromotionRunStatus.DRAFT,
          tenant_id: TENANT_ID,
          target_class_id: 'class-7',
        },
        {
          student_id: 's1',
          suggested_outcome: PromotionOutcome.PROMOTE,
          final_outcome: PromotionOutcome.PROMOTE,
        },
      );
      await expect(
        service.patchEntries(
          'run-1',
          [{ student_id: 's1', final_outcome: PromotionOutcome.CONDITIONAL }],
          TENANT_ID,
          'user-1',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('placePromoteEntries', () => {
    it('places CONDITIONAL entries like PROMOTE', () => {
      const mk = (id: string, o: PromotionOutcome) =>
        ({ student_id: id, final_outcome: o, merit_rank: 1, group_name: null }) as any;
      const entries = [
        mk('p', PromotionOutcome.PROMOTE),
        mk('c', PromotionOutcome.CONDITIONAL),
        mk('r', PromotionOutcome.RETAIN),
      ];
      (service as any).placePromoteEntries(
        entries,
        [{ id: 'sec-1', section_name: 'A', capacity: 10, group_name: null }],
        PlacementAlgorithm.BLOCK,
      );
      expect(entries[0].target_section_id).toBe('sec-1');
      expect(entries[1].target_section_id).toBe('sec-1');
      expect(entries[1].new_roll_number).not.toBeNull();
      expect(entries[2].target_section_id).toBeNull();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the run does not exist', async () => {
      runRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('run-1', TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the run is COMMITTED', async () => {
      runRepo.findOne.mockResolvedValue({ id: 'run-1', status: PromotionRunStatus.COMMITTED });
      await expect(service.remove('run-1', TENANT_ID)).rejects.toThrow(ConflictException);
    });

    it('deletes a DRAFT run', async () => {
      runRepo.findOne.mockResolvedValue({ id: 'run-1', status: PromotionRunStatus.DRAFT });
      runRepo.delete.mockResolvedValue({ affected: 1, raw: [] });
      await service.remove('run-1', TENANT_ID);
      expect(runRepo.delete).toHaveBeenCalledWith({
        id: 'run-1',
        tenant_id: TENANT_ID,
        status: PromotionRunStatus.DRAFT,
      });
    });

    // B6 — the read-then-check-then-delete pattern raced a concurrent
    // commit: status is now part of the DELETE's own WHERE clause, so a
    // run that flipped to COMMITTED between the initial read and the
    // delete deletes zero rows instead of destroying a committed run.
    it('throws ConflictException when the run changes status between the read and the delete (B6 race)', async () => {
      runRepo.findOne.mockResolvedValue({ id: 'run-1', status: PromotionRunStatus.DRAFT });
      runRepo.delete.mockResolvedValue({ affected: 0, raw: [] });
      await expect(service.remove('run-1', TENANT_ID)).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a run in another tenant', async () => {
      runRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('run-1', TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinalResultMode, FinalResultStatus, ExamStatus } from '@biddaloy/shared';
import { FinalResultsService, equalShares } from './final-results.service';
import { FinalResult } from './entities/final-result.entity';
import { FinalResultRow } from './entities/final-result-row.entity';
import { FinalResultWeight } from './entities/final-result-weight.entity';
import { Exam } from '../exams/entities/exam.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { GradingBand } from '../grading/entities/grading-band.entity';

/**
 * [70.2.1] Lifecycle and refusal rules of `FinalResultsService`, on fake repositories.
 * The maths is covered by `final-result-rules.spec.ts` and the integration spec.
 */

const TENANT = 'tenant-1';
const FINAL_ID = 'f1';

interface World {
  final: Record<string, unknown>;
  weights: Array<{ exam_id: string; subject_id: string | null; share_percent: string }>;
  exams: Record<string, { id: string; status: string; class_id: string; academic_year_id: string }>;
  rows: Array<{ id: string; student_id: string }>;
}

function build(world: World) {
  const finalRepo: any = {
    findOne: vi.fn(async () => world.final),
    update: vi.fn(async (_w: unknown, patch: Record<string, unknown>) => {
      Object.assign(world.final, patch);
    }),
    softDelete: vi.fn(async () => undefined),
  };
  const stubs = new Map<unknown, any>([
    [FinalResult, finalRepo],
    [FinalResultWeight, { find: vi.fn(async () => world.weights), delete: vi.fn(), save: vi.fn() }],
    [FinalResultRow, { find: vi.fn(async () => world.rows), update: vi.fn(async () => undefined) }],
    [
      Exam,
      {
        findOne: vi.fn(async ({ where }: any) => world.exams[where.id] ?? null),
      },
    ],
    [
      AcademicYear,
      {
        findOneOrFail: vi.fn(async () => ({ start_date: '2026-01-01', end_date: '2026-12-31' })),
      },
    ],
    [GradingScale, { find: vi.fn(async () => []) }],
    [GradingBand, { find: vi.fn(async () => []) }],
  ]);
  const manager: any = {
    getRepository: (e: unknown) => stubs.get(e) ?? {},
    transaction: async (cb: (m: unknown) => unknown) => cb(manager),
  };
  finalRepo.manager = manager;
  const audit = {
    record: vi.fn(async () => undefined),
    recordApproved: vi.fn(async () => undefined),
  };
  const attendance = { getSummariesForStudents: vi.fn(async () => new Map()) };
  const service = new FinalResultsService(finalRepo, audit as any, attendance as any);
  return { service, finalRepo, audit, attendance, world };
}

function baseWorld(over: Partial<World> = {}): World {
  return {
    final: {
      id: FINAL_ID,
      tenant_id: TENANT,
      class_id: 'c1',
      academic_year_id: 'y1',
      status: FinalResultStatus.DRAFT,
      mode: FinalResultMode.WEIGHTED,
      best_of_count: null,
      rounding: 'WHOLE',
      fail_if_any_exam_fails: false,
      published_at: null,
    },
    weights: [],
    exams: {},
    rows: [],
    ...over,
  };
}

const code = (c: string) => ({ response: { details: { code: c } } });

describe('equalShares', () => {
  it('splits 100 into hundredths that always add up to exactly 100.00', () => {
    expect(equalShares(1)).toEqual([100]);
    expect(equalShares(2)).toEqual([50, 50]);
    // The odd hundredth goes to the first exam, never lost.
    expect(equalShares(3)).toEqual([33.34, 33.33, 33.33]);
    expect(equalShares(3).reduce((s, v) => s + Math.round(v * 100), 0)).toBe(10_000);
    expect(equalShares(0)).toEqual([]);
  });
});

describe('FinalResultsService refusals', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build(baseWorld());
  });

  it('PATCH is refused once the final result is published', async () => {
    ctx.world.final.status = FinalResultStatus.PUBLISHED;
    await expect(
      ctx.service.update(FINAL_ID, { rounding: 'WHOLE' } as any, TENANT, 'u1'),
    ).rejects.toMatchObject(code('FINAL_NOT_DRAFT'));
    expect(ctx.finalRepo.update).not.toHaveBeenCalled();
  });

  it('DELETE is refused once the final result is published', async () => {
    ctx.world.final.status = FinalResultStatus.PUBLISHED;
    await expect(ctx.service.remove(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_NOT_DRAFT'),
    );
    expect(ctx.finalRepo.softDelete).not.toHaveBeenCalled();
  });

  it('build is refused on a published final result', async () => {
    ctx.world.final.status = FinalResultStatus.PUBLISHED;
    await expect(ctx.service.build(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_PUBLISHED'),
    );
  });

  it('build with no exam in the shares is refused', async () => {
    await expect(ctx.service.build(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_NO_EXAMS'),
    );
  });

  it('build is refused while a source exam is not published', async () => {
    ctx.world.weights = [{ exam_id: 'e1', subject_id: null, share_percent: '100.00' }];
    ctx.world.exams.e1 = {
      id: 'e1',
      status: ExamStatus.PROCESSED,
      class_id: 'c1',
      academic_year_id: 'y1',
    };
    await expect(ctx.service.build(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_SOURCE_UNPUBLISHED'),
    );
  });

  it('build is refused when a deleted exam is still in the shares', async () => {
    ctx.world.weights = [{ exam_id: 'gone', share_percent: '100.00', subject_id: null }];
    await expect(ctx.service.build(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_SOURCE_UNPUBLISHED'),
    );
  });

  it('build is refused when the whole-exam shares do not add up to 100', async () => {
    ctx.world.weights = [
      { exam_id: 'e1', subject_id: null, share_percent: '30.00' },
      { exam_id: 'e2', subject_id: null, share_percent: '60.00' },
    ];
    for (const id of ['e1', 'e2']) {
      ctx.world.exams[id] = {
        id,
        status: ExamStatus.PUBLISHED,
        class_id: 'c1',
        academic_year_id: 'y1',
      };
    }
    await expect(ctx.service.build(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_SHARES_NOT_HUNDRED'),
    );
  });

  it('build is refused when one subject has its own shares that do not add up to 100', async () => {
    ctx.world.weights = [
      { exam_id: 'e1', subject_id: null, share_percent: '100.00' },
      { exam_id: 'e1', subject_id: 's1', share_percent: '70.00' },
    ];
    ctx.world.exams.e1 = {
      id: 'e1',
      status: ExamStatus.PUBLISHED,
      class_id: 'c1',
      academic_year_id: 'y1',
    };
    await expect(ctx.service.build(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_SHARES_NOT_HUNDRED'),
    );
  });

  it('publish is refused unless the final result was built', async () => {
    await expect(ctx.service.publish(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_NOT_PROCESSED'),
    );
  });

  it('reopen is refused unless the final result is published', async () => {
    ctx.world.final.status = FinalResultStatus.PROCESSED;
    await expect(ctx.service.reopen(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_NOT_PUBLISHED'),
    );
  });
});

describe('FinalResultsService transitions', () => {
  it('PROCESSED -> PUBLISHED -> PROCESSED, clearing published_at and auditing the approval', async () => {
    const ctx = build(baseWorld());
    ctx.world.final.status = FinalResultStatus.PROCESSED;
    ctx.world.weights = [{ exam_id: 'e1', subject_id: null, share_percent: '100.00' }];
    ctx.world.exams.e1 = {
      id: 'e1',
      status: ExamStatus.PUBLISHED,
      class_id: 'c1',
      academic_year_id: 'y1',
    };

    await ctx.service.publish(FINAL_ID, TENANT, 'u1');
    expect(ctx.world.final.status).toBe(FinalResultStatus.PUBLISHED);
    expect(ctx.world.final.published_at).toBeInstanceOf(Date);

    // A second publish is a clean 409, never a second state change.
    await expect(ctx.service.publish(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_PUBLISHED'),
    );

    await ctx.service.reopen(FINAL_ID, TENANT, 'u1', undefined, {
      approverId: 'boss',
      scope: 'results.reopen',
    } as any);
    expect(ctx.world.final.status).toBe(FinalResultStatus.PROCESSED);
    expect(ctx.world.final.published_at).toBeNull();
    expect(ctx.audit.recordApproved).toHaveBeenCalledTimes(1);
  });

  it('publish is refused when a source exam was reopened after the build', async () => {
    const ctx = build(baseWorld());
    ctx.world.final.status = FinalResultStatus.PROCESSED;
    ctx.world.weights = [{ exam_id: 'e1', subject_id: null, share_percent: '100.00' }];
    ctx.world.exams.e1 = {
      id: 'e1',
      status: ExamStatus.PROCESSED,
      class_id: 'c1',
      academic_year_id: 'y1',
    };
    await expect(ctx.service.publish(FINAL_ID, TENANT, 'u1')).rejects.toMatchObject(
      code('FINAL_SOURCE_UNPUBLISHED'),
    );
    expect(ctx.world.final.status).toBe(FinalResultStatus.PROCESSED);
  });
});

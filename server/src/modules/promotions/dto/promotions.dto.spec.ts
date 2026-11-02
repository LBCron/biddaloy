import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PromotionOutcome } from '@biddaloy/shared';
import { CreatePromotionRunDto, PatchPromotionEntryDto } from './promotions.dto';

const STUDENT_ID = '00000000-0000-4000-8000-000000000001';

async function errorsFor(final_outcome: string) {
  const dto = plainToInstance(PatchPromotionEntryDto, { student_id: STUDENT_ID, final_outcome });
  return validate(dto);
}

describe('PatchPromotionEntryDto.final_outcome', () => {
  it('accepts PROMOTE, RETAIN, GRADUATE and CONDITIONAL', async () => {
    expect(await errorsFor(PromotionOutcome.PROMOTE)).toHaveLength(0);
    expect(await errorsFor(PromotionOutcome.RETAIN)).toHaveLength(0);
    expect(await errorsFor(PromotionOutcome.GRADUATE)).toHaveLength(0);
    expect(await errorsFor(PromotionOutcome.CONDITIONAL)).toHaveLength(0);
  });

  it('refuses an unknown outcome with a message naming the allowed outcomes', async () => {
    const errors = await errorsFor('BOGUS' as PromotionOutcome);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('final_outcome');
    expect(Object.values(errors[0].constraints ?? {})[0]).toBe(
      'final_outcome must be one of: PROMOTE, RETAIN, GRADUATE, CONDITIONAL',
    );
  });
});

describe('CreatePromotionRunDto merit source [70.3.3]', () => {
  const base = {
    source_class_id: STUDENT_ID,
    target_academic_year_id: STUDENT_ID,
    algorithm: 'BLOCK',
  };
  const check = (extra: object) =>
    validate(plainToInstance(CreatePromotionRunDto, { ...base, ...extra }));

  it('accepts exam_ids alone and final_result_id alone', async () => {
    expect(await check({ exam_ids: ['11111111-1111-4111-8111-111111111111'] })).toHaveLength(0);
    expect(await check({ final_result_id: STUDENT_ID })).toHaveLength(0);
  });

  it('refuses neither source', async () => {
    expect((await check({})).length).toBeGreaterThan(0);
    expect((await check({ exam_ids: null, final_result_id: null })).length).toBeGreaterThan(0);
  });

  it('treats an explicit null on the other field as absent', async () => {
    // A form that always sends both keys sends null for the unused one.
    const examId = '11111111-1111-4111-8111-111111111111';
    expect(await check({ exam_ids: [examId], final_result_id: null })).toHaveLength(0);
    expect(await check({ exam_ids: null, final_result_id: STUDENT_ID })).toHaveLength(0);
  });

  it('refuses a non-UUID final_result_id', async () => {
    expect((await check({ final_result_id: 'nope' })).length).toBeGreaterThan(0);
  });

  it('validates both fields when both are sent (no skip bypass)', async () => {
    expect((await check({ exam_ids: [], final_result_id: 'nope' })).length).toBeGreaterThan(0);
  });
});

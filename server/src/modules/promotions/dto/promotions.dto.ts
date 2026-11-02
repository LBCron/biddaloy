import {
  IsUUID,
  IsOptional,
  IsEnum,
  IsIn,
  IsArray,
  ArrayMinSize,
  IsString,
  IsNotEmpty,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PlacementAlgorithm, PromotionOutcome } from '@biddaloy/shared';

/** The outcomes `commit` handles. CONDITIONAL moves up like PROMOTE (#2296). */
export const COMMITTABLE_PROMOTION_OUTCOMES: PromotionOutcome[] = [
  PromotionOutcome.PROMOTE,
  PromotionOutcome.RETAIN,
  PromotionOutcome.GRADUATE,
  PromotionOutcome.CONDITIONAL,
];

export class CreatePromotionRunDto {
  @IsUUID()
  source_class_id: string;

  @IsUUID()
  target_academic_year_id: string;

  @IsOptional()
  @IsUUID()
  target_class_id?: string;

  // Exactly one merit source: the exam list or a PUBLISHED final result (70.3.3).
  // A field that is sent is always validated; the service enforces the XOR (422, fixed sentence).
  @ValidateIf(
    (o: CreatePromotionRunDto) => o.exam_ids !== undefined || o.final_result_id === undefined,
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  exam_ids?: string[];

  @ValidateIf(
    (o: CreatePromotionRunDto) => o.final_result_id !== undefined || o.exam_ids === undefined,
  )
  @IsUUID()
  final_result_id?: string;

  @IsEnum(PlacementAlgorithm)
  algorithm: PlacementAlgorithm;
}

export class PatchPromotionEntryDto {
  @IsUUID()
  student_id: string;

  @IsOptional()
  @IsIn(COMMITTABLE_PROMOTION_OUTCOMES, {
    message: `final_outcome must be one of: ${COMMITTABLE_PROMOTION_OUTCOMES.join(', ')}`,
  })
  final_outcome?: PromotionOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  group_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  override_note?: string;
}

export class SuggestTargetQueryDto {
  @IsUUID()
  source_class_id: string;

  @IsUUID()
  target_academic_year_id: string;
}

export class ListPromotionRunsQueryDto {
  @IsOptional()
  @IsUUID()
  source_class_id?: string;
}

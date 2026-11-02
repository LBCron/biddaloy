import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { FinalResultMode, FinalResultRounding } from '@biddaloy/shared';

/** [70.2.1] One exam's share, whole exam (`subject_id` null) or one subject. */
export class FinalResultWeightBodyDto {
  @IsUUID()
  exam_id: string;

  @IsOptional()
  @IsUUID()
  subject_id?: string | null;

  /** 0-100, two decimals. The sum-to-100 rule is checked at build, per subject. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  share_percent: number;
}

export class ListFinalResultsQueryDto {
  @IsUUID()
  academic_year_id: string;
}

export class CreateFinalResultBodyDto {
  @IsUUID()
  class_id: string;

  @IsUUID()
  academic_year_id: string;
}

export class UpdateFinalResultBodyDto {
  @IsOptional()
  @IsEnum(FinalResultMode)
  mode?: FinalResultMode;

  /** Only for BEST_OF. null/absent for WEIGHTED. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  best_of_count?: number | null;

  @IsOptional()
  @IsEnum(FinalResultRounding)
  rounding?: FinalResultRounding;

  @IsOptional()
  @IsBoolean()
  fail_if_any_exam_fails?: boolean;

  /** Replaces the whole weight set when present. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FinalResultWeightBodyDto)
  weights?: FinalResultWeightBodyDto[];
}

export class FinalResultRowsQueryDto {
  @IsOptional()
  @IsUUID()
  section_id?: string;

  /** Capped at 100 (Rule 5). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

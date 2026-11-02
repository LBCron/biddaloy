import {
  IsString,
  IsUUID,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  Max,
  MaxLength,
  IsNotEmpty,
  IsEnum,
  IsDateString,
  ValidateIf,
  IsNumberString,
  IsArray,
  ArrayNotEmpty,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { ExamKind, ExamComponentKind, ExamComponentSource, ExamStatus } from '@biddaloy/shared';
import { Exam } from '../entities/exam.entity';

/** `numeric(6,2)` column range — a value outside this overflows the
 * column and 500s instead of 400ing at the DTO. */
const MAX_MARKS = 9999.99;

@ValidatorConstraint({ name: 'isPositiveMarksString', async: false })
class IsPositiveMarksStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    const n = Number(value);
    return typeof value === 'string' && Number.isFinite(n) && n > 0 && n <= MAX_MARKS;
  }
  defaultMessage(): string {
    return `full_marks must be greater than 0 and at most ${MAX_MARKS}`;
  }
}

/** Exported for reuse by marks.dto.ts's cell `value` — same numeric(6,2)
 * bound applies to an entered mark as to a component's pass_marks. */
@ValidatorConstraint({ name: 'isNonNegativeMarksString', async: false })
export class IsNonNegativeMarksStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    const n = Number(value);
    return typeof value === 'string' && Number.isFinite(n) && n >= 0 && n <= MAX_MARKS;
  }
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be between 0 and ${MAX_MARKS}`;
  }
}

// --- Exams ---

export class CreateExamDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name: string;

  @IsNotEmpty()
  @IsEnum(ExamKind)
  kind: ExamKind;

  @IsNotEmpty()
  @IsUUID()
  academic_year_id: string;

  @IsNotEmpty()
  @IsUUID()
  class_id: string;

  @IsOptional()
  @IsUUID()
  academic_term_id?: string | null;

  /** Optional exam template: its components for this class are copied onto the new exam. */
  @IsOptional()
  @IsUUID()
  template_id?: string;

  /** Last day for mark entry (YYYY-MM-DD). */
  @ValidateIf((_, v) => v !== undefined) // omitted is fine; null is not (only update clears)
  @IsDateString({ strict: true })
  mark_entry_deadline?: string;
}

/** POST /exams response: the created exam plus how many template components were copied. */
export class CreateExamResponseDto extends Exam {
  components_created: number;
}

export class UpdateExamDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @IsEnum(ExamKind)
  kind?: ExamKind;

  // Class/academic-year change is rejected in the service once any Mark
  // exists for the exam (issue's rule #1) — the DTO only checks shape.
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  @IsOptional()
  @IsUUID()
  academic_term_id?: string | null;

  /** YYYY-MM-DD; `null` clears it. */
  @ValidateIf((_, v) => v != null) // undefined = unchanged, null = clear
  @IsDateString({ strict: true })
  mark_entry_deadline?: string | null;

  // Deliberately no `status` field here. `ExamsService.update` writes this
  // DTO straight through to `repo.update` — a status field would let any
  // EXAM_MANAGE caller skip the D12 lifecycle (DRAFT→PROCESSED→PUBLISHED)
  // and the `@RequireApproval` gate the entity docstring requires for
  // reopening a PUBLISHED exam. Status changes belong to dedicated
  // process/publish/reopen endpoints (19.5.1), not this generic PATCH.
}

export class QueryExamDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @IsUUID()
  class_id?: string;

  /** Filters before paging, so a picker of PUBLISHED exams is never cut short by drafts. */
  @IsOptional()
  @IsEnum(ExamStatus)
  status?: ExamStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

// --- Exam components ---

export class CreateExamComponentDto {
  @IsNotEmpty()
  @IsUUID()
  subject_id: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name: string;

  @IsNotEmpty()
  @IsEnum(ExamComponentKind)
  kind: ExamComponentKind;

  @IsOptional()
  @IsEnum(ExamComponentSource)
  source?: ExamComponentSource;

  @IsNotEmpty()
  @IsNumberString()
  @Validate(IsPositiveMarksStringConstraint)
  full_marks: string;

  @IsOptional()
  @IsNumberString()
  @Validate(IsNonNegativeMarksStringConstraint)
  pass_marks?: string | null;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  sequence: number;
}

export class UpdateExamComponentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name?: string;

  @IsOptional()
  @IsEnum(ExamComponentKind)
  kind?: ExamComponentKind;

  @IsOptional()
  @IsEnum(ExamComponentSource)
  source?: ExamComponentSource;

  @IsOptional()
  @IsNumberString()
  @Validate(IsPositiveMarksStringConstraint)
  full_marks?: string;

  @IsOptional()
  @IsNumberString()
  @Validate(IsNonNegativeMarksStringConstraint)
  pass_marks?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  sequence?: number;
}

export class QueryExamComponentDto {
  @IsOptional()
  @IsUUID()
  subject_id?: string;
}

export class CopyExamComponentsDto {
  // Source is either another subject in the same exam (same exam_id,
  // different source_subject_id) or the same subject in another exam
  // (different source_exam_id, same subject).
  @IsNotEmpty()
  @IsUUID()
  source_exam_id: string;

  @IsNotEmpty()
  @IsUUID()
  source_subject_id: string;

  @IsNotEmpty()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  target_subject_ids: string[];
}

// --- Subject choices ---

export class SetSubjectChoiceDto {
  @IsNotEmpty()
  @IsUUID()
  class_subject_id: string;

  @IsOptional()
  @IsBoolean()
  is_fourth?: boolean;
}

// `class_id` isn't a query param here (unlike exams/components lists) —
// the student's class is derived from their own `class_section_id`
// (`SubjectChoicesService.listOptions`), so accepting a caller-supplied
// class would be either redundant or a way to ask about the wrong class.
export class QuerySubjectChoiceDto {
  @IsNotEmpty()
  @IsUUID()
  academic_year_id: string;
}

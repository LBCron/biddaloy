import { ApiExtraModels, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const MERIT_SCOPES = ['CLASS', 'SECTION'] as const;
export type MeritScope = (typeof MERIT_SCOPES)[number];

/** [48.2.05] D29: class positions 1-3 by default; scope and N are chosen at print time. */
export class MeritCandidatesQueryDto {
  @ApiPropertyOptional({ enum: MERIT_SCOPES, default: 'CLASS' })
  @IsOptional()
  @IsIn(MERIT_SCOPES)
  scope: MeritScope = 'CLASS';

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  top: number = 3;
}

export class AdmitCardStudentDto {
  @ApiProperty() student_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty() roll_number: number;
  @ApiProperty({ nullable: true, type: String }) section_name: string | null;
  @ApiProperty() printed_copies: number;
  @ApiProperty({ nullable: true, type: String }) last_printed_at: string | null;
  /** `null` when the school does not withhold for dues; never an amount. */
  @ApiProperty({ nullable: true, type: Boolean }) has_dues: boolean | null;
}

export class AdmitCardRosterDto {
  @ApiProperty() withhold_for_dues: boolean;
  @ApiProperty() seat_plan_published: boolean;
  @ApiProperty({ type: [AdmitCardStudentDto] }) students: AdmitCardStudentDto[];
}

export class MeritCandidateDto {
  @ApiProperty() student_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty({ nullable: true, type: String }) section_name: string | null;
  @ApiProperty() position: number;
  @ApiProperty({ nullable: true, type: Number }) section_position: number | null;
  @ApiProperty() gpa: number;
}

/** [48.3.gS-01] One section's tabulation sheet. */
export class TabulationQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  section_id: string;
}

export class TabulationSubjectDto {
  @ApiProperty() subject_id: string;
  @ApiProperty() name_en: string;
  @ApiProperty({ nullable: true, type: String }) name_bn: string | null;
  @ApiProperty() full_marks: number;
}

export class TabulationCellDto {
  @ApiProperty() obtained: number;
  @ApiProperty() grade: string;
  @ApiProperty() is_fail: boolean;
}

@ApiExtraModels(TabulationCellDto)
export class TabulationRowDto {
  @ApiProperty() student_id: string;
  @ApiProperty() roll_number: number;
  @ApiProperty() full_name: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/TabulationCellDto' },
  })
  cells: Record<string, TabulationCellDto>;
  @ApiProperty() total_marks: number;
  @ApiProperty() gpa: number;
  @ApiProperty() grade: string;
  @ApiProperty({ nullable: true, type: Number }) section_position: number | null;
  @ApiProperty() is_fail: boolean;
}

export class TabulationDto {
  @ApiProperty() exam: { id: string; name: string; published_at: string | null };
  @ApiProperty() section: { id: string; name: string; class_name: string };
  @ApiProperty({ type: [TabulationSubjectDto] }) subjects: TabulationSubjectDto[];
  @ApiProperty({ type: [TabulationRowDto] }) rows: TabulationRowDto[];
}

/** [70.4.1, D20] One section's tabulation of a final result: each counted exam, then the final. */
export class FinalTabulationExamDto {
  @ApiProperty() exam_id: string;
  @ApiProperty() name: string;
  /** Whole-exam share; null when the exam only has per-subject shares. */
  @ApiProperty({ nullable: true, type: Number }) share_percent: number | null;
}

export class FinalTabulationSubjectDto {
  @ApiProperty() subject_id: string;
  @ApiProperty() name_en: string;
  @ApiProperty({ nullable: true, type: String }) name_bn: string | null;
}

export class FinalTabulationCellDto extends TabulationCellDto {
  /** Subject total in each counted exam (key = exam id); null = absent (counts 0, D2). */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number', nullable: true } })
  per_exam: Record<string, number | null>;
}

@ApiExtraModels(FinalTabulationCellDto)
export class FinalTabulationRowDto {
  @ApiProperty() student_id: string;
  @ApiProperty() roll_number: number;
  @ApiProperty() full_name: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/FinalTabulationCellDto' },
  })
  cells: Record<string, FinalTabulationCellDto>;
  /** Each counted exam's total (key = exam id); null = no result in that exam. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number', nullable: true } })
  exam_totals: Record<string, number | null>;
  @ApiProperty() total_marks: number;
  @ApiProperty() gpa: number;
  @ApiProperty() grade: string;
  @ApiProperty({ nullable: true, type: Number }) position: number | null;
  @ApiProperty({ nullable: true, type: Number }) section_position: number | null;
  @ApiProperty() is_fail: boolean;
}

export class FinalTabulationDto {
  @ApiProperty() final: {
    id: string;
    academic_year_name: string;
    status: string;
    published_at: string | null;
  };
  @ApiProperty() section: { id: string; name: string; class_name: string };
  @ApiProperty({ type: [FinalTabulationExamDto] }) exams: FinalTabulationExamDto[];
  @ApiProperty({ type: [FinalTabulationSubjectDto] }) subjects: FinalTabulationSubjectDto[];
  @ApiProperty({ type: [FinalTabulationRowDto] }) rows: FinalTabulationRowDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { MarkGridState } from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** `GET /coordination/overview?date=YYYY-MM-DD` — date defaults to the school's today. */
export class CoordinationOverviewQueryDto {
  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

export class CoordinationSectionDto {
  @ApiProperty({ format: 'uuid' }) section_id: string;
  @ApiProperty() section_name: string;
  /** D23: a FINALIZED whole-day register for the date (the same test the alert uses). */
  @ApiProperty() attendance_taken: boolean;
  @ApiProperty({ type: String, nullable: true }) taken_by_name: string | null;
  @ApiProperty({ type: String, nullable: true }) class_teacher_name: string | null;
}

export class CoordinationPendingGridDto {
  @ApiProperty({ format: 'uuid' }) exam_id: string;
  @ApiProperty() exam_name: string;
  @ApiProperty({ format: 'uuid' }) section_id: string;
  @ApiProperty() section_name: string;
  @ApiProperty({ format: 'uuid' }) subject_id: string;
  @ApiProperty({ type: String, nullable: true }) subject_name: string | null;
  @ApiProperty({ type: String, nullable: true }) teacher_name: string | null;
  @ApiProperty({ enum: MarkGridState, enumName: 'MarkGridState' }) state: MarkGridState;
}

export class CoordinationTeacherDto {
  @ApiProperty({ format: 'uuid' }) user_id: string;
  @ApiProperty({ format: 'uuid' }) teacher_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty({ type: [String] }) section_names: string[];
  @ApiProperty({ type: [String] }) subject_names: string[];
}

/** One coordinator row of the caller: a class (subject null) or a class + one subject. */
export class CoordinationClassDto {
  @ApiProperty({ format: 'uuid' }) class_id: string;
  @ApiProperty() class_name: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) subject_id: string | null;
  @ApiProperty({ type: String, nullable: true }) subject_name: string | null;
  @ApiProperty({ type: [CoordinationSectionDto] }) sections: CoordinationSectionDto[];
  @ApiProperty({ type: [CoordinationPendingGridDto] }) pending_grids: CoordinationPendingGridDto[];
  @ApiProperty({ type: [CoordinationTeacherDto] }) teachers: CoordinationTeacherDto[];
}

export class CoordinationOverviewDto {
  @ApiProperty({ example: '2026-10-31' }) date: string;
  @ApiProperty({ type: [CoordinationClassDto] }) classes: CoordinationClassDto[];
}

/** `POST /coordination/alerts` (D8, D24): the checked teachers and the message, nothing else. */
export class NotifyCoordinatedTeachersDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  userIds: string[];

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @SanitizeText()
  message: string;
}

export class NotifyCoordinatedTeachersResultDto {
  @ApiProperty({ format: 'uuid' }) alert_id: string;
  @ApiProperty() recipient_count: number;
}

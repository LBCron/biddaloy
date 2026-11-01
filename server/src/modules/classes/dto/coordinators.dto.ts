import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * [83.2.2] D21 — `POST /coordinators`: one teacher, one or more classes, optionally one subject.
 * No `subjectId` = class coordinator (every subject); with it = subject coordinator (D13: a
 * whole-school subject coordinator is one row per class, chosen in one call).
 */
export class AssignCoordinatorsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teacherId: string;

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  classIds: string[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  subjectId?: string;
}

/**
 * `GET /coordinators?teacherId=|classId=`. No paging on purpose: the list is bounded by one
 * school's classes × teachers (a few hundred rows at most), and every screen shows it whole.
 */
export class ListCoordinatorsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
}

/** One coordinator row as the admin screens show it (D30: who assigned it, and when). */
export class CoordinatorAssignmentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) teacher_id: string;
  @ApiProperty() teacher_name: string;
  @ApiProperty({ format: 'uuid' }) class_id: string;
  @ApiProperty() class_name: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) subject_id: string | null;
  @ApiProperty({ type: String, nullable: true }) subject_name: string | null;
  @ApiProperty({ type: String, nullable: true }) assigned_by_name: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) created_at: string;
}

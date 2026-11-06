import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

/** Request body for `POST /staff-hr-records`. 23.2.1. */
export class CreateStaffHrRecordDto {
  @IsUUID()
  user_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  index_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  salary_code?: string;

  @IsOptional()
  @IsDateString()
  mpo_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  salary_scale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  blood_group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name_bn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  religion?: string;
}

/** Request body for `PATCH /staff-hr-records/:id`. Every field is
 * `| null` (23.7): a client must be able to clear a previously-set value,
 * not just omit an unchanged one — omitting a field here leaves its
 * current server value in place. */
export class UpdateStaffHrRecordDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  index_no?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  salary_code?: string | null;

  @IsOptional()
  @IsDateString()
  mpo_date?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  salary_scale?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  blood_group?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @SanitizeText()
  name_bn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  religion?: string | null;

  /** [76.2.06] Attendance card number on the linked staff profile; `null` clears it. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'card_no may only have letters, digits and dashes' })
  card_no?: string | null;
}

/** Request body for `POST /staff-hr-records/:userId/promote`. 23.2.1. */
export class PromoteStaffDto {
  @IsUUID()
  designation_id: string;

  @IsDateString()
  effective_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

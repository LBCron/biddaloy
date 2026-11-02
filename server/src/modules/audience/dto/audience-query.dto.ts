import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AudienceTab, AudienceTarget, NoticeRecipientKind, UserRole } from '@biddaloy/shared';

/** `?x=a` arrives as a string, `?x=a&x=b` as an array. */
/** Query arrays arrive as `classIds=a,b` (the client joins them, as `student_ids` does) or as
 * repeated keys (`classIds=a&classIds=b`). A body sends a real array. */
const toArray = ({ value }: { value: unknown }) =>
  value === undefined || value === ''
    ? undefined
    : Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',').filter(Boolean)
        : [value];

export class AudienceQueryDto {
  @ApiProperty({ enum: AudienceTarget, enumName: 'AudienceTarget' })
  @IsEnum(AudienceTarget)
  target: AudienceTarget;

  @ApiProperty({ enum: AudienceTab, enumName: 'AudienceTab' })
  @IsEnum(AudienceTab)
  tab: AudienceTab;

  @ApiPropertyOptional({ enum: UserRole, enumName: 'UserRole', isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsEnum(UserRole, { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  roles?: UserRole[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @Transform(toArray)
  @IsUUID('all', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  classIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @Transform(toArray)
  @IsUUID('all', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  sectionIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', description: 'EXAM_FAILED: a published exam.' })
  @IsOptional()
  @IsUUID()
  examId?: string;

  @ApiPropertyOptional({ description: 'LOW_ATTENDANCE: current-year % below this.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  belowPercent?: number;

  @ApiPropertyOptional({
    description: "ORG_GROUP: a value from the tenant's organisation vocabulary.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  shift?: string;

  @ApiPropertyOptional({
    description: "ORG_GROUP: a value from the tenant's organisation vocabulary.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @ApiPropertyOptional({
    description: "ORG_GROUP: a value from the tenant's organisation vocabulary.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  group?: string;

  @ApiPropertyOptional({ description: 'Name search.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}

export class AudiencePersonDto {
  @ApiProperty({ enum: NoticeRecipientKind, enumName: 'NoticeRecipientKind' })
  kind: NoticeRecipientKind;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) userId: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) studentId: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) guardianId: string | null;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'class · section, or the role(s)' }) detail: string;
  @ApiProperty() hasLogin: boolean;
  @ApiProperty({ description: 'Never the number itself.' }) hasPhone: boolean;
}

export class AudiencePageDto {
  @ApiProperty({ type: [AudiencePersonDto] }) items: AudiencePersonDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

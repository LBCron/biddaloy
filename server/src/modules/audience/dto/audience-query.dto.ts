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
const toArray = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Array.isArray(value) ? value : [value];

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
  @IsUUID('4', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  classIds?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @Transform(toArray)
  @IsUUID('4', { each: true })
  @ArrayMaxSize(200)
  @ArrayUnique()
  sectionIds?: string[];

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

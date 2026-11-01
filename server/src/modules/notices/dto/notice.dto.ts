import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  NOTICE_LIMITS,
  NoticeRecipientKind,
  NoticeSmsStatus,
  NoticeStatus,
} from '@biddaloy/shared';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class CreateNoticeDto {
  @ApiProperty({ maxLength: NOTICE_LIMITS.titleMax })
  @SanitizeText()
  @IsString()
  @MinLength(1)
  @MaxLength(NOTICE_LIMITS.titleMax)
  title: string;

  @ApiProperty({ maxLength: NOTICE_LIMITS.bodyMax })
  @SanitizeText()
  @IsString()
  @MinLength(1)
  @MaxLength(NOTICE_LIMITS.bodyMax)
  body: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() important?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  expiresOn?: string | null;
}

export class UpdateNoticeDto extends PartialType(CreateNoticeDto) {}

export class NoticeListQueryDto {
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

  @ApiPropertyOptional({ enum: NoticeStatus, enumName: 'NoticeStatus' })
  @IsOptional()
  @IsEnum(NoticeStatus)
  status?: NoticeStatus;

  @ApiPropertyOptional({ description: 'Title search.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class RecipientPageQueryDto {
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

export enum NoticeReportStatus {
  SEEN = 'SEEN',
  UNSEEN = 'UNSEEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  UNREACHABLE = 'UNREACHABLE',
}

export class NoticeReportQueryDto extends RecipientPageQueryDto {
  @ApiPropertyOptional({ enum: NoticeReportStatus, enumName: 'NoticeReportStatus' })
  @IsOptional()
  @IsEnum(NoticeReportStatus)
  status?: NoticeReportStatus;
}

/** One person exactly as `GET /audience/people` returned it. The server re-checks every id against the tenant. */
export class RecipientRefDto {
  @ApiProperty({ enum: NoticeRecipientKind, enumName: 'NoticeRecipientKind' })
  @IsEnum(NoticeRecipientKind)
  kind: NoticeRecipientKind;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  userId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  studentId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  guardianId?: string | null;
}

export class AddRecipientsDto {
  @ApiProperty({ type: [RecipientRefDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RecipientRefDto)
  items: RecipientRefDto[];
}

export class RemoveRecipientsDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids: string[];
}

export class PublishNoticeDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Ask an admin to approve an SMS copy. Nothing is sent here.',
  })
  @IsOptional()
  @IsBoolean()
  requestSms?: boolean;
}

export class NoticeDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ description: 'Detail only.' }) body?: string;
  @ApiProperty({ enum: NoticeStatus, enumName: 'NoticeStatus' }) status: NoticeStatus;
  @ApiProperty() important: boolean;
  @ApiProperty() pinned: boolean;
  @ApiProperty() isPublic: boolean;
  @ApiProperty({ type: String, nullable: true }) expiresOn: string | null;
  @ApiProperty({ format: 'uuid' }) authorUserId: string;
  @ApiProperty({ type: String, nullable: true }) authorName: string | null;
  @ApiProperty({ type: String, nullable: true }) publishedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) editedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) withdrawnAt: string | null;
  @ApiProperty({ enum: NoticeSmsStatus, enumName: 'NoticeSmsStatus' }) smsStatus: NoticeSmsStatus;
  @ApiProperty({ description: 'People (a guardian with three children counts once).' })
  recipientCount: number;
  @ApiProperty() seenCount: number;
  @ApiProperty() createdAt: string;
  @ApiPropertyOptional({
    description:
      'PATCH only: returned once when that edit turned the public link on. Publish never returns it (its answer is cached for idempotency); use POST :id/public-link.',
  })
  publicLinkToken?: string | null;
}

export class NoticePageDto {
  @ApiProperty({ type: [NoticeDto] }) items: NoticeDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class NoticeRecipientDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: NoticeRecipientKind, enumName: 'NoticeRecipientKind' })
  kind: NoticeRecipientKind;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: 'The student a guardian hears about.' })
  forStudent: string | null;
  @ApiProperty() hasLogin: boolean;
  @ApiProperty({ type: String, nullable: true }) seenAt: string | null;
  @ApiProperty({ type: String, nullable: true }) linkOpenedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) acknowledgedAt: string | null;
  @ApiProperty({ description: 'No login and no phone: nothing can reach this person.' })
  unreachable: boolean;
}

export class NoticeRecipientPageDto {
  @ApiProperty({ type: [NoticeRecipientDto] }) items: NoticeRecipientDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class NoticeReportTotalsDto {
  @ApiProperty() people: number;
  @ApiProperty() seen: number;
  @ApiProperty() linkOpened: number;
  @ApiProperty() acknowledged: number;
  @ApiProperty() unreachable: number;
}

export class NoticeReportDto extends NoticeRecipientPageDto {
  @ApiProperty({ type: NoticeReportTotalsDto }) totals: NoticeReportTotalsDto;
}

export class AddRecipientsResultDto {
  @ApiProperty({ description: 'Rows actually added (duplicates and unknown people are skipped).' })
  added: number;
  @ApiProperty() total: number;
}

export class PublicLinkDto {
  @ApiProperty({ description: 'Shown once. Only its hash is stored.' }) token: string;
}

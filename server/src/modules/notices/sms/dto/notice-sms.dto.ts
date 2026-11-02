import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { NoticeSmsStatus } from '@biddaloy/shared';

export class NoticeSmsQueryDto {
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

export class SmsRecipientsDto {
  @ApiProperty({ type: [String], description: 'notice_recipients ids (guardian rows)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];

  @ApiProperty()
  @IsBoolean()
  smsWanted: boolean;
}

export class SmsRecipientRowDto {
  @ApiProperty() id: string;
  @ApiProperty() guardianName: string;
  @ApiProperty({ nullable: true, type: String }) forStudent: string | null;
  @ApiProperty() reachable: boolean;
  @ApiProperty() smsWanted: boolean;
  @ApiProperty({ nullable: true, type: String, description: 'Masked, e.g. 01•••••234' })
  phone: string | null;
}

export class SmsCountsDto {
  @ApiProperty() willSend: number;
  @ApiProperty() optedOut: number;
  @ApiProperty() noPhone: number;
}

export class SmsTextDto {
  @ApiProperty({ description: 'Title plus link placeholder' }) text: string;
  @ApiProperty() length: number;
  @ApiProperty() segments: number;
  @ApiProperty({ enum: ['GSM_7', 'UCS_2'] }) encoding: string;
  @ApiProperty({ description: 'Whole credits: segments x people who will get it' })
  creditCost: number;
}

export class NoticeSmsViewDto {
  @ApiProperty({ enum: NoticeSmsStatus }) status: NoticeSmsStatus;
  @ApiProperty({ nullable: true, type: String }) requester: string | null;
  @ApiProperty({ nullable: true, type: String }) requestedAt: string | null;
  @ApiProperty({ description: 'Notice is published, not withdrawn and not past its end date' })
  live: boolean;
  @ApiProperty({ type: [SmsRecipientRowDto] }) items: SmsRecipientRowDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty({ type: SmsCountsDto }) counts: SmsCountsDto;
  @ApiProperty({ type: SmsTextDto }) sms: SmsTextDto;
}

export class SmsDecisionDto {
  @ApiProperty({ enum: NoticeSmsStatus }) status: NoticeSmsStatus;
  @ApiProperty({ description: 'SMS queued (0 on decline)' }) queued: number;
}

export class SmsRecipientsResultDto {
  @ApiProperty() updated: number;
}

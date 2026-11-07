import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { BD_PHONE_REGEX } from '../../students/dto/students.dto';

/** The public contact form. The tenant is never in the body: the host in the URL decides it. */
export class CreateEnquiryDto {
  @ApiProperty({ maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @SanitizeText()
  name: string;

  @ApiProperty({ example: '01712345678' })
  @IsString()
  @MaxLength(20)
  @Matches(BD_PHONE_REGEX)
  phone: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @SanitizeText()
  message: string;

  @ApiProperty({ description: 'Cloudflare Turnstile token.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  captcha_token: string;
}

export class EnquiryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() phone: string;
  @ApiProperty() message: string;
  @ApiProperty({ nullable: true }) seen_at: string | null;
  @ApiProperty() created_at: string;
}

export class EnquiryListQueryDto {
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

export class EnquiryListDto {
  @ApiProperty({ type: [EnquiryDto] }) items: EnquiryDto[];
  @ApiProperty() total: number;
  @ApiProperty() unseen: number;
}

export class EnquiryReceivedDto {
  @ApiProperty() received: true;
}

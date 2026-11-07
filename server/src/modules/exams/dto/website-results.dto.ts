import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** `PATCH exams/:examId/website-names`. */
export class WebsiteNamesDto {
  @ApiProperty({ description: 'Show student names on the public results table.' })
  @IsBoolean()
  showNames: boolean;
}

/** Answer of the three admin routes. */
export class WebsiteResultsStateDto {
  @ApiProperty({ description: 'Whether the exam is on the school website after the call.' })
  websitePublished: boolean;
}

/** Public `POST island/results`: one section's table, or one roll of it. */
export class ResultsQueryDto {
  @ApiProperty({ description: 'Cloudflare Turnstile token.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  captcha_token: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  exam_id: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  class_section_id: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 999999 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999_999)
  roll?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;
}

/** Public `POST island/results/detail`: the per-subject marks of one row of a `query` answer. */
export class ResultsDetailQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  exam_id: string;

  @ApiProperty({ format: 'uuid', description: 'The `id` of a row the table answer returned.' })
  @IsUUID()
  result_id: string;
}

export class WebsiteResultRowDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() roll: number;
  @ApiProperty({ nullable: true, type: String }) name: string | null;
  @ApiProperty() gpa: number;
  @ApiProperty() grade: string;
  @ApiProperty() passed: boolean;
}

export class WebsiteResultsPageDto {
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() total: number;
  @ApiProperty() showNames: boolean;
  @ApiProperty({ type: [WebsiteResultRowDto] }) rows: WebsiteResultRowDto[];
}

export class WebsiteResultSubjectDto {
  @ApiProperty({ example: { en: 'Mathematics', bn: 'গণিত' } })
  name: { en: string; bn: string | null };
  @ApiProperty() obtained: number;
  @ApiProperty() grade: string;
  @ApiProperty() gpa: number;
  @ApiProperty() passed: boolean;
}

export class WebsiteResultDetailDto {
  @ApiProperty({ type: [WebsiteResultSubjectDto] }) subjects: WebsiteResultSubjectDto[];
}

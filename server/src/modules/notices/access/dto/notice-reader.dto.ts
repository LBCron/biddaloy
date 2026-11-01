import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class NoticeMineQueryDto {
  @ApiPropertyOptional({ enum: ['current', 'archive'], default: 'current' })
  @IsOptional()
  @IsIn(['current', 'archive'])
  tab?: 'current' | 'archive';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Publish year, e.g. 2026' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class NoticeFileDto {
  @ApiProperty() id: string;
  @ApiProperty() original_name: string;
  @ApiProperty() mime_type: string;
  @ApiProperty() size_bytes: number;
}

export class NoticeMineItemDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() important: boolean;
  @ApiProperty() pinned: boolean;
  @ApiProperty({ nullable: true, type: String }) published_at: string | null;
  @ApiProperty({ nullable: true, type: String }) expires_on: string | null;
  @ApiProperty() edited: boolean;
  @ApiProperty() seen: boolean;
  @ApiProperty() acknowledged: boolean;
  @ApiProperty({ type: [String] }) forStudents: string[];
}

export class NoticeMineListDto {
  @ApiProperty({ type: [NoticeMineItemDto] }) data: NoticeMineItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class NoticeMineDetailDto extends NoticeMineItemDto {
  @ApiProperty() body: string;
  @ApiProperty({ type: [NoticeFileDto] }) files: NoticeFileDto[];
}

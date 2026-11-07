import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Title and body are checked in the service so every failure is the one fixed sentence
 * `site.post_invalid` (Rule 23); here only the shape class-validator can say cheaply.
 */
export class SavePostDto {
  @ApiPropertyOptional({
    enum: ['POST', 'PAGE'],
    description: 'Fixed at create; ignored on update.',
  })
  @IsOptional()
  @IsIn(['POST', 'PAGE'])
  kind?: 'POST' | 'PAGE';

  @ApiProperty({ description: '{ bn, en }, each up to 200 chars; one of them may be empty.' })
  @IsObject()
  title: Record<string, string>;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  cover_media_id?: string | null;

  @ApiProperty({ description: 'Slate JSON: an array of nodes.', type: 'array', items: {} })
  @IsArray()
  @ArrayMaxSize(1000)
  body: unknown[];
}

export class PostDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['POST', 'PAGE'] }) kind: 'POST' | 'PAGE';
  @ApiProperty() slug: string;
  @ApiProperty() title: Record<string, string>;
  @ApiProperty({ nullable: true }) cover_media_id: string | null;
  @ApiProperty({ type: 'array', items: {} }) body: unknown;
  @ApiProperty({ nullable: true }) published_at: string | null;
  @ApiProperty() updated_at: string;
}

export class PostListQueryDto {
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

export class PostListDto {
  @ApiProperty({ type: [PostDto] }) items: PostDto[];
  @ApiProperty() total: number;
}

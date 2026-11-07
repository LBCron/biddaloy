import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Bio and credentials are `{ bn, en }`, checked in the service (fixed sentence, Rule 23). */
export class SaveStaffWebProfileDto {
  @ApiProperty() @IsBoolean() show_on_website: boolean;
  @ApiProperty() @IsBoolean() featured: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sort_order?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  subjects?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsObject()
  bio?: Record<string, string> | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string> | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'A `person` picture of this school.',
  })
  @IsOptional()
  @IsUUID()
  photo_media_id?: string | null;
}

export class StaffWebProfileDto {
  @ApiProperty() user_id: string;
  @ApiProperty() full_name: string;
  @ApiProperty() role: string;
  @ApiProperty() show_on_website: boolean;
  @ApiProperty() featured: boolean;
  @ApiProperty() sort_order: number;
  @ApiProperty({ type: [String] }) subjects: string[];
  @ApiProperty({ nullable: true }) bio: Record<string, string> | null;
  @ApiProperty({ nullable: true }) credentials: Record<string, string> | null;
  @ApiProperty({ nullable: true }) photo_media_id: string | null;
}

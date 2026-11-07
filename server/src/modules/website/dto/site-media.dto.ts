import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Multipart text fields. `slot` is checked in the service so a bad slot gets the same fixed sentence. */
export class UploadSiteMediaDto {
  @ApiProperty({ description: 'hero | about | post-cover | post-image | person' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  slot?: string;
}

export class SiteMediaDto {
  @ApiProperty() id: string;
  @ApiProperty() slot: string;
  @ApiProperty() width: number;
  @ApiProperty() height: number;
  @ApiProperty() bytes: number;
  @ApiProperty() created_at: string;
}

export class SiteMediaListDto {
  @ApiProperty({ type: [SiteMediaDto] }) items: SiteMediaDto[];
  @ApiProperty() usedBytes: number;
  @ApiProperty() quotaBytes: number;
}

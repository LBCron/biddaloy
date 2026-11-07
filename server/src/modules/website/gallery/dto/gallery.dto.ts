import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Titles and captions are checked in the service so every failure is the one fixed sentence
 * `site.gallery_invalid` (Rule 23); here only the shape class-validator can say cheaply.
 */
export class SaveAlbumDto {
  @ApiProperty({ description: '{ bn, en }, each up to 200 chars; one of them may be empty.' })
  @IsObject()
  title: Record<string, string>;
}

/** Multipart field next to `file`: a JSON string `{"bn":"..","en":".."}`, each up to 120 chars. */
export class UploadGalleryPhotoDto {
  @ApiPropertyOptional({ description: 'JSON text of { bn, en }, each up to 120 chars.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;
}

export class UpdateGalleryPhotoDto {
  @ApiProperty({
    nullable: true,
    description: '{ bn, en }, each up to 120 chars, or null to clear the caption.',
  })
  @ValidateIf((o: UpdateGalleryPhotoDto) => o.caption !== null)
  @IsObject()
  caption: Record<string, string> | null;
}

/** The complete list of ids in the new order; the service checks it is exactly the current set. */
export class ReorderGalleryDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMaxSize(60)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];
}

export class GalleryPhotoDto {
  @ApiProperty() id: string;
  @ApiProperty({ format: 'uuid' }) mediaId: string;
  @ApiProperty({ nullable: true, description: '{ bn, en } or null' }) caption: {
    bn: string;
    en: string;
  } | null;
  @ApiProperty() sortOrder: number;
}

export class GalleryAlbumDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: '{ bn, en }' }) title: { bn: string; en: string };
  @ApiProperty() sortOrder: number;
  @ApiProperty({ type: [GalleryPhotoDto] }) photos: GalleryPhotoDto[];
}

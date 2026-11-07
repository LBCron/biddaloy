import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsObject, Max, Min } from 'class-validator';

/** Largest version / draft revision a site can reach; keeps the number inside a Postgres int. */
const VERSION_MAX = 2_000_000_000;

export class SaveDraftDto {
  @ApiProperty({ description: 'The whole site config. Checked against the theme it names.' })
  @IsObject()
  config: Record<string, unknown>;

  @ApiProperty({
    description:
      'The draft_revision this edit started from (409 site.stale if someone saved since).',
  })
  @IsInt()
  @Min(0)
  @Max(VERSION_MAX)
  draft_revision: number;
}

export class PublishDto {
  @ApiProperty({ description: 'The version this publish started from (409 site.stale if behind).' })
  @IsInt()
  @Min(0)
  @Max(VERSION_MAX)
  version: number;

  @ApiProperty({
    description: 'The draft_revision the publisher is looking at (409 site.stale if it changed).',
  })
  @IsInt()
  @Min(0)
  @Max(VERSION_MAX)
  draft_revision: number;
}

export class SetEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class SiteDto {
  @ApiProperty() theme: string;
  @ApiProperty() palette: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty() noindex: boolean;
  @ApiProperty() subdomain: string;
  @ApiPropertyOptional({ nullable: true }) custom_domain: string | null;
  @ApiPropertyOptional({ nullable: true }) custom_domain_status: string | null;
  @ApiProperty() version: number;
  @ApiProperty() draft_revision: number;
  @ApiPropertyOptional({ nullable: true }) published_at: string | null;
  @ApiProperty() has_published: boolean;
  @ApiProperty({ description: 'True when nothing is published yet or the draft differs from it.' })
  has_unpublished_changes: boolean;
  @ApiProperty({ type: Object }) draft: Record<string, unknown>;
}

export class ThemeSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: Object }) name: Record<string, unknown>;
  @ApiProperty({ type: [Object] }) palettes: Record<string, unknown>[];
  @ApiProperty({ type: Object }) fonts: Record<string, unknown>;
  @ApiProperty({ type: Object }) defaultTypography: Record<string, unknown>;
  @ApiProperty({ type: [Object] }) sections: Record<string, unknown>[];
  @ApiProperty({ type: [Object] }) pages: Record<string, unknown>[];
}

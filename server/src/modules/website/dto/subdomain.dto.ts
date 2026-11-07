import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class SetSubdomainDto {
  @ApiProperty({
    description: '3-30 chars of a-z, 0-9, inner hyphens. 400 site.subdomain_unavailable.',
  })
  @IsString()
  @MaxLength(100)
  value: string;
}

export class SubdomainCheckDto {
  @ApiProperty() available: boolean;
}

export class SubdomainSuggestDto {
  @ApiProperty({ type: [String] }) suggestions: string[];
}

export class PreviewTokenDto {
  @ApiProperty({ description: '`https://<subdomain>.<root>/?preview=<token>`, valid 1 hour.' })
  url: string;
}

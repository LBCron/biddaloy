import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class SetCustomDomainDto {
  @ApiProperty({
    description:
      '`www.example.edu` or an apex. 409 site.custom_domain_unavailable for any refusal.',
  })
  @IsString()
  @MaxLength(300)
  host: string;
}

export class DnsRecordDto {
  @ApiProperty({ enum: ['CNAME', 'TXT'] }) type: 'CNAME' | 'TXT';
  @ApiProperty() name: string;
  @ApiProperty() value: string;
}

export class CustomDomainStatusDto {
  @ApiProperty({ nullable: true, type: String }) host: string | null;
  @ApiProperty({ nullable: true, enum: ['PENDING_DNS', 'PENDING_SSL', 'ACTIVE', 'FAILED'] })
  status: string | null;
  @ApiProperty({ type: [DnsRecordDto] }) records: DnsRecordDto[];
  @ApiProperty({ nullable: true, type: String }) lastCheckedAt: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Hint key resolved by the client: `apex_needs_flattening`.',
  })
  hintKey: string | null;
}

export class AnalyticsDto {
  @ApiProperty() available: boolean;
  @ApiPropertyOptional() pageviews?: number;
  @ApiPropertyOptional() visitors?: number;
  @ApiPropertyOptional({ description: 'Window start, ISO date-time (30 days back).' })
  from?: string;
  @ApiPropertyOptional() to?: string;
}

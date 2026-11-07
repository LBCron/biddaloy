import { ApiProperty } from '@nestjs/swagger';
import type { OnboardingItemId, OnboardingSetupPath, OnboardingStatus } from '@biddaloy/shared';

/**
 * Swagger metadata for `OnboardingStatus` — see `auth/dto/auth-response.dto.ts` for why these
 * exist. `implements` keeps it in step with the shared type.
 */
const ITEM_IDS: OnboardingItemId[] = [
  'profile',
  'structure',
  'sections',
  'students',
  'staff',
  'feeStructures',
  'guardianInvites',
  'messageSettings',
  'website',
];
const SETUP_PATHS: OnboardingSetupPath[] = ['guided', 'excel', 'later'];

class OnboardingItemDto {
  @ApiProperty({ enum: ITEM_IDS })
  id: OnboardingItemId;

  @ApiProperty()
  done: boolean;
}

class OnboardingCountsDto {
  @ApiProperty() classes: number;
  @ApiProperty() sections: number;
  @ApiProperty() students: number;
  @ApiProperty() staff: number;
}

class OnboardingSeatsDto {
  @ApiProperty({ description: 'ACTIVE students.' })
  used: number;

  @ApiProperty({ type: Number, nullable: true, description: 'NULL = unlimited.' })
  limit: number | null;
}

class OnboardingTrialDto {
  @ApiProperty({ format: 'date-time' })
  ends_at: string;

  @ApiProperty()
  days_left: number;

  @ApiProperty({ type: OnboardingSeatsDto })
  seats: OnboardingSeatsDto;
}

export class OnboardingStatusDto implements OnboardingStatus {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finished_at: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  dismissed_at: string | null;

  @ApiProperty()
  seen: boolean;

  @ApiProperty({ enum: SETUP_PATHS, nullable: true })
  setup_path: OnboardingSetupPath | null;

  @ApiProperty({ type: [OnboardingItemDto] })
  items: OnboardingItemDto[];

  @ApiProperty({ type: OnboardingCountsDto })
  counts: OnboardingCountsDto;

  @ApiProperty({ type: OnboardingTrialDto, nullable: true, description: 'NULL = not in trial.' })
  trial: OnboardingTrialDto | null;

  @ApiProperty({ type: String, nullable: true })
  support_url: string | null;
}

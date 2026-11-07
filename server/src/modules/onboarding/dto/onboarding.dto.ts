import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import type { OnboardingSetupPath } from '@biddaloy/shared';

/** `PATCH /onboarding` — writes only `schools.onboarding`. */
export class UpdateOnboardingDto {
  @IsOptional()
  @IsIn(['guided', 'excel', 'later'])
  setup_path?: OnboardingSetupPath;

  /** The school's answer to "do you want a public website?" at setup. Adds the `website` checklist item. */
  @IsOptional()
  @IsBoolean()
  wants_website?: boolean;

  /** `true` stamps `finished_at`; `false` clears it. */
  @IsOptional()
  @IsBoolean()
  finished?: boolean;

  /** `true` stamps `dismissed_at`; `false` clears it. */
  @IsOptional()
  @IsBoolean()
  dismissed?: boolean;

  /** `true` adds the caller to `seen_by`; `false` removes them. */
  @IsOptional()
  @IsBoolean()
  seen?: boolean;
}

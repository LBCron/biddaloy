import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  TESTABLE_MEDIA,
  TestableCommunicationMedium,
} from '../providers/shared/connection-test.types';

/**
 * Body for `POST /schools/:id/settings/test` (#8.7.12). `config` is
 * intentionally loose (`Record<string, unknown>`, not one of the 4
 * medium-specific settings DTOs) — it's never persisted, only passed
 * straight through to `MessagingConfigResolver`'s `override` option,
 * which reads only the descriptor fields it recognizes and ignores the
 * rest. A stricter per-medium shape would need a
 * discriminated union keyed on `medium`, which class-validator doesn't
 * support cleanly; the fields that matter are still type-checked at the
 * resolver, just one layer in rather than at the HTTP boundary.
 */
export class TestConnectionDto {
  @IsIn(TESTABLE_MEDIA)
  medium: TestableCommunicationMedium;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  /**
   * Also send one real message to this phone (SMS) or address (EMAIL) once the connection test
   * passes. Format is checked per medium in `ConnectionTestService`; needs an `Idempotency-Key`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sendTo?: string;
}

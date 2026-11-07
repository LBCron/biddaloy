import { ApiError } from '@biddaloy/ui/api';

const KNOWN_WRITE_REASONS = new Set(['CLASS_TEACHER_ONLY', 'FIRST_PERIOD_ONLY', 'DEVICE_SCHOOL']);

/** i18n key of the note that says why this register cannot be saved. */
export const writeReasonKey = (reason: string | null | undefined): string =>
  `registerBanner.${KNOWN_WRITE_REASONS.has(reason ?? '') ? reason : 'UNKNOWN'}`;

/** A save the school's attendance setting refused says why; anything else stays generic. */
export function saveErrorKey(error: unknown): string {
  const reason =
    error instanceof ApiError && error.statusCode === 403
      ? (error.details as { reason?: string } | undefined)?.reason
      : undefined;
  return reason ? writeReasonKey(reason) : 'mark.errorToast';
}

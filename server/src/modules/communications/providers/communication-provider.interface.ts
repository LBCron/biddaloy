import { CommunicationMedium } from '@biddaloy/shared';

export interface CommunicationSendParams {
  to: string;
  body: string;
  /** Email only. */
  subject?: string;
  /** WhatsApp only — sending a pre-approved template instead of freeform text. */
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
  /** SMS, account-access only; lets a school with no gateway still deliver sign-in codes on the platform account (counted by #1759). */
  allowPlatformSms?: boolean;
}

export interface CommunicationSendResult {
  success: boolean;
  providerMessageId: string | null;
  error?: string;
  raw?: Record<string, any>;
  /**
   * Set to `false` when the failure cannot be fixed by retrying — a
   * missing/incomplete tenant configuration (`ProviderNotConfiguredError`),
   * not a network blip. `CommunicationsProcessor` settles the log FAILED
   * immediately instead of spending the queue's retry budget on a failure
   * that will be identical on every attempt. Left `undefined` for any
   * other failure, which stays retryable exactly as before.
   */
  retryable?: boolean;
  /**
   * [15.6.1] SMS-only — the exact segment count from the shared
   * `countSmsSegments`, so `CommunicationsProcessor` can write it onto
   * `CommunicationLog.metadata.segments` for billing/observability.
   * `undefined` for every non-SMS provider.
   */
  segments?: number;
  /**
   * [97.4.01] D23: the descriptor name of the provider that handled the send (set by
   * `sendThroughProvider`), so the log records which company to ask for delivery status.
   * Absent when no provider was reached (config error) or in sink mode.
   */
  provider?: string;
  /**
   * #3350: whose account sent it (`platform` = the platform's env keys), so Check status asks that
   * same account. Set next to `provider`.
   */
  source?: 'override' | 'tenant' | 'platform';
  /**
   * [15.6.6/#549] Epic #508 D6's three provider outcomes, set on every
   * result (success or failure) so `CommunicationsProcessor` can settle
   * SMS credit reservations without re-deriving it from `success`/`error`.
   *
   * - `ACCEPTED` — the provider took the message (`success: true`).
   * - `REJECTED` — the provider (or a pre-flight check like
   *   `ProviderNotConfiguredError`/a blocked destination) definitively
   *   refused it before/without sending — a 4xx-shaped or validation
   *   failure. Retrying won't change the outcome.
   * - `AMBIGUOUS` — the request may or may not have reached the provider:
   *   a network timeout, connection reset, or 5xx/unknown error *after*
   *   the request went out. Whether the SMS was actually sent is unknown,
   *   so the credit reservation stays untouched pending reconciliation.
   *
   * Derived from the same branch that already sets `retryable` — a
   * provider whose `retryable` is `false` because it never reached the
   * network is `REJECTED`; a provider whose `retryable` is left
   * `undefined`/`true` because it doesn't know if the request landed is
   * `AMBIGUOUS`.
   */
  outcome: 'ACCEPTED' | 'REJECTED' | 'AMBIGUOUS';
}

/**
 * Uniform contract every channel provider implements, so
 * CommunicationsProcessor can dispatch by CommunicationMedium without
 * knowing which concrete gateway/API is behind it. A provider must never
 * throw — network/API failures (and, since #8.7.10, a
 * `ProviderNotConfiguredError` from `MessagingConfigResolver`) are
 * caught internally and returned as `{ success: false, error }` so the
 * processor always gets a result to persist onto the CommunicationLog row.
 *
 * `tenantId` (#8.7.10) is what each provider resolves its own config
 * against — `MessagingConfigResolver`, not `ConfigService` directly
 * — so two tenants using different accounts for the same medium never
 * share state. Callers always have it: `CommunicationsProcessor` loads
 * the `CommunicationLog` row before dispatching and reads `tenant_id`
 * off it, the same column every other tenant-scoped query in this
 * codebase filters on.
 */
export interface CommunicationProvider {
  /** `tenantId` null = platform sender (account-access for a shared user, D28). */
  send(params: CommunicationSendParams, tenantId: string | null): Promise<CommunicationSendResult>;
}

export const COMMUNICATION_PROVIDER_REGISTRY = 'COMMUNICATION_PROVIDER_REGISTRY';

// Partial: not every CommunicationMedium (e.g. PHONE_CALL) has an
// automated provider — CommunicationsProcessor treats a missing entry as
// an unsupported medium and fails the job rather than assuming coverage.
export type CommunicationProviderRegistry = Partial<
  Record<CommunicationMedium, CommunicationProvider>
>;

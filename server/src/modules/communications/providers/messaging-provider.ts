import { NotImplementedException } from '@nestjs/common';
import type { ProviderDescriptor } from '@biddaloy/shared';
import {
  CommunicationSendParams,
  CommunicationSendResult,
} from './communication-provider.interface';
import { ConnectionTestResult } from './shared/connection-test.types';
import {
  DestinationBlockedError,
  OutboundDestinationError,
} from './shared/outbound-destination-guard';
import { normalizeBdPhoneNumber } from './shared/phone-number.util';

/** A provider answered and refused the credentials (bad key), as opposed to not being reachable. */
export class ProviderAuthRejectedError extends Error {
  constructor() {
    super('The provider rejected the credentials.');
    this.name = 'ProviderAuthRejectedError';
  }
}

/** D24: one base class for every vendor. No constructor, no injected deps: config-check builds them bare to read `envPrefix` and the descriptor. */
export abstract class MessagingProvider<TConfig = Record<string, string>> {
  abstract readonly descriptor: ProviderDescriptor;
  abstract readonly envPrefix: string;
  abstract send(params: CommunicationSendParams, config: TConfig): Promise<CommunicationSendResult>;
  // Optional METHOD signatures, never properties: with ES2022 define semantics a base-class
  // property would be emitted as an own `undefined` field and shadow a subclass's prototype method.
  /** Capability `status`. */
  getStatus?(
    providerMessageId: string,
    config: TConfig,
  ): Promise<{ status: 'DELIVERED' | 'FAILED' | 'PENDING'; code?: string }>;
  /** Capability `balance`. */
  getBalance?(config: TConfig): Promise<{ amount: number; estimateSms?: number }>;

  /** Default: a balance check. A provider without the `balance` capability must override this. */
  async testConnection(config: TConfig): Promise<ConnectionTestResult> {
    if (!this.descriptor.capabilities.includes('balance') || !this.getBalance) {
      throw new NotImplementedException(
        `${this.descriptor.name}: override testConnection or declare the balance capability`,
      );
    }
    try {
      await this.getBalance(config);
      // No amount: with no school block the config may be the platform's own account (Rule 23).
      return { success: true, message: `Connected to ${this.descriptor.label.en}.` };
    } catch (err) {
      if (err instanceof OutboundDestinationError) {
        return { success: false, message: err.publicMessage };
      }
      if (err instanceof ProviderAuthRejectedError) {
        return {
          success: false,
          message: `${this.descriptor.label.en} rejected the API key — check it and try again.`,
        };
      }
      return { success: false, message: `Could not reach ${this.descriptor.label.en}.` };
    }
  }

  /**
   * #3320: a send's HTTP status decides before its body. `undefined` for a 2xx (read the body).
   * 401/403 = the key was refused, 4xx = the message was refused: REJECTED, the credit is released.
   * 5xx and 408 = the vendor may have sent before failing (a 408 is a timeout on its side, after it
   * got the request): AMBIGUOUS, the credit stays held, and never retried (a retry could send the
   * SMS twice and pay the vendor twice). Reconciliation decides (review round 2 on #3347).
   * 429 stays REJECTED and permanent: the vendor turned the request away, and no vendor here
   * documents that a retry is safe.
   * `error` texts are fixed sentences (Rule 23); the vendor's body only goes in `raw`.
   *
   * Decision (review round 2 on #3347): an answer we cannot trust is never retried. That covers a
   * 5xx and a 2xx we cannot use (an unknown shape, or a body that is not JSON): the vendor may
   * have sent it. The cost is accepted on purpose: in a vendor-wide outage every row of a bulk
   * send ends FAILED with its credit held (`credit: 'UNSETTLED'`) until ops settle it by hand.
   * Automatic settling through the vendor's status API is follow-up #3353. The one retried
   * failure left is a thrown network error or timeout (`retryAfterThrow`).
   */
  protected failureForHttpStatus(
    status: number,
    text: { auth: string; rejected: string; ambiguous: string },
    segments: number,
    raw: unknown,
  ): CommunicationSendResult | undefined {
    if (status < 400) return undefined;
    const base = {
      success: false,
      providerMessageId: null,
      raw: raw as CommunicationSendResult['raw'],
      segments,
    };
    if (status >= 500 || status === 408) {
      return { ...base, error: text.ambiguous, retryable: false, outcome: 'AMBIGUOUS' };
    }
    const auth = status === 401 || status === 403;
    return {
      ...base,
      error: auth ? text.auth : text.rejected,
      retryable: false,
      outcome: 'REJECTED',
    };
  }

  /**
   * `retryable` for a send that threw. A blocked destination is permanent. A `SyntaxError` is a
   * 2xx whose body is not JSON (`fetchPinnedJsonWithStatus` swallows it on a non-2xx): the vendor
   * answered and may have sent, so it is not retried either (see `failureForHttpStatus`). A network
   * error or timeout is left to BullMQ's retry, as before.
   */
  protected retryAfterThrow(err: unknown): false | undefined {
    return err instanceof DestinationBlockedError || err instanceof SyntaxError ? false : undefined;
  }

  protected normalizeBdPhone(to: string): string {
    return normalizeBdPhoneNumber(to);
  }
}

import { Injectable } from '@nestjs/common';
import { CommunicationMedium, countSmsSegments, type ProviderDescriptor } from '@biddaloy/shared';
import {
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { MessagingProvider } from '../messaging-provider';
import { normalizeBdPhoneNumber } from '../shared/phone-number.util';
import { ConnectionTestResult } from '../shared/connection-test.types';
import {
  assertSafeHttpDestination,
  DestinationBlockedError,
  OutboundDestinationError,
} from '../shared/outbound-destination-guard';
import { fetchPinnedJsonWithStatus } from '../shared/pinned-http';
export interface ResolvedGreenwebSmsConfig {
  apiKey: string;
  apiUrl?: string;
  /** Ignored; callers written before the generic resolver still pass it. */
  gateway?: string;
}

const DEFAULT_BASE_URL = 'https://api.greenweb.com.bd/api.php';
const REQUEST_TIMEOUT_MS = 10_000;
const UNREACHABLE_ERROR = 'Could not reach Greenweb; the message may or may not have been sent.';
// Rule 23: fixed sentences for a status-decided failure (#3320).
const SEND_TEXT = {
  auth: 'Greenweb rejected the API key.',
  rejected: 'Greenweb rejected the message.',
  ambiguous: UNREACHABLE_ERROR,
};

/**
 * Greenweb BD SMS gateway. GET-based REST API, keyed by an account token.
 * `config` is resolved per tenant by `MessagingConfigResolver` and
 * passed in by the registry — this gateway no longer reads
 * `ConfigService` itself (#8.7.10).
 */
@Injectable()
export class GreenwebProvider extends MessagingProvider<ResolvedGreenwebSmsConfig> {
  readonly descriptor: ProviderDescriptor = {
    medium: CommunicationMedium.SMS,
    name: 'greenweb',
    label: { en: 'Greenweb', bn: 'গ্রিনওয়েব' },
    capabilities: [],
    fields: [
      { key: 'apiKey', label: { en: 'API key', bn: 'এপিআই কী' }, kind: 'secret', required: true },
      {
        key: 'apiUrl',
        label: { en: 'API address (optional)', bn: 'এপিআই ঠিকানা (ঐচ্ছিক)' },
        kind: 'url',
        required: false,
        advanced: true,
      },
    ],
    supportsTestMessage: true,
  };
  readonly envPrefix = 'GREENWEB';

  async send(
    params: CommunicationSendParams,
    config: ResolvedGreenwebSmsConfig,
  ): Promise<CommunicationSendResult> {
    const { to, body: message } = params;
    const segmentInfo = countSmsSegments(message);
    try {
      const baseUrl = config.apiUrl ?? DEFAULT_BASE_URL;
      const destination = await assertSafeHttpDestination(baseUrl);
      const query = new URLSearchParams({
        token: config.apiKey,
        to: normalizeBdPhoneNumber(to),
        message,
      });
      if (segmentInfo.encoding === 'UCS_2') {
        query.set('unicode', '1');
      }

      const { status, body } = await fetchPinnedJsonWithStatus(
        destination,
        `${baseUrl}?${query.toString()}`,
        { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      const failed = this.failureForHttpStatus(status, SEND_TEXT, segmentInfo.segments, body);
      if (failed) return failed;
      const data = body as Record<string, any>;

      if (data?.status === 'success') {
        return {
          success: true,
          providerMessageId: data.msgid ?? null,
          raw: data,
          segments: segmentInfo.segments,
          outcome: 'ACCEPTED',
        };
      }
      // Greenweb answered — it just refused the message (bad token,
      // invalid number, etc.). A definite REJECTED, same as `retryable`
      // would say if this branch set it.
      return {
        success: false,
        providerMessageId: null,
        // Rule 23: a fixed sentence; the vendor's text (it can repeat the token) stays in `raw`.
        error: SEND_TEXT.rejected,
        raw: data,
        segments: segmentInfo.segments,
        retryable: false,
        outcome: 'REJECTED',
      };
    } catch (err) {
      return {
        success: false,
        providerMessageId: null,
        // Rule 23: fixed text only. The guard's message carries the address and a fetch error the
        // request URL (Greenweb's carries the token).
        error: err instanceof OutboundDestinationError ? err.publicMessage : UNREACHABLE_ERROR,
        segments: segmentInfo.segments,
        // A blocked destination is permanent and REJECTED. A DNS hiccup or network blip may
        // succeed on retry, and might have reached Greenweb anyway, so it's AMBIGUOUS. A 2xx body
        // that is not JSON is AMBIGUOUS too, but never retried (`retryAfterThrow`).
        retryable: this.retryAfterThrow(err),
        outcome: err instanceof DestinationBlockedError ? 'REJECTED' : 'AMBIGUOUS',
      };
    }
  }

  /**
   * #8.7.12's connection test — a balance check, Greenweb's cheapest
   * token-verification call, instead of sending a real SMS.
   */
  async testConnection(config: ResolvedGreenwebSmsConfig): Promise<ConnectionTestResult> {
    try {
      const baseUrl = config.apiUrl ?? DEFAULT_BASE_URL;
      const destination = await assertSafeHttpDestination(baseUrl);
      const params = new URLSearchParams({ token: config.apiKey, type: 'balance' });

      const { status, body } = await fetchPinnedJsonWithStatus(
        destination,
        `${baseUrl}?${params.toString()}`,
        { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (status >= 500) return { success: false, message: 'Could not reach the Greenweb API.' };
      const data = body as Record<string, any>;

      if (status < 400 && data?.status === 'success') {
        return { success: true, message: 'Connected — Greenweb account token verified.' };
      }
      // A 404/400 is a wrong address (a mistyped custom apiUrl), not a wrong token.
      if (status >= 400 && status !== 401 && status !== 403) {
        return {
          success: false,
          message: 'Greenweb did not accept the request — check the API address.',
        };
      }
      return {
        success: false,
        message: 'Authentication rejected — check the account token.',
      };
    } catch (err) {
      if (err instanceof OutboundDestinationError) {
        return { success: false, message: err.publicMessage };
      }
      return { success: false, message: 'Could not reach the Greenweb API.' };
    }
  }
}

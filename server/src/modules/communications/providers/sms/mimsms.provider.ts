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
export interface ResolvedMimSmsConfig {
  apiKey: string;
  senderId: string;
  apiUrl?: string;
  /** Ignored; callers written before the generic resolver still pass it. */
  gateway?: string;
}

const DEFAULT_BASE_URL = 'https://api.mimsms.com/api/SmsSending/SMS';
// MimSMS's balance-check endpoint, a different path under the same host —
// `config.apiUrl` only ever overrides the send endpoint, so it doesn't
// apply here.
const BALANCE_URL = 'https://api.mimsms.com/api/User/Balance';
const REQUEST_TIMEOUT_MS = 10_000;
const UNREACHABLE_ERROR = 'Could not reach MimSMS; the message may or may not have been sent.';
// Rule 23: fixed sentences for a status-decided failure (#3320).
const SEND_TEXT = {
  auth: 'MimSMS rejected the API key.',
  rejected: 'MimSMS rejected the message.',
  ambiguous: UNREACHABLE_ERROR,
};

/**
 * MimSMS BD gateway. POST-JSON REST API, keyed by api_key + senderid.
 * `config` is resolved per tenant by `MessagingConfigResolver` and
 * passed in by the registry — this gateway no longer reads
 * `ConfigService` itself (#8.7.10).
 */
@Injectable()
export class MimsmsProvider extends MessagingProvider<ResolvedMimSmsConfig> {
  readonly descriptor: ProviderDescriptor = {
    medium: CommunicationMedium.SMS,
    name: 'mimsms',
    label: { en: 'MimSMS', bn: 'মিমএসএমএস' },
    capabilities: [],
    fields: [
      { key: 'apiKey', label: { en: 'API key', bn: 'এপিআই কী' }, kind: 'secret', required: true },
      {
        key: 'senderId',
        label: { en: 'Sender name (Sender ID)', bn: 'প্রেরকের নাম (Sender ID)' },
        kind: 'text',
        required: true,
      },
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
  readonly envPrefix = 'MIMSMS';

  async send(
    params: CommunicationSendParams,
    config: ResolvedMimSmsConfig,
  ): Promise<CommunicationSendResult> {
    const { to, body: message } = params;
    const segmentInfo = countSmsSegments(message);
    try {
      const baseUrl = config.apiUrl ?? DEFAULT_BASE_URL;
      const destination = await assertSafeHttpDestination(baseUrl);

      const { status, body } = await fetchPinnedJsonWithStatus(destination, baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          api_key: config.apiKey,
          senderid: config.senderId,
          number: normalizeBdPhoneNumber(to),
          message,
          type: segmentInfo.encoding === 'UCS_2' ? 'unicode' : 'text',
        }),
      });
      const failed = this.failureForHttpStatus(status, SEND_TEXT, segmentInfo.segments, body);
      if (failed) return failed;
      const data = body as Record<string, any>;

      if (data?.status === 'success') {
        return {
          success: true,
          providerMessageId: data.transaction_id ?? null,
          raw: data,
          segments: segmentInfo.segments,
          outcome: 'ACCEPTED',
        };
      }
      // MimSMS answered — it just refused the message. A definite
      // REJECTED.
      return {
        success: false,
        providerMessageId: null,
        // Rule 23: a fixed sentence; the vendor's text stays in `raw`.
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
        // succeed on retry, and might have reached MimSMS anyway, so it's AMBIGUOUS. A 2xx body
        // that is not JSON is AMBIGUOUS too, but never retried (`retryAfterThrow`).
        retryable: this.retryAfterThrow(err),
        outcome: err instanceof DestinationBlockedError ? 'REJECTED' : 'AMBIGUOUS',
      };
    }
  }

  /**
   * #8.7.12's connection test — a balance check, MimSMS's cheapest
   * token-verification call, instead of sending a real SMS.
   */
  async testConnection(config: ResolvedMimSmsConfig): Promise<ConnectionTestResult> {
    try {
      // Check the bare address, then add the key: the guard and the pinned fetch put the URL they
      // are given in their error text, which must never carry the school's key (Rule 13).
      const destination = await assertSafeHttpDestination(BALANCE_URL);
      const params = new URLSearchParams({ api_key: config.apiKey });
      const url = `${BALANCE_URL}?${params.toString()}`;
      // Status first (#3342): a vendor 5xx with a JSON body is an outage, not a bad key. A 429
      // (rate limited, RFC 6585) is temporary too, never "check the API key".
      const { status, body } = await fetchPinnedJsonWithStatus(destination, url, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (status >= 500 || status === 429) {
        return { success: false, message: 'Could not reach the MimSMS API.' };
      }
      const data = body as Record<string, any>;

      if (status < 400 && data?.status === 'success') {
        return { success: true, message: 'Connected — MimSMS account credentials verified.' };
      }
      return { success: false, message: 'Authentication rejected — check the API key.' };
    } catch {
      return { success: false, message: 'Could not reach the MimSMS API.' };
    }
  }
}

import { Injectable } from '@nestjs/common';
import { CommunicationMedium, countSmsSegments, type ProviderDescriptor } from '@biddaloy/shared';
import {
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { MessagingProvider, ProviderAuthRejectedError } from '../messaging-provider';
import {
  assertSafeHttpDestination,
  DestinationBlockedError,
} from '../shared/outbound-destination-guard';
import { fetchPinnedJsonWithStatus } from '../shared/pinned-http';

const REQUEST_TIMEOUT_MS = 10_000;

export interface OnecodesoftConfig {
  apiKey: string;
  senderId?: string;
  apiUrl: string;
}

// Rule 23: fixed sentences; the vendor's own text only ever goes in `raw`.
const REJECTED_ERROR = 'OneCodeSoft rejected the message.';
const REJECTED_AUTH_ERROR = 'OneCodeSoft rejected the API key.';
const AMBIGUOUS_ERROR = 'OneCodeSoft did not give a usable answer.';
const BLOCKED_ERROR = 'OneCodeSoft API address is not allowed.';
const NO_URL_ERROR = 'OneCodeSoft API address is not set.';
const SEND_TEXT = {
  auth: REJECTED_AUTH_ERROR,
  rejected: REJECTED_ERROR,
  ambiguous: AMBIGUOUS_ERROR,
};
const AUTH_REJECTED = /unauthori[sz]ed|unauthenticated|invalid api key/i;
const REJECTED_RECIPIENT_STATUSES = new Set(['failed', 'blocked', 'spam']);
const FAILED_DELIVERY_STATUSES = new Set(['failed', 'expired', 'rejected', 'undelivered']);

/**
 * OneCodeSoft Bulk SMS API v3 (https://onecodesoft.com/docs/bulks-sms-v3).
 * Bearer key, JSON in and out; the base address comes from the vendor
 * dashboard, so `apiUrl` is required. It must include the `/api` segment
 * (vendor paths are `/api/v3/...`); this class appends `/v3/...` to it.
 * The HTTP status decides before the body (#3320): 401/403 and other 4xx are REJECTED, 5xx is
 * AMBIGUOUS. Help text for `apiUrl` lives in i18n key `help.messaging.onecodesoft.apiUrl` (D15/D18).
 */
@Injectable()
export class OnecodesoftProvider extends MessagingProvider<OnecodesoftConfig> {
  readonly descriptor: ProviderDescriptor = {
    medium: CommunicationMedium.SMS,
    name: 'onecodesoft',
    label: { en: 'OneCodeSoft', bn: 'ওয়ানকোডসফট' },
    capabilities: ['status', 'balance'],
    fields: [
      { key: 'apiKey', label: { en: 'API key', bn: 'এপিআই কী' }, kind: 'secret', required: true },
      {
        key: 'senderId',
        label: { en: 'Sender name (Sender ID)', bn: 'প্রেরকের নাম (Sender ID)' },
        kind: 'text',
        required: false,
        // A school with its own key never sends under the platform's sender id.
        owned: true,
      },
      {
        key: 'apiUrl',
        label: { en: 'API address', bn: 'এপিআই ঠিকানা' },
        kind: 'url',
        required: true,
      },
    ],
    supportsTestMessage: true,
  };
  readonly envPrefix = 'ONECODESOFT';

  async send(
    params: CommunicationSendParams,
    config: OnecodesoftConfig,
  ): Promise<CommunicationSendResult> {
    const { to, body: message } = params;
    const segmentInfo = countSmsSegments(message);
    if (!config.apiUrl) {
      return {
        success: false,
        providerMessageId: null,
        error: NO_URL_ERROR,
        segments: segmentInfo.segments,
        retryable: false,
        outcome: 'REJECTED',
      };
    }
    try {
      const { destination, url } = await this.target(config, '/v3/send-sms');
      const { status, body } = await fetchPinnedJsonWithStatus(destination, url, {
        method: 'POST',
        headers: this.headers(config),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          number: this.normalizeBdPhone(to),
          message,
          ...(config.senderId ? { senderid: config.senderId } : {}),
        }),
      });
      const failed = this.failureForHttpStatus(status, SEND_TEXT, segmentInfo.segments, body);
      if (failed) return failed;
      const data = body as Record<string, any>;

      const result = (data?.data?.results ?? data?.results)?.[0];
      if (data?.status === 'success' && String(result?.status).toLowerCase() === 'sent') {
        return {
          success: true,
          providerMessageId: result.message_id ?? null,
          raw: data,
          segments: Number(result.sms_count) || segmentInfo.segments,
          outcome: 'ACCEPTED',
        };
      }
      // A bad key is the one refusal the admin can act on by name. The 401 body
      // may carry no `status` at all ({"message":"Unauthenticated."}).
      const authRejected = AUTH_REJECTED.test(String(data?.message));
      const refused =
        authRejected ||
        data?.status === 'error' ||
        REJECTED_RECIPIENT_STATUSES.has(String(result?.status).toLowerCase());
      if (refused) {
        return {
          success: false,
          providerMessageId: null,
          error: authRejected ? REJECTED_AUTH_ERROR : REJECTED_ERROR,
          raw: data,
          segments: segmentInfo.segments,
          retryable: false,
          outcome: 'REJECTED',
        };
      }
      // Answered, but not in a shape we trust: the SMS may have gone out, so it is never
      // retried (a retry could send it twice; see `failureForHttpStatus`). The credit stays held.
      return {
        success: false,
        providerMessageId: null,
        error: AMBIGUOUS_ERROR,
        raw: data,
        segments: segmentInfo.segments,
        retryable: false,
        outcome: 'AMBIGUOUS',
      };
    } catch (err) {
      const blocked = err instanceof DestinationBlockedError;
      return {
        success: false,
        providerMessageId: null,
        // Fixed sentences only: the guard's own message can carry the raw URL (Rule 23).
        error: blocked ? BLOCKED_ERROR : AMBIGUOUS_ERROR,
        segments: segmentInfo.segments,
        retryable: this.retryAfterThrow(err),
        outcome: blocked ? 'REJECTED' : 'AMBIGUOUS',
      };
    }
  }

  async getBalance(config: OnecodesoftConfig): Promise<{ amount: number; estimateSms?: number }> {
    const { destination, url } = await this.target(config, '/v3/balance');
    const { status, body: json } = await fetchPinnedJsonWithStatus(destination, url, {
      method: 'GET',
      headers: this.headers(config),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = json as Record<string, any>;
    // A refused key is the one failure the admin can fix by name (testConnection says so). The
    // status decides first: any other error code is a plain failure, whatever its body says (a 500
    // with "Unauthenticated." is the vendor failing, not the key). The body is read only on a 2xx.
    if (status === 401 || status === 403) throw new ProviderAuthRejectedError();
    if (status >= 400) throw new Error('OneCodeSoft balance check failed.');
    if (AUTH_REJECTED.test(String(data?.message))) throw new ProviderAuthRejectedError();
    const body = data?.data ?? data;
    const raw = body?.balance;
    // Number(null) and Number('') are 0: a missing balance must not read as "empty account".
    const amount = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    if (data?.status === 'error' || !Number.isFinite(amount)) {
      throw new Error('OneCodeSoft balance check failed.');
    }
    return { amount, estimateSms: body.estimate_sms };
  }

  async getStatus(
    providerMessageId: string,
    config: OnecodesoftConfig,
  ): Promise<{ status: 'DELIVERED' | 'FAILED' | 'PENDING'; code?: string }> {
    const { destination, url } = await this.target(config, '/v3/status', {
      message_id: providerMessageId,
    });
    const { status, body } = await fetchPinnedJsonWithStatus(destination, url, {
      method: 'GET',
      headers: this.headers(config),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = body as Record<string, any>;
    if (status >= 400 || data?.status === 'error') {
      throw new Error('OneCodeSoft status check failed.');
    }
    const info = data?.data?.Data ?? data?.Data;
    if (!info) return { status: 'PENDING' };
    const code =
      info.ErrorCode === undefined || info.ErrorCode === null || info.ErrorCode === ''
        ? undefined
        : String(info.ErrorCode);
    const label = String(info.Status ?? '').toLowerCase();
    if (label === 'delivered') return { status: 'DELIVERED', code };
    if ((code !== undefined && code !== '000') || FAILED_DELIVERY_STATUSES.has(label)) {
      return { status: 'FAILED', code };
    }
    return { status: 'PENDING', code };
  }

  private headers(config: OnecodesoftConfig) {
    return {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /**
   * Rule 7: validate the tenant-supplied base address, then pin the request to it. The path is
   * appended segment by segment, so a trailing slash or a doubled one never matters; an address
   * with its own query or fragment is refused (it could not be joined safely).
   */
  private async target(
    config: OnecodesoftConfig,
    path: string,
    query: Record<string, string> = {},
  ) {
    const destination = await assertSafeHttpDestination(config.apiUrl);
    if (destination.url.search || destination.url.hash) {
      throw new DestinationBlockedError('the API address must not carry a query or fragment.');
    }
    const url = new URL(destination.url);
    url.pathname = [...url.pathname.split('/'), ...path.split('/')].filter(Boolean).join('/');
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return { destination, url: url.toString() };
  }
}

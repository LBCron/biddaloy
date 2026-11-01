import { Injectable } from '@nestjs/common';
import { CommunicationMedium, type ProviderDescriptor } from '@biddaloy/shared';
import {
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { MessagingProvider } from '../messaging-provider';
import { ConnectionTestResult } from '../shared/connection-test.types';
import { isValidGraphApiId } from '../shared/graph-api-path-segment.util';
import { mapMetaGraphError } from '../shared/meta-graph-error.util';

export interface ResolvedMessengerConfig {
  pageId: string;
  accessToken: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Placeholder for future Messenger support.
 *
 * Meta's Messenger Platform can only deliver to a PSID (Page-Scoped ID) of
 * a user who has already messaged the school's Facebook Page (or opted in
 * via a Messenger entry point) — there is no API to resolve a guardian's
 * phone number or email into a Messenger recipient. A real implementation
 * needs a PSID-capture flow elsewhere in the product before this provider
 * can do anything with `recipient_address`, so it stays a stub.
 *
 * Still resolves the tenant's config first so an unconfigured tenant gets
 * "configure Messenger in settings" rather than "not yet implemented" —
 * distinguishing the two matters for the connection-test flow in #8.7.12.
 *
 * Returns a failure result rather than throwing, per the
 * CommunicationProvider contract — a thrown error here would leave the
 * CommunicationLog row stuck QUEUED instead of being recorded FAILED.
 */
@Injectable()
export class MetaPageProvider extends MessagingProvider<ResolvedMessengerConfig> {
  readonly descriptor: ProviderDescriptor = {
    medium: CommunicationMedium.MESSENGER,
    name: 'meta-page',
    label: { en: 'Facebook Page (Meta)', bn: 'ফেসবুক পেজ (Meta)' },
    capabilities: [],
    fields: [
      {
        key: 'pageId',
        label: { en: 'Facebook Page ID', bn: 'ফেসবুক পেজ আইডি' },
        kind: 'text',
        required: true,
      },
      {
        key: 'accessToken',
        label: { en: 'Access token', bn: 'অ্যাক্সেস টোকেন' },
        kind: 'secret',
        required: true,
      },
    ],
    supportsTestMessage: false,
  };
  readonly envPrefix = 'MESSENGER';

  async send(
    _params: CommunicationSendParams,
    _config: ResolvedMessengerConfig,
  ): Promise<CommunicationSendResult> {
    // Always-stub failure, never touches the network — REJECTED.
    return {
      success: false,
      providerMessageId: null,
      error: 'Messenger sending is not yet implemented',
      retryable: false,
      outcome: 'REJECTED',
    };
  }

  /**
   * #8.7.12's connection test. Sending itself is still a stub (see class
   * comment), but the credential *can* be verified independently — Page
   * access tokens work against the Graph API today, so fetching the
   * page's own metadata (`GET /{pageId}`) is a real, cheap check that the
   * token is valid and scoped to this page, well ahead of the day
   * `send()` stops being a stub.
   */
  async testConnection(config: ResolvedMessengerConfig): Promise<ConnectionTestResult> {
    if (!isValidGraphApiId(config.pageId)) {
      return { success: false, message: 'Page ID is not a valid Facebook Page identifier.' };
    }
    try {
      const url = `https://graph.facebook.com/${config.pageId}?fields=id`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await response.json();

      if (response.ok && data?.id) {
        return { success: true, message: 'Connected — Facebook Page verified.' };
      }
      return { success: false, message: mapMetaGraphError(data) };
    } catch {
      return { success: false, message: 'Could not reach the Facebook Graph API.' };
    }
  }
}

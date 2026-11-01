import { Injectable } from '@nestjs/common';
import { CommunicationMedium, type ProviderDescriptor } from '@biddaloy/shared';
import {
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { MessagingProvider } from '../messaging-provider';
import { normalizeBdPhoneNumber } from '../shared/phone-number.util';
import { ConnectionTestResult } from '../shared/connection-test.types';
import { isValidGraphApiId, isValidGraphApiVersion } from '../shared/graph-api-path-segment.util';
import { mapMetaGraphError } from '../shared/meta-graph-error.util';
import { ProviderNotConfiguredError } from '../../config/provider-not-configured.error';
import { DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE } from '../../whatsapp-template.util';

export interface ResolvedWhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
}

const DEFAULT_API_VERSION = 'v21.0';

const REQUEST_TIMEOUT_MS = 10_000;
const SEND_FAILED_ERROR =
  'Could not reach the WhatsApp Cloud API; the message may or may not have been sent.';

/**
 * Meta WhatsApp Business Cloud API.
 *
 * Constraint: Meta only allows freeform `text` messages as a *reply*
 * within 24 hours of the recipient's last message to the business number.
 * Outside that window (true for essentially all proactive notifications
 * like fee reminders), Meta rejects freeform sends — a pre-approved
 * template is required instead. Callers should pass `templateName` for
 * proactive notifications; freeform `body` is only reliable for replies.
 * Templates themselves must be pre-created and approved in Meta Business
 * Manager — that's an external setup step, not something this code does.
 */
@Injectable()
export class MetaCloudProvider extends MessagingProvider<ResolvedWhatsAppConfig> {
  readonly descriptor: ProviderDescriptor = {
    medium: CommunicationMedium.WHATSAPP,
    name: 'meta-cloud',
    label: {
      en: 'WhatsApp Cloud API (Meta)',
      bn: 'হোয়াটসঅ্যাপ ক্লাউড এপিআই (Meta)',
    },
    capabilities: [],
    fields: [
      {
        key: 'phoneNumberId',
        label: { en: 'Phone number ID', bn: 'ফোন নম্বর আইডি' },
        kind: 'text',
        required: true,
      },
      {
        key: 'accessToken',
        label: { en: 'Access token', bn: 'অ্যাক্সেস টোকেন' },
        kind: 'secret',
        required: true,
      },
      {
        key: 'apiVersion',
        label: { en: 'API version (optional)', bn: 'এপিআই ভার্সন (ঐচ্ছিক)' },
        kind: 'text',
        required: false,
        advanced: true,
      },
    ],
    supportsTestMessage: false,
  };
  readonly envPrefix = 'WHATSAPP';

  async send(
    params: CommunicationSendParams,
    config: ResolvedWhatsAppConfig,
  ): Promise<CommunicationSendResult> {
    try {
      const { phoneNumberId, accessToken } = config;
      const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
      // #3315: these go straight into the URL path; a stored/overridden value must be a real Graph shape.
      if (!isValidGraphApiId(phoneNumberId) || !isValidGraphApiVersion(apiVersion)) {
        throw new ProviderNotConfiguredError(
          'WhatsApp',
          'Phone number ID or API version is not a valid Graph API value.',
        );
      }
      const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
      const to = normalizeBdPhoneNumber(params.to);

      const payload = params.templateName
        ? {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'template',
            template: {
              name: params.templateName,
              // Shared with the reminder preview path so the review step
              // shows the language Meta will really receive.
              language: { code: params.templateLanguage ?? DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE },
              components: params.templateParams?.length
                ? [
                    {
                      type: 'body',
                      parameters: params.templateParams.map((text) => ({ type: 'text', text })),
                    },
                  ]
                : undefined,
            },
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body: params.body },
          };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (response.ok && data?.messages?.length) {
        return {
          success: true,
          providerMessageId: data.messages[0].id,
          raw: data,
          outcome: 'ACCEPTED',
        };
      }
      // Meta answered with an HTTP response — success:false here always
      // means the request landed and was refused (bad template, invalid
      // number, permission error, etc.), a definite REJECTED even for a
      // response.ok:false (still an answered HTTP response, not a network
      // failure).
      return {
        success: false,
        providerMessageId: null,
        error: data?.error?.message ?? 'Unknown Meta WhatsApp Cloud API error',
        raw: data,
        outcome: 'REJECTED',
      };
    } catch (err) {
      // Never got an HTTP response back — ProviderNotConfiguredError never
      // reached the network (REJECTED); a timeout/abort/network error may
      // have reached Meta anyway (AMBIGUOUS).
      return {
        success: false,
        providerMessageId: null,
        // Rules 23/24: fixed text; the not-configured sentence is secret-free (deliveryErrorCode reads it).
        error: err instanceof ProviderNotConfiguredError ? err.message : SEND_FAILED_ERROR,
        retryable: err instanceof ProviderNotConfiguredError ? false : undefined,
        outcome: err instanceof ProviderNotConfiguredError ? 'REJECTED' : 'AMBIGUOUS',
      };
    }
  }

  /**
   * #8.7.12's connection test — reads the phone number's own metadata
   * (`GET /{phoneNumberId}`) instead of sending a message, the cheapest
   * call that still proves both the phone number id and the access token
   * are valid together. `config` can be an unsaved, in-flight draft (the
   * dashboard verifying before saving) or the tenant's stored config —
   * this method doesn't care which, only `ConnectionTestService` does.
   */
  async testConnection(config: ResolvedWhatsAppConfig): Promise<ConnectionTestResult> {
    if (!isValidGraphApiId(config.phoneNumberId)) {
      return { success: false, message: 'Phone number ID is not a valid WhatsApp identifier.' };
    }
    const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    if (!isValidGraphApiVersion(apiVersion)) {
      return { success: false, message: 'API version is not a valid Graph API version.' };
    }
    try {
      const url = `https://graph.facebook.com/${apiVersion}/${config.phoneNumberId}?fields=id`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const data = await response.json();

      if (response.ok && data?.id) {
        return { success: true, message: 'Connected — phone number ID verified.' };
      }
      return { success: false, message: mapMetaGraphError(data) };
    } catch {
      return { success: false, message: 'Could not reach the WhatsApp Cloud API.' };
    }
  }
}

import type { MessagingProviderDescriptor, MessagingProviders } from '@biddaloy/ui/hooks';
import { http, HttpResponse } from 'msw';

/** The six registered companies as `GET /schools/:id/settings/messaging/providers` returns them. */
const apiKey = {
  key: 'apiKey',
  label: { en: 'API key', bn: 'এপিআই কী' },
  kind: 'secret',
  required: true,
} as const;

const apiUrlOptional = {
  key: 'apiUrl',
  label: { en: 'API address (optional)', bn: 'এপিআই ঠিকানা (ঐচ্ছিক)' },
  kind: 'url',
  required: false,
  advanced: true,
} as const;

const senderId = (required: boolean) =>
  ({
    key: 'senderId',
    label: { en: 'Sender name (Sender ID)', bn: 'প্রেরকের নাম (Sender ID)' },
    kind: 'text',
    required,
  }) as const;

export const GREENWEB: MessagingProviderDescriptor = {
  medium: 'SMS',
  name: 'greenweb',
  label: { en: 'Greenweb', bn: 'গ্রিনওয়েব' },
  capabilities: [],
  fields: [apiKey, apiUrlOptional],
  supportsTestMessage: true,
};

export const MIMSMS: MessagingProviderDescriptor = {
  medium: 'SMS',
  name: 'mimsms',
  label: { en: 'MimSMS', bn: 'মিমএসএমএস' },
  capabilities: [],
  fields: [apiKey, senderId(true), apiUrlOptional],
  supportsTestMessage: true,
};

export const ONECODESOFT: MessagingProviderDescriptor = {
  medium: 'SMS',
  name: 'onecodesoft',
  label: { en: 'OneCodeSoft', bn: 'ওয়ানকোডসফট' },
  capabilities: ['status', 'balance'],
  fields: [
    apiKey,
    senderId(false),
    {
      key: 'apiUrl',
      label: { en: 'API address', bn: 'এপিআই ঠিকানা' },
      kind: 'url',
      required: true,
    },
  ],
  supportsTestMessage: true,
};

export const META_CLOUD: MessagingProviderDescriptor = {
  medium: 'WHATSAPP',
  name: 'meta-cloud',
  label: { en: 'WhatsApp Cloud API (Meta)', bn: 'হোয়াটসঅ্যাপ ক্লাউড এপিআই (Meta)' },
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

export const SMTP: MessagingProviderDescriptor = {
  medium: 'EMAIL',
  name: 'smtp',
  label: { en: 'SMTP email server', bn: 'এসএমটিপি ইমেইল সার্ভার' },
  capabilities: [],
  fields: [
    {
      key: 'host',
      label: { en: 'Email server (SMTP)', bn: 'ইমেইল সার্ভার (SMTP)' },
      kind: 'text',
      required: true,
    },
    {
      key: 'port',
      label: { en: 'Port', bn: 'পোর্ট' },
      kind: 'text',
      required: false,
      destination: true,
      format: 'port',
    },
    {
      key: 'user',
      label: { en: 'Server username', bn: 'সার্ভারের ব্যবহারকারীর নাম' },
      kind: 'text',
      required: true,
    },
    {
      key: 'password',
      label: { en: 'Server password', bn: 'সার্ভারের পাসওয়ার্ড' },
      kind: 'secret',
      required: true,
    },
    {
      key: 'from',
      label: { en: 'Send emails from', bn: 'যে ঠিকানা থেকে ইমেইল যাবে' },
      kind: 'text',
      required: true,
    },
  ],
  supportsTestMessage: true,
};

export const META_PAGE: MessagingProviderDescriptor = {
  medium: 'MESSENGER',
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

export function providersResponse(
  configured: Partial<Record<'SMS' | 'WHATSAPP' | 'EMAIL' | 'MESSENGER', boolean>> = {},
  selectedSms: string | null = 'greenweb',
): MessagingProviders {
  return {
    SMS: {
      providers: [GREENWEB, MIMSMS, ONECODESOFT],
      configured: configured.SMS ?? false,
      selected: selectedSms,
    },
    WHATSAPP: {
      providers: [META_CLOUD],
      configured: configured.WHATSAPP ?? false,
      selected: 'meta-cloud',
    },
    EMAIL: { providers: [SMTP], configured: configured.EMAIL ?? false, selected: 'smtp' },
    MESSENGER: {
      providers: [META_PAGE],
      configured: configured.MESSENGER ?? false,
      selected: 'meta-page',
    },
  };
}

/** MSW handler for the providers GET (tests and stories). */
export function providersHandler(...args: Parameters<typeof providersResponse>) {
  return http.get('/api/v1/schools/:id/settings/messaging/providers', () =>
    HttpResponse.json(providersResponse(...args)),
  );
}

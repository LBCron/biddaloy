import type { Meta, StoryObj } from '@storybook/react-vite';
import { http } from 'msw';

import { providersHandler } from './provider-config-form.fixtures';
import { ProviderConfigForm } from './ProviderConfigForm';

/**
 * The generic Settings › Communication card: every field comes from the
 * server's company schema (`GET …/settings/messaging/providers`), mocked here
 * with MSW. Light/dark and desktop/phone come from the toolbar globals.
 */
const meta: Meta<typeof ProviderConfigForm> = {
  component: ProviderConfigForm,
  args: {
    medium: 'SMS',
    schoolId: 'school-1',
    sectionId: 'sms-section',
    title: 'SMS',
    description: 'All SMS from this school go through this company.',
    saved: {
      provider: 'greenweb',
      greenweb: { apiKey: { configured: true, hint: '••••key1' } },
    },
  },
  parameters: { msw: { handlers: [providersHandler({ SMS: true })] } },
};
export default meta;

type Story = StoryObj<typeof ProviderConfigForm>;

/** Three SMS companies, one picker, the test-message row. */
export const SmsGreenweb: Story = {};

/** The new company: required API address, Sender ID optional. */
export const SmsOneCodeSoft: Story = {
  args: {
    saved: {
      provider: 'onecodesoft',
      onecodesoft: {
        apiUrl: 'https://app.onecodesoft.com/api',
        apiKey: { configured: true, hint: '••••a1b2' },
      },
    },
  },
  parameters: { msw: { handlers: [providersHandler({ SMS: true }, 'onecodesoft')] } },
};

/** Nothing saved yet: "Not set up", every secret empty. */
export const SmsEmpty: Story = {
  args: { saved: undefined },
  parameters: { msw: { handlers: [providersHandler({ SMS: false }, null)] } },
};

/** The server schema is still loading: the card is not drawn yet. */
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(
          '/api/v1/schools/:id/settings/messaging/providers',
          () => new Promise(() => undefined),
        ),
      ],
    },
  },
};

/** A sole company (no picker); no test-message row because it cannot send one. */
export const WhatsApp: Story = {
  args: {
    medium: 'WHATSAPP',
    sectionId: 'whatsapp-section',
    title: 'WhatsApp',
    description: 'Enter your Meta Business account details to message guardians on WhatsApp.',
    saved: {
      'meta-cloud': {
        phoneNumberId: '1234567890',
        accessToken: { configured: true, hint: '••••oken' },
      },
    },
  },
  parameters: { msw: { handlers: [providersHandler({ WHATSAPP: true })] } },
};

export const Email: Story = {
  args: {
    medium: 'EMAIL',
    sectionId: 'email-section',
    title: 'Email',
    description: 'Emails from this school are sent through this server.',
    saved: {
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        user: 'noreply',
        from: 'noreply@example.com',
        password: { configured: true, hint: '••••pass' },
      },
    },
  },
  parameters: { msw: { handlers: [providersHandler({ EMAIL: true })] } },
};

export const Messenger: Story = {
  args: {
    medium: 'MESSENGER',
    sectionId: 'messenger-section',
    title: 'Messenger',
    description: 'Enter your Facebook Page details to message guardians on Messenger.',
    saved: undefined,
  },
  parameters: { msw: { handlers: [providersHandler()] } },
};

export const SmsDark: Story = { globals: { theme: 'dark' } };

export const SmsPhone: Story = { globals: { viewport: { value: 'mobile1', isRotated: false } } };

export const SmsBangla: Story = { globals: { locale: 'bn' } };
